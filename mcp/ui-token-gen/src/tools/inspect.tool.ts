import {
  InspectWebsiteStyleInput,
  InspectWebsiteStyleInputSchema,
  InspectWebsiteStyleOutputSchema,
  OpenWorldReadOnlyAnnotations
} from "../contracts/index.js";
import { inspectDesignStyle } from "../domain/inspection/style-extractor.js";
import { PythonBridge } from "../integrations/python/python-bridge.js";
import { createSuccessEnvelope, createErrorEnvelope, ResultEnvelope } from "../core/result-envelope.js";

/** Convert extracted hex/rgb()/oklch() literals into a :root OKLCH block. */
function buildOklchPaletteCss(
  converted: Array<{ token?: string; css: string; hex: string }>
): string {
  const lines = converted
    .filter((color) => color.css.length > 0)
    .map((color, index) => {
      const name = color.token ? color.token.replace(/^--/, "") : `extracted-${index + 1}`;
      return `  --ink-${name}: ${color.css};\n  --ink-${name}-fallback: ${color.hex};`;
    });
  return `:root {\n${lines.join("\n")}\n}`;
}

/** Merge Python-inspection output into the tool's declared payload shape. */
function mapPythonInspection(
  data: Record<string, unknown>,
  extractOklchPalette: boolean
): Record<string, unknown> {
  const palette = (data.extractedPalette ?? {}) as {
    hexColors?: string[];
    rgbColors?: string[];
    oklchColors?: string[];
  };
  const literals = [...(palette.hexColors ?? []), ...(palette.rgbColors ?? [])].slice(0, 12);
  const cssSource = literals.map((literal) => `  :root { --extracted: ${literal}; }`).join("\n");
  const convertedReport = extractOklchPalette ? inspectDesignStyle(cssSource) : null;

  return {
    ...data,
    archetype: data.inferredArchetype ?? "Unknown",
    colors: literals,
    convertedColors: convertedReport ? convertedReport.convertedColors : undefined,
    unsupportedColors: convertedReport ? convertedReport.unsupportedColors : undefined,
    typography: data.extractedTypography ?? {},
    shadows: (data.extractedTactileElements as { shadowStyles?: string[] } | undefined)?.shadowStyles ?? [],
    layoutDna: data.extractedTactileElements ?? {},
    recommendedOklchPalette: convertedReport
      ? `:root { --ink-bg-surface: ${convertedReport.upgradeBlueprint.bgSurfaceOklch}; --ink-accent-primary: ${convertedReport.upgradeBlueprint.accentPrimaryOklch}; --ink-text-primary: ${convertedReport.upgradeBlueprint.textPrimaryOklch}; }`
      : undefined,
    oklchPaletteCss: convertedReport
      ? buildOklchPaletteCss(convertedReport.convertedColors)
      : undefined
  };
}

export const inspectTool = {
  name: "ink_inspect_website_style",
  title: "Inspect & Reverse-Engineer Website Style",
  description:
    "PURPOSE: Deconstruct existing live websites or HTML/CSS templates to reverse-engineer color palettes, typography scales, elevation shadows, and layout DNA into modern OKLCH tokens.\n\n" +
    "BEHAVIOR: Fetches public website markup over HTTPS (10s timeout, redirect limits, private-subnet blocking) or parses local HTML/CSS in-memory. Strictly read-only with zero disk modifications. `extractOklchPalette` is applied to BOTH paths: every extracted hex, rgb()/rgba() and oklch() literal is converted with real color math (sRGB -> linear -> OKLab -> OKLCH) and gamut mapped for the requested target. Literals that cannot be converted are reported in `unsupportedColors` instead of being replaced by a fixed palette, and the recommended token block is derived from the actual extracted colors.\n\n" +
    "USAGE GUIDELINES:\n" +
    "- When to use: analyzing a reference website or mockup to extract its visual hierarchy, typography system, and color ramps.\n" +
    "- When NOT to use: generating novel color tokens from scratch (ink_generate_palette_tokens) or evaluating code for anti-slop compliance (ink_validate_design).\n" +
    "- Alternatives: ink_generate_palette_tokens to synthesize new design tokens; ink_capture_viewport to capture visual snapshots.\n\n" +
    "RETURNS: ResultEnvelope with the detected 'archetype', raw 'colors', converted 'convertedColors' (with OKLCH/hex/token name and gamut-mapping flag), 'unsupportedColors', 'typography', 'shadows', 'layoutDna' and the derived OKLCH token blocks.",
  annotations: OpenWorldReadOnlyAnnotations,
  inputSchema: InspectWebsiteStyleInputSchema,
  outputSchema: InspectWebsiteStyleOutputSchema,
  execute: async (rawInput: unknown): Promise<ResultEnvelope<unknown>> => {
    const input: InspectWebsiteStyleInput = InspectWebsiteStyleInputSchema.parse(rawInput);
    const isUrl = input.urlOrCode.startsWith("http://") || input.urlOrCode.startsWith("https://");

    try {
      if (isUrl) {
        const pythonResult = await PythonBridge.execute({
          action: "inspect",
          payload: { target: input.urlOrCode }
        });

        if (pythonResult.status === "error") {
          return createErrorEnvelope(
            `Failed to inspect URL: ${pythonResult.message}`,
            { error: pythonResult.message ?? "Unknown inspection error" }
          );
        }

        const mapped = mapPythonInspection(
          (pythonResult.data ?? {}) as Record<string, unknown>,
          input.extractOklchPalette
        );

        return createSuccessEnvelope(
          `Successfully reverse-engineered design DNA for: ${input.urlOrCode}.`,
          mapped,
          {
            nextActions: [
              "Apply the converted OKLCH color tokens into your project :root block.",
              "Use ink_create_base to scaffold an upgraded, high-craft version."
            ]
          }
        );
      }

      // Inline code inspection
      const tsReport = inspectDesignStyle(input.urlOrCode, input.target);
      const mapped = {
        archetype: tsReport.archetype,
        colors: tsReport.colors,
        convertedColors: input.extractOklchPalette ? tsReport.convertedColors : undefined,
        unsupportedColors: input.extractOklchPalette ? tsReport.unsupportedColors : undefined,
        typography: {
          fonts: tsReport.fonts,
          hasFluidTypography: tsReport.hasFluidTypography,
          hasArabicTypography: tsReport.hasArabicTypography
        },
        shadows: [tsReport.upgradeBlueprint.shadowSystem],
        layoutDna: {
          hasGlassmorphism: tsReport.hasGlassmorphism,
          hasFluidTypography: tsReport.hasFluidTypography
        },
        recommendedOklchPalette: `:root { --ink-bg-surface: ${tsReport.upgradeBlueprint.bgSurfaceOklch}; --ink-accent-primary: ${tsReport.upgradeBlueprint.accentPrimaryOklch}; --ink-text-primary: ${tsReport.upgradeBlueprint.textPrimaryOklch}; }`,
        oklchPaletteCss: input.extractOklchPalette
          ? buildOklchPaletteCss(tsReport.convertedColors)
          : undefined
      };

      const warnings: string[] = [];
      if (input.extractOklchPalette && tsReport.unsupportedColors.length > 0) {
        warnings.push(
          `${tsReport.unsupportedColors.length} extracted color literal(s) could not be converted to OKLCH and are reported in unsupportedColors: ${tsReport.unsupportedColors.slice(0, 5).join(", ")}.`
        );
      }

      return createSuccessEnvelope(
        `Successfully extracted design style: [${tsReport.archetype}] with ${input.extractOklchPalette ? tsReport.convertedColors.length : tsReport.colors.length} color(s).`,
        mapped,
        {
          warnings,
          nextActions: [
            "Review converted colors and typography stacks.",
            "Use ink_generate_palette_tokens with tailored baseHue to generate high-craft tokens."
          ]
        }
      );
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return createErrorEnvelope(`Failed to inspect website style: ${errorMsg}`, {
        error: errorMsg
      });
    }
  }
};