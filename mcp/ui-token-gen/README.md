# mcp-ink-design ✒️

> **Model Context Protocol (MCP) Server for High-Craft Web Design & Engineering.**  
> Defeating "AI Slop" through audited OKLCH color ramps, reference-conformant APCA contrast, mathematical fluid typography, layered physical depth, Three.js 3D experiences, OWASP security audits, and dedicated Python verification.

---

## 💎 The Anti-AI-Slop Manifesto (`INK_MASTER.md`)

Most AI-generated web interfaces look generic, repetitive, and bland:
- Cliche `#6366f1` / `#a855f7` purple-to-blue linear gradients on dark cards.
- Rigid pixel typography that breaks or looks clumsy on mobile devices.
- Single harsh black drop-shadows instead of layered ambient occlusion.
- Div-heavy markup lacking semantic landmarks (`<main>`, `<header>`, `<nav>`).
- Dangerous client-side DOM injections (`innerHTML`, `eval`) and tokens stored in `localStorage`.

**`mcp-ink-design` enforces a human-grade architectural standard:**
1. **Perceptually Uniform OKLCH Ramps**: Configurable ramp steps, endpoints, chroma profiles and a real cubic-Bezier eased lightness curve.
2. **Audited Accessibility**: WCAG 2.1 decisions taken on the **full-precision** contrast ratio, plus reference-conformant **APCA 0.98G** lightness contrast.
3. **Honest Wide-Gamut Exports**: CSS Color 4 gamut mapping with an explicit target gamut, Display P3 channels never encoded as hex, and contrast measured on the exported sRGB fallback.
4. **Mathematical Fluid Typography & Spacing**: `clamp(min, preferred, max)` with configurable root font size and verified endpoints.
5. **Tactile Micro-Interactions**: Real physical response curves (`cubic-bezier(0.16, 1, 0.3, 1)`).
6. **Zero-Trust Security & Auth**: Strict Content Security Policy (CSP), safe DOM sinks, and HttpOnly cookie architecture.
7. **External Verification Suite**: Automated Python linter for AST security, WCAG/APCA contrast maths, and design heuristics — numerically consistent with the TypeScript engine.

---

## 🛠️ Tool Suite (`tools/list` — 14 Standardized Tools)

All tools follow the MCP Glama Benchmark standards (`ink_<verb>_<noun>`, explicit annotations, typed output schemas, and operational usage guidelines):

| Canonical Tool Name | Title | Annotations | Purpose |
|---|---|---|---|
| `ink_create_base` | Scaffold Web Application Foundation | `readOnlyHint: true` | Scaffolds semantic HTML5, CSS architecture, OKLCH tokens, and main.js |
| `ink_generate_palette_tokens` | Generate OKLCH Palette & Design Tokens | `readOnlyHint: true` | Perceptual ramps, semantic tokens, full WCAG/APCA pair audit, correction mode, typography + spacing |
| `ink_generate_fluid_scale` | Generate Fluid Clamp Scale | `readOnlyHint: true` | Arbitrary `clamp()` values with configurable root font size and verified endpoints |
| `ink_craft_component` | Craft UI Component with Tactile Physics | `readOnlyHint: true` | Tactile components (`glass-card`, `tactile-button`, `hero-section`, `navigation-bar`, …) |
| `ink_build_threejs_experience` | Build 3D WebGL Canvas Experience | `readOnlyHint: true` | Memory-safe Three.js canvas experiences (`particle-constellation`, `geometric-wireframe`, …) |
| `ink_generate_script_logic` | Generate Modular Architecture Logic | `readOnlyHint: true` | Zero-dependency logic modules (`state-store`, `event-bus`, `scroll-observer`, `form-validator`) |
| `ink_audit_security` | Audit Frontend Code Security & Headers | `readOnlyHint: true` | DOM XSS, eval, token leakage, tailored CSP headers |
| `ink_validate_design` | Validate Design Craft & Contrast Compliance | `readOnlyHint: true` | Craft grade, exact WCAG verdict, APCA 0.98G + published font lookup, logical properties, optical centering |
| `ink_run_python_tests` | Run Python Verification Suite | `readOnlyHint: false`, `openWorldHint: true` | Python AST/contrast suite; `capture` writes files and `inspect` fetches URLs |
| `ink_capture_viewport` | Capture Multi-Viewport Responsive Snapshots | `readOnlyHint: false`, `openWorldHint: true` | 16:9 Desktop, 9:16 Story, and 390x844 Mobile snapshots (writes PNG/SVG) |
| `ink_inspect_website_style` | Inspect & Reverse-Engineer Website Style | `readOnlyHint: true`, `openWorldHint: true` | Converts extracted colors to OKLCH with real color math (inline **and** URL) |
| `ink_import_custom_assets` | Import & Configure Web Fonts and Assets | `readOnlyHint: true` | Google Fonts imports (Arabic & Latin) with optical line-heights |
| `ink_generate_gradient` | Generate Perceptual OKLCH/OKLab Gradient | `readOnlyHint: true` | Authored stops, alpha, serialized hue paths, dual sRGB/P3 exports, backdrop-composited contrast sampling |
| `ink_generate_spacing_scale` | Generate Fluid Spacing Scale | `readOnlyHint: true` | Modular scale with configurable steps, fluid factor and root font size |

### Tool result contract

- `success` / `partial` / `blocked` → `structuredContent` conforming to the declared output schema.
- `failed` → a proper MCP error result (`isError: true`) that preserves the underlying backend message. Failure payloads are never reshaped into output-validation errors.

---

## 🎨 Color, Contrast & Gamut Policies

| Policy | Implementation |
|---|---|
| WCAG ratio | `linear(v) = v/12.92` (v ≤ 0.04045) else `((v+0.055)/1.055)^2.4`; `Y = 0.2126R + 0.7152G + 0.0722B`; `ratio = (max+0.05)/(min+0.05)` |
| Compliance decision | Taken from `ratioExact` (full precision). `ratio` is the 2-decimal display value only. Thresholds: AA 4.5, AAA 7, large AA 3, large AAA 4.5, UI 3 |
| Regression | `#148700` on `#000000` = 4.4953336599 → displays 4.50, **fails** normal-text AA |
| APCA | APCA-W3 0.98G reference equations (APCA-specific `Ys = 0.2126729R^2.4 + 0.7151522G^2.4 + 0.0721750B^2.4`, black soft clamp at Y ≤ 0.022 with exponent 1.414, polarity exponents 0.56/0.57 and 0.65/0.62, scale 1.14, low-contrast clip ±0.1, offsets ∓0.027, ΔY guard 0.0005). No arbitrary output clamp. Verified vectors: `#777777`/`#ffffff` = +71.1111 Lc, `#888888`/`#777777` = −7.3202 Lc (tolerance 0.01) |
| APCA guidance | Two paths. `apcaGuidance` keeps the **simplified, font-size-agnostic** tiers (`Body` at \|Lc\| ≥ 60, `Large` at ≥ 45). `apcaGuidanceForFont` evaluates the **published lookup** (`apcaFontLookup`, `basis: "apca-0.1.7-G-lookup"`, reference `APCA font lookup, Public Beta 0.1.7 (G) 2022-05-28`) and reports `lookupLcRow`, `lookupWeight` and `clampedToTable`; supply `textFontSizePx`/`textFontWeight` to `ink_validate_design` to get it, and `textUse: "body"` to apply APCA's documented `+15 Lc` adjustment below Lc 70 |
| APCA font lookup limits | `APCA_FONT_MAX_LC` = 125; `\|Lc\|` above it uses the last table row and reports `clampedToTable`. Sentinel `999` (`APCA_FONT_PROHIBITED`) and `777` (`APCA_FONT_NON_TEXT_ONLY`) are surfaced as sentinels and never pass for real text; weights between published columns snap to the nearest one |
| Gamut mapping | CSS Color 4 §14.2 "binary search with local MINDE": JND 0.02, MINDE 0.01, chroma ε 1e-4, gamut test ε 1e-9, serialized-channel check half an 8-bit step (1/510). `deltaEOK` is measured in the **target** gamut — clipped target channels (sRGB or Display P3) are decoded by `targetChannelsToOklab`, so P3 mapping is no longer scored through the sRGB decoder |
| Gradient CSS | Alpha is serialized **inside** the color function (`oklch(0.750 0.120 40 / 0.500)`, `color(display-p3 0.7 0.2 0.1 / 0.5)`). The interpolation method is always written — `linear-gradient(to right in oklch shorter hue, …)`, with no hue keyword for the rectangular `oklab` space. Authored stop positions are emitted whenever they differ from implicit even spacing, so two authored stops at `0.2`/`0.8` serialize as `… 20%, … 80%` |
| Gradient transparency | CSS Color 4 §13.4 premultiplied alpha is applied in the selected space: `L`, `a`, `b` for rectangular OKLab; `L` and `C` with an unpremultiplied hue for cylindrical OKLCH, so equal-alpha polar stops keep their chroma and hue arc. Equal alpha on all stops keeps plain interpolation exactly |
| Gradient contrast | WCAG/APCA are defined on opaque colors, so every sample is alpha-composited over `contrastBackdropHex` (default `#ffffff`) before measuring; an invalid backdrop hex throws `RangeError`. The report publishes `backdropHex` and `compositedAlpha`, and each sample adds `backgroundHexOpaque` and `backgroundAlpha` while `backgroundHex` is the composited color that was actually measured |
| Gamut exports | Target-gamut channels are labelled (`channels` = P3 when `target: "p3"`), exported as `color(display-p3 r g b)`; hex fallbacks always come from an **independent sRGB mapping** — P3 channels are never re-encoded as `#rrggbb` |
| Contrast basis | WCAG/APCA are always measured on the exported 8-bit sRGB fallback (WCAG 2.x is sRGB-only), so audit and export always agree |

---

## 🌍 Arabic Typography & RTL/LTR Logical Properties

- **Modern CSS Logical Properties**: `margin-inline`, `padding-inline`, `inset-inline`, `text-align: start`.
- **Arabic Optical Compensation**: line-heights tuned to `1.75 – 1.85` for body text.
- **Curated Arabic Font Stacks**: `IBM Plex Sans Arabic`, `Cairo`, `Tajawal`, `Readex Pro`, `Amiri`.
- **Bidi Isolation**: `<bdi>` wrapping and `unicode-bidi: isolate`.
- **Optical Centering Audit** (`checkCentering`): centered body copy, `100vw` overflow, oversized fixed widths, auto margins without `max-width`, over-tight tracking.

---

## 📸 Multi-Viewport Capture (16:9, 9:16, Mobile)

`ink_capture_viewport` captures 16:9 landscape, 9:16 vertical story, and 390x844 mobile viewports, writing one image per viewport (deterministic SVG fallback when no local Chromium/Chrome/Edge is available, reported as `format`). Each headless render gets a 30s budget; a browser timeout is caught explicitly (partial screenshot removed, clean `false` return, message on stderr) and the SVG fallback is used. `INK_CAPTURE_SKIP_BROWSER=1` forces the deterministic SVG fallback, which the Python suite sets for its capture tests so the suite never depends on a local Chrome install. This tool **writes files** and can fetch remote URLs.

## 📖 MCP Resources & Prompts

- **`ink://master/philosophy`**, **`ink://tokens/design-presets`**, **`ink://security/owasp-frontend`**
- **`ink_creative_direction`**, **`ink_anti_slop_audit`**

---

## 🚀 Installation & Client Setup

```json
{
  "mcpServers": {
    "ink-design": {
      "command": "npx",
      "args": ["-y", "mcp-ink-design"],
      "env": { "INK_PYTHON_PATH": "python" }
    }
  }
}
```

Local development: `command: "node"`, `args: ["<repo>/dist/index.js"]`.

---

## 🐍 Python Verification Suite (`python/ink_verifier`)

The Python engine is numerically consistent with the TypeScript engine (cross-checked by the test suite):

```bash
python -m unittest discover -s python/test

echo '{"foreground": "#148700", "background": "#000000"}' | python -m python.ink_verifier.cli --action contrast --stdin
echo '{"code": "element.innerHTML = userVal;"}' | python -m python.ink_verifier.cli --action security --stdin
```

Behavior notes:
- WCAG compliance is classified from `ratio_exact`; only `ratio` is rounded.
- `contrast` also reports APCA 0.98G (`apca.lc_exact`).
- Unparseable colors raise a `ValueError` and are reported as an error result instead of silently resolving to black.

---

## 🧪 Development & Quality Gates

```bash
npm run typecheck        # tsc --noEmit
npm test                 # vitest run (unit + contract + MCP transport + python bridge)
npm run test:python      # python -m unittest discover -s python/test
npm run build            # tsc -> dist/

# Audit probes
node docs/audit-2026-10-03/verify.mjs        # post-fix behavior probe (writes verification-results-postfix.json)
node docs/audit-2026-10-03/verify-dist.mjs   # packaged executable smoke test
```

---

## 📜 License

MIT License — Created by MarwanDevMCP.