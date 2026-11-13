import {
  GradientInput,
  GradientInputSchema,
  GradientOutputSchema,
  ReadOnlyAnnotations
} from "../contracts/index.js";
import {
  AuthoredStop,
  contrastOverGradient,
  generateAuthoredGradient,
  generateGradient,
  GeneratedGradient
} from "../domain/design-tokens/gradient-interpolator.js";
import { createSuccessEnvelope, ResultEnvelope } from "../core/result-envelope.js";

export const gradientTool = {
  name: "ink_generate_gradient",
  title: "Generate Perceptual OKLCH/OKLab Gradient",
  description:
    "PURPOSE: Interpolate a perceptual multi-stop gradient in OKLCH or OKLab space with CSS Color 4 gamut mapping and independent sRGB/Display P3 exports.\n\n" +
    "BEHAVIOR: Computes stops purely in-memory (zero filesystem writes, zero network access, deterministic output). Either two endpoints (`fromOklch`/`toOklch` plus an integer `steps`) or an authored `stops` array with explicit positions and optional alpha. `steps` must be an integer - fractional counts are rejected instead of silently floored. Stop positions are validated (finite, within [0,1], non-decreasing). Alpha below 1 switches to premultiplied interpolation so transparent stops do not produce dark halos. CSS interpolation is always explicit: `linear-gradient(<direction> in oklch|oklab, ...)`. Stops are gamut mapped with the CSS Color 4 binary-search local-MINDE algorithm; the target-gamut CSS and an INDEPENDENT sRGB fallback are both emitted, and Display P3 channels are never encoded as #rrggbb.\n\n" +
    "GAMUT POLICY: gamut validation is SAMPLED at `gamutValidationSamples` uniform positions. Passing samples do not prove every point of the continuous gradient is in gamut; the returned `gamut` object states the policy, sample count and whether any sample required chroma reduction.\n\n" +
    "CSS OUTPUT: stop positions are serialized whenever they differ from the implicit even spacing (so authored two-stop positions such as 20%/80% survive), the hue interpolation method is always written (`in oklch shorter hue` / `longer hue` / `increasing hue` / `decreasing hue`), and alpha is written INSIDE the color function (`oklch(L C H / A)`, `color(display-p3 r g b / A)`). Transparency uses CSS Color 4 premultiplied interpolation in the selected space: for polar OKLCH the hue is not premultiplied, so equal-alpha polar stops keep their chroma and hue arc.\n\n" +
    "CONTRAST POLICY: WCAG/APCA are defined on opaque colors, so transparent stops are alpha-composited over `contrastBackdropHex` (default #ffffff) before measuring. The report states the backdrop, the composited background, the opaque gradient color and the interpolated alpha per sample.\n\n" +
    "USAGE GUIDELINES:\n" +
    "- When to use: smooth brand gradients, background ramps, or accent transitions with authored stop positions and transparency.\n" +
    "- When NOT to use: scaffolding projects (ink_create_base), token systems (ink_generate_palette_tokens), or one-off contrast checks (ink_validate_design).\n" +
    "- Alternatives: ink_generate_palette_tokens for full token systems; ink_generate_spacing_scale for layout rhythm.\n\n" +
    "RETURNS: ResultEnvelope with `stops` (dual-gamut export data per stop), `css`, `cssSrgb`, `cssP3`, `hexes`, the sampled `gamut` report and - when `contrastForegroundHex` is supplied - a contrast report with every sample, the compositing context and the reported worst case.",
  annotations: ReadOnlyAnnotations,
  inputSchema: GradientInputSchema,
  outputSchema: GradientOutputSchema,
  execute: async (rawInput: unknown): Promise<ResultEnvelope<unknown>> => {
    const input: GradientInput = GradientInputSchema.parse(rawInput);

    const authored: AuthoredStop[] =
      input.stops && input.stops.length >= 2
        ? input.stops.map((stop) => ({
            oklch: stop.oklch,
            position: stop.position,
            alpha: stop.alpha
          }))
        : [
            { oklch: input.fromOklch!, position: 0 },
            { oklch: input.toOklch!, position: 1 }
          ];

    const useAuthored = Boolean(input.stops && input.stops.length >= 2);
    const gradient: GeneratedGradient = useAuthored
      ? generateAuthoredGradient(authored, {
          target: input.target,
          interpolationSpace: input.interpolationSpace,
          huePath: input.huePath,
          direction: input.direction,
          gamutValidationSamples: input.gamutValidationSamples
        })
      : generateGradient(input.fromOklch!, input.toOklch!, input.steps, input.target, {
          interpolationSpace: input.interpolationSpace,
          huePath: input.huePath,
          direction: input.direction,
          gamutValidationSamples: input.gamutValidationSamples
        });

    const contrastReport = input.contrastForegroundHex
      ? contrastOverGradient(authored, input.contrastForegroundHex, {
          target: input.target,
          interpolationSpace: input.interpolationSpace,
          huePath: input.huePath,
          positions: input.contrastSamplePositions,
          contrastTarget: input.contrastTarget,
          backdropHex: input.contrastBackdropHex
        })
      : undefined;

    const warnings: string[] = [];
    if (!gradient.gamut.allSamplesInGamut) {
      warnings.push(
        `Sampled gamut validation found out-of-gamut samples; ${gradient.gamut.mappedSamples} of ${gradient.gamut.samplesChecked} positions required chroma reduction.`
      );
    }
    if (gradient.gamut.mappedSamples > 0) {
      warnings.push(
        "Individual stops are gamut mapped, but unsampled positions between stops may still leave the target gamut."
      );
    }
    if (contrastReport && !contrastReport.meetsTarget) {
      warnings.push(
        `Contrast over the gradient reaches only ${contrastReport.worstCase.ratio}:1 at position ${contrastReport.worstCase.position}, below the requested ${input.contrastTarget.toUpperCase()} target.`
      );
    }
    if (contrastReport?.compositedAlpha) {
      warnings.push(
        `Some sampled stops are transparent and were composited over the backdrop ${contrastReport.backdropHex}; pass contrastBackdropHex when the canvas color differs.`
      );
    }

    return createSuccessEnvelope(
      `Generated ${gradient.stops.length}-stop ${gradient.interpolationSpace} gradient (${gradient.target}, ${gradient.huePath} hue path) with ${gradient.gamut.samplesChecked}-sample gamut validation.`,
      {
        stops: gradient.stops,
        css: gradient.css,
        cssSrgb: gradient.cssSrgb,
        cssP3: gradient.cssP3,
        hexes: gradient.hexes,
        target: gradient.target,
        interpolationSpace: gradient.interpolationSpace,
        huePath: gradient.huePath,
        direction: gradient.direction,
        gamut: gradient.gamut,
        contrast: contrastReport
      },
      {
        warnings,
        nextActions: [
          "Use the CSS gradient string in your stylesheet background property.",
          "Supply contrastForegroundHex next time to get a worst-case contrast report for text over the gradient.",
          "Run ink_validate_design to verify text contrast over the rendered result."
        ]
      }
    );
  }
};