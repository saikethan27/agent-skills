import {
  PaletteTokensInput,
  PaletteTokensInputSchema,
  PaletteTokensOutputSchema,
  ReadOnlyAnnotations
} from "../contracts/index.js";
import { generatePalette } from "../domain/design-tokens/palette-generator.js";
import { generateTypographySystem } from "../domain/design-tokens/typography-generator.js";
import { generateSpacingScale, generateSpacingCss } from "../domain/design-tokens/spacing-scale.js";
import { generateArabicTypography } from "../domain/bidi/arabic-typography.js";
import { apcaGuidance } from "../domain/design-tokens/apca.js";
import { createSuccessEnvelope, ResultEnvelope } from "../core/result-envelope.js";

export const tokensTool = {
  name: "ink_generate_palette_tokens",
  title: "Generate OKLCH Color Palette & Design Tokens",
  description:
    "PURPOSE: Generate OKLCH palette ramps, semantic color tokens, fluid clamp() typography and modular spacing tokens with a complete WCAG 2.1 + APCA 0.98G contrast audit.\n\n" +
    "BEHAVIOR: Synthesizes CSS custom properties and typography/spacing steps purely in-memory (zero filesystem writes, zero network access). Colors are derived from perceptual ramps (equal OKLCH lightness increments or a configurable cubic-Bezier eased curve) and gamut mapped into the requested target (sRGB or Display P3). Every text x surface pairing (including muted text and elevated/subtle surfaces) plus accent/border UI pairings is measured on the EXPORTED 8-bit sRGB fallbacks using full-precision WCAG ratios; pass/fail decisions are never taken on a rounded value.\n\n" +
    "CONTRAST BEHAVIOUR: results are reported against the requested `contrastTarget` (AA/AAA/AA-Large/none). There is NO unconditional AAA guarantee. `correctionMode` may adjust a failing token's OKLCH lightness (hue and chroma preserved) and every adjustment is reported in `adjustments`. When a pairing cannot reach the target within the documented lightness limits, it is listed in `failedPairings` and the envelope status becomes 'partial' or 'blocked'.\n\n" +
    "USAGE GUIDELINES:\n" +
    "- When to use: creating or refining a design system's color foundation, perceptual ramps, fluid typographic scales, or dark/light surface tokens.\n" +
    "- When NOT to use: extracting colors from an existing live website (use ink_inspect_website_style), scaffolding a project skeleton (use ink_create_base), or checking supplied colors (use ink_validate_design).\n" +
    "- Alternatives: ink_generate_fluid_scale for arbitrary clamp() values; ink_inspect_website_style to reverse-engineer existing sites.\n\n" +
    "RETURNS: ResultEnvelope with gamut-mapped token map (`tokens`), per-token exports incl. sRGB fallbacks (`tokenExports`), perceptual ramps (`ramps`), the full contrast audit (`contrastAnalysis`), failed pairings, adjustments, typography/spacing scales and a ready-to-use :root stylesheet.",
  annotations: ReadOnlyAnnotations,
  inputSchema: PaletteTokensInputSchema,
  outputSchema: PaletteTokensOutputSchema,
  execute: async (rawInput: unknown): Promise<ResultEnvelope<unknown>> => {
    const input: PaletteTokensInput = PaletteTokensInputSchema.parse(rawInput);

    const palette = generatePalette(input.mood, input.baseHue, {
      target: input.target,
      steps: input.rampSteps,
      lightnessMode: input.lightnessMode,
      lightnessEasing: input.lightnessEasing as [number, number, number, number] | undefined,
      chromaProfile: input.chromaProfile,
      surface: input.ramps?.surface,
      text: input.ramps?.text,
      accent: input.ramps?.accent,
      contrastTarget: input.contrastTarget,
      correctionMode: input.correctionMode,
      maxCorrectionDelta: input.maxCorrectionDelta
    });

    const typography = input.includeTypography
      ? generateTypographySystem(
          "modern-editorial",
          { minVw: input.minVw, maxVw: input.maxVw, rootFontPx: input.rootFontPx },
          {
            geometric: {
              basePx: input.typographyBasePx,
              ratio: input.typographyRatio,
              stepRange: input.typographyStepRange as [number, number]
            }
          }
        )
      : null;

    const spacingScale = generateSpacingScale(input.spacingBase, input.spacingRatio, {
      minVw: input.minVw,
      maxVw: input.maxVw,
      fluid: input.spacingFluid,
      fluidMinFactor: input.spacingFluidMinFactor,
      rootFontPx: input.rootFontPx
    });
    const spacingCss = generateSpacingCss(spacingScale);

    // includeArabicTokens actually changes the output: Arabic font stacks,
    // optical line-heights and bidi fallbacks are merged into the CSS block
    // and returned as a typed payload.
    const arabicTypography = input.includeArabicTokens
      ? generateArabicTypography("ibm-plex", { minVw: input.minVw, maxVw: input.maxVw })
      : null;
    const arabicTokens = arabicTypography
      ? {
          fontPrimary: arabicTypography.fontFamilies.primary,
          fontDisplay: arabicTypography.fontFamilies.display,
          lineHeightBody: arabicTypography.steps.body.lineHeight,
          lineHeightCaption: arabicTypography.steps.caption.lineHeight,
          lineHeightDisplay: arabicTypography.steps.display.lineHeight,
          steps: Object.keys(arabicTypography.steps),
          cssVariables: arabicTypography.cssVariables,
          googleFontsLink: arabicTypography.googleFontsLink
        }
      : null;

    const fullCss = [
      palette.cssVariables,
      typography ? typography.cssVariables : "",
      spacingCss,
      // Arabic optical line heights are emitted last so they win on :root.
      input.includeArabicTokens
        ? `--ink-leading-body-ar: ${arabicTypography!.steps.body.lineHeight};
  --ink-leading-caption-ar: ${arabicTypography!.steps.caption.lineHeight};
  --ink-font-ar-primary: ${arabicTypography!.fontFamilies.primary};`
        : ""
    ]
      .filter(Boolean)
      .join("\n\n");

    const tokens: Record<string, string> = Object.fromEntries(
      Object.entries(palette.tokens).map(([k, v]) => [k, v.cssString])
    );
    const tokenExports: Record<string, unknown> = Object.fromEntries(
      Object.entries(palette.tokens).map(([k, v]) => [
        k,
        {
          oklch: v.cssString,
          requestedOklch: v.requested,
          hex: v.hex,
          mapped: v.mapped,
          inSrgb: v.inSrgb,
          target: v.target
        }
      ])
    );
    const contrastAnalysis = palette.contrastAnalysis.fullAudit;
    const apcaSummary: Record<string, unknown> = Object.fromEntries(
      contrastAnalysis.map((pairing) => [
        pairing.pairing,
        {
          lc: pairing.apcaLc,
          abs: pairing.apcaAbs,
          guidance: apcaGuidance(pairing.apcaAbs)
        }
      ])
    );

    const summaryTail =
      palette.status === "success"
        ? `All ${contrastAnalysis.length} audited pairings meet the ${input.contrastTarget.toUpperCase()} target.`
        : `${palette.contrastAnalysis.failedPairings.length} of ${contrastAnalysis.length} pairings below the ${input.contrastTarget.toUpperCase()} target (${palette.contrastAnalysis.failedPairings.join(", ")}).`;

    const envelope = createSuccessEnvelope(
      `Generated OKLCH design tokens for mood: ${input.mood} (target ${input.target}). ${summaryTail}`,
      {
        mood: input.mood,
        baseHue: palette.baseHue,
        target: palette.target,
        contrastTarget: palette.contrastTarget,
        correctionMode: palette.correctionMode,
        status: palette.status,
        tokens,
        tokenExports,
        ramps: palette.ramps,
        contrastAnalysis,
        failedPairings: palette.contrastAnalysis.failedPairings,
        adjustments: palette.contrastAnalysis.adjustments,
        typographyScale: typography?.steps,
        geometricTypography: typography?.geometric,
        cssVariables: fullCss,
        spacingScale,
        spacingCss,
        arabicTokens,
        apcaSummary
      },
      {
        warnings: palette.warnings,
        nextActions: [
          "Use the generated CSS variables in your stylesheet :root block.",
          "Invoke ink_craft_component to create UI components that consume these tokens.",
          "Check failedPairings (if any) before shipping a palette."
        ]
      }
    );

    if (palette.status !== "success") {
      envelope.status = palette.status;
    }
    return envelope;
  }
};