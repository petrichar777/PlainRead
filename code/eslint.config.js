// ESLint 扁平配置（flat config）。
//
// 对应 docs/03-里程碑与验收清单.md「全局持续项」里的 ESLint 门禁。
// 与 tsconfig 的分工：tsc 负责「类型对不对」，ESLint 负责「写法有没有坑」
// （最典型的是 React Hooks 依赖数组 —— 那是类型系统管不到的运行时错误）。
import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist",
      "node_modules",
      // 由 tauri-specta 从 Rust 自动生成，不可手工修正，检查它没有意义
      "src/ipc/bindings.ts",
      // Rust 侧不归前端 lint 管
      "src-tauri",
    ],
  },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
    },
  },
);
