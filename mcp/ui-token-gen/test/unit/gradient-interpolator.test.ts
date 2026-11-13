import { describe, it, expect } from "vitest";
import {
  contrastOverGradient,
  generateAuthoredGradient,
  generateGradient,
  hueDeltaFor,
  interpolateAt,
  interpolateStops,
  interpolateAuthoredStops,
  shortestHueDelta,
  buildGradientCss,
  DEFAULT_GAMUT_VALIDATION_SAMPLES
} from "../../src/domain/design-tokens/gradient-interpolator.js";
import { isInGamut, mapToGamut, oklchToOklab } from "../../src/domain/design-tokens/gamut-mapper.js";
import { calculateContrastRatio } from "../../src/domain/design-tokens/color-math.js";

describe("Gradient interpolator: backward compatible two-endpoint API", () => {
  it("takes the short way around the hue wheel (350 -> 10 goes +20deg)", () => {
    expect(shortestHueDelta(350, 10)).toBeCloseTo(20, 6);
    expect(shortestHueDelta(10, 350)).toBeCloseTo(-20, 6);

    const stops = interpolateStops({ l: 0.7, c: 0.05, h: 350 }, { l: 0.7, c: 0.05, h: 10 }, 3);
    expect(stops).toHaveLength(3);
    const mid = stops[1]!.oklch.h;
    const distFromZero = Math.min(mid, 360 - mid);
    expect(distFromZero).toBeLessThan(5);
    expect(Math.abs(mid - 180)).toBeGreaterThan(90);
  });

  it("documents every hue path", () => {
    expect(hueDeltaFor(350, 10, "shorter")).toBeCloseTo(20, 6);
    expect(hueDeltaFor(350, 10, "longer")).toBeCloseTo(-340, 6); // complement arc, never +380
    expect(hueDeltaFor(350, 10, "increasing")).toBeCloseTo(20, 6);
    expect(hueDeltaFor(10, 350, "decreasing")).toBeCloseTo(-20, 6);
    expect(hueDeltaFor(0, 360, "shorter")).toBeCloseTo(0, 6);
    expect(hueDeltaFor(100, 100, "longer")).toBeCloseTo(-360, 6);
  });

  it("interpolates L and C linearly with the midpoint at t=0.5", () => {
    const stops = interpolateStops({ l: 0.4, c: 0.05, h: 100 }, { l: 0.8, c: 0.15, h: 100 }, 3);
    expect(stops[0]!.t).toBeCloseTo(0, 10);
    expect(stops[1]!.t).toBeCloseTo(0.5, 10);
    expect(stops[2]!.t).toBeCloseTo(1, 10);
    expect(stops[1]!.oklch.l).toBeCloseTo(0.6, 3);
    expect(stops[1]!.oklch.c).toBeCloseTo(0.1, 3);
  });

  it("REGRESSION: rejects fractional step counts instead of silently flooring them", () => {
    const from = { l: 0.6, c: 0.1, h: 200 };
    const to = { l: 0.7, c: 0.1, h: 250 };
    expect(() => interpolateStops(from, to, 1)).toThrow(RangeError);
    expect(() => interpolateStops(from, to, 0)).toThrow(RangeError);
    expect(() => interpolateStops(from, to, -4)).toThrow(RangeError);
    expect(() => interpolateStops(from, to, NaN)).toThrow(RangeError);
    expect(() => interpolateStops(from, to, Infinity)).toThrow(RangeError);
    // The 1.2.0 defect: steps = 2.9 was silently floored to 2.
    expect(() => interpolateStops(from, to, 2.9)).toThrow(RangeError);
    expect(() => interpolateStops(from, to, 5.000001)).toThrow(RangeError);
    expect(interpolateStops(from, to, 5)).toHaveLength(5);
  });

  it("rejects non-finite and out-of-range color components", () => {
    expect(() => interpolateStops({ l: NaN, c: 0.1, h: 0 }, { l: 0.5, c: 0.1, h: 0 }, 3)).toThrow(RangeError);
    expect(() => interpolateStops({ l: 1.5, c: 0.1, h: 0 }, { l: 0.5, c: 0.1, h: 0 }, 3)).toThrow(RangeError);
    expect(() => interpolateStops({ l: 0.5, c: -0.1, h: 0 }, { l: 0.5, c: 0.1, h: 0 }, 3)).toThrow(RangeError);
  });

  it("handles achromatic endpoints without producing NaN hue or chroma", () => {
    const stops = interpolateStops({ l: 0.95, c: 0, h: 0 }, { l: 0.2, c: 0, h: 0 }, 5);
    for (const stop of stops) {
      expect(Number.isFinite(stop.oklch.l)).toBe(true);
      expect(stop.oklch.c).toBe(0);
      expect(Number.isFinite(stop.oklch.h)).toBe(true);
      expect(stop.hex).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(stops[0]!.oklch.l).toBeCloseTo(0.95, 3);
    expect(stops[4]!.oklch.l).toBeCloseTo(0.2, 3);
  });

  it("emits a valid lowercase hex and in-gamut channels for high-chroma endpoints", () => {
    const stops = interpolateStops({ l: 0.7, c: 0.35, h: 20 }, { l: 0.7, c: 0.35, h: 300 }, 7);
    expect(stops).toHaveLength(7);
    for (const stop of stops) {
      expect(stop.hex).toMatch(/^#[0-9a-f]{6}$/);
      for (const channel of [stop.srgb.r, stop.srgb.g, stop.srgb.b]) {
        expect(channel).toBeGreaterThanOrEqual(0);
        expect(channel).toBeLessThanOrEqual(1);
      }
      expect(isInGamut(stop.oklch.l, stop.oklch.c, stop.oklch.h, "srgb")).toBe(true);
    }
    // At least one stop needed chroma reduction for sRGB.
    expect(stops.some((stop) => stop.clipped)).toBe(true);
  });

  it("builds CSS with explicit perceptual interpolation and hue method", () => {
    const { stops, css } = generateGradient({ l: 0.7, c: 0.1, h: 30 }, { l: 0.6, c: 0.12, h: 90 }, 3);
    expect(stops).toHaveLength(3);
    // The hue interpolation method is always serialized so browser
    // interpolation follows the same arc as the computed samples.
    expect(css.startsWith("linear-gradient(to right in oklch shorter hue, ")).toBe(true);
    expect(css).toContain("oklch(");
    expect(buildGradientCss(stops, "to bottom").startsWith("linear-gradient(to bottom in oklch shorter hue, ")).toBe(true);
    expect(buildGradientCss(stops, "to bottom", "oklab").startsWith("linear-gradient(to bottom in oklab, ")).toBe(true);
    expect(buildGradientCss(stops, "to bottom", "oklch", undefined, "longer")).toContain("in oklch longer hue");
    expect(buildGradientCss(stops, "to bottom", "oklch", undefined, "increasing")).toContain("in oklch increasing hue");
    expect(buildGradientCss(stops, "to bottom", "oklch", undefined, "decreasing")).toContain("in oklch decreasing hue");
    // OKLab has no hue component, so no hue method is serialized.
    expect(buildGradientCss(stops, "to bottom", "oklab")).not.toContain("hue");
  });

  it("REGRESSION: transparent stops emit valid CSS with alpha INSIDE the function", () => {
    const gradient = generateAuthoredGradient([
      { oklch: { l: 0.3, c: 0.08, h: 200 }, position: 0 },
      { oklch: { l: 0.7, c: 0.08, h: 40 }, position: 1, alpha: 0.5 }
    ]);

    // oklch(L C H / A) - never "oklch(L C H) / A".
    expect(gradient.css).toMatch(/oklch\(0\.700 0\.080 40 \/ 0\.5\d*\)/);
    expect(gradient.css).not.toMatch(/oklch\([^)]*\)\s*\//);
    expect(gradient.cssSrgb).not.toMatch(/oklch\([^)]*\)\s*\//);
    expect(gradient.stops[0]!.css).not.toMatch(/\)\s*\//);
    expect(gradient.stops[1]!.css).toMatch(/oklch\([^)]*\/ 0\.5\d*\)$/);

    // Display P3 keeps alpha inside color(display-p3 ... / A) too.
    const p3 = generateAuthoredGradient(
      [
        { oklch: { l: 0.3, c: 0.08, h: 200 }, position: 0 },
        { oklch: { l: 0.7, c: 0.08, h: 40 }, position: 1, alpha: 0.5 }
      ],
      { target: "p3" }
    );
    expect(p3.css).toMatch(/color\(display-p3 [\d.]+ [\d.]+ [\d.]+ \/ 0\.5\)/);
    expect(p3.css).not.toMatch(/color\(display-p3[^)]*\)\s*\//);
    expect(p3.cssP3).toMatch(/color\(display-p3 [\d.]+ [\d.]+ [\d.]+ \/ 0\.5\)/);
  });

  it("REGRESSION: transparency does not silently switch the interpolation space", () => {
    // CSS Color 4 §13.4: for cylindrical polar spaces the hue is NOT
    // premultiplied, so equal-alpha OKLCH stops keep chroma and hue arc.
    const polar = [
      { oklch: { l: 0.6, c: 0.1, h: 30 }, position: 0, alpha: 0.5 },
      { oklch: { l: 0.6, c: 0.1, h: 150 }, position: 1, alpha: 0.5 }
    ];
    const resolved = polar.map((stop) => ({
      ...stop,
      lab: oklchToOklab(stop.oklch.l, stop.oklch.c, stop.oklch.h)
    }));

    const oklchMid = interpolateAt(resolved, 0.5, "oklch", "shorter");
    expect(oklchMid.alpha).toBeCloseTo(0.5, 6);
    expect(oklchMid.oklch.l).toBeCloseTo(0.6, 6);
    expect(oklchMid.oklch.c).toBeCloseTo(0.1, 6);
    expect(Math.min(oklchMid.oklch.h, 360 - oklchMid.oklch.h)).toBeCloseTo(90, 6);

    // Rectangular OKLab legitimately collapses toward the achromatic axis.
    const oklabMid = interpolateAt(resolved, 0.5, "oklab", "shorter");
    expect(oklabMid.oklch.c).toBeLessThan(0.06);

    // Opaque stops are unaffected either way.
    const opaque = polar.map((stop) => ({
      oklch: stop.oklch,
      position: stop.position,
      alpha: 1,
      lab: oklchToOklab(stop.oklch.l, stop.oklch.c, stop.oklch.h)
    }));
    expect(interpolateAt(opaque, 0.5, "oklch", "shorter").oklch.c).toBeCloseTo(0.1, 6);

    // Premultiplied still matters when alpha varies (no dark halo).
    const fade = [
      { oklch: { l: 0.6, c: 0.1, h: 0 }, position: 0, alpha: 1 },
      { oklch: { l: 0.6, c: 0.1, h: 0 }, position: 1, alpha: 0 }
    ].map((stop) => ({ ...stop, lab: oklchToOklab(stop.oklch.l, stop.oklch.c, stop.oklch.h) }));
    const fading = interpolateAt(fade, 0.5, "oklch", "shorter");
    expect(fading.alpha).toBeCloseTo(0.5, 6);
    // Polar premultiplication keeps L and C intact while fading to transparent
    // (this is what prevents a dark halo through the transparent color).
    expect(fading.oklch.l).toBeCloseTo(0.6, 6);
    expect(fading.oklch.c).toBeCloseTo(0.1, 6);
  });

  it("REGRESSION: authored two-stop positions survive CSS serialization", () => {
    const gradient = generateAuthoredGradient([
      { oklch: { l: 0.5, c: 0.05, h: 30 }, position: 0.2 },
      { oklch: { l: 0.6, c: 0.05, h: 60 }, position: 0.8 }
    ]);
    expect(gradient.css).toContain("20%");
    expect(gradient.css).toContain("80%");
    expect(gradient.css).not.toMatch(/,\s*$/);

    // Implicit 0%/100% two-stop gradients stay position-free (backward compatible).
    const plain = generateGradient({ l: 0.4, c: 0.05, h: 30 }, { l: 0.6, c: 0.05, h: 60 }, 2);
    expect(plain.css).not.toContain("%");
    // Evenly spaced sampled stops keep the compact form.
    const sampled = generateGradient({ l: 0.7, c: 0.1, h: 30 }, { l: 0.6, c: 0.12, h: 90 }, 3);
    expect(sampled.css).not.toContain("%");
  });
});

describe("Gradient interpolator: authored stops", () => {
  const authored = [
    { oklch: { l: 0.2, c: 0.05, h: 350 }, position: 0 },
    { oklch: { l: 0.75, c: 0.12, h: 40 }, position: 0.35, alpha: 0.5 },
    { oklch: { l: 0.95, c: 0.02, h: 200 }, position: 1 }
  ];

  it("honours explicit stop positions in the emitted CSS", () => {
    const gradient = generateAuthoredGradient(authored);
    expect(gradient.stops).toHaveLength(3);
    expect(gradient.stops.map((s) => s.position)).toEqual([0, 0.35, 1]);
    expect(gradient.css).toContain("35%");
    expect(gradient.css).toContain("100%");
    expect(gradient.css.startsWith("linear-gradient(to right in oklch shorter hue, ")).toBe(true);
  });

  it("defaults positions to evenly spaced values when omitted", () => {
    const { stops } = interpolateAuthoredStops([
      { oklch: { l: 0.3, c: 0.05, h: 20 } },
      { oklch: { l: 0.6, c: 0.05, h: 120 } },
      { oklch: { l: 0.9, c: 0.05, h: 220 } }
    ]);
    expect(stops.map((s) => s.position)).toEqual([0, 0.5, 1]);
  });

  it("validates stop positions, ordering and alpha", () => {
    expect(() =>
      interpolateAuthoredStops([
        { oklch: { l: 0.5, c: 0.05, h: 0 }, position: 0.8 },
        { oklch: { l: 0.6, c: 0.05, h: 0 }, position: 0.2 }
      ])
    ).toThrow(RangeError);

    expect(() =>
      interpolateAuthoredStops([
        { oklch: { l: 0.5, c: 0.05, h: 0 }, position: -0.1 },
        { oklch: { l: 0.6, c: 0.05, h: 0 }, position: 1 }
      ])
    ).toThrow(RangeError);

    expect(() =>
      interpolateAuthoredStops([
        { oklch: { l: 0.5, c: 0.05, h: 0 }, position: 0 },
        { oklch: { l: 0.6, c: 0.05, h: 0 }, position: 1, alpha: 1.5 }
      ])
    ).toThrow(RangeError);

    expect(() => interpolateAuthoredStops([{ oklch: { l: 0.5, c: 0.05, h: 0 } }])).toThrow(RangeError);
    expect(() => interpolateAuthoredStops([])).toThrow(RangeError);

    // Equal positions are allowed (hard stops).
    const hardStop = interpolateAuthoredStops([
      { oklch: { l: 0.2, c: 0.05, h: 0 }, position: 0 },
      { oklch: { l: 0.9, c: 0.05, h: 0 }, position: 0 },
      { oklch: { l: 0.9, c: 0.05, h: 0 }, position: 1 }
    ]);
    expect(hardStop.stops).toHaveLength(3);
  });

  it("interpolates alpha with premultiplied components", () => {
    const gradient = generateAuthoredGradient(authored);
    expect(gradient.stops.map((s) => s.alpha)).toEqual([1, 0.5, 1]);
    expect(gradient.stops[1]!.hexWithAlpha).toMatch(/^#[0-9a-f]{8}$/);
    expect(gradient.stops[0]!.hexWithAlpha).toMatch(/^#[0-9a-f]{6}$/);
    expect(gradient.css).toContain("/ 0.5");

    const opaqueOnly = generateAuthoredGradient([
      { oklch: { l: 0.3, c: 0.05, h: 20 } },
      { oklch: { l: 0.6, c: 0.05, h: 120 } }
    ]);
    for (const stop of opaqueOnly.stops) {
      expect(stop.alpha).toBe(1);
      expect(stop.hexWithAlpha).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(opaqueOnly.css).not.toContain("/");
  });

  it("interpolates in OKLab on request", () => {
    const from = { l: 0.75, c: 0.12, h: 40 };
    const to = { l: 0.95, c: 0.02, h: 200 };
    const oklchGradient = generateGradient(from, to, 3, "srgb", { interpolationSpace: "oklch" });
    const oklabGradient = generateGradient(from, to, 3, "srgb", { interpolationSpace: "oklab" });

    expect(oklabGradient.interpolationSpace).toBe("oklab");
    expect(oklabGradient.css).toContain("in oklab");
    expect(oklabGradient.css).not.toContain("hue");
    expect(oklchGradient.css).toContain("in oklch");

    // Rectangular OKLab interpolation does not follow the polar hue path, so
    // the midpoint must differ from the OKLCH midpoint.
    expect(oklabGradient.stops[1]!.oklch.h).not.toBeCloseTo(oklchGradient.stops[1]!.oklch.h, 3);
    expect(oklchGradient.stops[1]!.oklch.h).toBeCloseTo(120, 1);
    // Endpoints are identical in both spaces.
    expect(oklabGradient.stops[0]!.oklch).toEqual(oklchGradient.stops[0]!.oklch);
    expect(oklabGradient.stops[2]!.oklch).toEqual(oklchGradient.stops[2]!.oklch);
  });

  it("evaluates arbitrary positions between authored stops", () => {
    const resolved = (() => {
      const stops = generateAuthoredGradient(authored);
      return stops;
    })();
    expect(resolved.stops).toHaveLength(3);
    expect(() =>
      contrastOverGradient(authored, "#ffffff", { positions: [0, 0.5, 1] })
    ).not.toThrow();
    expect(() => contrastOverGradient(authored, "#ffffff", { positions: [0, 1.5] })).toThrow(RangeError);
    void interpolateAt;
  });
});

describe("Gradient interpolator: gamut policy and dual exports", () => {
  it("reports the sampled gamut validation policy honestly", () => {
    const gradient = generateGradient({ l: 0.8, c: 0.4, h: 30 }, { l: 0.6, c: 0.4, h: 300 }, 5);
    expect(gradient.gamut.policy).toBe("sampled");
    expect(gradient.gamut.samplesChecked).toBe(DEFAULT_GAMUT_VALIDATION_SAMPLES);
    expect(gradient.gamut.allSamplesInGamut).toBe(false);
    expect(gradient.gamut.mappedSamples).toBeGreaterThan(0);
    expect(gradient.gamut.note).toContain("do not prove");
    expect(gradient.gamut.maxDeltaEOK).toBeGreaterThanOrEqual(0);
  });

  it("does not claim a whole gradient is in gamut when only samples were checked", () => {
    const inGamut = generateGradient({ l: 0.6, c: 0.05, h: 20 }, { l: 0.7, c: 0.08, h: 200 }, 4);
    expect(inGamut.gamut.allSamplesInGamut).toBe(true);
    expect(inGamut.gamut.mappedSamples).toBe(0);
    // The policy string is still explicit about sampling.
    expect(inGamut.gamut.policy).toBe("sampled");
    expect(inGamut.gamut.note).toMatch(/[Ss]ampled validation/);
  });

  it("produces independently correct sRGB and P3 exports", () => {
    const srgb = generateGradient({ l: 0.7, c: 0.3, h: 30 }, { l: 0.6, c: 0.3, h: 60 }, 3, "srgb");
    const p3 = generateGradient({ l: 0.7, c: 0.3, h: 30 }, { l: 0.6, c: 0.3, h: 60 }, 3, "p3");

    // sRGB export: oklch() stops plus an independent hex ramp.
    expect(srgb.css).toContain("oklch(");
    expect(srgb.cssSrgb).toMatch(/#([0-9a-f]{6})/);
    expect(srgb.hexes.every((hex) => /^#[0-9a-f]{6}$/.test(hex))).toBe(true);
    for (const stop of srgb.stops) {
      expect(stop.hex).toBe(mapToGamut(stop.oklch.l, stop.oklch.c, stop.oklch.h, "srgb").hex);
    }

    // P3 export: color(display-p3 ...) stops, never hex-encoded P3 channels.
    expect(p3.css).toContain("color(display-p3");
    expect(p3.css).not.toMatch(/#[0-9a-f]{6}/);
    expect(p3.cssP3).toContain("color(display-p3");
    // Each target produces its own mapped stops; both expose real sRGB hexes.
    for (const hex of p3.hexes) {
      expect(hex).toMatch(/^#[0-9a-f]{6}$/);
    }
    for (const stop of p3.stops) {
      expect(stop.channels).not.toEqual(stop.srgb);
      expect(stop.css).toContain("color(display-p3");
      expect(stop.hex).toMatch(/^#[0-9a-f]{6}$/);
      expect(stop.hex).toBe(mapToGamut(stop.oklch.l, stop.oklch.c, stop.oklch.h, "srgb").hex);
      const naive = `#${[stop.channels.r, stop.channels.g, stop.channels.b]
        .map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, "0"))
        .join("")}`;
      if (naive !== "#000000" && naive !== "#ffffff") {
        expect(stop.hex).not.toBe(naive);
      }
    }
  });

  it("validates the gamut sample count", () => {
    expect(() =>
      generateGradient({ l: 0.5, c: 0.05, h: 0 }, { l: 0.6, c: 0.05, h: 90 }, 3, "srgb", {
        gamutValidationSamples: 4
      })
    ).toThrow(RangeError);
  });
});

describe("Gradient interpolator: contrast sampling", () => {
  const stops = [
    { oklch: { l: 0.95, c: 0.02, h: 250 }, position: 0 },
    { oklch: { l: 0.35, c: 0.12, h: 30 }, position: 1 }
  ];

  it("samples contrast at explicit positions and reports the worst case", () => {
    const positions = [0, 0.25, 0.5, 0.75, 1];
    const report = contrastOverGradient(stops, "#ffffff", { positions });

    expect(report.positions).toEqual(positions);
    expect(report.samples).toHaveLength(5);
    expect(report.samples.map((s) => s.position)).toEqual(positions);
    for (const sample of report.samples) {
      expect(sample.backgroundHex).toMatch(/^#[0-9a-f]{6}$/);
      expect(sample.ratioExact).toBeCloseTo(
        calculateContrastRatio("#ffffff", sample.backgroundHex).ratioExact,
        12
      );
      expect(typeof sample.normalTextAA).toBe("boolean");
    }

    // The worst case is the lowest full-precision ratio of the samples.
    const worst = report.samples.reduce((a, b) => (a.ratioExact <= b.ratioExact ? a : b));
    expect(report.worstCase.position).toBe(worst.position);
    expect(report.worstCase.ratioExact).toBe(worst.ratioExact);
    expect(report.policy).toContain("worst case");
    expect(report.policy).toContain("not guaranteed");
  });

  it("evaluates the requested contrast target against the worst case", () => {
    const aa = contrastOverGradient(stops, "#ffffff", { contrastTarget: "aa" });
    expect(aa.requiredRatio).toBe(4.5);
    expect(aa.meetsTarget).toBe(aa.worstCase.ratioExact >= 4.5);

    const none = contrastOverGradient(stops, "#ffffff", { contrastTarget: "none" });
    expect(none.requiredRatio).toBe(0);
    expect(none.meetsTarget).toBe(true);

    const aaa = contrastOverGradient(stops, "#ffffff", { contrastTarget: "aaa" });
    expect(aaa.requiredRatio).toBe(7);
  });

  it("defaults sample positions to the authored stop positions", () => {
    const report = contrastOverGradient(stops, "#000000");
    expect(report.positions).toEqual([0, 1]);
    expect(report.samples).toHaveLength(2);
  });

  it("REGRESSION: transparent gradients are composited over the backdrop, not measured as opaque", () => {
    // Fully transparent black over a white canvas is a WHITE background:
    // white text must be reported as 1:1, not the opaque black's 21:1.
    const transparent = [
      { oklch: { l: 0, c: 0, h: 0 }, position: 0, alpha: 0 },
      { oklch: { l: 0, c: 0, h: 0 }, position: 1, alpha: 0 }
    ];
    const overWhite = contrastOverGradient(transparent, "#ffffff", {
      positions: [0, 0.5, 1],
      backdropHex: "#ffffff"
    });

    expect(overWhite.compositedAlpha).toBe(true);
    expect(overWhite.backdropHex).toBe("#ffffff");
    for (const sample of overWhite.samples) {
      expect(sample.backgroundAlpha).toBe(0);
      expect(sample.backgroundHex).toBe("#ffffff");
      expect(sample.backgroundHexOpaque).toBe("#000000");
      expect(sample.ratioExact).toBeCloseTo(1, 10);
      expect(sample.normalTextAA).toBe(false);
    }
    expect(overWhite.worstCase.ratioExact).toBeCloseTo(1, 10);
    expect(overWhite.meetsTarget).toBe(false);
    expect(overWhite.policy).toContain("composited over the backdrop");

    // The same gradient over a black canvas is real black: 21:1 for white text.
    const overBlack = contrastOverGradient(transparent, "#ffffff", {
      positions: [0, 1],
      backdropHex: "#000000"
    });
    expect(overBlack.samples[0]!.backgroundHex).toBe("#000000");
    expect(overBlack.samples[0]!.ratioExact).toBeCloseTo(21, 8);
    expect(overBlack.meetsTarget).toBe(true);

    // Opaque gradients are not composited and keep the exact old behavior.
    const opaqueReport = contrastOverGradient(stops, "#000000", { positions: [0, 1] });
    expect(opaqueReport.compositedAlpha).toBe(false);
    for (const sample of opaqueReport.samples) {
      expect(sample.backgroundHex).toBe(sample.backgroundHexOpaque);
      expect(sample.backgroundAlpha).toBe(1);
    }
  });

  it("REGRESSION: half-transparent black over white halves the measured contrast", () => {
    const halfTransparent = [
      { oklch: { l: 0, c: 0, h: 0 }, position: 0, alpha: 0.5 },
      { oklch: { l: 0, c: 0, h: 0 }, position: 1, alpha: 0.5 }
    ];
    const report = contrastOverGradient(halfTransparent, "#ffffff", {
      positions: [0, 1],
      backdropHex: "#ffffff"
    });
    // #ffffff composited with 50% black = 0.5 -> #808080
    expect(report.samples[0]!.backgroundHex).toBe("#808080");
    expect(report.samples[0]!.backgroundHexOpaque).toBe("#000000");
    // Contrast of white on #808080 is ~3.95:1, not 21:1.
    expect(report.samples[0]!.ratioExact).toBeGreaterThan(3);
    expect(report.samples[0]!.ratioExact).toBeLessThan(4.5);
    expect(report.meetsTarget).toBe(false);
  });

  it("rejects an invalid backdrop color", () => {
    expect(() => contrastOverGradient(stops, "#000000", { backdropHex: "not-a-color" })).toThrow(
      RangeError
    );
  });

  it("keeps the wide-gamut contrast policy explicit", () => {
    const report = contrastOverGradient(stops, "#000000", { target: "p3", positions: [0, 1] });
    expect(report.policy).toContain("sRGB fallback");
  });
});