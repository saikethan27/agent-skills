/**
 * Fluid Mathematical Typography Generator using CSS clamp()
 * ======================================================================
 * Formula (unchanged, exact):
 *   slope     = (maxSize - minSize) / (maxViewport - minViewport)
 *   intercept = minSize - minViewport * slope
 *   css       = clamp(minSize/root rem, intercept/root rem + slope*100 vw, maxSize/root rem)
 *
 * `root` is the configurable root font size (default 16px, no longer assumed).
 *
 * Validation policy (documented, enforced):
 *   - all sizes, viewports and root font size must be finite numbers
 *   - viewport widths must be > 0 and maxViewportPx > minViewportPx
 *   - minSizePx and maxSizePx must be > 0 with minSizePx <= maxSizePx
 *   - rootFontPx must be > 0
 *   Invalid input throws a RangeError instead of emitting `NaNrem`/`Infinityvw`.
 */

export interface FluidTypeStep {
  name: string;
  minPx: number;
  maxPx: number;
  clampCss: string;
  lineHeight: number;
  letterSpacing: string;
}

export interface TypographySteps {
  display: FluidTypeStep;
  h1: FluidTypeStep;
  h2: FluidTypeStep;
  h3: FluidTypeStep;
  bodyLarge: FluidTypeStep;
  body: FluidTypeStep;
  caption: FluidTypeStep;
}

export interface GeometricTypeStep {
  name: string;
  /** Step index n in size(n) = base * ratio^n. */
  n: number;
  minPx: number;
  maxPx: number;
  clampCss: string;
  lineHeight: number;
  letterSpacing: string;
}

export interface TypographyScale {
  scaleName: string;
  fontFamilies: {
    display: string;
    body: string;
    mono: string;
  };
  steps: TypographySteps;
  cssVariables: string;
  /** Optional geometric (ratio-based) scale: size(n) = base * ratio^n. */
  geometric?: {
    basePx: number;
    ratio: number;
    steps: GeometricTypeStep[];
    cssVariables: string;
  };
  /** Fluid clamp inputs used for every step. */
  fluid: { minViewportPx: number; maxViewportPx: number; rootFontPx: number };
}

export interface FluidViewportOptions {
  minVw?: number;
  maxVw?: number;
  /** Root font size used for rem conversion (default 16). */
  rootFontPx?: number;
}

export interface GeometricTypographyOptions {
  basePx?: number;
  ratio?: number;
  /** Step indices to generate (default -1..4). */
  stepRange?: [number, number];
  /** Names per step index (default t-shirt sizes derived from the index). */
  names?: string[];
  minViewportPx?: number;
  maxViewportPx?: number;
  rootFontPx?: number;
}

/** Default rem/vw serialization precision and the resulting endpoint accuracy. */
export const CLAMP_PRECISION = { rem: 5, vw: 4 } as const;
/**
 * Documented endpoint tolerance: with the default precision the serialized
 * clamp reproduces the intended size at both viewport endpoints to within
 * 0.01 CSS px (verified by `fluidClampErrorPx`).
 */
export const CLAMP_ENDPOINT_TOLERANCE_PX = 0.01;

export interface FluidClampOptions {
  rootFontPx?: number;
  remPrecision?: number;
  vwPrecision?: number;
}

export interface FluidClampMetrics {
  slope: number;
  intercept: number;
  minPx: number;
  maxPx: number;
  minViewportPx: number;
  maxViewportPx: number;
  rootFontPx: number;
  /** Exact size the clamp yields at the min viewport. */
  valueAtMinViewportPx: number;
  /** Exact size the clamp yields at the max viewport. */
  valueAtMaxViewportPx: number;
}

function assertFinitePositive(name: string, value: number, { allowZero = false } = {}): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new RangeError(`${name} must be a finite number (received ${String(value)}).`);
  }
  if (value < 0 || (value === 0 && !allowZero)) {
    throw new RangeError(`${name} must be ${allowZero ? ">= 0" : "> 0"} (received ${value}).`);
  }
}

export function fluidClampMetrics(
  minPx: number,
  maxPx: number,
  minViewportPx = 360,
  maxViewportPx = 1440,
  options: FluidClampOptions = {}
): FluidClampMetrics {
  assertFinitePositive("minSizePx", minPx);
  assertFinitePositive("maxSizePx", maxPx);
  if (maxPx < minPx) {
    throw new RangeError(`maxSizePx (${maxPx}) must be >= minSizePx (${minPx}).`);
  }
  assertFinitePositive("minViewportPx", minViewportPx);
  assertFinitePositive("maxViewportPx", maxViewportPx);
  if (maxViewportPx <= minViewportPx) {
    throw new RangeError(
      `maxViewportPx (${maxViewportPx}) must be strictly greater than minViewportPx (${minViewportPx}); equal or reversed bounds produce an infinite slope.`
    );
  }
  const rootFontPx = options.rootFontPx ?? 16;
  assertFinitePositive("rootFontPx", rootFontPx);

  const slope = (maxPx - minPx) / (maxViewportPx - minViewportPx);
  const intercept = minPx - minViewportPx * slope;

  return {
    slope,
    intercept,
    minPx,
    maxPx,
    minViewportPx,
    maxViewportPx,
    rootFontPx,
    valueAtMinViewportPx: intercept + slope * minViewportPx,
    valueAtMaxViewportPx: intercept + slope * maxViewportPx
  };
}

/**
 * Generate `clamp(min/root rem, intercept/root rem + slope*100 vw, max/root rem)`.
 * Throws RangeError for non-finite numbers, non-positive sizes/viewports,
 * reversed or equal viewport bounds, and non-positive root font size.
 */
export function generateFluidClamp(
  minPx: number,
  maxPx: number,
  minViewportPx = 360,
  maxViewportPx = 1440,
  options: FluidClampOptions = {}
): string {
  const metrics = fluidClampMetrics(minPx, maxPx, minViewportPx, maxViewportPx, options);
  const remPrecision = options.remPrecision ?? CLAMP_PRECISION.rem;
  const vwPrecision = options.vwPrecision ?? CLAMP_PRECISION.vw;

  const minRem = (metrics.minPx / metrics.rootFontPx).toFixed(remPrecision);
  const maxRem = (metrics.maxPx / metrics.rootFontPx).toFixed(remPrecision);
  const interceptRem = (metrics.intercept / metrics.rootFontPx).toFixed(remPrecision);
  const slopeVw = (metrics.slope * 100).toFixed(vwPrecision);

  return `clamp(${minRem}rem, ${interceptRem}rem + ${slopeVw}vw, ${maxRem}rem)`;
}

/**
 * Endpoint error (in CSS px) of a serialized clamp string, used to verify the
 * documented rounding accuracy.
 */
export function fluidClampErrorPx(
  clampCss: string,
  minViewportPx: number,
  maxViewportPx: number,
  rootFontPx = 16
): { atMin: number; atMax: number } {
  const match = clampCss.match(
    /^clamp\(([-\d.]+)rem,\s*([-\d.]+)rem\s*\+\s*([-\d.]+)vw,\s*([-\d.]+)rem\)$/
  );
  if (!match) {
    throw new RangeError(`Unparseable clamp expression: "${clampCss}".`);
  }
  const minRem = parseFloat(match[1]!);
  const interceptRem = parseFloat(match[2]!);
  const slopeVw = parseFloat(match[3]!);
  const evaluate = (viewportPx: number): number => {
    // clamp(min, intercept + vw, max) in px, with the vw term relative to 1rem = rootFontPx
    const preferredRem = interceptRem + (slopeVw * viewportPx) / 100 / rootFontPx;
    const clampedRem = Math.min(Math.max(preferredRem, minRem), parseFloat(match[4]!));
    return clampedRem * rootFontPx;
  };
  return {
    atMin: evaluate(minViewportPx),
    atMax: evaluate(maxViewportPx)
  };
}

const TYPOGRAPHY_ENDPOINTS: Array<{
  key: keyof TypographySteps;
  minPx: number;
  maxPx: number;
  lineHeight: number;
  letterSpacing: string;
}> = [
  { key: "display", minPx: 38, maxPx: 72, lineHeight: 1.08, letterSpacing: "-0.035em" },
  { key: "h1", minPx: 30, maxPx: 52, lineHeight: 1.15, letterSpacing: "-0.025em" },
  { key: "h2", minPx: 24, maxPx: 38, lineHeight: 1.2, letterSpacing: "-0.02em" },
  { key: "h3", minPx: 20, maxPx: 26, lineHeight: 1.3, letterSpacing: "-0.01em" },
  { key: "bodyLarge", minPx: 17, maxPx: 20, lineHeight: 1.6, letterSpacing: "0.005em" },
  { key: "body", minPx: 15, maxPx: 16.5, lineHeight: 1.65, letterSpacing: "0.01em" },
  { key: "caption", minPx: 12.5, maxPx: 13.5, lineHeight: 1.5, letterSpacing: "0.025em" }
];

export interface TypographySystemOptions extends FluidViewportOptions {
  /** Also emit a ratio-based geometric scale (size(n) = base * ratio^n). */
  geometric?: GeometricTypographyOptions | false;
  /** Viewport bounds for the fluid clamps (alias of viewport.minVw/maxVw). */
  minViewportPx?: number;
  maxViewportPx?: number;
}

const GEOMETRIC_DEFAULT_NAMES = ["2xs", "xs", "sm", "base", "lg", "xl", "2xl", "3xl"];

/**
 * Generate the editorial fluid typography scale. Optional `geometric` adds a
 * ratio-based scale (size(n) = base * ratio^n) with configurable base, ratio,
 * step range, viewport endpoints and root font size.
 */
export function generateTypographySystem(
  editorialStyle = "modern-editorial",
  viewport?: FluidViewportOptions,
  options: TypographySystemOptions = {}
): TypographyScale {
  const minVw = viewport?.minVw ?? options.minViewportPx ?? 360;
  const maxVw = viewport?.maxVw ?? options.maxViewportPx ?? 1440;
  const rootFontPx = options.rootFontPx ?? viewport?.rootFontPx ?? 16;
  const clampOptions: FluidClampOptions = { rootFontPx };

  const fontFamilies = {
    display: "'Outfit', 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif",
    body: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    mono: "'JetBrains Mono', 'Fira Code', monospace"
  };

  if (editorialStyle === "editorial-serif") {
    fontFamilies.display = "'Playfair Display', 'Newsreader', Georgia, serif";
  } else if (editorialStyle === "brutalist") {
    fontFamilies.display = "'Space Grotesk', 'Syne', sans-serif";
    fontFamilies.body = "'Space Mono', monospace";
  }

  // Validate once up-front so invalid viewports fail fast.
  fluidClampMetrics(38, 72, minVw, maxVw, clampOptions);

  const steps: TypographySteps = {
    display: makeStep("display"),
    h1: makeStep("h1"),
    h2: makeStep("h2"),
    h3: makeStep("h3"),
    bodyLarge: makeStep("bodyLarge"),
    body: makeStep("body"),
    caption: makeStep("caption")
  };

  function makeStep(key: keyof TypographySteps): FluidTypeStep {
    const endpoint = TYPOGRAPHY_ENDPOINTS.find((e) => e.key === key)!;
    return {
      name: String(key),
      minPx: endpoint.minPx,
      maxPx: endpoint.maxPx,
      clampCss: generateFluidClamp(endpoint.minPx, endpoint.maxPx, minVw, maxVw, clampOptions),
      lineHeight: endpoint.lineHeight,
      letterSpacing: endpoint.letterSpacing
    };
  }

  const cssVariables = `
:root {
  /* Font Family Stacks */
  --ink-font-display: ${fontFamilies.display};
  --ink-font-body: ${fontFamilies.body};
  --ink-font-mono: ${fontFamilies.mono};

  /* Fluid Typography Steps */
  --ink-text-display: ${steps.display.clampCss};
  --ink-text-h1: ${steps.h1.clampCss};
  --ink-text-h2: ${steps.h2.clampCss};
  --ink-text-h3: ${steps.h3.clampCss};
  --ink-text-body-lg: ${steps.bodyLarge.clampCss};
  --ink-text-body: ${steps.body.clampCss};
  --ink-text-caption: ${steps.caption.clampCss};

  /* Line Heights */
  --ink-leading-display: ${steps.display.lineHeight};
  --ink-leading-heading: ${steps.h1.lineHeight};
  --ink-leading-body: ${steps.body.lineHeight};
}
`.trim();

  const scale: TypographyScale = {
    scaleName: editorialStyle,
    fontFamilies,
    steps,
    cssVariables,
    fluid: { minViewportPx: minVw, maxViewportPx: maxVw, rootFontPx }
  };

  if (options.geometric) {
    scale.geometric = generateGeometricTypography({
      ...options.geometric,
      minViewportPx: options.geometric.minViewportPx ?? minVw,
      maxViewportPx: options.geometric.maxViewportPx ?? maxVw,
      rootFontPx: options.geometric.rootFontPx ?? rootFontPx
    });
  }

  return scale;
}

/**
 * Geometric typography scale: size(n) = basePx * ratio^n, emitted as fluid
 * clamps between minViewportPx and maxViewportPx.
 */
export function generateGeometricTypography(options: GeometricTypographyOptions = {}): {
  basePx: number;
  ratio: number;
  steps: GeometricTypeStep[];
  cssVariables: string;
} {
  const basePx = options.basePx ?? 16;
  const ratio = options.ratio ?? 1.25;
  assertFinitePositive("basePx", basePx);
  if (!Number.isFinite(ratio) || ratio <= 0) {
    throw new RangeError(`ratio must be a finite number > 0 (received ${ratio}).`);
  }
  const [from, to] = options.stepRange ?? [-1, 5];
  if (!Number.isInteger(from) || !Number.isInteger(to) || to < from) {
    throw new RangeError(
      `stepRange must be two integers with max >= min (received [${from}, ${to}]).`
    );
  }
  if (to - from + 1 > 24) {
    throw new RangeError("stepRange may contain at most 24 steps.");
  }
  const minViewportPx = options.minViewportPx ?? 360;
  const maxViewportPx = options.maxViewportPx ?? 1440;
  const rootFontPx = options.rootFontPx ?? 16;
  const names = options.names;

  const steps: GeometricTypeStep[] = [];
  for (let n = from; n <= to; n += 1) {
    const value = basePx * Math.pow(ratio, n);
    assertFinitePositive(`size(${n})`, value);
    const defaultName = GEOMETRIC_DEFAULT_NAMES[n + 2] ?? `step${n}`;
    steps.push({
      name: names?.[n - from] ?? defaultName,
      n,
      minPx: round(value),
      maxPx: round(value * 1.25),
      clampCss: generateFluidClamp(value, value * 1.25, minViewportPx, maxViewportPx, { rootFontPx }),
      lineHeight: n <= -2 ? 1.25 : n === 0 ? 1.55 : 1.15,
      letterSpacing: n >= 3 ? "-0.02em" : "0em"
    });
  }

  const cssVariables = `:root {
  /* Geometric typography: size(n) = ${basePx}px * ${ratio}^n */
${steps.map((s) => `  --ink-text-${s.name}: ${s.clampCss};`).join("\n")}
}`.trim();

  return { basePx, ratio, steps, cssVariables };
}

function round(value: number): number {
  return Number(value.toFixed(4));
}