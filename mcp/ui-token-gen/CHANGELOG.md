# Changelog — mcp-ink-design

All notable changes to this project will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.3.0] - 2026-10-03

Fixes and capability additions driven by the design-system/MCP audit in
[docs/audit-2026-10-03/report.md](docs/audit-2026-10-03/report.md). See
[docs/audit-2026-10-03/fix-report.md](docs/audit-2026-10-03/fix-report.md) for the
requirement-by-requirement PASS/PARTIAL/FAIL table.

### Added
- **Configurable OKLCH palette ramps** (`ink_generate_palette_tokens`):
  `rampSteps`, `lightnessMode` (`equal` | `eased`), `lightnessEasing`
  (real cubic-Bézier curve evaluation), `chromaProfile`
  (`constant` | `linear` | `bell` | `eased`), per-ramp `ramps.surface|text|accent`
  endpoint overrides, `target` (sRGB/P3), `contrastTarget`
  (`aa` | `aaa` | `aa-large` | `none`), `correctionMode`
  (`none` | `text-lightness` | `both`) and `maxCorrectionDelta`.
  Outputs now include `ramps`, `tokenExports`, `failedPairings`, `adjustments`
  and a `success` / `partial` / `blocked` `status`.
- **New tool `ink_generate_fluid_scale`**: arbitrary fluid `clamp()` values with
  configurable viewport bounds, root font size and per-entry endpoint
  verification (`values[].endpointErrorPx`, documented tolerance 0.01px).
- **Authored gradient stops** (`ink_generate_gradient`): `stops` array with
  explicit positions and alpha, `interpolationSpace` (`oklch` | `oklab`),
  `huePath` (`shorter` | `longer` | `increasing` | `decreasing`),
  `gamutValidationSamples`, plus `cssSrgb`, `cssP3`, an explicit sampled
  `gamut` report and `contrastForegroundHex` / `contrastSamplePositions` /
  `contrastTarget` for worst-case contrast sampling.
- **Geometric typography**: `size(n) = base * ratio^n` via `typographyBasePx`,
  `typographyRatio`, `typographyStepRange`; configurable `rootFontPx`.
- **Optical centering audit** (`ink_validate_design.checkCentering`) covering
  centered body copy, viewport-unit overflow, oversized fixed widths,
  unbounded auto margins and over-tight tracking; plus optional
  `textFontSizePx` / `textFontWeight` / `textUse` for font-aware APCA guidance.
- **Configurable spacing** (`ink_generate_spacing_scale`): `steps`, `stepCount`,
  `fluidMinFactor`, `rootFontPx`.
- **Validation coverage**: Vitest grew from 61 to 173 tests (18 files,
  including a new MCP transport suite); the Python suite grew from 9 to 20 tests.

### Fixed — colour mathematics
- **WCAG classification now uses the full-precision ratio.** `ratioExact` drives
  every pass/fail boolean; `ratio` is the rounded display value only. Regression
  covered: `#148700` on `#000000` = 4.4953336599 displays 4.50 and **fails**
  normal-text AA (previously a false pass). Thresholds unchanged (4.5 / 7 / 3 /
  4.5 / 3). Identical policy applied in the Python engine.
- **APCA replaced with a reference-conformant 0.98G implementation**: APCA
  luminance (`0.2126729/0.7151522/0.0721750` with a 2.4 power curve) instead of
  WCAG luminance, black soft clamp, ΔY guard 0.0005, correct polarity exponents
  (0.56/0.57 and 0.65/0.62), 1.14 scale, ±0.1 low-contrast clipping and ∓0.027
  offsets, and no artificial output clamp. Verified vectors: `#777777`/`#ffffff`
  = +71.1111 Lc (was 74.0), `#888888`/`#777777` = −7.3202 Lc (was −14.7),
  white/black = −107.8847 Lc, black/white = +106.0407 Lc. The Python verifier
  implements the same equations and is cross-checked against TypeScript.
- **Gamut mapping rewritten to CSS Color 4 §14.2 binary search with local MINDE**
  (JND 0.02, MINDE 0.01, chroma ε 1e-4) with documented tolerances, explicit
  black/white lightness boundaries, and a constant-L/H chroma trim so published
  OKLCH values convert back inside the gamut.
- **P3 export defect fixed**: P3 channels are labelled as P3, exported as
  `color(display-p3 r g b)`, and hex fallbacks come from an independent sRGB
  mapping. Previously P3 channels were re-encoded as `#rrggbb`.
- **Contrast is measured from the exported colors**: OKLCH pairs are gamut mapped
  first and measured on their 8-bit sRGB fallback (WCAG 2.x is sRGB-only).
- **Serialization-safe tokens**: OKLCH values are rounded to the precision
  actually written to CSS and re-verified; chroma is reduced when rounding would
  leave the gamut.
- **P3 gamut mapping now measures `deltaEOK` in the target gamut.** The §14.2.2
  local-MINDE binary search scores clipped target channels with the new
  `targetChannelsToOklab` helper; Display P3 channels were previously run
  through the sRGB decoder. Cross-checked against an independent reference
  implementation: `oklch(0.7 0.3 30)` mapped to P3 is
  `r=1, g=0.2851, b=0.1928`, with `deltaEOK` agreement ~2.6e-8.
- **Alpha is serialized as valid CSS.** `oklchToCssString()` accepts an optional
  alpha and writes it **inside** the function —
  `oklch(0.750 0.120 40 / 0.500)` and
  `color(display-p3 0.7 0.2 0.1 / 0.5)`. The previous `oklch(...) / A` form was
  invalid CSS and has been removed.
- **Transparency no longer silently changes the interpolation space.** CSS Color 4
  §13.4 premultiplied alpha is applied in the selected space: rectangular OKLab
  premultiplies `L`, `a` and `b`, while cylindrical OKLCH premultiplies `L` and
  `C` and interpolates hue normally — so equal-alpha polar stops such as
  `h 30` → `h 150` at `alpha 0.5` keep chroma `0.1` and a midpoint hue of `90`
  instead of collapsing toward the achromatic axis. Equal alpha on all stops
  keeps the previous plain interpolation exactly.
- **Authored stop positions are always emitted when they differ from implicit
  even spacing**: two authored stops at `0.2`/`0.8` now serialize as
  `… 20%, … 80%` instead of silently widening to `0%`/`100%`. Evenly spaced
  sampled stops stay compact (no position list), so existing two-endpoint output
  is unchanged.
- **Emitted gradients always carry the interpolation method**, e.g.
  `linear-gradient(to right in oklch shorter hue, oklch(...) ...)`.
  `buildGradientCss()` takes an optional `huePath` (`shorter` default, plus
  `longer`, `increasing`, `decreasing`); rectangular OKLab output carries no hue
  method. Direction strings are unchanged (`to right`, `to bottom`, …).
- **APCA font-aware guidance is now the published lookup, not an approximation.**
  New exported `apcaFontLookup(contrastLc)` implements apca-w3's
  `fontLookupAPCA` with the published font matrix, and
  `apcaGuidanceForFont({lc | absoluteLc, fontSizePx, fontWeight, use?})` returns
  `{minFontSizePx, passes, tier, lookupLcRow, lookupWeight, clampedToTable,
  basis, reference, note}` with `basis: "apca-0.1.7-G-lookup"` and reference
  `APCA font lookup, Public Beta 0.1.7 (G) 2022-05-28`. Table facts:
  `APCA_FONT_MAX_LC` = 125; Lc 60 / weight 400 → 24.25px; Lc 60 / 700 → 15.5px;
  Lc 90 / 400 → 16px; Lc 100 / 700 → 13px. The sentinels `999`
  (`APCA_FONT_PROHIBITED`) and `777` (`APCA_FONT_NON_TEXT_ONLY`) are surfaced as
  such and never pass for real text; weights between published columns snap to
  the nearest one and report `lookupWeight`, and `|Lc|` beyond the table sets
  `clampedToTable`. `use: "body"` applies APCA's documented `+15 Lc` adjustment
  when `|Lc| < 70`, while `use: "large"` (and the default when `use` is omitted)
  and `"non-text"` use the raw `|Lc|`. The simplified font-size-agnostic
  `Body`/`Large`/`Fail` tiers of `apcaGuidance(lc)` are retained for backward
  compatibility.
- **`apcaContrastLc` returns 0** for inputs outside the reference luminance
  domain `[0, 1.1]` instead of producing a misleading value.

### Fixed — validation & contracts
- Rejected invalid numeric input instead of emitting invalid CSS: equal or
  reversed viewport bounds, non-finite numbers, non-positive sizes/root sizes,
  zero/negative/increasing-only spacing ratios, and fractional gradient `steps`
  (`2.9` is now an error, previously silently floored).
- MCP error contract: `failed` envelopes are returned as proper error results
  (`isError: true`) preserving the backend message and omitting
  `structuredContent`; `partial`/`blocked` remain successful results.
- Corrected tool annotations: `ink_run_python_tests` is now
  `readOnlyHint: false` / `openWorldHint: true` (capture writes files, inspect
  fetches URLs) and its `target` parameter is forwarded to the Python engine.
- `includeArabicTokens` now changes the generated CSS/payload;
  `checkCentering` now runs a real audit; `extractOklchPalette` converts
  extracted colors with real color math on both the inline and URL paths and
  reports unconvertible literals instead of substituting a fixed palette.
- Python color parsing no longer silently falls back to black; unsupported
  syntax raises and is reported as an error result.
- Per-action Python bridge timeouts (capture no longer times out mid-render).
- **Gradient contrast now accounts for transparency.** Every sample is
  alpha-composited over a backdrop before WCAG/APCA is measured, because both
  are defined on opaque colors. New optional `contrastBackdropHex`
  (default `#ffffff`); the report adds `backdropHex` and `compositedAlpha` plus
  per-sample `backgroundHexOpaque` and `backgroundAlpha`, and `backgroundHex` is
  now the composited color that was actually measured. A fully transparent black
  gradient with white text over a white canvas reports `1:1` instead of the
  underlying opaque black's `21:1`. An invalid backdrop hex throws `RangeError`,
  and the tool warns whenever transparent samples were composited.
- **`ink_validate_design` gained `textUse`** (`"body" | "large" | "non-text"`,
  default large) alongside `textFontSizePx` / `textFontWeight`, and its
  `fontAware` output now includes the reference lookup fields
  (`lookupLcRow`, `lookupWeight`, `clampedToTable`, `basis`, `reference`).
- **Headless capture hardened**: the per-render budget is raised from 10s to 30s,
  `subprocess.TimeoutExpired` is handled explicitly (partial screenshot files
  are deleted, a clean `False` is returned, and the reason is written to stderr),
  and `INK_CAPTURE_SKIP_BROWSER=1` forces the deterministic SVG fallback. The
  Python suite forces that fallback for capture tests, so it never depends on a
  local Chrome install.

### Documentation
- README, architecture docs and tool descriptions rewritten to describe the
  implemented mathematics, tolerances and limitations (including the explicitly
  simplified APCA guidance tiers, the published APCA font lookup, gradient CSS
  serialization with alpha inside the color function and the sampled
  gradient-gamut policy).
- `docs/audit-2026-10-03/verify.mjs` rewritten to verify the corrected behavior
  (writes `verification-results-postfix.json`); `verify-dist.mjs` added to smoke
  test the packaged executable. The original audit evidence is preserved.

## [1.2.0] - 2026-09-21

### Changed — Glama Benchmark Tier-S Quality Elevation (5.0 / 5.0 Standard)
- **Standardized All 11 Tools to Strict `ink_<verb>_<noun>` Pattern**:
  - `ink_create_base` (Scaffold Web Application Foundation)
  - `ink_generate_palette_tokens` *(renamed from `ink_design_palette_tokens`)*
  - `ink_craft_component` (Craft UI Component with Tactile Physics)
  - `ink_build_threejs_experience` *(renamed from `ink_threejs_experience`)*
  - `ink_generate_script_logic` *(renamed from `ink_script_logic`)*
  - `ink_audit_security` *(renamed from `ink_security_audit`)*
  - `ink_validate_design` (Validate Design Craft & Contrast Compliance)
  - `ink_run_python_tests` *(renamed from `ink_python_test_runner`)*
  - `ink_capture_viewport` (Capture Multi-Viewport Responsive Snapshots)
  - `ink_inspect_website_style` (Inspect & Reverse-Engineer Website Style)
  - `ink_import_custom_assets` (Import & Configure Web Fonts and Assets)
- **Explicit MCP Tool Annotations**:
  - Attached `readOnlyHint`, `destructiveHint`, `idempotentHint`, and `openWorldHint` across all 11 tools using modern `server.registerTool(...)`.
- **Typed Output Schemas & Dual Result Envelope Output**:
  - Added Zod `OutputSchema` definitions for all 11 tools in `src/contracts/index.ts`.
  - Returned both text serialized JSON in `content` and validated typed objects in `structuredContent`.
- **Comprehensive 4-Part Tool Descriptions**:
  - Rewrote every tool description into structured sections: `PURPOSE`, `BEHAVIOR`, `USAGE GUIDELINES` (When to use, When NOT to use, Alternatives), and `RETURNS`.
- **Crisp Disambiguation for Verification Tools**:
  - Defined clear boundaries between `ink_validate_design` (fast in-memory CSS/craft/bidi linting), `ink_audit_security` (OWASP DOM XSS & CSP auditing), and `ink_run_python_tests` (external Python AST/matrix testing).
- **Glama MCP Registry Manifest**:
  - Added `glama.json` with schema validation (`https://glama.ai/mcp/schemas/server.json`) for maintainer ownership claiming (`MarwanDevSpace`, `MarwanDevMCP`).

## [1.1.0] - 2026-09-20

### Added
- **Multi-Viewport Visual Capture Engine** (`ink_capture_viewport`):
  - Captures 16:9 Desktop Landscape (1600x900 / 1920x1080).
  - Captures 9:16 Vertical Story (540x960 / 1080x1920).
  - Captures 390x844 Mobile View with zero-overflow verification.
  - Headless Chrome runner with isolated temp user-data-dirs to avoid process lockups.
- **Arabic Typography & Bilingual RTL/LTR Architecture**:
  - Full support for modern CSS Logical Properties (`margin-inline`, `padding-inline`, `inset-inline`, `text-align: start`).
  - Arabic optical line-height compensation (`1.75 - 1.85`).
  - Curated Arabic font scales: IBM Plex Sans Arabic, Cairo, Tajawal, Readex Pro, Amiri.
  - Bidirectional isolation checks (`<bdi>`, `unicode-bidi: isolate`).
- **Optical Centering & Alignment Auditing**:
  - Detection of paragraph centering misuse and horizontal overflow risks.
- **Website Style Reverse-Engineering & Inspection** (`ink_inspect_website_style`):
  - Deconstruction of external URLs or HTML/CSS into color gamuts, OKLCH upgrade tokens, font hierarchies, and shadow systems.
- **Dynamic Asset & Font Importer** (`ink_import_custom_assets`):
  - Configures and imports Google Fonts and `@font-face` rules with accessible fallbacks.
- Vitest test suite expanded to 31 tests across 13 test files; Python test suite expanded to 9 unit tests.

## [1.0.0] - 2026-09-20

### Added
- Complete MCP Server with stdio transport built on `@modelcontextprotocol/sdk`.
- `INK_MASTER.md` central design manifesto and anti-AI-slop constitution.
- 8 specialized tools:
  - `ink_create_base`
  - `ink_design_palette_tokens`
  - `ink_craft_component`
  - `ink_threejs_experience`
  - `ink_script_logic`
  - `ink_security_audit`
  - `ink_validate_design`
  - `ink_python_test_runner`
- 3 MCP resources (`ink://master/philosophy`, `ink://tokens/design-presets`, `ink://security/owasp-frontend`).
- 2 MCP prompts (`ink_creative_direction`, `ink_anti_slop_audit`).
- Pure TypeScript color math engine calculating WCAG 2.1/2.2 AAA contrast ratios and OKLCH color spaces.
- Mathematical fluid typography generator using CSS `clamp()`.
- Responsive Three.js WebGL scene engine with memory teardown lifecycle.
- Static client-side OWASP security scanner and CSP header generator.
- Dedicated Python verification suite (`python/ink_verifier`) with unit tests and stdin CLI bridge.
- Vitest test suite with 24 passing tests covering unit, contract, and integration levels.
