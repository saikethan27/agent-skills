/**
 * Perceptual Gradient Interpolator (OKLCH / OKLab)
 * ======================================================================
 * - Backward compatible two-endpoint API (`interpolateStops`, `generateGradient`)
 *   plus an authored-stop API with explicit positions, alpha, configurable
 *   interpolation space and documented hue paths.
 * - Every sampled stop is gamut mapped into the target gamut with the CSS
 *   Color 4 binary-search local-MINDE algorithm, and is exported twice: once
 *   in the target gamut and once as an independent sRGB fallback (never P3
 *   channels re-encoded as hex).
 * - Gamut validation is explicitly *sampled*: passing samples do not prove the
 *   continuous gradient is in gamut, and the returned policy says so.
 */

import {
  GamutTarget,
  OklchTriple,
  channelsInGamut,
  mapToGamut,
  normalizeHue,
  oklchToCssString,
  oklabToOklch,
  oklchToOklab,
  oklabToLinearSrgb,
  linearSrgbToLinearP3,
  roundOklchForCss,
  srgb01ToOklab
} from "./gamut-mapper.js";
import {
  Srgb01,
  SERIALIZED_CHANNEL_EPSILON
} from "./gamut-mapper.js";
import {
  WCAG_THRESHOLDS,
  calculateContrastRatio,
  classifyContrastRatio
} from "./color-math.js";
import { apcaForHexPair, apcaGuidance, parseHexToRgb01 } from "./apca.js";

export { oklchToCssString, mapToGamut };
export type { GamutTarget, OklchTriple };

export interface SrgbTriple {
  r: number;
  g: number;
  b: number;
}

export type InterpolationSpace = "oklch" | "oklab";
export type HuePath = "shorter" | "longer" | "increasing" | "decreasing";

export interface AuthoredStop {
  oklch: OklchTriple;
  /** Explicit stop position in [0, 1]. Defaults to i / (count - 1). */
  position?: number;
  /** Alpha in [0, 1]. Defaults to 1. */
  alpha?: number;
}

export interface GradientStop {
  /** Parametric position along the interpolation (0-1). */
  t: number;
  /** Authored/emitted stop position (0-1). */
  position: number;
  /** Gamut-mapped OKLCH triple. */
  oklch: OklchTriple;
  /** Alpha in [0, 1]. */
  alpha: number;
  /** Independent 8-bit sRGB fallback hex (real sRGB, never P3 channels). */
  hex: string;
  /** Independent sRGB channels (0-1). */
  srgb: SrgbTriple;
  /** Channels in the TARGET gamut (Display P3 channels when target = "p3"). */
  channels: SrgbTriple;
  /** Target-gamut CSS: oklch(...) for sRGB, color(display-p3 ...) for P3. */
  css: string;
  /** sRGB fallback CSS. */
  srgbCss: string;
  /** Backward-compatible alias: true when gamut mapping changed the color. */
  clipped: boolean;
  /** Whether the requested color was already inside the target gamut. */
  inGamut: boolean;
  /** 8-digit hex when alpha < 1. */
  hexWithAlpha: string;
}

export interface GradientGamutReport {
  /** Validation policy name. Always "sampled" (documented limitation). */
  policy: "sampled";
  /** Number of positions checked. */
  samplesChecked: number;
  /** True when every sampled position mapped without chroma reduction. */
  allSamplesInGamut: boolean;
  /** How many sampled positions required chroma reduction. */
  mappedSamples: number;
  /** Largest deltaEOK between requested and mapped sampled colors. */
  maxDeltaEOK: number;
  note: string;
}

export interface GeneratedGradient {
  stops: GradientStop[];
  css: string;
  /** Hex ramp of the sRGB fallbacks (backward compatible). */
  hexes: string[];
  /** Gradient with independently mapped sRGB colors. */
  cssSrgb: string;
  /** Gradient with independently mapped Display P3 colors. */
  cssP3: string;
  target: GamutTarget;
  interpolationSpace: InterpolationSpace;
  huePath: HuePath;
  direction: string;
  gamut: GradientGamutReport;
}

export interface GradientOptions {
  target?: GamutTarget;
  interpolationSpace?: InterpolationSpace;
  huePath?: HuePath;
  direction?: string;
  /**
   * Number of uniform positions used for gamut validation.
   * Default 64; minimum 8. This is a SAMPLED check, not a proof.
   */
  gamutValidationSamples?: number;
}

export const DEFAULT_GAMUT_VALIDATION_SAMPLES = 64;

// ---------------------------------------------------------------------------
// Hue handling
// ---------------------------------------------------------------------------

function normalizeHueDeg(h: number): number {
  return normalizeHue(h);
}

/**
 * Signed hue delta from h1 to h2 in degrees for the documented hue paths.
 *   shorter    : arc in (-180, 180]
 *   longer     : arc in [180, 540)
 *   increasing : positive delta in [0, 360)
 *   decreasing : negative delta in (-360, 0]
 */
export function hueDeltaFor(h1: number, h2: number, path: HuePath = "shorter"): number {
  const n1 = normalizeHueDeg(h1);
  const n2 = normalizeHueDeg(h2);
  const forward = ((n2 - n1) % 360 + 360) % 360;
  switch (path) {
    case "longer":
      // The longer arc is the complement of the forward arc: subtract a full
      // turn when the forward arc is the shorter one (never add one).
      return forward <= 180 ? forward - 360 : forward;
    case "increasing":
      return forward;
    case "decreasing":
      return forward === 0 ? 0 : forward - 360;
    case "shorter":
    default:
      return ((n2 - n1 + 540) % 360) - 180;
  }
}

/** Shortest signed hue delta from h1 to h2 in degrees, in (-180, 180]. */
export function shortestHueDelta(h1: number, h2: number): number {
  return hueDeltaFor(h1, h2, "shorter");
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function assertFiniteTriple(point: OklchTriple, name: string): void {
  if (
    !point ||
    !Number.isFinite(point.l) ||
    !Number.isFinite(point.c) ||
    !Number.isFinite(point.h)
  ) {
    throw new RangeError(`${name} must have finite l, c and h components.`);
  }
  if (point.l < 0 || point.l > 1) {
    throw new RangeError(`${name}.l must be within [0, 1] (received ${point.l}).`);
  }
  if (point.c < 0) {
    throw new RangeError(`${name}.c must be >= 0 (received ${point.c}).`);
  }
}

function assertIntegerSteps(steps: number): void {
  if (!Number.isFinite(steps) || !Number.isInteger(steps)) {
    throw new RangeError(
      `steps must be a finite integer (fractional sample counts are rejected, received ${steps}).`
    );
  }
  if (steps < 2) {
    throw new RangeError("steps must be >= 2.");
  }
}

function validateAuthoredStops(stops: AuthoredStop[]): Array<{ oklch: OklchTriple; position: number; alpha: number }> {
  if (!Array.isArray(stops) || stops.length < 2) {
    throw new RangeError("An authored gradient needs at least 2 stops.");
  }
  const resolved = stops.map((stop, index) => {
    assertFiniteTriple(stop.oklch, `stops[${index}].oklch`);
    const position = stop.position ?? index / (stops.length - 1);
    if (!Number.isFinite(position) || position < 0 || position > 1) {
      throw new RangeError(
        `stops[${index}].position must be a finite number within [0, 1] (received ${position}).`
      );
    }
    const alpha = stop.alpha ?? 1;
    if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) {
      throw new RangeError(
        `stops[${index}].alpha must be a finite number within [0, 1] (received ${alpha}).`
      );
    }
    return { oklch: { l: stop.oklch.l, c: stop.oklch.c, h: normalizeHueDeg(stop.oklch.h) }, position, alpha };
  });

  for (let i = 1; i < resolved.length; i += 1) {
    if (resolved[i]!.position < resolved[i - 1]!.position) {
      throw new RangeError(
        `Stop positions must be non-decreasing (stops[${i - 1}] = ${resolved[i - 1]!.position}, stops[${i}] = ${resolved[i]!.position}).`
      );
    }
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// Interpolation
// ---------------------------------------------------------------------------

interface ResolvedStop {
  oklch: OklchTriple;
  position: number;
  alpha: number;
  lab: { L: number; a: number; b: number };
}

function toResolved(stops: AuthoredStop[]): ResolvedStop[] {
  return validateAuthoredStops(stops).map((stop) => ({
    ...stop,
    lab: oklchToOklab(stop.oklch.l, stop.oklch.c, stop.oklch.h)
  }));
}

/** Locate the segment containing `position` and the local interpolation factor. */
function segmentAt(stops: ResolvedStop[], position: number): { index: number; local: number } {
  const first = stops[0]!;
  const last = stops[stops.length - 1]!;
  if (position <= first.position) return { index: 0, local: 0 };
  if (position >= last.position) return { index: stops.length - 2, local: 1 };

  for (let i = 0; i < stops.length - 1; i += 1) {
    const a = stops[i]!;
    const b = stops[i + 1]!;
    if (position >= a.position && position <= b.position) {
      const span = b.position - a.position;
      return { index: i, local: span <= 0 ? 0 : (position - a.position) / span };
    }
  }
  return { index: stops.length - 2, local: 1 };
}

/**
 * Evaluate the gradient at an arbitrary position.
 *
 * Transparency uses CSS Color 4 §13.4 premultiplied interpolation, applied in
 * the SELECTED interpolation space:
 *  - rectangular (oklab): L, a and b are premultiplied by alpha;
 *  - cylindrical polar (oklch): the hue angle is NOT premultiplied, while the
 *    other two axes (L and C) are premultiplied and interpolated separately.
 *
 * Interpolating equal-alpha OKLCH colors therefore keeps the polar path: e.g.
 * (L .6, C .1, H 30) -> (L .6, C .1, H 150) still passes through
 * (L .6, C .1, H 90) instead of collapsing toward the achromatic axis.
 */
export function interpolateAt(
  stops: ResolvedStop[],
  position: number,
  space: InterpolationSpace,
  huePath: HuePath
): { oklch: OklchTriple; alpha: number } {
  const { index, local } = segmentAt(stops, position);
  const a = stops[index]!;
  const b = stops[index + 1]!;

  const alpha = a.alpha + (b.alpha - a.alpha) * local;
  const deltaH = hueDeltaFor(a.oklch.h, b.oklch.h, huePath);
  const lerp = (from: number, to: number, av: number, bv: number): number => {
    const pFrom = from * av;
    const pTo = to * bv;
    return pFrom + (pTo - pFrom) * local;
  };

  if (alpha < 1) {
    if (space === "oklch") {
      // Cylindrical polar: hue is interpolated separately, L and C are
      // premultiplied (CSS Color 4 §13.4).
      const pL = lerp(a.oklch.l, b.oklch.l, a.alpha, b.alpha);
      const pC = lerp(a.oklch.c, b.oklch.c, a.alpha, b.alpha);
      const hue = normalizeHueDeg(a.oklch.h + deltaH * local);
      if (alpha <= 0) return { oklch: { l: pL, c: 0, h: hue }, alpha };
      return { oklch: { l: pL / alpha, c: Math.max(0, pC / alpha), h: hue }, alpha };
    }
    // Rectangular orthogonal: all three components are premultiplied.
    const pL = lerp(a.lab.L, b.lab.L, a.alpha, b.alpha);
    const pa = lerp(a.lab.a, b.lab.a, a.alpha, b.alpha);
    const pb = lerp(a.lab.b, b.lab.b, a.alpha, b.alpha);
    if (alpha <= 0) return { oklch: { l: pL, c: 0, h: normalizeHueDeg(a.oklch.h + deltaH * local) }, alpha };
    return { oklch: oklabToOklch({ L: pL / alpha, a: pa / alpha, b: pb / alpha }), alpha };
  }

  if (space === "oklab") {
    const lab = {
      L: a.lab.L + (b.lab.L - a.lab.L) * local,
      a: a.lab.a + (b.lab.a - a.lab.a) * local,
      b: a.lab.b + (b.lab.b - a.lab.b) * local
    };
    return { oklch: oklabToOklch(lab), alpha };
  }

  return {
    oklch: {
      l: a.oklch.l + (b.oklch.l - a.oklch.l) * local,
      c: a.oklch.c + (b.oklch.c - a.oklch.c) * local,
      h: normalizeHueDeg(a.oklch.h + deltaH * local)
    },
    alpha
  };
}

function hexWithAlpha(rgb: Srgb01, alpha: number): string {
  const byte = (u: number): string =>
    Math.round(Math.min(1, Math.max(0, u)) * 255).toString(16).padStart(2, "0");
  const base = `#${byte(rgb.r)}${byte(rgb.g)}${byte(rgb.b)}`;
  if (alpha >= 1) return base;
  return `${base}${byte(alpha)}`;
}

function serializeStop(oklch: OklchTriple, alpha: number, target: GamutTarget): GradientStop {
  // 1. Round to the precision written to CSS, 2. map into the target gamut,
  // 3. re-resolve so the published OKLCH triple, the target channels and the
  // independent sRGB fallback all describe the same color.
  const rounded = roundOklchForCss(oklch.l, oklch.c, oklch.h, target);
  const mapped = mapToGamut(rounded.l, rounded.c, rounded.h, target);
  const exported = mapToGamut(mapped.oklch.l, mapped.oklch.c, mapped.oklch.h, target);
  // Independent sRGB mapping of the same color: never the target's channels.
  const srgbMapped = mapToGamut(mapped.oklch.l, mapped.oklch.c, mapped.oklch.h, "srgb");

  const alphaValue = alpha >= 1 ? "" : ` / ${trimNumber(alpha)}`;
  const targetCss =
    target === "p3"
      ? `color(display-p3 ${exported.channels.r.toFixed(4)} ${exported.channels.g.toFixed(4)} ${exported.channels.b.toFixed(4)}${alphaValue})`
      // Alpha belongs INSIDE the function: oklch(L C H / A)
      : oklchToCssString(exported.oklch.l, exported.oklch.c, exported.oklch.h, alpha);
  const srgbCss = oklchToCssString(
    srgbMapped.oklch.l,
    srgbMapped.oklch.c,
    srgbMapped.oklch.h,
    alpha
  );

  return {
    t: 0,
    position: 0,
    oklch: { l: exported.oklch.l, c: exported.oklch.c, h: exported.oklch.h },
    alpha,
    hex: hexWithAlpha(srgbMapped.srgb, 1),
    hexWithAlpha: hexWithAlpha(srgbMapped.srgb, alpha),
    srgb: { r: srgbMapped.srgb.r, g: srgbMapped.srgb.g, b: srgbMapped.srgb.b },
    channels: { ...exported.channels },
    css: targetCss,
    srgbCss,
    clipped: mapped.mapped || rounded.adjusted,
    inGamut: mapped.inGamut
  };
}

function trimNumber(value: number): string {
  return String(Number(value.toFixed(3)));
}

/** `/ A` suffix for `color(display-p3 ... / A)`; empty when fully opaque. */
function p3AlphaSuffix(alpha: number): string {
  return alpha >= 1 ? "" : ` / ${trimNumber(alpha)}`;
}

/**
 * Build a gradient from authored stops with explicit positions.
 * Throws on invalid positions, ordering, non-finite values or < 2 stops.
 */
export function interpolateAuthoredStops(
  authored: AuthoredStop[],
  options: GradientOptions = {}
): { stops: GradientStop[]; gamut: GradientGamutReport } {
  const target = options.target ?? "srgb";
  const space = options.interpolationSpace ?? "oklch";
  const huePath = options.huePath ?? "shorter";
  const validationSamples = options.gamutValidationSamples ?? DEFAULT_GAMUT_VALIDATION_SAMPLES;
  if (!Number.isInteger(validationSamples) || validationSamples < 8) {
    throw new RangeError(
      `gamutValidationSamples must be an integer >= 8 (received ${validationSamples}).`
    );
  }

  const resolved = toResolved(authored);
  const stops: GradientStop[] = resolved.map((stop) => {
    const serialized = serializeStop(stop.oklch, stop.alpha, target);
    return {
      ...serialized,
      t: stop.position,
      position: stop.position
    };
  });

  // Sampled gamut validation across the whole authored span.
  const first = stops[0]!;
  const last = stops[stops.length - 1]!;
  let mappedSamples = 0;
  let maxDeltaEOK = 0;
  let allInGamut = true;
  for (let i = 0; i < validationSamples; i += 1) {
    const position = first.position + ((last.position - first.position) * i) / (validationSamples - 1);
    const { oklch } = interpolateAt(resolved, position, space, huePath);
    const direct = oklchToSrgbUnclipped(oklch, target);
    if (!channelsInGamut(direct)) allInGamut = false;
    const mapped = mapToGamut(oklch.l, oklch.c, oklch.h, target);
    if (mapped.mapped) mappedSamples += 1;
    if (mapped.deltaEOK > maxDeltaEOK) maxDeltaEOK = mapped.deltaEOK;
  }

  return {
    stops,
    gamut: {
      policy: "sampled",
      samplesChecked: validationSamples,
      allSamplesInGamut: allInGamut,
      mappedSamples,
      maxDeltaEOK: Number(maxDeltaEOK.toFixed(6)),
      note: `Sampled validation at ${validationSamples} uniform positions between the first and last authored stop. Passing samples do not prove every point of the continuous gradient is inside the ${target} gamut; each emitted stop is individually gamut mapped.`
    }
  };
}

function oklchToSrgbUnclipped(oklch: OklchTriple, target: GamutTarget): Srgb01 {
  const linear = oklabToLinearSrgb(oklchToOklab(oklch.l, oklch.c, oklch.h));
  const fitted = target === "p3" ? linearSrgbToLinearP3(linear) : linear;
  const encode = (u: number): number => (u <= 0.0031308 ? 12.92 * u : 1.055 * Math.pow(u, 1 / 2.4) - 0.055);
  return { r: encode(fitted.r), g: encode(fitted.g), b: encode(fitted.b) };
}

// ---------------------------------------------------------------------------
// Backward compatible two-endpoint API
// ---------------------------------------------------------------------------

/**
 * Interpolate `steps` stops between two OKLCH colors.
 *
 * Behavior change (documented): `steps` must be an integer. Fractional counts
 * are rejected instead of being silently floored.
 */
export function interpolateStops(
  from: OklchTriple,
  to: OklchTriple,
  steps: number,
  target: GamutTarget = "srgb"
): GradientStop[] {
  assertIntegerSteps(steps);
  const stops = buildTwoEndpointStops(from, to, steps, target, "oklch", "shorter");
  return stops;
}

function buildTwoEndpointStops(
  from: OklchTriple,
  to: OklchTriple,
  steps: number,
  target: GamutTarget,
  space: InterpolationSpace,
  huePath: HuePath
): GradientStop[] {
  assertFiniteTriple(from, "from");
  assertFiniteTriple(to, "to");
  const resolved = toResolved([
    { oklch: { ...from, h: normalizeHueDeg(from.h) }, position: 0 },
    { oklch: { ...to, h: normalizeHueDeg(to.h) }, position: 1 }
  ]);

  const count = steps;
  const out: GradientStop[] = [];
  for (let i = 0; i < count; i += 1) {
    const t = i / (count - 1);
    const { oklch, alpha } = interpolateAt(resolved, t, space, huePath);
    const serialized = serializeStop(oklch, alpha, target);
    out.push({ ...serialized, t, position: t });
  }
  return out;
}

// ---------------------------------------------------------------------------
// CSS builders
// ---------------------------------------------------------------------------

/**
 * Serialize stops for a `linear-gradient()` body.
 *
 * Positions are emitted when they are NOT the implicit even spacing of the
 * emitted stop list, so authored two-stop positions such as 20%/80% survive
 * serialization (and browser rendering) instead of being widened to 0%/100%.
 */
function stopList(stops: GradientStop[], render: (s: GradientStop) => string): string {
  const implicit = (index: number): number => (stops.length > 1 ? index / (stops.length - 1) : 0);
  const needsPositions = stops.some((s, index) => Math.abs(s.position - implicit(index)) > 1e-9);
  return stops
    .map((s) => {
      const color = render(s);
      if (!needsPositions) return color;
      const percent = (s.position * 100).toFixed(2).replace(/\.?0+$/, "");
      return `${color} ${percent}%`;
    })
    .join(", ");
}

/** CSS `<hue-interpolation-method>` keyword for a hue path (CSS Color 4 §13.5). */
function hueInterpolationKeyword(huePath: HuePath): string {
  return `${huePath} hue`;
}

/**
 * Build a CSS linear-gradient with explicit perceptual interpolation.
 *   `linear-gradient(<direction> in oklch shorter hue, ...)`
 *   `linear-gradient(<direction> in oklab, ...)`
 *
 * The hue interpolation method is always serialized for polar spaces so the
 * browser interpolates along the same hue arc as the computed stop samples.
 */
export function buildGradientCss(
  stops: GradientStop[],
  direction = "to right",
  interpolationSpace: InterpolationSpace = "oklch",
  render: (s: GradientStop) => string = (s) => s.css,
  huePath: HuePath = "shorter"
): string {
  if (stops.length < 2) {
    throw new RangeError("A gradient needs at least 2 stops.");
  }
  const body = stopList(stops, render);
  const space =
    interpolationSpace === "oklch"
      ? `oklch ${hueInterpolationKeyword(huePath)}`
      : "oklab";
  return `linear-gradient(${direction} in ${space}, ${body})`;
}

/**
 * Interpolate stops and build the CSS gradient string in one call.
 * The two-endpoint signature is preserved; the returned object additionally
 * carries sRGB/P3 exports and the sampled gamut report.
 */
export function generateGradient(
  from: OklchTriple,
  to: OklchTriple,
  steps: number,
  target: GamutTarget = "srgb",
  options: Omit<GradientOptions, "target"> = {}
): GeneratedGradient {
  const space = options.interpolationSpace ?? "oklch";
  const huePath = options.huePath ?? "shorter";
  const direction = options.direction ?? "to right";
  assertIntegerSteps(steps);
  const stops = buildTwoEndpointStops(from, to, steps, target, space, huePath);

  const validationSamples = options.gamutValidationSamples ?? DEFAULT_GAMUT_VALIDATION_SAMPLES;
  if (!Number.isInteger(validationSamples) || validationSamples < 8) {
    throw new RangeError(
      `gamutValidationSamples must be an integer >= 8 (received ${validationSamples}).`
    );
  }
  const resolved = toResolved([
    { oklch: { ...from, h: normalizeHueDeg(from.h) }, position: 0 },
    { oklch: { ...to, h: normalizeHueDeg(to.h) }, position: 1 }
  ]);
  let mappedSamples = 0;
  let maxDeltaEOK = 0;
  let allInGamut = true;
  for (let i = 0; i < validationSamples; i += 1) {
    const position = i / (validationSamples - 1);
    const { oklch } = interpolateAt(resolved, position, space, huePath);
    if (!channelsInGamut(oklchToSrgbUnclipped(oklch, target))) allInGamut = false;
    const mapped = mapToGamut(oklch.l, oklch.c, oklch.h, target);
    if (mapped.mapped) mappedSamples += 1;
    if (mapped.deltaEOK > maxDeltaEOK) maxDeltaEOK = mapped.deltaEOK;
  }

  return {
    stops,
    css: buildGradientCss(stops, direction, space, undefined, huePath),
    hexes: stops.map((s) => s.hex),
    cssSrgb: buildGradientCss(
      stops,
      direction,
      space,
      (s) =>
        s.alpha >= 1 ? s.hex : hexWithAlpha({ r: s.srgb.r, g: s.srgb.g, b: s.srgb.b }, s.alpha),
      huePath
    ),
    cssP3: buildGradientCss(
      stops,
      direction,
      space,
      (s) => {
        const p3 = mapToGamut(s.oklch.l, s.oklch.c, s.oklch.h, "p3");
        return `color(display-p3 ${p3.channels.r.toFixed(4)} ${p3.channels.g.toFixed(4)} ${p3.channels.b.toFixed(4)}${p3AlphaSuffix(s.alpha)})`;
      },
      huePath
    ),
    target,
    interpolationSpace: space,
    huePath,
    direction,
    gamut: {
      policy: "sampled",
      samplesChecked: validationSamples,
      allSamplesInGamut: allInGamut,
      mappedSamples,
      maxDeltaEOK: Number(maxDeltaEOK.toFixed(6)),
      note: `Sampled validation at ${validationSamples} uniform positions. Passing samples do not prove every point of the continuous gradient is inside the ${target} gamut; each emitted stop is individually gamut mapped.`
    }
  };
}

/** Build a full gradient result from authored stops. */
export function generateAuthoredGradient(
  authored: AuthoredStop[],
  options: GradientOptions = {}
): GeneratedGradient {
  const target = options.target ?? "srgb";
  const space = options.interpolationSpace ?? "oklch";
  const huePath = options.huePath ?? "shorter";
  const direction = options.direction ?? "to right";
  const { stops, gamut } = interpolateAuthoredStops(authored, options);

  return {
    stops,
    css: buildGradientCss(stops, direction, space, undefined, huePath),
    hexes: stops.map((s) => s.hex),
    cssSrgb: buildGradientCss(
      stops,
      direction,
      space,
      (s) =>
        s.alpha >= 1 ? s.hex : hexWithAlpha({ r: s.srgb.r, g: s.srgb.g, b: s.srgb.b }, s.alpha),
      huePath
    ),
    cssP3: buildGradientCss(
      stops,
      direction,
      space,
      (s) => {
        const p3 = mapToGamut(s.oklch.l, s.oklch.c, s.oklch.h, "p3");
        return `color(display-p3 ${p3.channels.r.toFixed(4)} ${p3.channels.g.toFixed(4)} ${p3.channels.b.toFixed(4)}${p3AlphaSuffix(s.alpha)})`;
      },
      huePath
    ),
    target,
    interpolationSpace: space,
    huePath,
    direction,
    gamut
  };
}

// ---------------------------------------------------------------------------
// Contrast sampling over a gradient
// ---------------------------------------------------------------------------

export interface GradientContrastSample {
  position: number;
  /** Background actually measured: the gradient color composited over the backdrop. */
  backgroundHex: string;
  /** Gradient color as an opaque sRGB fallback (before alpha compositing). */
  backgroundHexOpaque: string;
  /** Interpolated alpha of the gradient stop at this position. */
  backgroundAlpha: number;
  /** Backdrop (canvas) color the gradient was composited over. */
  backdropHex: string;
  ratio: number;
  ratioExact: number;
  grade: string;
  normalTextAA: boolean;
  normalTextAAA: boolean;
  apcaLc: number;
  apcaAbs: number;
  apcaGuidance: string;
  inTargetGamut: boolean;
}

export interface GradientContrastReport {
  foregroundHex: string;
  /** Underlying canvas color used for alpha compositing (default #ffffff). */
  backdropHex: string;
  /** True when any sampled position had alpha < 1 and was composited. */
  compositedAlpha: boolean;
  positions: number[];
  samples: GradientContrastSample[];
  /** Sample with the lowest WCAG ratio. */
  worstCase: GradientContrastSample;
  requiredRatio: number;
  meetsTarget: boolean;
  /** The threshold used for `meetsTarget` (null when target = "none"). */
  target: number | null;
  policy: string;
}

export interface ContrastSamplingOptions {
  /** Explicit sample positions in [0, 1]. Defaults to the authored stop positions. */
  positions?: number[];
  /** Contrast target: "aa" (4.5), "aaa" (7), "aa-large" (3) or "none". */
  contrastTarget?: "aa" | "aaa" | "aa-large" | "none";
  /**
   * Underlying canvas color (sRGB hex) that transparent gradient stops are
   * composited over before measuring contrast. Defaults to white (#ffffff).
   * WCAG/APCA are defined on opaque colors, so a transparent gradient cannot
   * be measured without this context.
   */
  backdropHex?: string;
}

/** Default canvas color used when a transparent gradient has no explicit backdrop. */
export const DEFAULT_CONTRAST_BACKDROP_HEX = "#ffffff";

/**
 * Sample a gradient at explicit positions and report the worst-case contrast
 * for a foreground color.
 *
 * Transparent stops are composited (simple alpha blending in gamma-encoded
 * sRGB, matching CSS `color-mix`/canvas compositing) over `backdropHex` before
 * the contrast is measured, so a fully transparent black gradient over a white
 * canvas correctly reports 1:1 for white text instead of the opaque black's
 * 21:1.
 */
export function contrastOverGradient(
  authored: AuthoredStop[],
  foregroundHex: string,
  options: GradientOptions & ContrastSamplingOptions = {}
): GradientContrastReport {
  const target = options.target ?? "srgb";
  const space = options.interpolationSpace ?? "oklch";
  const huePath = options.huePath ?? "shorter";
  const backdropHex = (options.backdropHex ?? DEFAULT_CONTRAST_BACKDROP_HEX).toLowerCase();
  const backdrop = parseHexToRgb01(backdropHex);
  const resolved = toResolved(authored);
  const first = stops0(resolved);
  const last = stops0End(resolved);

  const positions = options.positions ?? resolved.map((s) => s.position);
  for (const p of positions) {
    if (!Number.isFinite(p) || p < first || p > last) {
      throw new RangeError(
        `Sample positions must be finite numbers within [${first}, ${last}] (received ${p}).`
      );
    }
  }

  const required =
    options.contrastTarget === "none"
      ? null
      : options.contrastTarget === "aaa"
        ? WCAG_THRESHOLDS.normalTextAAA
        : options.contrastTarget === "aa-large"
          ? WCAG_THRESHOLDS.largeTextAA
          : WCAG_THRESHOLDS.normalTextAA;

  let compositedAlpha = false;

  const samples: GradientContrastSample[] = positions.map((position) => {
    const { oklch, alpha } = interpolateAt(resolved, position, space, huePath);
    const rounded = roundOklchForCss(oklch.l, oklch.c, oklch.h, target);
    const mapped = mapToGamut(rounded.l, rounded.c, rounded.h, target);
    const opaqueHex = mapped.hex;
    // Alpha compositing: the rendered background is the gradient color blended
    // with the canvas beneath it. Contrast is defined on opaque colors only.
    const bgHex = alpha >= 1 ? opaqueHex : rgb01ToHex(compositeOver(mapped.srgb, alpha, backdrop));
    if (alpha < 1) compositedAlpha = true;

    const wcag = calculateContrastRatio(foregroundHex, bgHex);
    const apca = apcaForHexPair(foregroundHex, bgHex);
    return {
      position,
      backgroundHex: bgHex,
      backgroundHexOpaque: opaqueHex,
      backgroundAlpha: Number(alpha.toFixed(4)),
      backdropHex,
      ratio: wcag.ratio,
      ratioExact: wcag.ratioExact,
      grade: wcag.grade,
      normalTextAA: wcag.normalTextAA,
      normalTextAAA: wcag.normalTextAAA,
      apcaLc: apca.lc,
      apcaAbs: apca.abs,
      apcaGuidance: apcaGuidance(apca.abs),
      inTargetGamut: channelsInGamut(oklchToSrgbUnclipped(rounded, target), SERIALIZED_CHANNEL_EPSILON)
    };
  });

  const worstCase = samples.reduce((worst, sample) =>
    sample.ratioExact < worst.ratioExact ? sample : worst
  );

  return {
    foregroundHex,
    backdropHex,
    compositedAlpha,
    positions: [...positions],
    samples,
    worstCase,
    requiredRatio: required ?? 0,
    meetsTarget: required === null ? true : worstCase.ratioExact >= required,
    target: required,
    policy:
      `Contrast sampled at ${positions.length} explicit position(s) of the ${space} interpolation; worst case is the lowest full-precision WCAG ratio among the samples. ` +
      (compositedAlpha
        ? `Samples with alpha < 1 were composited over the backdrop ${backdropHex} (WCAG/APCA are defined on opaque colors); pass backdropHex explicitly when the canvas differs. `
        : "") +
      `Ratios are measured on the exported sRGB fallback, which is what a non-wide-gamut display renders. ` +
      `Un-sampled positions are not guaranteed.`
  };
}

/** Simple alpha compositing in gamma-encoded sRGB: out = fg*a + bg*(1-a). */
function compositeOver(foreground: Srgb01, alpha: number, backdrop: Srgb01): Srgb01 {
  const a = Math.max(0, Math.min(1, alpha));
  return {
    r: foreground.r * a + backdrop.r * (1 - a),
    g: foreground.g * a + backdrop.g * (1 - a),
    b: foreground.b * a + backdrop.b * (1 - a)
  };
}

function rgb01ToHex(rgb: Srgb01): string {
  const byte = (u: number): string =>
    Math.round(Math.min(1, Math.max(0, u)) * 255).toString(16).padStart(2, "0");
  return `#${byte(rgb.r)}${byte(rgb.g)}${byte(rgb.b)}`;
}

function stops0(stops: ResolvedStop[]): number {
  return stops[0]!.position;
}

function stops0End(stops: ResolvedStop[]): number {
  return stops[stops.length - 1]!.position;
}

/** Classify a ratio using the shared WCAG policy (re-exported for tools). */
export { classifyContrastRatio, calculateContrastRatio };
export { srgb01ToOklab };