# Architecture Documentation — mcp-ink-design

## 1. System Overview

`mcp-ink-design` is a Model Context Protocol (MCP) server engineered to provide high-craft web design, anti-AI-slop heuristics, Three.js 3D capabilities, frontend security auditing, and external Python verification.

## 2. Layering & Module Boundaries

The codebase adheres strictly to the MarwanDevMCP layered architecture:

```text
src/
├── index.ts                # Transport entry point (StdioServerTransport)
├── server.ts               # Server assembly, MCP registration & error contract
├── config/                 # Typed environment & configuration
├── core/                   # Stderr logger, error taxonomy, result envelopes
├── contracts/              # Zod input/output schemas for all 14 tools
├── master/                 # INK_MASTER.md loader & philosophy provider
├── tools/                  # 14 Public tool modules
├── resources/              # 3 MCP resource providers
├── prompts/                # 2 MCP guided prompts
├── domain/                 # Domain capabilities (zero transport dependencies)
│   ├── design-tokens/      # Color math, gamut mapping, palettes, gradients,
│   │                       # typography, spacing
│   ├── components/         # High-craft UI templates with micro-interactions
│   ├── threejs/            # WebGL scene generation with memory cleanup
│   ├── security/           # OWASP heuristics, CSP generation, Auth patterns
│   ├── bidi/               # Logical properties + optical centering auditors
│   ├── inspection/         # Style extraction with real color conversion
│   └── verification/       # Design scoring & anti-slop rules
└── integrations/
    └── python/             # Child process bridge with stdin JSON streaming
```

### Dependency Rules:
1. `domain` has no knowledge of MCP SDK or transport layers. It operates purely on inputs and returns typed domain artifacts.
2. `tools` adapt validated input schemas (from `contracts`) to `domain` functions, wrapping outputs in standard `ResultEnvelope` structures.
3. `server.ts` acts solely as an assembly point.
4. `core/logger.ts` writes exclusively to `stderr` to maintain protocol purity on `stdout`.

### Color pipeline (single source of truth)

```text
OKLCH request
   │  gamut-mapper.mapToGamut(l, c, h, target)
   │    1. L >= 1 -> white, L <= 0 -> black (CSS Color 4 §14.2)
   │    2. in-gamut check on the TARGET gamut's channels (epsilon 1e-9)
   │    3. binary search with local MINDE (JND 0.02, MINDE 0.01,
   │       chroma epsilon 1e-4) - deltaEOK measured in OKLab
   │       through targetChannelsToOklab(clipped, target), so P3
   │       channels are never scored with the sRGB decoder
   │    4. constant-L/H chroma trim so the published OKLCH converts back in gamut
   ▼
GamutMapResult {
  original, oklch,          // requested AND mapped OKLCH (mapping reported)
  channels,                 // target-gamut channels (P3 channels when target=p3)
  srgb, hex,                // INDEPENDENT sRGB mapping (never P3 as #rrggbb)
  css, srgbCss, inSrgb, deltaEOK, iterations
}
   │
   ├─► palette tokens / gradient stops  (roundOklchForCss + serialize-check)
   └─► WCAG 2.1 contrast on `hex` (8-bit sRGB) - decisions from ratioExact
       APCA 0.98G on `hex` (APCA-specific Ys luminance)
       apcaGuidanceForFont -> published APCA font lookup (apcaFontLookup)
```

WCAG 2.x is defined only for sRGB, so contrast is always measured on the
exported 8-bit sRGB fallback, even for `target: "p3"`. This keeps the audit
and the exported colors in agreement.

APCA font-aware guidance resolves the published apca-w3 `fontLookupAPCA` table
(`apcaFontLookup`) rather than approximating it: every payload reports
`lookupLcRow`, `lookupWeight`, `clampedToTable`, `basis:
"apca-0.1.7-G-lookup"` and reference `APCA font lookup, Public Beta 0.1.7 (G)
2022-05-28`. The table tops out at `APCA_FONT_MAX_LC` = 125 (beyond it the last
row is used and `clampedToTable` is set), and the sentinel codes `999`
(`APCA_FONT_PROHIBITED`) and `777` (`APCA_FONT_NON_TEXT_ONLY`) never pass for
real text. `ink_validate_design.textUse: "body"` applies APCA's documented `+15
Lc` adjustment below Lc 70; `apcaGuidance` keeps the simplified,
font-size-agnostic `Body`/`Large`/`Fail` tiers.

### Gradient pipeline (authored stops → CSS + contrast)

```text
AuthoredStops[{oklch, position?, alpha?}]
   │  validateAuthoredStops: finite, within [0,1], non-decreasing, >= 2 stops
   │  interpolateAt(position, space, huePath)
   │    alpha < 1 -> CSS Color 4 §13.4 premultiplied interpolation, per space:
   │      oklab (rectangular): L, a and b premultiplied
   │      oklch (polar):        L and C premultiplied, hue interpolated
   ▼
GradientStop[]  ──► buildGradientCss(stops, direction, space, render, huePath)
   │  linear-gradient(<direction> in oklch <huePath> hue | in oklab, ...)
   │  alpha serialized INSIDE the function: oklch(L C H / A),
   │  color(display-p3 r g b / A)
   │  stop positions emitted whenever they differ from implicit even spacing
   ├─► css (target gamut) / cssSrgb / cssP3 (independent per-gamut mappings)
   └─► contrastOverGradient(): each sample alpha-composited over
       contrastBackdropHex (default #ffffff) before WCAG/APCA, reported as
       backdropHex, compositedAlpha and per-sample backgroundHexOpaque /
       backgroundAlpha
```

Rectangular OKLab has no hue axis, so its emitted gradient carries no hue
interpolation method; direction strings are unchanged (`to right`, `to bottom`,
…).

## 3. Tool Invocation Pipeline (All 14 Standardized Tools)

The recommended choreography for building or enhancing a web page:
1. `ink_generate_palette_tokens`: Generate OKLCH ramps, semantic tokens, audited contrast, fluid typography and spacing.
2. `ink_generate_fluid_scale`: Produce arbitrary fluid `clamp()` values with verified endpoints.
3. `ink_create_base`: Scaffold semantic HTML5 layout and CSS structure.
4. `ink_craft_component`: Generate tactile components (Hero, Cards, Buttons, Nav).
5. `ink_generate_script_logic`: Implement zero-dependency client state/events.
6. `ink_build_threejs_experience`: Mount interactive 3D WebGL hero background.
7. `ink_import_custom_assets`: Import and configure multilingual web fonts and fallbacks.
8. `ink_inspect_website_style`: Deconstruct reference website styling into OKLCH tokens.
9. `ink_audit_security`: Verify CSP, sanitize DOM, review Auth flows.
10. `ink_validate_design`: Verify craft score, exact WCAG contrast, APCA 0.98G (including the published font lookup), RTL/LTR properties and optical centering.
11. `ink_generate_gradient`: Interpolate perceptual gradients with authored stops, dual-gamut exports and backdrop-composited contrast sampling.
12. `ink_generate_spacing_scale`: Generate modular/fluid spacing tokens.
13. `ink_capture_viewport`: Capture 16:9, 9:16, and mobile snapshots for layout verification (writes files).
14. `ink_run_python_tests`: Run the external Python verification suite (capture writes files, inspect fetches URLs).

## 4. MCP Error Contract

- `status: "success" | "partial" | "blocked"` → `structuredContent` is published and validated against the tool's output schema.
- `status: "failed"` → the server returns a proper MCP error result (`isError: true`) with the original message and **no** `structuredContent`, so an execution failure can never be reshaped into an output-validation error that hides the backend message.
- Schema-invalid input (including cross-field rules such as `maxVw > minVw` and `steps` being an integer) is rejected by the SDK before execution and surfaces as an `isError: true` input-validation result.