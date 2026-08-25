# SYSTEMA — Your Music System

A premium intelligent music player frontend. **Swiss International Typographic Style**
meets contemporary architectural graphic design — systematic, structured, precise.

**Nuxt 4 · Vue 3 · TypeScript · Nuxt UI 3 · UnoCSS · VueUse · Lucide**

---

## 1. Stack & version decisions

| Package         | Version   | Role                                              |
|-----------------|-----------|---------------------------------------------------|
| nuxt            | 4.5.2     | Framework (app/ directory architecture)           |
| vue             | 3.5.41    | UI library                                        |
| @nuxt/ui        | 3.3.7     | Interaction primitives (palette, drawers, sliders, modals…) |
| unocss          | 66.8.1    | **Primary styling & design-token system**         |
| @vueuse/nuxt    | 14.4.0    | Utilities (local storage, media queries…)         |
| @iconify-json/lucide | 1.2.126 | Icon set                                        |
| @nuxt/fonts     | 0.14.x    | Inter + Vazirmatn (Persian)                       |

> **Why Nuxt UI 3.3.7 and not 4.x?** Nuxt UI 4 is built on Tailwind CSS v4 and
> requires it as a peer dependency — which directly conflicts with this project's
> mandate that **UnoCSS is the styling system and Tailwind is not used**.
> Nuxt UI 3.x supports Nuxt 4 and composes cleanly with UnoCSS.

## 2. Architecture

```
app/
├── assets/css/main.css     # design tokens (all themes) + base styles
├── components/             # shared / layout / player / library / search /
│                           # playlists / ai / settings (flat naming, pathPrefix: false)
├── composables/            # useTheme · usePlayer · useMusicLibrary · useSearch ·
│                           # usePlaylists · useAI · useQuickSearch · useAIInsightsData
├── data/                   # mock catalog (tracks/albums/artists/genres/playlists/AI)
├── layouts/default.vue     # AppShell
├── middleware/theme.global.ts
├── pages/                  # all routes (see below)
├── plugins/theme.client.ts # pre-paint theme application
├── public/art/*.jpg        # album artwork (AI-generated + procedural)
└── app.vue
```

### Routes

```
/                     Home — editorial music dashboard + AI insights strip
/search               Text search + AI semantic search
/library              → /library/tracks
/library/tracks       Structured archive list
/library/albums       Grid + ?album= detail panel
/library/artists      List + ?artist= detail panel
/library/genres       Categorized genre sections
/playlists            Archive grid + create / import / export
/playlists/[id]       Detail: edit · reorder · delete · import · export
/ai                   AI Studio — WHAT DO YOU WANT TO HEAR?
/ai/search            Semantic search with staged engine states
/ai/generate          Playlist generation pipeline
/ai/insights          Your music profile
/settings             8 categories (appearance · playback · library · ai ·
                      import/export · storage · privacy · about)
```

### Application shell

```
DesktopSidebar (lg+)          MobileHeader + MobileDock (<lg)
  SYSTEMA                        QUICK SEARCH
  DISCOVER · LIBRARY ·            MINI PLAYER (when playing)
  INTELLIGENCE · SETTINGS         HOME · LIBRARY · SEARCH · AI
MiniPlayer (desktop bottom bar) + FullPlayer overlay + QueueDrawer
```

- **⌘K / Ctrl+K** opens the command palette (pages · tracks · albums · artists ·
  playlists · AI search). **Space** toggles play/pause.
- Quick Search distinguishes *text* results from *AI semantic* search
  (non-Latin scripts and descriptive phrases route to `/ai/search`).

## 3. Design system

Single source of truth in `uno.config.ts` + `app/assets/css/main.css`.
Every visual property resolves to a semantic CSS variable — components never
hardcode colors, spacing, radii or shadows.

**Music themes** (swap tokens, never components):

| Theme   | Identity            | data-theme |
|---------|---------------------|------------|
| DEFAULT | White / deep blue   | `default`  |
| PREMIUM | White / restrained gold | `premium` |
| DARK    | Near-black monochrome | `dark`    |

**AI visual system** — fixed `--ai-*` tokens (near-black, violet/magenta, glow):
all Intelligence pages render through `<AIStage>` which keeps SYSTEMA's grid,
spacing and typography while layering atmospheric surfaces on top.

Typographic scale: `micro → small → body → lead → title → h2 → h1 → display → display-xl`
with Inter (Neo-Grotesk) + Vazirmatn for Persian strings. 4px spacing scale,
radii 0/2/4/6px, hairline borders, restrained shadows, tabular numbers for indexes.

## 4. State boundaries (future native integration)

Composables are the only API the UI touches. Later adapters can back them
without frontend rewrites:

| Composable       | Future implementation                          |
|------------------|------------------------------------------------|
| usePlayer        | Media3 / ExoPlayer / MediaSession via Capacitor |
| useMusicLibrary  | MediaStore + Room (SQLite)                     |
| usePlaylists     | Room + native file system (import/export)      |
| useAI            | ONNX Runtime local inference / WorkManager     |
| useTheme         | (stays frontend — token swap)                  |

Everything is currently mock state; AI pipelines simulate staged states
(UNDERSTANDING → SEARCHING → RANKING, ANALYZING → … → FINALIZING).

## 5. Commands

```bash
npm install            # --legacy-peer-deps if npm 10 arborist errors
npm run dev            # http://localhost:3000
npm run build          # production build
npm run preview        # preview production build
```

## 6. Accessibility & motion

Semantic HTML, keyboard navigation (palette, arrows, space, esc), visible focus
rings, aria-labels/pressed/current states, touch targets ≥ 40px, sufficient
contrast, and `prefers-reduced-motion` kills all animation. Music UI uses subtle
functional transitions (160ms); AI pages use slower atmospheric ones (320ms).

---

*SYSTEMA — a precise Swiss music archive, a powerful playback engine,
a futuristic AI studio. Frontend architecture only; native layers plug in later.*
