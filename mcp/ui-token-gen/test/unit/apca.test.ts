import { describe, it, expect } from "vitest";
import {
  apcaForHexPair,
  apcaGuidance,
  apcaFontLookup,
  apcaGuidanceForFont,
  APCA_FONT_LOOKUP_VERSION,
  APCA_FONT_MAX_LC,
  APCA_FONT_NON_TEXT_ONLY,
  apcaContrastLc,
  apcaLuminance01,
  parseHexToRgb01,
  softClampBlack,
  APCA_ALGORITHM_VERSION,
  APCA_CONSTANTS
} from "../../src/domain/design-tokens/apca.js";
import { dualContrastForHex, contrastForOklchPair } from "../../src/domain/design-tokens/color-math.js";

/**
 * Reference vectors from the APCA-W3 0.98G reference implementation.
 * Documented numerical tolerance: 0.01 Lc (and 0.0001 for raw luminance).
 */
const TOLERANCE_LC = 0.01;

describe("APCA 0.98G reference conformance", () => {
  it("pins the implemented algorithm version and constants", () => {
    expect(APCA_ALGORITHM_VERSION).toContain("0.98G");
    expect(APCA_CONSTANTS.mainTRC).toBe(2.4);
    expect(APCA_CONSTANTS.Rco).toBe(0.2126729);
    expect(APCA_CONSTANTS.Gco).toBe(0.7151522);
    expect(APCA_CONSTANTS.Bco).toBe(0.0721750);
    expect(APCA_CONSTANTS.normBG).toBe(0.56);
    expect(APCA_CONSTANTS.normTXT).toBe(0.57);
    expect(APCA_CONSTANTS.revTXT).toBe(0.62);
    expect(APCA_CONSTANTS.revBG).toBe(0.65);
    expect(APCA_CONSTANTS.blkThrs).toBe(0.022);
    expect(APCA_CONSTANTS.blkClmp).toBe(1.414);
    expect(APCA_CONSTANTS.deltaYmin).toBe(0.0005);
    expect(APCA_CONSTANTS.loClip).toBe(0.1);
  });

  it("REGRESSION: #777777 on #ffffff is +71.1111 Lc (was 74.0 in 1.2.0)", () => {
    const { lc, lcExact, polarity } = apcaForHexPair("#777777", "#ffffff");
    expect(lcExact).toBeCloseTo(71.1111, 3);
    expect(Math.abs(lcExact - 71.1111)).toBeLessThan(TOLERANCE_LC);
    expect(lc).toBe(71.1);
    expect(polarity).toBe("normal");
  });

  it("REGRESSION: #888888 on #777777 is -7.3202 Lc (was -14.7 in 1.2.0)", () => {
    const { lc, lcExact, polarity } = apcaForHexPair("#888888", "#777777");
    expect(lcExact).toBeCloseTo(-7.3202, 3);
    expect(Math.abs(lcExact - -7.3202)).toBeLessThan(TOLERANCE_LC);
    expect(lc).toBe(-7.3);
    expect(polarity).toBe("reverse");
  });

  it("matches the reference extremes without an artificial clamp", () => {
    const whiteOnBlack = apcaForHexPair("#ffffff", "#000000");
    expect(whiteOnBlack.lcExact).toBeCloseTo(-107.8847, 3);
    expect(Math.abs(whiteOnBlack.lcExact - -107.8847)).toBeLessThan(TOLERANCE_LC);
    // No arbitrary clamp: the value must exceed the old hard limit of -108.
    expect(whiteOnBlack.lcExact).toBeLessThan(-107.8);

    const blackOnWhite = apcaForHexPair("#000000", "#ffffff");
    expect(blackOnWhite.lcExact).toBeCloseTo(106.0407, 3);
    expect(Math.abs(blackOnWhite.lcExact - 106.0407)).toBeLessThan(TOLERANCE_LC);
    expect(blackOnWhite.lcExact).toBeGreaterThan(106);
  });

  it("uses APCA luminance preprocessing, not WCAG relative luminance", () => {
    const white = apcaLuminance01({ r: 1, g: 1, b: 1 });
    expect(white).toBeCloseTo(1.0000001, 6);
    expect(white).not.toBe(1); // coefficients sum to 1.0000001, WCAG would return exactly 1
    // 0.5 sRGB -> 0.5^2.4 (APCA), whereas WCAG linearisation gives 0.2140
    expect(apcaLuminance01({ r: 0.5, g: 0.5, b: 0.5 })).toBeCloseTo(Math.pow(0.5, 2.4), 6);
    expect(apcaLuminance01({ r: 0.5, g: 0.5, b: 0.5 })).not.toBeCloseTo(0.2140, 3);
  });

  it("reports 0 Lc for identical colors (both polarities)", () => {
    for (const hex of ["#38bdf8", "#000000", "#ffffff", "#777777", "#010101"]) {
      const result = apcaForHexPair(hex, hex);
      expect(result.lc).toBe(0);
      expect(result.abs).toBe(0);
      expect(result.polarity).toBe("identical");
    }
  });

  it("reports 0 Lc for near-identical colors below the 0.0005 luminance guard", () => {
    const result = apcaForHexPair("#010101", "#020202");
    expect(result.abs).toBeLessThan(0.05);
    expect(apcaContrastLc(0.5, 0.5 + 0.0004)).toBe(0);
  });

  it("handles near-black colors through the black soft clamp", () => {
    expect(softClampBlack(0.5)).toBe(0.5);
    expect(softClampBlack(1)).toBe(1);
    expect(softClampBlack(0)).toBeGreaterThan(0);
    expect(softClampBlack(0)).toBeCloseTo(Math.pow(0.022, 1.414), 12);

    // Near-black text on near-black background: tiny contrast, not a crash.
    const nearBlack = apcaForHexPair("#050505", "#000000");
    expect(Number.isFinite(nearBlack.lcExact)).toBe(true);
    expect(Math.abs(nearBlack.abs)).toBeLessThan(20);

    // Black on white still reaches the reference extreme after soft clamping.
    expect(apcaForHexPair("#000000", "#ffffff").lcExact).toBeCloseTo(106.0407, 3);
  });

  it("keeps both polarities signed and asymmetric", () => {
    const lightOnDark = apcaForHexPair("#f1f5f9", "#0e131f");
    const darkOnLight = apcaForHexPair("#0e131f", "#f1f5f9");
    expect(lightOnDark.lc).toBeLessThan(0);
    expect(darkOnLight.lc).toBeGreaterThan(0);
    // APCA is intentionally asymmetric: the magnitudes differ.
    expect(Math.abs(lightOnDark.abs - darkOnLight.abs)).toBeGreaterThan(1);
  });

  it("applies low-contrast clipping instead of returning small non-zero values", () => {
    // SAPC below 0.1 must clip to exactly 0.
    const ys1 = apcaLuminance01({ r: 0.5, g: 0.5, b: 0.5 });
    const ys2 = apcaLuminance01({ r: 0.5, g: 0.5, b: 0.5 }) + 0.0006;
    const lc = apcaContrastLc(ys1, ys2);
    expect(lc).toBe(0);
  });

  it("rejects non-finite inputs", () => {
    expect(() => apcaLuminance01({ r: NaN, g: 0, b: 0 })).toThrow(RangeError);
    expect(() => apcaContrastLc(NaN, 0.5)).toThrow(RangeError);
    expect(() => softClampBlack(Infinity)).toThrow(RangeError);
    expect(() => parseHexToRgb01("nope")).toThrow(RangeError);
  });

  it("parses #rgb shorthand identically to #rrggbb", () => {
    expect(apcaForHexPair("#fff", "#000")).toEqual(apcaForHexPair("#ffffff", "#000000"));
    expect(parseHexToRgb01("#fff")).toEqual({ r: 1, g: 1, b: 1 });
  });

  describe("guidance", () => {
    it("keeps the simplified font-size-agnostic tiers for backward compatibility", () => {
      expect(apcaGuidance(108)).toBe("Body");
      expect(apcaGuidance(60)).toBe("Body");
      expect(apcaGuidance(59.9)).toBe("Large");
      expect(apcaGuidance(45)).toBe("Large");
      expect(apcaGuidance(44.9)).toBe("Fail");
      expect(apcaGuidance(0)).toBe("Fail");
    });

it("REGRESSION: font guidance uses the published APCA font lookup, not an approximation", () => {
      // Published table, Lc 60 / weight 400 -> 24.25px (not a rounded 16px guess).
      const at24 = apcaGuidanceForFont({ lc: 60, fontSizePx: 24, fontWeight: 400 });
      expect(at24.basis).toBe("apca-0.1.7-G-lookup");
      expect(at24.reference).toBe(APCA_FONT_LOOKUP_VERSION);
      expect(at24.reference).toContain("APCA font lookup");
      expect(at24.reference).toContain("0.1.7");
      expect(at24.minFontSizePx).toBeCloseTo(24.25, 5);
      expect(at24.passes).toBe(false);
      expect(at24.tier).toBe("Fail");

      // 24.5px clears the same lookup.
      const passes = apcaGuidanceForFont({ lc: 60, fontSizePx: 24.5, fontWeight: 400 });
      expect(passes.passes).toBe(true);
      expect(passes.minFontSizePx).toBeCloseTo(24.25, 5);
      expect(passes.note).toContain("font lookup");

      // Heavier weights accept smaller sizes at the same Lc (published table).
      const bold = apcaGuidanceForFont({ lc: 60, fontSizePx: 16, fontWeight: 700 });
      expect(bold.passes).toBe(true);
      expect(bold.minFontSizePx).toBeCloseTo(15.5, 5);
      expect(bold.minFontSizePx).toBeLessThan(at24.minFontSizePx);
      expect(bold.lookupWeight).toBe(700);

      // Higher Lc accepts smaller sizes (Lc 90 / 400 -> 16px).
      const strong = apcaGuidanceForFont({ lc: 90, fontSizePx: 16, fontWeight: 400 });
      expect(strong.passes).toBe(true);
      expect(strong.minFontSizePx).toBeCloseTo(16, 5);
      expect(strong.minFontSizePx).toBeLessThan(at24.minFontSizePx);

      expect(() => apcaGuidanceForFont({ lc: 60, fontSizePx: 0, fontWeight: 400 })).toThrow(RangeError);
      expect(() => apcaGuidanceForFont({ lc: 60, fontSizePx: 16, fontWeight: 0 })).toThrow(RangeError);
    });

    it("REGRESSION: exposes the published per-weight lookup row and its sentinels", () => {
      const row = apcaFontLookup(60);
      expect(row.lookupLc).toBe(60);
      expect(row.clampedToTable).toBe(false);
      expect(row.rowIndex).toBe(12);
      expect(row.minimumFontSizeByWeight[100]).toBe(72);
      expect(row.minimumFontSizeByWeight[400]).toBeCloseTo(24.25, 5);
      expect(row.minimumFontSizeByWeight[700]).toBeCloseTo(15.5, 5);
      // Lc 100 / 700 -> 13px, Lc 125 is the last published row.
      expect(apcaFontLookup(100).minimumFontSizeByWeight[700]).toBe(13);
      expect(APCA_FONT_MAX_LC).toBe(125);
      expect(apcaFontLookup(200).clampedToTable).toBe(true);
      expect(apcaFontLookup(200).minimumFontSizeByWeight[400]).toBe(
        apcaFontLookup(125).minimumFontSizeByWeight[400]
      );

      // 777 = non-text/spot text only: never a pass for real text.
      expect(apcaFontLookup(20).minimumFontSizeByWeight[400]).toBe(APCA_FONT_NON_TEXT_ONLY);
      const spot = apcaGuidanceForFont({ lc: 20, fontSizePx: 24, fontWeight: 400 });
      expect(spot.passes).toBe(false);
      expect(spot.minFontSizePx).toBe(APCA_FONT_NON_TEXT_ONLY);
      expect(spot.tier).toBe("Fail");

      // Weights between published columns snap to the nearest published weight.
      const snapped = apcaGuidanceForFont({ lc: 75, fontSizePx: 24, fontWeight: 655 });
      expect(snapped.lookupWeight).toBe(700);
      expect(snapped.minFontSizePx).toBeCloseTo(14, 5);
      expect(snapped.passes).toBe(true);
    });

    it("REGRESSION: body-text use applies APCA's documented +15 Lc adjustment below Lc 70", () => {
      // Same rendered pair and size: as large text 24px fails (24.25 needed),
      // as body text the +15 Lc adjustment (Lc 60 -> 75) makes it pass.
      const large = apcaGuidanceForFont({ lc: 60, fontSizePx: 24, fontWeight: 400, use: "large" });
      const asBody = apcaGuidanceForFont({ lc: 60, fontSizePx: 24, fontWeight: 400, use: "body" });
      expect(large.passes).toBe(false);
      expect(large.lookupLcRow).toBe(65);
      expect(asBody.passes).toBe(true);
      expect(asBody.lookupLcRow).toBe(80);
      expect(asBody.minFontSizePx).toBeCloseTo(18.25, 5);
      expect(asBody.minFontSizePx).toBeLessThan(large.minFontSizePx);

      // Default (no use given) is large text, matching the historical behavior.
      expect(apcaGuidanceForFont({ lc: 60, fontSizePx: 24, fontWeight: 400 }).lookupLcRow).toBe(
        large.lookupLcRow
      );

      // The adjustment is only applied below Lc 70, per APCA's own note.
      const highLc = apcaGuidanceForFont({ lc: 90, fontSizePx: 16, fontWeight: 400, use: "body" });
      const highLcLarge = apcaGuidanceForFont({ lc: 90, fontSizePx: 16, fontWeight: 400, use: "large" });
      expect(highLc.minFontSizePx).toBe(highLcLarge.minFontSizePx);
      expect(highLc.lookupLcRow).toBe(95);
    });

    it("reports clampedToTable only when |Lc| exceeds the published rows", () => {
      expect(apcaGuidanceForFont({ lc: 60, fontSizePx: 24, fontWeight: 400 }).clampedToTable).toBe(
        false
      );
      expect(apcaGuidanceForFont({ lc: 125, fontSizePx: 24, fontWeight: 400 }).clampedToTable).toBe(
        false
      );
      expect(apcaGuidanceForFont({ lc: 126, fontSizePx: 24, fontWeight: 400 }).clampedToTable).toBe(
        true
      );
    });
  });

  describe("dual WCAG + APCA reporting", () => {
    it("reports both engines for a hex pair", () => {
      const dual = dualContrastForHex("#ffffff", "#000000");
      expect(dual.ratioExact).toBeCloseTo(21, 8);
      expect(dual.apcaLcExact).toBeCloseTo(-107.8847, 3);
      expect(dual.apcaAbs).toBeGreaterThan(100);
      expect(dual.apcaPolarity).toBe("reverse");
      expect(dual.apcaGuidance).toBe("Body");
      expect(dual.basis).toBe("srgb-fallback-8bit");
    });

    it("reports both engines for an OKLCH pair on the exported sRGB fallbacks", () => {
      const dual = contrastForOklchPair(
        { l: 0.96, c: 0.01, h: 215 },
        { l: 0.11, c: 0.015, h: 215 }
      );
      expect(dual.ratioExact).toBeGreaterThan(7);
      expect(dual.apcaLc).toBeLessThan(0);
      expect(dual.apcaPolarity).toBe("reverse");
      expect(Math.abs(dual.apcaAbs)).toBeGreaterThan(90);
    });
  });
});