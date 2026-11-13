import {
  ValidateDesignInput,
  ValidateDesignInputSchema,
  ValidateDesignOutputSchema,
  ReadOnlyAnnotations
} from "../contracts/index.js";
import { validateDesignCraft } from "../domain/verification/design-validator.js";
import { calculateContrastRatio } from "../domain/design-tokens/color-math.js";
import {
  apcaForHexPair,
  apcaGuidance,
  apcaGuidanceForFont,
  APCA_ALGORITHM_VERSION
} from "../domain/design-tokens/apca.js";
import { auditLogicalProperties, auditOpticalCentering } from "../domain/bidi/logical-properties.js";
import { createSuccessEnvelope, ResultEnvelope } from "../core/result-envelope.js";

export const validateTool = {
  name: "ink_validate_design",
  title: "Validate Design Craft & Contrast Compliance",
  description:
    "PURPOSE: Evaluate HTML and CSS against anti-AI-slop heuristics, measure WCAG 2.1 contrast on the supplied color pair, report APCA 0.98G contrast, and audit RTL/LTR logical properties and optical centering.\n\n" +
    "BEHAVIOR: Executes in-memory static analysis on the supplied code strings. Completely read-only with zero filesystem writes, no network requests, and deterministic scoring. Contrast is computed with the WCAG relative-luminance formula on the FULL-PRECISION ratio: pass/fail booleans use the exact ratio while the displayed `ratio` value is rounded to two decimals, so a pair such as #148700 on #000000 (exact 4.4953, displayed 4.50) correctly FAILS normal-text AA. APCA uses the reference 0.98G equations (APCA-specific luminance, black soft clamp, polarity exponents, low-contrast clipping and offsets) with no arbitrary output clamp.\n\n" +
    "FLAGS: `checkBidi` toggles the logical-property audit. `checkCentering` toggles the optical centering / horizontal overflow audit (centered body copy, 100vw overflow, oversized fixed widths, auto margins without max-width, over-tight tracking); when disabled the audit is skipped and reported as null. `textFontSizePx`/`textFontWeight` enable font-size/weight-aware APCA guidance from the published lookup table (APCA font lookup, Public Beta 0.1.7 (G); basis \"apca-0.1.7-G-lookup\"). `textUse` (\"large\" by default; \"body\" applies APCA's documented +15 Lc adjustment below Lc 70; \"non-text\" uses the raw Lc) selects the table row, weights snap to the nearest published column, and the 999/777 sentinel codes never pass for real text.\n\n" +
    "USAGE GUIDELINES:\n" +
    "- When to use: after creating or modifying layouts, components, or stylesheets to verify craft quality, contrast compliance, bidi readiness, and centering before committing.\n" +
    "- When NOT to use: JavaScript security scanning (ink_audit_security), browser screenshots (ink_capture_viewport), or whole-system audits (ink_generate_palette_tokens).\n" +
    "- Alternatives: ink_audit_security for security/XSS checks; ink_capture_viewport for visual verification.\n\n" +
    "RETURNS: ResultEnvelope containing 'craftScore', 'craftGrade', 'isHighCraft', 'antiSlopChecks', the exact/displayed 'contrast' report with WCAG flags and APCA guidance, 'bidiAndAlignment', 'centeringAudit' and prioritized 'remediationAdvice'.",
  annotations: ReadOnlyAnnotations,
  inputSchema: ValidateDesignInputSchema,
  outputSchema: ValidateDesignOutputSchema,
  execute: async (rawInput: unknown): Promise<ResultEnvelope<unknown>> => {
    const input: ValidateDesignInput = ValidateDesignInputSchema.parse(rawInput);
    const craft = validateDesignCraft(input.code);
    const contrast = calculateContrastRatio(input.foregroundHex, input.backgroundHex);
    const apca = apcaForHexPair(input.foregroundHex, input.backgroundHex);
    const simplifiedTier = apcaGuidance(apca.abs);
    const bidiReport = input.checkBidi ? auditLogicalProperties(input.code) : null;
    const centeringReport = input.checkCentering ? auditOpticalCentering(input.code) : null;

    const fontAware =
      input.textFontSizePx !== undefined
        ? apcaGuidanceForFont({
            lc: apca.lc,
            fontSizePx: input.textFontSizePx,
            fontWeight: input.textFontWeight ?? 400,
            // APCA's own note: body-text use requires Lc + 15 below 70.
            use: input.textUse
          })
        : undefined;

    const isHighCraft =
      craft.score >= 75 &&
      contrast.normalTextAA &&
      (bidiReport ? bidiReport.score >= 70 : true) &&
      (centeringReport ? centeringReport.passed : true);

    const summaryParts = [
      `Craft Grade [${craft.grade}] (${craft.score}/100)`,
      `Contrast: ${contrast.ratio}:1 [${contrast.grade}]`,
      `APCA: ${apca.lc} Lc (${APCA_ALGORITHM_VERSION}, simplified tier ${simplifiedTier})`
    ];
    if (bidiReport) {
      summaryParts.push(`Bidi/Logical: ${bidiReport.score}/100`);
    }
    if (centeringReport) {
      summaryParts.push(`Centering: ${centeringReport.passed ? "passed" : "issues found"}`);
    }

    const antiSlopChecks = Object.entries(craft.antiSlopChecks).map(([check, passed]) => ({
      check,
      passed
    }));

    const warnings: string[] = [];
    if (simplifiedTier === "Fail") {
      warnings.push(
        `APCA |Lc| = ${apca.abs} is below the simplified 45 Lc large-text reading level; the APCA specification's font-size lookup would require a larger size.`
      );
    }
    if (centeringReport && !centeringReport.passed) {
      warnings.push(
        `Optical centering audit flagged: ${centeringReport.checks.filter((c) => !c.passed).map((c) => c.check).join(", ")}.`
      );
    }

    return createSuccessEnvelope(
      `Design validation complete: ${summaryParts.join(" | ")}.`,
      {
        craftScore: craft.score,
        craftGrade: craft.grade,
        isHighCraft,
        antiSlopChecks,
        contrast: {
          foreground: input.foregroundHex,
          background: input.backgroundHex,
          ratio: contrast.ratio,
          ratioExact: contrast.ratioExact,
          grade: contrast.grade,
          wcagAAA: contrast.normalTextAAA,
          wcagAA: contrast.normalTextAA,
          wcagLargeAA: contrast.largeTextAA,
          wcagUIAA: contrast.uiComponentAA,
          apca: {
            lc: apca.lc,
            lcExact: apca.lcExact,
            abs: apca.abs,
            polarity: apca.polarity,
            simplifiedTier,
            fontAware: fontAware
              ? {
                  minFontSizePx: fontAware.minFontSizePx,
                  passes: fontAware.passes,
                  tier: fontAware.tier,
                  lookupLcRow: fontAware.lookupLcRow,
                  lookupWeight: fontAware.lookupWeight,
                  clampedToTable: fontAware.clampedToTable,
                  basis: fontAware.basis,
                  reference: fontAware.reference,
                  note: fontAware.note
                }
              : undefined
          }
        },
        bidiAndAlignment: bidiReport,
        centeringAudit: centeringReport,
        strengths: craft.strengths,
        remediationAdvice: [
          ...craft.remediationAdvice,
          ...(bidiReport?.findings.map((f) => `Replace '${f.property}' with '${f.recommended}': ${f.reason}`) || []),
          ...(centeringReport?.checks
            .filter((c) => !c.passed)
            .map((c) => `${c.check}: ${c.recommendation}`) || [])
        ]
      },
      {
        warnings: isHighCraft ? [] : [...warnings, "Refinements needed to reach Grade A/S craft standard."],
        nextActions: isHighCraft
          ? [
              "Ready for production.",
              "Run ink_capture_viewport to generate 16:9, 9:16, and mobile visual snapshots."
            ]
          : [
              ...craft.remediationAdvice,
              "Re-run this tool after applying the remediation advice."
            ]
      }
    );
  }
};