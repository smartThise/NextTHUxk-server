/**
 * NextTHUxk 本地独立版服务器
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

// ═══════════════ Cookie jar ═══════════════
const cookies: Record<string, string> = {};
function ch() { return Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; "); }
function saveCookies(r: Response) {
    const raw = (r.headers as any).raw?.();
    if (raw?.["set-cookie"]) for (const c of raw["set-cookie"]) {
        const [seg] = c.split(";"); const eq = seg.indexOf("=");
        if (eq > 0) cookies[seg.substring(0, eq).trim()] = seg.substring(eq + 1).trim();
    }
}

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const FINGER = "thu-local-proxy-v1";
const ZHJWXK = "https://zhjwxk.cic.tsinghua.edu.cn";

let webvpnZhjwxkBase = "";
function zhjwxkUrl(p: string): string {
    return webvpnZhjwxkBase ? webvpnZhjwxkBase + p : ZHJWXK + p;
}
const ID_LOGIN = "https://id.tsinghua.edu.cn/do/off/ui/auth/login/check";
const DOUBLE_AUTH = "https://id.tsinghua.edu.cn/b/doubleAuth/login";
const SAVE_FINGER = "https://id.tsinghua.edu.cn/b/doubleAuth/personal/saveFinger";

// ═══════════════ HTTP helpers ═══════════════
async function fetchAuto(urlStr: string): Promise<string> {
    const r = await fetch(urlStr, { headers: { "User-Agent": UA, Cookie: ch() } });
    saveCookies(r);
    if (r.status !== 200 && r.status !== 201) throw new Error(`GET ${urlStr} → ${r.status}`);
    return decodeBody(r, urlStr);
}
async function postForm(urlStr: string, form: Record<string, string>): Promise<string> {
    const body = Object.entries(form).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
    const r = await fetch(urlStr, { method: "POST", headers: { "User-Agent": UA, Cookie: ch(), "Content-Type": "application/x-www-form-urlencoded" }, body });
    saveCookies(r);
    if (r.status !== 200 && r.status !== 201) throw new Error(`POST ${urlStr} → ${r.status}`);
    return decodeBody(r, urlStr);
}
async function decodeBody(r: Response, urlHint?: string): Promise<string> {
    const buf = Buffer.from(await r.arrayBuffer());
    const ct = (r.headers.get("content-type") || "").toLowerCase();
    // 1) HTTP header charset
    if (ct.includes("gbk") || ct.includes("gb2312")) return iconv.decode(buf, "gbk");
    // 2) Check meta tag in HTML
    const rawStr = buf.toString("utf-8");
    if (rawStr.includes("charset=GBK") || rawStr.includes("charset=gb2312") || rawStr.includes('charset="GBK"')) {
        return iconv.decode(buf, "gbk");
    }
    // 3) URL-based fallback: zhjwxk pages are always GBK
    if (urlHint && /zhjw|xkBks|jhBks|vjsKcbBs/.test(urlHint)) {
        return iconv.decode(buf, "gbk");
    }
    return rawStr;
}
async function followChain(urlStr: string, maxHops = 15): Promise<{ finalUrl: string; html: string }> {
    let cur = urlStr, html = "";
    for (let i = 0; i < maxHops; i++) {
        console.log(`  [followChain] hop=${i} url=${cur}`);
        const r = await fetch(cur, { headers: { "User-Agent": UA, Cookie: ch() }, redirect: "manual" } as RequestInit);
        saveCookies(r);
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
// zhjwxk 页面全部 GBK
async function fetchGbk(urlStr: string, label?: string): Promise<string> {
    console.log(`  [fetchGbk] ${label || urlStr.substring(0, 80)}`);
    const r = await fetch(urlStr, { headers: { "User-Agent": UA, Cookie: ch() } });
    saveCookies(r);
    console.log(`  [fetchGbk] status=${r.status} len=${(await r.clone().arrayBuffer()).byteLength}`);
    return iconv.decode(Buffer.from(await r.arrayBuffer()), "gbk");
}
async function postFormGbk(urlStr: string, form: Record<string, string>, label?: string): Promise<string> {
    console.log(`  [postFormGbk] ${label || urlStr.substring(0, 80)}`);
    const body = Object.entries(form).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
    const r = await fetch(urlStr, { method: "POST", headers: { "User-Agent": UA, Cookie: ch(), "Content-Type": "application/x-www-form-urlencoded" }, body });
    saveCookies(r);
    console.log(`  [postFormGbk] status=${r.status} len=${(await r.clone().arrayBuffer()).byteLength}`);
    return iconv.decode(Buffer.from(await r.arrayBuffer()), "gbk");
}

// ═══════════════ Login ═══════════════
let loginState: "idle" | "logging_in" | "need_2fa" | "done" | "error" = "idle";
let loginError = "";
let loginProgress: string[] = [];
let pending2FA: { methods: string[]; methodKeys: string[] } | null = null;
let storedUserId = "";
let storedPassword = "";

function log(msg: string) { loginProgress.push(`[${new Date().toLocaleTimeString()}] ${msg}`); console.log("  " + msg); }

async function doLogin(userId: string, password: string) {
    loginState = "logging_in"; loginError = ""; loginProgress = []; pending2FA = null;
    storedUserId = userId; storedPassword = password;
    try {
        log("连接 webvpn...");
        const lpHtml = await fetchAuto("https://webvpn.tsinghua.edu.cn/login?oauth_login=true");
        const sm2Key1 = cheerio.load(lpHtml)("#sm2publicKey").text();
        if (!sm2Key1) throw new Error("无法获取 SM2 key");
        log("CAS 认证中...");
        const loginResp = await postForm(ID_LOGIN, { i_user: userId, i_pass: "04" + sm2.doEncrypt(password, sm2Key1), fingerPrint: FINGER, fingerGenPrint: "", i_captcha: "" });
        if (loginResp.includes("二次认证")) { await handle2FAResponse(); return; }
        await finishLogin(loginResp);
    } catch (e: any) { loginState = "error"; loginError = e.message; log(`错误: ${e.message}`); }
}
async function handle2FAResponse() {
    log("需要二次认证"); loginState = "need_2fa";
    const r1 = JSON.parse(await postForm(DOUBLE_AUTH, { action: "FIND_APPROACHES" }));
    const { hasWeChatBool, phone, hasTotp } = r1.object;
    const methods: string[] = [], methodKeys: string[] = [];
    if (hasWeChatBool) { methods.push("微信"); methodKeys.push("wechat"); }
    if (phone) { methods.push(`手机 (${phone})`); methodKeys.push("mobile"); }
    if (hasTotp) { methods.push("动态口令"); methodKeys.push("totp"); }
    pending2FA = { methods, methodKeys };
}
async function continue2FA(methodIdx: number, code: string) {
    if (!pending2FA) return;
    try {
        const method = pending2FA.methodKeys[methodIdx];
        await postForm(DOUBLE_AUTH, { action: "SEND_CODE", type: method }); log("验证码已发送");
        const r3 = JSON.parse(await postForm(DOUBLE_AUTH, { action: method === "totp" ? "VERITY_TOTP_CODE" : "VERITY_CODE", vericode: code }));
        if (r3.result !== "success") throw new Error("验证失败: " + r3.msg);
        log("2FA 通过");
        await postForm(SAVE_FINGER, { fingerprint: FINGER, deviceName: "THU-Local-Proxy", radioVal: "是" });
        const html = await fetchAuto("https://id.tsinghua.edu.cn" + r3.object.redirectUrl);
        pending2FA = null; await finishLogin(html);
    } catch (e: any) { loginState = "error"; loginError = e.message; log(`错误: ${e.message}`); }
}
async function finishLogin(loginResp: string) {
    if (!loginResp.includes("登录成功")) throw new Error("CAS 登录失败: " + cheerio.load(loginResp)("#msg_note").text().trim());
    log("CAS 登录成功");
    await followChain(cheerio.load(loginResp)("a").attr()!.href); log("Webvpn session 已建立");
    log("访问选课入口...");
    const xkUrl = zhjwxkUrl(`/xklogin.do`);
    const { finalUrl, html: xkHtml } = await followChain(xkUrl);
    log(`  DEBUG followChain result: finalUrl=${finalUrl}`);
    log(`  DEBUG xkHtml length=${xkHtml.length}, preview=${xkHtml.substring(0, 300)}`);
    const sm2Key2 = cheerio.load(xkHtml)("#sm2publicKey").text();
    log(`  DEBUG sm2Key2="${sm2Key2}"`);
    if (!sm2Key2) throw new Error(`无法获取选课系统 SM2 key (finalUrl=${finalUrl}, title="${cheerio.load(xkHtml)("title").text()}", hasLoginForm=${xkHtml.includes("login")})`);
    log("选课系统 CAS 认证...");
    let cr = await postForm(ID_LOGIN, { i_user: storedUserId, i_pass: "04" + sm2.doEncrypt(storedPassword, sm2Key2), fingerPrint: FINGER, fingerGenPrint: "", i_captcha: "" });
    if (cr.includes("二次认证")) { await handle2FAResponse(); return; }
    if (!cr.includes("登录成功")) throw new Error("选课系统 CAS 登录失败");
    log("✅ 选课系统登录成功!");
    const { finalUrl: loggedInUrl } = await followChain(cheerio.load(cr)("a").attr()!.href);
    const wvMatch = loggedInUrl.match(/^(https:\/\/webvpn\.tsinghua\.edu\.cn\/\w+\/[^/]+\/)/);
    if (wvMatch) { webvpnZhjwxkBase = wvMatch[1]; log("  WebVPN proxy base: " + webvpnZhjwxkBase); }
    log("选课会话已建立");
    loginState = "done";
}

// ═══════════════ zhjwxk Data API (server-side fetching & parsing) ═══════════════
function getSem(q: Record<string, string | string[] | undefined>): string { return (q.p_xnxq || q.sem || "") as string; }

// Parse training plan
function parsePlan(doc: cheerio.CheerioAPI): any[] {
    const out: any[] = []; let sem = "", season = "";
    doc("table#kcTable tr").each((_, row) => {
        const tds = doc(row).find("td");
        if (!tds.length) return;
        const cells: string[] = []; tds.each((_, td) => { cells.push(doc(td).text().trim().replace(/\s+/g, " ")); });
        for (const c of cells) { const sm = c.match(/(\d{4}-\d{4}学年)/); if (sm) sem = sm[1]; const sn = c.match(/^(秋|春|夏)$/); if (sn) season = sn[1]; }
        const code = cells.find(c => /^\d{8}$/.test(c));
        if (!code) return;
        const name = cells.find(c => c.length > 1 && !/^\d+$/.test(c) && !["必修", "限选", "任选", "秋", "春", "夏"].includes(c) && !c.includes("学年"));
        const attr = cells.find(c => ["必修", "限选", "任选"].includes(c));
        const credit = cells.find(c => /^\d{1,2}(\.\d)?$/.test(c) && c !== code);
        const group = cells.find(c => c.length > 2 && !["必修", "限选", "任选"].includes(c) && !/^\d/.test(c) && !c.includes("学年") && c !== name);
        if (name) out.push({ semester: sem + " " + season, code, name: name.replace(/\s+/g, ""), attr: attr || "", credits: parseFloat(credit!) || 0, group: group || "" });
    });
    return out;
}
function parseFullProgram(doc: cheerio.CheerioAPI): any[] {
    const out: any[] = []; let grp = "", attr = "";
    doc("#content_1 table tbody tr.trr2").each((_, row) => {
        const cells: string[] = []; doc(row).find("td").each((_, td) => { cells.push(doc(td).text().trim()); });
        if (cells.length >= 9) { grp = cells[0]; attr = cells[1] || attr; }
        const idx = cells.length >= 9 ? 2 : 0; const code = cells[idx], name = cells[idx + 1];
        if (code && name && /^\d+$/.test(code)) out.push({ code, name, credits: parseFloat(cells[idx + 2]) || 0, attr, group: grp, semester: "" });
    });
    return out;
}

// Parse course catalog
function parseCatalog(doc: cheerio.CheerioAPI): any[] {
    const out: any[] = [];
    doc("tr.trr2").each((_, row) => {
        const tds = doc(row).find("td"); if (tds.length < 11) return;
        const cell = (i: number) => (tds.eq(i)?.text() || "").trim().replace(/\s+/g, " ");
        const code = cell(1), name = cell(3);
        if (!code || !name || !/^\d+$/.test(code)) return;
        const teacherLink = tds.eq(5)?.find('a[href*="showJsDetail"]');
        const teacherHref = teacherLink?.attr("href") || "";
        const teacherId = /p_jsh=([^&]+)/.exec(teacherHref)?.[1] || "";
        const courseLink = tds.eq(3)?.find('a[href*="showToXs"]');
        const detailHref = courseLink?.attr("href") || "";
        out.push({ code, seq: cell(2), name, credits: parseFloat(cell(4)) || 0, teacher: cell(5), teacherId, department: cell(0), time: cell(10), capacity: parseInt(cell(6)) || 0, remaining: parseInt(cell(7)) || 0, available: parseInt(cell(7)) > 0, selected: false, queue: "", group: cell(0), attr: "", detailUrl: detailHref, xkTextNote: cell(11), courseFeature: cell(12), grade: cell(13), tongshiGroup: cell(18), gradCapacity: parseInt(cell(8)) || 0, gradRemaining: parseInt(cell(9)) || 0, volRequired: "", volElective: "", volOptional: "", volSports: "" });
    });
    return out;
}

// Parse volunteer data
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

// Fetch training plan
async function fetchTrainingPlan(sem: string) {
    const html = await fetchGbk(zhjwxkUrl(`/jhBks.vjhBksPyfakcbBs.do?m=showBksZxZdxjxjhXmxqkclist&p_xnxq=${sem}`));
    return parsePlan(cheerio.load(html));
}

// Fetch course catalog (paginated)
async function fetchCourseCatalog(sem: string) {
    const all: any[] = [];
    for (let p = -1; p <= 200; p++) {
        const u = p === -1 ? zhjwxkUrl(`/xkBks.vxkBksJxjhBs.do?m=kkxxSearch&p_xnxq=${sem}`) : zhjwxkUrl(`/xkBks.vxkBksJxjhBs.do?m=kkxxSearch&p_xnxq=${sem}&page=${p}`);
        try {
            const html = await fetchGbk(u);
            const batch = parseCatalog(cheerio.load(html));
            if (!batch.length && p >= 0) break; all.push(...batch);
        } catch (e) { break; }
    }
    return all;
}

// Fetch volunteer data (paginated)
async function fetchVolunteer(sem: string) {
    const allMap: Record<string, any> = {};
    for (let p = -1; p <= 200; p++) {
        const u = p === -1 ? zhjwxkUrl(`/xkBks.xkBksZytjb.do?m=tbzySearchBR&p_xnxq=${sem}`) : zhjwxkUrl(`/xkBks.xkBksZytjb.do?m=tbzySearchBR&p_xnxq=${sem}&page=${p}`);
        const html = await fetchGbk(u);
        const batch = parseVolFromHtml(html); if (!Object.keys(batch).length && p >= 0) break;
        Object.assign(allMap, batch);
    }
    // Sports volunteer
    try {
        const sportsMap: Record<string, any> = {};
        for (let p = -1; p <= 20; p++) {
            const u = p === -1 ? zhjwxkUrl(`/xkBks.xkBksZytjb.do?m=tbzySearchTy&p_xnxq=${sem}`) : zhjwxkUrl(`/xkBks.xkBksZytjb.do?m=tbzySearchTy&p_xnxq=${sem}&page=${p}`);
            const html = await fetchGbk(u);
            const batch = parseVolSportsFromHtml(html); if (!Object.keys(batch).length && p >= 0) break;
            Object.assign(sportsMap, batch);
        }
        for (const [key, val] of Object.entries(sportsMap)) { if (allMap[key]) Object.assign(allMap[key], val); else allMap[key] = val; }
    } catch { /* ignore */ }
    return allMap;
}

// Fetch selected courses
async function fetchSelectedCourses(sem: string) {
    const html = await fetchGbk(zhjwxkUrl(`/xkBks.vxkBksXkbBs.do?m=yxSearchTab&p_xnxq=${sem}&tokenPriFlag=yx&_t=${Date.now()}`));
    const doc = cheerio.load(html);
    // Parse zy map from JS data
    const zyMap: Record<string, any> = {};
    const zyRe = /\[\s*"(\d+),(\d+)"\s*,\s*"(\d+)"\s*,\s*"(\d+)"\s*,\s*"([^"]*)"\s*,\s*"[^"]*"\s*\]/g;
    let zm; while ((zm = zyRe.exec(html)) !== null) {
        const typeLabel = zm[5] === "是" ? "体育" : ({ "006": "必修", "008": "限选", "007": "任选" }[zm[4]] || "");
        zyMap[zm[1] + "_" + zm[2]] = { zy: parseInt(zm[3]), typeCode: zm[4], typeLabel };
    }
    const selected: any[] = [];
    doc("tr.trr2").each((_, row) => {
        const radio = doc(row).find('input[name="p_del_id"]'); const val = radio.attr("value") || "";
        const parts = val.split(";"); const code = parts[1] || "", seq = parts[2] || ""; if (!code) return;
        const tds = doc(row).find("td"); const cell = (i: number) => (tds.eq(i)?.text() || "").trim().replace(/\s+/g, " ");
        const zyInfo = zyMap[code + "_" + seq] || {};
        const cell2 = cell(2) || ""; const zyFromCell = cell2.match(/第([一二三])志愿/);
        const isSportsCourse = !cell(1) && zyFromCell;
        const zyNum = zyInfo.zy || (zyFromCell ? ({ "一": 1, "二": 2, "三": 3 }[zyFromCell[1]]) : 0);
        const typeLabel = isSportsCourse ? "体育" : (cell(1) || zyInfo.typeLabel || "");
        selected.push({ code, seq, name: cell(3) || cell(1), teacher: cell(7) || cell(2), time: cell(6) || cell(3), credits: parseFloat(cell(8) || cell(4)) || 0, typeLabel, zy: zyNum, typeCode: isSportsCourse ? "ty" : (zyInfo.typeCode || "") });
    });
    return selected;
}

// Fetch queue data
async function fetchQueueData(sem: string) {
    const map: Record<string, any> = {};
    const firstHtml = await fetchGbk(zhjwxkUrl(`/xkBks.vxkBksXkbBs.do?m=xkqkSearch&p_xnxq=${sem}`));
    if (!firstHtml.includes("gridData") || firstHtml.includes("accessDenied")) return { map: {}, phase: false };
    const gridRe = /\[\s*"(\d+)"\s*,\s*"([^"]*?)"\s*,\s*"[^"]*?"\s*,\s*"(\d*)"\s*,\s*"(\d*)"\s*,\s*"[^"]*?"\s*,\s*"[^"]*?"\s*\]/g;
    let gm; while ((gm = gridRe.exec(firstHtml)) !== null) { map[gm[1] + "_" + gm[2]] = { code: gm[1], seq: gm[2], qCapacity: parseInt(gm[3]) || 0, qRemaining: parseInt(gm[4]) || 0, qQueue: 0 }; }
    const tokenMatch = /name="token"\s+value="([^"]+)"/.exec(firstHtml);
    const token = tokenMatch ? tokenMatch[1] : "";
    if (token) {
        for (let p = 0; p <= 200; p++) {
            const form = new URLSearchParams({ m: "kylSearch", page: String(p), token, "p_sort.p1": "", "p_sort.p2": "", "p_sort.asc1": "", "p_sort.asc2": "", p_xnxq: sem, pathContent: "" });
            try {
                const html = await postFormGbk(zhjwxkUrl(`/xkBks.vxkBksJxjhBs.do`), Object.fromEntries(form.entries()));
                if (!html.includes("gridData")) break;
                const pgRe = /\[\s*"(\d+)"\s*,\s*"([^"]*?)"\s*,\s*"[^"]*?"\s*,\s*"(\d*)"\s*,\s*"(\d*)"\s*,\s*"[^"]*?"\s*,\s*"[^"]*?"\s*\]/g;
                let pm; let cnt = 0;
                while ((pm = pgRe.exec(html)) !== null) { const k = pm[1] + "_" + pm[2]; if (!map[k]) map[k] = { code: pm[1], seq: pm[2], qCapacity: parseInt(pm[3]) || 0, qRemaining: parseInt(pm[4]) || 0, qQueue: 0 }; cnt++; }
                if (!cnt) break;
            } catch { break; }
        }
    }
    // Real-time queue counts
    const parts = Object.values(map).map((q: any) => sem + "_" + q.code + "_" + q.seq);
    for (let i = 0; i < parts.length; i += 100) {
        try {
            const qHtml = await fetchGbk(zhjwxkUrl(`/xkBks.vxkBksXkbBs.do?m=selectBksDlCount&kc_message=${encodeURIComponent(parts.slice(i, i + 100).join(";"))}`));
            const qData = JSON.parse(qHtml);
            if (Array.isArray(qData)) qData.forEach((obj: any) => { const k = obj.kch + "_" + obj.kxh; if (map[k]) map[k].qQueue = parseInt(obj.dlrs) || 0; });
        } catch { /* ignore */ }
    }
    return { map, phase: !!Object.keys(map).length };
}

// Fetch candidate courses
async function fetchCandidateCourses(sem: string) {
    const html = await fetchGbk(zhjwxkUrl(`/xkBks.vxkBksXkbBs.do?m=dlSearch&p_xnxq=${sem}`));
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

// Fetch course detail
async function fetchCourseDetail(teacherId: string, code: string) {
    const html = await fetchGbk(zhjwxkUrl(`/js.vjsKcbBs.do?m=showToXs&p_id=${encodeURIComponent(teacherId + ";" + code)}`));
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

// Fetch level table
async function fetchLevelTable(sem: string) {
    const html = await fetchGbk(zhjwxkUrl(`/xkBks.vxkBksXkbBs.do?p_xnxq=${sem}&pathContent=${encodeURIComponent("一级课表")}`));
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

// Submit course selection (port of fetchFormSubmit + submitCourse)
async function submitCourseApi(sem: string, code: string, seq: string, zy: number, flag: string) {
    const mSearch = ({ bx: "bxSearch", xx: "xxSearch", rx: "rxSearch", ty: "tySearch" } as any)[flag] || "bxSearch";
    const mVal = ({ bx: "saveBxKc", xx: "saveXxKc", rx: "saveRxKc", ty: "saveTyKc" } as any)[flag] || "saveBxKc";
    const extra = flag === "rx" ? "&is_zyrxk=1" : "";
    const searchUrl = zhjwxkUrl(`/xkBks.vxkBksXkbBs.do?m=${mSearch}&p_xnxq=${sem}&tokenPriFlag=${flag}${extra}`);
    // 1) GET search page, extract token
    const searchHtml = await fetchGbk(searchUrl);
    const tokenMatch = searchHtml.match(/name="token"\s+value="([^"]+)"/);
    if (!tokenMatch) return { ok: false, msg: "无法获取 token" };
    const idName = ({ bx: "p_bxk_id", xx: "p_xxk_id", rx: "p_rx_id", ty: "p_rxTy_id" } as any)[flag];
    const zyName = ({ bx: "p_bxk_xkzy", xx: "p_xxk_xkzy", rx: "p_rx_xkzy", ty: "p_rxTy_xkzy" } as any)[flag];
    const fields: Record<string, string> = { m: mVal, p_xnxq: sem, tokenPriFlag: flag, page: "", token: tokenMatch[1] };
    fields[idName] = sem + ";" + code + ";" + seq + ";"; fields[zyName] = String(zy);
    if (flag === "rx") { fields.is_zyrxk = "1"; fields.p_rxklxm = ""; }
    if (flag === "ty") { fields.rxTyType = ""; }
    // 2) POST form
    const respHtml = await postFormGbk(zhjwxkUrl(`/xkBks.vxkBksXkbBs.do`), fields);
    if (respHtml.includes("accessDenied")) return { ok: false, msg: "操作被拒绝" };
    if (respHtml.includes("加入队列成功")) return { ok: true, msg: "已加入候补队列" };
    if (respHtml.includes("选课成功")) return { ok: true, msg: "选课成功" };
    // 3) Check if need to queue
    if (respHtml.includes("是否排队") && respHtml.includes("saveBksKcDl")) {
        await new Promise(r => setTimeout(r, 1500));
        const newToken = respHtml.match(/name="token"\s+value="([^"]+)"/);
        const queueFields = { ...fields, m: "saveBksKcDl" };
        if (newToken) queueFields.token = newToken[1];
        const qHtml = await postFormGbk(zhjwxkUrl(`/xkBks.vxkBksXkbBs.do`), queueFields);
        if (qHtml.includes("加入队列成功")) return { ok: true, msg: "已加入候补队列" };
        if (qHtml.includes("选课成功")) return { ok: true, msg: "选课成功" };
    }
    return { ok: true, msg: "已提交" };
}

// Drop course
async function dropCourseApi(sem: string, code: string, seq: string, isQueue: boolean) {
    if (isQueue) {
        const searchHtml = await fetchGbk(zhjwxkUrl(`/xkBks.vxkBksXkbBs.do?m=dlSearchTab&p_xnxq=${sem}`));
        const tokenMatch = searchHtml.match(/name="token"\s+value="([^"]+)"/);
        if (!tokenMatch) return { ok: false, msg: "无法获取 token" };
        const respHtml = await postFormGbk(zhjwxkUrl(`/xkBks.vxkBksXkbBs.do`), { m: "dlDelete", p_xnxq: sem, page: "", token: tokenMatch[1], "p_del_id": sem + ";" + code + ";" + seq + ";" });
        if (respHtml.includes("accessDenied")) return { ok: false, msg: "操作被拒绝" };
        return { ok: true, msg: "已退出候补队列" };
    }
    const searchHtml = await fetchGbk(zhjwxkUrl(`/xkBks.vxkBksXkbBs.do?m=yxSearchTab&p_xnxq=${sem}&tokenPriFlag=yx`));
    const tokenMatch = searchHtml.match(/name="token"\s+value="([^"]+)"/);
    if (!tokenMatch) return { ok: false, msg: "无法获取 token" };
    const respHtml = await postFormGbk(zhjwxkUrl(`/xkBks.vxkBksXkbBs.do`), { m: "deleteYxk", p_xnxq: sem, page: "", token: tokenMatch[1], tokenPriFlag: "yx", tk: "", jhzy_kch: "", jhzy_kxh: "", jhzy_zy: "", "p_del_id": sem + ";" + code + ";" + seq + ";" });
    if (respHtml.includes("accessDenied")) return { ok: false, msg: "操作被拒绝" };
    return { ok: true, msg: "退选成功" };
}

// Change volunteer
async function changeVolunteerApi(sem: string, code: string, seq: string, targetZy: number) {
    const searchHtml = await fetchGbk(zhjwxkUrl(`/xkBks.vxkBksXkbBs.do?m=yxSearchTab&p_xnxq=${sem}&tokenPriFlag=yx`));
    const tokenMatch = searchHtml.match(/name="token"\s+value="([^"]+)"/);
    if (!tokenMatch) return { ok: false, msg: "无法获取 token" };
    await postFormGbk(zhjwxkUrl(`/xkBks.vxkBksXkbBs.do`), { m: "changeZY", p_xnxq: sem, tokenPriFlag: "yx", page: "", token: tokenMatch[1], tk: "", jhzy_kch: code, jhzy_kxh: seq, jhzy_zy: String(targetZy) });
    return { ok: true, msg: "志愿已调整为第" + targetZy + "志愿" };
}

// ═══════════════ Proxy ═══════════════
const INJECT_SCRIPT = `<script data-thu-proxy="1">(function(){var Z='http://zhjwxk.cic.tsinghua.edu.cn',ZS='https://zhjwxk.cic.tsinghua.edu.cn';function rw(u){if(typeof u!=='string')return u;if(u.indexOf(ZS)===0)return u.replace(ZS,'');if(u.indexOf(Z)===0)return u.replace(Z,'');return u}var oO=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u){return oO.apply(this,[m,rw(u),arguments[2],arguments[3],arguments[4]])};var oF=window.fetch;window.fetch=function(u,o){if(typeof u==='string')u=rw(u);else if(u instanceof Request)u=new Request(rw(u.url),u);return oF.call(this,u,o)};document.addEventListener('click',function(e){var a=e.target.closest('a');if(a&&a.href){var nh=rw(a.href);if(nh!==a.href){e.preventDefault();window.location.href=nh}}},true)})();</script>`;

async function proxyRequest(reqPath: string, req: http.IncomingMessage, res: http.ServerResponse) {
    const targetUrl = zhjwxkUrl(`${reqPath}${url.parse(req.url || "").search || ""}`);
    console.log(`  [proxy] ${req.method} ${reqPath}`);
    const headers: Record<string, string> = { "User-Agent": UA, Cookie: ch(), "Accept": req.headers.accept || "*/*", "Accept-Language": req.headers["accept-language"] || "zh-CN,zh;q=0.9", "Accept-Encoding": "identity", "Referer": zhjwxkUrl(`${reqPath}`) };
    if (req.headers["content-type"]) headers["Content-Type"] = req.headers["content-type"] as string;
    try {
        const body = await new Promise<Buffer>((resolve) => { const chunks: Buffer[] = []; req.on("data", (c: Buffer) => chunks.push(c)); req.on("end", () => resolve(Buffer.concat(chunks))); });
        const r = await fetch(targetUrl, { method: req.method || "GET", headers, body: body.length > 0 ? body : undefined, redirect: "manual" } as RequestInit);
        saveCookies(r);
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

// ═══════════════ Server-side cache (catalog/plan/volunteer — 慢数据缓存) ═══════════════
let serverCache: { sem: string; plan: any[]; catalog: any[]; volunteer: Record<string, any>; ts: number } = { sem: "", plan: [], catalog: [], volunteer: {}, ts: 0 };

function readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise(resolve => { let b = ""; req.on("data", (c: Buffer) => b += c); req.on("end", () => resolve(b)); });
}
function json(res: http.ServerResponse, data: any, status = 200) { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(data)); }

const server = http.createServer(async (req, res) => {
    const parsed = url.parse(req.url || "/", true);
    const pathname = parsed.pathname || "/";
    res.setHeader("Access-Control-Allow-Origin", "*"); res.setHeader("Access-Control-Allow-Headers", "*"); res.setHeader("Access-Control-Allow-Methods", "*");
    if (req.method === "OPTIONS") { res.writeHead(200); res.end(); return; }

    // Health check (for Render / load balancers)
    if (pathname === "/health") { res.writeHead(200, { "Content-Type": "text/plain" }); res.end("OK"); return; }

    // Pages — 已登录访问 / 自动跳 /app，未登录访问 /app 也允许（前端处理）
    if (pathname === "/" || pathname === "/login") {
        if (loginState === "done") { res.writeHead(302, { Location: "/app" }); res.end(); return; }
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); res.end(LOGIN_HTML); return;
    }
    if (pathname === "/app") { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); res.end(APP_HTML); return; }

    // Auth API
    if (pathname === "/api/login" && req.method === "POST") { const b = JSON.parse(await readBody(req)); doLogin(b.userId, b.password); json(res, { ok: true }); return; }
    if (pathname === "/api/2fa" && req.method === "POST") { const b = JSON.parse(await readBody(req)); continue2FA(b.methodIdx, b.code); json(res, { ok: true }); return; }
    if (pathname === "/api/status") { json(res, { state: loginState, error: loginError, progress: loginProgress, need2fa: loginState === "need_2fa", methods: pending2FA?.methods || [] }); return; }

    // Data API (require login)
    if (pathname.startsWith("/api/")) {
        if (loginState !== "done") { json(res, { error: "请先登录" }, 401); return; }
        const sem = (parsed.query.sem || "") as string;
        try {
            // /api/init — 一次返回全部数据（慢数据从缓存读，快数据实时拉）
            if (pathname === "/api/init") {
                const forceRefresh = parsed.query.refresh === "1";
                let plan: any[], catalog: any[], volData: Record<string, any>;
                if (!forceRefresh && serverCache.sem === sem && serverCache.catalog.length > 0) {
                    plan = serverCache.plan; catalog = serverCache.catalog; volData = serverCache.volunteer;
                } else {
                    console.log(`  [init] 拉取 catalog+plan+volunteer...`);
                    [plan, catalog, volData] = await Promise.all([
                        fetchTrainingPlan(sem).catch(e => { console.log(`  [init] plan FAIL: ${e.message}`); return []; }),
                        fetchCourseCatalog(sem).catch(e => { console.log(`  [init] catalog FAIL: ${e.message}`); return []; }),
                        fetchVolunteer(sem).catch(e => { console.log(`  [init] volunteer FAIL: ${e.message}`); return {}; }),
                    ]);
                    console.log(`  [init] 结果: plan=${plan.length}, catalog=${catalog.length}, volData=${Object.keys(volData).length}`);
                    serverCache = { sem, plan, catalog, volunteer: volData, ts: Date.now() };
                }
                const [selected, qResult, candidates] = await Promise.all([
                    fetchSelectedCourses(sem).catch(e => { console.log(`  [init] selected FAIL: ${e.message}`); return []; }),
                    fetchQueueData(sem).catch(e => { console.log(`  [init] queue FAIL: ${e.message}`); return { map: {}, phase: false }; }),
                    fetchCandidateCourses(sem).catch(e => { console.log(`  [init] candidates FAIL: ${e.message}`); return []; }),
                ]);
                console.log(`  [init] 快数据: selected=${selected.length}, queue=${Object.keys(qResult.map).length}, candidates=${candidates.length}`);
                json(res, { plan, catalog, volunteer: volData, selected, queueMap: qResult.map, queuePhase: qResult.phase, candidates });
                return;
            }
            if (pathname === "/api/plan") { json(res, await fetchTrainingPlan(sem)); return; }
            if (pathname === "/api/courses") { json(res, serverCache.sem === sem ? serverCache.catalog : await fetchCourseCatalog(sem)); return; }
            if (pathname === "/api/volunteer") { json(res, serverCache.sem === sem ? serverCache.volunteer : await fetchVolunteer(sem)); return; }
            if (pathname === "/api/selected") { json(res, await fetchSelectedCourses(sem)); return; }
            if (pathname === "/api/queue") { json(res, await fetchQueueData(sem)); return; }
            if (pathname === "/api/candidates") { json(res, await fetchCandidateCourses(sem)); return; }
            if (pathname === "/api/levelTable") { json(res, await fetchLevelTable(sem)); return; }
            if (pathname === "/api/detail") { json(res, await fetchCourseDetail(parsed.query.teacherId as string, parsed.query.code as string)); return; }
            if (pathname === "/api/submit" && req.method === "POST") { const b = JSON.parse(await readBody(req)); json(res, await submitCourseApi(sem, b.code, b.seq, b.zy, b.flag)); return; }
            if (pathname === "/api/drop" && req.method === "POST") { const b = JSON.parse(await readBody(req)); json(res, await dropCourseApi(sem, b.code, b.seq, b.isQueue)); return; }
            if (pathname === "/api/changeZy" && req.method === "POST") { const b = JSON.parse(await readBody(req)); json(res, await changeVolunteerApi(sem, b.code, b.seq, b.zy)); return; }
            json(res, { error: "Unknown API" }, 404); return;
        } catch (e: any) { json(res, { error: e.message }, 500); return; }
    }

    // Static files (CSS, JS, images etc.)
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
    if (loginState !== "done") { res.writeHead(302, { Location: "/" }); res.end(); return; }
    proxyRequest(pathname, req, res);
});

const PORT = parseInt(process.env.PORT || "3456", 10);
server.listen(PORT, "0.0.0.0", () => {
    console.log(`\n🚀 NextTHUxk Server 已启动\n   端口: ${PORT}\n   本地: http://localhost:${PORT}\n`);
});
