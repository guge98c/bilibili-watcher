# bilibili-watcher

B站 UP主视频监控脚本。

## 配置方式

所有配置直接写在 scripts/search.js 顶部：

- MIDS：UP主UID列表
- N8N_URL：n8n webhook地址
- COOKIE：B站Cookie（需包含 buvid3/buvid4/SESSDATA/bili_jct/DedeUserID）

## Cookie 获取

浏览器登录 B站 → F12 → Application → Cookies → 复制以下5个字段：
buvid3, buvid4, SESSDATA, bili_jct, DedeUserID

## 运行

本地：node scripts/search.js
自动：GitHub Actions 每6小时执行一次
