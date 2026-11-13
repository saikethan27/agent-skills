import {
  SpacingInput,
  SpacingInputSchema,
  SpacingOutputSchema,
  ReadOnlyAnnotations
} from "../contracts/index.js";
import { generateSpacingScale, generateSpacingCss } from "../domain/design-tokens/spacing-scale.js";
import { createSuccessEnvelope, ResultEnvelope } from "../core/result-envelope.js";

export const spacingTool = {
  name: "ink_generate_spacing_scale",
  title: "Generate Fluid Spacing Scale",
  description:
    "PURPOSE: Generate a modular spacing scale (size(n) = basePx * ratio^n) with px/rem and optional fluid clamp() tokens.\n\n" +
    "BEHAVIOR: Computes spacing steps purely in-memory from a base size and modular ratio, optionally emitting fluid clamp() tokens scaled between minVw and maxVw. Zero filesystem writes and zero network access; deterministic output for identical inputs. The nine-step 3xs..3xl preset remains the default, and `steps`/`stepCount` allow a custom range or name list. The fluid lower bound is configurable through `fluidMinFactor` (default 0.85) and rem conversion honours `rootFontPx`.\n\n" +
    "VALIDATION: `basePx` must be a finite number > 0; `ratio` must be a finite number >= 1 (a decreasing scale is rejected unless explicitly allowed); when `fluid` is true both viewports must be positive with maxVw > minVw; `fluidMinFactor` must lie in (0, 1]. Invalid input fails fast with an explicit message instead of emitting NaN/Infinity CSS.\n\n" +
    "USAGE GUIDELINES:\n" +
    "- When to use: establishing layout rhythm, gap tokens, or padding scales for a design system.\n" +
    "- When NOT to use: color tokens (ink_generate_palette_tokens), gradients (ink_generate_gradient), or arbitrary fluid clamps (ink_generate_fluid_scale).\n" +
    "- Alternatives: ink_generate_fluid_scale for one-off clamp() values; ink_generate_palette_tokens for a combined color+spacing system.\n\n" +
    "RETURNS: ResultEnvelope with the `tokens` scale map (px/rem/clamp/fluidMinPx/step index), a ready-to-paste CSS ':root' block, and the resolved scale parameters.",
  annotations: ReadOnlyAnnotations,
  inputSchema: SpacingInputSchema,
  outputSchema: SpacingOutputSchema,
  execute: async (rawInput: unknown): Promise<ResultEnvelope<unknown>> => {
    const input: SpacingInput = SpacingInputSchema.parse(rawInput);

    const scale = generateSpacingScale(input.basePx, input.ratio, {
      minVw: input.minVw,
      maxVw: input.maxVw,
      fluid: input.fluid,
      fluidMinFactor: input.fluidMinFactor,
      rootFontPx: input.rootFontPx,
      steps: input.steps,
      stepCount: input.stepCount
    });
    const css = generateSpacingCss(scale);

    return createSuccessEnvelope(
      `Generated ${Object.keys(scale).length}-step spacing scale (base ${input.basePx}px, ratio ${input.ratio}${
        input.fluid ? ", fluid" : ""
      }).`,
      {
        tokens: scale,
        css,
        basePx: input.basePx,
        ratio: input.ratio,
        rootFontPx: input.rootFontPx,
        fluidMinFactor: input.fluidMinFactor,
        viewport: { minVw: input.minVw, maxVw: input.maxVw }
      },
      {
        nextActions: [
          "Use the CSS variables in your stylesheet :root block.",
          "Invoke ink_generate_palette_tokens for a matching color system."
        ]
      }
    );
  }
};