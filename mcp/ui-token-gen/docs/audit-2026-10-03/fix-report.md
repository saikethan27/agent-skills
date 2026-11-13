# Audit remediation report — mcp-ink-design 1.3.0

**Date:** 3 October 2026
**Input audit:** [`report.md`](report.md), [`verification-results.json`](verification-results.json) (1.2.0 baseline, preserved untouched)
**Post-fix evidence:** [`verification-results-postfix.json`](verification-results-postfix.json), [`mcp-tools-schema.json`](mcp-tools-schema.json)
**Probes:** `node docs/audit-2026-10-03/verify.mjs` (behavior probe) · `node docs/audit-2026-10-03/verify-dist.mjs` (packaged executable smoke test)

Verdict: **PASS with documented simplifications.** Every audited defect is fixed and covered by a regression test. Two areas remain intentionally simplified and are labelled as such in the API surface (simplified APCA guidance tiers and sampled gradient-gamut validation).

**Recheck — 3 October 2026 (second remediation round).** A post-recheck pass
found six residual defects the first round missed: P3 gamut mapping scored
`deltaEOK` through the sRGB decoder; alpha was serialized as the invalid
`oklch(...) / A`; premultiplied transparency collapsed the OKLCH polar path
toward the achromatic axis; two-stop authored positions were dropped from the
CSS; gradient contrast ignored transparency and measured the opaque channels;
and the font-aware APCA path was still an approximation of the published lookup.
All six are fixed, and the exact regressions added are listed in the §1 evidence
column and summarized in §7: `oklch(0.7 0.3 30)` → P3 `r=1, g=0.2851,
b=0.1928` with `deltaEOK` agreement ~2.6e-8 against an independent reference
implementation; alpha parsed back from `oklch(0.750 0.120 40 / 0.500)` and
`color(display-p3 0.7 0.2 0.1 / 0.5)`; `h 30` → `h 150` at `alpha 0.5` keeping
chroma `0.1` and midpoint hue `90`; two authored stops at `0.2`/`0.8`
serializing as `… 20%, … 80%`; the hue method always present in the emitted
gradient; transparent black + white text over a white backdrop reporting `1:1`
instead of `21:1`; and the APCA table facts (`APCA_FONT_MAX_LC` 125, Lc 60/400 →
24.25px, Lc 60/700 → 15.5px, Lc 90/400 → 16px, Lc 100/700 → 13px, sentinels
`APCA_FONT_PROHIBITED` / `APCA_FONT_NON_TEXT_ONLY` never passing for text). The
same round hardened the Python capture path: a 30s per-render budget with
explicit `subprocess.TimeoutExpired` cleanup and an `INK_CAPTURE_SKIP_BROWSER=1`
deterministic SVG switch.

---

## 1. Requirement-by-requirement results

| # | Original requirement | Status | Where implemented | Evidence / regression test |
|---|---|---|---|---|
| 1.1 | WCAG compliance from the full-precision ratio | **PASS** | `color-math.ts: classifyContrastRatio`, `calculateContrastRatio`, `exactContrastRatio` | `#148700`/`#000000` = 4.4953336599, displays 4.50, `normalTextAA === false` (`color-math.test.ts`, `verify.mjs` §2, protocol test) |
| 1.2 | Thresholds 4.5 / 7 / 3 / 4.5 / 3 preserved | **PASS** | `WCAG_THRESHOLDS` | Exact threshold-boundary assertions in `color-math.test.ts` and `test_verifier.py` |
| 1.3 | Correct sRGB luminance formula | **PASS** | `calculateRelativeLuminance`, `channelToLinear` | `#808080` → 0.2158; below-threshold linear segment asserted to 1e-9 |
| 1.4 | Same classification policy in TS and Python | **PASS** | `python/ink_verifier/contrast.py` | `python-bridge.test.ts` compares exact ratio, all five flags and grade for 6 pairs |
| 1.5 | Palette contrast uses mapped/exported colors | **PASS** | `palette-generator.ts: measurePairing` | `p3ExportContrastMismatches === 0` for all moods in `verify.mjs`; unit + contract tests |
| 2.1 | Reference-conformant APCA (complete equations) | **PASS** | `apca.ts` (APCA-W3 0.98G, pinned constants) | Vectors +71.1111 / −7.3202 / −107.8847 / +106.0407 Lc, tolerance 0.01 (`apca.test.ts`, `verify.mjs` §3) |
| 2.2 | APCA luminance preprocessing, soft clamp, ΔY guard, clipping, offsets | **PASS** | `apca.ts`, `contrast.py` | Tests for `Ys ≠ WCAG`, clamp at 0.022^1.414, ΔY 0.0005 guard, ±0.1 clip |
| 2.3 | Signed polarity, no arbitrary output clamp | **PASS** | `apcaContrastLc` | Extremes −107.8847 / +106.0407 (no ±108/106 clamp); both polarities tested |
| 2.4 | Font-size/weight-aware guidance, or labelled simplified | **PASS (fixed in recheck round)** | `apcaFontLookup` (apca-w3 `fontLookupAPCA`, published matrix) + `apcaGuidanceForFont` (`basis: "apca-0.1.7-G-lookup"`); `apcaGuidance` keeps the documented simplified tiers | Reference `APCA font lookup, Public Beta 0.1.7 (G) 2022-05-28`; table facts `APCA_FONT_MAX_LC` = 125, Lc 60/400 → 24.25px, Lc 60/700 → 15.5px, Lc 90/400 → 16px, Lc 100/700 → 13px; `lookupLcRow` / `lookupWeight` / `clampedToTable` reported; `APCA_FONT_PROHIBITED` (999) and `APCA_FONT_NON_TEXT_ONLY` (777) never pass for text; `textUse: "body"` applies the +15 Lc adjustment below Lc 70 |
| 2.5 | Remove or implement APCA in Python | **PASS** | `contrast.py: calculate_apca_contrast` | Same reference equations; TS↔Python parity asserted to 0.01 Lc |
| 3.1 | Documented gamut mapping consistent with CSS Color 4 (MINDE/deltaEOK/JND) | **PASS (fixed in recheck round)** | `gamut-mapper.ts` (§14.2.2 pseudocode, `targetChannelsToOklab`) | JND 0.02 / MINDE 0.01 / ε 1e-4 pinned by tests; `deltaEOK` measured in the target gamut — `oklch(0.7 0.3 30)` → P3 `r=1, g=0.2851, b=0.1928` agrees with an independent reference implementation to ~2.6e-8 |
| 3.2 | Documented numerical tolerance | **PASS** | `GAMUT_JND`, `GAMUT_MINDE`, `GAMUT_CHROMA_EPSILON`, `GAMUT_CHANNEL_EPSILON`, `SERIALIZED_CHANNEL_EPSILON` | Constants asserted in `gamut-mapper.test.ts` |
| 3.3 | Explicit target gamut everywhere (tokens, gradient samples, exports, contrast) | **PASS** | `mapToGamut(..., target)` used by palette, gradient, contrast and inspector | `target: "p3"` regression across all moods and both gradient APIs |
| 3.4 | Preserve original **and** mapped OKLCH, report mapping | **PASS** | `GamutMapResult.original/oklch/mapped/clipped/deltaEOK`; `PaletteToken.requested/mapped`; gradient `clipped` | Tests assert both values are retained |
| 3.5 | P3 channels identified as P3; `color(display-p3 …)`; independent sRGB fallback; never `#rrggbb` | **PASS** | `channelsToCss`, `srgbFallbackOklch` | `oklch(0.69 0.26 142)`: P3 `#4bbc1c` (naive) vs published `#00be00` (independent sRGB) — `gamut-mapper.test.ts`, `verify.mjs` §4 |
| 3.6 | sRGB fields remain real sRGB (backward compatible) | **PASS** | `GamutMapResult.srgb/hex` | Every palette/gradient export asserts `hex === mapToGamut(...,'srgb').hex` |
| 3.7 | Black/white lightness boundaries | **PASS** | `boundaryResult` | L ≤ 0 → `#000000`, L ≥ 1 → white (also for P3), with `mapped`/`inGamut` reported honestly |
| 3.8 | Serialized values verified in gamut (rounding cannot push color out) | **PASS** | `roundOklchForCss`, `serializedChannelsInGamut` | `oklch(0.7 0.4 30)` is reduced to C 0.192 with `adjusted: true`; hue 359.6 → 0 (not 360) |
| 3.9 | Contrast from final exported/rendering-policy colors | **PASS** | `contrastForOklchPair`, `contrastOverGradient`, `measurePairing` | Pairing `fgHex`/`bgHex` equal the exported token hexes; recomputed ratios match to 1e-12 |
| 4.1 | Five moods kept as presets | **PASS** | `MOOD_PRESETS` | All five presets exercised in unit, contract and probe tests |
| 4.2 | Configurable ramps (steps, lightness endpoints, chroma endpoints/profile, hue, gamut, interpolation mode) | **PASS** | `buildRamp`, `applyRampOverrides`, tool params `rampSteps/lightnessMode/chromaProfile/ramps/target` | Per-ramp override + profile + hue-path tests |
| 4.3 | Equal lightness increments and a real eased curve | **PASS** | `buildRamp`, `cubicBezierEasing` (Newton-Raphson + bisection) | Equal increments verified; easing endpoints/midpoint and asymmetric curves verified |
| 4.4 | Accurate description (no equal-delta-E claim) | **PASS** | `buildRamp` doc comment, tool description | Documented as "uniform step in OKLCH L" only |
| 4.5 | Tokens derived from ramps, semantic names retained | **PASS** | `generatePalette`, `PALETTE_TOKEN_NAMES` | All 11 names emitted for all moods |
| 4.6 | Audit all text/surface combos incl. muted + elevated/subtle | **PASS** | 12 pairings (3 texts × 3 surfaces + 3 UI pairings) | Pairing ids asserted per mood |
| 4.7 | Explicit contrast target + optional correction, all adjustments reported | **PASS** | `contrastTarget`, `correctionMode`, `maxCorrectionDelta`, `adjustments[]` | Editorial muted text L 0.51 → 0.59 with reported reason; `maxCorrectionDelta` respected |
| 4.8 | Unreachable target → failed pairings + partial/blocked | **PASS** | `status`, `failedPairings`, warnings | `correctionMode: "none"` → `blocked` for all five moods; `maxCorrectionDelta: 0.01` → blocked |
| 4.9 | No unconditional AAA guarantee | **PASS** | Tool description rewritten; per-pairing `requiredRatio` + `passed` | Description no longer claims AAA; `contrastTarget: "none"` reporting mode tested |
| 4.10 | Editorial muted ~3.59 audited and corrected or reported | **PASS** | `verify.mjs` §5, `palette-generator.test.ts` | Uncorrected: 3.5932, audited, `passed: false`, listed in `failedPairings`; corrected: ≥ 4.5 |
| 4.11 | All existing moods tested | **PASS** | Unit, contract, probe | 5/5 moods verified in all three suites |
| 5.1 | Preserve the two-endpoint API | **PASS** | `interpolateStops`, `generateGradient`, `buildGradientCss` | Same signatures/return fields, plus additive data |
| 5.2 | Authored stop array with explicit positions | **PASS (fixed in recheck round)** | `interpolateAuthoredStops`, `generateAuthoredGradient`, `stopList` | Positions emitted in CSS whenever they differ from implicit even spacing (`35%`; two authored stops at `0.2`/`0.8` → `20%`/`80%`); evenly spaced sampled stops stay compact; validation of ordering/range |
| 5.3 | `interpolationSpace: oklch \| oklab` | **PASS** | `interpolateAt` | `in oklab` CSS; midpoint hue differs from OKLCH interpolation |
| 5.4 | Documented hue paths | **PASS** | `hueDeltaFor` | shorter/longer/increasing/decreasing values asserted (incl. `longer` = −340, not +380) |
| 5.5 | Integer sample count required | **PASS** | `assertIntegerSteps` + schema `int()` | `2.9` rejected at schema **and** domain level |
| 5.6 | Stop position/order validation | **PASS** | `validateAuthoredStops` | Decreasing positions, out-of-range, alpha range, < 2 stops all rejected |
| 5.7 | Alpha with premultiplied interpolation | **PASS (fixed in recheck round)** | `interpolateAt` premultiplied branch, `oklchToCssString(l, c, h, alpha)` | Alpha is serialized INSIDE the function (`oklch(0.750 0.120 40 / 0.500)`, `color(display-p3 0.7 0.2 0.1 / 0.5)`); rectangular OKLab premultiplies `L`/`a`/`b`, cylindrical OKLCH premultiplies `L`/`C` and interpolates hue normally (`h 30` → `h 150` at `alpha 0.5` keeps C 0.1 and midpoint hue 90); equal alpha keeps plain interpolation; 8-digit hex and opaque case verified |
| 5.8 | Explicit perceptual CSS interpolation | **PASS (fixed in recheck round)** | `buildGradientCss(stops, direction, space, render, huePath)` | `linear-gradient(<dir> in oklch shorter hue, …)`; the hue method is always serialized for polar spaces (all four `huePath` values) and omitted for rectangular `in oklab`; direction strings unchanged |
| 5.9 | Independently correct sRGB and P3 exports | **PASS** | `css`, `cssSrgb`, `cssP3` | P3 CSS contains no hex; each stop's hex is its own sRGB mapping and differs from the naive P3 encoding |
| 5.10 | No "whole gradient in gamut" claim; documented sampling policy | **PASS** | `GradientGamutReport` (`policy: "sampled"`, `note`) | Report always states the limitation; sample count configurable 8–512 |
| 5.11 | Contrast sampling with explicit positions + worst case | **PASS (fixed in recheck round)** | `contrastOverGradient` | Per-sample ratios recomputed from the alpha-composited `backgroundHex`; `contrastBackdropHex` (default `#ffffff`) drives compositing, invalid hex throws `RangeError`; transparent black + white text over white reports 1:1 (not the opaque black's 21:1); worst case = min exact ratio |
| 6.1 | Preserve the exact clamp formula | **PASS** | `fluidClampMetrics` | slope/intercept asserted to 1e-12 |
| 6.2 | Configurable `rootFontPx` in the emitted clamp | **PASS** | `generateFluidClamp({rootFontPx})` | 16px and 10px roots verified, including endpoint accuracy |
| 6.3 | Validate finite numbers, positive viewports, `maxViewport > minViewport` | **PASS** | `assertFinitePositive` + schema refinements | Equal/reversed/zero/NaN/Infinity all rejected (tool, domain and protocol level) |
| 6.4 | Valid positive sizes, coherent spacing hierarchy | **PASS** | `spacing-scale.ts` | base ≤ 0, ratio ≤ 0 rejected; ratio < 1 rejected with a documented message (`allowDecreasingRatio` opt-in) |
| 6.5 | Configurable geometric typography `size(n) = base * ratio^n` | **PASS** | `generateGeometricTypography` | Ratio 1.5 vector asserted exactly (16 → 24 → 36 → 54) |
| 6.6 | Expose base, ratio, step range, fluid endpoints | **PASS** | `typographyBasePx`, `typographyRatio`, `typographyStepRange`, `minVw`/`maxVw` | Exposed in `tools/list` and returned in `geometricTypography` |
| 6.7 | Configurable fluid spacing minimum factor | **PASS** | `fluidMinFactor` | 0.7 vs default 0.85 verified; invalid factors rejected |
| 6.8 | Expose a general fluid-clamp capability | **PASS** | New tool `ink_generate_fluid_scale` | 9 published input properties; endpoint error reported per entry |
| 6.9 | Validate rounding accuracy at both endpoints | **PASS** | `fluidClampErrorPx`, `CLAMP_ENDPOINT_TOLERANCE_PX` | 4 size pairs verified within the documented 0.01px tolerance |
| 6.10 | No NaN/Infinity in generated values | **PASS** | Validation upstream | Asserted for clamps, geometric scales, spacing scales and generated CSS |
| 7.1 | `isError` for execution failures | **PASS** | `server.ts: formatToolResult` | Protocol tests assert `isError: true` |
| 7.2 | Failure payloads schema-compatible **or** proper MCP error results | **PASS** | Failed envelopes omit `structuredContent`; Python runner schema declares an `error` branch | Backend message preserved, no "Output validation error" text |
| 7.3 | Correct annotations for file-writing / website tools | **PASS** | `MixedActionAnnotations`, `ViewportCaptureAnnotations` | `pythonRunnerTool`: readOnly false, openWorld true; description no longer claims "purely read-only" |
| 7.4 | Forward the Python runner `target` | **PASS** | `python-runner.tool.ts` | Contract test asserts `payload.target` |
| 7.5 | `includeArabicTokens` changes output | **PASS** | `tokens.tool.ts` | Enabled vs disabled payloads differ; Arabic variables present in CSS |
| 7.6 | `checkCentering` controls a real alignment/overflow check | **PASS** | `auditOpticalCentering` | 5 rules with individual assertions; gates `isHighCraft` when enabled |
| 7.7 | `extractOklchPalette` for inline **and** URL inspection | **PASS** | `style-extractor.ts`, `inspect.tool.ts` | Real conversions asserted for both paths; unsupported literals reported |
| 7.8 | Convert extracted colors with real color math | **PASS** | `cssColorToOklch`, `srgb01ToOklch` | `#38bdf8` ↔ `oklch(0.754 0.139 233)`; blueprint derived from extracted colors |
| 7.9 | Strengthen nested output schemas | **PASS** | `contracts/index.ts` | Typed `ContrastPairing`, `RampStop`, `SpacingToken`, `TypographyStep`, `GradientStop`, `ApcaGuidance`, `InspectedColor`, Python contrast result |
| 7.10 | Test `tools/list` and `tools/call` over the transport | **PASS** | `test/integration/mcp-transport.test.ts` | List (14 tools, schemas, annotations), success, invalid input, mocked backend failure |
| 8.1 | Regression tests for the defects | **PASS** | 173 Vitest tests / 20 Python tests | Every numbered item above maps to at least one test |
| 8.2 | Deterministic fixtures / mocked external services | **PASS** | `mockPython()` doubles; no browser or network in CI tests | Contract + protocol suites run fully offline |
| 8.3 | Run typecheck / test / test:python / build | **PASS** | see §3 | All green |
| 8.4 | Verify the packaged executable loads the updated dist | **PASS** | `verify-dist.mjs` | stdio handshake, 14 tools, corrected verdicts, fractional steps rejected |
| 8.5 | Documentation accuracy | **PASS** | README, CHANGELOG, architecture, tool descriptions | Mathematical policies and limitations documented inline |
| 8.6 | Updated audit probe | **PASS** | `verify.mjs` | Asserts corrected behavior and writes post-fix evidence |
| 8.7 | Final PASS/PARTIAL/FAIL table | **PASS** | this document | — |

---

## 2. Intentional changes to invalid-input handling

These are behavior changes, documented here and in the tool descriptions:

1. **Fractional gradient `steps` are rejected.** `steps: 2.9` previously returned 2 stops; it now fails input validation (`integer`).
2. **Equal or reversed viewport bounds are rejected.** `minVw === maxVw` previously produced `-Infinityrem + Infinityvw`; it now fails with an explicit message.
3. **Non-positive / non-finite sizes, viewports and root font sizes are rejected** (`RangeError`), and spacing `ratio` must be ≥ 1 unless `allowDecreasingRatio` is set explicitly.
4. **Unparseable hex colors throw** in TypeScript (`parseHexToRgb`) and raise `ValueError` in Python, instead of silently resolving to black.
5. **Unsupported Python color syntax is reported** as an error result instead of silently returning a black-based ratio.
6. **Gradient stop positions are validated** (finite, within `[0,1]`, non-decreasing).
7. **Failed tool runs publish no `structuredContent`.** This is an MCP-level decision: it prevents a backend failure from being reshaped into an output-schema validation error that hides the real message.
8. **`oklchToHex(target: "p3")` now returns the independent sRGB fallback**, because a hex string is by definition an sRGB code value.

## 3. Deliberately documented simplifications and remaining limitations

1. **APCA ships two guidance paths.** `apcaGuidanceForFont` evaluates the *published* lookup (`apcaFontLookup`, `basis: "apca-0.1.7-G-lookup"`), so the earlier `approximate-lookup` caveat no longer applies; `|Lc|` above `APCA_FONT_MAX_LC` (125) uses the last table row and reports `clampedToTable`. `apcaGuidance` still returns the simplified, font-size-agnostic `Body`/`Large`/`Fail` tiers, documented as simplified.
2. **Gradient gamut validation is sampled**, not proven: `gamut.samplesChecked` uniform positions (default 64) with an explicit note that passing samples do not prove the continuous gradient is in gamut. Each emitted stop *is* individually gamut mapped.
3. **Gamut mapping can shift lightness slightly.** The CSS Color 4 local-MINDE branch may return a clipped reference color; `deltaEOK` reports the total perceptual change (typically ≤ 0.05 OKLab for vivid colors, ≤ 0.25 for extreme requests such as C 0.4).
4. **Contrast is always measured on the 8-bit sRGB fallback**, even for `target: "p3"`, because WCAG 2.x and APCA luminance are defined on sRGB code values. The tool response states this (`basis: "srgb-fallback-8bit"`).
5. **Correction mode adjusts lightness only.** Hue is preserved exactly; chroma can still change slightly when the corrected color needs gamut mapping, and every adjustment is reported.
6. **The Python inspector still reports raw literals** for the URL path; the TypeScript layer performs the OKLCH conversion for both paths.
7. **`ink_capture_viewport` still needs a local browser** for real PNG snapshots; without one it writes deterministic SVG fallbacks and reports `format` plus a warning. Each render gets a 30s budget and `subprocess.TimeoutExpired` is handled explicitly (partial screenshot deleted, clean `False`); `INK_CAPTURE_SKIP_BROWSER=1` forces the SVG fallback, which the Python suite uses for capture tests so it never depends on a local browser.

## 4. Test results

```
npm run typecheck   →  passed (no diagnostics)
npm test            →  173 passed / 173 (18 files)
npm run test:python →  20 passed (Ran 20 tests, OK)
npm run build       →  passed (40 emitted JS modules)
dist probe          →  14 tools, 0 build mismatches, backend error preserved with isError
```

## 5. Changed files

**Domain (color science)**
- `src/domain/design-tokens/gamut-mapper.ts` — rewritten (CSS Color 4 MINDE mapping, P3 labelling, independent sRGB fallback, boundary handling, serialization-safe rounding, documented tolerances), then updated with `targetChannelsToOklab` so `deltaEOK` is measured in the target gamut and with CSS-valid alpha serialization inside the color function.
- `src/domain/design-tokens/color-math.ts` — rewritten (exact-ratio classification, rendering policy, sRGB↔OKLCH conversions, strict hex parsing).
- `src/domain/design-tokens/apca.ts` — rewritten (APCA 0.98G reference implementation + font-aware guidance), then updated with the published `apcaFontLookup` table and the `[0, 1.1]` reference luminance domain in `apcaContrastLc`.
- `src/domain/design-tokens/palette-generator.ts` — rewritten (ramps, full audit, correction, dual-gamut exports).
- `src/domain/design-tokens/gradient-interpolator.ts` — rewritten (authored stops, OKLab, hue paths, alpha, dual exports, gamut policy, contrast sampling), then updated with per-space premultiplied alpha, always-emitted authored stop positions, the always-serialized hue interpolation method and backdrop alpha compositing for contrast sampling.
- `src/domain/design-tokens/typography-generator.ts` — rewritten (validation, configurable root, geometric scale, endpoint verifier).
- `src/domain/design-tokens/spacing-scale.ts` — rewritten (validation, configurable steps/factor/root).
- `src/domain/inspection/style-extractor.ts` — rewritten (real color conversion, unsupported reporting, derived blueprint).
- `src/domain/bidi/logical-properties.ts` — added `auditOpticalCentering`.

**Contracts, tools, server**
- `src/contracts/index.ts` — new/updated parameters, mixed-action annotations, strongly typed nested output schemas, error branch for the Python runner; recheck round adds `contrastBackdropHex`, `textUse` and the new gradient-contrast / APCA lookup output fields.
- `src/server.ts` — isError contract, ZodEffects shape unwrapping, new tool registration.
- `src/tools/tokens.tool.ts`, `gradient.tool.ts`, `spacing.tool.ts`, `validate.tool.ts`, `inspect.tool.ts`, `python-runner.tool.ts`, `capture.tool.ts` — rewritten/updated.
- `src/tools/fluid.tool.ts` — new (`ink_generate_fluid_scale`).
- `src/integrations/python/python-bridge.ts` — per-action timeouts.

**Python**
- `python/ink_verifier/contrast.py` — rewritten (exact WCAG classification, APCA 0.98G, strict parsing incl. `oklch()`).
- `python/ink_verifier/cli.py` — `ValueError` handling → error result.
- `python/ink_verifier/viewport_capture.py` — 30s capture budget, explicit `TimeoutExpired` cleanup, `INK_CAPTURE_SKIP_BROWSER=1` deterministic SVG switch.
- `python/test/test_verifier.py` — expanded (9 → 20 tests); capture tests force the SVG fallback and cover the timeout cleanup.

**Tests (TypeScript)**
- `test/unit/color-math.test.ts`, `apca.test.ts`, `gamut-mapper.test.ts`, `palette-generator.test.ts`, `gradient-interpolator.test.ts`, `typography-generator.test.ts`, `spacing-scale.test.ts`, `style-extractor.test.ts`, `logical-properties.test.ts` — rewritten/expanded.
- `test/contract/server.test.ts` — rewritten (14 tools, mocked backends, flag behavior, schema compliance).
- `test/integration/mcp-transport.test.ts` — new (tools/list + tools/call over MCP transport).
- `test/integration/python-bridge.test.ts` — expanded (TS↔Python parity, error handling, parsing).

**Docs**
- `README.md`, `CHANGELOG.md` (1.3.0), `docs/architecture.md` — rewritten.
- `docs/audit-2026-10-03/verify.mjs` — rewritten to verify corrected behavior.
- `docs/audit-2026-10-03/verify-dist.mjs` — new packaged-executable probe.
- `docs/audit-2026-10-03/mcp-tools-schema.json` — regenerated snapshot (14 tools).
- `docs/audit-2026-10-03/verification-results-postfix.json` — new post-fix evidence.
- `docs/audit-2026-10-03/report.md`, `verification-results.json` — original audit evidence preserved unchanged.

## 6. New and changed tool parameters

| Tool | Parameter | Type | Default | Purpose |
|---|---|---|---|---|
| `ink_generate_palette_tokens` | `target` | `srgb \| p3` | `srgb` | Gamut used for mapping, exports and the audit |
| | `rampSteps` | int 2–32 | preset (7) | Stops per perceptual ramp |
| | `lightnessMode` | `equal \| eased` | `equal` | Uniform OKLCH lightness increments or eased curve |
| | `lightnessEasing` | `[x1,y1,x2,y2]` | – | Cubic-Bézier control points (real curve evaluation) |
| | `chromaProfile` | `constant \| linear \| bell \| eased` | preset | Chroma shape along every ramp |
| | `ramps.surface/text/accent` | object | – | Per-ramp lightness/chroma/hue endpoints and steps |
| | `contrastTarget` | `aa \| aaa \| aa-large \| none` | `aa` | Threshold for text pairings (UI pairings always 3:1) |
| | `correctionMode` | `none \| text-lightness \| both` | `text-lightness` | Lightness-only correction policy |
| | `maxCorrectionDelta` | number 0–0.5 | `0.35` | Maximum lightness change per token |
| | `typographyBasePx` / `typographyRatio` / `typographyStepRange` | number / number / `[int,int]` | 16 / 1.25 / `[-1,5]` | Geometric typography `size(n) = base * ratio^n` |
| | `rootFontPx` | number | `16` | Root font size for every rem conversion |
| | `spacingFluidMinFactor` | number (0,1] | `0.85` | Lower fluid bound of each spacing step |
| `ink_generate_gradient` | `stops` | array (2–16) | – | Authored stops with positions and alpha |
| | `interpolationSpace` | `oklch \| oklab` | `oklch` | Interpolation space (CSS `in oklch` / `in oklab`) |
| | `huePath` | `shorter \| longer \| increasing \| decreasing` | `shorter` | Hue interpolation path |
| | `steps` | **integer** 2–16 | `5` | Sample count (fractional values rejected) |
| | `gamutValidationSamples` | int 8–512 | `64` | Sampled gamut-validation positions |
| | `contrastForegroundHex` / `contrastSamplePositions` / `contrastTarget` | hex / number[] / enum | – | Contrast sampling over the gradient |
| | `contrastBackdropHex` | hex | `#ffffff` | Canvas color transparent stops are composited over before contrast is measured |
| `ink_generate_spacing_scale` | `steps`, `stepCount`, `fluidMinFactor`, `rootFontPx` | array / int / number / number | 9-step preset / – / `0.85` / `16` | Configurable spacing scale |
| `ink_validate_design` | `checkCentering` (already declared, now implemented) | boolean | `true` | Optical centering + overflow audit |
| | `textFontSizePx`, `textFontWeight` | number | – | Font-size/weight-aware APCA guidance |
| | `textUse` | `body \| large \| non-text` | `large` | Use case for the APCA font lookup; `body` applies the documented +15 Lc adjustment below Lc 70 |
| `ink_inspect_website_style` | `target` | `srgb \| p3` | `srgb` | Gamut for extracted-color conversion |
| `ink_generate_fluid_scale` (new tool) | `entries`, `minSizePx`, `maxSizePx`, `minViewportPx`, `maxViewportPx`, `rootFontPx`, `unit`, `remPrecision`, `vwPrecision` | array / number | 16 / 32 / 360 / 1440 / 16 / `rem` | General fluid `clamp()` generation |

## 7. Mathematical policies summary

- **WCAG 2.1**: relative luminance with the 0.04045 threshold; ratio `(max+0.05)/(min+0.05)`; classification from `ratioExact`; display rounding 2 decimals; thresholds 4.5 / 7 / 3 / 4.5 / 3.
- **APCA 0.98G**: `Ys = 0.2126729R^2.4 + 0.7151522G^2.4 + 0.0721750B^2.4`; black soft clamp `Y + (0.022 − Y)^1.414`; ΔY guard `0.0005`; BoW `((Ybg^0.56 − Ytxt^0.57) × 1.14 − 0.027) × 100`; WoB `((Ybg^0.65 − Ytxt^0.62) × 1.14 + 0.027) × 100`; clip at ∓0.1; no output clamp; inputs outside `[0, 1.1]` return 0.
- **APCA font lookup**: published apca-w3 `fontLookupAPCA` matrix (rows Lc 0–125, columns weight 100–900) with the reference row interpolation rule; `|Lc|` above `APCA_FONT_MAX_LC` = 125 clamps to the last row; `999` = `APCA_FONT_PROHIBITED`, `777` = `APCA_FONT_NON_TEXT_ONLY`, neither passes for text; `use: "body"` adds 15 Lc when `|Lc| < 70`.
- **Gamut mapping**: CSS Color 4 §14.2.2 binary search with local MINDE; JND 0.02; MINDE 0.01; chroma ε 1e-4; membership ε 1e-9; serialized-channel check 1/510; constant-L/H trim after mapping; `deltaEOK` computed from clipped target channels via `targetChannelsToOklab`.
- **Gradient interpolation**: CSS Color 4 §13.4 premultiplied alpha applied in the selected space — `L`, `a`, `b` for rectangular OKLab; `L`, `C` premultiplied with a normally interpolated hue for cylindrical OKLCH; equal alpha on all stops is plain interpolation.
- **Gradient CSS**: alpha inside the function (`oklch(L C H / A)`, `color(display-p3 r g b / A)`); interpolation method always serialized (`in oklch <huePath> hue`, `in oklab` without a hue method); authored positions serialized whenever they differ from implicit even spacing.
- **Gradient contrast**: each sample is alpha-composited over `contrastBackdropHex` (default `#ffffff`) in gamma-encoded sRGB (`out = fg·α + bg·(1 − α)`) before WCAG/APCA is measured on the resulting opaque color.
- **Fluid clamp**: `slope = (max − min) / (maxVw − minVw)`, `intercept = min − minVw × slope`, serialized as `clamp(min/root rem, intercept/root rem + slope×100 vw, max/root rem)` with rem 5dp / vw 4dp; endpoint tolerance 0.01px.
- **Modular spacing**: `px = round2(basePx × ratio^n)`; `ratio ≥ 1` enforced; fluid lower bound `px × fluidMinFactor`; rem via configurable `rootFontPx`.
- **Ramp easing**: real cubic-Bézier evaluation (Newton-Raphson with bisection fallback), x control points constrained to `[0, 1]`.