/**
 * Zod Schemas and Public Contract Definitions for all MCP tools.
 *
 * Contract rules enforced here:
 * - Strict `ink_<verb>_<noun>` tool naming (see server.ts).
 * - Every parameter documents its constraints and interactions.
 * - Output schemas describe the *successful* payload shape. Execution
 *   failures are returned as proper MCP error results (`isError: true`)
 *   without `structuredContent`, so a failed run can never masquerade as a
 *   schema-valid success payload (see server.ts `formatToolResult`).
 */

import { z } from "zod";

// ============================================================================
// Tool Annotation Hints (MCP 2025-11-25 / SEP Specification)
// ============================================================================

export interface ToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export const ReadOnlyAnnotations: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false
};

export const OpenWorldReadOnlyAnnotations: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true
};

/** Writes snapshot files to disk and can fetch remote URLs. */
export const ViewportCaptureAnnotations: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true
};

/**
 * Dispatches to actions that may write files (capture) and fetch remote
 * resources (inspect), so it cannot be advertised as read-only/closed-world.
 */
export const MixedActionAnnotations: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true
};

// ============================================================================
// Shared primitives
// ============================================================================

export const GamutTargetSchema = z
  .enum(["srgb", "p3"])
  .describe("Gamut target for mapping and export: 'srgb' or 'p3' (display-p3)");

export const OklchTripleSchema = z.object({
  l: z.number().min(0).max(1).describe("OKLCH lightness 0-1"),
  c: z.number().min(0).max(0.5).describe("OKLCH chroma 0-0.5"),
  h: z.number().min(0).max(360).describe("OKLCH hue angle in degrees")
});

export const CubicBezierSchema = z
  .array(z.number())
  .length(4)
  .describe(
    "Cubic-Bezier easing control points [x1, y1, x2, y2] with x in [0,1] and y unconstrained; evaluated as a real curve (B_x(s) = t solved, B_y(s) returned)"
  );

export const ContrastTargetSchema = z
  .enum(["aa", "aaa", "aa-large", "none"])
  .describe(
    "Contrast target applied to text pairings: 'aa' = 4.5:1 normal text, 'aaa' = 7:1, 'aa-large' = 3:1 large text, 'none' = report only. UI component pairings always use 3:1."
  );

export const CorrectionModeSchema = z
  .enum(["none", "text-lightness", "both"])
  .describe(
    "Correction mode: 'none' = report only; 'text-lightness' = adjust failing text tokens' OKLCH lightness (hue and chroma preserved); 'both' = also adjust accent/border tokens"
  );

/** Envelope schema generator for successful payloads. */
export function createEnvelopeOutputSchema<T extends z.ZodTypeAny>(dataSchema: T) {
  return z.object({
    status: z
      .enum(["success", "partial", "blocked", "failed"])
      .describe("Execution outcome status. 'partial'/'blocked' mean the tool ran but could not satisfy every requested constraint."),
    summary: z.string().describe("Concise, human-readable executive summary of the tool outcome"),
    data: dataSchema.describe("Domain-specific typed payload returned by the tool"),
    warnings: z.array(z.string()).describe("Operational cautions, craft advice, or non-blocking warnings"),
    evidence: z
      .object({
        inputsDigest: z.string().optional(),
        sources: z
          .array(z.object({ label: z.string(), uri: z.string().optional(), retrievedAt: z.string().optional() }))
          .optional(),
        artifacts: z
          .array(z.object({ label: z.string(), uri: z.string().optional(), sha256: z.string().optional() }))
          .optional()
      })
      .optional()
      .describe("Audit trail, source references, and generated artifact locations"),
    nextActions: z.array(z.string()).optional().describe("Actionable sequential recommendations or subsequent tool suggestions")
  });
}

// ============================================================================
// 1. ink_create_base (Verb: create, Noun: base)
// ============================================================================

export const CreateBaseInputSchema = z.object({
  projectName: z
    .string()
    .default("ink-craft-app")
    .describe("Name of the web application or project folder (used in document title and manifest metadata)"),
  designStyle: z
    .enum(["editorial", "cyber-tactile", "neo-brutalist", "luxury-dark", "organic-modern"])
    .default("editorial")
    .describe("Aesthetic foundation archetype governing OKLCH color harmonies, typography ratios, and border radius"),
  direction: z
    .enum(["rtl", "ltr", "auto"])
    .default("auto")
    .describe("Document writing direction: 'rtl' sets dir='rtl' for Arabic, 'ltr' for English, 'auto' configures bidirectional CSS logical properties"),
  language: z
    .enum(["ar", "en", "bilingual"])
    .default("bilingual")
    .describe("Primary language mode: 'ar' optimizes Arabic optical hierarchy, 'en' optimizes Latin, 'bilingual' isolates bidi text with <bdi> chips"),
  arabicFont: z
    .enum(["ibm-plex", "cairo-display", "tajawal-modern", "readex-tech", "amiri-editorial"])
    .default("ibm-plex")
    .describe("Curated Arabic font family loaded from Google Fonts; pairs with Latin typography with matching optical x-height"),
  includeThreeJs: z
    .boolean()
    .default(false)
    .describe("When true, mounts a responsive WebGL Three.js canvas in the hero section and includes CDN script tags"),
  includePwaMeta: z
    .boolean()
    .default(true)
    .describe("When true, injects mobile viewport constraints, theme-color meta tags, and color-scheme dark/light preferences")
});
export type CreateBaseInput = z.infer<typeof CreateBaseInputSchema>;

export const CreateBaseOutputDataSchema = z.object({
  projectName: z.string(),
  designStyle: z.string(),
  direction: z.string(),
  language: z.string(),
  files: z.record(z.string(), z.string()).describe("In-memory project files mapping (e.g. index.html, styles.css, main.js, manifest.json)"),
  tokens: z.record(z.string(), z.unknown()),
  arabicTypography: z.record(z.string(), z.unknown()).nullable(),
  threeJsConfig: z.record(z.string(), z.unknown()).nullable()
}).passthrough();

export const CreateBaseOutputSchema = createEnvelopeOutputSchema(CreateBaseOutputDataSchema);
export type CreateBaseOutput = z.infer<typeof CreateBaseOutputSchema>;

// ============================================================================
// 2. ink_generate_palette_tokens (Verb: generate, Noun: palette_tokens)
// ============================================================================

const RampEndpointOverridesSchema = z
  .object({
    lightnessStart: z.number().min(0).max(1).optional().describe("Ramp start OKLCH lightness (0-1)"),
    lightnessEnd: z.number().min(0).max(1).optional().describe("Ramp end OKLCH lightness (0-1)"),
    chromaStart: z.number().min(0).max(0.5).optional().describe("Chroma at ramp position 0 (0-0.5)"),
    chromaEnd: z.number().min(0).max(0.5).optional().describe("Chroma at ramp position 1 (0-0.5)"),
    chromaProfile: z
      .enum(["constant", "linear", "bell", "eased"])
      .optional()
      .describe("Chroma shape along the ramp: 'constant', 'linear', 'bell' (peak at midpoint), or 'eased' (uses the easing curve)"),
    hueStart: z.number().min(0).max(360).optional().describe("Hue at ramp position 0 in degrees"),
    hueEnd: z.number().min(0).max(360).optional().describe("Hue at ramp position 1 in degrees (linear, not shortest-arc)"),
    steps: z.number().int().min(2).max(32).optional().describe("Stop count for this ramp (2-32)")
  })
  .describe("Per-ramp endpoint overrides; omitted fields keep the mood preset value");

export const PaletteTokensInputSchema = z
  .object({
    mood: z
      .enum(["editorial", "cyber-tactile", "neo-brutalist", "luxury-dark", "organic-modern"])
      .default("editorial")
      .describe("Creative aesthetic mood determining surface depths, text luminance steps, and brand accents"),
    baseHue: z
      .number()
      .min(0)
      .max(360)
      .optional()
      .describe("Optional hue angle (0-360) that replaces the preset hue (hue rotation is applied to every ramp)"),
    target: GamutTargetSchema.default("srgb").describe("Gamut target used for token mapping, exports and the contrast audit"),
    rampSteps: z
      .number()
      .int()
      .min(2)
      .max(32)
      .optional()
      .describe("Number of stops per perceptual ramp (2-32). Equal-lightness steps by default."),
    lightnessMode: z
      .enum(["equal", "eased"])
      .default("equal")
      .describe("Lightness interpolation: 'equal' = uniform OKLCH lightness increments; 'eased' = cubic-Bezier eased curve"),
    lightnessEasing: CubicBezierSchema.optional().describe(
      "Cubic-Bezier control points used when lightnessMode = 'eased' (evaluated as a real curve)"
    ),
    chromaProfile: z
      .enum(["constant", "linear", "bell", "eased"])
      .optional()
      .describe("Global chroma profile applied to every ramp unless overridden per ramp"),
    ramps: z
      .object({
        surface: RampEndpointOverridesSchema.optional(),
        text: RampEndpointOverridesSchema.optional(),
        accent: RampEndpointOverridesSchema.optional()
      })
      .optional()
      .describe("Optional per-ramp endpoint overrides for the surface, text and accent ramps"),
    contrastTarget: ContrastTargetSchema.default("aa").describe("Contrast target applied to every audited text pairing"),
    correctionMode: CorrectionModeSchema.default("text-lightness").describe(
      "Contrast correction policy. Adjustments only change OKLCH lightness (hue and chroma preserved) and are fully reported."
    ),
    maxCorrectionDelta: z
      .number()
      .min(0)
      .max(0.5)
      .default(0.35)
      .describe("Maximum lightness change a correction may apply to a single token (0-0.5)"),
    includeTypography: z
      .boolean()
      .default(true)
      .describe("When true, includes fluid clamp() typography scale tokens"),
    typographyBasePx: z.number().min(1).max(200).default(16).describe("Geometric typography base size in px (size(0) = basePx)"),
    typographyRatio: z.number().min(1).max(3).default(1.25).describe("Geometric typography ratio: size(n) = basePx * ratio^n"),
    typographyStepRange: z
      .array(z.number().int())
      .length(2)
      .default([-1, 5])
      .describe("Geometric typography step indices as [min, max] (max >= min)"),
    rootFontPx: z.number().min(1).max(64).default(16).describe("Root font size used for all rem conversions"),
    includeArabicTokens: z
      .boolean()
      .default(true)
      .describe("When true, includes Arabic optical line-heights (1.75-1.85), Arabic font stacks and bidi fallbacks in the CSS output"),
    minVw: z
      .number()
      .min(200)
      .max(800)
      .default(360)
      .describe("Minimum fluid viewport width in px (200-800); drives clamp() lower bound"),
    maxVw: z
      .number()
      .min(801)
      .max(2560)
      .default(1440)
      .describe("Maximum fluid viewport width in px (801-2560); must be greater than minVw"),
    spacingBase: z.number().min(1).max(200).default(16).describe("Base spacing step in px (modular ratio anchor)"),
    spacingRatio: z.number().min(1).max(4).default(1.25).describe("Modular spacing ratio; must be >= 1 for a monotonic scale"),
    spacingFluid: z.boolean().default(false).describe("When true, emits fluid clamp() spacing tokens scaled between minVw and maxVw"),
    spacingFluidMinFactor: z
      .number()
      .gt(0)
      .lte(1)
      .default(0.85)
      .describe("Lower fluid bound of each spacing step as a fraction of the step value (0-1]")
  })
  .refine((input) => input.maxVw > input.minVw, {
    message: "maxVw must be strictly greater than minVw (equal or reversed bounds produce an infinite slope)",
    path: ["maxVw"]
  });
export type PaletteTokensInput = z.infer<typeof PaletteTokensInputSchema>;

export const ContrastPairingSchema = z.object({
  pairing: z.string().describe("Stable pairing identifier (e.g. textMutedOnBgSurface)"),
  foreground: z.string().describe("Semantic foreground token name"),
  background: z.string().describe("Semantic background token name"),
  kind: z.enum(["text", "ui"]).describe("'text' pairings use the contrast target; 'ui' pairings always require 3:1"),
  requiredRatio: z.number().describe("Threshold this pairing is measured against (0 when target = none)"),
  ratio: z.number().describe("Display-rounded WCAG contrast ratio (2 decimals)"),
  ratioExact: z.number().describe("Full-precision WCAG contrast ratio used for pass/fail decisions"),
  grade: z.enum(["AAA", "AA", "AA Large", "Fail"]).describe("WCAG grade derived from the exact ratio"),
  passed: z.boolean().describe("True when ratioExact >= requiredRatio"),
  apcaLc: z.number().describe("Signed APCA 0.98G Lc (negative = light text on dark background)"),
  apcaAbs: z.number().describe("Absolute |Lc| value"),
  apcaGuidance: z.enum(["Body", "Large", "Fail"]).describe("Simplified font-size-agnostic APCA tier"),
  fgHex: z.string().describe("Exported sRGB fallback hex measured as the foreground"),
  bgHex: z.string().describe("Exported sRGB fallback hex measured as the background"),
  adjusted: z.boolean().describe("True when correction mode changed the foreground lightness for this pairing")
});

export const PaletteAdjustmentSchema = z.object({
  token: z.string(),
  pairing: z.string(),
  property: z.literal("lightness"),
  from: z.number(),
  to: z.number(),
  delta: z.number(),
  reason: z.string()
});

export const PaletteTokenExportSchema = z.object({
  oklch: z.string().describe("Gamut-mapped OKLCH value written to CSS"),
  requestedOklch: OklchTripleSchema,
  hex: z.string().describe("Independent 8-bit sRGB fallback hex (used by the contrast audit)"),
  mapped: z.boolean().describe("True when gamut mapping or serialization rounding changed the requested color"),
  inSrgb: z.boolean(),
  target: GamutTargetSchema
});

export const RampStopSchema = z.object({
  t: z.number(),
  oklch: OklchTripleSchema,
  css: z.string(),
  hex: z.string(),
  mapped: z.boolean()
});

export const TypographyStepSchema = z.object({
  name: z.string(),
  minPx: z.number(),
  maxPx: z.number(),
  clampCss: z.string(),
  lineHeight: z.number(),
  letterSpacing: z.string()
});

export const SpacingTokenSchema = z.object({
  px: z.number(),
  rem: z.string(),
  clamp: z.string().optional(),
  fluidMinPx: z.number().optional(),
  n: z.number().optional()
});

export const PaletteTokensOutputDataSchema = z.object({
  mood: z.string(),
  baseHue: z.number(),
  target: GamutTargetSchema,
  contrastTarget: ContrastTargetSchema,
  correctionMode: CorrectionModeSchema,
  status: z.enum(["success", "partial", "blocked"]).describe("Whether every audited pairing met the requested target"),
  tokens: z.record(z.string(), z.string()).describe("Dictionary of semantic CSS token names to gamut-mapped OKLCH values"),
  tokenExports: z.record(z.string(), PaletteTokenExportSchema).describe("Per-token export detail incl. sRGB fallbacks and mapping flags"),
  ramps: z
    .object({
      surface: z.array(RampStopSchema),
      text: z.array(RampStopSchema),
      accent: z.array(RampStopSchema)
    })
    .describe("Perceptual ramps: equal OKLCH lightness increments or the configured eased curve"),
  contrastAnalysis: z
    .array(ContrastPairingSchema)
    .describe("Every audited pairing (all text x surface combinations plus accent/border UI pairings)"),
  failedPairings: z.array(z.string()).describe("Pairing ids that did not reach the requested contrast target"),
  adjustments: z.array(PaletteAdjustmentSchema).describe("Every lightness adjustment applied by the correction mode"),
  typographyScale: z.record(z.string(), z.unknown()).optional(),
  geometricTypography: z.record(z.string(), z.unknown()).optional().describe("size(n) = basePx * ratio^n scale"),
  cssVariables: z.string().describe("Ready-to-paste CSS block with :root variables, semantic color tokens and sRGB fallbacks"),
  spacingScale: z.record(z.string(), SpacingTokenSchema).optional().describe("Modular spacing scale tokens with px/rem/clamp values"),
  spacingCss: z.string().optional().describe("Ready-to-paste CSS block with :root spacing variables"),
  arabicTokens: z
    .record(z.string(), z.unknown())
    .nullable()
    .optional()
    .describe("Arabic typography tokens (present only when includeArabicTokens = true, otherwise null)"),
  apcaSummary: z.record(z.string(), z.unknown()).optional().describe("APCA 0.98G Lc summary per pairing (WCAG 2.1 + APCA)")
}).passthrough();

export const PaletteTokensOutputSchema = createEnvelopeOutputSchema(PaletteTokensOutputDataSchema);
export type PaletteTokensOutput = z.infer<typeof PaletteTokensOutputSchema>;

// ============================================================================
// 3. ink_craft_component (Verb: craft, Noun: component)
// ============================================================================

export const CraftComponentInputSchema = z.object({
  componentType: z
    .enum(["hero-section", "glass-card", "tactile-button", "navigation-bar", "metrics-grid", "modal-dialog"])
    .default("hero-section")
    .describe("Type of bespoke UI component to synthesize"),
  title: z.string().default("Craft Architecture").describe("Primary headline or action label of the component"),
  description: z.string().default("Engineered with optical precision").describe("Subheading or explanatory body copy"),
  direction: z
    .enum(["rtl", "ltr", "auto"])
    .default("auto")
    .describe("Writing direction; 'auto' enforces CSS logical properties (margin-inline, inset-inline)"),
  interactivePhysics: z
    .boolean()
    .default(true)
    .describe("When true, attaches mouse spring drag, ripple physics, and keyboard navigation handlers")
});
export type CraftComponentInput = z.infer<typeof CraftComponentInputSchema>;

export const CraftComponentOutputDataSchema = z.object({
  componentType: z.string(),
  html: z.string().describe("Semantic HTML5 markup with ARIA roles and logical structure"),
  css: z.string().describe("Scoped CSS using logical properties, fluid clamp values, and OKLCH color tokens"),
  js: z.string().describe("Tactile micro-interaction JavaScript with automatic teardown"),
  accessibilityNotes: z.array(z.string()).describe("Accessibility considerations and ARIA keyboard patterns")
}).passthrough();

export const CraftComponentOutputSchema = createEnvelopeOutputSchema(CraftComponentOutputDataSchema);
export type CraftComponentOutput = z.infer<typeof CraftComponentOutputSchema>;

// ============================================================================
// 4. ink_build_threejs_experience (Verb: build, Noun: threejs_experience)
// ============================================================================

export const ThreeExperienceInputSchema = z.object({
  sceneType: z
    .enum(["particle-constellation", "geometric-wireframe", "morphing-mesh", "interactive-hero-canvas"])
    .default("particle-constellation")
    .describe("Type of 3D WebGL scene to generate with Three.js"),
  accentColorHex: z
    .string()
    .default("#38bdf8")
    .describe("Primary accent color in hex format (#RRGGBB) used for points, materials, and point lights"),
  particleCount: z
    .number()
    .min(100)
    .max(5000)
    .default(1200)
    .describe("Number of particle points (clamped between 100 and 5000 for GPU thermal and battery efficiency)"),
  enableMouseParallax: z
    .boolean()
    .default(true)
    .describe("When true, registers smooth pointer move listeners with lerp damping for gentle depth parallax")
});
export type ThreeExperienceInput = z.infer<typeof ThreeExperienceInputSchema>;

export const ThreeExperienceOutputDataSchema = z.object({
  sceneType: z.string(),
  html: z.string().describe("HTML canvas mounting container"),
  css: z.string().describe("Absolute full-bleed canvas styling with pointer-events isolation"),
  js: z.string().describe("Complete Three.js module code with initInkThreeScene, resize listener, and teardown disposal"),
  lifecycle: z
    .object({
      init: z.string(),
      renderLoop: z.string(),
      teardown: z.string()
    })
    .optional()
}).passthrough();

export const ThreeExperienceOutputSchema = createEnvelopeOutputSchema(ThreeExperienceOutputDataSchema);
export type ThreeExperienceOutput = z.infer<typeof ThreeExperienceOutputSchema>;

// ============================================================================
// 5. ink_generate_script_logic (Verb: generate, Noun: script_logic)
// ============================================================================

export const ScriptLogicInputSchema = z.object({
  pattern: z
    .enum(["state-store", "event-bus", "scroll-observer", "theme-toggle", "form-validator"])
    .default("state-store")
    .describe(
      "Architectural runtime pattern: 'state-store' (pub/sub state container), 'event-bus' (typed decoupled messaging), 'scroll-observer' (IntersectionObserver animator), 'theme-toggle' (dark/light/system switcher with persistence), 'form-validator' (real-time accessible field validation)"
    ),
  moduleName: z.string().default("AppStore").describe("Name of the exported JavaScript/TypeScript class or module"),
  typescript: z
    .boolean()
    .default(false)
    .describe("When true, emits strict TypeScript interfaces and generic typings alongside the implementation")
});
export type ScriptLogicInput = z.infer<typeof ScriptLogicInputSchema>;

export const ScriptLogicOutputDataSchema = z.object({
  pattern: z.string(),
  moduleName: z.string(),
  description: z.string(),
  code: z.string().describe("Zero-dependency ES module code with automatic teardown"),
  typescriptTypes: z.string().optional().describe("Companion TypeScript declarations"),
  usageExample: z.string().describe("Usage demonstration snippet showing initialization and consumption")
}).passthrough();

export const ScriptLogicOutputSchema = createEnvelopeOutputSchema(ScriptLogicOutputDataSchema);
export type ScriptLogicOutput = z.infer<typeof ScriptLogicOutputSchema>;

// ============================================================================
// 6. ink_audit_security (Verb: audit, Noun: security)
// ============================================================================

export const SecurityAuditInputSchema = z.object({
  code: z.string().describe("Source code string (HTML, JavaScript, or CSS) to inspect for client-side web vulnerabilities"),
  filename: z
    .string()
    .default("index.html")
    .describe("Virtual file path context for reporting findings (e.g. 'src/main.js' or 'index.html')")
});
export type SecurityAuditInput = z.infer<typeof SecurityAuditInputSchema>;

export const SecurityAuditOutputDataSchema = z.object({
  filename: z.string(),
  passed: z.boolean().describe("True if score >= 80 and zero critical or high vulnerabilities are detected"),
  securityScore: z.number().min(0).max(100).describe("Composite security score out of 100"),
  findingsSummary: z.object({
    critical: z.number(),
    high: z.number(),
    medium: z.number(),
    total: z.number()
  }),
  findings: z
    .array(
      z.object({
        id: z.string(),
        severity: z.enum(["critical", "high", "medium", "low", "info"]),
        category: z.string(),
        title: z.string(),
        description: z.string(),
        codeSnippet: z.string().optional(),
        line: z.number().optional(),
        recommendation: z.string()
      })
    )
    .describe("Granular list of identified vulnerabilities with line numbers and remediations"),
  recommendedCspHeader: z.string().describe("Hardened Content-Security-Policy header directive recommendation"),
  recommendedAuthPattern: z.string().describe("Secure client authentication storage recommendations")
}).passthrough();

export const SecurityAuditOutputSchema = createEnvelopeOutputSchema(SecurityAuditOutputDataSchema);
export type SecurityAuditOutput = z.infer<typeof SecurityAuditOutputSchema>;

// ============================================================================
// 7. ink_validate_design (Verb: validate, Noun: design)
// ============================================================================

export const ValidateDesignInputSchema = z.object({
  code: z
    .string()
    .describe("HTML and CSS code string to evaluate for anti-slop rules, typography scaling, and alignment"),
  foregroundHex: z
    .string()
    .default("#f8fafc")
    .describe("Primary foreground text color in hex format (#RRGGBB) to verify against surface"),
  backgroundHex: z
    .string()
    .default("#0b0f19")
    .describe("Surface background color in hex format (#RRGGBB) to verify contrast ratio against text"),
  checkBidi: z
    .boolean()
    .default(true)
    .describe("When true, audits CSS logical property compliance (e.g. flagging margin-left instead of margin-inline-start)"),
  checkCentering: z
    .boolean()
    .default(true)
    .describe(
      "When true, runs the optical centering and horizontal overflow audit (centered body copy, 100vw overflow, oversized fixed widths, auto margins without max-width, over-tight tracking). When false the audit is skipped and reported as null."
    ),
  textFontSizePx: z
    .number()
    .min(1)
    .max(400)
    .optional()
    .describe("Rendered font size in px of the verified text; enables font-size/weight-aware APCA guidance"),
  textFontWeight: z
    .number()
    .min(100)
    .max(900)
    .optional()
    .describe("Font weight (100-900) of the verified text; enables font-size/weight-aware APCA guidance"),
  textUse: z
    .enum(["body", "large", "non-text"])
    .optional()
    .describe(
      "Use case for the APCA font lookup. 'body' applies APCA's documented +15 Lc adjustment below Lc 70; 'large' and 'non-text' use the raw Lc"
    )
});
export type ValidateDesignInput = z.infer<typeof ValidateDesignInputSchema>;

export const ApcaGuidanceSchema = z.object({
  lc: z.number().describe("Signed APCA 0.98G Lc (negative = light text on dark background)"),
  lcExact: z.number().describe("Full-precision APCA Lc before display rounding"),
  abs: z.number().describe("Absolute |Lc| value"),
  polarity: z.enum(["normal", "reverse", "identical"]).describe("APCA branch used"),
  simplifiedTier: z.enum(["Body", "Large", "Fail"]).describe(
    "Font-size-agnostic simplified tier (|Lc| >= 60 Body, >= 45 Large). Provided for backward compatibility only; it does not use the published font-size/weight lookup (see `fontAware`)."
  ),
  fontAware: z
    .object({
      minFontSizePx: z.number().describe("Published APCA lookup minimum font size (999 = prohibited, 777 = non-text only)"),
      passes: z.boolean(),
      tier: z.enum(["Body", "Large", "Fail"]),
      lookupLcRow: z.number().describe("Lc level of the reference table row used"),
      lookupWeight: z.number().describe("Weight column used (snapped to a published weight)"),
      clampedToTable: z.boolean().describe("True when |Lc| exceeded the published table range"),
      basis: z.literal("apca-0.1.7-G-lookup"),
      reference: z.string().describe("Reference implementation and table version"),
      note: z.string()
    })
    .optional()
    .describe("Font-size/weight-aware guidance from the published APCA font lookup table; present only when textFontSizePx is provided.")
});

export const ValidateDesignOutputDataSchema = z.object({
  craftScore: z.number().min(0).max(100).describe("Overall design craftsmanship rating (0-100)"),
  craftGrade: z.string().describe("Letter grade (S, A, B, C, F)"),
  isHighCraft: z.boolean().describe("True if craftScore >= 75 and contrast passes WCAG AA"),
  antiSlopChecks: z.array(z.record(z.string(), z.unknown())).describe("Results for anti-slop rules"),
  contrast: z.object({
    foreground: z.string(),
    background: z.string(),
    ratio: z.number().describe("Display-rounded WCAG ratio (2 decimals)"),
    ratioExact: z.number().describe("Full-precision WCAG ratio used for pass/fail"),
    grade: z.string(),
    wcagAAA: z.boolean(),
    wcagAA: z.boolean(),
    wcagLargeAA: z.boolean(),
    wcagUIAA: z.boolean(),
    apca: ApcaGuidanceSchema.optional()
  }).describe("Mathematical WCAG contrast calculation results"),
  bidiAndAlignment: z.record(z.string(), z.unknown()).nullable().describe("CSS logical property audit details"),
  centeringAudit: z
    .object({
      passed: z.boolean(),
      checks: z.array(
        z.object({
          check: z.string(),
          passed: z.boolean(),
          severity: z.enum(["info", "warn"]),
          detail: z.string(),
          recommendation: z.string()
        })
      ),
      remediationSnippet: z.string()
    })
    .nullable()
    .describe("Optical centering and overflow audit; null when checkCentering = false"),
  strengths: z.array(z.string()).describe("Design elements adhering to high-craft principles"),
  remediationAdvice: z.array(z.string()).describe("Specific, actionable code edits to reach Grade A/S craft")
}).passthrough();

export const ValidateDesignOutputSchema = createEnvelopeOutputSchema(ValidateDesignOutputDataSchema);
export type ValidateDesignOutput = z.infer<typeof ValidateDesignOutputSchema>;

// ============================================================================
// 8. ink_run_python_tests (Verb: run, Noun: python_tests)
// ============================================================================

export const PythonRunnerInputSchema = z.object({
  action: z
    .enum(["contrast", "security", "visual", "audit", "full", "bidi", "inspect", "capture"])
    .default("full")
    .describe(
      "Verification action. 'capture' WRITES PNG/SVG snapshot files and 'inspect' FETCHES a remote URL, so this tool is not read-only or closed-world."
    ),
  code: z
    .string()
    .optional()
    .describe("Source code snippet to analyze (required when action is 'security', 'visual', 'audit', 'bidi', or 'full')"),
  target: z
    .string()
    .optional()
    .describe("Website URL or local HTML file path. Forwarded to the Python engine for the 'inspect' and 'capture' actions."),
  foregroundHex: z.string().optional().describe("Foreground text color in hex format (used when action is 'contrast')"),
  backgroundHex: z.string().optional().describe("Background surface color in hex format (used when action is 'contrast')")
});
export type PythonRunnerInput = z.infer<typeof PythonRunnerInputSchema>;

export const PythonContrastResultSchema = z.object({
  foreground: z.string(),
  background: z.string(),
  ratio: z.number().describe("Display-rounded WCAG ratio (2 decimals)"),
  ratio_exact: z.number().describe("Full-precision WCAG ratio used for classification"),
  luminance: z.object({ foreground: z.number(), background: z.number() }),
  wcag: z.object({
    normal_text_aa: z.boolean(),
    normal_text_aaa: z.boolean(),
    large_text_aa: z.boolean(),
    large_text_aaa: z.boolean(),
    ui_component_aa: z.boolean(),
    grade: z.enum(["AAA", "AA", "AA Large", "Fail"])
  }),
  apca: z
    .object({
      lc: z.number(),
      lc_exact: z.number(),
      abs: z.number(),
      polarity: z.string(),
      algorithm: z.string()
    })
    .optional()
    .describe("APCA 0.98G result computed with the reference equations")
});

export const PythonRunnerOutputDataSchema = z
  .object({
    contrast: PythonContrastResultSchema.optional(),
    visual_audit: z.record(z.string(), z.unknown()).optional(),
    security_lint: z.record(z.string(), z.unknown()).optional(),
    bidi_audit: z.record(z.string(), z.unknown()).optional(),
    contrast_check: PythonContrastResultSchema.optional(),
    extractedPalette: z.record(z.string(), z.unknown()).optional(),
    extractedTypography: z.record(z.string(), z.unknown()).optional(),
    snapshots: z.array(z.record(z.string(), z.unknown())).optional(),
    viewportQualityChecks: z.record(z.string(), z.unknown()).optional(),
    source: z.string().optional(),
    inferredArchetype: z.string().optional(),
    error: z.string().optional()
  })
  .describe("Structured outcomes from the Python ink_verifier engine (typed where known)");
export type PythonRunnerOutputData = z.infer<typeof PythonRunnerOutputDataSchema>;

export const PythonRunnerOutputSchema = createEnvelopeOutputSchema(PythonRunnerOutputDataSchema);
export type PythonRunnerOutput = z.infer<typeof PythonRunnerOutputSchema>;

// ============================================================================
// 9. ink_capture_viewport (Verb: capture, Noun: viewport)
// ============================================================================

export const CaptureViewportInputSchema = z.object({
  htmlOrUrl: z
    .string()
    .describe("HTML markup string, local file path (file:///index.html), or public HTTP/HTTPS URL to render and photograph"),
  title: z.string().default("Site Snapshot").describe("Human-readable label used for image naming and output organization"),
  outputDirectory: z
    .string()
    .optional()
    .describe("Target folder where 16:9, 9:16, and mobile snapshots are written (defaults to '.ink_snapshots')")
});
export type CaptureViewportInput = z.infer<typeof CaptureViewportInputSchema>;

export const CaptureViewportOutputDataSchema = z.object({
  title: z.string(),
  outputDirectory: z.string(),
  snapshots: z
    .array(
      z.object({
        label: z.string().describe("Viewport descriptor (e.g. 'Desktop Landscape (16:9)')"),
        viewport: z.string(),
        dimensions: z.string().describe("Exact pixel dimensions (e.g. '1920x1080')"),
        aspect_ratio: z.string(),
        filePath: z.string().describe("Absolute path to the saved snapshot file"),
        fileSize: z.number().optional().describe("Size of the file in bytes"),
        format: z.string().optional().describe("Snapshot format ('png' or 'svg' fallback)")
      })
    )
    .describe("List of captured viewport images"),
  layoutMetrics: z.record(z.string(), z.unknown()).optional().describe("Computed scrollWidth, scrollHeight, and overflow metrics"),
  browserDetected: z.boolean().optional().describe("Whether a local Chromium/Edge/Chrome executable was found")
}).passthrough();

export const CaptureViewportOutputSchema = createEnvelopeOutputSchema(CaptureViewportOutputDataSchema);
export type CaptureViewportOutput = z.infer<typeof CaptureViewportOutputSchema>;

// ============================================================================
// 10. ink_inspect_website_style (Verb: inspect, Noun: website_style)
// ============================================================================

export const InspectWebsiteStyleInputSchema = z.object({
  urlOrCode: z
    .string()
    .describe("Public website URL (e.g. 'https://stripe.com') or raw HTML/CSS code snippet to reverse-engineer"),
  extractOklchPalette: z
    .boolean()
    .default(true)
    .describe(
      "When true, converts every extracted color (hex, rgb()/rgba(), oklch()) into gamut-mapped OKLCH tokens using real color math for both inline code and URL inspection. When false, colors are returned as raw literals only."
    ),
  target: GamutTargetSchema.default("srgb").describe("Gamut target used when converting extracted colors to OKLCH")
});
export type InspectWebsiteStyleInput = z.infer<typeof InspectWebsiteStyleInputSchema>;

export const InspectedColorSchema = z.object({
  source: z.string().describe("Original color literal found in the source"),
  token: z.string().optional().describe("CSS custom property name when the color was declared as a token"),
  srgb: z.object({ r: z.number(), g: z.number(), b: z.number() }).describe("Normalized sRGB 0-1 channels"),
  oklch: OklchTripleSchema,
  hex: z.string().describe("Gamut-mapped sRGB fallback hex"),
  gamutMapped: z.boolean().describe("True when the source color required chroma reduction for the target gamut"),
  css: z.string().describe("Gamut-mapped OKLCH CSS value")
});

export const InspectWebsiteStyleOutputDataSchema = z.object({
  archetype: z.string().describe("Detected aesthetic archetype (editorial, luxury-dark, brutalist, cyber-tactile, organic)"),
  colors: z.array(z.string()).describe("Raw color literals in source order"),
  convertedColors: z.array(InspectedColorSchema).optional().describe("Colors converted to OKLCH with real color math (when extractOklchPalette = true)"),
  unsupportedColors: z.array(z.string()).optional().describe("Extracted literals that could not be converted (reported, never silently replaced)"),
  typography: z.record(z.string(), z.unknown()).describe("Detected font families, font sizes, line heights, and weights"),
  shadows: z.array(z.string()).describe("Extracted elevation shadow definitions"),
  layoutDna: z.record(z.string(), z.unknown()).describe("Layout DNA analysis (flexbox, grid, gap values, border radii)"),
  recommendedOklchPalette: z.string().optional().describe("CSS token block derived from the extracted colors"),
  oklchPaletteCss: z.string().optional().describe("Full :root block of every converted color")
}).passthrough();

export const InspectWebsiteStyleOutputSchema = createEnvelopeOutputSchema(InspectWebsiteStyleOutputDataSchema);
export type InspectWebsiteStyleOutput = z.infer<typeof InspectWebsiteStyleOutputSchema>;

// ============================================================================
// 11. ink_import_custom_assets (Verb: import, Noun: custom_assets)
// ============================================================================

export const ImportCustomAssetsInputSchema = z.object({
  primaryFont: z
    .string()
    .default("IBM Plex Sans Arabic")
    .describe("Primary font family name to import (e.g. 'IBM Plex Sans Arabic', 'Inter', 'Outfit')"),
  displayFont: z
    .string()
    .optional()
    .describe("Optional display/headline font family name (e.g. 'Amiri', 'Playfair Display', 'Clash Display')"),
  weights: z
    .array(z.number())
    .default([400, 500, 600, 700])
    .describe("Array of numeric font weights to import (e.g. [400, 600, 700])"),
  includeArabic: z
    .boolean()
    .default(true)
    .describe("When true, loads Arabic character subsets, sets optical line heights (1.7-1.85), and adds bidi fallbacks")
});
export type ImportCustomAssetsInput = z.infer<typeof ImportCustomAssetsInputSchema>;

export const ImportCustomAssetsOutputDataSchema = z.object({
  primaryFont: z.string(),
  displayFont: z.string().optional(),
  htmlLinkTags: z.string().describe("Preconnect and Google Fonts <link> tags ready for HTML <head>"),
  cssImportRule: z.string().describe("CSS @import statement for stylesheets"),
  cssVariables: z.string().describe("CSS font-family and line-height custom property variables"),
  fallbackStack: z.string().describe("Accessible system fallback font stack")
}).passthrough();

export const ImportCustomAssetsOutputSchema = createEnvelopeOutputSchema(ImportCustomAssetsOutputDataSchema);
export type ImportCustomAssetsOutput = z.infer<typeof ImportCustomAssetsOutputSchema>;

// ============================================================================
// 12. ink_generate_gradient (Verb: generate, Noun: gradient)
// ============================================================================

export const AuthoredStopSchema = z.object({
  oklch: OklchTripleSchema.describe("Stop color in OKLCH"),
  position: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe("Explicit stop position in [0, 1]. Defaults to i / (count - 1). Positions must be non-decreasing."),
  alpha: z.number().min(0).max(1).optional().describe("Stop alpha in [0, 1]; below 1 switches interpolation to premultiplied mode")
});

export const GradientInputSchema = z
  .object({
    fromOklch: OklchTripleSchema.optional().describe(
      "Starting OKLCH color triple. Required unless an authored `stops` array is supplied."
    ),
    toOklch: OklchTripleSchema.optional().describe(
      "Ending OKLCH color triple. Required unless an authored `stops` array is supplied."
    ),
    stops: z
      .array(AuthoredStopSchema)
      .min(2)
      .max(16)
      .optional()
      .describe("Authored stop list with explicit positions (2-16). Overrides fromOklch/toOklch when provided."),
    steps: z
      .number()
      .int()
      .min(2)
      .max(16)
      .default(5)
      .describe("Number of interpolated stops (integer 2-16). Fractional values are rejected, not floored."),
    interpolationSpace: z
      .enum(["oklch", "oklab"])
      .default("oklch")
      .describe("Interpolation space: 'oklch' (polar, hue-path aware) or 'oklab' (rectangular). CSS interpolation is always explicit (`in oklch` / `in oklab`)."),
    huePath: z
      .enum(["shorter", "longer", "increasing", "decreasing"])
      .default("shorter")
      .describe("Hue interpolation path: 'shorter' arc in (-180,180], 'longer' arc in [180,540), 'increasing' positive delta, 'decreasing' negative delta"),
    direction: z.string().default("to right").describe("CSS linear-gradient direction (e.g. 'to right', '135deg')"),
    target: GamutTargetSchema.default("srgb").describe("Gamut target for chroma mapping and the primary export"),
    gamutValidationSamples: z
      .number()
      .int()
      .min(8)
      .max(512)
      .default(64)
      .describe("Number of uniform positions used for SAMPLED gamut validation (8-512). Sampled validation does not prove every point of the continuous gradient is in gamut."),
    contrastForegroundHex: z
      .string()
      .optional()
      .describe("Optional foreground hex to sample contrast against the gradient; reports every sample plus the worst case"),
    contrastSamplePositions: z
      .array(z.number())
      .min(1)
      .max(64)
      .optional()
      .describe("Explicit sample positions in [0,1] for the contrast report (defaults to the emitted stop positions)"),
    contrastTarget: ContrastTargetSchema.default("aa").describe(
      "Contrast target applied to the gradient contrast report"
    ),
    contrastBackdropHex: z
      .string()
      .default("#ffffff")
      .describe(
        "Underlying canvas color (hex) that transparent gradient stops are composited over before contrast is measured (default white). WCAG/APCA are defined on opaque colors, so a transparent gradient cannot be measured without this context."
      )
  })
  .refine(
    (input) => Boolean(input.stops && input.stops.length >= 2) || Boolean(input.fromOklch && input.toOklch),
    { message: "Provide either both fromOklch and toOklch, or a stops array with at least 2 entries", path: ["stops"] }
  );
export type GradientInput = z.infer<typeof GradientInputSchema>;

export const GradientStopOutputSchema = z.object({
  t: z.number(),
  position: z.number(),
  oklch: OklchTripleSchema,
  alpha: z.number(),
  hex: z.string().describe("Independent sRGB fallback hex (never Display P3 channels)"),
  hexWithAlpha: z.string(),
  srgb: z.object({ r: z.number(), g: z.number(), b: z.number() }).describe("sRGB 0-1 channels"),
  channels: z.object({ r: z.number(), g: z.number(), b: z.number() }).describe("Channels in the TARGET gamut (P3 channels when target = p3)"),
  css: z.string().describe("Target-gamut CSS color (oklch(...) or color(display-p3 r g b))"),
  srgbCss: z.string(),
  clipped: z.boolean(),
  inGamut: z.boolean()
});

export const GradientOutputDataSchema = z.object({
  stops: z.array(GradientStopOutputSchema).describe("Gamut-mapped gradient stops with dual sRGB/P3 export data"),
  css: z.string().describe("Ready-to-paste CSS linear-gradient in the target gamut with explicit `in oklch|oklab` interpolation"),
  cssSrgb: z.string().describe("Same gradient using independently mapped sRGB colors (hex stops)"),
  cssP3: z.string().describe("Same gradient using independently mapped Display P3 colors"),
  hexes: z.array(z.string()).describe("Hex ramp of the interpolated stops (sRGB fallbacks)"),
  target: GamutTargetSchema,
  interpolationSpace: z.enum(["oklch", "oklab"]),
  huePath: z.enum(["shorter", "longer", "increasing", "decreasing"]),
  direction: z.string(),
  gamut: z.object({
    policy: z.literal("sampled"),
    samplesChecked: z.number(),
    allSamplesInGamut: z.boolean(),
    mappedSamples: z.number(),
    maxDeltaEOK: z.number(),
    note: z.string()
  }),
  contrast: z
    .object({
      foregroundHex: z.string(),
      backdropHex: z.string().describe("Canvas color used for alpha compositing (default #ffffff)"),
      compositedAlpha: z.boolean().describe("True when any sampled position had alpha < 1 and was composited"),
      positions: z.array(z.number()),
      samples: z.array(
        z.object({
          position: z.number(),
          backgroundHex: z.string().describe("Composited background actually measured"),
          backgroundHexOpaque: z.string().describe("Gradient color as an opaque sRGB fallback"),
          backgroundAlpha: z.number(),
          backdropHex: z.string(),
          ratio: z.number(),
          ratioExact: z.number(),
          grade: z.string(),
          normalTextAA: z.boolean(),
          normalTextAAA: z.boolean(),
          apcaLc: z.number(),
          apcaAbs: z.number(),
          apcaGuidance: z.string(),
          inTargetGamut: z.boolean()
        })
      ),
      worstCase: z.record(z.string(), z.unknown()),
      requiredRatio: z.number(),
      meetsTarget: z.boolean(),
      target: z.number().nullable(),
      policy: z.string()
    })
    .optional()
}).passthrough();

export const GradientOutputSchema = createEnvelopeOutputSchema(GradientOutputDataSchema);
export type GradientOutput = z.infer<typeof GradientOutputSchema>;

// ============================================================================
// 13. ink_generate_spacing_scale (Verb: generate, Noun: spacing_scale)
// ============================================================================

export const SpacingInputSchema = z
  .object({
    basePx: z.number().min(1).max(400).default(16).describe("Base spacing step in px (modular ratio anchor)"),
    ratio: z
      .number()
      .min(1)
      .max(4)
      .default(1.25)
      .describe("Modular spacing ratio. Must be >= 1 so the scale increases monotonically."),
    fluid: z.boolean().default(false).describe("When true, emits fluid clamp() tokens scaled between minVw and maxVw"),
    minVw: z.number().min(200).max(800).default(360).describe("Minimum fluid viewport width in px (200-800)"),
    maxVw: z.number().min(801).max(2560).default(1440).describe("Maximum fluid viewport width in px (801-2560); must exceed minVw"),
    fluidMinFactor: z.number().gt(0).lte(1).default(0.85).describe("Lower fluid bound as a fraction of each step value (0-1]"),
    rootFontPx: z.number().min(1).max(64).default(16).describe("Root font size used for rem conversion"),
    steps: z
      .array(z.object({ name: z.string().min(1), n: z.number().int() }))
      .min(2)
      .max(24)
      .optional()
      .describe("Custom step definitions (2-24). When omitted the nine-step 3xs..3xl preset is used."),
    stepCount: z
      .number()
      .int()
      .min(2)
      .max(24)
      .optional()
      .describe("Alternative to `steps`: generate this many steps centred on the base size")
  })
  .refine((input) => input.maxVw > input.minVw, {
    message: "maxVw must be strictly greater than minVw",
    path: ["maxVw"]
  });
export type SpacingInput = z.infer<typeof SpacingInputSchema>;

export const SpacingOutputDataSchema = z.object({
  tokens: z.record(z.string(), SpacingTokenSchema).describe("Spacing scale tokens with px/rem/clamp values"),
  css: z.string().describe("Ready-to-paste CSS block with :root spacing variables"),
  basePx: z.number(),
  ratio: z.number(),
  rootFontPx: z.number(),
  fluidMinFactor: z.number(),
  viewport: z.object({ minVw: z.number(), maxVw: z.number() })
}).passthrough();

export const SpacingOutputSchema = createEnvelopeOutputSchema(SpacingOutputDataSchema);
export type SpacingOutput = z.infer<typeof SpacingOutputSchema>;

// ============================================================================
// 14. ink_generate_fluid_scale (Verb: generate, Noun: fluid_scale)
// ============================================================================

export const FluidEntrySchema = z.object({
  name: z.string().min(1).describe("Token name (e.g. 'display' or 'gap-md')"),
  minPx: z.number().gt(0).describe("Minimum size in px at minViewportPx"),
  maxPx: z.number().gt(0).describe("Maximum size in px at maxViewportPx")
});

export const FluidScaleInputSchema = z
  .object({
    entries: z
      .array(FluidEntrySchema)
      .max(32)
      .optional()
      .describe("Explicit token list (up to 32). When omitted a single anonymous entry is generated from minSizePx/maxSizePx."),
    minSizePx: z.number().gt(0).default(16).describe("Minimum size in px for the anonymous/default entry"),
    maxSizePx: z.number().gt(0).default(32).describe("Maximum size in px for the anonymous/default entry"),
    minViewportPx: z.number().gt(0).max(800).default(360).describe("Minimum viewport width in px (must be > 0)"),
    maxViewportPx: z.number().gt(0).max(4000).default(1440).describe("Maximum viewport width in px; must be strictly greater than minViewportPx"),
    rootFontPx: z.number().gt(0).max(64).default(16).describe("Root font size used for all rem conversions"),
    unit: z.enum(["rem", "px"]).default("rem").describe("Serialization unit for the clamp bounds"),
    remPrecision: z.number().int().min(0).max(6).optional().describe("Decimal places for rem terms (default 5)"),
    vwPrecision: z.number().int().min(0).max(6).optional().describe("Decimal places for the vw term (default 4)")
  })
  .refine((input) => input.maxViewportPx > input.minViewportPx, {
    message: "maxViewportPx must be strictly greater than minViewportPx (equal or reversed bounds produce an infinite slope)",
    path: ["maxViewportPx"]
  })
  .refine(
    (input) => !input.entries || input.entries.every((entry) => entry.maxPx >= entry.minPx),
    { message: "Every entry must satisfy maxPx >= minPx", path: ["entries"] }
  );
export type FluidScaleInput = z.infer<typeof FluidScaleInputSchema>;

export const FluidScaleValueSchema = z.object({
  name: z.string(),
  minPx: z.number(),
  maxPx: z.number(),
  slope: z.number(),
  intercept: z.number(),
  clampCss: z.string(),
  valueAtMinViewportPx: z.number(),
  valueAtMaxViewportPx: z.number(),
  endpointErrorPx: z.object({ atMin: z.number(), atMax: z.number() })
});

export const FluidScaleOutputDataSchema = z.object({
  values: z.array(FluidScaleValueSchema).describe("One entry per token with the exact slope/intercept and endpoint verification"),
  css: z.string().describe("Ready-to-paste :root CSS block"),
  rootFontPx: z.number(),
  unit: z.enum(["rem", "px"]),
  viewport: z.object({ minViewportPx: z.number(), maxViewportPx: z.number() }),
  endpointTolerancePx: z.number().describe("Documented rounding tolerance used for endpoint verification"),
  containsInvalidNumbers: z.literal(false).describe("Always false: invalid numeric inputs are rejected before generation")
}).passthrough();

export const FluidScaleOutputSchema = createEnvelopeOutputSchema(FluidScaleOutputDataSchema);
export type FluidScaleOutput = z.infer<typeof FluidScaleOutputSchema>;