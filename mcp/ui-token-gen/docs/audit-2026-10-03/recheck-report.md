# Independent verification of 1.3.0

**Verdict: PARTIAL. Most original defects are fixed, but the implementation is not fully corrected.** This independently checks the remediation rather than accepting the existing fix report's PASS verdict.

Fresh verification on 3 October 2026:
- 173 Vitest tests passed; 20 Python tests passed; typechecking passed.
- The Python suite logged a Chrome capture timeout; its overall pass does not establish reliable live-browser capture.
- Both audit scripts completed. The packaged stdio executable reports 1.3.0 and exposes 14 tools, including `ink_generate_fluid_scale`.
- All 40 compiled JavaScript files match the source ESM emit after normalizing line endings and source-map comments. No implementation files were changed during this recheck.

| Area | Independent result |
| :--- | :--- |
| WCAG unrounded decisions | PASS: #148700/black displays 4.50 but fails normal AA |
| APCA contrast equations | PASS on the reference vectors; font guidance remains an explicitly labelled approximation |
| Palette ramps and audits | Implemented: configurable ramps/easing, 12 pairings, correction, failures, Arabic flag |
| Fluid typography and spacing | Implemented and regression probes pass: root size, geometric scales, custom steps, factor, invalid-input rejection |
| MCP | Tested discovery/success/invalid input/backend errors pass; target forwarding and annotations corrected |
| P3 export bytes | Original P3-as-hex defect is fixed, but out-of-gamut P3 mapping still has the conversion defect below |
| Gradients | Authored stops/OKLab/alpha exist, but CSS export, alpha math and contrast have the defects below |

## Remaining defects

1. **High: P3 gamut mapping converts P3 channels as sRGB.** [gamut-mapper.ts:439](G:/agent-skills/mcp/ui-token-gen/src/domain/design-tokens/gamut-mapper.ts:439), and lines 450/471, call `srgb01ToOklab` on channels from the selected target. For `target=p3`, decode the P3 transfer function and convert through the P3-to-XYZ/linear-sRGB matrix before OKLab. An independent target-aware implementation of [CSS Color 4 local MINDE](https://www.w3.org/TR/css-color-4/#binsearch) maps `oklch(0.7 0.3 30)` to P3 channels approximately `(1,0.2851,0.1928)`; the package gives `(0.9262,0.3961,0.3011)`. The outputs differ by **0.05587 deltaEOK**. Current tests check output relationships using the same mapper, so they miss this error.

2. **High: transparent OKLCH CSS is invalid.** [gradient-interpolator.ts:338](G:/agent-skills/mcp/ui-token-gen/src/domain/design-tokens/gradient-interpolator.ts:338) appends alpha after a closed color function: `oklch(0.600 0.100 30) / 0.5`. The alpha belongs inside: `oklch(0.600 0.100 30 / 0.5)`. The primary sRGB-target `css` and `srgbCss` fields are affected; the independently emitted hex gradient is syntactically valid.

3. **High: transparency silently switches interpolation space.** [gradient-interpolator.ts:285](G:/agent-skills/mcp/ui-token-gen/src/domain/design-tokens/gradient-interpolator.ts:285) always premultiplies OKLab components whenever alpha is below 1, even when OKLCH was selected. Equal-alpha colors `(L=.6,C=.1,H=30)` and `(L=.6,C=.1,H=150)` should have an OKLCH midpoint `(.6,.1,90)`; the package computes `(.6,.05,90)`. Premultiply the selected space's non-hue components and interpolate hue separately, as specified by [CSS Color 4 alpha interpolation](https://www.w3.org/TR/css-color-4/#interpolation-alpha).

4. **High: gradient contrast ignores alpha and the canvas beneath the gradient.** [gradient-interpolator.ts:676](G:/agent-skills/mcp/ui-token-gen/src/domain/design-tokens/gradient-interpolator.ts:676) discards the interpolated alpha and measures the opaque color. White text over a fully transparent black gradient is reported as **21:1 and passing**. On a white canvas the actual contrast is **1:1**. Accept an explicit underlying background and composite before contrast calculation, or refuse to certify transparent-gradient contrast without that context. The wide-gamut contrast policy also evaluates sRGB fallbacks, not the actual P3 rendering; that limitation should stay explicit.

5. **Medium: CSS drops authored positions and hue settings.** [gradient-interpolator.ts:483](G:/agent-skills/mcp/ui-token-gen/src/domain/design-tokens/gradient-interpolator.ts:483) emits positions only when there are more than two stops: two authored stops at 20%/80% become implicit 0%/100%. [gradient-interpolator.ts:502](G:/agent-skills/mcp/ui-token-gen/src/domain/design-tokens/gradient-interpolator.ts:502) emits `in oklch` without the requested `longer/increasing/decreasing hue` method, so browser interpolation can disagree with computed samples. Preserve explicit positions for two authored stops and serialize the hue method.

APCA font-size/weight guidance and continuous gradient-gamut coverage remain documented approximations/sampling limits. These are not substitutes for the exact reference font lookup or a proof of every gradient point.

Reproductions are in [independent-recheck.mjs](G:/agent-skills/mcp/ui-token-gen/docs/audit-2026-10-03/independent-recheck.mjs); fresh numeric evidence is in [independent-recheck-results.json](G:/agent-skills/mcp/ui-token-gen/docs/audit-2026-10-03/independent-recheck-results.json). Existing remediation probes are in `verification-results-postfix.json`. Preserve these cases as regression tests before claiming the entire update passes.
