/**
 * OKLCH Gamut Mapper and Color-Space Conversion Engine
 * ======================================================================
 * Implements the CSS Color 4 §13.2 "binary search with local MINDE"
 * gamut-mapping algorithm (JND-based chroma reduction) for sRGB and
 * Display P3, plus the OKLab/OKLCH/sRGB/P3 conversions this package
 * relies on. Standalone module: it must NOT import color-math (circular
 * dependency guard) - all math lives here.
 *
 * Algorithm (documented policy, not a claim of CSS Color 4 conformance
 * certification):
 *   1. If L >= 1 -> return white in the destination gamut.
 *      If L <= 0 -> return black in the destination gamut.
 *   2. If the requested OKLCH color already fits the destination gamut,
 *      return it unchanged (mapped = false, iterations = 0).
 *   3. Otherwise bisect chroma in [0, C] toward the in-gamut boundary
 *      while holding L and H. A candidate is accepted when it is inside
 *      the destination gamut AND the perceptual distance (deltaEOK in
 *      OKLab) to the clipped reference color is below the JND threshold.
 *      Non-converging candidates that are still within MINDE update the
 *      clipped reference color ("local MINDE" refinement).
 *   4. Return the clipped reference color when it is within JND of the
 *      final in-gamut candidate, else the final in-gamut candidate.
 *
 * Documented numerical tolerances:
 *   GAMUT_JND = 0.02                  deltaEOK (OKLab) just-noticeable difference
 *   GAMUT_MINDE = GAMUT_JND / 2 = 0.01   local clipped-reference update threshold
 *   GAMUT_CHROMA_EPSILON = 0.0001    bisection stop condition on chroma
 *   GAMUT_CHANNEL_EPSILON = 1e-9     float-noise allowance for gamut tests
 *                                     (~6 orders of magnitude below one
 *                                     8-bit step of 1/255 = 0.00392)
 *   SERIALIZED_CHANNEL_EPSILON = 1/510 = 0.00196  one half 8-bit step; used
 *                                     when validating already-rounded CSS
 *                                     channel strings, because serialization
 *                                     rounding can move a color out of gamut
 *
 * Rendering policy used across this package:
 *   - Gamut-mapped OKLCH (mapped.oklch) is the canonical token value.
 *   - `channels` are in the *target* gamut (Display P3 channels when
 *     target === "p3") and are never re-encoded as #rrggbb.
 *   - `srgb` / `hex` are produced by an *independent* sRGB mapping of the
 *     same color, so a hex fallback is always real sRGB.
 */

export type GamutTarget = "srgb" | "p3";

export const GAMUT_TARGETS: readonly GamutTarget[] = ["srgb", "p3"] as const;

export interface Srgb01 {
  r: number; // 0.0 - 1.0 (may exceed bounds when unclipped)
  g: number;
  b: number;
}

export interface OklabTriple {
  L: number;
  a: number;
  b: number;
}

export interface OklchTriple {
  l: number;
  c: number;
  h: number;
}

export interface GamutMapResult {
  /** Destination gamut these `channels` belong to. */
  target: GamutTarget;
  /** True when the requested color was already inside the target gamut. */
  inGamut: boolean;
  /** True when gamut mapping actually changed the color. */
  mapped: boolean;
  /** Backward-compatible alias of `mapped` (kept for existing consumers). */
  clipped: boolean;
  /** Bisection iterations performed (0 when already in gamut). */
  iterations: number;
  /** deltaEOK (OKLab) between the mapped color and the requested color. */
  deltaEOK: number;
  /** The requested OKLCH triple after clamping/validation. */
  original: OklchTriple;
  /** Gamut-mapped OKLCH triple (L and H preserved, chroma reduced if needed). */
  oklch: OklchTriple;
  /** Channel values in the TARGET gamut (Display P3 channels for target "p3"). */
  channels: Srgb01;
  /** Independent sRGB rendering of the mapped color (always real sRGB). */
  srgb: Srgb01;
  /** sRGB fallback hex (#rrggbb). Always real sRGB, never P3 channels. */
  hex: string;
  /** CSS serialization in the target gamut: oklch(...) or color(display-p3 r g b). */
  css: string;
  /** CSS serialization of the independent sRGB fallback (oklch(...)). */
  srgbCss: string;
  /** Whether the mapped color also fits inside sRGB. */
  inSrgb: boolean;
}

export const GAMUT_JND = 0.02;
export const GAMUT_MINDE = GAMUT_JND / 2;
export const GAMUT_CHROMA_EPSILON = 0.0001;
export const GAMUT_CHANNEL_EPSILON = 1e-9;
export const SERIALIZED_CHANNEL_EPSILON = 1 / 510;

/** Decimal places used when serializing Display P3 channels. */
export const P3_CHANNEL_PRECISION = 4;
/** Decimal places used when serializing OKLCH lightness/chroma in tokens. */
export const OKLCH_SERIALIZED_PRECISION = 3;

// ---------------------------------------------------------------------------
// Transfer functions and matrices
// ---------------------------------------------------------------------------

/**
 * sRGB transfer encode. Deliberately does NOT clamp: out-of-gamut linear
 * values must stay > 1 (or < 0) so gamut tests can detect them.
 */
function gammaEncode(u: number): number {
  return u <= 0.0031308 ? 12.92 * u : 1.055 * Math.pow(u, 1 / 2.4) - 0.055;
}

function gammaDecode(v: number): number {
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

export function normalizeHue(h: number): number {
  if (!Number.isFinite(h)) {
    throw new RangeError("Hue must be a finite number.");
  }
  const wrapped = ((h % 360) + 360) % 360;
  return wrapped === 360 ? 0 : wrapped;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// ---------------------------------------------------------------------------
// OKLab <-> OKLCH <-> linear sRGB <-> linear Display P3
// ---------------------------------------------------------------------------

/** OKLCH -> OKLab (polar -> cartesian, hue in degrees). */
export function oklchToOklab(l: number, c: number, h: number): OklabTriple {
  const hRad = (normalizeHue(h) * Math.PI) / 180;
  return { L: l, a: c * Math.cos(hRad), b: c * Math.sin(hRad) };
}

/** OKLab -> OKLCH (hue in degrees, normalized to [0, 360)). */
export function oklabToOklch(lab: OklabTriple): OklchTriple {
  const c = Math.sqrt(lab.a * lab.a + lab.b * lab.b);
  let h = c === 0 ? 0 : (Math.atan2(lab.b, lab.a) * 180) / Math.PI;
  h = normalizeHue(h);
  return { l: lab.L, c, h };
}

/** OKLab -> linear sRGB (unclipped). */
export function oklabToLinearSrgb(lab: OklabTriple): Srgb01 {
  const l_ = lab.L + 0.3963377774 * lab.a + 0.2158037573 * lab.b;
  const m_ = lab.L - 0.1055613458 * lab.a - 0.0638541728 * lab.b;
  const s_ = lab.L - 0.0894841775 * lab.a - 1.291485548 * lab.b;

  const l3 = l_ * l_ * l_;
  const m3 = m_ * m_ * m_;
  const s3 = s_ * s_ * s_;

  return {
    r: 4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3,
    g: -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3,
    b: -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3
  };
}

/** linear sRGB -> OKLab. */
export function linearSrgbToOklab(rgb: Srgb01): OklabTriple {
  const l = 0.4122214708 * rgb.r + 0.5363325363 * rgb.g + 0.0514459929 * rgb.b;
  const m = 0.2119034982 * rgb.r + 0.6806995451 * rgb.g + 0.1073969566 * rgb.b;
  const s = 0.0883024619 * rgb.r + 0.2817188376 * rgb.g + 0.6299787005 * rgb.b;

  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);

  return {
    L: 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    a: 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_
  };
}

/** linear sRGB -> linear Display P3 (unclipped). */
export function linearSrgbToLinearP3(rgb: Srgb01): Srgb01 {
  const x =
    0.4123907993 * rgb.r + 0.3575843394 * rgb.g + 0.1804807884 * rgb.b;
  const y =
    0.2126390059 * rgb.r + 0.7151686788 * rgb.g + 0.0721923154 * rgb.b;
  const z =
    0.0193308187 * rgb.r + 0.1191947798 * rgb.g + 0.9505321522 * rgb.b;
  return {
    r: 2.4934969119 * x - 0.9313836179 * y - 0.4027107845 * z,
    g: -0.8294889696 * x + 1.7626640603 * y + 0.0236246858 * z,
    b: 0.0358458302 * x - 0.0761723893 * y + 0.956884524 * z
  };
}

/** linear Display P3 -> linear sRGB (unclipped). */
export function linearP3ToLinearSrgb(rgb: Srgb01): Srgb01 {
  const x = 0.4865709486 * rgb.r + 0.2656676932 * rgb.g + 0.1982172852 * rgb.b;
  const y = 0.2289745641 * rgb.r + 0.6917385218 * rgb.g + 0.0792869141 * rgb.b;
  const z = 0.0 * rgb.r + 0.0451133819 * rgb.g + 1.0439443689 * rgb.b;
  return {
    r: 3.2409699419 * x - 1.5373831776 * y - 0.4986107603 * z,
    g: -0.9692436363 * x + 1.8759675015 * y + 0.0415550574 * z,
    b: 0.0556300797 * x - 0.2039769589 * y + 1.0569715142 * z
  };
}

/** sRGB 0-1 (gamma encoded) -> OKLCH. */
export function srgb01ToOklch(rgb: Srgb01): OklchTriple {
  const linear = {
    r: gammaDecode(rgb.r),
    g: gammaDecode(rgb.g),
    b: gammaDecode(rgb.b)
  };
  return oklabToOklch(linearSrgbToOklab(linear));
}

/** OKLCH -> sRGB 0-1 in the requested gamut, UNCLIPPED. */
export function oklchToSrgb(l: number, c: number, h: number, target: GamutTarget = "srgb"): Srgb01 {
  const linear = oklabToLinearSrgb(oklchToOklab(l, c, h));
  const fitted = target === "p3" ? linearSrgbToLinearP3(linear) : linear;
  return {
    r: gammaEncode(fitted.r),
    g: gammaEncode(fitted.g),
    b: gammaEncode(fitted.b)
  };
}

/** sRGB 0-1 (gamma encoded) -> OKLab. */
export function srgb01ToOklab(rgb: Srgb01): OklabTriple {
  return linearSrgbToOklab({
    r: gammaDecode(rgb.r),
    g: gammaDecode(rgb.g),
    b: gammaDecode(rgb.b)
  });
}

// ---------------------------------------------------------------------------
// Gamut tests
// ---------------------------------------------------------------------------

/** True when gamma-encoded channels fit [0, 1] within the documented epsilon. */
export function channelsInGamut(
  rgb: Srgb01,
  epsilon: number = GAMUT_CHANNEL_EPSILON
): boolean {
  return (
    rgb.r >= -epsilon &&
    rgb.r <= 1 + epsilon &&
    rgb.g >= -epsilon &&
    rgb.g <= 1 + epsilon &&
    rgb.b >= -epsilon &&
    rgb.b <= 1 + epsilon
  );
}

/** True when the OKLCH color fits the target gamut (exact test, 1e-9 epsilon). */
export function isInGamut(l: number, c: number, h: number, target: GamutTarget = "srgb"): boolean {
  return channelsInGamut(oklchToSrgb(l, c, h, target));
}

/**
 * True when *serialized* channel values (already rounded for CSS output)
 * are still inside the gamut, allowing half an 8-bit step of slack.
 */
export function serializedChannelsInGamut(rgb: Srgb01): boolean {
  return channelsInGamut(rgb, SERIALIZED_CHANNEL_EPSILON);
}

function clip01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function clipChannels(rgb: Srgb01): Srgb01 {
  return { r: clip01(rgb.r), g: clip01(rgb.g), b: clip01(rgb.b) };
}

function toHex(rgb: Srgb01): string {
  const byte = (u: number): string =>
    Math.round(clip01(u) * 255).toString(16).padStart(2, "0");
  return `#${byte(rgb.r)}${byte(rgb.g)}${byte(rgb.b)}`;
}

function fixed(value: number, digits: number): string {
  const v = Number(value.toFixed(digits));
  return Object.is(v, -0) ? (0).toFixed(digits) : v.toFixed(digits);
}

/**
 * Serialize OKLCH for CSS with the documented 3-decimal lightness/chroma
 * rounding. When `alpha` is provided it is serialized INSIDE the function
 * (`oklch(L C H / A)`), which is the only valid CSS Color 4 form.
 */
export function oklchToCssString(l: number, c: number, h: number, alpha?: number): string {
  const components = `${fixed(l, OKLCH_SERIALIZED_PRECISION)} ${fixed(c, OKLCH_SERIALIZED_PRECISION)} ${Math.round(
    normalizeHue(h)
  )}`;
  if (alpha === undefined || alpha >= 1) return `oklch(${components})`;
  return `oklch(${components} / ${fixed(Math.max(0, Math.min(1, alpha)), 3)})`;
}

/** Serialize target-gamut channels as CSS: oklch(...) or color(display-p3 r g b). */
export function channelsToCss(
  rgb: Srgb01,
  target: GamutTarget,
  mappedOklch?: OklchTriple
): string {
  if (target === "p3") {
    return `color(display-p3 ${fixed(rgb.r, P3_CHANNEL_PRECISION)} ${fixed(rgb.g, P3_CHANNEL_PRECISION)} ${fixed(
      rgb.b,
      P3_CHANNEL_PRECISION
    )})`;
  }
  if (mappedOklch) {
    return oklchToCssString(mappedOklch.l, mappedOklch.c, mappedOklch.h);
  }
  return `rgb(${fixed(rgb.r * 255, 2)} ${fixed(rgb.g * 255, 2)} ${fixed(rgb.b * 255, 2)})`;
}

/** deltaEOK: Euclidean distance between two OKLab colors. */
export function deltaEOk(lab1: OklabTriple, lab2: OklabTriple): number {
  const dl = lab1.L - lab2.L;
  const da = lab1.a - lab2.a;
  const db = lab1.b - lab2.b;
  return Math.sqrt(dl * dl + da * da + db * db);
}

// ---------------------------------------------------------------------------
// CSS Color 4 §13.2 binary search with local MINDE
// ---------------------------------------------------------------------------

function assertFiniteOklch(l: number, c: number, h: number): void {
  if (!Number.isFinite(l) || !Number.isFinite(c) || !Number.isFinite(h)) {
    throw new RangeError(
      `OKLCH components must be finite numbers (received l=${l}, c=${c}, h=${h}).`
    );
  }
}

function boundaryResult(
  target: GamutTarget,
  original: OklchTriple,
  lightness: 0 | 1
): GamutMapResult {
  const oklch: OklchTriple = { l: lightness, c: 0, h: 0 };
  const channels: Srgb01 =
    lightness === 1 ? { r: 1, g: 1, b: 1 } : { r: 0, g: 0, b: 0 };
  const requestedIsPureAchromatic =
    original.c <= 0 && Math.abs(original.l - lightness) < 1e-9;
  return {
    target,
    inGamut: requestedIsPureAchromatic,
    mapped: !requestedIsPureAchromatic,
    clipped: !requestedIsPureAchromatic,
    iterations: 0,
    deltaEOK: Math.abs(original.l - lightness),
    original,
    oklch,
    channels,
    srgb: { ...channels },
    hex: lightness === 1 ? "#ffffff" : "#000000",
    css: channelsToCss(channels, target, oklch),
    srgbCss: oklchToCssString(oklch.l, oklch.c, oklch.h),
    inSrgb: true
  };
}

/**
 * Independent chroma reduction for an sRGB fallback of an already mapped
 * color. Uses the SAME mapping algorithm as the primary target so the hex
 * fallback is exactly what an sRGB-targeted pipeline would emit.
 */
function srgbFallbackOklch(triple: OklchTriple): OklchTriple {
  const mapped = binarySearchLocalMinde(triple.l, triple.c, triple.h, "srgb");
  return mapped.oklch;
}

/**
 * Constant-lightness/constant-hue chroma trim used after the MINDE algorithm
 * returns a clipped reference color. OKLab round-trips can land a few ULPs
 * outside the gamut (for example r = 1.0000000037); this removes that noise so
 * the published OKLCH value really does convert back into the gamut.
 */
function trimToGamut(triple: OklchTriple, target: GamutTarget): OklchTriple {
  if (channelsInGamut(oklchToSrgb(triple.l, triple.c, triple.h, target))) {
    return triple;
  }
  let lo = 0;
  let hi = triple.c;
  for (let i = 0; i < 60 && hi - lo > 1e-12; i += 1) {
    const mid = (lo + hi) / 2;
    if (channelsInGamut(oklchToSrgb(triple.l, mid, triple.h, target))) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return { l: triple.l, c: lo, h: triple.h };
}

/**
 * Convert channels of the TARGET gamut into OKLab.
 *
 * Behavior change (bug fix): previously the clipped channels were always run
 * through `srgb01ToOklab`, which silently treated Display P3 channel values as
 * sRGB and produced incorrect mapped colors for `target: "p3"`. P3 channels
 * are now decoded with the sRGB transfer function (which Display P3 shares),
 * converted P3 -> linear sRGB, and then to OKLab.
 */
export function targetChannelsToOklab(rgb: Srgb01, target: GamutTarget): OklabTriple {
  if (target === "srgb") {
    return srgb01ToOklab(rgb);
  }
  const linearP3 = {
    r: gammaDecode(rgb.r),
    g: gammaDecode(rgb.g),
    b: gammaDecode(rgb.b)
  };
  return linearSrgbToOklab(linearP3ToLinearSrgb(linearP3));
}

/**
 * Faithful implementation of the CSS Color 4 §14.2.2 "Binary Search Gamut
 * Mapping with Local MINDE" pseudocode.
 *
 *   current = origin_OkLCh
 *   clipped = clip(current); E = deltaEOK(clipped, current)
 *   if E < JND: return clipped
 *   min = 0; max = C; min_inGamut = true
 *   while (max - min > epsilon):
 *     chroma = (min + max) / 2; current.chroma = chroma
 *     if min_inGamut and inGamut(current): min = chroma; continue
 *     clipped = clip(current); E = deltaEOK(clipped, current)
 *     if E < JND:
 *       if (JND - E) < epsilon: return clipped
 *       min_inGamut = false; min = chroma
 *     else: max = chroma
 *   return clipped
 *
 * `deltaEOK` reports the total perceptual distance between the requested and
 * the mapped color. Note that the local-MINDE branch can return a clipped
 * reference color whose lightness differs slightly from the request - that is
 * the documented behaviour of the CSS algorithm (it is bounded by the JND
 * early-exit test, not by a hard clamp).
 */
function binarySearchLocalMinde(
  L: number,
  C: number,
  H: number,
  target: GamutTarget
): { oklch: OklchTriple; channels: Srgb01; iterations: number; deltaEOK: number } {
  const requestedLab = oklchToOklab(L, C, H);
  const originChannels = oklchToSrgb(L, C, H, target);
  const finish = (
    result: Srgb01,
    iterations: number
  ): { oklch: OklchTriple; channels: Srgb01; iterations: number; deltaEOK: number } => {
    // The clipped color is expressed in the TARGET gamut: convert it back to
    // OKLab through the target-aware path before re-expressing it as OKLCH.
    const mappedOklch = trimToGamut(oklabToOklch(targetChannelsToOklab(result, target)), target);
    const channels = clipChannels(oklchToSrgb(mappedOklch.l, mappedOklch.c, mappedOklch.h, target));
    return {
      oklch: mappedOklch,
      channels,
      iterations,
      deltaEOK: deltaEOk(requestedLab, oklchToOklab(mappedOklch.l, mappedOklch.c, mappedOklch.h))
    };
  };

  let clipped = clipChannels(originChannels);
  const initialDelta = deltaEOk(targetChannelsToOklab(clipped, target), requestedLab);
  if (initialDelta < GAMUT_JND) {
    return finish(clipped, 0);
  }

  let min = 0;
  let max = C;
  let minInGamut = true;
  let iterations = 0;

  while (max - min > GAMUT_CHROMA_EPSILON) {
    iterations += 1;
    const chroma = (min + max) / 2;
    const candidateChannels = oklchToSrgb(L, chroma, H, target);

    if (minInGamut && channelsInGamut(candidateChannels)) {
      min = chroma;
      continue;
    }

    clipped = clipChannels(candidateChannels);
    const error = deltaEOk(targetChannelsToOklab(clipped, target), oklchToOklab(L, chroma, H));
    if (error < GAMUT_JND) {
      if (GAMUT_JND - error < GAMUT_CHROMA_EPSILON) {
        return finish(clipped, iterations);
      }
      minInGamut = false;
      min = chroma;
    } else {
      max = chroma;
    }
  }

  return finish(clipped, iterations);
}

/**
 * Map an OKLCH color into the target gamut using the CSS Color 4 binary
 * search with local MINDE. Both the requested and the mapped OKLCH values
 * are preserved in the result, together with `mapped` and `deltaEOK` so
 * callers can report whether gamut mapping occurred.
 */
export function mapToGamut(
  l: number,
  c: number,
  h: number,
  target: GamutTarget = "srgb"
): GamutMapResult {
  assertFiniteOklch(l, c, h);
  if (target !== "srgb" && target !== "p3") {
    throw new RangeError(`Unsupported gamut target: ${String(target)}`);
  }

  const L = clamp01(l);
  const C = Math.max(0, c);
  const H = normalizeHue(h);
  const original: OklchTriple = { l: L, c: C, h: H };

  // Spec step: lightness boundaries resolve to white / black.
  if (L >= 1) return boundaryResult(target, original, 1);
  if (L <= 0) return boundaryResult(target, original, 0);

  const direct = oklchToSrgb(L, C, H, target);

  // Already inside the target gamut: unchanged, per relative colorimetric intent.
  if (channelsInGamut(direct)) {
    const oklch: OklchTriple = { l: L, c: C, h: H };
    const mappedChannels = clipChannels(direct);
    // The hex fallback always comes from an independent sRGB mapping of the
    // same perceptual color, so a wide-gamut token never re-encodes P3
    // channels as #rrggbb.
    const srgbTriple = target === "srgb" ? oklch : srgbFallbackOklch(oklch);
    const srgbChannels = oklchToSrgb(srgbTriple.l, srgbTriple.c, srgbTriple.h, "srgb");
    return {
      target,
      inGamut: true,
      mapped: false,
      clipped: false,
      iterations: 0,
      deltaEOK: 0,
      original,
      oklch,
      channels: mappedChannels,
      srgb: clipChannels(srgbChannels),
      hex: toHex(srgbChannels),
      css: channelsToCss(mappedChannels, target, oklch),
      srgbCss: oklchToCssString(srgbTriple.l, srgbTriple.c, srgbTriple.h),
      inSrgb: channelsInGamut(srgbChannels)
    };
  }

  const mapped = binarySearchLocalMinde(L, C, H, target);
  // Independent sRGB mapping of the same requested color: a P3 export must
  // not degrade the fallback hex, and both targets must agree on what sRGB
  // renders.
  const srgbTriple = target === "srgb" ? mapped.oklch : srgbFallbackOklch({ l: L, c: C, h: H });
  const srgbChannels = oklchToSrgb(srgbTriple.l, srgbTriple.c, srgbTriple.h, "srgb");

  return {
    target,
    inGamut: false,
    mapped: true,
    clipped: true,
    iterations: mapped.iterations,
    deltaEOK: mapped.deltaEOK,
    original,
    oklch: mapped.oklch,
    channels: mapped.channels,
    srgb: clipChannels(srgbChannels),
    hex: toHex(srgbChannels),
    css: channelsToCss(mapped.channels, target, mapped.oklch),
    srgbCss: oklchToCssString(srgbTriple.l, srgbTriple.c, srgbTriple.h),
    inSrgb: channelsInGamut(
      oklchToSrgb(mapped.oklch.l, mapped.oklch.c, mapped.oklch.h, "srgb")
    )
  };
}

/**
 * Gamut-mapped sRGB fallback hex for an OKLCH color.
 *
 * Behavior change (documented): `target` no longer changes the returned
 * string - a hex string is by definition an sRGB code value, so P3 targets
 * now produce the independent sRGB fallback instead of re-encoding P3
 * channels as #rrggbb.
 */
export function oklchToHex(
  l: number,
  c: number,
  h: number,
  target: GamutTarget = "srgb"
): string {
  return mapToGamut(l, c, h, target).hex;
}

// ---------------------------------------------------------------------------
// Serialization safety
// ---------------------------------------------------------------------------

export interface SerializedOklch {
  l: number;
  c: number;
  h: number;
  /** True when chroma had to be reduced so the rounded values stay in gamut. */
  adjusted: boolean;
  css: string;
}

/**
 * Round an OKLCH color to the precision actually written to CSS and verify
 * the *serialized* values still fit the target gamut, reducing chroma when
 * rounding would push the color out of gamut.
 */
export function roundOklchForCss(
  l: number,
  c: number,
  h: number,
  target: GamutTarget = "srgb"
): SerializedOklch {
  const precision = 10 ** OKLCH_SERIALIZED_PRECISION;
  const roundedL = Math.round(clamp01(l) * precision) / precision;
  // Math.round(359.6) === 360, which is out of the CSS hue range [0, 360).
  const roundedH = Math.round(normalizeHue(h)) % 360;
  const requestedC = Math.max(0, Math.round(c * precision) / precision);

  if (serializedChannelsInGamut(oklchToSrgb(roundedL, requestedC, roundedH, target))) {
    return {
      l: roundedL,
      c: requestedC,
      h: roundedH,
      adjusted: false,
      css: oklchToCssString(roundedL, requestedC, roundedH)
    };
  }

  // Rounding pushed the color out of gamut: find the largest serialized chroma
  // that survives the same rounding rule.
  let lo = 0;
  let hi = requestedC;
  let bestSerialized = 0;
  while (hi - lo > 1 / precision) {
    const mid = (lo + hi) / 2;
    const quantized = Math.round(mid * precision) / precision;
    if (serializedChannelsInGamut(oklchToSrgb(roundedL, quantized, roundedH, target))) {
      lo = mid;
      bestSerialized = quantized;
    } else {
      hi = mid;
    }
  }

  return {
    l: roundedL,
    c: bestSerialized,
    h: roundedH,
    adjusted: true,
    css: oklchToCssString(roundedL, bestSerialized, roundedH)
  };
}