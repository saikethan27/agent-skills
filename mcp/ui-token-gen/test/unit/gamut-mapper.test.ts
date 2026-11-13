import { describe, it, expect } from "vitest";
import {
  GAMUT_CHANNEL_EPSILON,
  GAMUT_CHROMA_EPSILON,
  GAMUT_JND,
  GAMUT_MINDE,
  SERIALIZED_CHANNEL_EPSILON,
  channelsInGamut,
  deltaEOk,
  isInGamut,
  mapToGamut,
  oklchToSrgb,
  oklchToHex,
  roundOklchForCss,
  srgb01ToOklch,
  oklchToOklab,
  linearP3ToLinearSrgb,
  linearSrgbToOklab,
  srgb01ToOklab
} from "../../src/domain/design-tokens/gamut-mapper.js";

/**
 * Independent target-aware reference of the CSS Color 4 local-MINDE
 * pseudocode, used to pin the mapper's channel handling. Conversion matrices
 * are shared, but the RGB -> OKLab step is written out explicitly per target so
 * a regression that treats P3 channels as sRGB cannot hide.
 */
const decode = (v: number): number =>
  v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
const clipChannels = (v: { r: number; g: number; b: number }) => ({
  r: Math.min(1, Math.max(0, v.r)),
  g: Math.min(1, Math.max(0, v.g)),
  b: Math.min(1, Math.max(0, v.b))
});
const channelsToTargetOklab = (
  v: { r: number; g: number; b: number },
  target: "srgb" | "p3"
): { L: number; a: number; b: number } =>
  target === "srgb"
    ? srgb01ToOklab(v)
    : linearSrgbToOklab(
        linearP3ToLinearSrgb({ r: decode(v.r), g: decode(v.g), b: decode(v.b) })
      );

function referenceMapToGamut(l: number, c: number, h: number, target: "srgb" | "p3") {
  const origin = oklchToSrgb(l, c, h, target);
  if (channelsInGamut(origin)) return origin;
  const originLab = oklchToOklab(l, c, h);
  let clipped = clipChannels(origin);
  if (deltaEOk(channelsToTargetOklab(clipped, target), originLab) < GAMUT_JND) return clipped;
  let min = 0;
  let max = c;
  let minInGamut = true;
  while (max - min > GAMUT_CHROMA_EPSILON) {
    const chroma = (min + max) / 2;
    const raw = oklchToSrgb(l, chroma, h, target);
    if (minInGamut && channelsInGamut(raw)) {
      min = chroma;
      continue;
    }
    clipped = clipChannels(raw);
    const error = deltaEOk(channelsToTargetOklab(clipped, target), oklchToOklab(l, chroma, h));
    if (error < GAMUT_JND) {
      if (GAMUT_JND - error < GAMUT_CHROMA_EPSILON) return clipped;
      minInGamut = false;
      min = chroma;
    } else {
      max = chroma;
    }
  }
  return clipped;
}

/**
 * Documented tolerances of the implementation (see gamut-mapper.ts header).
 * These assertions pin the policy so it cannot drift silently.
 */
const HEX = /^#[0-9a-f]{6}$/;

describe("Gamut mapper: documented policy", () => {
  it("pins the documented JND, MINDE, epsilon and channel tolerances", () => {
    expect(GAMUT_JND).toBe(0.02);
    expect(GAMUT_MINDE).toBe(0.01);
    expect(GAMUT_CHROMA_EPSILON).toBe(0.0001);
    expect(GAMUT_CHANNEL_EPSILON).toBeLessThan(1e-6);
    expect(SERIALIZED_CHANNEL_EPSILON).toBeCloseTo(1 / 510, 10);
  });

  it("rejects non-finite input and unknown gamut targets", () => {
    expect(() => mapToGamut(NaN, 0.1, 200)).toThrow(RangeError);
    expect(() => mapToGamut(0.5, Infinity, 200)).toThrow(RangeError);
    expect(() => mapToGamut(0.5, 0.1, NaN)).toThrow(RangeError);
    expect(() => mapToGamut(0.5, 0.1, 200, "rec2020" as never)).toThrow(RangeError);
  });
});

describe("Gamut mapper: conversions", () => {
  it("round-trips sRGB -> OKLCH -> sRGB within one 8-bit step", () => {
    for (const hex of ["#38bdf8", "#0b0f19", "#ffffff", "#000000", "#ff0000", "#00ff00"]) {
      const rgb = {
        r: parseInt(hex.slice(1, 3), 16) / 255,
        g: parseInt(hex.slice(3, 5), 16) / 255,
        b: parseInt(hex.slice(5, 7), 16) / 255
      };
      const oklch = srgb01ToOklch(rgb);
      const back = mapToGamut(oklch.l, oklch.c, oklch.h, "srgb");
      expect(back.hex).toBe(hex);
    }
  });

  it("round-trips OKLab -> linear sRGB for pure white and black", () => {
    const white = oklchToSrgb(1, 0, 0, "srgb");
    const black = oklchToSrgb(0, 0, 0, "srgb");
    expect(white.r).toBeCloseTo(1, 12);
    expect(white.g).toBeCloseTo(1, 12);
    expect(white.b).toBeCloseTo(1, 12);
    expect(black.r).toBe(0);
    expect(black.g).toBe(0);
    expect(black.b).toBe(0);
    expect(srgb01ToOklab({ r: 1, g: 1, b: 1 }).L).toBeCloseTo(1, 6);
    // OKLab L 0.5 is perceptual: it lands near 0.39 sRGB (~#636363).
    const mid = oklchToSrgb(0.5, 0, 0, "srgb");
    expect(mid.r).toBeCloseTo(mid.b, 12);
    expect(mid.r).toBeCloseTo(0.392, 2);
    expect(srgb01ToOklab({ r: 0.392, g: 0.392, b: 0.392 }).L).toBeCloseTo(0.5, 2);
  });

  it("detects out-of-gamut colors instead of clamping them silently", () => {
    const unclipped = oklchToSrgb(0.7, 0.25, 30, "srgb");
    expect(unclipped.r).toBeGreaterThan(1);
    expect(channelsInGamut(unclipped)).toBe(false);
    expect(isInGamut(0.7, 0.25, 30, "srgb")).toBe(false);
  });
});

describe("Gamut mapper: in-gamut colors", () => {
  it("leaves an in-gamut color unchanged and reports mapped=false", () => {
    const result = mapToGamut(0.5, 0.05, 220, "srgb");
    expect(result.inGamut).toBe(true);
    expect(result.mapped).toBe(false);
    expect(result.clipped).toBe(false);
    expect(result.iterations).toBe(0);
    expect(result.deltaEOK).toBe(0);
    expect(result.oklch).toEqual({ l: 0.5, c: 0.05, h: 220 });
    expect(result.original).toEqual({ l: 0.5, c: 0.05, h: 220 });
    expect(result.hex).toMatch(HEX);
    expect(result.css).toBe("oklch(0.500 0.050 220)");
    expect(result.inSrgb).toBe(true);
  });
});

describe("Gamut mapper: CSS Color 4 binary search with local MINDE", () => {
  it("reduces chroma while preserving L and H (within the documented JND) for an out-of-gamut color", () => {
    const result = mapToGamut(0.7, 0.25, 30, "srgb");
    expect(result.inGamut).toBe(false);
    expect(result.mapped).toBe(true);
    expect(result.iterations).toBeGreaterThan(0);
    expect(result.iterations).toBeLessThanOrEqual(64);
    expect(result.oklch.c).toBeLessThan(0.25);
    expect(result.oklch.c).toBeGreaterThan(0);
    // The local-MINDE branch may return a clipped reference color, so L and H
    // are preserved within the JND rather than bit-exactly.
    expect(Math.abs(result.oklch.l - 0.7)).toBeLessThan(GAMUT_JND);
    expect(Math.abs(result.oklch.h - 30)).toBeLessThan(1);

    // The mapped color is inside the gamut and the reported deltaEOK measures
    // the documented total perceptual change.
    expect(isInGamut(result.oklch.l, result.oklch.c, result.oklch.h, "srgb")).toBe(true);
    expect(result.deltaEOK).toBeGreaterThan(0);
    expect(result.deltaEOK).toBeLessThan(0.1);
    expect(result.hex).toMatch(HEX);
    // Original request is preserved alongside the mapped value.
    expect(result.original).toEqual({ l: 0.7, c: 0.25, h: 30 });
  });

  it("keeps chroma reduction monotonic: less requested chroma never maps lower", () => {
    const full = mapToGamut(0.7, 0.25, 30, "srgb");
    const partial = mapToGamut(0.7, 0.22, 30, "srgb");
    expect(partial.oklch.c).toBeLessThanOrEqual(full.oklch.c + 1e-3);
  });

  it("keeps the chroma-reduction interval within the documented epsilon", () => {
    const result = mapToGamut(0.7, 0.25, 30, "srgb");
    // Bisection converges to the gamut boundary: requesting slightly less
    // chroma must not require further reduction beyond the epsilon window.
    const lower = mapToGamut(0.7, result.oklch.c - GAMUT_CHROMA_EPSILON * 10, 30, "srgb");
    expect(lower.oklch.c).toBeLessThanOrEqual(result.oklch.c + 1e-6);
  });

  it("handles black and white lightness boundaries", () => {
    const black = mapToGamut(0, 0.02, 45, "srgb");
    expect(black.hex).toBe("#000000");
    expect(black.oklch).toEqual({ l: 0, c: 0, h: 0 });
    expect(black.mapped).toBe(true);

    const white = mapToGamut(1, 0.02, 45, "p3");
    expect(white.hex).toBe("#ffffff");
    expect(white.channels).toEqual({ r: 1, g: 1, b: 1 });
    expect(white.css).toBe("color(display-p3 1.0000 1.0000 1.0000)");

    // Pure achromatic boundary colors are reported as already in gamut.
    expect(mapToGamut(0, 0, 0, "srgb").inGamut).toBe(true);
    expect(mapToGamut(1, 0, 0, "srgb").inGamut).toBe(true);
    expect(() => mapToGamut(-0.5, 0.1, 20)).not.toThrow();
    expect(mapToGamut(-0.5, 0.1, 20).hex).toBe("#000000");
    expect(mapToGamut(1.5, 0.1, 20).hex).toBe("#ffffff");
  });

  it("handles achromatic colors in both gamuts", () => {
    const graySrgb = mapToGamut(0.5, 0, 45, "srgb");
    expect(graySrgb.inGamut).toBe(true);
    expect(graySrgb.srgb.r).toBeCloseTo(graySrgb.srgb.g, 12);
    expect(graySrgb.srgb.g).toBeCloseTo(graySrgb.srgb.b, 12);
    // OKLCH L = 0.5 is perceptual and renders near #636363 in sRGB.
    expect(graySrgb.hex).toBe("#636363");

    const grayP3 = mapToGamut(0.5, 0, 45, "p3");
    expect(grayP3.inGamut).toBe(true);
    expect(grayP3.channels.r).toBeCloseTo(grayP3.channels.b, 6);
    expect(grayP3.hex).toBe(graySrgb.hex);
  });
});

describe("Gamut mapper: P3 exports and independent sRGB fallbacks", () => {
  it("REGRESSION: P3 channels are never encoded as #rrggbb", () => {
    // A color that lives in P3 but not in sRGB: the 1.2.0 implementation
    // returned the P3 channels re-encoded as hex for this case.
    const witness = mapToGamut(0.69, 0.26, 142, "p3");
    const naiveP3Hex = `#${[witness.channels.r, witness.channels.g, witness.channels.b]
      .map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, "0"))
      .join("")}`;

    expect(naiveP3Hex).toBe("#4bbc1c");
    expect(witness.hex).toBe("#00be00");
    expect(witness.hex).not.toBe(naiveP3Hex);
    // The published hex is the independent sRGB mapping of the same color.
    expect(witness.hex).toBe(mapToGamut(0.69, 0.26, 142, "srgb").hex);

    // P3 CSS uses color(display-p3 ...) with 4-decimal channels.
    expect(witness.css).toMatch(
      /^color\(display-p3 0\.2940 0\.7364 0\.1084\)$/
    );
    expect(witness.css).not.toContain("#");
  });

  it("exports a color outside both gamuts as P3 CSS plus an sRGB hex", () => {
    const p3 = mapToGamut(0.7, 0.25, 30, "p3");
    const srgbMapped = mapToGamut(0.7, 0.25, 30, "srgb");
    expect(p3.inGamut).toBe(false);
    expect(p3.mapped).toBe(true);
    expect(p3.hex).toMatch(HEX);
    expect(p3.hex).toBe(srgbMapped.hex);
    expect(p3.srgb.r).toBeCloseTo(srgbMapped.srgb.r, 12);
    expect(p3.css).toMatch(/^color\(display-p3 /);
    expect(p3.srgbCss.startsWith("oklch(")).toBe(true);
  });

  it("REGRESSION: local-MINDE error is measured in the TARGET gamut, not sRGB", () => {
    // Regression for the audit finding that P3 channels were converted with
    // srgb01ToOklab while clipping against the P3 target, so the chroma search
    // optimized the wrong error metric.
    const requested = { l: 0.7, c: 0.3, h: 30 };
    const actual = mapToGamut(requested.l, requested.c, requested.h, "p3");
    const reference = referenceMapToGamut(requested.l, requested.c, requested.h, "p3");

    const actualLab = channelsToTargetOklab(actual.channels, "p3");
    const referenceLab = channelsToTargetOklab(reference, "p3");
    expect(deltaEOk(actualLab, referenceLab)).toBeLessThan(1e-6);

    // Also pinned as literal channels: the reference value for this input is
    // approximately r=1, g=0.2851, b=0.1928 in Display P3.
    expect(actual.channels.r).toBeCloseTo(reference.r, 4);
    expect(actual.channels.g).toBeCloseTo(0.2851, 3);
    expect(actual.channels.b).toBeCloseTo(0.1928, 3);
    expect(actual.channels.r).toBeCloseTo(1, 6);

    // The wrong (sRGB-assumed) conversion produces a visibly different answer,
    // which is exactly why this case is pinned.
    const srgbAssumed = srgb01ToOklab(actual.channels);
    expect(deltaEOk(srgbAssumed, referenceLab)).toBeGreaterThan(GAMUT_JND);

    // The same treatment must hold for the sRGB target (no regression there).
    const srgbActual = mapToGamut(0.7, 0.3, 30, "srgb");
    const srgbReference = referenceMapToGamut(0.7, 0.3, 30, "srgb");
    // Agreement is bounded by the documented JND-scale round trip through OKLCH.
    expect(deltaEOk(srgb01ToOklab(srgbActual.channels), srgb01ToOklab(srgbReference))).toBeLessThan(
      1e-6
    );
  });

  it("maps a color that is out of sRGB but inside P3 without touching sRGB", () => {
    const witness = { l: 0.69, c: 0.26, h: 142 };
    expect(isInGamut(witness.l, witness.c, witness.h, "srgb")).toBe(false);
    expect(isInGamut(witness.l, witness.c, witness.h, "p3")).toBe(true);

    const p3 = mapToGamut(witness.l, witness.c, witness.h, "p3");
    expect(p3.inGamut).toBe(true);
    expect(p3.mapped).toBe(false);
    expect(p3.oklch.c).toBeCloseTo(witness.c, 9);
    expect(p3.oklch.l).toBeCloseTo(witness.l, 9);
    expect(p3.css).toContain("color(display-p3");

    const srgb = mapToGamut(witness.l, witness.c, witness.h, "srgb");
    expect(srgb.mapped).toBe(true);
    // Independent sRGB mapping reduces chroma further than the P3 result.
    expect(srgb.oklch.c).toBeLessThan(p3.oklch.c);
    expect(srgb.hex).toMatch(HEX);
    expect(isInGamut(srgb.oklch.l, srgb.oklch.c, srgb.oklch.h, "srgb")).toBe(true);
  });

  it("maps a color outside BOTH sRGB and P3 in both targets", () => {
    const outsideBoth = { l: 0.7, c: 0.4, h: 30 };
    expect(isInGamut(outsideBoth.l, outsideBoth.c, outsideBoth.h, "srgb")).toBe(false);
    expect(isInGamut(outsideBoth.l, outsideBoth.c, outsideBoth.h, "p3")).toBe(false);

    for (const target of ["srgb", "p3"] as const) {
      const mapped = mapToGamut(outsideBoth.l, outsideBoth.c, outsideBoth.h, target);
      expect(mapped.mapped).toBe(true);
      expect(isInGamut(mapped.oklch.l, mapped.oklch.c, mapped.oklch.h, target)).toBe(true);
      expect(mapped.hex).toMatch(HEX);
      expect(mapped.deltaEOK).toBeLessThan(0.25);
    }
    // Both targets agree on the sRGB rendering of the same requested color.
    expect(mapToGamut(outsideBoth.l, outsideBoth.c, outsideBoth.h, "p3").hex).toBe(
      mapToGamut(outsideBoth.l, outsideBoth.c, outsideBoth.h, "srgb").hex
    );
  });

  it("oklchToHex always returns an sRGB fallback, even for a p3 target", () => {
    expect(oklchToHex(0.69, 0.26, 142, "p3")).toMatch(HEX);
    expect(oklchToHex(0.69, 0.26, 142, "p3")).toBe(oklchToHex(0.69, 0.26, 142, "srgb"));
    expect(oklchToHex(0.7, 0.25, 30, "p3")).toBe(oklchToHex(0.7, 0.25, 30, "srgb"));
  });
});

describe("Gamut mapper: serialization-safe rounding", () => {
  it("reduces chroma when rounding would push the serialized color out of gamut", () => {
    const rounded = roundOklchForCss(0.7, 0.4, 30, "srgb");
    expect(rounded.adjusted).toBe(true);
    expect(rounded.c).toBeLessThan(0.4);
    expect(channelsInGamut(oklchToSrgb(rounded.l, rounded.c, rounded.h, "srgb"), SERIALIZED_CHANNEL_EPSILON)).toBe(true);
    expect(rounded.css).toBe(`oklch(${rounded.l.toFixed(3)} ${rounded.c.toFixed(3)} ${rounded.h})`);
  });

  it("leaves already-safe rounded values untouched", () => {
    const rounded = roundOklchForCss(0.5, 0.05, 220, "srgb");
    expect(rounded.adjusted).toBe(false);
    expect(rounded.l).toBe(0.5);
    expect(rounded.c).toBe(0.05);
    expect(rounded.h).toBe(220);
  });

  it("rounds hue to whole degrees and normalizes it", () => {
    const rounded = roundOklchForCss(0.5, 0.02, 359.6, "srgb");
    expect(rounded.h).toBe(0);
    expect(Number.isInteger(rounded.h)).toBe(true);
  });
});