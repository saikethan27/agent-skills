/**
 * Pure TypeScript Color Math & Contrast Engine
 * ======================================================================
 * - WCAG 2.1/2.2 relative luminance and contrast ratios.
 * - Compliance decisions are made on the FULL-PRECISION ratio; only the
 *   displayed `ratio` value is rounded. Example regression: #148700 on
 *   #000000 has an exact ratio of 4.4953336599, displays as 4.50, and
 *   FAILS normal-text AA.
 * - OKLCH colors are always resolved through the gamut mapper before any
 *   luminance/contrast computation, so contrast is computed from the same
 *   colors that are exported (see RenderingPolicy below).
 * - APCA 0.98G reference contrast is delegated to ./apca.js.
 */

import {
  GamutTarget,
  GamutMapResult,
  mapToGamut,
  oklchToCssString,
  oklchToSrgb,
  roundOklchForCss,
  srgb01ToOklch,
  OklchTriple
} from "./gamut-mapper.js";
import {
  ApcaResult,
  apcaForHexPair,
  apcaGuidance
} from "./apca.js";

export interface RGB {
  r: number; // 0-255
  g: number; // 0-255
  b: number; // 0-255
}

/** Normative WCAG 2.1 success-criterion thresholds (1.4.3 / 1.4.11). */
export const WCAG_THRESHOLDS = {
  normalTextAA: 4.5,
  normalTextAAA: 7,
  largeTextAA: 3,
  largeTextAAA: 4.5,
  uiComponent: 3
} as const;

export interface ContrastClassification {
  grade: "AAA" | "AA" | "AA Large" | "Fail";
  normalTextAA: boolean;
  normalTextAAA: boolean;
  largeTextAA: boolean;
  largeTextAAA: boolean;
  uiComponentAA: boolean;
}

export interface ContrastResult extends ContrastClassification {
  /** Full-precision contrast ratio. Decisions are made from this value. */
  ratioExact: number;
  /** Display-rounded ratio (2 decimals). Never used for pass/fail decisions. */
  ratio: number;
}

/**
 * Classify a contrast ratio using the full-precision value.
 * Thresholds: normal AA 4.5, normal AAA 7, large AA 3, large AAA 4.5, UI 3.
 */
export function classifyContrastRatio(exactRatio: number): ContrastClassification {
  if (!Number.isFinite(exactRatio) || exactRatio < 1) {
    throw new RangeError(
      `Contrast ratio must be a finite number >= 1 (received ${exactRatio}).`
    );
  }
  const normalTextAA = exactRatio >= WCAG_THRESHOLDS.normalTextAA;
  const normalTextAAA = exactRatio >= WCAG_THRESHOLDS.normalTextAAA;
  const largeTextAA = exactRatio >= WCAG_THRESHOLDS.largeTextAA;
  const largeTextAAA = exactRatio >= WCAG_THRESHOLDS.largeTextAAA;
  const uiComponentAA = exactRatio >= WCAG_THRESHOLDS.uiComponent;

  const grade: ContrastClassification["grade"] = normalTextAAA
    ? "AAA"
    : normalTextAA
      ? "AA"
      : largeTextAA
        ? "AA Large"
        : "Fail";

  return { grade, normalTextAA, normalTextAAA, largeTextAA, largeTextAAA, uiComponentAA };
}

export function parseHexToRgb(hex: string): RGB {
  const clean = hex.trim().toLowerCase().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/.test(clean)) {
    return {
      r: parseInt(clean[0]! + clean[0]!, 16),
      g: parseInt(clean[1]! + clean[1]!, 16),
      b: parseInt(clean[2]! + clean[2]!, 16)
    };
  }
  if (/^[0-9a-f]{6}$/.test(clean) || /^[0-9a-f]{8}$/.test(clean)) {
    return {
      r: parseInt(clean.slice(0, 2), 16),
      g: parseInt(clean.slice(2, 4), 16),
      b: parseInt(clean.slice(4, 6), 16)
    };
  }
  // Behavior change (documented): unparseable input now throws instead of
  // silently resolving to black, which previously produced bogus ratios.
  throw new RangeError(`Invalid hex color: "${hex}" (expected #rgb or #rrggbb).`);
}

export function rgbToHex(rgb: RGB): string {
  const toHex = (c: number): string => {
    const clamped = Math.max(0, Math.min(255, Math.round(c)));
    return clamped.toString(16).padStart(2, "0");
  };
  return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`;
}

function channelToLinear(c: number): number {
  const norm = c / 255;
  return norm <= 0.04045 ? norm / 12.92 : Math.pow((norm + 0.055) / 1.055, 2.4);
}

/** WCAG 2.1 relative luminance: Y = 0.2126R + 0.7152G + 0.0722B (linear sRGB). */
export function calculateRelativeLuminance(rgb: RGB): number {
  const rLin = channelToLinear(rgb.r);
  const gLin = channelToLinear(rgb.g);
  const bLin = channelToLinear(rgb.b);
  return 0.2126 * rLin + 0.7152 * gLin + 0.0722 * bLin;
}

/**
 * Full-precision WCAG contrast ratio:
 *   ratio = (max(Yfg, Ybg) + 0.05) / (min(Yfg, Ybg) + 0.05)
 */
export function exactContrastRatio(fgHex: string, bgHex: string): number {
  const fg = parseHexToRgb(fgHex);
  const bg = parseHexToRgb(bgHex);
  return exactContrastRatioFromLuminance(
    calculateRelativeLuminance(fg),
    calculateRelativeLuminance(bg)
  );
}

export function exactContrastRatioFromLuminance(yFg: number, yBg: number): number {
  const lighter = Math.max(yFg, yBg);
  const darker = Math.min(yFg, yBg);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * WCAG contrast report for an sRGB hex pair.
 * `ratioExact` drives every boolean; `ratio` is the rounded display value.
 */
export function calculateContrastRatio(fgHex: string, bgHex: string): ContrastResult {
  const ratioExact = exactContrastRatio(fgHex, bgHex);
  return {
    ratioExact,
    ratio: Number(ratioExact.toFixed(2)),
    ...classifyContrastRatio(ratioExact)
  };
}

export interface OklchColor {
  l: number; // 0.0 - 1.0
  c: number; // 0.0 - 0.4
  h: number; // 0 - 360 degrees
  cssString: string;
}

export function createOklch(l: number, c: number, h: number): OklchColor {
  const clampedL = Math.max(0, Math.min(1, Number(l.toFixed(3))));
  const clampedC = Math.max(0, Math.min(0.4, Number(c.toFixed(3))));
  const clampedH = ((h % 360) + 360) % 360;
  return {
    l: clampedL,
    c: clampedC,
    h: Math.round(clampedH),
    cssString: `oklch(${clampedL} ${clampedC} ${Math.round(clampedH)})`
  };
}

// ---------------------------------------------------------------------------
// Rendering policy: one explicit target gamut for tokens, exports and contrast
// ---------------------------------------------------------------------------

export interface RenderingPolicy {
  /** Gamut used for token export and for computing contrast inputs. */
  target: GamutTarget;
  /**
   * Contrast is always evaluated on the exported 8-bit sRGB fallback, because
   * WCAG 2.x is defined only for sRGB code values. For wide-gamut targets the
   * sRGB fallback is produced by an independent sRGB gamut mapping.
   */
  contrastBasis: "srgb-fallback-8bit";
}

export interface ResolvedColor {
  oklch: OklchTriple;
  mapped: GamutMapResult;
  /** sRGB fallback hex (always real sRGB). */
  hex: string;
  /** Target-gamut CSS (oklch(...) for sRGB, color(display-p3 ...) for P3). */
  css: string;
  /** sRGB fallback CSS (oklch(...) of the independently mapped sRGB color). */
  srgbCss: string;
}

/** Resolve an OKLCH triple under an explicit rendering policy. */
export function resolveOklchColor(
  l: number,
  c: number,
  h: number,
  target: GamutTarget = "srgb"
): ResolvedColor {
  const mapped = mapToGamut(l, c, h, target);
  return {
    oklch: mapped.oklch,
    mapped,
    hex: mapped.hex,
    css: mapped.css,
    srgbCss: mapped.srgbCss
  };
}

/**
 * WCAG relative luminance of an OKLCH color under an explicit rendering
 * policy. Behavior change (documented): the color is gamut mapped first, so
 * the luminance always corresponds to a real, displayable sRGB color instead
 * of an unclipped conversion.
 */
export function oklchToRelativeLuminance(
  l: number,
  c: number,
  h: number,
  target: GamutTarget = "srgb"
): number {
  const mapped = mapToGamut(l, c, h, target);
  return calculateRelativeLuminance({
    r: mapped.srgb.r * 255,
    g: mapped.srgb.g * 255,
    b: mapped.srgb.b * 255
  });
}

/** Convert an sRGB hex color to OKLCH (used by style inspection). */
export function hexToOklch(hex: string): OklchTriple {
  const rgb = parseHexToRgb(hex);
  return srgb01ToOklch({ r: rgb.r / 255, g: rgb.g / 255, b: rgb.b / 255 });
}

/** Convert an sRGB 0-1 triplet to OKLCH. */
export function rgb01ToOklch(rgb: { r: number; g: number; b: number }): OklchTriple {
  return srgb01ToOklch(rgb);
}

/** Parse a CSS-ish color string (hex, rgb()/rgba(), named-basic) into sRGB 0-1. */
export function parseCssColorToRgb01(value: string): { r: number; g: number; b: number } | null {
  const text = value.trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(text) || /^#[0-9a-f]{6}$/.test(text) || /^#[0-9a-f]{8}$/.test(text)) {
    const rgb = parseHexToRgb(text);
    return { r: rgb.r / 255, g: rgb.g / 255, b: rgb.b / 255 };
  }
  const rgbMatch = text.match(
    /^rgba?\(\s*([\d.]+%?)\s*[,\s]\s*([\d.]+%?)\s*[,\s]\s*([\d.]+%?)/
  );
  if (rgbMatch) {
    const channel = (raw: string): number => {
      if (raw.endsWith("%")) return Math.min(100, parseFloat(raw)) / 100;
      return Math.min(255, parseFloat(raw)) / 255;
    };
    return { r: channel(rgbMatch[1]!), g: channel(rgbMatch[2]!), b: channel(rgbMatch[3]!) };
  }
  return null;
}

/**
 * Convert an arbitrary CSS color string into OKLCH with real color math
 * (sRGB -> linear -> OKLab -> OKLCH), gamut mapping the result.
 */
export function cssColorToOklch(
  value: string,
  target: GamutTarget = "srgb"
): { source: string; srgb: { r: number; g: number; b: number }; oklch: OklchTriple; css: string; hex: string } | null {
  const rgb = parseCssColorToRgb01(value);
  if (!rgb) return null;
  const oklch = srgb01ToOklch(rgb);
  const mapped = mapToGamut(oklch.l, oklch.c, oklch.h, target);
  return {
    source: value.trim(),
    srgb: rgb,
    oklch: mapped.oklch,
    css: oklchToCssString(mapped.oklch.l, mapped.oklch.c, mapped.oklch.h),
    hex: mapped.hex
  };
}

// ---------------------------------------------------------------------------
// Dual WCAG + APCA reports
// ---------------------------------------------------------------------------

/** Dual WCAG 2.1 + APCA 0.98G contrast report for one text/background pair. */
export interface DualContrast extends ContrastResult {
  /** Signed APCA Lc (negative = light text on dark background). */
  apcaLc: number;
  /** Full-precision signed APCA Lc. */
  apcaLcExact: number;
  /** Absolute |Lc| value. */
  apcaAbs: number;
  /** Simplified, font-size-agnostic tier ("Body" | "Large" | "Fail"). */
  apcaGuidance: string;
  /** Which APCA polarity branch produced the value. */
  apcaPolarity: ApcaResult["polarity"];
  /** Gamut target used to resolve the pair before measuring contrast. */
  target: GamutTarget;
  /** sRGB fallback hex used as the contrast basis. */
  basis: RenderingPolicy["contrastBasis"];
  /** The two resolved sRGB fallback colors the ratio was measured from. */
  resolved: { fgHex: string; bgHex: string };
}

function dualFromHex(
  fgHex: string,
  bgHex: string,
  target: GamutTarget,
  policy: RenderingPolicy
): DualContrast {
  const wcag = calculateContrastRatio(fgHex, bgHex);
  const apca = apcaForHexPair(fgHex, bgHex);
  return {
    ...wcag,
    apcaLc: apca.lc,
    apcaLcExact: apca.lcExact,
    apcaAbs: apca.abs,
    apcaGuidance: apcaGuidance(apca.abs),
    apcaPolarity: apca.polarity,
    target,
    basis: policy.contrastBasis,
    resolved: { fgHex, bgHex }
  };
}

/** Dual WCAG + APCA contrast for an sRGB hex pair (fg = text). */
export function dualContrastForHex(fgHex: string, bgHex: string): DualContrast {
  return dualFromHex(fgHex, bgHex, "srgb", { target: "srgb", contrastBasis: "srgb-fallback-8bit" });
}

/**
 * Dual WCAG + APCA contrast for an OKLCH pair (fg = text, bg = background).
 *
 * Both colors are gamut mapped into `target` and the contrast is measured on
 * their exported 8-bit sRGB fallbacks, so the reported ratio always matches
 * what a non-wide-gamut display renders.
 */
export function contrastForOklchPair(
  fg: { l: number; c: number; h: number },
  bg: { l: number; c: number; h: number },
  target: GamutTarget = "srgb"
): DualContrast {
  const policy: RenderingPolicy = { target, contrastBasis: "srgb-fallback-8bit" };
  const fgHex = mapToGamut(fg.l, fg.c, fg.h, target).hex;
  const bgHex = mapToGamut(bg.l, bg.c, bg.h, target).hex;
  return dualFromHex(fgHex, bgHex, target, policy);
}

/** Convenience: sRGB 0-1 channels of an OKLCH color in the requested gamut. */
export function oklchToRgb01(
  l: number,
  c: number,
  h: number,
  target: GamutTarget = "srgb"
): { r: number; g: number; b: number } {
  return mapToGamut(l, c, h, target).srgb;
}

/** Serialization-safe OKLCH rounding used by palette and gradient output. */
export function serializedOklch(l: number, c: number, h: number, target: GamutTarget = "srgb") {
  return roundOklchForCss(l, c, h, target);
}

/** Unclipped OKLCH -> sRGB 0-1 (kept for callers that need raw conversions). */
export function oklchToUnclippedSrgb01(l: number, c: number, h: number): { r: number; g: number; b: number } {
  return oklchToSrgb(l, c, h, "srgb");
}

export {
  apcaForHexPair,
  apcaGuidance,
  apcaGuidanceForFont,
  apcaContrastLc,
  apcaLuminance01,
  softClampBlack,
  APCA_ALGORITHM_VERSION
} from "./apca.js";
export type { ApcaResult };