/**
 * High-Craft Palette Generator using OKLCH ramps, explicit gamut policy and
 * WCAG/APCA auditing with optional contrast correction.
 *
 * Design notes
 * ------------
 * - Colors are derived from perceptual ramps (equal OKLCH lightness
 *   increments, or a configurable cubic-Bezier eased lightness curve), not
 *   from a single fixed offset per token. Equal lightness increments are
 *   exactly that: a uniform step in OKLCH L. No claim of equal delta-E
 *   spacing is made (that is not implemented).
 * - Every token is exported twice: a gamut-mapped OKLCH value (the canonical
 *   token) and an independent 8-bit sRGB fallback hex. Contrast is measured
 *   on that same sRGB fallback, so the audit always describes the exported
 *   colors.
 * - Every text x surface pairing (including muted text and elevated/subtle
 *   surfaces) plus the accent/border UI pairings are audited. Nothing claims
 *   an unconditional AAA guarantee: results are reported against the
 *   requested contrast target, and unreachable pairings are returned as
 *   failures with a partial/blocked status.
 */

import {
  GamutTarget,
  OklchTriple,
  mapToGamut,
  normalizeHue,
  oklchToCssString,
  roundOklchForCss
} from "./gamut-mapper.js";
import {
  WCAG_THRESHOLDS,
  classifyContrastRatio,
  calculateContrastRatio,
  exactContrastRatio
} from "./color-math.js";
import { apcaForHexPair, apcaGuidance } from "./apca.js";

export type PaletteMood =
  | "editorial"
  | "cyber-tactile"
  | "neo-brutalist"
  | "luxury-dark"
  | "organic-modern"
  | "bespoke";

export type LightnessMode = "equal" | "eased";
export type ChromaProfile = "constant" | "linear" | "bell" | "eased";
export type ContrastTarget = "aa" | "aaa" | "aa-large" | "none";
export type CorrectionMode = "none" | "text-lightness" | "both";

export type PaletteTokenName =
  | "bgSurface"
  | "bgElevated"
  | "bgSubtle"
  | "textPrimary"
  | "textSecondary"
  | "textMuted"
  | "accentPrimary"
  | "accentSecondary"
  | "accentGlow"
  | "borderSubtle"
  | "borderActive";

export const PALETTE_TOKEN_NAMES: readonly PaletteTokenName[] = [
  "bgSurface",
  "bgElevated",
  "bgSubtle",
  "textPrimary",
  "textSecondary",
  "textMuted",
  "accentPrimary",
  "accentSecondary",
  "accentGlow",
  "borderSubtle",
  "borderActive"
] as const;

// ---------------------------------------------------------------------------
// Ramp configuration
// ---------------------------------------------------------------------------

export interface RampSpec {
  /** Number of ramp stops (2-32). Equal-lightness spacing when mode = equal. */
  steps: number;
  /** Ramp start lightness (0-1). */
  lightnessStart: number;
  /** Ramp end lightness (0-1). */
  lightnessEnd: number;
  /** Chroma at ramp position 0. */
  chromaStart: number;
  /** Chroma at ramp position 1. */
  chromaEnd: number;
  /** How chroma varies along the ramp. */
  chromaProfile: ChromaProfile;
  /** Hue at ramp position 0 (degrees). */
  hueStart: number;
  /** Hue at ramp position 1 (degrees), linear (not shortest-arc). */
  hueEnd: number;
}

export type RampName = "surface" | "text" | "accent";

export interface RampEndpointOverrides {
  lightnessStart?: number;
  lightnessEnd?: number;
  chromaStart?: number;
  chromaEnd?: number;
  chromaProfile?: ChromaProfile;
  hueStart?: number;
  hueEnd?: number;
  steps?: number;
}

export interface PaletteRampOptions {
  /** Step count applied to every ramp unless overridden per ramp. */
  steps?: number;
  /** Lightness interpolation: equal OKLCH increments or an eased curve. */
  lightnessMode?: LightnessMode;
  /** Cubic-Bezier control points for eased lightness/chroma (real curve evaluation). */
  lightnessEasing?: [number, number, number, number];
  /** Chroma profile applied to every ramp unless overridden per ramp. */
  chromaProfile?: ChromaProfile;
  /** Per-ramp endpoint overrides. */
  surface?: RampEndpointOverrides;
  text?: RampEndpointOverrides;
  accent?: RampEndpointOverrides;
}

export interface PaletteSpec {
  mood: PaletteMood;
  baseHue: number;
  surfaceRamp: RampSpec;
  textRamp: RampSpec;
  accentRamp: RampSpec;
  /** Position (0-1) in the surface ramp for each surface/border token. */
  positions: {
    bgSurface: number;
    bgElevated: number;
    bgSubtle: number;
    borderSubtle: number;
  };
  /** Position (0-1) in the text ramp for each text token. */
  textPositions: {
    textPrimary: number;
    textSecondary: number;
    textMuted: number;
  };
  /** Position (0-1) in the accent ramp for each accent token. */
  accentPositions: {
    accentPrimary: number;
    accentSecondary: number;
    accentGlow: number;
    borderActive: number;
  };
  /** Extra chroma multipliers applied to accent tokens. */
  accentChromaFactor: {
    accentGlow: number;
    borderActive: number;
  };
  /** Text ramp anchor: corrections never move text past this lightness. */
  textLimit: { dark: number; light: number };
}

const RAMP_STEPS_DEFAULT = 7;

function ramp(
  overrides: Partial<RampSpec> & Pick<RampSpec, "lightnessStart" | "lightnessEnd">
): RampSpec {
  return {
    steps: RAMP_STEPS_DEFAULT,
    chromaStart: 0.015,
    chromaEnd: 0.015,
    chromaProfile: "constant" as ChromaProfile,
    hueStart: 0,
    hueEnd: 0,
    ...overrides
  };
}

/**
 * The five shipped moods as presets. Values are chosen so that the default
 * (uncorrected) editorial muted text still measures ~3.59:1 - the audited
 * defect that motivated the full text/surface audit.
 */
export const MOOD_PRESETS: Record<Exclude<PaletteMood, "bespoke">, PaletteSpec> = {
  editorial: {
    mood: "editorial",
    baseHue: 215,
    surfaceRamp: ramp({ lightnessStart: 0.11, lightnessEnd: 0.31, chromaStart: 0.015, chromaEnd: 0.015, hueStart: 215, hueEnd: 215 }),
    textRamp: ramp({ lightnessStart: 0.96, lightnessEnd: 0.46, chromaStart: 0.01, chromaEnd: 0.026667, chromaProfile: "linear", hueStart: 215, hueEnd: 215 }),
    accentRamp: ramp({ lightnessStart: 0.58, lightnessEnd: 0.68, chromaStart: 0.128, chromaEnd: 0.16, chromaProfile: "linear", hueStart: 260, hueEnd: 355 }),
    positions: { bgSurface: 0, bgElevated: 0.25, bgSubtle: 0.4, borderSubtle: 0.6 },
    textPositions: { textPrimary: 0, textSecondary: 0.44, textMuted: 0.9 },
    accentPositions: { accentPrimary: 1, accentSecondary: 0, accentGlow: 1, borderActive: 1 },
    accentChromaFactor: { accentGlow: 0.5, borderActive: 0.6 },
    textLimit: { dark: 0.05, light: 1 }
  },
  "cyber-tactile": {
    mood: "cyber-tactile",
    baseHue: 160,
    surfaceRamp: ramp({ lightnessStart: 0.1, lightnessEnd: 0.3, chromaStart: 0.02, chromaEnd: 0.02, hueStart: 160, hueEnd: 160 }),
    textRamp: ramp({ lightnessStart: 0.98, lightnessEnd: 0.48, chromaStart: 0.01, chromaEnd: 0.026667, chromaProfile: "linear", hueStart: 160, hueEnd: 160 }),
    accentRamp: ramp({ lightnessStart: 0.7, lightnessEnd: 0.8, chromaStart: 0.176, chromaEnd: 0.22, chromaProfile: "linear", hueStart: 205, hueEnd: 300 }),
    positions: { bgSurface: 0, bgElevated: 0.25, bgSubtle: 0.4, borderSubtle: 0.6 },
    textPositions: { textPrimary: 0, textSecondary: 0.44, textMuted: 0.9 },
    accentPositions: { accentPrimary: 1, accentSecondary: 0, accentGlow: 1, borderActive: 1 },
    accentChromaFactor: { accentGlow: 0.5, borderActive: 0.6 },
    textLimit: { dark: 0.05, light: 1 }
  },
  "neo-brutalist": {
    mood: "neo-brutalist",
    baseHue: 45,
    surfaceRamp: ramp({ lightnessStart: 0.98, lightnessEnd: 0.78, chromaStart: 0.005, chromaEnd: 0.005, hueStart: 45, hueEnd: 45 }),
    textRamp: ramp({ lightnessStart: 0.08, lightnessEnd: 0.58, chromaStart: 0.01, chromaEnd: 0.026667, chromaProfile: "linear", hueStart: 45, hueEnd: 45 }),
    accentRamp: ramp({ lightnessStart: 0.45, lightnessEnd: 0.55, chromaStart: 0.16, chromaEnd: 0.2, chromaProfile: "linear", hueStart: 90, hueEnd: 185 }),
    positions: { bgSurface: 0, bgElevated: 0.25, bgSubtle: 0.4, borderSubtle: 0.6 },
    textPositions: { textPrimary: 0, textSecondary: 0.44, textMuted: 0.9 },
    accentPositions: { accentPrimary: 1, accentSecondary: 0, accentGlow: 1, borderActive: 1 },
    accentChromaFactor: { accentGlow: 0.5, borderActive: 0.6 },
    textLimit: { dark: 0, light: 0.95 }
  },
  "luxury-dark": {
    mood: "luxury-dark",
    baseHue: 250,
    surfaceRamp: ramp({ lightnessStart: 0.09, lightnessEnd: 0.29, chromaStart: 0.01, chromaEnd: 0.01, hueStart: 250, hueEnd: 250 }),
    textRamp: ramp({ lightnessStart: 0.95, lightnessEnd: 0.45, chromaStart: 0.01, chromaEnd: 0.026667, chromaProfile: "linear", hueStart: 250, hueEnd: 250 }),
    accentRamp: ramp({ lightnessStart: 0.68, lightnessEnd: 0.78, chromaStart: 0.112, chromaEnd: 0.14, chromaProfile: "linear", hueStart: 265, hueEnd: 280 }),
    positions: { bgSurface: 0, bgElevated: 0.25, bgSubtle: 0.4, borderSubtle: 0.6 },
    textPositions: { textPrimary: 0, textSecondary: 0.44, textMuted: 0.9 },
    accentPositions: { accentPrimary: 1, accentSecondary: 0, accentGlow: 1, borderActive: 1 },
    accentChromaFactor: { accentGlow: 0.5, borderActive: 0.6 },
    textLimit: { dark: 0.05, light: 1 }
  },
  "organic-modern": {
    mood: "organic-modern",
    baseHue: 125,
    surfaceRamp: ramp({ lightnessStart: 0.15, lightnessEnd: 0.35, chromaStart: 0.025, chromaEnd: 0.025, hueStart: 125, hueEnd: 125 }),
    textRamp: ramp({ lightnessStart: 0.94, lightnessEnd: 0.44, chromaStart: 0.01, chromaEnd: 0.026667, chromaProfile: "linear", hueStart: 125, hueEnd: 125 }),
    accentRamp: ramp({ lightnessStart: 0.62, lightnessEnd: 0.72, chromaStart: 0.096, chromaEnd: 0.12, chromaProfile: "linear", hueStart: 45, hueEnd: 165 }),
    positions: { bgSurface: 0, bgElevated: 0.25, bgSubtle: 0.4, borderSubtle: 0.6 },
    textPositions: { textPrimary: 0, textSecondary: 0.44, textMuted: 0.9 },
    accentPositions: { accentPrimary: 1, accentSecondary: 0, accentGlow: 1, borderActive: 1 },
    accentChromaFactor: { accentGlow: 0.5, borderActive: 0.6 },
    textLimit: { dark: 0.05, light: 1 }
  }
};

// ---------------------------------------------------------------------------
// Easing
// ---------------------------------------------------------------------------

/**
 * Cubic-Bezier easing evaluated by solving B_x(s) = t (Newton-Raphson with a
 * bisection fallback) and returning B_y(s). The control points are real
 * curve parameters, not arbitrary multipliers.
 */
export function cubicBezierEasing(
  t: number,
  controlPoints: [number, number, number, number]
): number {
  const [x1, y1, x2, y2] = controlPoints;
  if (![x1, y1, x2, y2].every((v) => Number.isFinite(v))) {
    throw new RangeError("Cubic-Bezier control points must be finite numbers.");
  }
  if (x1 < 0 || x1 > 1 || x2 < 0 || x2 > 1) {
    throw new RangeError(
      `Cubic-Bezier x control points must lie in [0, 1] (received ${x1}, ${x2}).`
    );
  }
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t;

  const sampleX = (s: number): number => {
    const u = 1 - s;
    return 3 * u * u * s * x1 + 3 * u * s * s * x2 + s * s * s;
  };
  const sampleY = (s: number): number => {
    const u = 1 - s;
    return 3 * u * u * s * y1 + 3 * u * s * s * y2 + s * s * s;
  };
  const slopeX = (s: number): number => {
    const u = 1 - s;
    return 3 * u * u * x1 + 6 * u * s * (x2 - x1) + 3 * s * s * (1 - x2);
  };

  let s = clamped;
  for (let i = 0; i < 8; i += 1) {
    const x = sampleX(s) - clamped;
    if (Math.abs(x) < 1e-9) break;
    const d = slopeX(s);
    if (Math.abs(d) < 1e-9) break;
    s -= x / d;
  }
  // Bisection safety net for degenerate curves.
  if (s < 0 || s > 1) {
    let lo = 0;
    let hi = 1;
    s = clamped;
    for (let i = 0; i < 40; i += 1) {
      const mid = (lo + hi) / 2;
      if (sampleX(mid) < clamped) lo = mid;
      else hi = mid;
    }
    s = (lo + hi) / 2;
  }
  return sampleY(s);
}

// ---------------------------------------------------------------------------
// Ramp construction
// ---------------------------------------------------------------------------

export interface RampStop {
  t: number;
  oklch: OklchTriple;
  css: string;
  hex: string;
  mapped: boolean;
}

export interface RampOptionsFull {
  steps: number;
  lightnessMode: LightnessMode;
  easing: [number, number, number, number] | null;
  target: GamutTarget;
}

function chromaAt(profile: ChromaProfile, start: number, end: number, t: number): number {
  switch (profile) {
    case "constant":
      return start;
    case "linear":
      return start + (end - start) * t;
    case "bell":
      // Peaks at the ramp midpoint with chromaEnd, endpoints at chromaStart.
      return start + (end - start) * Math.sin(Math.PI * t);
    case "eased":
    default:
      return start + (end - start) * t;
  }
}

/** Build a gamut-mapped ramp with equal-lightness steps or an eased curve. */
export function buildRamp(spec: RampSpec, options: RampOptionsFull): RampStop[] {
  const { steps } = spec;
  if (!Number.isInteger(steps) || steps < 2 || steps > 32) {
    throw new RangeError(`Ramp steps must be an integer between 2 and 32 (received ${steps}).`);
  }
  const stops: RampStop[] = [];
  for (let i = 0; i < steps; i += 1) {
    const t = i / (steps - 1);
    const easedT =
      options.lightnessMode === "eased" && options.easing
        ? cubicBezierEasing(t, options.easing)
        : t;
    const l = spec.lightnessStart + easedT * (spec.lightnessEnd - spec.lightnessStart);
    const cT = spec.chromaProfile === "eased" && options.easing
      ? cubicBezierEasing(t, options.easing)
      : t;
    const c = chromaAt(spec.chromaProfile, spec.chromaStart, spec.chromaEnd, cT);
    const h = normalizeHue(spec.hueStart + t * (spec.hueEnd - spec.hueStart));
    const mapped = mapToGamut(l, c, h, options.target);
    const rounded = roundOklchForCss(mapped.oklch.l, mapped.oklch.c, mapped.oklch.h, options.target);
    stops.push({
      t: Number(t.toFixed(6)),
      oklch: { l: rounded.l, c: rounded.c, h: rounded.h },
      css: oklchToCssString(rounded.l, rounded.c, rounded.h),
      hex: mapped.hex,
      mapped: mapped.mapped
    });
  }
  return stops;
}

// ---------------------------------------------------------------------------
// Tokens and contrast auditing
// ---------------------------------------------------------------------------

export interface PaletteToken {
  /** Gamut-mapped OKLCH lightness written to CSS. */
  l: number;
  c: number;
  h: number;
  cssString: string;
  /** OKLCH requested by the ramp before gamut mapping. */
  requested: OklchTriple;
  /** Whether gamut mapping changed the requested color. */
  mapped: boolean;
  /** Independent 8-bit sRGB fallback hex used for contrast measurement. */
  hex: string;
  /** True when the mapped color also fits inside sRGB. */
  inSrgb: boolean;
  /** Target gamut the token was mapped into. */
  target: GamutTarget;
}

export interface PaletteAdjustment {
  token: PaletteTokenName;
  pairing: string;
  property: "lightness";
  from: number;
  to: number;
  delta: number;
  reason: string;
}

export interface PaletteContrastPairing {
  pairing: string;
  foreground: PaletteTokenName;
  background: PaletteTokenName;
  kind: "text" | "ui";
  requiredRatio: number;
  ratio: number;
  ratioExact: number;
  grade: string;
  passed: boolean;
  apcaLc: number;
  apcaAbs: number;
  apcaGuidance: string;
  /** sRGB fallback colors the ratio was measured from. */
  fgHex: string;
  bgHex: string;
  adjusted: boolean;
}

export interface PaletteTokens {
  mood: PaletteMood;
  baseHue: number;
  target: GamutTarget;
  contrastTarget: ContrastTarget;
  correctionMode: CorrectionMode;
  lightnessMode: LightnessMode;
  chromaProfile: ChromaProfile;
  status: "success" | "partial" | "blocked";
  tokens: Record<PaletteTokenName, PaletteToken>;
  ramps: {
    surface: RampStop[];
    text: RampStop[];
    accent: RampStop[];
  };
  contrastAnalysis: {
    primaryTextOnBg: PaletteContrastPairing;
    secondaryTextOnBg: PaletteContrastPairing;
    mutedTextOnBg: PaletteContrastPairing;
    accentOnSurface: PaletteContrastPairing;
    /** Every audited pairing (text x surface plus UI pairings). */
    fullAudit: PaletteContrastPairing[];
    failedPairings: string[];
    adjustments: PaletteAdjustment[];
  };
  warnings: string[];
  cssVariables: string;
}

export interface GeneratePaletteOptions extends PaletteRampOptions {
  mood?: PaletteMood;
  baseHue?: number;
  target?: GamutTarget;
  contrastTarget?: ContrastTarget;
  correctionMode?: CorrectionMode;
  /** Maximum lightness delta a correction may apply to a single token. */
  maxCorrectionDelta?: number;
}

function requiredRatioFor(target: ContrastTarget, kind: "text" | "ui"): number | null {
  if (target === "none") return null;
  if (kind === "ui") return WCAG_THRESHOLDS.uiComponent;
  switch (target) {
    case "aaa":
      return WCAG_THRESHOLDS.normalTextAAA;
    case "aa-large":
      return WCAG_THRESHOLDS.largeTextAA;
    case "aa":
    default:
      return WCAG_THRESHOLDS.normalTextAA;
  }
}

interface PairingDefinition {
  id: string;
  foreground: PaletteTokenName;
  background: PaletteTokenName;
  kind: "text" | "ui";
}

const TEXT_TOKENS: PaletteTokenName[] = ["textPrimary", "textSecondary", "textMuted"];
const SURFACE_TOKENS: PaletteTokenName[] = ["bgSurface", "bgElevated", "bgSubtle"];

function pairingDefinitions(): PairingDefinition[] {
  const defs: PairingDefinition[] = [];
  for (const text of TEXT_TOKENS) {
    for (const surface of SURFACE_TOKENS) {
      defs.push({
        id: `${text}On${capitalize(surface)}`,
        foreground: text,
        background: surface,
        kind: "text"
      });
    }
  }
  defs.push({ id: "accentOnSurface", foreground: "accentPrimary", background: "bgSurface", kind: "ui" });
  defs.push({ id: "accentOnElevated", foreground: "accentPrimary", background: "bgElevated", kind: "ui" });
  defs.push({ id: "borderActiveOnSurface", foreground: "borderActive", background: "bgSurface", kind: "ui" });
  return defs;
}

function capitalize(token: string): string {
  return token.charAt(0).toUpperCase() + token.slice(1);
}

function measurePairing(
  def: PairingDefinition,
  tokens: Record<PaletteTokenName, PaletteToken>,
  required: number | null
): PaletteContrastPairing {
  const fg = tokens[def.foreground];
  const bg = tokens[def.background];
  const wcag = calculateContrastRatio(fg.hex, bg.hex);
  const apca = apcaForHexPair(fg.hex, bg.hex);
  return {
    pairing: def.id,
    foreground: def.foreground,
    background: def.background,
    kind: def.kind,
    requiredRatio: required ?? 0,
    ratio: wcag.ratio,
    ratioExact: wcag.ratioExact,
    grade: wcag.grade,
    passed: required === null ? true : wcag.ratioExact >= required,
    apcaLc: apca.lc,
    apcaAbs: apca.abs,
    apcaGuidance: apcaGuidance(apca.abs),
    fgHex: fg.hex,
    bgHex: bg.hex,
    adjusted: false
  };
}

function exportToken(requested: OklchTriple, target: GamutTarget): PaletteToken {
  const mapped = mapToGamut(requested.l, requested.c, requested.h, target);
  const rounded = roundOklchForCss(mapped.oklch.l, mapped.oklch.c, mapped.oklch.h, target);
  // Re-map from the serialized (rounded) values so the exported token, its
  // hex fallback and the contrast audit all describe the same color.
  const exported = mapToGamut(rounded.l, rounded.c, rounded.h, target);
  return {
    l: rounded.l,
    c: rounded.c,
    h: rounded.h,
    cssString: oklchToCssString(rounded.l, rounded.c, rounded.h),
    requested,
    mapped: mapped.mapped || rounded.adjusted,
    hex: exported.hex,
    inSrgb: exported.inSrgb,
    target
  };
}

/**
 * Evaluate the raw (unmapped) ramp value at a position.
 *
 * Interpolation happens on the REQUESTED ramp values; gamut mapping is applied
 * once by `exportToken`. Interpolating already-mapped stops would silently
 * distort the ramp for out-of-gamut colors.
 */
function stopAt(spec: RampSpec, position: number, options: RampOptionsFull): OklchTriple {
  const t = Math.max(0, Math.min(1, position));
  const easedT =
    options.lightnessMode === "eased" && options.easing
      ? cubicBezierEasing(t, options.easing)
      : t;
  const l = spec.lightnessStart + easedT * (spec.lightnessEnd - spec.lightnessStart);
  const cT =
    spec.chromaProfile === "eased" && options.easing ? cubicBezierEasing(t, options.easing) : t;
  const c = chromaAt(spec.chromaProfile, spec.chromaStart, spec.chromaEnd, cT);
  const h = normalizeHue(spec.hueStart + t * (spec.hueEnd - spec.hueStart));
  return { l, c, h };
}

function buildTokens(spec: PaletteSpec, options: RampOptionsFull): Record<PaletteTokenName, PaletteToken> {
  const surface = (name: keyof PaletteSpec["positions"]): PaletteToken =>
    exportToken(stopAt(spec.surfaceRamp, spec.positions[name], options), options.target);
  const text = (name: keyof PaletteSpec["textPositions"]): PaletteToken =>
    exportToken(stopAt(spec.textRamp, spec.textPositions[name], options), options.target);
  const accentAt = (name: keyof PaletteSpec["accentPositions"]): OklchTriple =>
    stopAt(spec.accentRamp, spec.accentPositions[name], options);

  const accentPrimary = exportToken(accentAt("accentPrimary"), options.target);
  const accentSecondary = exportToken(accentAt("accentSecondary"), options.target);
  const glowRequest = accentAt("accentGlow");
  const borderRequest = accentAt("borderActive");

  return {
    bgSurface: surface("bgSurface"),
    bgElevated: surface("bgElevated"),
    bgSubtle: surface("bgSubtle"),
    textPrimary: text("textPrimary"),
    textSecondary: text("textSecondary"),
    textMuted: text("textMuted"),
    accentPrimary,
    accentSecondary,
    accentGlow: exportToken(
      { ...glowRequest, c: glowRequest.c * spec.accentChromaFactor.accentGlow },
      options.target
    ),
    borderSubtle: surface("borderSubtle"),
    borderActive: exportToken(
      { ...borderRequest, c: borderRequest.c * spec.accentChromaFactor.borderActive },
      options.target
    )
  };
}

/**
 * Correct a token's lightness until every pairing it participates in meets the
 * required ratio, moving away from the paired surface lightness. Hue and
 * chroma are preserved; lightness is clamped to the ramp's documented limits
 * and to `maxCorrectionDelta`.
 */
function correctTokenLightness(
  tokens: Record<PaletteTokenName, PaletteToken>,
  tokenName: PaletteTokenName,
  pairings: PaletteContrastPairing[],
  required: number | null,
  direction: "away",
  limit: { min: number; max: number },
  maxDelta: number,
  options: RampOptionsFull,
  adjustments: PaletteAdjustment[],
  adjustedTokens: Set<PaletteTokenName>
): boolean {
  if (required === null) return true;

  const token = tokens[tokenName];
  const relevant = pairings.filter((p) => p.foreground === tokenName);
  if (relevant.length === 0) return true;

  const startL = token.l;
  const target = tokens[relevant[0]!.background];
  // "away" means: on a dark surface move lighter, on a light surface move darker.
  const moveUp = target.l < 0.5;
  const extreme = moveUp ? limit.max : limit.min;
  const boundLo = moveUp ? startL : limit.min;
  const boundHi = moveUp ? limit.max : startL;
  const maxReach = moveUp ? startL + maxDelta : startL - maxDelta;
  const upperBound = Math.min(boundHi, maxReach);
  const lowerBound = Math.max(boundLo, startL - (moveUp ? 0 : maxDelta));

  let candidate = startL;
  let lo = lowerBound;
  let hi = upperBound;

  // Smallest lightness change that satisfies every pairing for this token.
  for (let i = 0; i < 40; i += 1) {
    const mid = (lo + hi) / 2;
    const probe = exportToken({ l: mid, c: token.c, h: token.h }, options.target);
    const probeTokens = { ...tokens, [tokenName]: probe };
    const allPass = relevant.every((p) => {
      const bg = probeTokens[p.background];
      return exactContrastRatio(probe.hex, bg.hex) >= required;
    });
    if (allPass) {
      hi = mid;
      candidate = mid;
    } else {
      lo = mid;
    }
  }

  if (Math.abs(candidate - startL) < 1e-4) {
    return false;
  }

  const corrected = exportToken({ l: candidate, c: token.c, h: token.h }, options.target);
  tokens[tokenName] = corrected;
  adjustedTokens.add(tokenName);

  for (const pairing of relevant) {
    adjustments.push({
      token: tokenName,
      pairing: pairing.pairing,
      property: "lightness",
      from: startL,
      to: corrected.l,
      delta: Number((corrected.l - startL).toFixed(4)),
      reason: `Adjusted lightness by ${(corrected.l - startL).toFixed(3)} to reach the requested contrast target ${required}:1 on ${pairing.background}. The correction itself changes only lightness (hue and chroma are unchanged); gamut mapping for the ${options.target} gamut may still reduce chroma.`
    });
  }
  void direction;
  void extreme;
  return true;
}

function applyRampOverrides(
  base: RampSpec,
  kind: RampName,
  overrides: PaletteRampOptions
): RampSpec {
  const local = overrides[kind] ?? {};
  const next: RampSpec = {
    ...base,
    steps: local.steps ?? overrides.steps ?? base.steps,
    chromaProfile: local.chromaProfile ?? overrides.chromaProfile ?? base.chromaProfile,
    lightnessStart: local.lightnessStart ?? base.lightnessStart,
    lightnessEnd: local.lightnessEnd ?? base.lightnessEnd,
    chromaStart: local.chromaStart ?? base.chromaStart,
    chromaEnd: local.chromaEnd ?? base.chromaEnd,
    hueStart: local.hueStart ?? base.hueStart,
    hueEnd: local.hueEnd ?? base.hueEnd
  };
  validateRampSpec(next, kind);
  return next;
}

function validateRampSpec(spec: RampSpec, kind: string): void {
  if (!Number.isInteger(spec.steps) || spec.steps < 2 || spec.steps > 32) {
    throw new RangeError(
      `Ramp '${kind}' steps must be an integer between 2 and 32 (received ${spec.steps}).`
    );
  }
  for (const [name, value] of [
    ["lightnessStart", spec.lightnessStart],
    ["lightnessEnd", spec.lightnessEnd]
  ] as Array<[string, number]>) {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new RangeError(
        `Ramp '${kind}' ${name} must be a finite number in [0, 1] (received ${value}).`
      );
    }
  }
  for (const [name, value] of [
    ["chromaStart", spec.chromaStart],
    ["chromaEnd", spec.chromaEnd]
  ] as Array<[string, number]>) {
    if (!Number.isFinite(value) || value < 0 || value > 0.5) {
      throw new RangeError(
        `Ramp '${kind}' ${name} must be a finite number in [0, 0.5] (received ${value}).`
      );
    }
  }
}

/**
 * Generate a full OKLCH palette: semantic tokens, perceptual ramps and a
 * complete contrast audit with optional lightness-only correction.
 */
export function generatePalette(
  mood: PaletteMood = "editorial",
  customHue?: number,
  overrides: GeneratePaletteOptions = {}
): PaletteTokens {
  const preset: PaletteSpec =
    mood === "bespoke" ? MOOD_PRESETS.editorial : MOOD_PRESETS[mood];
  const baseHue = overrides.baseHue ?? customHue ?? preset.baseHue;

  const rotateHue = (spec: RampSpec): RampSpec => {
    const rotated: RampSpec = {
      ...spec,
      hueStart: normalizeHue(spec.hueStart + (baseHue - preset.baseHue)),
      hueEnd: normalizeHue(spec.hueEnd + (baseHue - preset.baseHue))
    };
    return rotated;
  };

  const target = overrides.target ?? "srgb";
  const lightnessMode = overrides.lightnessMode ?? "equal";
  const easing = overrides.lightnessEasing ?? null;
  const contrastTarget = overrides.contrastTarget ?? "aa";
  const correctionMode = overrides.correctionMode ?? "text-lightness";
  const maxCorrectionDelta = overrides.maxCorrectionDelta ?? 0.35;

  const surfaceRamp = applyRampOverrides(rotateHue(preset.surfaceRamp), "surface", overrides);
  const textRamp = applyRampOverrides(rotateHue(preset.textRamp), "text", overrides);
  const accentRamp = applyRampOverrides(rotateHue(preset.accentRamp), "accent", overrides);

  const options: RampOptionsFull = {
    steps: overrides.steps ?? surfaceRamp.steps,
    lightnessMode,
    easing,
    target
  };

  const spec: PaletteSpec = {
    ...preset,
    mood,
    baseHue,
    surfaceRamp,
    textRamp,
    accentRamp,
    textLimit: preset.textLimit
  };

  const tokens = buildTokens(spec, options);
  const defs = pairingDefinitions();

  const requiredText = requiredRatioFor(contrastTarget, "text");
  const requiredUi = requiredRatioFor(contrastTarget, "ui");

  let pairings = defs.map((def) =>
    measurePairing(def, tokens, def.kind === "text" ? requiredText : requiredUi)
  );

  const adjustments: PaletteAdjustment[] = [];
  const adjustedTokens = new Set<PaletteTokenName>();
  const warnings: string[] = [];

  if (correctionMode !== "none") {
    const surfaceDark = tokens.bgSurface.l < 0.5;
    const textLimit = surfaceDark ? spec.textLimit.light : spec.textLimit.dark;
    const ordered: PaletteTokenName[] = surfaceDark
      ? ["textMuted", "textSecondary", "textPrimary"]
      : ["textPrimary", "textSecondary", "textMuted"];

    for (const tokenName of ordered) {
      const ok = correctTokenLightness(
        tokens,
        tokenName,
        pairings,
        requiredText,
        "away",
        { min: Math.min(spec.textLimit.dark, spec.textLimit.light), max: textLimit },
        maxCorrectionDelta,
        options,
        adjustments,
        adjustedTokens
      );
      if (!ok) {
        warnings.push(
          `${tokenName} could not reach the requested ${contrastTarget.toUpperCase()} target within the allowed lightness range; failing pairings are reported.`
        );
      }
      pairings = defs.map((def) =>
        measurePairing(def, tokens, def.kind === "text" ? requiredText : requiredUi)
      );
    }

    if (correctionMode === "both") {
      for (const tokenName of ["accentPrimary", "borderActive"] as PaletteTokenName[]) {
        const ok = correctTokenLightness(
          tokens,
          tokenName,
          pairings,
          requiredUi,
          "away",
          { min: 0.02, max: 0.98 },
          maxCorrectionDelta,
          options,
          adjustments,
          adjustedTokens
        );
        if (!ok) {
          warnings.push(
            `${tokenName} could not reach the UI contrast target of ${requiredUi}:1 within the allowed lightness range.`
          );
        }
        pairings = defs.map((def) =>
          measurePairing(def, tokens, def.kind === "text" ? requiredText : requiredUi)
        );
      }
    }
  }

  pairings = pairings.map((p) => ({
    ...p,
    adjusted: adjustedTokens.has(p.foreground)
  }));

  const failedPairings = pairings.filter((p) => !p.passed).map((p) => p.pairing);
  const status: PaletteTokens["status"] =
    failedPairings.length === 0 ? "success" : adjustedTokens.size > 0 ? "partial" : "blocked";

  if (failedPairings.length > 0) {
    warnings.push(
      `${failedPairings.length} pairing(s) below the requested ${contrastTarget.toUpperCase()} target: ${failedPairings.join(", ")}.`
    );
  }

  const find = (id: string): PaletteContrastPairing => {
    const found = pairings.find((p) => p.pairing === id);
    if (!found) {
      throw new Error(`Internal palette error: missing pairing ${id}`);
    }
    return found;
  };

  const primaryTextOnBg = find("textPrimaryOnBgSurface");
  const secondaryTextOnBg = find("textSecondaryOnBgSurface");
  const mutedTextOnBg = find("textMutedOnBgSurface");
  const accentOnSurface = find("accentOnSurface");

  const ramps = {
    surface: buildRamp(spec.surfaceRamp, options),
    text: buildRamp(spec.textRamp, options),
    accent: buildRamp(spec.accentRamp, options)
  };

  const cssVariables = buildCssVariables(mood, tokens, baseHue);

  return {
    mood,
    baseHue,
    target,
    contrastTarget,
    correctionMode,
    lightnessMode,
    chromaProfile: accentRamp.chromaProfile,
    status,
    tokens,
    ramps,
    contrastAnalysis: {
      primaryTextOnBg,
      secondaryTextOnBg,
      mutedTextOnBg,
      accentOnSurface,
      fullAudit: pairings,
      failedPairings,
      adjustments
    },
    warnings,
    cssVariables
  };
}

function buildCssVariables(
  mood: PaletteMood,
  tokens: Record<PaletteTokenName, PaletteToken>,
  baseHue: number
): string {
  const t = tokens;
  return `
:root {
  /* Ink Design OKLCH Palette — [${mood.toUpperCase()} | hue ${Math.round(baseHue)}°] */
  --ink-bg-surface: ${t.bgSurface.cssString};
  --ink-bg-elevated: ${t.bgElevated.cssString};
  --ink-bg-subtle: ${t.bgSubtle.cssString};

  --ink-text-primary: ${t.textPrimary.cssString};
  --ink-text-secondary: ${t.textSecondary.cssString};
  --ink-text-muted: ${t.textMuted.cssString};

  --ink-accent-primary: ${t.accentPrimary.cssString};
  --ink-accent-secondary: ${t.accentSecondary.cssString};
  --ink-accent-glow: ${t.accentGlow.cssString};

  --ink-border-subtle: ${t.borderSubtle.cssString};
  --ink-border-active: ${t.borderActive.cssString};

  /* sRGB fallbacks for browsers without OKLCH support (measured by the audit) */
  --ink-bg-surface-fallback: ${t.bgSurface.hex};
  --ink-text-primary-fallback: ${t.textPrimary.hex};
  --ink-text-secondary-fallback: ${t.textSecondary.hex};
  --ink-text-muted-fallback: ${t.textMuted.hex};
  --ink-accent-primary-fallback: ${t.accentPrimary.hex};

  /* Physics-based layered shadows (Anti-AI-Slop) */
  --ink-shadow-sm: 0 1px 2px -1px rgba(0, 0, 0, 0.4);
  --ink-shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.35), 0 2px 4px -2px rgba(0, 0, 0, 0.3);
  --ink-shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.4), 0 4px 6px -4px rgba(0, 0, 0, 0.35);
  --ink-shadow-glow: 0 0 25px -5px ${t.accentGlow.cssString};

  /* Tactile Micro-interaction Transition */
  --ink-ease-spring: cubic-bezier(0.16, 1, 0.3, 1);
  --ink-duration-fast: 150ms;
  --ink-duration-normal: 260ms;
}
`.trim();
}

export { classifyContrastRatio };