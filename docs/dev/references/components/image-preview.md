---
description: Current Mermaid, PlantUML, SVG, and Graphviz preview pipeline with sanitized Shadow DOM rendering and shared controls
sources:
  - scripts/plantumlSandbox.ts
  - src/renderer/components/Preview
  - packages/ui/src/lib/mermaid
  - src/renderer/services/MermaidRenderService.ts
  - src/renderer/workers/mermaid.worker.ts
---

# Image Preview Components

`src/renderer/components/Preview/` provides the special-language previews used
by `CodeBlockView`. The current language mapping is:

| Code language | Component | Renderer |
|---|---|---|
| `mermaid` | `MermaidPreview` | Merman (Rust Mermaid compiled to WASM) through `@cherrystudio/ui/mermaid` |
| `plantuml` | `PlantUmlPreview` | Bundled `@plantuml/core` engine in an isolated local iframe |
| `svg` | `SvgPreview` | Supplied SVG string |
| `dot`, `graphviz` | `GraphvizPreview` | Lazily initialized `@viz-js/viz` instance |

The four components are lazy-loaded by
`CodeBlockView/constants.ts::SPECIAL_VIEW_COMPONENTS`.

## Shared rendering path

Each preview passes its renderer to `useDebouncedRender`, then renders the
result through `ImagePreviewLayout`:

```text
source change
  → useDebouncedRender (300 ms by current callers)
  → format-specific renderer
  → renderSvgInShadowHost
  → ImagePreviewLayout
    ├─ loading overlay or error
    ├─ sanitized SVG in Shadow DOM
    └─ optional ImageToolbar
```

`useDebouncedRender` owns the host ref, loading/error state, debounced trigger,
cancel, and an optional `shouldRender` predicate. Rendering runs inside
`React.startTransition`. Cancelling drops a pending debounce; it does not abort
an asynchronous render that has already started.

## SVG boundary

All four formats end at `renderSvgInShadowHost`. Before parsing, it sanitizes the
SVG with DOMPurify, allowing the additional SVG tags/attributes required by the
renderers. It then parses the result as SVG, falls back to an HTML parse only to
recover an SVG element, normalizes its sizing, and mounts it in an open Shadow
DOM with local base styles. Sizing defaults to `fit: 'width'`: the SVG scales to
the host's width up to its own width. `fit: 'contain'` also fits the host's
height, centres the SVG, and never enlarges it past its own height; it is meant
for hosts with a fixed height, such as the Mermaid file preview.

Shadow DOM provides style isolation; DOMPurify is the content-safety boundary.
Do not replace this path with direct `innerHTML` in a preview component.

## Shared layout and controls

`ImagePreviewLayout` uses `useImageTools` for pan, zoom, copy, download, and
expanded-dialog behavior. When `enableToolbar` is true, `ImageToolbar` exposes:

- four-direction pan in 20 px steps;
- zoom in/out in 0.1 steps;
- reset to absolute pan `(0, 0)` and zoom `1`;
- expanded dialog.

The layout exposes pan, zoom, copy, download, and the expanded dialog through
its preview ref so `CodeBlockView` tools and the RichEditor code block toolbar
can operate on the same SVG. The Notes editor keeps zoom and pan in the
expanded dialog, because an inline diagram scrolls with the note.

SVG, Graphviz, PlantUML, and Mermaid diagrams are centered in their host.

## Format-specific behavior

### Mermaid

`MermaidPreview` renders through `mermaidRenderService`, which runs
`renderMermaidSvg` from `@cherrystudio/ui/mermaid` in a dedicated Web Worker
(`workers/mermaid.worker.ts`), so layout never blocks the window. The service
keeps one render in flight; a newer request for a diagram still waiting in the
queue replaces it, and every caller of that diagram receives the newer SVG. A
render that runs longer than 10 s is stopped by terminating the worker, and a
crashed worker is replaced on the next request. Rendering does not depend on the
container's size, so folded or hidden diagrams render like visible ones.

Labels are measured with an `OffscreenCanvas` (`canvas-text-measurer.ts`), which
works in the worker and matches Merman's DOM-based browser measurer within half a
pixel. The worker loads the page's `@font-face` web fonts for the theme's font
list (`fonts.ts`), because a worker cannot see the page's fonts; without them it
would measure with a fallback font and labels would not fit.

The theme comes from `resolveMermaidTheme(container)`: Merman's semantic roles
map to design tokens (`--muted` node fill, `--foreground` text, `--border-strong`
borders, `--muted-foreground` lines, `--chart-1` to `--chart-5` for categorical
series). The canvas is the colour actually painted behind the preview, with every
translucent ancestor layer composited, and the SVG background stays transparent,
so a diagram sits directly on its surface. Labels use the document body font.
Node drop shadows are turned off. The preview re-renders when the app theme
changes.

Merman's `interactive` resource profile is used with only its layout-work limit
raised, because the default already rejects a 200-node flowchart. Time is bounded
by the worker deadline instead.
When a newer source fails to render, the previous diagram stays in place under
the error.

### PlantUML

`PlantUmlPreview` renders with the MIT `@plantuml/core` npm distribution, pinned
to `1.2026.9`, and the bundled Viz graph engine. No Java installation or remote
PlantUML server is required. Themes, emoji and OpenIconic resources are bundled;
external files, standard-library downloads and network images are disabled.
Diagrams requiring those resources need to be rewritten using local syntax.

`scripts/plantumlSandbox.ts` emits a self-contained HTML asset in production and
serves the same asset during development. Its hash-authorized script runs in an
iframe with `sandbox="allow-scripts"`, without same-origin access. Its own CSP
blocks network connections and external scripts, fonts, styles and images. The
parent window's CSP is unchanged. File and standard-library loader hooks reject
resource requests as an additional boundary.

Source is passed through a frame-bound `postMessage` exchange, not a URL. Only a
response from that frame with the current request ID is accepted. The result
passes a stricter offline SVG sanitizer before the shared Shadow DOM renderer:
no scripts, links, image elements, animation, foreign HTML or external CSS URLs;
local fragment references, geometry, labels and basic styling remain supported.
The sanitized SVG is also the source used by copy and download controls.

New renders and unmounts cancel the prior frame. Input is limited to 100,000
characters and returned SVG to 8 MiB of characters. A missing response times out
after 20 seconds when the renderer event loop is responsive; this is not a hard
CPU deadline. Rendering errors use the shared error state and retain the last
successful diagram. There is no network fallback.

### SVG

`SvgPreview` sends the supplied string directly through the shared sanitizer,
parser, size normalization, and Shadow DOM renderer.

### Graphviz

`GraphvizPreview` initializes one shared `@viz-js/viz` instance on demand,
renders DOT to SVG locally, and sends the result through the shared SVG path.
Like Mermaid, it draws on a transparent background: border, line, and text
colours come from `resolveMermaidTheme(container)`, with Helvetica as the label
face because Graphviz has metrics for it. These defaults are prepended to the
graph body as `graph`/`node`/`edge` statements, because Viz ignores its default
attribute options for parsed nodes; colours the DOT source sets still win. The
preview re-renders when the app theme changes.

PlantUML keeps a white backing because its diagram colours are defined by the
PlantUML source and theme, independently of the application theme.

## Verification

```bash
pnpm test:renderer src/renderer/components/Preview/__tests__/localPlantuml.test.ts src/renderer/components/Preview/__tests__/PlantUmlPreview.test.tsx src/renderer/components/Preview/__tests__/utils.test.ts src/renderer/components/Preview/__tests__/useDebouncedRender.test.ts
```

Unit tests cannot establish Chromium CSP behavior. Validate the built local HTML
asset in the pinned Electron version with both main-window and quick-assistant
CSPs, an isolated profile, network-request recording, local sequence/class/theme
diagrams and attempted external includes/images. Development serving and an
installed packaged application need their own runtime checks.
