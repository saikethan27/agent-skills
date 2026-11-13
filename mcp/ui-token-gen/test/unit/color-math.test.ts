import { describe, it, expect } from "vitest";
import {
  exactContrastRatioFromLuminance,
  parseHexToRgb,
  calculateContrastRatio,
  exactContrastRatio,
  calculateRelativeLuminance,
  classifyContrastRatio,
  createOklch,
  contrastForOklchPair,
  hexToOklch,
  cssColorToOklch,
  WCAG_THRESHOLDS
} from "../../src/domain/design-tokens/color-math.js";
import { mapToGamut } from "../../src/domain/design-tokens/gamut-mapper.js";

describe("WCAG relative luminance and contrast", () => {
  it("parses 3-digit, 6-digit and 8-digit hex colors", () => {
    expect(parseHexToRgb("#fff")).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseHexToRgb("#000000")).toEqual({ r: 0, g: 0, b: 0 });
    const custom = parseHexToRgb("#38bdf8");
    expect(custom).toEqual({ r: 56, g: 189, b: 248 });
    expect(parseHexToRgb("#ffffff80")).toEqual({ r: 255, g: 255, b: 255 });
  });

  it("rejects unparseable hex instead of silently returning black", () => {
    expect(() => parseHexToRgb("not-a-color")).toThrow(RangeError);
    expect(() => parseHexToRgb("#12")).toThrow(RangeError);
  });

  it("uses the WCAG relative luminance formula with the 0.04045 threshold", () => {
    expect(calculateRelativeLuminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1, 6);
    expect(calculateRelativeLuminance({ r: 0, g: 0, b: 0 })).toBe(0);
    // #808080 is the canonical mid-grey: linear 0.2158 -> luminance ~0.2158
    expect(calculateRelativeLuminance({ r: 128, g: 128, b: 128 })).toBeCloseTo(0.2158, 3);
    // Below the threshold the linear segment applies (0.04045/12.92)
    const low = calculateRelativeLuminance({ r: 10, g: 10, b: 10 });
    expect(low).toBeCloseTo((10 / 255) / 12.92, 9);
  });

  it("computes the exact 21:1 ratio for black on white", () => {
    const result = calculateContrastRatio("#ffffff", "#000000");
    expect(result.ratioExact).toBeCloseTo(21, 10);
    expect(result.ratio).toBe(21);
    expect(result.grade).toBe("AAA");
    expect(result.normalTextAAA).toBe(true);
    expect(result.uiComponentAA).toBe(true);
  });

  it("REGRESSION: #148700 on #000000 has ratio 4.4953336599 and FAILS normal-text AA", () => {
    const result = calculateContrastRatio("#148700", "#000000");
    expect(result.ratioExact).toBeCloseTo(4.4953336599, 8);
    // Display value is rounded to 2 decimals and still shows 4.50 ...
    expect(result.ratio).toBe(4.5);
    // ... but the decision is taken on the exact ratio.
    expect(result.normalTextAA).toBe(false);
    expect(result.normalTextAAA).toBe(false);
    expect(result.largeTextAA).toBe(true);
    expect(result.largeTextAAA).toBe(false);
    expect(result.uiComponentAA).toBe(true);
    expect(result.grade).toBe("AA Large");
  });

  it("keeps the normative WCAG thresholds", () => {
    expect(WCAG_THRESHOLDS).toEqual({
      normalTextAA: 4.5,
      normalTextAAA: 7,
      largeTextAA: 3,
      largeTextAAA: 4.5,
      uiComponent: 3
    });
  });

  it("classifies from the exact ratio at every threshold boundary", () => {
    const justBelow = classifyContrastRatio(4.4999999);
    expect(justBelow.normalTextAA).toBe(false);
    expect(justBelow.largeTextAA).toBe(true);

    const exact4_5 = classifyContrastRatio(4.5);
    expect(exact4_5.normalTextAA).toBe(true);
    expect(exact4_5.largeTextAAA).toBe(true);
    expect(exact4_5.normalTextAAA).toBe(false);

    const exact7 = classifyContrastRatio(7);
    expect(exact7.normalTextAAA).toBe(true);
    expect(exact7.grade).toBe("AAA");

    expect(classifyContrastRatio(3).largeTextAA).toBe(true);
    expect(classifyContrastRatio(2.999).largeTextAA).toBe(false);
    expect(classifyContrastRatio(1).grade).toBe("Fail");
    expect(() => classifyContrastRatio(0.5)).toThrow(RangeError);
    expect(() => classifyContrastRatio(NaN)).toThrow(RangeError);
  });

  it("exposes exactContrastRatio and rejects invalid luminance inputs downstream", () => {
    expect(exactContrastRatioFromLuminance(0, 0)).toBe(1);
    expect(exactContrastRatioFromLuminance(1, 0)).toBeCloseTo(21, 10);
  });

  it("flags failing contrast for low-contrast grey combinations", () => {
    const result = calculateContrastRatio("#777777", "#888888");
    expect(result.ratioExact).toBeLessThan(3);
    expect(result.grade).toBe("Fail");
    expect(result.normalTextAA).toBe(false);
    expect(result.uiComponentAA).toBe(false);
  });
});

describe("OKLCH tokens and rendering policy", () => {
  it("creates valid OKLCH representations with clamped values", () => {
    const oklch = createOklch(0.85, 0.18, 220);
    expect(oklch.l).toBe(0.85);
    expect(oklch.c).toBe(0.18);
    expect(oklch.h).toBe(220);
    expect(oklch.cssString).toBe("oklch(0.85 0.18 220)");
    expect(createOklch(1.5, 0.9, 400).l).toBe(1);
    expect(createOklch(1.5, 0.9, 400).c).toBe(0.4);
    expect(createOklch(0.5, 0.1, 400).h).toBe(40);
  });

  it("converts hex to OKLCH with real color math (round trip within 8-bit tolerance)", () => {
    const oklch = hexToOklch("#38bdf8");
    expect(oklch.l).toBeCloseTo(0.7535, 3);
    expect(oklch.c).toBeCloseTo(0.1390, 3);
    expect(oklch.h).toBeCloseTo(232.66, 1);
    const back = mapToGamut(oklch.l, oklch.c, oklch.h, "srgb");
    expect(back.hex).toBe("#38bdf8");
  });

  it("converts CSS color strings and reports unsupported syntax as null", () => {
    const converted = cssColorToOklch("rgb(56 189 248)");
    expect(converted).not.toBeNull();
    expect(converted!.hex).toBe("#38bdf8");
    expect(cssColorToOklch("hsl(210 50% 40%)")).toBeNull();
    expect(cssColorToOklch("rebeccapurple")).toBeNull();
  });

  it("computes OKLCH pair contrast from the EXPORTED sRGB fallbacks", () => {
    const fg = { l: 0.96, c: 0.01, h: 215 };
    const bg = { l: 0.11, c: 0.015, h: 215 };
    const dual = contrastForOklchPair(fg, bg);

    const exportedFg = mapToGamut(fg.l, fg.c, fg.h, "srgb");
    const exportedBg = mapToGamut(bg.l, bg.c, bg.h, "srgb");
    expect(dual.resolved.fgHex).toBe(exportedFg.hex);
    expect(dual.resolved.bgHex).toBe(exportedBg.hex);
    expect(dual.basis).toBe("srgb-fallback-8bit");
    expect(dual.target).toBe("srgb");

    // The reported ratio must equal the ratio recomputed from those exports.
    const recomputed = calculateContrastRatio(exportedFg.hex, exportedBg.hex);
    expect(dual.ratioExact).toBeCloseTo(recomputed.ratioExact, 12);
    expect(dual.ratio).toBe(recomputed.ratio);
    expect(dual.normalTextAAA).toBe(true);
  });

  it("uses a wide-gamut target consistently: contrast is still measured on sRGB fallbacks", () => {
    const fg = { l: 0.69, c: 0.26, h: 142 };
    const bg = { l: 0.15, c: 0.02, h: 142 };
    const srgbDual = contrastForOklchPair(fg, bg, "srgb");
    const p3Dual = contrastForOklchPair(fg, bg, "p3");

    expect(p3Dual.target).toBe("p3");
    // P3 export is wider, so its sRGB fallback is measured instead - but the
    // measured colors must always be real sRGB values.
    expect(p3Dual.resolved.fgHex).toMatch(/^#[0-9a-f]{6}$/);
    const p3Channels = mapToGamut(fg.l, fg.c, fg.h, "p3").channels;
    expect(p3Dual.resolved.fgHex).not.toBe(
      `#${[p3Channels.r, p3Channels.g, p3Channels.b]
        .map((c) => Math.round(c * 255).toString(16).padStart(2, "0"))
        .join("")}`
    );
    expect(srgbDual.ratioExact).toBeGreaterThan(1);
    expect(p3Dual.ratioExact).toBeGreaterThan(1);
  });
});