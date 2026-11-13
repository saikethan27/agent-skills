import { describe, it, expect } from "vitest";
import {
  MOOD_PRESETS,
  PALETTE_TOKEN_NAMES,
  buildRamp,
  cubicBezierEasing,
  generatePalette,
  PaletteMood
} from "../../src/domain/design-tokens/palette-generator.js";
import { calculateContrastRatio } from "../../src/domain/design-tokens/color-math.js";
import {
  isInGamut,
  mapToGamut,
  oklchToSrgb,
  roundOklchForCss,
  serializedChannelsInGamut
} from "../../src/domain/design-tokens/gamut-mapper.js";

const MOODS: PaletteMood[] = [
  "editorial",
  "cyber-tactile",
  "neo-brutalist",
  "luxury-dark",
  "organic-modern"
];

describe("Palette generator: mood presets", () => {
  it("keeps the five shipped moods as presets", () => {
    expect(Object.keys(MOOD_PRESETS).sort()).toEqual([...MOODS].sort());
    for (const mood of MOODS) {
      expect(MOOD_PRESETS[mood].mood).toBe(mood);
      expect(MOOD_PRESETS[mood].baseHue).toBeGreaterThanOrEqual(0);
      expect(MOOD_PRESETS[mood].baseHue).toBeLessThan(360);
    }
  });

  it("preserves the eleven semantic token names for every mood", () => {
    for (const mood of MOODS) {
      const palette = generatePalette(mood);
      expect(Object.keys(palette.tokens).sort()).toEqual([...PALETTE_TOKEN_NAMES].sort());
      for (const name of PALETTE_TOKEN_NAMES) {
        expect(palette.tokens[name].cssString).toMatch(/^oklch\(/);
      }
    }
  });

  it("emits CSS variables for every semantic token plus sRGB fallbacks", () => {
    const palette = generatePalette("editorial");
    for (const name of PALETTE_TOKEN_NAMES) {
      expect(palette.cssVariables).toContain(`--ink-${name.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase())}`);
    }
    expect(palette.cssVariables).toContain("--ink-bg-surface-fallback: #");
    expect(palette.cssVariables).toContain("--ink-shadow-glow");
  });

  it("honours a custom base hue across every ramp", () => {
    const palette = generatePalette("bespoke", 310);
    expect(palette.baseHue).toBe(310);
    expect(palette.tokens.bgSurface.requested.h).toBeCloseTo(310, 6);
    expect(palette.tokens.bgSurface.hex).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe("Palette generator: contrast audit and correction", () => {
  it("REGRESSION: default editorial muted text is audited (uncorrected ~3.59:1) and reported as failing", () => {
    const uncorrected = generatePalette("editorial", undefined, { correctionMode: "none" });
    const muted = uncorrected.contrastAnalysis.mutedTextOnBg;

    expect(muted.foreground).toBe("textMuted");
    expect(muted.background).toBe("bgSurface");
    expect(muted.ratioExact).toBeCloseTo(3.59, 1);
    expect(muted.ratio).toBe(3.59);
    expect(muted.passed).toBe(false);
    expect(muted.apcaLc).toBeLessThan(0);
    expect(muted.apcaGuidance).toBe("Fail");

    // The audited value is measured from the exported colors.
    expect(muted.fgHex).toBe(uncorrected.tokens.textMuted.hex);
    expect(muted.bgHex).toBe(uncorrected.tokens.bgSurface.hex);
    expect(muted.ratioExact).toBeCloseTo(
      calculateContrastRatio(uncorrected.tokens.textMuted.hex, uncorrected.tokens.bgSurface.hex).ratioExact,
      12
    );

    expect(uncorrected.contrastAnalysis.failedPairings).toContain("textMutedOnBgSurface");
    expect(uncorrected.status).toBe("blocked");
    expect(uncorrected.warnings.length).toBeGreaterThan(0);
  });

  it("corrects failing text lightness for the selected target and reports every adjustment", () => {
    const palette = generatePalette("editorial");
    const muted = palette.contrastAnalysis.mutedTextOnBg;
    expect(muted.passed).toBe(true);
    expect(muted.ratioExact).toBeGreaterThanOrEqual(4.5);
    expect(muted.adjusted).toBe(true);
    expect(palette.status).toBe("success");
    expect(palette.contrastAnalysis.failedPairings).toHaveLength(0);

    const adjustments = palette.contrastAnalysis.adjustments.filter((a) => a.token === "textMuted");
    expect(adjustments.length).toBeGreaterThan(0);
    for (const adjustment of adjustments) {
      expect(adjustment.property).toBe("lightness");
      expect(adjustment.from).toBeCloseTo(0.51, 2);
      expect(adjustment.to).toBeGreaterThan(adjustment.from);
      expect(Math.abs(adjustment.delta)).toBeLessThanOrEqual(0.35);
      expect(adjustment.reason).toContain("changes only lightness");
    }
    // Hue and chroma are preserved by the correction.
    expect(palette.tokens.textMuted.requested.h).toBeCloseTo(215, 6);
    expect(Math.abs(palette.tokens.textMuted.c - 0.024)).toBeLessThan(0.005);
  });

  it("audits every text x surface pairing plus the UI pairings, for all five moods", () => {
    for (const mood of MOODS) {
      const palette = generatePalette(mood, undefined, { correctionMode: "none" });
      const ids = palette.contrastAnalysis.fullAudit.map((p) => p.pairing);
      expect(ids).toEqual(
        expect.arrayContaining([
          "textPrimaryOnBgSurface",
          "textSecondaryOnBgSurface",
          "textMutedOnBgSurface",
          "textPrimaryOnBgElevated",
          "textMutedOnBgElevated",
          "textPrimaryOnBgSubtle",
          "textMutedOnBgSubtle",
          "accentOnSurface",
          "accentOnElevated",
          "borderActiveOnSurface"
        ])
      );
      expect(palette.contrastAnalysis.fullAudit).toHaveLength(12);
      for (const pairing of palette.contrastAnalysis.fullAudit) {
        expect(pairing.ratioExact).toBeGreaterThanOrEqual(1);
        expect(pairing.ratio).toBeCloseTo(Number(pairing.ratioExact.toFixed(2)), 2);
        expect(["text", "ui"]).toContain(pairing.kind);
        expect(pairing.fgHex).toMatch(/^#[0-9a-f]{6}$/);
        expect(pairing.bgHex).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });

  it("reaches the requested target for every mood when correction is enabled", () => {
    for (const mood of MOODS) {
      const aa = generatePalette(mood);
      expect(aa.status, `${mood} should reach AA`).toBe("success");
      expect(aa.contrastAnalysis.failedPairings).toHaveLength(0);

      const none = generatePalette(mood, undefined, { correctionMode: "none" });
      expect(none.status).toBe("blocked");
      expect(none.contrastAnalysis.failedPairings.length).toBeGreaterThan(0);
    }
  });

  it("can target AAA and reports blocked when the target is unreachable", () => {
    const aaa = generatePalette("organic-modern", undefined, { contrastTarget: "aaa" });
    expect(aaa.contrastTarget).toBe("aaa");
    // Either every pairing reaches AAA, or the shortfall is reported.
    if (aaa.status === "success") {
      expect(aaa.contrastAnalysis.fullAudit.every((p) => p.ratioExact >= 7)).toBe(true);
    } else {
      expect(aaa.contrastAnalysis.failedPairings.length).toBeGreaterThan(0);
      expect(aaa.warnings.join(" ")).toContain("pairing");
    }

    // A light surface with a near-max target cannot be fixed by lightness only.
    const impossible = generatePalette("organic-modern", undefined, {
      contrastTarget: "aaa",
      correctionMode: "none",
      maxCorrectionDelta: 0
    });
    expect(impossible.status).toBe("blocked");
    expect(impossible.contrastAnalysis.failedPairings.length).toBeGreaterThan(0);
    expect(impossible.contrastAnalysis.adjustments).toHaveLength(0);
  });

  it("respects maxCorrectionDelta and the documented lightness limits", () => {
    const limited = generatePalette("editorial", undefined, { maxCorrectionDelta: 0.01 });
    expect(limited.status).toBe("blocked");
    for (const adjustment of limited.contrastAnalysis.adjustments) {
      expect(Math.abs(adjustment.delta)).toBeLessThanOrEqual(0.01 + 1e-6);
    }
    expect(() => generatePalette("editorial", undefined, { maxCorrectionDelta: 2 })).not.toThrow();
  });

  it("uses a reporting-only contrast target", () => {
    const palette = generatePalette("editorial", undefined, { contrastTarget: "none" });
    expect(palette.status).toBe("success");
    for (const pairing of palette.contrastAnalysis.fullAudit) {
      expect(pairing.requiredRatio).toBe(0);
      expect(pairing.passed).toBe(true);
    }
  });

  it("computes contrast from the same mapped colors it exports", () => {
    for (const mood of MOODS) {
      const palette = generatePalette(mood, undefined, { target: "p3" });
      for (const pairing of palette.contrastAnalysis.fullAudit) {
        expect(pairing.fgHex).toBe(palette.tokens[pairing.foreground].hex);
        expect(pairing.bgHex).toBe(palette.tokens[pairing.background].hex);
      }
      // The p3 target keeps real sRGB fallbacks (hex is never P3 channels).
      for (const name of PALETTE_TOKEN_NAMES) {
        const token = palette.tokens[name];
        expect(token.hex).toMatch(/^#[0-9a-f]{6}$/);
        const p3Channels = mapToGamut(token.l, token.c, token.h, "p3").channels;
        const naive = `#${[p3Channels.r, p3Channels.g, p3Channels.b]
          .map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, "0"))
          .join("")}`;
        expect(token.hex).toBe(mapToGamut(token.l, token.c, token.h, "srgb").hex);
        // Achromatic colors encode identically in both gamuts; every chromatic
        // token must differ from the naive "P3 channels as hex" encoding.
        if (naive !== "#000000" && naive !== "#ffffff") {
          expect(token.hex).not.toBe(naive);
        }
      }
    }
  });
});

describe("Palette generator: configurable ramps", () => {
  it("produces equal OKLCH lightness increments by default", () => {
    const palette = generatePalette("editorial", undefined, { steps: 6 });
    const ramp = palette.ramps.surface;
    expect(ramp).toHaveLength(6);
    const deltas = ramp.slice(1).map((stop, index) => stop.oklch.l - ramp[index]!.oklch.l);
    for (const delta of deltas) {
      expect(delta).toBeCloseTo(deltas[0]!, 6);
    }
    // Documented honestly: equal LIGHTNESS increments, not equal delta-E spacing.
    expect(ramp.map((stop) => stop.oklch.l)).toEqual([0.11, 0.15, 0.19, 0.23, 0.27, 0.31]);
  });

  it("evaluates a real cubic-Bezier easing curve for lightness", () => {
    expect(cubicBezierEasing(0, [0.4, 0, 0.2, 1])).toBeCloseTo(0, 6);
    expect(cubicBezierEasing(1, [0.4, 0, 0.2, 1])).toBeCloseTo(1, 6);
    expect(cubicBezierEasing(0.5, [0.42, 0, 0.58, 1])).toBeCloseTo(0.5, 3);
    // ease-out (0, 0, 0.58, 1) rises faster than linear.
    expect(cubicBezierEasing(0.25, [0, 0, 0.58, 1])).toBeGreaterThan(0.25);
    // ease-in (0.42, 0, 1, 1) lags behind linear.
    expect(cubicBezierEasing(0.75, [0.42, 0, 1, 1])).toBeLessThan(0.75);
    expect(() => cubicBezierEasing(0.5, [1.5, 0, 0.2, 1])).toThrow(RangeError);
    expect(() => cubicBezierEasing(0.5, [NaN, 0, 0.2, 1])).toThrow(RangeError);

    const eased = generatePalette("editorial", undefined, {
      steps: 5,
      lightnessMode: "eased",
      lightnessEasing: [0.42, 0, 0.58, 1]
    });
    const easedLightness = eased.ramps.surface.map((stop) => stop.oklch.l);
    expect(easedLightness[0]).toBeCloseTo(0.11, 3);
    expect(easedLightness[4]).toBeCloseTo(0.31, 3);
    expect(easedLightness[2]).toBeCloseTo(0.21, 3);
  });

  it("supports configurable lightness and chroma endpoints per ramp", () => {
    const palette = generatePalette("editorial", undefined, {
      steps: 5,
      surface: { lightnessStart: 0.2, lightnessEnd: 0.6, chromaStart: 0.02, chromaEnd: 0.05 },
      accent: { chromaStart: 0.05, chromaEnd: 0.3, chromaProfile: "bell", hueStart: 0, hueEnd: 120 }
    });

    expect(palette.ramps.surface[0]!.oklch.l).toBeCloseTo(0.2, 3);
    expect(palette.ramps.surface[4]!.oklch.l).toBeCloseTo(0.6, 3);
    expect(palette.ramps.surface[0]!.oklch.c).toBeCloseTo(0.02, 3);
    expect(palette.ramps.accent[0]!.oklch.h).toBeCloseTo(0, 3);
    expect(palette.ramps.accent[4]!.oklch.h).toBeCloseTo(120, 3);
    // Bell chroma profile peaks in the middle of the ramp.
    const chromas = palette.ramps.accent.map((stop) => stop.oklch.c);
    expect(chromas[2]!).toBeGreaterThan(chromas[0]!);
    expect(chromas[2]!).toBeGreaterThan(chromas[4]!);
  });

  it("supports the constant, linear and eased chroma profiles", () => {
    const constant = generatePalette("editorial", undefined, {
      chromaProfile: "constant",
      accent: { chromaStart: 0.1, chromaEnd: 0.1 }
    });
    const values = new Set(constant.ramps.accent.map((stop) => stop.oklch.c));
    expect(values.size).toBe(1);

    const linear = generatePalette("editorial", undefined, {
      steps: 5,
      chromaProfile: "linear",
      accent: { chromaStart: 0.05, chromaEnd: 0.25 }
    });
    expect(linear.ramps.accent[0]!.oklch.c).toBeCloseTo(0.05, 3);
    // The end of the ramp is gamut mapped, so the exported chroma can be
    // slightly below the requested chromaEnd (but never above it).
    expect(linear.ramps.accent[4]!.oklch.c).toBeLessThanOrEqual(0.25);
    expect(linear.ramps.accent[4]!.oklch.c).toBeGreaterThan(0.24);
  });

  it("validates ramp inputs", () => {
    expect(() => generatePalette("editorial", undefined, { steps: 1 })).toThrow(RangeError);
    expect(() => generatePalette("editorial", undefined, { steps: 40 })).toThrow(RangeError);
    expect(() =>
      generatePalette("editorial", undefined, { surface: { lightnessStart: 2 } })
    ).toThrow(RangeError);
    expect(() => generatePalette("editorial", undefined, { accent: { chromaEnd: 0.9 } })).toThrow(RangeError);
    // A non-finite hue is rejected instead of producing NaN CSS.
    expect(() => generatePalette("editorial", undefined, { baseHue: NaN })).toThrow(RangeError);
  });

  it("builds ramps directly with explicit options", () => {
    const ramp = buildRamp(
      {
        steps: 4,
        lightnessStart: 0.2,
        lightnessEnd: 0.8,
        chromaStart: 0.05,
        chromaEnd: 0.2,
        chromaProfile: "linear",
        hueStart: 20,
        hueEnd: 200
      },
      { steps: 4, lightnessMode: "equal", chromaProfile: "linear", easing: null, target: "srgb" }
    );
    expect(ramp).toHaveLength(4);
    expect(ramp[0]!.hex).toMatch(/^#[0-9a-f]{6}$/);
    ramp.forEach((stop, index) => {
      expect(stop.t).toBeCloseTo(index / 3, 6);
    });
  });
});

describe("Palette generator: gamut-mapped exports", () => {
  it("never emits an out-of-gamut serialized OKLCH value", () => {
    for (const mood of MOODS) {
      for (const target of ["srgb", "p3"] as const) {
        const palette = generatePalette(mood, undefined, { target });
        for (const name of PALETTE_TOKEN_NAMES) {
          const token = palette.tokens[name];
          const rounded = roundOklchForCss(token.l, token.c, token.h, target);
          expect(rounded.css).toBe(token.cssString);
          expect(serializedChannelsInGamut(oklchToSrgb(rounded.l, rounded.c, rounded.h, target))).toBe(true);
        }
        for (const ramp of [palette.ramps.surface, palette.ramps.text, palette.ramps.accent]) {
          for (const stop of ramp) {
            expect(serializedChannelsInGamut(oklchToSrgb(stop.oklch.l, stop.oklch.c, stop.oklch.h, target))).toBe(true);
            expect(stop.hex).toMatch(/^#[0-9a-f]{6}$/);
          }
        }
      }
    }
  });

  it("reports whether gamut mapping occurred per token", () => {
    const palette = generatePalette("cyber-tactile", undefined, { target: "srgb" });
    const mapped = PALETTE_TOKEN_NAMES.filter((name) => palette.tokens[name].mapped);
    // The cyber-tactile preset is deliberately high chroma: at least one token
    // must be reported as mapped rather than silently clipped.
    expect(mapped.length).toBeGreaterThan(0);
    for (const name of mapped) {
      expect(palette.tokens[name].hex).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});