import { describe, it, expect } from "vitest";
import {
  generateSpacingScale,
  generateSpacingCss,
  spacingStep,
  SPACING_RATIOS
} from "../../src/domain/design-tokens/spacing-scale.js";
import { fluidClampErrorPx } from "../../src/domain/design-tokens/typography-generator.js";

describe("Spacing scale", () => {
  it("computes spacingStep on the modular scale", () => {
    expect(spacingStep(16, 1.25, 3)).toBe(31.25);
    expect(spacingStep(16, 1.333, -1)).toBeCloseTo(12.0, 1);
    expect(spacingStep(16, 1.5, 2)).toBe(36);
  });

  it("exposes the named spacing ratios", () => {
    expect(SPACING_RATIOS.majorThird).toBe(1.25);
    expect(SPACING_RATIOS.perfectFourth).toBe(1.333);
    expect(SPACING_RATIOS.golden).toBe(1.618);
  });

  it("keeps the nine-step preset as the default", () => {
    const scale = generateSpacingScale();
    expect(Object.keys(scale)).toEqual(["3xs", "2xs", "xs", "sm", "md", "lg", "xl", "2xl", "3xl"]);

    let prev = -Infinity;
    for (const key of Object.keys(scale)) {
      const token = scale[key]!;
      expect(token.px).toBeGreaterThan(prev);
      prev = token.px;
      expect(token.rem).toBe(`${(token.px / 16).toFixed(3)}rem`);
      expect(token.n).toBeDefined();
    }
  });

  it("REGRESSION: rejects zero, negative and decreasing ratios and invalid bases", () => {
    expect(() => generateSpacingScale(16, 0)).toThrow(RangeError);
    expect(() => generateSpacingScale(16, -1.25)).toThrow(RangeError);
    expect(() => generateSpacingScale(0, 1.25)).toThrow(RangeError);
    expect(() => generateSpacingScale(-16, 1.25)).toThrow(RangeError);
    expect(() => generateSpacingScale(NaN, 1.25)).toThrow(RangeError);
    expect(() => generateSpacingScale(16, NaN)).toThrow(RangeError);
    // Ratios below 1 produce a decreasing (incoherent) scale: rejected.
    expect(() => generateSpacingScale(16, 0.9)).toThrow(/monotonically increasing/);
    // ...unless explicitly allowed.
    expect(() => generateSpacingScale(16, 0.9, { allowDecreasingRatio: true })).not.toThrow();
  });

  it("rejects equal viewport bounds when fluid", () => {
    expect(() => generateSpacingScale(16, 1.25, { fluid: true, minVw: 800, maxVw: 800 })).toThrow(
      /strictly greater/
    );
    expect(() => generateSpacingScale(16, 1.25, { fluid: true, minVw: 1440, maxVw: 360 })).toThrow(
      RangeError
    );
    expect(() => generateSpacingScale(16, 1.25, { fluid: true, minVw: 0, maxVw: 1440 })).toThrow(
      RangeError
    );
  });

  it("never emits NaN or Infinity for any accepted input", () => {
    const scales = [
      generateSpacingScale(16, 1.25),
      generateSpacingScale(16, 1.25, { fluid: true, minVw: 360, maxVw: 1440 }),
      generateSpacingScale(8, 1.5, { fluid: true, fluidMinFactor: 0.5, rootFontPx: 10 })
    ];
    for (const scale of scales) {
      const css = generateSpacingCss(scale);
      expect(css).not.toMatch(/NaN|Infinity/);
      for (const token of Object.values(scale)) {
        expect(Number.isFinite(token.px)).toBe(true);
        expect(token.rem).not.toMatch(/NaN|Infinity/);
        if (token.clamp) {
          expect(token.clamp).not.toMatch(/NaN|Infinity/);
        }
      }
    }
  });

  it("makes the fluid minimum factor configurable", () => {
    const legacy = generateSpacingScale(16, 1.25, { fluid: true });
    expect(legacy.sm!.fluidMinPx).toBeCloseTo(13.6, 4);
    expect(legacy.sm!.clamp).toBeDefined();

    const custom = generateSpacingScale(16, 1.25, { fluid: true, fluidMinFactor: 0.7 });
    expect(custom.sm!.fluidMinPx).toBeCloseTo(11.2, 4);
    expect(custom.sm!.clamp).not.toBe(legacy.sm!.clamp);

    expect(() => generateSpacingScale(16, 1.25, { fluid: true, fluidMinFactor: 0 })).toThrow(RangeError);
    expect(() => generateSpacingScale(16, 1.25, { fluid: true, fluidMinFactor: 1.5 })).toThrow(RangeError);
    expect(() => generateSpacingScale(16, 1.25, { fluid: true, fluidMinFactor: NaN })).toThrow(RangeError);
  });

  it("makes the root font size configurable", () => {
    const root10 = generateSpacingScale(16, 1.25, { rootFontPx: 10 });
    expect(root10.sm!.rem).toBe("1.600rem");
    expect(generateSpacingScale(16, 1.25, { rootFontPx: 10, fluid: true }).sm!.clamp).toContain("1.60000rem");
    expect(() => generateSpacingScale(16, 1.25, { rootFontPx: 0 })).toThrow(RangeError);

    // Endpoint accuracy is preserved with a non-16px root.
    const fluid = generateSpacingScale(16, 1.25, { fluid: true, rootFontPx: 10, fluidMinFactor: 0.85 });
    const errors = fluidClampErrorPx(fluid.sm!.clamp!, 360, 1440, 10);
    expect(Math.abs(errors.atMin - fluid.sm!.fluidMinPx!)).toBeLessThanOrEqual(0.01);
    expect(Math.abs(errors.atMax - 16)).toBeLessThanOrEqual(0.01);
  });

  it("supports a custom ratio of 1.5", () => {
    const scale = generateSpacingScale(16, 1.5);
    expect(scale.sm!.px).toBe(16);
    expect(scale.md!.px).toBe(24);
    expect(scale.lg!.px).toBe(36);
    expect(scale.xl!.px).toBe(54);
    expect(scale["3xl"]!.px).toBe(121.5);
    expect(scale["3xs"]!.px).toBeCloseTo(4.74, 2);
  });

  it("supports custom step names and step counts", () => {
    const named = generateSpacingScale(8, 1.5, {
      steps: [
        { name: "tiny", n: -1 },
        { name: "base", n: 0 },
        { name: "big", n: 2 }
      ]
    });
    expect(Object.keys(named)).toEqual(["tiny", "base", "big"]);
    expect(named.base!.px).toBe(8);
    expect(named.big!.px).toBe(18);
    expect(named.tiny!.px).toBeCloseTo(5.33, 2);

    const counted = generateSpacingScale(16, 1.25, { stepCount: 5 });
    expect(Object.keys(counted)).toHaveLength(5);
    expect(Object.keys(counted)[2]).toBe("step2");

    expect(() => generateSpacingScale(16, 1.25, { steps: [] })).toThrow(RangeError);
    expect(() => generateSpacingScale(16, 1.25, { steps: [{ name: "", n: 0 }] })).toThrow(RangeError);
    expect(() => generateSpacingScale(16, 1.25, { stepCount: 1 })).toThrow(RangeError);
    expect(() => generateSpacingScale(16, 1.25, { stepCount: 30 })).toThrow(RangeError);
  });

  it("rejects steps that resolve to a non-positive size", () => {
    expect(() =>
      generateSpacingScale(4, 2, {
        steps: [
          { name: "tiny", n: -10 },
          { name: "base", n: 0 }
        ]
      })
    ).toThrow(RangeError);
  });

  it("emits a :root CSS block with clamp values only when fluid", () => {
    const flat = generateSpacingScale(16, 1.25, { fluid: false });
    for (const token of Object.values(flat)) {
      expect(token.clamp).toBeUndefined();
    }

    const fluid = generateSpacingScale(16, 1.25, { fluid: true });
    for (const token of Object.values(fluid)) {
      expect(token.clamp).toContain("clamp(");
    }

    const css = generateSpacingCss(generateSpacingScale());
    expect(css).toContain(":root");
    expect(css).toContain("--ink-space-sm: 1.000rem;");
    expect(css).toContain("--ink-space-3xl");
    expect(generateSpacingCss(fluid)).toContain("--ink-space-sm: clamp(");
    expect(() => generateSpacingCss({})).toThrow(RangeError);
  });
});