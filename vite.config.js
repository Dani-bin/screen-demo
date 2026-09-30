/*
 * @Author:
 * @Date: 2024-06-11 11:04:25
 * @Description:阿水大
 */
import { fileURLToPath, URL } from "node:url"
import { defineConfig, loadEnv } from "vite"
import vue from "@vitejs/plugin-vue"
import AutoImport from "unplugin-auto-import/vite"
import Components from "unplugin-vue-components/vite"
import autoprefixer from "autoprefixer"
import tailwindcss from "tailwindcss"
import basicSsl from "@vitejs/plugin-basic-ssl"

import postCssPxToRem from "postcss-pxtorem"

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd())
  const { VITE_APP_ENV } = env
  // 本地预览开关：DEV_HTTP=1 时不启用自签名 https（Claude 内置浏览器等预览工具不接受
  // 自签名证书），端口取预览工具分配的 PORT。都不设时与原来一致：https://localhost:8892
  const devHttp = process.env.DEV_HTTP === "1"
  return {
    base: VITE_APP_ENV === "production" ? "/bi/" : "/",
    plugins: [
      vue(),
      ...(devHttp ? [] : [basicSsl()]),
      AutoImport({
        imports: ["vue", "vue-router"],
        // 生成 ESLint 全局变量声明文件，避免自动导入的 API（ref、computed 等）被报 no-undef
        eslintrc: {
          enabled: true,
          filepath: "./.eslintrc-auto-import.json",
          globalsPropValue: true
        }
      }),
      Components({
        dirs: ["src/components"],
        extensions: ["vue"], // 自动注册组件
        exclude: ["AiChatBox"]
      })
    ],
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url))
      }
    },
    css: {
      postcss: {
        plugins: [
          postCssPxToRem({
            rootValue: 192,
            // 所有px均转化为rem
            propList: ["*"],
            exclude: /no-convert\.css$/
          }),
          autoprefixer({
            overrideBrowserslist: ["last 2 versions"] // 根据需要设置浏览器版本
          }),
          tailwindcss()
        ]
      }
    },
    // vite 相关配置
    server: {
      host: true,
      port: Number(process.env.PORT) || 8892,
      https: !devHttp,
      open: false,
      proxy: {
        "/dev-api": {
          secure: false, // 不校验https证书
          // target: `http://6e5fd20e.r19.cpolar.top`,
          target: `https://36.213.184.229:8889/prod-api`,
          // target: `http://192.168.1.116:38080`,
          // target: `http://36.139.130.59:8888`,
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/dev-api/, "")
        },
        // 视频网关（WVP / 视频融合平台）反向代理，解决浏览器跨域
        "/video-api": {
          target: "http://36.137.74.48:8090",
          changeOrigin: true,
          secure: false,
          rewrite: (p) => p.replace(/^\/video-api/, "")
        },
        // SenseVoice 语音识别API代理
        "/sensevoice": {
          target: "https://openspeech.bytedance.com",
          changeOrigin: true,
          secure: false,
          rewrite: (p) => p.replace(/^\/sensevoice/, "")
        },
        // AI 对话接口代理
        "/chat-api": {
          target: "http://36.213.184.229:8888",
          changeOrigin: true,
          secure: false,
          rewrite: (p) => p.replace(/^\/chat-api/, "")
        }
      }
    }
  }
})
