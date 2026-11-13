/**
 * Fluid Spacing Scale using modular ratios + CSS clamp()
 * ======================================================================
 * - size(n) = basePx * ratio^n, with configurable step names and ranges.
 * - The nine-step t-shirt preset (3xs..3xl, n = -3..5) remains the default.
 * - Fluid scaling factor is configurable (default 0.85 of the step value)
 *   instead of being hardcoded, and the root font size is configurable.
 *
 * Validation policy (documented, enforced):
 *   - basePx must be a finite number > 0
 *   - ratio must be a finite number >= 1 so the scale is monotonically
 *     increasing; ratios below 1 are rejected (a "coherent hierarchy"
 *     requirement) unless `allowDecreasingRatio` is explicitly set
 *   - minVw > 0 and maxVw > minVw when fluid
 *   - fluidMinFactor must lie in (0, 1]
 */

import {
  FluidClampOptions,
  generateFluidClamp
} from "./typography-generator.js";

export const SPACING_RATIOS = {
  minorSecond: 1.067,
  majorSecond: 1.125,
  minorThird: 1.2,
  majorThird: 1.25,
  perfectFourth: 1.333,
  golden: 1.618
} as const;

export type SpacingRatioName = keyof typeof SPACING_RATIOS;

export type SpacingName =
  | "3xs"
  | "2xs"
  | "xs"
  | "sm"
  | "md"
  | "lg"
  | "xl"
  | "2xl"
  | "3xl";

const SPACING_STEPS: Record<SpacingName, number> = {
  "3xs": -3,
  "2xs": -2,
  xs: -1,
  sm: 0,
  md: 1,
  lg: 2,
  xl: 3,
  "2xl": 4,
  "3xl": 5
};

export const SPACING_ORDER: readonly SpacingName[] = [
  "3xs",
  "2xs",
  "xs",
  "sm",
  "md",
  "lg",
  "xl",
  "2xl",
  "3xl"
] as const;

export interface SpacingScaleOptions {
  minVw?: number;
  maxVw?: number;
  fluid?: boolean;
  /** Lower fluid bound as a fraction of the step value (default 0.85). */
  fluidMinFactor?: number;
  /** Root font size for rem conversion (default 16). */
  rootFontPx?: number;
  /**
   * Custom step definitions. Either an explicit list of { name, n } pairs or
   * a step count. When omitted, the nine-step preset is used.
   */
  steps?: Array<{ name: string; n: number }>;
  /** Number of steps centred on the base size (alternative to `steps`). */
  stepCount?: number;
  /** Allow ratios below 1 (produces a decreasing scale; off by default). */
  allowDecreasingRatio?: boolean;
}

export interface SpacingToken {
  px: number;
  rem: string;
  clamp?: string;
  /** Lower fluid bound used for the clamp (px). */
  fluidMinPx?: number;
  /** Step index n used in size(n) = basePx * ratio^n. */
  n?: number;
}

export type SpacingScale = Record<string, SpacingToken>;

export function spacingStep(basePx: number, ratio: number, n: number): number {
  assertPositive("basePx", basePx);
  assertPositive("ratio", ratio);
  if (!Number.isFinite(n)) {
    throw new RangeError(`Spacing step index n must be finite (received ${n}).`);
  }
  const value = basePx * Math.pow(ratio, n);
  if (!Number.isFinite(value)) {
    throw new RangeError(
      `Spacing step basePx * ratio^n overflowed (basePx=${basePx}, ratio=${ratio}, n=${n}).`
    );
  }
  return Math.round(value * 100) / 100;
}

function assertPositive(name: string, value: number): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a finite number > 0 (received ${String(value)}).`);
  }
}

function resolveSteps(options: SpacingScaleOptions): Array<{ name: string; n: number }> {
  if (options.steps) {
    if (!Array.isArray(options.steps) || options.steps.length < 2) {
      throw new RangeError("steps must contain at least 2 entries.");
    }
    for (const step of options.steps) {
      if (!step.name || typeof step.name !== "string") {
        throw new RangeError("Each spacing step requires a non-empty name.");
      }
      if (!Number.isFinite(step.n)) {
        throw new RangeError(`Spacing step '${step.name}' has a non-finite index.`);
      }
    }
    return options.steps;
  }
  if (options.stepCount !== undefined) {
    if (!Number.isInteger(options.stepCount) || options.stepCount < 2 || options.stepCount > 24) {
      throw new RangeError(
        `stepCount must be an integer between 2 and 24 (received ${options.stepCount}).`
      );
    }
    const half = Math.floor(options.stepCount / 2);
    return Array.from({ length: options.stepCount }, (_, i) => ({
      name: `step${i}`,
      n: i - half
    }));
  }
  return SPACING_ORDER.map((name) => ({ name, n: SPACING_STEPS[name] }));
}

export function generateSpacingScale(
  basePx = 16,
  ratio = 1.25,
  opts?: SpacingScaleOptions
): SpacingScale {
  assertPositive("basePx", basePx);
  if (!Number.isFinite(ratio) || ratio <= 0) {
    throw new RangeError(`ratio must be a finite number > 0 (received ${ratio}).`);
  }
  if (ratio < 1 && opts?.allowDecreasingRatio !== true) {
    throw new RangeError(
      `ratio must be >= 1 for a monotonically increasing spacing scale (received ${ratio}). Set allowDecreasingRatio to opt into a decreasing scale.`
    );
  }

  const minVw = opts?.minVw ?? 360;
  const maxVw = opts?.maxVw ?? 1440;
  const fluid = opts?.fluid ?? false;
  const fluidMinFactor = opts?.fluidMinFactor ?? 0.85;
  const rootFontPx = opts?.rootFontPx ?? 16;
  assertPositive("rootFontPx", rootFontPx);
  if (!Number.isFinite(fluidMinFactor) || fluidMinFactor <= 0 || fluidMinFactor > 1) {
    throw new RangeError(
      `fluidMinFactor must be a finite number within (0, 1] (received ${fluidMinFactor}).`
    );
  }

  if (fluid) {
    assertPositive("minVw", minVw);
    assertPositive("maxVw", maxVw);
    if (maxVw <= minVw) {
      throw new RangeError(
        `maxVw (${maxVw}) must be strictly greater than minVw (${minVw}); equal or reversed bounds produce an infinite slope.`
      );
    }
  }

  const definitions = resolveSteps(opts ?? {});
  const clampOptions: FluidClampOptions = { rootFontPx };
  const scale: SpacingScale = {};

  for (const definition of definitions) {
    const px = spacingStep(basePx, ratio, definition.n);
    if (px <= 0) {
      throw new RangeError(
        `Spacing step '${definition.name}' resolved to a non-positive size (${px}px).`
      );
    }
    const token: SpacingToken = {
      px,
      rem: `${(px / rootFontPx).toFixed(3)}rem`,
      n: definition.n
    };
    if (fluid) {
      const fluidMinPx = round2(px * fluidMinFactor);
      token.fluidMinPx = fluidMinPx;
      token.clamp = generateFluidClamp(fluidMinPx, px, minVw, maxVw, clampOptions);
    }
    scale[definition.name] = token;
  }

  return scale;
}

function round2(value: number): number {
  return Number(value.toFixed(4));
}

/** Emit a :root CSS block for a spacing scale. */
export function generateSpacingCss(scale: SpacingScale): string {
  const names = Object.keys(scale);
  if (names.length === 0) {
    throw new RangeError("Cannot generate CSS for an empty spacing scale.");
  }
  const lines = names.map((name) => {
    const token = scale[name] as SpacingToken;
    const value = token.clamp ?? token.rem;
    return `  --ink-space-${name}: ${value};`;
  });
  return `:root {\n${lines.join("\n")}\n}`;
}