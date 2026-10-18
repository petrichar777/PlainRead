/// <reference types="vite/client" />

/** 构建期注入的应用版本（来自 package.json，见 vite.config.ts 的 define）。 */
declare const __APP_VERSION__: string;
