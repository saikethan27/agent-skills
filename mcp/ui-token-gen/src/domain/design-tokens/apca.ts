/**
 * APCA (Accessible Perceptual Contrast Algorithm) 0.98G — reference conformant
 * =============================================================================
 * Algorithm version pinned: APCA-W3 0.98G (W3C-candidate revision "0.1.9-4g"
 * constant set), matching https://github.com/Myndex/apca-w3 `apca-w3.js`.
 *
 * This implementation follows the complete reference equations:
 *
 *  1. APCA-specific luminance preprocessing (NOT the WCAG relative luminance):
 *        Ys = 0.2126729 * R^2.4 + 0.7151522 * G^2.4 + 0.0721750 * B^2.4
 *     (pure 2.4 power curve on gamma-encoded channels; no 0.04045 branch and
 *     no piecewise 12.92 segment)
 *  2. Black soft clamp below the crush point:
 *        Y < 0.022  ->  Y + (0.022 - Y)^1.414
 *  3. Minimum luminance difference: |Ybg - Ytxt| < 0.0005 -> Lc = 0
 *  4. Polarity-dependent exponents and scale, plus low-contrast clipping and
 *     signed offsets:
 *        dark text on light background (BoW, Lc positive):
 *          SAPC = (Ybg^0.56 - Ytxt^0.57) * 1.14
 *          Lc = SAPC < 0.1 ? 0 : (SAPC - 0.027) * 100
 *        light text on dark background (WoB, Lc negative):
 *          SAPC = (Ybg^0.65 - Ytxt^0.62) * 1.14
 *          Lc = SAPC > -0.1 ? 0 : (SAPC + 0.027) * 100
 *
 * There is deliberately NO arbitrary output clamp: Lc is returned at full
 * precision (rounded only for display at 1 decimal) so calculation errors
 * cannot be hidden. The natural extremes are about +106.04 (black on white)
 * and -107.88 (white on black).
 *
 * Sign convention: positive Lc = dark text on a light background (normal
 * polarity); negative Lc = light text on a dark background (reverse polarity).
 *
 * Reference vectors used by the regression suite (documented tolerance 0.01 Lc):
 *   #777777 on #ffffff  ->  +71.1111 Lc
 *   #888888 on #777777  ->   -7.3202 Lc
 *   #ffffff on #000000  -> -107.8847 Lc
 *   #000000 on #ffffff  -> +106.0407 Lc
 */

export interface Rgb01 {
  r: number; // 0.0 - 1.0
  g: number;
  b: number;
}

export interface ApcaResult {
  /** Signed lightness contrast (rounded to 1 decimal for display). */
  lc: number;
  /** Full-precision signed lightness contrast (not rounded). */
  lcExact: number;
  /** Absolute value |Lc|, rounded to 1 decimal. */
  abs: number;
  /** Which branch produced the result. */
  polarity: "normal" | "reverse" | "identical";
  /** APCA-specific luminance (Ys) of the text and background colors. */
  ys: { text: number; background: number };
}

/** APCA 0.98G pinned constants (do not change without a version bump). */
export const APCA_ALGORITHM_VERSION = "APCA-W3 0.98G (0.1.9-4g constants)";

export const APCA_CONSTANTS = {
  mainTRC: 2.4,
  Rco: 0.2126729,
  Gco: 0.7151522,
  Bco: 0.0721750,
  normBG: 0.56,
  normTXT: 0.57,
  revTXT: 0.62,
  revBG: 0.65,
  blkThrs: 0.022,
  blkClmp: 1.414,
  scaleBoW: 1.14,
  scaleWoB: 1.14,
  loBoWoffset: 0.027,
  loWoBoffset: 0.027,
  loClip: 0.1,
  deltaYmin: 0.0005
} as const;

/** Black soft clamp around the crush point Y = 0.022. */
export function softClampBlack(y: number): number {
  if (!Number.isFinite(y)) {
    throw new RangeError(`APCA luminance must be finite (received ${y}).`);
  }
  return y > APCA_CONSTANTS.blkThrs
    ? y
    : y + Math.pow(APCA_CONSTANTS.blkThrs - y, APCA_CONSTANTS.blkClmp);
}

/**
 * APCA 0.98G luminance (Ys). Note: this is intentionally NOT the WCAG
 * relative luminance; substituting WCAG luminance changes results by up to
 * several Lc units and is a documented defect class.
 */
export function apcaLuminance01(rgb: Rgb01): number {
  return (
    APCA_CONSTANTS.Rco * Math.pow(clampChannel(rgb.r), APCA_CONSTANTS.mainTRC) +
    APCA_CONSTANTS.Gco * Math.pow(clampChannel(rgb.g), APCA_CONSTANTS.mainTRC) +
    APCA_CONSTANTS.Bco * Math.pow(clampChannel(rgb.b), APCA_CONSTANTS.mainTRC)
  );
}

function clampChannel(v: number): number {
  if (!Number.isFinite(v)) {
    throw new RangeError(`APCA channel must be finite (received ${v}).`);
  }
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Parse #rgb / #rrggbb into sRGB 0-1 channels. Throws on invalid input. */
export function parseHexToRgb01(hex: string): Rgb01 {
  const clean = hex.trim().toLowerCase().replace(/^#/, "");
  const scale = (n: number): number => n / 255;
  if (/^[0-9a-f]{3}$/.test(clean)) {
    return {
      r: scale(parseInt(clean[0]! + clean[0]!, 16)),
      g: scale(parseInt(clean[1]! + clean[1]!, 16)),
      b: scale(parseInt(clean[2]! + clean[2]!, 16))
    };
  }
  if (/^[0-9a-f]{6}$/.test(clean)) {
    return {
      r: scale(parseInt(clean.slice(0, 2), 16)),
      g: scale(parseInt(clean.slice(2, 4), 16)),
      b: scale(parseInt(clean.slice(4, 6), 16))
    };
  }
  throw new RangeError(`Invalid hex color: "${hex}" (expected #rgb or #rrggbb)`);
}

/**
 * APCA 0.98G lightness contrast from APCA luminances.
 *
 * @param textYs APCA luminance (Ys) of the text color
 * @param bgYs   APCA luminance (Ys) of the background color
 * @returns full-precision signed Lc (no output clamp)
 */
export function apcaContrastLc(textYs: number, bgYs: number): number {
  if (!Number.isFinite(textYs) || !Number.isFinite(bgYs)) {
    throw new RangeError(
      `APCA luminances must be finite (text=${textYs}, background=${bgYs}).`
    );
  }
  // Reference input clamp: the APCA implementation returns 0 for luminances
  // outside [0.0, 1.1] instead of producing a misleading value.
  if (Math.min(textYs, bgYs) < 0 || Math.max(textYs, bgYs) > 1.1) {
    return 0;
  }

  const txtY = softClampBlack(textYs);
  const bgY = softClampBlack(bgYs);

  // Reference guard: below the minimum luminance difference APCA reports 0.
  if (Math.abs(bgY - txtY) < APCA_CONSTANTS.deltaYmin) {
    return 0;
  }

  if (bgY > txtY) {
    // Normal polarity: dark text on a light background.
    const sapc =
      (Math.pow(bgY, APCA_CONSTANTS.normBG) - Math.pow(txtY, APCA_CONSTANTS.normTXT)) *
      APCA_CONSTANTS.scaleBoW;
    return sapc < APCA_CONSTANTS.loClip ? 0 : (sapc - APCA_CONSTANTS.loBoWoffset) * 100;
  }

  // Reverse polarity: light text on a dark background.
  const sapc =
    (Math.pow(bgY, APCA_CONSTANTS.revBG) - Math.pow(txtY, APCA_CONSTANTS.revTXT)) *
    APCA_CONSTANTS.scaleWoB;
  return sapc > -APCA_CONSTANTS.loClip ? 0 : (sapc + APCA_CONSTANTS.loWoBoffset) * 100;
}

/** APCA 0.98G contrast for an sRGB hex pair (fg = text, bg = background). */
export function apcaForHexPair(fgHex: string, bgHex: string): ApcaResult {
  const fg = parseHexToRgb01(fgHex);
  const bg = parseHexToRgb01(bgHex);
  const ysText = apcaLuminance01(fg);
  const ysBg = apcaLuminance01(bg);
  const lcExact = apcaContrastLc(ysText, ysBg);
  const rounded = Math.round(lcExact * 10) / 10;
  const txtY = softClampBlack(ysText);
  const bgY = softClampBlack(ysBg);
  return {
    lc: rounded,
    lcExact,
    abs: Math.round(Math.abs(rounded) * 10) / 10,
    polarity:
      Math.abs(bgY - txtY) < APCA_CONSTANTS.deltaYmin
        ? "identical"
        : bgY > txtY
          ? "normal"
          : "reverse",
    ys: { text: ysText, background: ysBg }
  };
}

// ---------------------------------------------------------------------------
// Guidance
// ---------------------------------------------------------------------------

/**
 * Font-size / weight lookup for APCA 0.98G.
 *
 * Implements the published APCA font lookup table and interpolation exactly as
 * shipped in the reference implementation's `fontLookupAPCA()` (APCA Public
 * Beta 0.1.7 (G), 28 May 2022):
 *  - `fontMatrixAscend[index][w]` is the minimum font size in px for the Lc row
 *    (`index`) and weight column (100..900), or a sentinel code:
 *      999 = prohibited (do not use for anything)
 *      777 = non-text / spot text only
 *  - Values between `index` rows are linearly interpolated with
 *    `fontDeltaAscend`, exactly as the reference does (0.5px steps).
 *
 * Reference notes carried through verbatim:
 *  - the reference font for the table is Barlow;
 *  - "Lc values under 70 should have Lc 15 ADDED if used for body text";
 *  - table codes 4xx / 5xx mark a weight-specific minimum for "any purpose"
 *    (4xx) and "content" (5xx); the reference returns them unchanged, and this
 *    implementation does the same so values can be compared 1:1.
 */
export const APCA_FONT_LOOKUP_VERSION = "APCA font lookup, Public Beta 0.1.7 (G) 2022-05-28";

/** Sentinel: contrast too low for any use. */
export const APCA_FONT_PROHIBITED = 999;
/** Sentinel: non-text / spot text only. */
export const APCA_FONT_NON_TEXT_ONLY = 777;

const FONT_MATRIX_ASCEND: number[][] = [
  [0, 999, 999, 999, 999, 999, 999, 999, 999, 999],
  [10, 999, 999, 999, 999, 999, 999, 999, 999, 999],
  [15, 777, 777, 777, 777, 777, 777, 777, 777, 777],
  [20, 777, 777, 777, 777, 777, 777, 777, 777, 777],
  [25, 777, 777, 777, 120, 120, 108, 96, 96, 96],
  [30, 777, 777, 120, 108, 108, 96, 72, 72, 72],
  [35, 777, 120, 108, 96, 72, 60, 48, 48, 48],
  [40, 120, 108, 96, 60, 48, 42, 32, 32, 32],
  [45, 108, 96, 72, 42, 32, 28, 24, 24, 24],
  [50, 96, 72, 60, 32, 28, 24, 21, 21, 21],
  [55, 80, 60, 48, 28, 24, 21, 18, 18, 18],
  [60, 72, 48, 42, 24, 21, 18, 16, 16, 18],
  [65, 68, 46, 32, 21.75, 19, 17, 15, 16, 18],
  [70, 64, 44, 28, 19.5, 18, 16, 14.5, 16, 18],
  [75, 60, 42, 24, 18, 16, 15, 14, 16, 18],
  [80, 56, 38.25, 23, 17.25, 15.81, 14.81, 14, 16, 18],
  [85, 52, 34.5, 22, 16.5, 15.625, 14.625, 14, 16, 18],
  [90, 48, 32, 21, 16, 15.5, 14.5, 14, 16, 18],
  [95, 45, 28, 19.5, 15.5, 15, 14, 13.5, 16, 18],
  [100, 42, 26.5, 18.5, 15, 14.5, 13.5, 13, 16, 18],
  [105, 39, 25, 18, 14.5, 14, 13, 12, 16, 18],
  [110, 36, 24, 18, 14, 13, 12, 11, 16, 18],
  [115, 34.5, 22.5, 17.25, 12.5, 11.875, 11.25, 10.625, 14.5, 16.5],
  [120, 33, 21, 16.5, 11, 10.75, 10.5, 10.25, 13, 15],
  [125, 32, 20, 16, 10, 10, 10, 10, 12, 14]
];

const FONT_DELTA_ASCEND: number[][] = [
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [10, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [15, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [20, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [25, 0, 0, 0, 12, 12, 12, 24, 24, 24],
  [30, 0, 0, 12, 12, 36, 36, 24, 24, 24],
  [35, 0, 12, 12, 36, 24, 18, 16, 16, 16],
  [40, 12, 12, 24, 18, 16, 14, 8, 8, 8],
  [45, 12, 24, 12, 10, 4, 4, 3, 3, 3],
  [50, 16, 12, 12, 4, 4, 3, 3, 3, 3],
  [55, 8, 12, 6, 4, 3, 3, 2, 2, 0],
  [60, 4, 2, 10, 2.25, 2, 1, 1, 0, 0],
  [65, 4, 2, 4, 2.25, 1, 1, 0.5, 0, 0],
  [70, 4, 2, 4, 1.5, 2, 1, 0.5, 0, 0],
  [75, 4, 3.75, 1, 0.75, 0.188, 0.188, 0, 0, 0],
  [80, 4, 3.75, 1, 0.75, 0.188, 0.188, 0, 0, 0],
  [85, 4, 2.5, 1, 0.5, 0.125, 0.125, 0, 0, 0],
  [90, 3, 4, 1.5, 0.5, 0.5, 0.5, 0.5, 0, 0],
  [95, 3, 1.5, 1, 0.5, 0.5, 0.5, 0.5, 0, 0],
  [100, 3, 1.5, 0.5, 0.5, 0.5, 0.5, 1, 0, 0],
  [105, 3, 1, 0, 0.5, 1, 1, 1, 0, 0],
  [110, 1.5, 1.5, 0.75, 1.5, 1.125, 0.75, 0.375, 1.5, 1.5],
  [115, 1.5, 1.5, 0.75, 1.5, 1.125, 0.75, 0.375, 1.5, 1.5],
  [120, 1, 1, 0.5, 1, 0.75, 0.5, 0.25, 1, 1],
  [125, 0, 0, 0, 0, 0, 0, 0, 0, 0]
];

/** Weight columns of the lookup table. */
export const APCA_FONT_WEIGHTS: readonly number[] = [100, 200, 300, 400, 500, 600, 700, 800, 900];

/** Lc row labels of the lookup table (index-aligned with the matrices). */
export const APCA_FONT_LC_ROWS: readonly number[] = FONT_MATRIX_ASCEND.map((row) => row[0]!);

/** Highest Lc covered by the published table. */
export const APCA_FONT_MAX_LC = APCA_FONT_LC_ROWS[APCA_FONT_LC_ROWS.length - 1]!;

export interface ApcaFontLookupResult {
  /** Lc value used for the lookup (after polarity removal and clamping). */
  lookupLc: number;
  /** True when |Lc| exceeded the published table and the last row was used. */
  clampedToTable: boolean;
  /** Table row index used. */
  rowIndex: number;
  /** Reference values per weight column, verbatim from the table. */
  minimumFontSizeByWeight: Record<number, number>;
}

/**
 * Reference implementation of `fontLookupAPCA(contrast)`: the minimum font size
 * in px for each weight column, using the published table and its
 * interpolation rule. Values of 999/777 are sentinel codes, not pixel sizes.
 */
export function apcaFontLookup(contrastLc: number): ApcaFontLookupResult {
  if (!Number.isFinite(contrastLc)) {
    throw new RangeError(`APCA Lc must be finite (received ${contrastLc}).`);
  }
  const abs = Math.abs(contrastLc);
  const factor = 0.2;
  const maxIndex = FONT_MATRIX_ASCEND.length - 1;
  const clampedToTable = abs > APCA_FONT_MAX_LC;
  const index = abs === 0 ? 1 : Math.min(maxIndex, Math.floor(abs * factor));

  const row = FONT_MATRIX_ASCEND[index]!;
  const delta = FONT_DELTA_ASCEND[index]!;
  // scoreAdj interpolates the needed font size between table rows.
  const scoreAdj = (abs - row[0]!) * factor;

  const minimumFontSizeByWeight: Record<number, number> = {};
  for (let w = 1; w < row.length; w += 1) {
    const weight = APCA_FONT_WEIGHTS[w - 1]!;
    const tempFont = row[w]!;
    if (tempFont > 400) {
      // Declares a specific minimum (or sentinel) for this weight column.
      minimumFontSizeByWeight[weight] = tempFont;
    } else if (abs < 14.5) {
      minimumFontSizeByWeight[weight] = APCA_FONT_PROHIBITED;
    } else if (abs < 29.5) {
      minimumFontSizeByWeight[weight] = APCA_FONT_NON_TEXT_ONLY;
    } else {
      minimumFontSizeByWeight[weight] =
        tempFont > 24
          ? Math.round(tempFont - delta[w]! * scoreAdj)
          : tempFont - Math.floor(2.0 * delta[w]! * scoreAdj) * 0.5;
    }
  }

  return { lookupLc: abs, clampedToTable, rowIndex: index, minimumFontSizeByWeight };
}

// ---------------------------------------------------------------------------
// Guidance
// ---------------------------------------------------------------------------

export type ApcaTier = "Body" | "Large" | "Fail";

/**
 * Simplified, font-size-agnostic APCA tier.
 *
 * IMPORTANT: these are the widely published simplified reading levels
 * (|Lc| >= 60 body, >= 45 large). The font-size-agnostic tiers are NOT the
 * APCA lookup; callers that know the font size and weight must use
 * `apcaGuidanceForFont`, which evaluates the published reference table
 * (`apcaFontLookup`). This function is retained for backward compatibility and
 * is always labelled as simplified guidance.
 */
export function apcaGuidance(absLc: number): ApcaTier {
  if (absLc >= 60) return "Body";
  if (absLc >= 45) return "Large";
  return "Fail";
}

export type ApcaFontGuidanceTier = ApcaTier;

export interface ApcaFontInput {
  /** Signed Lc value (or |Lc| via absoluteLc). */
  lc?: number;
  /** Absolute |Lc|; used when `lc` is not supplied. */
  absoluteLc?: number;
  /** Rendered font size in CSS px. */
  fontSizePx: number;
  /** Font weight (100-900). */
  fontWeight: number;
  /** Text use case; Lc below 70 should be raised by 15 for body text (APCA note). */
  use?: "body" | "large" | "non-text";
}

export interface ApcaFontGuidance {
  /** Minimum font size in px for this weight, or a sentinel code (999/777). */
  minFontSizePx: number;
  /** Whether the supplied font size clears the published lookup for this weight. */
  passes: boolean;
  tier: ApcaFontGuidanceTier;
  /** Table row (Lc level) used by the lookup. */
  lookupLcRow: number;
  /** Weight column used by the lookup (snapped to the nearest published weight). */
  lookupWeight: number;
  /** True when |Lc| exceeded the published table range (last row used). */
  clampedToTable: boolean;
  /** Reference implementation and table version used. */
  basis: "apca-0.1.7-G-lookup";
  reference: string;
  note: string;
}

const LOOKUP_NOTE =
  "Values come from the published APCA font lookup table (Public Beta 0.1.7 (G), reference font Barlow); 999 = prohibited, 777 = non-text/spot text only. APCA's own note: Lc values under 70 should have 15 added when used for body text.";

/**
 * Font-size/weight-aware APCA guidance backed by the published lookup table.
 *
 * Replaces the previous documented approximation: the table and its
 * interpolation rule are the reference ones, so results can be compared 1:1
 * with `fontLookupAPCA()` from apca-w3.
 */
export function apcaGuidanceForFont(input: ApcaFontInput): ApcaFontGuidance {
  const absLc = Math.abs(input.absoluteLc ?? input.lc ?? 0);
  if (!Number.isFinite(absLc) || !Number.isFinite(input.fontSizePx) || !Number.isFinite(input.fontWeight)) {
    throw new RangeError("apcaGuidanceForFont requires finite Lc, fontSizePx and fontWeight.");
  }
  if (input.fontSizePx <= 0) {
    throw new RangeError(`fontSizePx must be > 0 (received ${input.fontSizePx}).`);
  }
  if (input.fontWeight <= 0) {
    throw new RangeError(`fontWeight must be > 0 (received ${input.fontWeight}).`);
  }

  // APCA's documented body-text adjustment.
  const effectiveLc =
    input.use === "body" && absLc < 70 ? absLc + 15 : absLc;

  const lookup = apcaFontLookup(effectiveLc);
  const lookupWeight =
    APCA_FONT_WEIGHTS.reduce((best, weight) =>
      Math.abs(weight - input.fontWeight) < Math.abs(best - input.fontWeight) ? weight : best
    ) ?? 400;
  const minFontSizePx = lookup.minimumFontSizeByWeight[lookupWeight] ?? APCA_FONT_PROHIBITED;

  let passes = false;
  let tier: ApcaFontGuidanceTier = "Fail";
  if (minFontSizePx >= APCA_FONT_NON_TEXT_ONLY) {
    // 999 (prohibited) or 777 (non-text only) sentinels never pass for text.
    passes = false;
    tier = "Fail";
  } else {
    passes = input.fontSizePx + 1e-9 >= minFontSizePx;
    tier = passes ? (absLc >= 60 ? "Body" : "Large") : "Fail";
  }

  return {
    minFontSizePx,
    passes,
    tier,
    lookupLcRow: APCA_FONT_LC_ROWS[lookup.rowIndex]!,
    lookupWeight,
    clampedToTable: lookup.clampedToTable,
    basis: "apca-0.1.7-G-lookup",
    reference: APCA_FONT_LOOKUP_VERSION,
    note: LOOKUP_NOTE
  };
}