# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Vue 3 + Vite **large-screen 3D visualization demo collection** (大屏 demo 合集). The routed pages are the `/home` showcase plus four three.js demos (`/school`, `/city`, `/charging`, `/building`); all use static or simulated data, call no backend and need no login (there is no auth layer). It is display-oriented: meant to run fullscreen on a wall/monitor, not a conventional CRUD admin app.

The project grew out of an emergency-management (应急) dashboard. On 2026-10-06 all of that code was removed (Baidu Map, ECharts panels, video, AI chat, login / dict flow, Pinia, Element Plus, shared components); docs under `docs/superpowers` from before that date may still mention it.

## Commands

This project uses **yarn** (see `yarn.lock`).

- `yarn dev` — start Vite dev server at **https://localhost:8892** (self-signed cert via `@vitejs/plugin-basic-ssl`, host exposed)
  - `DEV_HTTP=1` serves plain http instead and `PORT` overrides the port; `.claude/launch.json` uses both so the Claude in-app preview (which rejects self-signed certs) gets its own http server on an auto-assigned port
- `yarn build` — production build (output base path is `/bi/`)
- `yarn preview` — preview the production build
- `yarn lint:eslint` — ESLint with `--fix` over `{src,mock}/**/*.{vue,ts,tsx}`, max 0 warnings (it skips `.js` files)
  - To check everything without rewriting files: `npx eslint --max-warnings 0 "src/**/*.{vue,js}"` (clean as of 2026-10-06)
- `yarn format` — Prettier over the whole repo
- `/charging` 3D model (Blender, not three.js code): the station is built by the Python package `scripts/blender/charging/` run inside Blender 5.1+ through the Blender Lab MCP add-on (port 9876):
  `import sys; sys.path.insert(0, "<repo>/scripts/blender"); import charging.build as b; b.run()` rebuilds the scene and saves `models/charging/station.blend`; `import charging.export as e; e.export()` writes `public/charging/station.glb` + `cars.glb`.
  Edit the scripts, never the .blend by hand — the .blend and GLBs are build outputs. `b.run(render_to="<png>")` also renders a preview from the dashboard camera angle
- `node scripts/capture-home-previews.mjs [devServerUrl] [key…]` — regenerates the homepage preview images `public/home/<key>.webp` with headless Chrome (dev server must be running; default URL `https://localhost:8892`; Node 22+; `CHROME_PATH` overrides the Chrome location). It waits for the scene to finish loading, then captures mid-way through the first tour stop (per-demo `SETTLE` seconds in the script)

There is **no test framework** configured. For the `/city` landmark models the regression tool is a Node script (read-only, builds the landmark modules outside the browser):

- `node scripts/city-landmark-check.mjs stats <景点名…>` — triangle count, Mesh count, marker base height, walkway length and a geometry hash per landmark (names as in `cityData.js`, e.g. `熊猫基地`, `"武侯祠·锦里"`); compare hashes before/after a refactor that should not change geometry
- `node scripts/city-landmark-check.mjs walk <景点名>` — checks every crowd walkway (support, 4.35 m headroom, per-body-part clearance); `坏点合计 0` is the bar for new landmarks

## Responsive scaling (critical to understand)

The screen scales via rem, not media queries. **Author all sizes in `px`** — they are auto-converted to `rem` at build time:

- `postcss-pxtorem` with `rootValue: 192` converts every `px` to `rem` (see `vite.config.js`).
- `amfe-flexible` sets the root font-size at runtime so the layout scales to the viewport.
- To opt a stylesheet out of conversion, name it `*no-convert.css` (the `exclude` rule in `vite.config.js`); `building/scene/map/labels.no-convert.css` uses it because CSS3D labels are already scaled with the canvas.
- Tailwind is imported for its preflight base styles; the pages are styled with hand-written SCSS, not Tailwind utility classes, but they rely on the reset, so keep the import in `src/main.js`.
- `src/assets/styles/index.scss` registers the three fonts in use (`Alimama ShuHeiTi` titles, `Source Han Sans CN` body, `DIN` numbers) and the base `html` / `body` / `#app` styles.

## Architecture

- **Entry**: `src/main.js` → imports Tailwind base, `amfe-flexible` and `index.scss`, registers the router and mounts `App.vue`. There is no store, UI library or route guard.
- **Routing**: `src/router/index.js`, **hash history**. Top-level pages are lazy-loaded views; the registered routes are `/home`, `/school`, `/city`, `/charging` and `/building`. Default redirect is `/home`.
  - `/home` is the demo showcase homepage (focus carousel: intro + preview of one demo at a time, auto-rotates every 8 s, pauses on hover, ←/→/Enter keys). Its content comes only from `src/views/home/data/demos.js`; to add a demo, append an entry there, register the route, then run the preview capture script (see Commands).
  - `/city` is the city 3D overview page (three.js + static OSM data, no login); its geometry is generated by `scripts/fetch-osm-city.py` into `public/city/`.
    The panda base stop (index 11) lives in an "enclave" — a separately fetched OSM patch ~5 km NE of the main data (meta.enclaves in chengdu.json; fetch-osm-city.py --enclave / --keep-main, `--no-enclave` to fetch the main city only).
    The panda base model hard-codes local coordinates derived from `meta.origin`; after re-fetching the enclave, rerun `stats` / `walk 熊猫基地` (see Commands).
  - Dev-only single-landmark preview (not in the production build): `/city-lab.html?landmark=<key>&yaw=&pitch=&dist=&tx=&tz=` (`key`: `kit` | `tianfu` | `taikooli` | `ifs` | `kuanzhai` | `peoplesPark` | `wenshu` | `hejiang` | `wangjiang` | `pandaTower` | `wuhou` | `dufu` | `pandaBase`; `tx`/`tz` shift the look-at point in metres). Deep link a tour stop with `#/city?spot=N`.
  - On arrival at a tour stop, low-poly pedestrians walk that landmark's paths and fade out on departure / overview (`scene/crowd.js`; each landmark module returns `walkways`). In the lab page `people=0` turns the crowd off and `t=<seconds>` pre-advances it (default 3).
  - Besides `walkways`, a landmark may return `groundHoles` (world-space polygons; contract in the header of `landmarks/index.js` and in `setGroundHoles` of `terrain.js`) to cut holes in the city ground, e.g. the 天府广场 sunken plaza.
    The lab page logs the hole report to the console and exposes it as `window.__labGroundHoles`.
    After re-fetching OSM data, rerun `stats 天府广场` and check that `parks.skipped` and `water.skipped` in the lab page's hole report are empty.
  - `/charging` is the smart charging station digital twin (光储充一体化超充站). The scene loads the Blender GLBs and drives them by object name — `pile_B01`(+`_body`/`_screen`/`_status`), `bay_B01_N`/`_S`, `bay_A01`, `gate_in_arm`, `ess_01`, `transformer_01`; renaming in `layout.py` breaks `scene/ChargingScene.js`. Pile ids / counts must match `data/station.js`.
    Cars and the fast-pile body are Sketchfab models in `models/charging/vendor/` normalised by `scripts/blender/charging/vendor.py`; their credits are shown on the page (`MODEL_CREDITS` in `data/station.js`). Two cars (`lavida`, `sylphy`) are CC BY-NC-SA — fine for this non-commercial demo, but they must be removed before any commercial use.
    Runtime data comes from `sim/simulator.js` (seeded, follows the real clock and time-of-use periods; car sessions are time-compressed so cars keep arriving/leaving). Dev builds expose the scene as `window.__chargingScene`. Design drafts and the style analysis live in `docs/design/charging/`.
  - `/building` is the 数字楼宇 demo, planned as five drill-down levels 城市 → 园区 → 楼宇 → 楼层 → 房间; the city (成都高新区南区 only — the west zone is ~20 km away and was dropped on request), park (成都金融城双子塔) and building (南塔 / 北塔) levels exist, floor / room only as design drafts in `docs/design/building/`.
    `index.vue` only switches levels (`?level=city|park|building`, plus `&b=tower_S|tower_N` for the building level; each level is `components/levels/<Level>.vue`).
    Its 3D map ports the 射阳应急 biscreen homepage map (mini3d framework from ThreeMaps + `World.js`) into `scene/map/` (`CityWorld.js`, gsap timeline); the transparent canvas sits on `assets/map-base.png`.
    Map data (OSM street boundaries, DataV 成都 districts, OSM tower heights) is generated by `node scripts/build-building-geo.mjs` into `public/building/map/` and `data/mapData.js` (do not edit by hand); downloads are cached in `node_modules/.cache/building-geo/`, and Node's fetch has to run outside the Claude sandbox.
    The park entry is 成都金融城双子塔 (OSM: 218 m, 58 F); operating metrics in `data/city.js` / `data/park.js` are demo data.
    Park level: `node scripts/build-park-layout.mjs` turns OSM (天府国际金融中心 campus, footprints, roads, grass / water) into `scripts/blender/park/layout.json` + `data/parkData.js`
    (road widths are one notch wider than reality, and it adds 5 generated landscape lakes with lakeside paths in the campus's empty spots — design additions, not OSM);
    in Blender (MCP) `import park.build as b; b.run()` rebuilds `models/park/park.blend`, `import park.bake as k; k.bake()` bakes the ground lighting with Cycles into `public/building/park_ground.webp` (several minutes, the MCP call times out but Blender finishes), `import park.export as e; e.export()` writes `public/building/park.glb` (trees / lamps as GPU instances).
    Rebaking is only needed when ground, trees, lamps or building footprints change; the three.js scene (`scene/park/`) shows the bake unlit and sets emissive strengths per material name in `scene/park/theme.js`.
    Building level: a procedural holographic tower in `scene/tower/` (no Blender) built from `PARK_TOWERS` (footprint / roof, exported by the same layout script); vertical scale is compressed on purpose (2.5 m storeys, see the header of `BuildingScene.js`), floor / elevator / asset data is demo data in `data/building.js`. Dev builds expose `window.__towerScene`.
- **Views**: `src/views/<page>/index.vue` is the page shell; it builds its panels from `./components/*.vue`, keeps three.js code under `./scene` (no Vue dependency) and static content under `./data`. Pages share nothing with each other — each has its own header, palette and helpers.

## Auto-imports — do not hand-import these

`unplugin-auto-import` is active (`vite.config.js`):

- Vue and Vue Router APIs (`ref`, `computed`, `onMounted`, `useRoute`, …) are **globally auto-imported** — no `import` needed. Declarations live in `auto-imports.d.ts`.
- Components are **not** auto-registered: import child components explicitly.
- `auto-imports.d.ts` is generated; do not edit it by hand.
- `.eslintrc-auto-import.json` (the auto-import globals for ESLint) is also generated by `unplugin-auto-import` during dev/build; do not edit it by hand.

## Environments

- `.env.development` / `.env.production` only set `VITE_APP_ENV`; `production` switches the build `base` to `/bi/`. There is no dev proxy and no backend.

## Code style

Prettier (`.prettierrc`): **no semicolons**, double quotes, 2-space indent, 80 col, no trailing commas, `vueIndentScriptAndStyle: true`. ESLint flat config extends Vue essential + Prettier; `vue/multi-word-component-names` is off. Comments and UI text are in Chinese — match the surrounding language.

- **注释要求**：生成的所有代码必须带有清晰、易懂的中文注释，用以解释非显而易见的业务逻辑、关键算法或代码结构。
- **回复语言**：在所有沟通中，必须始终使用简体中文进行回复。

## Agent skills

### Issue tracker

Issues and specs live as local markdown files under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`), recorded as a `Status:` line in each issue file. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one root `GLOSSARY.md` plus `docs/adr/` (neither exists yet; created lazily). See `docs/agents/domain.md`.
