/**
 * Website Style Reverse-Engineering & Inspection (TypeScript Domain)
 * Extracts typography, colors, shadows, and design archetypes from code
 * snippets, and converts extracted colors into OKLCH with real color math
 * (sRGB -> linear -> OKLab -> OKLCH), gamut mapped under an explicit target.
 */

import { GamutTarget, mapToGamut, oklchToCssString } from "../design-tokens/gamut-mapper.js";
import { cssColorToOklch, parseCssColorToRgb01 } from "../design-tokens/color-math.js";

export interface InspectedColor {
  /** Original color literal found in the source. */
  source: string;
  /** Normalized sRGB 0-1 channels. */
  srgb: { r: number; g: number; b: number };
  /** Gamut-mapped OKLCH triple. */
  oklch: { l: number; c: number; h: number };
  /** Gamut-mapped sRGB fallback hex. */
  hex: string;
  /** CSS custom-property name when the color was declared as a token. */
  token?: string;
  /** True when the source color had to be chroma-reduced for the target gamut. */
  gamutMapped: boolean;
  css: string;
}

export interface InspectedDesignStyle {
  archetype: string;
  colors: string[];
  /** Converted color records (same order as `colors`). */
  convertedColors: InspectedColor[];
  /** Literals that could not be converted (e.g. hsl(), named colors). */
  unsupportedColors: string[];
  fonts: string[];
  hasGlassmorphism: boolean;
  hasFluidTypography: boolean;
  hasArabicTypography: boolean;
  upgradeBlueprint: {
    bgSurfaceOklch: string;
    accentPrimaryOklch: string;
    textPrimaryOklch: string;
    shadowSystem: string;
  };
}

/**
 * Extract color literals in source order.
 *
 * Hex, rgb()/rgba() and oklch() literals are convertible; hsl()/hsla()/hwb()
 * literals are extracted too so they can be reported as unsupported instead of
 * disappearing silently.
 */
export function extractColorLiterals(source: string): Array<{ source: string; token?: string }> {
  const colorSource =
    "(#[0-9a-fA-F]{3,8}\\b|rgba?\\([^)]*\\)|hsla?\\([^)]*\\)|hwb\\([^)]*\\)|oklch\\([^)]*\\))";
  const pattern = new RegExp(`(--[A-Za-z0-9_-]+)\\s*:\\s*${colorSource}`, "g");
  const tokenMatches: Array<{ source: string; token: string; index: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    tokenMatches.push({ source: match[2]!, token: match[1]!, index: match.index });
  }

  const bare = new RegExp(colorSource, "g");
  const literals: Array<{ source: string; token?: string; index: number }> = [];
  while ((match = bare.exec(source)) !== null) {
    // Attach the closest preceding custom-property declaration (not just any).
    let tokenMatch: { token: string; index: number } | undefined;
    for (const candidate of tokenMatches) {
      if (candidate.index <= match!.index && (!tokenMatch || candidate.index > tokenMatch.index)) {
        tokenMatch = candidate;
      }
    }
    literals.push({ source: match[1]!, token: tokenMatch?.token, index: match.index });
  }

  const seen = new Set<string>();
  const unique: Array<{ source: string; token?: string }> = [];
  for (const literal of literals) {
    const key = literal.token ? `${literal.token}:${literal.source}` : literal.source.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({ source: literal.source, token: literal.token });
  }
  return unique;
}

/**
 * Convert extracted color literals into OKLCH using the real color pipeline.
 * Unsupported literals (e.g. hsl() or named colors) are reported in
 * `unsupported` instead of being silently replaced by a fixed palette.
 */
export function convertExtractedColors(
  literals: Array<{ source: string; token?: string }>,
  target: GamutTarget = "srgb",
  limit = 12
): { colors: InspectedColor[]; unsupported: string[] } {
  const colors: InspectedColor[] = [];
  const unsupported: string[] = [];

  for (const literal of literals.slice(0, limit)) {
    const value = literal.source.trim();
    if (/^oklch\(/i.test(value)) {
      const parsed = value
        .replace(/^oklch\(/i, "")
        .replace(/\)$/, "")
        .trim()
        .split(/[\s/]+/)
        .map((part) => Number.parseFloat(part));
      const [l, c, h] = parsed;
      if (
        l === undefined ||
        c === undefined ||
        h === undefined ||
        !Number.isFinite(l) ||
        !Number.isFinite(c) ||
        !Number.isFinite(h)
      ) {
        unsupported.push(value);
        continue;
      }
      const mapped = mapToGamut(l, c, h, target);
      colors.push({
        source: value,
        token: literal.token,
        srgb: mapped.srgb,
        oklch: { l: mapped.oklch.l, c: mapped.oklch.c, h: mapped.oklch.h },
        hex: mapped.hex,
        gamutMapped: mapped.mapped,
        css: oklchToCssString(mapped.oklch.l, mapped.oklch.c, mapped.oklch.h)
      });
      continue;
    }

    const rgb = parseCssColorToRgb01(value);
    if (!rgb) {
      unsupported.push(value);
      continue;
    }
    const converted = cssColorToOklch(value, target);
    if (!converted) {
      unsupported.push(value);
      continue;
    }
    colors.push({
      source: value,
      token: literal.token,
      srgb: rgb,
      oklch: converted.oklch,
      hex: converted.hex,
      gamutMapped: mapToGamut(converted.oklch.l, converted.oklch.c, converted.oklch.h, target).mapped,
      css: converted.css
    });
  }

  return { colors, unsupported };
}

export function inspectDesignStyle(
  code: string,
  target: GamutTarget = "srgb"
): InspectedDesignStyle {
  const literals = extractColorLiterals(code);
  const hexColors = literals.map((l) => l.source).slice(0, 10);
  const { colors: convertedColors, unsupported } = convertExtractedColors(literals, target, 12);

  const fonts = Array.from(
    new Set(
      (code.match(/font-family\s*:\s*([^;]+);/gi) || [])
        .map((f) => f.replace(/font-family\s*:\s*/i, "").replace(";", ""))
        .flatMap((s) => s.split(","))
        .map((p) => p.trim().replace(/['"]/g, ""))
        .filter((p) => !["sans-serif", "serif", "monospace", "inherit"].includes(p.toLowerCase()))
    )
  ).slice(0, 6);

  const hasGlassmorphism = /backdrop-filter|blur\(/i.test(code);
  const hasFluidTypography = /clamp\(/i.test(code);
  const hasArabicTypography = /cairo|tajawal|amiri|readex|plex sans arabic|almarai/i.test(code);

  const isDark = /background(?:-color)?\s*:\s*(?:#0[0-9a-fA-F]{2,5}|#1[0-9a-fA-F]{2,5})/i.test(code);
  const archetype = isDark && hasGlassmorphism ? "Luxury Dark" : hasArabicTypography ? "Bilingual High-Craft" : "Modern Editorial";

  // Blueprint tokens are derived from the actual extracted colors (darkest
  // surface, most chromatic color, lightest text) rather than a fixed palette.
  const sorted = [...convertedColors].sort((a, b) => a.oklch.l - b.oklch.l);
  const darkest = sorted[0];
  const lightest = sorted[sorted.length - 1];
  const chromatic = [...convertedColors].sort(
    (a, b) => b.oklch.c * (1 - Math.abs(b.oklch.l - 0.62)) - a.oklch.c * (1 - Math.abs(a.oklch.l - 0.62))
  )[0];

  return {
    archetype,
    colors: hexColors,
    convertedColors,
    unsupportedColors: unsupported,
    fonts,
    hasGlassmorphism,
    hasFluidTypography,
    hasArabicTypography,
    upgradeBlueprint: {
      bgSurfaceOklch: darkest ? darkest.css : "oklch(0.12 0.015 220)",
      accentPrimaryOklch: chromatic ? chromatic.css : "oklch(0.68 0.16 200)",
      textPrimaryOklch: lightest ? lightest.css : "oklch(0.96 0.01 220)",
      shadowSystem: "0 4px 6px -1px rgba(0,0,0,0.35), 0 2px 4px -2px rgba(0,0,0,0.3)"
    }
  };
}