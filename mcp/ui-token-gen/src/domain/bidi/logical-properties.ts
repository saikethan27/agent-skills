/**
 * CSS Logical Properties & Optical Alignment Auditor (TypeScript Domain)
 * Enforces modern Bi-directional (RTL/LTR) standards, detects centering abuse and overflow leaks.
 */

export interface LogicalPropertyFinding {
  property: string;
  recommended: string;
  reason: string;
}

export interface BidiAlignmentReport {
  score: number; // 0 - 100
  isFullyLogical: boolean;
  hasArabicContent: boolean;
  hasLatinContent: boolean;
  isBilingual: boolean;
  bidiIsolationPassed: boolean;
  opticalAlignmentPassed: boolean;
  findings: LogicalPropertyFinding[];
  remediationSnippet: string;
}

export interface OpticalCenteringFinding {
  check: string;
  passed: boolean;
  severity: "info" | "warn";
  detail: string;
  recommendation: string;
}

export interface OpticalCenteringReport {
  /** True only when every centering/overflow check passed. */
  passed: boolean;
  checks: OpticalCenteringFinding[];
  remediationSnippet: string;
}

/**
 * Optical centering and horizontal overflow audit.
 *
 * This is the check controlled by `ink_validate_design.checkCentering`:
 * turning the flag off skips the audit entirely (the tool reports null),
 * turning it on runs every rule below.
 */
/**
 * True when `text-align: center` is applied to paragraph-level content, either
 * through a CSS rule (`p { ... }`, `p, li { ... }`) or an inline style on a
 * <p>/<li> element.
 */
function hasCenteredParagraphText(source: string): boolean {
  const matches = [...source.matchAll(/text-align\s*:\s*center/gi)];
  for (const match of matches) {
    const index = match.index ?? 0;
    const before = source.slice(Math.max(0, index - 200), index);
    // Inline style: <p ... style="text-align:center">
    if (/<\s*(p|li)\b[^<>]*$/i.test(before)) return true;
    // CSS rule: selector list ending in p/li immediately before the declaration
    if (/(?:^|[;{}])\s*(?:[\w.#[\]=&:>~+*"-]+\s*,\s*)*(?:p|li)\s*(,[^{]*)?\{[^}]*$/i.test(before)) {
      return true;
    }
  }
  return false;
}

export function auditOpticalCentering(sourceCssOrHtml: string): OpticalCenteringReport {
  const checks: OpticalCenteringFinding[] = [];

  const paragraphCentered = hasCenteredParagraphText(sourceCssOrHtml);
  checks.push({
    check: "noParagraphTextCenter",
    passed: !paragraphCentered,
    severity: "warn",
    detail: paragraphCentered
      ? "Body text is centered. Centered paragraphs are hard to scan and hurt readability."
      : "No centered paragraph text found.",
    recommendation: paragraphCentered
      ? "Use text-align: start for body copy and reserve centering for short headings."
      : "Keep body copy left/start aligned."
  });

  const viewportWidthUnits = /(?<![\w-])(100vw|100svw|100dvw)(?![\w-])/.test(sourceCssOrHtml);
  checks.push({
    check: "noViewportWidthOverflow",
    passed: !viewportWidthUnits,
    severity: "warn",
    detail: viewportWidthUnits
      ? "100vw/100svw/100dvw width includes the scrollbar gutter and can cause horizontal overflow."
      : "No viewport-relative width units that overflow on scrollbar-gutter layouts.",
    recommendation: viewportWidthUnits
      ? "Use width: 100% or max-width with margin-inline: auto instead of 100vw."
      : "Keep using percentage widths."
  });

  const fixedLargeWidth = /(?<![\w-])(width|min-width)\s*:\s*(\d{4,})px/.test(sourceCssOrHtml);
  checks.push({
    check: "noFixedLargeWidth",
    passed: !fixedLargeWidth,
    severity: "info",
    detail: fixedLargeWidth
      ? "A fixed pixel width of 1000px or more is used; it will overflow most viewports."
      : "No oversized fixed pixel widths detected.",
    recommendation: fixedLargeWidth
      ? "Replace fixed widths with max-width in rem plus a fluid fallback."
      : "Keep widths fluid."
  });

  const autoMarginWithoutMaxWidth =
    /margin-inline\s*:\s*auto/.test(sourceCssOrHtml) &&
    !/max-width/.test(sourceCssOrHtml);
  checks.push({
    check: "autoMarginHasMaxWidth",
    passed: !autoMarginWithoutMaxWidth,
    severity: "info",
    detail: autoMarginWithoutMaxWidth
      ? "margin-inline: auto without a max-width cannot optically center content."
      : "Auto margins are paired with a max-width, or no auto margin is used.",
    recommendation: autoMarginWithoutMaxWidth
      ? "Add max-width (for example 75rem) next to margin-inline: auto."
      : "No change needed."
  });

  const negativeLetterSpacingOnBody =
    /letter-spacing\s*:\s*-[\d.]+em/.test(sourceCssOrHtml) &&
    /font-size\s*:\s*([\d.]+)(rem|em)/.test(sourceCssOrHtml);
  checks.push({
    check: "letterSpacingNotOverTight",
    passed: !negativeLetterSpacingOnBody,
    severity: "info",
    detail: negativeLetterSpacingOnBody
      ? "Tight negative letter-spacing is applied where relative (rem/em) font sizes are used."
      : "No risky tight tracking detected.",
    recommendation: negativeLetterSpacingOnBody
      ? "Reserve negative tracking for large display sizes only."
      : "No change needed."
  });

  const passed = checks.every((check) => check.passed);
  return {
    passed,
    checks,
    remediationSnippet: `
/* Ink Design Optical Centering Boilerplate */
.container {
  width: 100%;
  max-width: 75rem;
  margin-inline: auto;
  padding-inline: 1.5rem;
}

/* Avoid 100vw (scrollbar gutter overflow) and center only short headings */
.page {
  width: 100%;
  overflow-x: clip;
}
.heading { text-align: center; }
.prose { text-align: start; }
`.trim()
  };
}

export function auditLogicalProperties(sourceCssOrHtml: string): BidiAlignmentReport {
  const findings: LogicalPropertyFinding[] = [];

  const checks = [
    {
      regex: /\bmargin-left\b/i,
      property: "margin-left",
      recommended: "margin-inline-start",
      reason: "Hardcoded margin-left does not flip automatically in RTL contexts."
    },
    {
      regex: /\bmargin-right\b/i,
      property: "margin-right",
      recommended: "margin-inline-end",
      reason: "Hardcoded margin-right does not flip automatically in RTL contexts."
    },
    {
      regex: /\bpadding-left\b/i,
      property: "padding-left",
      recommended: "padding-inline-start",
      reason: "Hardcoded padding-left breaks symmetric gutters across RTL and LTR."
    },
    {
      regex: /\bpadding-right\b/i,
      property: "padding-right",
      recommended: "padding-inline-end",
      reason: "Hardcoded padding-right breaks symmetric gutters across RTL and LTR."
    },
    {
      regex: /text-align:\s*left\b/i,
      property: "text-align: left",
      recommended: "text-align: start",
      reason: "text-align: left fails to align Arabic text to the right naturally."
    }
  ];

  for (const check of checks) {
    if (check.regex.test(sourceCssOrHtml)) {
      findings.push({
        property: check.property,
        recommended: check.recommended,
        reason: check.reason
      });
    }
  }

  const hasArabicContent = /[\u0600-\u06FF]/.test(sourceCssOrHtml);
  const hasLatinContent = /[a-zA-Z]/.test(sourceCssOrHtml);
  const isBilingual = hasArabicContent && hasLatinContent;

  const bidiIsolationPassed = !isBilingual || sourceCssOrHtml.includes("<bdi") || sourceCssOrHtml.includes("unicode-bidi");
  const opticalAlignmentPassed = !/p\s*\{[^}]*text-align:\s*center/i.test(sourceCssOrHtml);

  let score = 100 - findings.length * 10;
  if (!bidiIsolationPassed) score -= 10;
  if (!opticalAlignmentPassed) score -= 10;
  score = Math.max(0, Math.min(100, score));

  const isFullyLogical = findings.length === 0;

  const remediationSnippet = `
/* Ink Design Logical Properties Boilerplate */
[dir="rtl"], [dir="ltr"] {
  /* Use logical inline margins and paddings */
  margin-inline-start: auto;
  margin-inline-end: auto;
  padding-inline: 1.5rem;
  text-align: start;
}

/* Bidi Isolation for Mixed Language Chips & Numbers */
bdi, .ink-bidi-isolate {
  unicode-bidi: isolate;
  direction: ltr; /* Keeps latin terms/codes aligned */
}
`.trim();

  return {
    score,
    isFullyLogical,
    hasArabicContent,
    hasLatinContent,
    isBilingual,
    bidiIsolationPassed,
    opticalAlignmentPassed,
    findings,
    remediationSnippet
  };
}
