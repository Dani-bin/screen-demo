/*
 * @Author:
 * @Date: 2024-06-12 10:46:23
 * @Description:
 */
import globals from "globals"
import pluginJs from "@eslint/js"
import pluginVue from "eslint-plugin-vue"
import { FlatCompat } from "@eslint/eslintrc"
import path from "path"
import { fileURLToPath } from "url"
// 由 vite.config.js 中 unplugin-auto-import 的 eslintrc 选项生成的全局变量声明文件，
// 声明了自动导入的 Vue / Vue Router API（ref、computed、onMounted、useRoute 等），
// 合并进 globals 后 ESLint 不再对这些 API 报 no-undef；需随源码一并提交，执行 yarn build 可重新生成。
import autoImportGlobals from "./.eslintrc-auto-import.json" with { type: "json" }

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const compat = new FlatCompat({
  baseDirectory: __dirname
})

export default [
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        ...autoImportGlobals.globals
      }
    }
  },
  pluginJs.configs.recommended,
  ...pluginVue.configs["flat/essential"],
  ...compat.extends("plugin:prettier/recommended"),
  {
    ignores: ["**/temp.js", "config/*"],
    rules: {
      // 禁用组件名称为单词的规则
      "vue/multi-word-component-names": "off"
    }
  }
]
