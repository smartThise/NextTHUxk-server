/**
 * NextTHUxk Server — 每个人的下一代选课
 * 启动: cd AI选课分析系统/local-server && npm start
 */
import http from "http";
import fetch from "cross-fetch";
import * as cheerio from "cheerio";
import { sm2 } from "sm-crypto";
import iconv from "iconv-lite";
import fs from "fs";
import path from "path";
import url from "url";
import crypto from "crypto";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const ZHJWXK = "https://zhjwxk.cic.tsinghua.edu.cn";
const ID_LOGIN = "https://id.tsinghua.edu.cn/do/off/ui/auth/login/check";
const DOUBLE_AUTH = "https://id.tsinghua.edu.cn/b/doubleAuth/login";
const SAVE_FINGER = "https://id.tsinghua.edu.cn/b/doubleAuth/personal/saveFinger";
const SESSION_TTL = 24 * 60 * 60; // 24h in seconds
const COOKIE_NAME = "nx_state";
const SECRET = crypto.randomBytes(32).toString("base64"); // 每次启动重置，旧 cookie 自动失效

// ═══════════════ Session — 状态存在浏览器 Cookie，服务端零存储 ═══════════════
interface Session {
  id: string;
  cookies: Record<string, string>;
  loginState: "idle" | "logging_in" | "need_2fa" | "done" | "error";
  loginError: string;
  loginProgress: string[];
  pending2FA: { methods: string[]; methodKeys: string[] } | null;
  storedUserId: string;
  storedPassword: string;
  webvpnZhjwxkBase: string;
  serverCache: { sem: string; plan: any[]; catalog: any[]; volunteer: Record<string, any>; ts: number };
  finger: string;
  _dirty: boolean; // track if state changed
}

function createSession(): Session {
  const id = crypto.randomUUID();
  return {
    id, cookies: {}, loginState: "idle", loginError: "", loginProgress: [],
    pending2FA: null, storedUserId: "", storedPassword: "", webvpnZhjwxkBase: "",
    serverCache: { sem: "", plan: [], catalog: [], volunteer: {}, ts: 0 },
    finger: "thu-proxy-" + id.substring(0, 8), _dirty: false,
  };
}

// Simple encrypt/decrypt to prevent cookie tampering
function encrypt(text: string): string {
  const iv = crypto.randomBytes(16);
  const key = crypto.createHash("sha256").update(SECRET).digest();
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(text, "utf-8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64url");
}
function decrypt(data: string): string | null {
  try {
    const buf = Buffer.from(data, "base64url");
    const iv = buf.subarray(0, 16), tag = buf.subarray(16, 32), enc = buf.subarray(32);
    const key = crypto.createHash("sha256").update(SECRET).digest();
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf-8");
  } catch { return null; }
}

function packState(s: Session): string {
  // 只存轻量状态，serverCache (catalog/volunteer 数据可达 MB 级) 不放入 cookie
  const slim: any = {
    id: s.id, c: s.cookies, ls: s.loginState, le: s.loginError,
    p2fa: s.pending2FA, uid: s.storedUserId, pwd: s.storedPassword,
    wv: s.webvpnZhjwxkBase, f: s.finger,
  };
  return encrypt(JSON.stringify(slim));
}

function unpackState(data: string): Session | null {
  const json = decrypt(data);
  if (!json) return null;
  try {
    const d = JSON.parse(json);
    const s = createSession();
    s.id = d.id; s.cookies = d.c || {}; s.loginState = d.ls; s.loginError = d.le || "";
    s.loginProgress = d.lp || []; s.pending2FA = d.p2fa; s.storedUserId = d.uid || "";
    s.storedPassword = d.pwd || ""; s.webvpnZhjwxkBase = d.wv || "";
    s.serverCache = d.sc || { sem: "", plan: [], catalog: [], volunteer: {}, ts: 0 };
    s.finger = d.f || ("thu-proxy-" + (d.id || "x").substring(0, 8));
    s._dirty = false;
    // serverCache 不从 cookie 恢复，重新拉取
    return s;
  } catch { return null; }
}

function getSession(req: http.IncomingMessage): Session {
  const cookieHeader = req.headers.cookie || "";
  const m = cookieHeader.match(new RegExp(COOKIE_NAME + "=([^;]+)"));
  if (m) { const s = unpackState(m[1]); if (s) return s; }
  const s = createSession();
  console.log(`  [session] NEW ${s.id}`);
  return s;
}

function saveState(res: http.ServerResponse, s: Session) {
  const val = packState(s);
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=${val}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL}`);
}

// ── In-memory server cache (catalog/volunteer 数据太大不能放 cookie，改存内存) ──
const memoryCaches = new Map<string, { sem: string; plan: any[]; catalog: any[]; volunteer: Record<string, any>; ts: number }>();

// ═══════════════ HTTP helpers (session-scoped) ═══════════════
function ch(s: Session) { return Object.entries(s.cookies).map(([k, v]) => `${k}=${v}`).join("; "); }
function saveCookies(s: Session, r: Response) {
  const raw = (r.headers as any).raw?.();
  if (raw?.["set-cookie"]) for (const c of raw["set-cookie"]) {
    const [seg] = c.split(";"); const eq = seg.indexOf("=");
    if (eq > 0) { s.cookies[seg.substring(0, eq).trim()] = seg.substring(eq + 1).trim(); s._dirty = true; }
  }
}
function zhjwxkUrl(s: Session, p: string): string {
  return s.webvpnZhjwxkBase ? s.webvpnZhjwxkBase + p : ZHJWXK + p;
}
function sLog(s: Session, msg: string) { s.loginProgress.push(`[${new Date().toLocaleTimeString()}] ${msg}`); s._dirty = true; console.log(`  [${s.id.substring(0, 8)}] ${msg}`); }

async function decodeBody(r: Response, urlHint?: string): Promise<string> {
  const buf = Buffer.from(await r.arrayBuffer());
  const ct = (r.headers.get("content-type") || "").toLowerCase();
  if (ct.includes("gbk") || ct.includes("gb2312")) return iconv.decode(buf, "gbk");
  const rawStr = buf.toString("utf-8");
  if (rawStr.includes("charset=GBK") || rawStr.includes("charset=gb2312") || rawStr.includes('charset="GBK"')) {
    return iconv.decode(buf, "gbk");
  }
  if (urlHint && /zhjw|xkBks|jhBks|vjsKcbBs/.test(urlHint)) return iconv.decode(buf, "gbk");
  return rawStr;
}

async function fetchAuto(s: Session, urlStr: string): Promise<string> {
  const r = await fetch(urlStr, { headers: { "User-Agent": UA, Cookie: ch(s) } });
  saveCookies(s, r);
  if (r.status !== 200 && r.status !== 201) throw new Error(`GET ${urlStr} → ${r.status}`);
  return decodeBody(r, urlStr);
}
async function postForm(s: Session, urlStr: string, form: Record<string, string>): Promise<string> {
  const body = Object.entries(form).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
  const r = await fetch(urlStr, { method: "POST", headers: { "User-Agent": UA, Cookie: ch(s), "Content-Type": "application/x-www-form-urlencoded" }, body });
  saveCookies(s, r);
  if (r.status !== 200 && r.status !== 201) throw new Error(`POST ${urlStr} → ${r.status}`);
  return decodeBody(r, urlStr);
}
async function followChain(s: Session, urlStr: string, maxHops = 15): Promise<{ finalUrl: string; html: string }> {
  let cur = urlStr, html = "";
  for (let i = 0; i < maxHops; i++) {
    console.log(`  [followChain] hop=${i} url=${cur}`);
    const r = await fetch(cur, { headers: { "User-Agent": UA, Cookie: ch(s) }, redirect: "manual" } as RequestInit);
    saveCookies(s, r);
    console.log(`  [followChain] hop=${i} status=${r.status} ct=${r.headers.get("content-type")}`);
    if (r.status === 301 || r.status === 302 || r.status === 307 || r.status === 308) {
      const n = r.headers.get("Location") || "";
      console.log(`  [followChain] hop=${i} redirect → ${n}`);
      cur = n.startsWith("http") ? n : new URL(n, cur).href;
      continue;
    }
    html = await decodeBody(r, cur); return { finalUrl: cur, html };
  }
  return { finalUrl: cur, html };
}
async function fetchGbk(s: Session, urlStr: string, label?: string): Promise<string> {
  console.log(`  [fetchGbk] ${label || urlStr.substring(0, 80)}`);
  const r = await fetch(urlStr, { headers: { "User-Agent": UA, Cookie: ch(s) } });
  saveCookies(s, r);
  console.log(`  [fetchGbk] status=${r.status} len=${(await r.clone().arrayBuffer()).byteLength}`);
  return iconv.decode(Buffer.from(await r.arrayBuffer()), "gbk");
}
async function postFormGbk(s: Session, urlStr: string, form: Record<string, string>, label?: string): Promise<string> {
  console.log(`  [postFormGbk] ${label || urlStr.substring(0, 80)}`);
  const body = Object.entries(form).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
  const r = await fetch(urlStr, { method: "POST", headers: { "User-Agent": UA, Cookie: ch(s), "Content-Type": "application/x-www-form-urlencoded" }, body });
  saveCookies(s, r);
  console.log(`  [postFormGbk] status=${r.status} len=${(await r.clone().arrayBuffer()).byteLength}`);
  return iconv.decode(Buffer.from(await r.arrayBuffer()), "gbk");
}

// ═══════════════ Login flow (session-scoped) ═══════════════
async function doLogin(s: Session, userId: string, password: string) {
  s.loginState = "logging_in"; s.loginError = ""; s.loginProgress = []; s.pending2FA = null;
  s.storedUserId = userId; s.storedPassword = password;
  try {
    sLog(s, "连接 webvpn...");
    const lpHtml = await fetchAuto(s, "https://webvpn.tsinghua.edu.cn/login?oauth_login=true");
    const sm2Key1 = cheerio.load(lpHtml)("#sm2publicKey").text();
    if (!sm2Key1) throw new Error("无法获取 SM2 key");
    sLog(s, "CAS 认证中...");
    const loginResp = await postForm(s, ID_LOGIN, { i_user: userId, i_pass: "04" + sm2.doEncrypt(password, sm2Key1), fingerPrint: s.finger, fingerGenPrint: "", i_captcha: "" });
    if (loginResp.includes("二次认证")) { await handle2FAResponse(s); return; }
    await finishLogin(s, loginResp);
  } catch (e: any) { s.loginState = "error"; s.loginError = e.message; sLog(s, `错误: ${e.message}`); }
}
async function handle2FAResponse(s: Session) {
  sLog(s, "需要二次认证");
  const r1 = JSON.parse(await postForm(s, DOUBLE_AUTH, { action: "FIND_APPROACHES" }));
  const { hasWeChatBool, phone, hasTotp } = r1.object;
  const methods: string[] = [], methodKeys: string[] = [];
  if (hasWeChatBool) { methods.push("微信"); methodKeys.push("wechat"); }
  if (phone) { methods.push(`手机 (${phone})`); methodKeys.push("mobile"); }
  if (hasTotp) { methods.push("动态口令"); methodKeys.push("totp"); }
  s.pending2FA = { methods, methodKeys };
  s.loginState = "need_2fa";  // 在 pending2FA 就绪后再设，避免前端拿到空 methods
}
async function continue2FA(s: Session, methodIdx: number, code: string) {
  if (!s.pending2FA) return;
  try {
    const method = s.pending2FA.methodKeys[methodIdx];
    await postForm(s, DOUBLE_AUTH, { action: "SEND_CODE", type: method }); sLog(s, "验证码已发送");
    const r3 = JSON.parse(await postForm(s, DOUBLE_AUTH, { action: method === "totp" ? "VERITY_TOTP_CODE" : "VERITY_CODE", vericode: code }));
    if (r3.result !== "success") throw new Error("验证失败: " + r3.msg);
    sLog(s, "2FA 通过");
    await postForm(s, SAVE_FINGER, { fingerprint: s.finger, deviceName: "THU-Local-Proxy", radioVal: "是" });
    const html = await fetchAuto(s, "https://id.tsinghua.edu.cn" + r3.object.redirectUrl);
    s.pending2FA = null; s.loginState = "logging_in"; await finishLogin(s, html);
  } catch (e: any) { s.loginState = "error"; s.loginError = e.message; sLog(s, `错误: ${e.message}`); }
}
async function finishLogin(s: Session, loginResp: string) {
  if (!loginResp.includes("登录成功")) throw new Error("CAS 登录失败: " + cheerio.load(loginResp)("#msg_note").text().trim());
  sLog(s, "CAS 登录成功");
  await followChain(s, cheerio.load(loginResp)("a").attr()!.href); sLog(s, "Webvpn session 已建立");
  sLog(s, "访问选课入口...");
  const { finalUrl, html: xkHtml } = await followChain(s, zhjwxkUrl(s, "/xklogin.do"));
  const sm2Key2 = cheerio.load(xkHtml)("#sm2publicKey").text();
  if (!sm2Key2) throw new Error(`无法获取选课系统 SM2 key (finalUrl=${finalUrl})`);
  sLog(s, "选课系统 CAS 认证...");
  let cr = await postForm(s, ID_LOGIN, { i_user: s.storedUserId, i_pass: "04" + sm2.doEncrypt(s.storedPassword, sm2Key2), fingerPrint: s.finger, fingerGenPrint: "", i_captcha: "" });
  if (cr.includes("二次认证")) { await handle2FAResponse(s); return; }
  if (!cr.includes("登录成功")) throw new Error("选课系统 CAS 登录失败");
  sLog(s, "✅ 选课系统登录成功!");
  const { finalUrl: loggedInUrl } = await followChain(s, cheerio.load(cr)("a").attr()!.href);
  const wvMatch = loggedInUrl.match(/^(https:\/\/webvpn\.tsinghua\.edu\.cn\/\w+\/[^/]+\/)/);
  if (wvMatch) { s.webvpnZhjwxkBase = wvMatch[1]; sLog(s, "WebVPN proxy base: " + s.webvpnZhjwxkBase); }
  sLog(s, "选课会话已建立");
  s.storedPassword = "";  // 登录完成后清除密码
  s.loginState = "done";
}

// ═══════════════ Data API (session-scoped) ═══════════════
function getSem(q: Record<string, string | string[] | undefined>): string { return (q.p_xnxq || q.sem || "") as string; }

function parsePlan(doc: cheerio.CheerioAPI): any[] {
  const out: any[] = []; let sem = "", season = "";
  doc("table#kcTable tr").each((_, row) => {
    const tds = doc(row).find("td"); if (!tds.length) return;
    const cells: string[] = []; tds.each((_, td) => { cells.push(doc(td).text().trim().replace(/\s+/g, " ")); });
    for (const c of cells) { const sm = c.match(/(\d{4}-\d{4}学年)/); if (sm) sem = sm[1]; const sn = c.match(/^(秋|春|夏)$/); if (sn) season = sn[1]; }
    const code = cells.find(c => /^\d{8}$/.test(c)); if (!code) return;
    const name = cells.find(c => c.length > 1 && !/^\d+$/.test(c) && !["必修","限选","任选","秋","春","夏"].includes(c) && !c.includes("学年"));
    const attr = cells.find(c => ["必修","限选","任选"].includes(c));
    const credit = cells.find(c => /^\d{1,2}(\.\d)?$/.test(c) && c !== code);
    const group = cells.find(c => c.length > 2 && !["必修","限选","任选"].includes(c) && !/^\d/.test(c) && !c.includes("学年") && c !== name);
    if (name) out.push({ semester: sem + " " + season, code, name: name.replace(/\s+/g, ""), attr: attr || "", credits: parseFloat(credit!) || 0, group: group || "" });
  });
  return out;
}
function parseCatalog(doc: cheerio.CheerioAPI): any[] {
  const out: any[] = [];
  doc("tr.trr2").each((_, row) => {
    const tds = doc(row).find("td"); if (tds.length < 11) return;
    const cell = (i: number) => (tds.eq(i)?.text() || "").trim().replace(/\s+/g, " ");
    const code = cell(1), name = cell(3); if (!code || !name || !/^\d+$/.test(code)) return;
    const teacherLink = tds.eq(5)?.find('a[href*="showJsDetail"]');
    const teacherHref = teacherLink?.attr("href") || "";
    const teacherId = /p_jsh=([^&]+)/.exec(teacherHref)?.[1] || "";
    out.push({ code, seq: cell(2), name, credits: parseFloat(cell(4)) || 0, teacher: cell(5), teacherId, department: cell(0), time: cell(10), capacity: parseInt(cell(6)) || 0, remaining: parseInt(cell(7)) || 0, available: parseInt(cell(7)) > 0, selected: false, queue: "", group: cell(0), attr: "", xkTextNote: cell(11), courseFeature: cell(12), grade: cell(13), tongshiGroup: cell(18), gradCapacity: parseInt(cell(8)) || 0, gradRemaining: parseInt(cell(9)) || 0, volRequired: "", volElective: "", volOptional: "", volSports: "" });
  });
  return out;
}
function parseVolFromHtml(html: string): Record<string, any> {
  const map: Record<string, any> = {};
  const re = /\[\s*"(\d+)"\s*,\s*"([^"]*?)"\s*,\s*"[^"]*?"\s*,\s*"[^"]*?"\s*,\s*"(\d*)"\s*,\s*"(\d*)"\s*,\s*"(.*?)"\s*,\s*"(.*?)"\s*,\s*"(.*?)"\s*\]/g;
  let m; while ((m = re.exec(html)) !== null) { const key = m[1] + "_" + m[2]; map[key] = { code: m[1], seq: m[2], capacity: parseInt(m[3]) || 0, applied: parseInt(m[4]) || 0, volRequired: m[5], volElective: m[6], volOptional: m[7] }; }
  return map;
}
function parseVolSportsFromHtml(html: string): Record<string, any> {
  const map: Record<string, any> = {};
  const re = /\[\s*"(\d+)"\s*,\s*"([^"]*?)"\s*,\s*"[^"]*?"\s*,\s*"(\d*)"\s*,\s*"(\d*)"\s*,\s*"(.*?)"\s*\]/g;
  let m; while ((m = re.exec(html)) !== null) { const key = m[1] + "_" + m[2]; map[key] = { code: m[1], seq: m[2], capacity: parseInt(m[3]) || 0, applied: parseInt(m[4]) || 0, volSports: m[5] }; }
  return map;
}

async function fetchTrainingPlan(s: Session, sem: string) {
  const html = await fetchGbk(s, zhjwxkUrl(s, `/jhBks.vjhBksPyfakcbBs.do?m=showBksZxZdxjxjhXmxqkclist&p_xnxq=${sem}`));
  return parsePlan(cheerio.load(html));
}
// 并发翻页通用函数
async function fetchPaginated(s: Session, sem: string, path: string, parse: (html: string) => any[], batchSize = 10) {
  const all: any[] = [];
  // Page -1 first (index page, no page param)
  try {
    const html = await fetchGbk(s, zhjwxkUrl(s, `/${path}&p_xnxq=${sem}`));
    all.push(...parse(html));
  } catch { return all; }

  // Parallel batches
  for (let start = 1; start <= 200; start += batchSize) {
    const batch = await Promise.all(
      Array.from({ length: batchSize }, (_, i) => start + i).map(async p => {
        try {
          const html = await fetchGbk(s, zhjwxkUrl(s, `/${path}&p_xnxq=${sem}&page=${p}`));
          return parse(html);
        } catch { return []; }
      })
    );
    let total = 0;
    for (const items of batch) { all.push(...items); total += items.length; }
    if (total === 0) break; // empty batch → reached end
  }
  return all;
}

async function fetchCourseCatalog(s: Session, sem: string) {
  return fetchPaginated(s, sem, "xkBks.vxkBksJxjhBs.do?m=kkxxSearch", html => parseCatalog(cheerio.load(html)));
}

async function fetchVolunteer(s: Session, sem: string) {
  const allMap: Record<string, any> = {};
  // Regular volunteer
  try {
    const base = "xkBks.xkBksZytjb.do?m=tbzySearchBR";
    const firstHtml = await fetchGbk(s, zhjwxkUrl(s, `/${base}&p_xnxq=${sem}`));
    Object.assign(allMap, parseVolFromHtml(firstHtml));
    for (let start = 0; start <= 200; start += 10) {
      const batch = await Promise.all(
        Array.from({ length: 10 }, (_, i) => start + i).map(async p => {
          try {
            const html = await fetchGbk(s, zhjwxkUrl(s, `/${base}&p_xnxq=${sem}&page=${p}`));
            return parseVolFromHtml(html);
          } catch { return {}; }
        })
      );
      let total = 0;
      for (const items of batch) { Object.assign(allMap, items); total += Object.keys(items).length; }
      if (total === 0) break;
    }
  } catch { /* ignore */ }

  // Sports volunteer
  try {
    const sportsBase = "xkBks.xkBksZytjb.do?m=tbzySearchTy";
    const firstSports = await fetchGbk(s, zhjwxkUrl(s, `/${sportsBase}&p_xnxq=${sem}`));
    const sportsMap: Record<string, any> = {};
    Object.assign(sportsMap, parseVolSportsFromHtml(firstSports));
    for (let start = 1; start <= 20; start += 10) {
      const batch = await Promise.all(
        Array.from({ length: 10 }, (_, i) => start + i).map(async p => {
          try {
            const html = await fetchGbk(s, zhjwxkUrl(s, `/${sportsBase}&p_xnxq=${sem}&page=${p}`));
            return parseVolSportsFromHtml(html);
          } catch { return {}; }
        })
      );
      let total = 0;
      for (const items of batch) { Object.assign(sportsMap, items); total += Object.keys(items).length; }
      if (total === 0) break;
    }
    for (const [key, val] of Object.entries(sportsMap)) { if (allMap[key]) Object.assign(allMap[key], val); else allMap[key] = val; }
  } catch { /* ignore */ }
  return allMap;
}
async function fetchSelectedCourses(s: Session, sem: string) {
  const html = await fetchGbk(s, zhjwxkUrl(s, `/xkBks.vxkBksXkbBs.do?m=yxSearchTab&p_xnxq=${sem}&tokenPriFlag=yx&_t=${Date.now()}`));
  const doc = cheerio.load(html);
  const zyMap: Record<string, any> = {};
  const zyRe = /\[\s*"(\d+),(\d+)"\s*,\s*"(\d+)"\s*,\s*"(\d+)"\s*,\s*"([^"]*)"\s*,\s*"[^"]*"\s*\]/g;
  let zm; while ((zm = zyRe.exec(html)) !== null) {
    const typeLabel = zm[5] === "是" ? "体育" : ({ "006": "必修", "008": "限选", "007": "任选" }[zm[4]] || "");
    zyMap[zm[1] + "_" + zm[2]] = { zy: parseInt(zm[3]), typeCode: zm[4], typeLabel };
  }
  console.log(`  [selected] zyMap entries: ${Object.keys(zyMap).length}`);
  const selected: any[] = [];
  let skipped = 0;
  doc("tr.trr2").each((_, row) => {
    const radio = doc(row).find('input[name="p_del_id"]'); const val = radio.attr("value") || "";
    const parts = val.split(";"); const code = parts[1] || "", seq = parts[2] || "";
    if (!code) { skipped++; return; }
    const tds = doc(row).find("td"); const cell = (i: number) => (tds.eq(i)?.text() || "").trim().replace(/\s+/g, " ");
    const zyInfo = zyMap[code + "_" + seq] || {};
    const cell2 = cell(2) || ""; const zyFromCell = cell2.match(/第([一二三])志愿/);
    const isSportsCourse = !cell(1) && zyFromCell;
    const zyNum = zyInfo.zy || (zyFromCell ? ({ "一": 1, "二": 2, "三": 3 }[zyFromCell[1]]) : 0);
    const typeLabel = isSportsCourse ? "体育" : (cell(1) || zyInfo.typeLabel || "");
    selected.push({ code, seq, name: cell(3) || cell(1), teacher: cell(7) || cell(2), time: cell(6) || cell(3), credits: parseFloat(cell(8) || cell(4)) || 0, typeLabel, zy: zyNum, typeCode: isSportsCourse ? "ty" : (zyInfo.typeCode || "") });
  });
  console.log(`  [selected] rows parsed: ${selected.length}, skipped (no p_del_id): ${skipped}, codes: ${selected.map(c => c.code + '_' + c.seq).join(', ')}`);
  return selected;
}
async function fetchQueueData(s: Session, sem: string) {
  const map: Record<string, any> = {};
  const firstHtml = await fetchGbk(s, zhjwxkUrl(s, `/xkBks.vxkBksXkbBs.do?m=xkqkSearch&p_xnxq=${sem}`));
  if (!firstHtml.includes("gridData") || firstHtml.includes("accessDenied")) return { map: {}, phase: false };
  const gridRe = /\[\s*"(\d+)"\s*,\s*"([^"]*?)"\s*,\s*"[^"]*?"\s*,\s*"(\d*)"\s*,\s*"(\d*)"\s*,\s*"[^"]*?"\s*,\s*"[^"]*?"\s*\]/g;
  let gm; while ((gm = gridRe.exec(firstHtml)) !== null) { map[gm[1] + "_" + gm[2]] = { code: gm[1], seq: gm[2], qCapacity: parseInt(gm[3]) || 0, qRemaining: parseInt(gm[4]) || 0, qQueue: 0 }; }
  const tokenMatch = /name="token"\s+value="([^"]+)"/.exec(firstHtml);
  const token = tokenMatch ? tokenMatch[1] : "";
  if (token) {
    for (let start = 0; start <= 200; start += 10) {
      const batch = await Promise.all(
        Array.from({ length: 10 }, (_, i) => start + i).map(async p => {
          const form = new URLSearchParams({ m: "kylSearch", page: String(p), token, "p_sort.p1": "", "p_sort.p2": "", "p_sort.asc1": "", "p_sort.asc2": "", p_xnxq: sem, pathContent: "" });
          try {
            const html = await postFormGbk(s, zhjwxkUrl(s, "/xkBks.vxkBksJxjhBs.do"), Object.fromEntries(form.entries()));
            if (!html.includes("gridData")) return [];
            const pgRe = /\[\s*"(\d+)"\s*,\s*"([^"]*?)"\s*,\s*"[^"]*?"\s*,\s*"(\d*)"\s*,\s*"(\d*)"\s*,\s*"[^"]*?"\s*,\s*"[^"]*?"\s*\]/g;
            const items: any[] = []; let pm;
            while ((pm = pgRe.exec(html)) !== null) items.push({ k: pm[1] + "_" + pm[2], code: pm[1], seq: pm[2], qCapacity: parseInt(pm[3]) || 0, qRemaining: parseInt(pm[4]) || 0, qQueue: 0 });
            return items;
          } catch { return []; }
        })
      );
      let total = 0;
      for (const items of batch) { for (const it of items) { if (!map[it.k]) map[it.k] = { code: it.code, seq: it.seq, qCapacity: it.qCapacity, qRemaining: it.qRemaining, qQueue: 0 }; total++; } }
      if (total === 0) break;
    }
  }
  const parts = Object.values(map).map((q: any) => sem + "_" + q.code + "_" + q.seq);
  for (let i = 0; i < parts.length; i += 500) {
    const batch = parts.slice(i, i + 500);
    const subBatches: string[][] = [];
    for (let j = 0; j < batch.length; j += 100) subBatches.push(batch.slice(j, j + 100));
    await Promise.all(subBatches.map(async sub => {
      try {
        const qHtml = await fetchGbk(s, zhjwxkUrl(s, `/xkBks.vxkBksXkbBs.do?m=selectBksDlCount&kc_message=${encodeURIComponent(sub.join(";"))}`));
        const qData = JSON.parse(qHtml);
        if (Array.isArray(qData)) qData.forEach((obj: any) => { const k = obj.kch + "_" + obj.kxh; if (map[k]) map[k].qQueue = parseInt(obj.dlrs) || 0; });
      } catch { /* ignore */ }
    }));
  }
  return { map, phase: !!Object.keys(map).length };
}
async function fetchCandidateCourses(s: Session, sem: string) {
  const html = await fetchGbk(s, zhjwxkUrl(s, `/xkBks.vxkBksXkbBs.do?m=dlSearch&p_xnxq=${sem}`));
  if (html.includes("accessDenied") || !html.includes("trr2")) return [];
  const doc = cheerio.load(html); const candidates: any[] = [];
  doc("tr.trr2").each((_, row) => {
    const tds = doc(row).find("td"); if (tds.length < 9) return;
    const cell = (i: number) => (tds.eq(i)?.text() || "").trim().replace(/\s+/g, " ");
    const typeLabel = cell(0), zyStr = cell(1), code = cell(2), name = cell(3), seq = cell(4);
    const queueTotal = parseInt(cell(5)) || 0, myPos = parseInt(cell(6)) || 0;
    const zyNum = zyStr.match(/第([一二三])志愿/);
    const typeCode = typeLabel === "必修" ? "006" : typeLabel === "限选" ? "008" : "007";
    candidates.push({ code, seq: seq || "0", name, teacher: cell(8), time: cell(7), credits: 0, typeLabel, typeCode, zy: zyNum ? ({ "一": 1, "二": 2, "三": 3 }[zyNum[1]] || 3) : 3, queueTotal, myPos, isCandidate: true, selected: false });
  });
  return candidates;
}
async function fetchCourseDetail(s: Session, teacherId: string, code: string) {
  const html = await fetchGbk(s, zhjwxkUrl(s, `/js.vjsKcbBs.do?m=showToXs&p_id=${encodeURIComponent(teacherId + ";" + code)}`));
  const doc = cheerio.load(html);
  const table = doc("form table table.table-striped").first() || doc("table.table-striped").first();
  if (!table.length) return null;
  const fields: Record<string, string> = {};
  const skip = new Set(["课程名", "课程号"]);
  table.find("tr").each((_, tr) => {
    const tds = doc(tr).find("td"); if (tds.length < 2) return;
    const parse = (td: cheerio.Element) => doc(td).text().trim().replace(/：/g, "");
    const l1 = parse(tds.get(0)!), v1 = parse(tds.get(1)!);
    if (l1 && v1 && l1.length < 20 && !/^\d+$/.test(l1) && !skip.has(l1)) fields[l1] = v1;
    if (tds.length >= 4) { const l2 = parse(tds.get(2)!), v2 = parse(tds.get(3)!); if (l2 && v2 && l2.length < 20 && !/^\d+$/.test(l2) && !skip.has(l2)) fields[l2] = v2; }
  });
  return fields;
}
async function fetchLevelTable(s: Session, sem: string) {
  const html = await fetchGbk(s, zhjwxkUrl(s, `/xkBks.vxkBksXkbBs.do?p_xnxq=${sem}&pathContent=${encodeURIComponent("一级课表")}`));
  const doc = cheerio.load(html); const map: Record<string, any> = {};
  doc("tr.trr2").each((_, row) => {
    const cells: string[] = []; doc(row).find("td").each((_, td) => { cells.push(doc(td).text().trim().replace(/\s+/g, " ")); });
    let code = "", seq = "", attr = "";
    for (let i = 0; i < cells.length; i++) { if (/^\d{8}$/.test(cells[i]) && !code) { code = cells[i]; seq = cells[i + 1] || "0"; attr = cells[i + 2] || ""; if (!/^(必修|限选|任选)$/.test(attr)) attr = ""; } }
    if (!code) return;
    const isSports = !attr; const typeLabel = isSports ? "体育" : attr;
    const typeCode = isSports ? "ty" : attr === "必修" ? "006" : attr === "限选" ? "008" : attr === "任选" ? "007" : "";
    map[code + "_" + seq] = { typeCode, typeLabel, attr };
  });
  return map;
}

// Submit / Drop / Change ZY
async function submitCourseApi(s: Session, sem: string, code: string, seq: string, zy: number, flag: string) {
  const mSearch = ({ bx: "bxSearch", xx: "xxSearch", rx: "rxSearch", ty: "tySearch" } as any)[flag] || "bxSearch";
  const mVal = ({ bx: "saveBxKc", xx: "saveXxKc", rx: "saveRxKc", ty: "saveTyKc" } as any)[flag] || "saveBxKc";
  const extra = flag === "rx" ? "&is_zyrxk=1" : "";
  const searchHtml = await fetchGbk(s, zhjwxkUrl(s, `/xkBks.vxkBksXkbBs.do?m=${mSearch}&p_xnxq=${sem}&tokenPriFlag=${flag}${extra}`));
  const tokenMatch = searchHtml.match(/name="token"\s+value="([^"]+)"/);
  if (!tokenMatch) return { ok: false, msg: "无法获取 token" };
  const idName = ({ bx: "p_bxk_id", xx: "p_xxk_id", rx: "p_rx_id", ty: "p_rxTy_id" } as any)[flag];
  const zyName = ({ bx: "p_bxk_xkzy", xx: "p_xxk_xkzy", rx: "p_rx_xkzy", ty: "p_rxTy_xkzy" } as any)[flag];
  const fields: Record<string, string> = { m: mVal, p_xnxq: sem, tokenPriFlag: flag, page: "", token: tokenMatch[1] };
  fields[idName] = sem + ";" + code + ";" + seq + ";"; fields[zyName] = String(zy);
  if (flag === "rx") { fields.is_zyrxk = "1"; fields.p_rxklxm = ""; }
  if (flag === "ty") { fields.rxTyType = ""; }
  const respHtml = await postFormGbk(s, zhjwxkUrl(s, "/xkBks.vxkBksXkbBs.do"), fields);
  if (respHtml.includes("accessDenied")) return { ok: false, msg: "操作被拒绝" };
  if (respHtml.includes("加入队列成功")) return { ok: true, msg: "已加入候补队列" };
  if (respHtml.includes("选课成功")) return { ok: true, msg: "选课成功" };
  if (respHtml.includes("是否排队") && respHtml.includes("saveBksKcDl")) {
    await new Promise(r => setTimeout(r, 1500));
    const newToken = respHtml.match(/name="token"\s+value="([^"]+)"/);
    const queueFields = { ...fields, m: "saveBksKcDl" };
    if (newToken) queueFields.token = newToken[1];
    const qHtml = await postFormGbk(s, zhjwxkUrl(s, "/xkBks.vxkBksXkbBs.do"), queueFields);
    if (qHtml.includes("加入队列成功")) return { ok: true, msg: "已加入候补队列" };
    if (qHtml.includes("选课成功")) return { ok: true, msg: "选课成功" };
  }
  return { ok: true, msg: "已提交" };
}
async function dropCourseApi(s: Session, sem: string, code: string, seq: string, isQueue: boolean) {
  if (isQueue) {
    const searchHtml = await fetchGbk(s, zhjwxkUrl(s, `/xkBks.vxkBksXkbBs.do?m=dlSearchTab&p_xnxq=${sem}`));
    const tokenMatch = searchHtml.match(/name="token"\s+value="([^"]+)"/);
    if (!tokenMatch) return { ok: false, msg: "无法获取 token" };
    const respHtml = await postFormGbk(s, zhjwxkUrl(s, "/xkBks.vxkBksXkbBs.do"), { m: "dlDelete", p_xnxq: sem, page: "", token: tokenMatch[1], "p_del_id": sem + ";" + code + ";" + seq + ";" });
    if (respHtml.includes("accessDenied")) return { ok: false, msg: "操作被拒绝" };
    return { ok: true, msg: "已退出候补队列" };
  }
  const searchHtml = await fetchGbk(s, zhjwxkUrl(s, `/xkBks.vxkBksXkbBs.do?m=yxSearchTab&p_xnxq=${sem}&tokenPriFlag=yx`));
  const tokenMatch = searchHtml.match(/name="token"\s+value="([^"]+)"/);
  if (!tokenMatch) return { ok: false, msg: "无法获取 token" };
  const respHtml = await postFormGbk(s, zhjwxkUrl(s, "/xkBks.vxkBksXkbBs.do"), { m: "deleteYxk", p_xnxq: sem, page: "", token: tokenMatch[1], tokenPriFlag: "yx", tk: "", jhzy_kch: "", jhzy_kxh: "", jhzy_zy: "", "p_del_id": sem + ";" + code + ";" + seq + ";" });
  if (respHtml.includes("accessDenied")) return { ok: false, msg: "操作被拒绝" };
  return { ok: true, msg: "退选成功" };
}
async function changeVolunteerApi(s: Session, sem: string, code: string, seq: string, targetZy: number) {
  const searchHtml = await fetchGbk(s, zhjwxkUrl(s, `/xkBks.vxkBksXkbBs.do?m=yxSearchTab&p_xnxq=${sem}&tokenPriFlag=yx`));
  const tokenMatch = searchHtml.match(/name="token"\s+value="([^"]+)"/);
  if (!tokenMatch) return { ok: false, msg: "无法获取 token" };
  await postFormGbk(s, zhjwxkUrl(s, "/xkBks.vxkBksXkbBs.do"), { m: "changeZY", p_xnxq: sem, tokenPriFlag: "yx", page: "", token: tokenMatch[1], tk: "", jhzy_kch: code, jhzy_kxh: seq, jhzy_zy: String(targetZy) });
  return { ok: true, msg: "志愿已调整为第" + targetZy + "志愿" };
}

// ═══════════════ Proxy ═══════════════
const INJECT_SCRIPT = `<script data-thu-proxy="1">(function(){var Z='http://zhjwxk.cic.tsinghua.edu.cn',ZS='https://zhjwxk.cic.tsinghua.edu.cn';function rw(u){if(typeof u!=='string')return u;if(u.indexOf(ZS)===0)return u.replace(ZS,'');if(u.indexOf(Z)===0)return u.replace(Z,'');return u}var oO=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u){return oO.apply(this,[m,rw(u),arguments[2],arguments[3],arguments[4]])};var oF=window.fetch;window.fetch=function(u,o){if(typeof u==='string')u=rw(u);else if(u instanceof Request)u=new Request(rw(u.url),u);return oF.call(this,u,o)};document.addEventListener('click',function(e){var a=e.target.closest('a');if(a&&a.href){var nh=rw(a.href);if(nh!==a.href){e.preventDefault();window.location.href=nh}}},true)})();</script>`;

async function proxyRequest(s: Session, reqPath: string, req: http.IncomingMessage, res: http.ServerResponse) {
  const targetUrl = zhjwxkUrl(s, `${reqPath}${url.parse(req.url || "").search || ""}`);
  console.log(`  [proxy] ${req.method} ${reqPath}`);
  const headers: Record<string, string> = { "User-Agent": UA, Cookie: ch(s), "Accept": req.headers.accept || "*/*", "Accept-Language": req.headers["accept-language"] || "zh-CN,zh;q=0.9", "Accept-Encoding": "identity", "Referer": zhjwxkUrl(s, reqPath) };
  if (req.headers["content-type"]) headers["Content-Type"] = req.headers["content-type"] as string;
  try {
    const body = await new Promise<Buffer>((resolve) => { const chunks: Buffer[] = []; req.on("data", (c: Buffer) => chunks.push(c)); req.on("end", () => resolve(Buffer.concat(chunks))); });
    const r = await fetch(targetUrl, { method: req.method || "GET", headers, body: body.length > 0 ? body : undefined, redirect: "manual" } as RequestInit);
    saveCookies(s, r);
    if (r.status === 301 || r.status === 302 || r.status === 307 || r.status === 308) {
      const loc = r.headers.get("Location") || ""; let rp = loc;
      if (loc.includes("zhjwxk.cic.tsinghua.edu.cn")) rp = loc.replace(/^https?:\/\/zhjwxk\.cic\.tsinghua\.edu\.cn/, "");
      else if (loc.startsWith("http")) { res.writeHead(302, { Location: loc }); res.end(); return; }
      res.writeHead(302, { Location: rp }); res.end(); return;
    }
    const buf = Buffer.from(await r.arrayBuffer()); const upstreamCT = r.headers.get("content-type") || "";
    if (upstreamCT.includes("text/html")) {
      let html = iconv.decode(buf, "gbk").replace(/https?:\/\/zhjwxk\.cic\.tsinghua\.edu\.cn/g, "");
      const hi = html.indexOf("<head"); if (hi >= 0) { const ci = html.indexOf(">", hi); html = html.substring(0, ci + 1) + INJECT_SCRIPT + html.substring(ci + 1); }
      else html = INJECT_SCRIPT + html;
      res.writeHead(r.status, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" }); res.end(Buffer.from(html, "utf-8")); return;
    }
    res.writeHead(r.status, { "Content-Type": upstreamCT || "application/octet-stream", "Cache-Control": "public, max-age=3600" }); res.end(buf);
  } catch (e: any) { res.writeHead(502, { "Content-Type": "text/plain" }); res.end("Proxy error: " + e.message); }
}

// ═══════════════ HTTP Server ═══════════════
const LOGIN_HTML = fs.readFileSync(path.join(__dirname, "public", "login.html"), "utf-8");
const APP_HTML = fs.readFileSync(path.join(__dirname, "public", "app.html"), "utf-8");

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise(resolve => { let b = ""; req.on("data", (c: Buffer) => b += c); req.on("end", () => resolve(b)); });
}
function json(res: http.ServerResponse, s: Session, data: any, status = 200) {
  if (s._dirty) saveState(res, s);
  res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url || "/", true);
  const pathname = parsed.pathname || "/";
  res.setHeader("Access-Control-Allow-Origin", "*"); res.setHeader("Access-Control-Allow-Headers", "*"); res.setHeader("Access-Control-Allow-Methods", "*");
  if (req.method === "OPTIONS") { res.writeHead(200); res.end(); return; }

  const s = getSession(req);

  if (pathname === "/health") { res.writeHead(200, { "Content-Type": "text/plain" }); res.end("OK"); return; }

  // Pages
  if (pathname === "/" || pathname === "/login") {
    if (s.loginState === "done") { res.writeHead(302, { Location: "/app" }); res.end(); return; }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); res.end(LOGIN_HTML); return;
  }
  if (pathname === "/app") { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); res.end(APP_HTML); return; }

  // Auth API
  if (pathname === "/api/login" && req.method === "POST") { const b = JSON.parse(await readBody(req)); await doLogin(s, b.userId, b.password); json(res, s, { ok: true }); return; }
  if (pathname === "/api/2fa" && req.method === "POST") { const b = JSON.parse(await readBody(req)); await continue2FA(s, b.methodIdx, b.code); json(res, s, { ok: true }); return; }
  if (pathname === "/api/status") { json(res, s, { state: s.loginState, error: s.loginError, progress: s.loginProgress, need2fa: s.loginState === "need_2fa", methods: s.pending2FA?.methods || [] }); return; }
  if (pathname === "/api/logout" && req.method === "POST") {
    memoryCaches.delete(s.id);
    res.setHeader("Set-Cookie", `${COOKIE_NAME}=; Path=/; Max-Age=0`);
    json(res, s, { ok: true }); return;
  }

  // Data API
  if (pathname.startsWith("/api/")) {
    if (s.loginState !== "done") { json(res, s, { error: "请先登录" }, 401); return; }
    const sem = (parsed.query.sem || "") as string;
    try {
      if (pathname === "/api/init") {
        const forceRefresh = parsed.query.refresh === "1";
        let plan: any[], catalog: any[], volData: Record<string, any>;
        let selected: any[], candidates: any[];
        let qResult: any;
        const cached = memoryCaches.get(s.id);
        if (!forceRefresh && cached && cached.sem === sem && cached.catalog.length > 0) {
          console.log(`  [init] 内存缓存命中 (catalog=${cached.catalog.length})，仅拉取用户数据...`);
          plan = cached.plan; catalog = cached.catalog; volData = cached.volunteer;
          [selected, qResult, candidates] = await Promise.all([
            fetchSelectedCourses(s, sem).catch(e => { console.log(`  [init] selected FAIL: ${e.message}`); return []; }),
            fetchQueueData(s, sem).catch(e => { console.log(`  [init] queue FAIL: ${e.message}`); return { map: {}, phase: false }; }),
            fetchCandidateCourses(s, sem).catch(e => { console.log(`  [init] candidates FAIL: ${e.message}`); return []; }),
          ]);
        } else {
          console.log(`  [init] 拉取全部数据 (6路并发)...`);
          const results = await Promise.all([
            fetchTrainingPlan(s, sem).catch(e => { console.log(`  [init] plan FAIL: ${e.message}`); return []; }),
            fetchCourseCatalog(s, sem).catch(e => { console.log(`  [init] catalog FAIL: ${e.message}`); return []; }),
            fetchVolunteer(s, sem).catch(e => { console.log(`  [init] volunteer FAIL: ${e.message}`); return {}; }),
            fetchSelectedCourses(s, sem).catch(e => { console.log(`  [init] selected FAIL: ${e.message}`); return []; }),
            fetchQueueData(s, sem).catch(e => { console.log(`  [init] queue FAIL: ${e.message}`); return { map: {}, phase: false }; }),
            fetchCandidateCourses(s, sem).catch(e => { console.log(`  [init] candidates FAIL: ${e.message}`); return []; }),
          ]);
          [plan, catalog, volData] = [results[0], results[1], results[2]] as any;
          selected = results[3] as any[];
          qResult = results[4] as any;
          candidates = results[5] as any[];
          memoryCaches.set(s.id, { sem, plan, catalog, volunteer: volData, ts: Date.now() });
        }
        console.log(`  [init] plan=${plan.length} catalog=${catalog.length} volData=${Object.keys(volData).length} selected=${selected.length} queue=${Object.keys(qResult.map).length} candidates=${candidates.length}`);
        json(res, s, { plan, catalog, volunteer: volData, selected, queueMap: qResult.map, queuePhase: qResult.phase, candidates }); return;
      }
      if (pathname === "/api/plan") { json(res, s, await fetchTrainingPlan(s, sem)); return; }
      if (pathname === "/api/courses") { const c = memoryCaches.get(s.id); json(res, s, c && c.sem === sem ? c.catalog : await fetchCourseCatalog(s, sem)); return; }
      if (pathname === "/api/volunteer") { const c = memoryCaches.get(s.id); json(res, s, c && c.sem === sem ? c.volunteer : await fetchVolunteer(s, sem)); return; }
      if (pathname === "/api/selected") { json(res, s, await fetchSelectedCourses(s, sem)); return; }
      if (pathname === "/api/queue") { json(res, s, await fetchQueueData(s, sem)); return; }
      if (pathname === "/api/candidates") { json(res, s, await fetchCandidateCourses(s, sem)); return; }
      if (pathname === "/api/levelTable") { json(res, s, await fetchLevelTable(s, sem)); return; }
      if (pathname === "/api/detail") { json(res, s, await fetchCourseDetail(s, parsed.query.teacherId as string, parsed.query.code as string)); return; }
      if (pathname === "/api/submit" && req.method === "POST") { const b = JSON.parse(await readBody(req)); json(res, s, await submitCourseApi(s, sem, b.code, b.seq, b.zy, b.flag)); return; }
      if (pathname === "/api/drop" && req.method === "POST") { const b = JSON.parse(await readBody(req)); json(res, s, await dropCourseApi(s, sem, b.code, b.seq, b.isQueue)); return; }
      if (pathname === "/api/changeZy" && req.method === "POST") { const b = JSON.parse(await readBody(req)); json(res, s, await changeVolunteerApi(s, sem, b.code, b.seq, b.zy)); return; }
      json(res, s, { error: "Unknown API" }, 404); return;
    } catch (e: any) { json(res, s, { error: e.message }, 500); return; }
  }

  // Static files
  if (pathname.match(/\.(css|js|png|jpg|svg|ico|woff2?|ttf|json|txt|map)$/)) {
    const filePath = path.join(__dirname, "public", pathname);
    try {
      const content = fs.readFileSync(filePath);
      const mime: Record<string, string> = { css: "text/css", js: "application/javascript", png: "image/png", jpg: "image/jpeg", svg: "image/svg+xml", ico: "image/x-icon", woff2: "font/woff2", woff: "font/woff", ttf: "font/ttf", json: "application/json", txt: "text/plain", map: "application/json" };
      const ext = (pathname.split(".").pop() || "").toLowerCase();
      res.writeHead(200, { "Content-Type": mime[ext] || "application/octet-stream", "Cache-Control": "public, max-age=3600" });
      res.end(content); return;
    } catch { res.writeHead(404); res.end("Not found"); return; }
  }

  // Proxy (require login)
  if (s.loginState !== "done") { res.writeHead(302, { Location: "/" }); res.end(); return; }
  proxyRequest(s, pathname, req, res);
});

const PORT = parseInt(process.env.PORT || "3456", 10);
server.listen(PORT, "0.0.0.0", () => {
  console.log(`\n🚀 NextTHUxk Server 已启动\n   端口: ${PORT}\n`);
});
