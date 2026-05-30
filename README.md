# NextTHUxk Server

每个人的下一代选课 · 本地/云一键部署，不需要浏览器扩展。

基于 [NextTHUxk](https://github.com/smartThise/NextTHUxk) 扩展版全量迁移到独立服务器，通过 WebVPN 代理 zhjwxk 选课系统，提供课程搜索、志愿概率计算、课余量/排队信息、AI 智能排课等功能。

## 快速开始

```bash
git clone https://github.com/smartThise/NextTHUxk-server.git
cd NextTHUxk-server
npm install
npm start
```

浏览器打开 `http://localhost:3456`，输入学号密码登录即可使用。

## 部署到 Render.com

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy)

或手动配置：

1. [Render Dashboard](https://dashboard.render.com) → New Web Service
2. 连接 GitHub 仓库 `smartThise/NextTHUxk-server`
3. Runtime: Node, Build: `npm install`, Start: `npm start`
4. Free Instance 即可

## 功能

- **全功能代理** — 登录、选课、退选、排队、志愿调整，全部可用
- **课程筛选** — 18 项课程特色筛选 + 年级 + 时间 + 冲突 + 通识课组
- **概率计算** — 实时中签概率、竞争度、志愿级联分析
- **课表预览** — 可视化课表，冲突检测，概率标签
- **暂存草稿** — 多方案保存、导入导出、一键提交
- **培养方案** — 方案覆盖追踪、英语/体育替代检测
- **AI 排课** — 基于偏好 + 年级自动推荐课表方案
- **零 Cookie 存储** — Cookie 加密存在浏览器，服务器不持久化任何敏感数据

## 与扩展版的区别

| | NextTHUxk (扩展) | NextTHUxk Server |
|---|---|---|
| 安装 | Chrome/Edge 扩展商店 | `npm install && npm start` |
| 运行位置 | 浏览器内 | 本地或云服务器 |
| Cookie | 浏览器原生 | 加密存浏览器 Cookie |
| 适用场景 | 个人日常使用 | 个人使用 / 云端 Demo |

## License

MIT
