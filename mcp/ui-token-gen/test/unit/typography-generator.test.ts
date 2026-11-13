import { describe, it, expect } from "vitest";
import {
  CLAMP_ENDPOINT_TOLERANCE_PX,
  fluidClampErrorPx,
  fluidClampMetrics,
  generateFluidClamp,
  generateGeometricTypography,
  generateTypographySystem
} from "../../src/domain/design-tokens/typography-generator.js";

describe("Fluid clamp maths", () => {
  it("uses the exact slope/intercept formula", () => {
    const metrics = fluidClampMetrics(16, 32, 360, 1440);
    expect(metrics.slope).toBeCloseTo((32 - 16) / (1440 - 360), 12);
    expect(metrics.intercept).toBeCloseTo(16 - 360 * metrics.slope, 12);
    expect(metrics.valueAtMinViewportPx).toBeCloseTo(16, 10);
    expect(metrics.valueAtMaxViewportPx).toBeCloseTo(32, 10);

    const clamp = generateFluidClamp(16, 32, 360, 1440);
    expect(clamp).toMatch(
      /^clamp\(\d+(\.\d+)?rem,\s*-?\d+(\.\d+)?rem\s*\+\s*\d+(\.\d+)?vw,\s*\d+(\.\d+)?rem\)$/
    );
    expect(clamp).toContain("1.4815vw");
    // No NaN / Infinity can appear in generated CSS.
    expect(clamp).not.toMatch(/NaN|Infinity/);
  });

  it("REGRESSION: reproduces the intended endpoints within the documented tolerance", () => {
    for (const [min, max] of [
      [16, 32],
      [38, 72],
      [12.5, 13.5],
      [100, 101]
    ] as Array<[number, number]>) {
      const clamp = generateFluidClamp(min, max, 360, 1440);
      const errors = fluidClampErrorPx(clamp, 360, 1440);
      expect(Math.abs(errors.atMin - min)).toBeLessThanOrEqual(CLAMP_ENDPOINT_TOLERANCE_PX);
      expect(Math.abs(errors.atMax - max)).toBeLessThanOrEqual(CLAMP_ENDPOINT_TOLERANCE_PX);
    }
    expect(CLAMP_ENDPOINT_TOLERANCE_PX).toBe(0.01);
  });

  it("supports a configurable root font size", () => {
    expect(generateFluidClamp(16, 32, 360, 1440, { rootFontPx: 16 })).toContain("1.00000rem");
    expect(generateFluidClamp(16, 32, 360, 1440, { rootFontPx: 10 })).toContain("1.60000rem");
    expect(generateFluidClamp(16, 32, 360, 1440, { rootFontPx: 10 })).toContain("3.20000rem");

    const clamp10 = generateFluidClamp(16, 32, 360, 1440, { rootFontPx: 10 });
    const errors = fluidClampErrorPx(clamp10, 360, 1440, 10);
    expect(Math.abs(errors.atMin - 16)).toBeLessThanOrEqual(CLAMP_ENDPOINT_TOLERANCE_PX);
    expect(Math.abs(errors.atMax - 32)).toBeLessThanOrEqual(CLAMP_ENDPOINT_TOLERANCE_PX);

    // The vw term is root-size independent.
    expect(generateFluidClamp(16, 32, 360, 1440, { rootFontPx: 10 })).toContain("1.4815vw");
  });

  it("REGRESSION: rejects equal and reversed viewport bounds", () => {
    expect(() => generateFluidClamp(16, 32, 800, 800)).toThrow(RangeError);
    expect(() => generateFluidClamp(16, 32, 1440, 360)).toThrow(RangeError);
    expect(() => fluidClampMetrics(16, 32, 800, 800)).toThrow(/strictly greater/);
  });

  it("rejects zero/negative viewport widths", () => {
    expect(() => generateFluidClamp(16, 32, 0, 1440)).toThrow(RangeError);
    expect(() => generateFluidClamp(16, 32, -360, 1440)).toThrow(RangeError);
    expect(() => generateFluidClamp(16, 32, 360, 0)).toThrow(RangeError);
  });

  it("rejects non-finite inputs", () => {
    expect(() => generateFluidClamp(NaN, 32, 360, 1440)).toThrow(RangeError);
    expect(() => generateFluidClamp(16, Infinity, 360, 1440)).toThrow(RangeError);
    expect(() => generateFluidClamp(16, 32, NaN, 1440)).toThrow(RangeError);
    expect(() => generateFluidClamp(16, 32, 360, Infinity)).toThrow(RangeError);
    expect(() => generateFluidClamp(16, 32, 360, 1440, { rootFontPx: NaN })).toThrow(RangeError);
  });

  it("rejects zero/negative sizes and reversed size bounds", () => {
    expect(() => generateFluidClamp(0, 32, 360, 1440)).toThrow(RangeError);
    expect(() => generateFluidClamp(-16, 32, 360, 1440)).toThrow(RangeError);
    expect(() => generateFluidClamp(32, 16, 360, 1440)).toThrow(RangeError);
    expect(() => generateFluidClamp(16, 32, 360, 1440, { rootFontPx: 0 })).toThrow(RangeError);
    expect(() => generateFluidClamp(16, 32, 360, 1440, { rootFontPx: -16 })).toThrow(RangeError);
  });

  it("rejects unparseable clamp expressions in the endpoint verifier", () => {
    expect(() => fluidClampErrorPx("not-a-clamp", 360, 1440)).toThrow(RangeError);
  });
});

describe("Geometric typography scale", () => {
  it("computes size(n) = base * ratio^n", () => {
    const scale = generateGeometricTypography({ basePx: 16, ratio: 1.25, stepRange: [-1, 3] });
    expect(scale.steps).toHaveLength(5);
    expect(scale.steps.find((s) => s.n === -1)!.minPx).toBeCloseTo(12.8, 3);
    expect(scale.steps.find((s) => s.n === 0)!.minPx).toBeCloseTo(16, 3);
    expect(scale.steps.find((s) => s.n === 3)!.minPx).toBeCloseTo(31.25, 3);
    expect(scale.cssVariables).toContain("size(n) = 16px * 1.25^n");
  });

  it("REGRESSION: supports a custom ratio of 1.5", () => {
    const scale = generateGeometricTypography({ basePx: 16, ratio: 1.5, stepRange: [-1, 3] });
    const byIndex = Object.fromEntries(scale.steps.map((s) => [s.n, s.minPx]));
    expect(byIndex[-1]).toBeCloseTo(16 / 1.5, 3);
    expect(byIndex[0]).toBeCloseTo(16, 3);
    expect(byIndex[1]).toBeCloseTo(24, 3);
    expect(byIndex[2]).toBeCloseTo(36, 3);
    expect(byIndex[3]).toBeCloseTo(54, 3);
  });

  it("rejects zero/negative ratio and base", () => {
    expect(() => generateGeometricTypography({ ratio: 0 })).toThrow(RangeError);
    expect(() => generateGeometricTypography({ ratio: -1.25 })).toThrow(RangeError);
    expect(() => generateGeometricTypography({ basePx: 0 })).toThrow(RangeError);
    expect(() => generateGeometricTypography({ basePx: -16 })).toThrow(RangeError);
    expect(() => generateGeometricTypography({ ratio: NaN })).toThrow(RangeError);
    expect(() => generateGeometricTypography({ stepRange: [3, 1] })).toThrow(RangeError);
    expect(() => generateGeometricTypography({ stepRange: [1.5, 3] })).toThrow(RangeError);
    expect(() => generateGeometricTypography({ stepRange: [-10, 30] })).toThrow(RangeError);
  });

  it("never produces NaN or Infinity in generated CSS", () => {
    const scale = generateGeometricTypography({ basePx: 10, ratio: 1.2, stepRange: [-2, 6] });
    expect(scale.cssVariables).not.toMatch(/NaN|Infinity/);
    for (const step of scale.steps) {
      expect(step.clampCss).not.toMatch(/NaN|Infinity/);
      expect(Number.isFinite(step.minPx)).toBe(true);
      expect(Number.isFinite(step.maxPx)).toBe(true);
    }
  });

  it("honours custom names, viewport bounds and root font size", () => {
    const scale = generateGeometricTypography({
      basePx: 20,
      ratio: 1.25,
      stepRange: [0, 1],
      names: ["body", "lead"],
      minViewportPx: 400,
      maxViewportPx: 1600,
      rootFontPx: 20
    });
    expect(scale.steps.map((s) => s.name)).toEqual(["body", "lead"]);
    expect(scale.steps[0]!.clampCss).toContain("1.00000rem"); // 20px / 20px root
    const errors = fluidClampErrorPx(scale.steps[0]!.clampCss, 400, 1600, 20);
    expect(Math.abs(errors.atMin - 20)).toBeLessThanOrEqual(CLAMP_ENDPOINT_TOLERANCE_PX);
  });
});

describe("Typography system", () => {
  it("generates the editorial optical scale with fluid clamps", () => {
    const system = generateTypographySystem("modern-editorial");
    expect(system.scaleName).toBe("modern-editorial");
    expect(system.steps.display.clampCss).toContain("clamp(");
    expect(system.steps.display.clampCss).not.toMatch(/NaN|Infinity/);
    expect(system.steps.h1.lineHeight).toBeLessThanOrEqual(1.2);
    expect(system.steps.body.lineHeight).toBeGreaterThanOrEqual(1.5);
    expect(system.cssVariables).toContain("--ink-font-display");
    expect(system.cssVariables).toContain("--ink-text-display");
    expect(system.fluid).toEqual({ minViewportPx: 360, maxViewportPx: 1440, rootFontPx: 16 });
    expect(system.geometric).toBeUndefined();
  });

  it("exposes typography base, ratio, step range and fluid endpoints", () => {
    const system = generateTypographySystem(
      "modern-editorial",
      { minVw: 400, maxVw: 1600, rootFontPx: 12 },
      { geometric: { basePx: 18, ratio: 1.25, stepRange: [-1, 4] } }
    );
    expect(system.geometric).toBeDefined();
    expect(system.geometric!.basePx).toBe(18);
    expect(system.geometric!.ratio).toBe(1.25);
    expect(system.geometric!.steps).toHaveLength(6);
    expect(system.fluid.rootFontPx).toBe(12);
    expect(system.steps.display.clampCss).toContain("rem");
    expect(system.steps.display.clampCss).not.toMatch(/NaN|Infinity/);
    const errors = fluidClampErrorPx(system.steps.display.clampCss, 400, 1600, 12);
    expect(Math.abs(errors.atMin - 38)).toBeLessThanOrEqual(CLAMP_ENDPOINT_TOLERANCE_PX);
    expect(Math.abs(errors.atMax - 72)).toBeLessThanOrEqual(CLAMP_ENDPOINT_TOLERANCE_PX);
  });

  it("fails fast on invalid viewports", () => {
    expect(() => generateTypographySystem("modern-editorial", { minVw: 800, maxVw: 800 })).toThrow(
      RangeError
    );
    expect(() => generateTypographySystem("modern-editorial", { minVw: 1440, maxVw: 360 })).toThrow(
      RangeError
    );
  });

  it("supports alternate font stacks", () => {
    expect(generateTypographySystem("editorial-serif").fontFamilies.display).toContain("Playfair");
    expect(generateTypographySystem("brutalist").fontFamilies.body).toContain("Space Mono");
  });
});