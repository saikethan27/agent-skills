---
name: ui-token-gen
description: Generate OKLCH design tokens with CSS Color 4 gamut mapping, configurable perceptual ramps, perceptual OKLCH/OKLab gradients, modular + fluid spacing and typography scales, and audited WCAG 2.1 + APCA 0.98G contrast validation via the mcp-ink-design MCP server (14 tools). Use when creating design systems, color ramps, spacing or fluid type scales, gradients, or validating contrast and craft.
license: MIT
metadata:
  version: "1.3.0"
  server: mcp-ink-design
  tools: 14
  cli: mcp-ink-design
---

# ui-token-gen v1.3.0

MCP design-token server: OKLCH palettes and ramps with CSS Color 4 gamut mapping, exact-ratio WCAG 2.1 verdicts, reference-conformant APCA 0.98G, fluid typography and spacing, perceptual gradients with authored stops and dual sRGB/P3 exports.

## When to use / not use

Use: new design systems, palette + spacing + type scales, in-gamut gradients, contrast checks.
Do NOT use: full-page scaffold without tokens (use `ink_create_base` first), live-site reverse-engineer (use `ink_inspect_website_style`), JS vuln scan (use `ink_audit_security`), screenshots (use `ink_capture_viewport`).

## Tool table (14)

| Tool | Key params |
|---|---|
| `ink_create_base` | `projectName, designStyle, direction, language, arabicFont, includeThreeJs, includePwaMeta` |
| `ink_generate_palette_tokens` | `mood, baseHue?, target=srgb\|p3, rampSteps?, lightnessMode=equal\|eased, lightnessEasing=[x1,y1,x2,y2]?, chromaProfile?, ramps{surface,text,accent}?, contrastTarget=aa\|aaa\|aa-large\|none, correctionMode=none\|text-lightness\|both, maxCorrectionDelta=0.35, includeTypography=true, typographyBasePx=16, typographyRatio=1.25, typographyStepRange=[-1,5], rootFontPx=16, includeArabicTokens=true, minVw=360, maxVw=1440, spacingBase=16, spacingRatio=1.25, spacingFluid=false, spacingFluidMinFactor=0.85` |
| `ink_generate_fluid_scale` | `entries?[{name,minPx,maxPx}], minSizePx=16, maxSizePx=32, minViewportPx=360, maxViewportPx=1440, rootFontPx=16, unit=rem\|px` → `{values[{clampCss, slope, intercept, endpointErrorPx}], css}` |
| `ink_craft_component` | `componentType, title, description, direction, interactivePhysics` |
| `ink_build_threejs_experience` | `sceneType, accentColorHex, particleCount (100-5000), enableMouseParallax` |
| `ink_generate_script_logic` | `pattern, moduleName, typescript` |
| `ink_audit_security` | `code, filename` |
| `ink_validate_design` | `code, foregroundHex, backgroundHex, checkBidi=true, checkCentering=true, textFontSizePx?, textFontWeight?, textUse=large\|body\|non-text` → `contrast{ratio, ratioExact, grade, wcagAA/wcagAAA/wcagLargeAA/wcagUIAA, apca{lc, lcExact, abs, polarity, simplifiedTier, fontAware?{minFontSizePx, passes, tier, lookupLcRow, lookupWeight, clampedToTable, basis="apca-0.1.7-G-lookup", reference, note}}}, centeringAudit` |
| `ink_run_python_tests` | `action=contrast\|security\|visual\|audit\|full\|bidi\|inspect\|capture, code?, target?, foregroundHex?, backgroundHex?` (writes files for `capture`, fetches URLs for `inspect`) |
| `ink_capture_viewport` | `htmlOrUrl, title, outputDirectory?` (writes PNG/SVG snapshots; 30s browser budget, deterministic SVG fallback, `INK_CAPTURE_SKIP_BROWSER=1` forces the fallback) |
| `ink_inspect_website_style` | `urlOrCode, extractOklchPalette=true, target=srgb\|p3` → `convertedColors[{source, token?, oklch, hex, gamutMapped, css}], unsupportedColors[]` |
| `ink_import_custom_assets` | `primaryFont, displayFont?, weights=[400,500,600,700], includeArabic` |
| `ink_generate_gradient` | `fromOklch{l,c,h}?, toOklch{l,c,h}?, stops?[{oklch, position?, alpha?}], steps=5 (integer 2-16), interpolationSpace=oklch\|oklab, huePath=shorter\|longer\|increasing\|decreasing, direction='to right', target=srgb\|p3, gamutValidationSamples=64, contrastForegroundHex?, contrastSamplePositions?, contrastTarget=aa, contrastBackdropHex=#ffffff` → `{stops, css, cssSrgb, cssP3, hexes, gamut, contrast?{backdropHex, compositedAlpha, positions, samples[{position, backgroundHex, backgroundHexOpaque, backgroundAlpha, backdropHex, ratio, ratioExact, …}], worstCase, meetsTarget}}` |
| `ink_generate_spacing_scale` | `basePx=16, ratio=1.25 (>=1), fluid=false, minVw=360, maxVw=1440, fluidMinFactor=0.85, rootFontPx=16, steps?, stepCount?` → `{tokens, css}` |

Outputs are `ResultEnvelope{status, summary, data, warnings, evidence, nextActions?}` with `status ∈ success|partial|blocked|failed`. A `failed` envelope is returned as an MCP error result (`isError: true`) without `structuredContent`; `partial`/`blocked` mean the tool ran but could not satisfy every requested constraint (see `failedPairings`).

## Examples

Palette with ramp overrides, P3 target and AA correction:
```json
{
  "mood": "cyber-tactile",
  "target": "p3",
  "rampSteps": 6,
  "lightnessMode": "eased",
  "lightnessEasing": [0.42, 0, 0.58, 1],
  "contrastTarget": "aaa",
  "correctionMode": "text-lightness"
}
```

Authored gradient with alpha, OKLab interpolation and contrast sampling:
```json
{
  "stops": [
    { "oklch": { "l": 0.2, "c": 0.05, "h": 350 }, "position": 0 },
    { "oklch": { "l": 0.7, "c": 0.12, "h": 40 }, "position": 0.35, "alpha": 0.5 },
    { "oklch": { "l": 0.95, "c": 0.02, "h": 200 }, "position": 1 }
  ],
  "interpolationSpace": "oklab",
  "contrastForegroundHex": "#ffffff",
  "contrastSamplePositions": [0, 0.35, 1],
  "contrastBackdropHex": "#0b0f19"
}
```

Validate dual contrast (exact WCAG + APCA 0.98G):
```json
{ "code": "<main style='margin-inline:auto'></main>", "foregroundHex": "#f8fafc", "backgroundHex": "#0b0f19", "textFontSizePx": 16, "textFontWeight": 400, "textUse": "body" }
```
Read `data.contrast.ratioExact` (decisions), `data.contrast.ratio` (display) and `data.contrast.apca{lc, lcExact, simplifiedTier, fontAware}`. When `textFontSizePx` is supplied, `fontAware{lookupLcRow, lookupWeight, clampedToTable, basis}` is the published APCA font lookup, not an approximation.

## Caveats

- Gamut: CSS Color 4 §14.2 binary search with local MINDE (JND 0.02, MINDE 0.01, chroma ε 1e-4); `mapped`/`clipped` and `deltaEOK` report whether mapping happened. `deltaEOK` is measured in the target gamut via `targetChannelsToOklab` (sRGB or Display P3 channels), never through the sRGB decoder. P3 channels are exported as `color(display-p3 r g b)`; hex fallbacks always come from an independent sRGB mapping.
- Contrast basis: WCAG/APCA are measured on the exported 8-bit sRGB fallback (WCAG 2.x is sRGB-only), so the audit always matches the exported colors.
- WCAG: booleans use `ratioExact`; `ratio` is the 2-decimal display value. `#148700` on `#000000` = 4.4953 → displays 4.50 but fails normal-text AA.
- APCA: reference 0.98G equations (APCA luminance, black soft clamp, polarity exponents, low-contrast clipping and offsets, no output clamp). Sign = polarity (+ dark-on-light, − light-on-dark). `simplifiedTier` (`>=60 Body`, `>=45 Large`, else Fail) stays font-size-agnostic; `fontAware` is the **published** lookup (`basis: "apca-0.1.7-G-lookup"`, reference `APCA font lookup, Public Beta 0.1.7 (G) 2022-05-28`) — pass `textFontSizePx`/`textFontWeight` to get it, and `textUse: "body"` for the documented `+15 Lc` adjustment below Lc 70. `|Lc|` above `APCA_FONT_MAX_LC` (125) uses the last table row and sets `clampedToTable`; sentinels `APCA_FONT_PROHIBITED` (999) and `APCA_FONT_NON_TEXT_ONLY` (777) never pass for real text.
- Gradient CSS: alpha is serialized inside the color function (`oklch(0.750 0.120 40 / 0.500)`, `color(display-p3 0.7 0.2 0.1 / 0.5)`), the hue interpolation method is always emitted (`in oklch shorter hue`, `longer`/`increasing`/`decreasing` per `huePath`; none for rectangular `in oklab`), and stop positions are emitted whenever they differ from implicit even spacing — two authored stops at `0.2`/`0.8` serialize as `20%`/`80%`, while evenly spaced sampled stops stay compact.
- Gradient transparency: CSS Color 4 §13.4 premultiplied alpha is applied in the selected space — `L`, `a`, `b` for rectangular OKLab, `L` and `C` with a normally interpolated hue for cylindrical OKLCH (so equal-alpha `h 30` → `h 150` keeps chroma `0.1` and midpoint hue `90` instead of collapsing toward the achromatic axis). Equal alpha on all stops keeps the previous plain interpolation.
- Gradient contrast is measured on what is actually rendered: each sample is alpha-composited over `contrastBackdropHex` (default `#ffffff`) before WCAG/APCA, because both are defined on opaque colors. The report exposes `backdropHex`, `compositedAlpha`, per-sample `backgroundHexOpaque`/`backgroundAlpha`, and `backgroundHex` is the composited color that was measured — a fully transparent black gradient with white text over white reports `1:1`, not the opaque black's `21:1`. An invalid backdrop hex throws `RangeError`.
- Gradient gamut validation is SAMPLED (`gamut.samplesChecked`, default 64); passing samples do not prove every point of the continuous gradient is in gamut. Each emitted stop is individually gamut mapped.
- Capture: headless renders get a 30s budget and a timeout falls back to the deterministic SVG (partial file removed); `INK_CAPTURE_SKIP_BROWSER=1` forces that fallback, so the Python suite never needs a local Chrome install.
- Palette: no unconditional AAA guarantee. All text × surface pairings (including muted text and elevated/subtle surfaces) are audited; `failedPairings` lists shortfalls and `adjustments` lists every lightness change (hue preserved).
- Validation: equal/reversed viewports, non-finite numbers, non-positive sizes, spacing `ratio < 1` and fractional gradient `steps` are rejected — invalid CSS cannot be generated.

## CLI / local dev

```bash
npm run typecheck
npm run build
npm test                 # vitest run (unit + contract + MCP transport + python bridge)
npm run test:python
node dist/index.js       # stdio MCP server
mcp-ink-design           # global binary after `npm link`

node docs/audit-2026-10-03/verify.mjs       # post-fix audit probe
node docs/audit-2026-10-03/verify-dist.mjs  # packaged executable smoke test
```