/*
 * @Author:
 * @Date: 2024-06-11 11:04:25
 * @Description:阿水大
 */
import { fileURLToPath, URL } from "node:url"
import { defineConfig, loadEnv } from "vite"
import vue from "@vitejs/plugin-vue"
import AutoImport from "unplugin-auto-import/vite"
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
      })
    ],
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url))
      }
    },
    css: {
      // Vite 5 默认走 Sass 旧版 JS API，sass 1.79+ 会报 legacy-js-api 弃用警告；
      // 改用新版编译器 API（更快，且 Dart Sass 2.0 之后旧 API 会被移除）
      preprocessorOptions: {
        scss: { api: "modern-compiler" }
      },
      postcss: {
        plugins: [
          postCssPxToRem({
            rootValue: 192,
            // 所有px均转化为rem
            propList: ["*"],
            // 约定：文件名为 no-convert.css 的样式不做转换（目前没有此类文件）
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
      open: false
    }
  }
})
