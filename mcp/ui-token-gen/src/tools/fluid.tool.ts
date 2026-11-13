import {
  FluidScaleInput,
  FluidScaleInputSchema,
  FluidScaleOutputSchema,
  ReadOnlyAnnotations
} from "../contracts/index.js";
import {
  CLAMP_ENDPOINT_TOLERANCE_PX,
  fluidClampErrorPx,
  fluidClampMetrics,
  generateFluidClamp
} from "../domain/design-tokens/typography-generator.js";
import { createSuccessEnvelope, ResultEnvelope } from "../core/result-envelope.js";

/**
 * Tool: ink_generate_fluid_scale
 * Exposes the general fluid clamp() capability used by the typography and
 * spacing generators, with configurable viewport bounds and root font size.
 */
export const fluidTool = {
  name: "ink_generate_fluid_scale",
  title: "Generate Fluid Clamp Scale",
  description:
    "PURPOSE: Generate arbitrary CSS fluid clamp() values from explicit minimum/maximum sizes and viewport bounds.\n\n" +
    "BEHAVIOR: Uses the exact linear formula slope = (maxSize - minSize) / (maxViewport - minViewport), intercept = minSize - minViewport * slope, serialized as clamp(minSize/root rem, intercept/root rem + slope*100 vw, maxSize/root rem). Purely in-memory: zero filesystem writes, zero network access, deterministic output. `rootFontPx` is configurable (default 16), so non-16px roots are handled correctly.\n\n" +
    "VALIDATION: every numeric input must be finite; sizes and viewports must be > 0; maxViewportPx must be strictly greater than minViewportPx (equal or reversed bounds are rejected instead of producing `-Infinityrem + Infinityvw`); every entry must satisfy maxPx >= minPx. Invalid input fails fast with an explicit message, so invalid CSS can never be generated.\n\n" +
    "USAGE GUIDELINES:\n" +
    "- When to use: one-off fluid sizing (fluid hero type, fluid spacing, fluid radii) or verifying the endpoint accuracy of a clamp.\n" +
    "- When NOT to use: whole type scales (ink_generate_palette_tokens with includeTypography, or ink_create_base) or complete spacing scales (ink_generate_spacing_scale).\n" +
    "- Alternatives: ink_generate_spacing_scale for modular spacing; ink_generate_palette_tokens for a full token system.\n\n" +
    "RETURNS: ResultEnvelope with one `values` entry per token (slope, intercept, clampCss and the measured endpoint values/errors), a ready-to-paste :root CSS block and the documented endpoint tolerance.",
  annotations: ReadOnlyAnnotations,
  inputSchema: FluidScaleInputSchema,
  outputSchema: FluidScaleOutputSchema,
  execute: async (rawInput: unknown): Promise<ResultEnvelope<unknown>> => {
    const input: FluidScaleInput = FluidScaleInputSchema.parse(rawInput);

    const entries =
      input.entries && input.entries.length > 0
        ? input.entries
        : [{ name: "fluid", minPx: input.minSizePx, maxPx: input.maxSizePx }];

    const clampOptions = {
      rootFontPx: input.rootFontPx,
      remPrecision: input.remPrecision,
      vwPrecision: input.vwPrecision
    };

    const values = entries.map((entry) => {
      const metrics = fluidClampMetrics(
        entry.minPx,
        entry.maxPx,
        input.minViewportPx,
        input.maxViewportPx,
        { rootFontPx: input.rootFontPx }
      );
      const clampCss = generateFluidClamp(
        entry.minPx,
        entry.maxPx,
        input.minViewportPx,
        input.maxViewportPx,
        clampOptions
      );
      const errors = fluidClampErrorPx(
        clampCss,
        input.minViewportPx,
        input.maxViewportPx,
        input.rootFontPx
      );
      return {
        name: entry.name,
        minPx: entry.minPx,
        maxPx: entry.maxPx,
        slope: metrics.slope,
        intercept: metrics.intercept,
        clampCss,
        valueAtMinViewportPx: errors.atMin,
        valueAtMaxViewportPx: errors.atMax,
        endpointErrorPx: { atMin: Math.abs(errors.atMin - entry.minPx), atMax: Math.abs(errors.atMax - entry.maxPx) }
      };
    });

    const worstError = values.reduce(
      (worst, value) => Math.max(worst, value.endpointErrorPx.atMin, value.endpointErrorPx.atMax),
      0
    );

    const unitValues =
      input.unit === "px"
        ? values.map((value) => ({
            ...value,
            clampCss: value.clampCss
              .replace(/([\d.]+)rem/g, (_m, n: string) => `${(parseFloat(n) * input.rootFontPx).toFixed(3)}px`)
              .replace(/([\d.]+)vw/g, (m) => m)
          }))
        : values;

    const css = `:root {\n${unitValues.map((v) => `  --ink-fluid-${v.name}: ${v.clampCss};`).join("\n")}\n}`;

    const warnings: string[] = [];
    if (worstError > CLAMP_ENDPOINT_TOLERANCE_PX) {
      warnings.push(
        `Endpoint rounding error ${worstError.toFixed(5)}px exceeds the documented tolerance of ${CLAMP_ENDPOINT_TOLERANCE_PX}px.`
      );
    }

    return createSuccessEnvelope(
      `Generated ${unitValues.length} fluid clamp value(s) between ${input.minViewportPx}px and ${input.maxViewportPx}px (root font ${input.rootFontPx}px).`,
      {
        values: unitValues,
        css,
        rootFontPx: input.rootFontPx,
        unit: input.unit,
        viewport: { minViewportPx: input.minViewportPx, maxViewportPx: input.maxViewportPx },
        endpointTolerancePx: CLAMP_ENDPOINT_TOLERANCE_PX,
        containsInvalidNumbers: false
      },
      {
        warnings,
        nextActions: [
          "Use the CSS variables in your stylesheet :root block.",
          "Verify rendered sizes at both viewport endpoints in the browser."
        ]
      }
    );
  }
};