/*
 * 本地 http 预览入口
 * ----------------------------------------------------------
 * Claude Code 的内置浏览器不接受 basic-ssl 的自签名证书，页面会一片空白。
 * 这里先置 DEV_HTTP=1 再以 API 方式拉起 vite，让开发服务器走 http；
 * 端口由预览工具通过 PORT 环境变量给出（见 vite.config.js 的 server.port）。
 *
 * 之所以不在 launch.json 里直接写 `env DEV_HTTP=1 yarn dev`：
 * Windows 上没有 env 命令，项目也没装 cross-env。
 *
 * 日常开发仍用 `yarn dev`，那条路径不受影响，照旧是 https://localhost:8892。
 */
process.env.DEV_HTTP = "1"

const { createServer } = await import("vite")

const server = await createServer()
await server.listen()
server.printUrls()
