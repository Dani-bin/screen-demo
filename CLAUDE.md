# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Vue 3 + Vite **large-screen data-visualization dashboard** (大屏 / BI) for an emergency-management system (应急). It renders full-screen, fixed-layout panels combining ECharts charts, Baidu Map (BMapGL) layers, video feeds, and an AI chat assistant. It is display-oriented: meant to run fullscreen on a wall/monitor, not a conventional CRUD admin app.

## Commands

This project uses **yarn** (see `yarn.lock`).

- `yarn dev` — start Vite dev server on port **8080** (host exposed)
- `yarn build` — production build (output base path is `/bi/`)
- `yarn preview` — preview the production build
- `yarn lint:eslint` — ESLint with `--fix` over `{src,mock}/**/*.{vue,ts,tsx}`, max 0 warnings
- `yarn format` — Prettier over the whole repo

There is **no test framework** configured.

## Responsive scaling (critical to understand)

The screen scales via rem, not media queries. **Author all sizes in `px`** — they are auto-converted to `rem` at build time:

- `postcss-pxtorem` with `rootValue: 192` converts every `px` to `rem` (see `vite.config.js`).
- `amfe-flexible` sets the root font-size at runtime so the layout scales to the viewport.
- To opt a stylesheet out of conversion, name it `no-convert.css` (see `src/assets/styles/no-convert.css`).
- Tailwind is enabled but plays a minor role alongside hand-written SCSS.

## Architecture

- **Entry**: `src/main.js` → mounts `App.vue`, registers Pinia (`src/store`), router, Element Plus (zh-cn locale), v-viewer, and imports `src/permission.js`.
- **Routing**: `src/router/index.js`, **hash history**. Top-level pages are lazy-loaded views; `/typhoon` has nested child routes (`weatherMap`, `situationAnalysis`, `commandDispatch`) rendered through a `<KeepAlive>` `<router-view>`. Default redirect is `/typhoon`.
  - Note: `src/views/` contains more sections (`comprehensiveAnalysis`, `emergencyCommand`) than are currently wired into the router. Check the router before assuming a view is reachable.
- **Views**: `src/views/<section>/index.vue` is the section shell; each builds its panels from `./components/*.vue`. The shared chrome lives in `src/components` (`Head.vue`, `MenuTabs.vue`, `Popup.vue`, `EchartItem.vue`, `EchartTitle.vue`, `MapSearch.vue`, `Loading.vue`, `Progress.vue`).
- **State**: Pinia. `src/store/modules/user.js` (token, userInfo, village/community selection) and `src/store/modules/dict.js` (dictionary data, incl. the Baidu Map key).
- **HTTP**: `src/utils/request.js` is the main axios instance — RuoYi-style: `baseURL` from `VITE_APP_BASE_API`, `Bearer` token injection, GET param serialization via `tansParams`, and **automatic access-token refresh** (queues concurrent requests on 401/4011-4016, retries after refresh). Pass `notError: true` in a request config to suppress error toasts. `src/utils/aiRequest.js` is a **separate** axios instance for the AI backend with advanced-query param building.
- **AI chat**: streamed via `@microsoft/fetch-event-source` (SSE); API wrappers in `src/api/ai/aiChat.js`. AI backend base URL comes from `VUE_APP_BASE_AI_API`.
- **Maps**: Baidu Map GL is loaded dynamically by `src/bmpgl.js` (`BMPGL(ak)` injects the `BMapGL` script + DrawingManager). `src/utils/renderBoundaries.js` draws administrative boundaries.

## Auto-imports — do not hand-import these

`unplugin-auto-import` and `unplugin-vue-components` are active (`vite.config.js`):

- Vue and Vue Router APIs (`ref`, `computed`, `onMounted`, `useRoute`, …) are **globally auto-imported** — no `import` needed. Declarations live in `auto-imports.d.ts`.
- Any `.vue` file under `src/components` is **auto-registered globally** — use it in templates without importing. Declarations live in `components.d.ts`.
- These two `.d.ts` files are generated; do not edit them by hand.

## Auth flow (and the current dev bypass)

The intended flow: a `token`/`refreshToken` arrives via query string or `sessionStorage["thyj-bi-token"]`, is stored through `src/utils/auth.js`, then the Baidu Map key is fetched from the dict API before `next()`.

**Currently `src/permission.js` hard-codes a token and a Baidu Map key, then early-`return`s before the real auth/dict logic.** This is a local-dev shortcut — the production login/dict-fetch code below the `return` is dead in this state. Be aware of this when touching auth or map initialization.

## Environments & proxy

- `.env.development`: `VITE_APP_BASE_API=/dev-api`; the dev server proxies `/dev-api` → `http://116.62.5.38:8888` (`vite.config.js`, rewrite strips the prefix).
- `.env.production`: `VITE_APP_BASE_API` points directly at the backend; `VITE_APP_ENV=production` switches the build `base` to `/bi/` and enables gzip.

## Code style

Prettier (`.prettierrc`): **no semicolons**, double quotes, 2-space indent, 80 col, no trailing commas, `vueIndentScriptAndStyle: true`. ESLint flat config extends Vue essential + Prettier; `vue/multi-word-component-names` is off. Comments and UI text are in Chinese — match the surrounding language.

- **注释要求**：生成的所有代码必须带有清晰、易懂的中文注释，用以解释非显而易见的业务逻辑、关键算法或代码结构。
- **回复语言**：在所有沟通中，必须始终使用简体中文进行回复。
