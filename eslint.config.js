/*
 * @Author:
 * @Date: 2024-06-12 10:46:23
 * @Description:
 */
import globals from "globals";
import pluginJs from "@eslint/js";
import pluginVue from "eslint-plugin-vue";
import { FlatCompat } from "@eslint/eslintrc";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname
});

export default [
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } }
  },
  pluginJs.configs.recommended,
  ...pluginVue.configs["flat/essential"],
  ...compat.extends("plugin:prettier/recommended"),
  {
    ignores: ["**/temp.js", "config/*"],
    rules: {
      // 禁用组件名称为单词的规则
      "vue/multi-word-component-names": "off",
      "vue/setup-compiler-macros": "error"
    }
  }
];
