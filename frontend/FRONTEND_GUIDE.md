# Astra Reader – Frontend Guide

A complete map of the frontend so a future agent can orient without re-reading
every file. Current state corresponds to **Phase 1 (MVP)** of
`../architecture.md`: file upload + metadata display + interactive
chromatogram visualization. Everything beyond that is planned but not yet
implemented (see "Roadmap" at the bottom).

---

## 1. Tech Stack

| Concern | Choice | Notes |
|---|---|---|
| Framework | React 18 + TypeScript | Strict mode, `react-jsx` |
| Build tool | Vite 6 | Dev port `5173`, proxies `/api` → `http://localhost:8000` |
| Charts | Plotly.js 2.35 via `react-plotly.js` | Lazy-loaded; CDN copy also injected so `ZoomControls` can call `window.Plotly.relayout` directly |
| Styling | Tailwind CSS 3.4 + `autoprefixer`/`postcss` | Custom `brand` palette + JetBrains Mono font stack (see `tailwind.config.js`) |
| State | Zustand 5 | Single store: `experimentStore.ts` |
| HTTP | Axios 1.7 | One shared instance in `api/client.ts` |
| Package mgr | npm | `package-lock.json` committed |
| Deploy | Docker (`Dockerfile`) → `serve -s dist -l 5173` | Or `npm run dev` for local dev |

TypeScript is configured strictly (`tsconfig.json`): `strict`, `noUnusedLocals`,
`noUnusedParameters`, `noFallthroughCasesInSwitch`. The `@/*` path alias maps to
`src/*` (available but not currently used by existing files, which use relative
imports).

Scripts: `dev`, `build` (`tsc -b && vite build`), `preview`. No lint or test
script is defined yet.

---

## 2. Directory Structure

```
frontend/
  index.html              # Vite entry; mounts /src/main.tsx into #root
  package.json
  vite.config.ts          # React plugin + /api proxy + chunk size limit
  tsconfig.json           # App config (strict, paths: @/* → src/*)
  tsconfig.node.json      # Vite config compilation
  tailwind.config.js      # Brand palette + mono font
  postcss.config.js       # tailwind + autoprefixer
  Dockerfile              # node:22-slim → build → serve dist
  public/                 # (empty)
  src/
    main.tsx              # ReactDOM root, StrictMode
    App.tsx               # Top-level 3-pane layout + Plotly CDN loader
    index.css             # Tailwind directives + scrollbar + Plotly CSS fixes
    vite-env.d.ts         # vite/client types
    api/
      client.ts           # Axios instance + error normalizer
      endpoints.ts        # All backend calls (typed)
    types/
      experiment.ts       # Experiment + config + peak interfaces
      chromatogram.ts     # Chromatogram + detector interfaces
    stores/
      experimentStore.ts  # Zustand store (THE app state)
    components/
      MetadataPanel.tsx   # Right pane: full experiment metadata
      layout/
        Header.tsx        # Top bar (static)
        Sidebar.tsx       # Left pane: upload + search + experiment list
      upload/
        FileUpload.tsx    # Drag-and-drop .afe8 uploader
      chromatogram/
        ChromatogramPlot.tsx  # Plotly plot of selected detectors
        DetectorSelector.tsx  # Checkbox panel to toggle traces
        ZoomControls.tsx      # Reset/auto-scale/x-only buttons + range readout
```

The planned long-term layout (`architecture.md` §3.4) anticipates many more
folders: `analysis/`, `results/`, `plots/`, `reports/`, `tables/`, plus separate
stores for baselines/peaks/procedures/settings. None of those exist yet.

---

## 3. General Design

### 3.1 Layout

`App.tsx` renders a fixed full-height 3-pane layout:

```
┌─────────────────────────────────────────────────────┐
│ Header (brand bar)                                   │
├──────────┬────────────────────────────┬──────────────┤
│ Sidebar  │ DetectorSelector           │ MetadataPanel│
│ (320px)  │ ─────────────────────────  │ (384px)      │
│          │ ZoomControls               │              │
│          │ ─────────────────────────  │              │
│ upload + │ ChromatogramPlot           │ metadata     │
│ list     │ (flex-1)                   │ sections     │
├──────────┴────────────────────────────┴──────────────┤
│ (downsample warning if applicable)                   │
└─────────────────────────────────────────────────────┘
```

All panes use `overflow-hidden` with the inner scrolling region scoped per
component so the overall page never scrolls. Widths are fixed (`w-80`, `w-96`)
except the center which is `flex-1`.

### 3.2 State Management (Zustand)

A **single** store, `experimentStore.ts`, holds all app state and actions. No
React context, no Redux. Components subscribe via the `useExperimentStore()`
hook (optionally with selectors for granular re-renders, e.g. `FileUpload` uses
`useExperimentStore((s) => s.fetchExperiments)`).

State groups inside the store:

1. **Experiment list** — `experiments`, `totalExperiments`, `currentPage`,
   `totalPages`, `pageSize`, `searchQuery`, `listLoading`, `listError`.
2. **Current experiment** — `currentExperimentId`, `experimentDetail`,
   `detailLoading`, `detailError`.
3. **Chromatogram** — `chromatogram`, `chromatogramLoading`,
   `chromatogramError`.
4. **Detectors** — `detectorDescriptors` (what exists) and `detectorSelection`
   (which are on): `malsAngles: Set<number>`, `ri: boolean`,
   `uvWavelengths: Set<number>`. Indices map into the `data[][]` arrays of the
   chromatogram response.

Key actions:
- `fetchExperiments(page?)` — paginated list with `sample_name` filter.
- `searchExperiments()` — resets to page 1 then fetches.
- `selectExperiment(id)` — clears stale detail/chromatogram and fires
  `loadExperimentData(id)` which fetches detail + chromatogram in parallel
  (the calls are awaited independently, not with `Promise.all`).
- `loadExperimentData(id)` — also builds `detectorDescriptors` from the
  chromatogram and initializes selection to "all on".
- `deleteExperiment(id)` — deletes; clears current if it was the one; refreshes.
- Detector toggles: `toggleMalsAngle`, `toggleRI`, `toggleUVWavelength`,
  `selectAllDetectors`, `deselectAllDetectors`.

The store builds `detectorDescriptors` purely from the chromatogram response
rather than calling the separate `/detectors` endpoint (which exists in
`endpoints.ts` but is unused). When a new experiment loads, all detectors are
selected by default.

### 3.3 Data Flow

```
User → Sidebar.selectExperiment(id)
     → store.selectExperiment(id)
     → store.loadExperimentData(id)
        ├─ api.getExperiment(id)   → experimentDetail
        └─ api.getChromatogram(id) → chromatogram + detectorDescriptors + selection
     → components re-render
        ├─ MetadataPanel reads experimentDetail
        ├─ DetectorSelector reads detectorDescriptors + detectorSelection
        └─ ChromatogramPlot builds Plotly traces from chromatogram + selection
```

Upload flow: `FileUpload` → `api.uploadFiles` (multipart, progress callback) →
on success calls `store.fetchExperiments(1)` to refresh the sidebar list. It
does **not** auto-select the newly uploaded experiment.

Detector toggling is local-only: it re-filters which traces `ChromatogramPlot`
builds from the already-loaded `chromatogram`. No backend refetch.

### 3.4 API Layer

`api/client.ts` — a single axios instance with `baseURL: '/api'`, 60s timeout,
and a response interceptor that flattens any error into `Error(message)` using
`error.response.data.detail ?? error.message`. Request interceptor is a stub
("attach auth headers here if needed in future").

`api/endpoints.ts` — typed functions. Currently used: `uploadFiles`,
`listExperiments`, `getExperiment`, `deleteExperiment`, `getChromatogram`.
Defined but **not yet called**: `getDetectorChromatogram`, `getDetectors`,
`getInstruments`, `getSolvent`, `getSample`, `getFluidPath`. These exist for
future components; `getExperiment` returns the full detail (including
instruments, solvent, sample, fluid path, peaks) in one call, so the granular
endpoints aren't needed yet.

Backend response shapes are documented in `types/experiment.ts` and
`types/chromatogram.ts`. The list endpoint returns
`{experiments, total, page, limit, pages}` and `listExperiments` rewrites that
into a generic `PaginatedResponse<ExperimentSummary>` (`items/total/page/...`).

### 3.5 Plotting

`ChromatogramPlot.tsx` is the only chart. It:
- Lazy-loads `react-plotly.js` (`lazy(() => import(...))`) inside `<Suspense>` to
  shrink the initial bundle.
- Memoizes `data` + `layout` via `useMemo` keyed on `chromatogram`,
  `experimentDetail`, `detectorSelection`.
- Uses **three overlaid Y axes**: `y` (MALS, left), `y2` (RI, left, overlaying,
  anchored free at position 0.02), `y3` (UV, right). All overlay `y`; only `y`
  has a grid.
- Colors: MALS traces use a light→dark blue gradient (`gradientColors`), UV
  traces a light→dark amber gradient, RI is solid green. These constants live at
  the top of the file.
- Disables `lasso2d`/`select2d` mode bar buttons; enables `responsive`;
  `displaylogo: false`; PNG export filename `chromatogram`.
- Shows an amber banner when `chromatogram.downsampled` is true (backend
  downsampled for performance).

`ZoomControls.tsx` manipulates Plotly **imperatively** via the DOM:
- Finds `.js-plotly-plot` inside the ref'd container.
- Calls `window.Plotly.relayout(el, {...})` for Reset, Auto-Scale Y, and the
  "X-Axis Only Zoom" toggle (which sets `yaxis.fixedrange` on all three Y axes).
- Listens for `plotly_relayout` DOM events to track and display the current X
  range.

This is why `App.tsx` injects the Plotly CDN script into `window` on mount —
`react-plotly.js` is loaded as a module, but `ZoomControls` needs
`window.Plotly` available globally. This dual-loading is a known smell: a future
agent could replace it with a ref to the Plot component's `el` and call
`Plotly.relayout` from the bundled module instead.

### 3.6 Styling Conventions

- Tailwind utility classes everywhere; no CSS modules.
- Custom `brand` palette (blue-gray ramp) defined in `tailwind.config.js`;
  slate is used as the neutral companion.
- `index.css` sets Inter as the base font, slate-50 page background, custom
  thin scrollbars, and a Plotly width fix (`.js-plotly-plot { width: 100% }`).
- Mono font stack (`JetBrains Mono` → `Fira Code` → `Cascadia Code` →
  `Consolas`) is exposed as `font-mono`; used for numeric/ID values.
- Inline SVG icons (Heroicons-style paths) are pasted directly into components
  rather than imported from an icon library.
- Repeated formatting helpers (`formatSize`, `formatDate`) are defined locally
  in each component that needs them — there is no shared `utils/` file yet.

### 3.7 Error & Loading UX

Every async view follows the same pattern: a `*Loading` flag renders a centered
"Loading..." placeholder, a `*Error` string renders a red-tinted banner, and an
empty/null state renders a slate placeholder with an icon and hint text. This
pattern repeats in `Sidebar`, `MetadataPanel`, and `ChromatogramPlot`.

`Sidebar`'s delete uses a two-click confirm: first click sets `confirmDeleteId`
and shows "Click again to confirm"; the id auto-clears after 3s.

---

## 4. File-by-File Reference

### `src/main.tsx`
Mounts `<App/>` into `#root` under `<React.StrictMode>`. Imports `index.css`.
Nothing else.

### `src/App.tsx`
- Top-level layout: `Header` + flex row of `Sidebar` / center / `MetadataPanel`.
- `useEffect` injects the Plotly CDN `<script>` into `<head>` if
  `window.Plotly` is missing, with cleanup that removes it. (See §3.5 for why.)

### `src/index.css`
Tailwind base/components/utilities + root font + scrollbar styling + Plotly
width fix. The `:root` font is Inter (not imported here — expected to be
available system-wide or added later).

### `src/api/client.ts`
Axios instance: `baseURL: '/api'`, 60s timeout, request interceptor stub,
response interceptor that normalizes errors to `Error(detail ?? message)`.

### `src/api/endpoints.ts`
All typed API calls. Returns:
- `uploadFiles` → `ExperimentSummary[]` (normalizes single-object or array).
- `listExperiments` → `PaginatedResponse<ExperimentSummary>` (remaps
  `experiments` → `items`).
- `getExperiment`, `getChromatogram`, `getDetectorChromatogram`, `getDetectors`
  → typed responses.
- `deleteExperiment` → void.
- `getInstruments`/`getSolvent`/`getSample`/`getFluidPath` → `any` (untyped;
  not yet consumed).

### `src/types/experiment.ts`
- `ExperimentSummary` — list-row shape.
- Config interfaces: `MALSConfig`, `RIConfig`, `UVConfig`, `ViscometerConfig`,
  `SampleConfig`, `FluidConnection`, `PeakInfo`.
- `ExperimentDetail` — full detail including all configs, `fluid_path`, and
  `peaks: PeakInfo[]`.
- `PaginatedResponse<T>` and `ExperimentListParams`.

### `src/types/chromatogram.ts`
- `MALSData` (`angles: number[]`, `data: number[][]` by angle),
  `RIData` (`data: number[]`), `UVData` (`wavelengths`, `data: number[][]`).
- `ChromatogramResponse` — `time`, `detectors: {MALS?, RI?, UV?}`,
  `downsampled`, `downsample_factor`, `point_count`.
- `DetectorSelection` (the selection state shape) and `DetectorDescriptor`
  (what `DetectorSelector` renders).
- `DetectorListResponse`.

### `src/stores/experimentStore.ts`
The Zustand store (see §3.2). Single `create<ExperimentStore>(...)` export
`useExperimentStore`. Selection sets are rebuilt immutably on every toggle
(`new Set(...)` + spread) so React sees new references.

### `src/components/layout/Header.tsx`
Pure presentational top bar: brand SVG + "ASTRA Reader / Chromatogram
Analysis" + a "Phase 1" caption. No props, no state.

### `src/components/layout/Sidebar.tsx`
- Embeds `<FileUpload/>` at the top.
- Local state: `localSearch` (input), `confirmDeleteId`.
- On mount: `fetchExperiments(1)`.
- Renders search form, count/pagination header, error banner, the experiment
  `<ul>` (selected row highlighted with `bg-brand-50` + left border), Prev/Next
  pagination when `totalPages > 1`.
- Per-row delete button with two-click confirm (3s timeout).
- Local `formatDate`/`formatSize` helpers.

### `src/components/upload/FileUpload.tsx`
- Drag-and-drop + click-to-browse; hidden `<input accept=".afe8" multiple>`.
- Validates extension (`.afe8`) and size (≤500 MB) before upload.
- Shows a progress bar during upload (driven by axios `onUploadProgress`).
- On success: refreshes the list via the store and shows a green banner for 5s.
- On error: red banner with joined messages.

### `src/components/MetadataPanel.tsx`
- Reads `experimentDetail` from the store; handles loading/error/empty states.
- Helper subcomponents `MetaSection` (titled block) and `MetaRow` (label/value
  pair, optional `mono`).
- Sections: File Info, Sample, Solvent, Instruments (MALS/RI/UV sub-blocks),
  Fluid Path (source → arrow → destination chips), Peaks (table with #, name,
  start, end, dn/dc, Mn, Mw).
- Local `formatSize`/`formatDateTime` helpers (duplicated from Sidebar).

### `src/components/chromatogram/DetectorSelector.tsx`
- Renders nothing (`return null`) when there are no descriptors.
- "Select All" / "Deselect All" buttons + three groups (MALS angles, RI, UV
  wavelengths) of checkboxes bound to store toggles.
- Returns `null` until an experiment is loaded, so it doesn't take layout space
  on the empty state.

### `src/components/chromatogram/ChromatogramPlot.tsx`
See §3.5. Notable details:
- `gradientColors(start, end, steps)` builds the per-trace color list.
- Traces are filtered by `detectorSelection` before being pushed; if no traces
  match, Plotly renders an empty plot (no explicit empty-state for "all
  deselected").
- Layout title falls back to `sample_config.name` if `sample_name` is null.
- `onRelayout` handler is a no-op (`ZoomControls` listens on the DOM directly).
- A downsample-warning banner is rendered below the plot when
  `chromatogram.downsampled`.

### `src/components/chromatogram/ZoomControls.tsx`
See §3.5. Receives `plotRef` (the div wrapping `<Plot/>`). State: `xAxisOnly`,
`timeRange`. Buttons: Reset Zoom, Auto-Scale Y, X-Axis Only Zoom checkbox, and
a right-aligned mono readout of the current X range.

### Config files
- `vite.config.ts` — React plugin; dev server on 5173; `/api` proxy to
  `localhost:8000` with `changeOrigin`; `build.chunkSizeWarningLimit: 5000`
  (raised because Plotly is large).
- `tailwind.config.js` — `content` scans `index.html` + `src/**`; extends
  `fontFamily.mono` and `colors.brand` (50–900 ramp).
- `postcss.config.js` — `tailwindcss` + `autoprefixer`.
- `tsconfig.json` — strict app config, `@/*` → `src/*` alias, `noEmit`
  (Vite handles bundling), references `tsconfig.node.json`.
- `tsconfig.node.json` — compiles `vite.config.ts` only; emits declarations to
  `node_modules/.tmp`.
- `Dockerfile` — `node:22-slim`, `npm ci`, `npm run build`, then `serve -s dist
  -l 5173`. Production container serves static files (no Vite dev server).
- `index.html` — Vite template; title "ASTRA Reader"; loads `/src/main.tsx`.
- `public/` — empty (no favicon deployed; `index.html` references `vite.svg`
  which isn't present — harmless 404).

---

## 5. Conventions a Future Agent Should Follow

- **Relative imports** everywhere (e.g. `../../stores/experimentStore`). The
  `@/*` alias is wired but unused; switching to it is a fine cleanup but stay
  consistent within a file.
- **No code comments** in the existing source except a few section banners.
  Match that style.
- **Strict TypeScript**: no `any` in app code except where Plotly's types force
  it (`modeBarButtonsToRemove as any`, `(window as any).Plotly`). The unused
  `getInstruments`/etc. return `any` — type them when you wire them up.
- **Zustand pattern**: keep state and actions in one `create(...)`; subscribe
  narrowly in components with selectors to avoid re-render storms.
- **Loading/error/empty** tri-state pattern for every async view.
- **Tailwind utility classes only**; no CSS modules; shared visual constants
  (color ramps) currently live in `ChromatogramPlot.tsx` — if a second chart
  appears, extract to a `constants.ts`.
- **Inline SVG icons** copy-pasted from Heroicons. No icon dependency.
- **Date/size formatters** are duplicated in `Sidebar` and `MetadataPanel`.
  When adding a third consumer, extract to `src/utils/format.ts`.

---

## 6. Known Gotchas / Smells

1. **Dual Plotly loading** — `react-plotly.js` is bundled (lazy) *and* the CDN
   script is injected in `App.tsx` so `window.Plotly` exists for `ZoomControls`.
   Both are version 2.35.2. If you upgrade one, upgrade the other. Prefer
   refactoring `ZoomControls` to use the bundled module via a forwarded ref.
2. **`getExperiment` is the only metadata call used.** The granular
   `/instruments`, `/solvent`, `/sample`, `/fluid-path`, `/detectors` endpoints
   are wired in `endpoints.ts` but unused. `MetadataPanel` reads everything
   from `experimentDetail`. If the detail payload grows too large, switch
   granular components to the granular endpoints.
3. **No routing.** `App.tsx` is the only view. When Phase 2+ adds analysis
   panels, introduce `react-router` (not in dependencies yet) or a view-state
   field in the store.
4. **No lint/test scripts.** `package.json` has only `dev`/`build`/`preview`.
   The architecture doc §9.6 plans React Testing Library + mocked Plotly; not
   set up.
5. **Detector selection resets to "all on" every time an experiment loads.**
   Intentional for now; if users want persistence, add it to the store.
6. **`index.html` references `/vite.svg`** but `public/` is empty → 404 on the
   favicon. Drop a real icon or remove the `<link>`.
7. **`detailLoading`/`chromatogramLoading` are set true together but cleared
   independently** in `loadExperimentData` — if one fetch fails, the other's
   flag still clears correctly, but the UI treats them as independent panes.
8. **`baseUrl: '/api'`** means the frontend relies on the Vite dev proxy
   (`vite.config.ts`) in dev and on same-origin/`serve` in Docker. For any other
   deployment, configure the proxy or set an `VITE_API_BASE_URL` env (not yet
   supported — `client.ts` hardcodes `/api`).
9. **`tsconfig.node.json` has `noEmit: false` + `emitDeclarationOnly: true`**
   writing into `node_modules/.tmp`. Don't be surprised by declaration files
   appearing there during build.

---

## 7. Roadmap (from `../architecture.md`)

Where the frontend is heading. Phases 2–8 are **not yet implemented**.

- **Phase 2** — Interactive baseline editor (drag handles), auto-baseline,
  interactive peak selector (drag region), peak parameter form, auto-peak
  detection, per-detector baseline view.
- **Phase 3a** — Procedure chain UI (visual pipeline), M(v) plot, Rg(v) plot,
  results table (Mn/Mw/Mz/Pd/radius), "One-Click Analysis" button.
- **Phase 3b** — Differential + cumulative distribution plots, angular fit
  view, fit-model selector (Zimm/Debye/Berry, 1st/2nd order).
- **Phase 4** — Conformation plot, Mark-Houwink plot, conjugate/branching/
  viscometry/calibration/particle panels, peak statistics table.
- **Phase 5** — Report designer, report preview, PDF/CSV/HTML export buttons,
  report template management.
- **Phase 6** — Batch upload & processing UI, method template manager, EASI
  Table (multi-run comparison), EASI Graph (overlay multiple runs).
- **Phase 7** — "Save .afe8" / "Save As" buttons, unsaved-changes indicator,
  HTML report export.
- **Phase 8** — Zimm plot (A2), dn/dc determination panel, performance
  optimization, test suite.

The planned module tree (architecture.md §3.4) is much larger than what exists
today; new work should slot into those planned folders (`analysis/`, `plots/`,
`results/`, `reports/`, `tables/`) and add the corresponding stores
(`baselineStore`, `peakStore`, `procedureStore`, `settingsStore`).

---

## 8. Quick Reference: Backend Contract

The frontend talks to a FastAPI backend at `/api` (proxied to `:8000` in dev).
Endpoints actually consumed today:

| Call | Path | Used by |
|---|---|---|
| `uploadFiles` | `POST /files/upload` (multipart) | `FileUpload` |
| `listExperiments` | `GET /files?page=&limit=&sample_name=&date_from=&date_to=` | `Sidebar` via store |
| `getExperiment` | `GET /files/{id}` | `MetadataPanel` via store |
| `deleteExperiment` | `DELETE /files/{id}` | `Sidebar` via store |
| `getChromatogram` | `GET /experiments/{id}/chromatograms` | `ChromatogramPlot` via store |

Errors return `{ detail: string }` (FastAPI's default). The axios interceptor
extracts `detail` and rejects with `new Error(message)`. Mutating endpoints
will later require an `X-Resource-Version` header for optimistic locking
(architecture.md §5.13) — not wired yet.