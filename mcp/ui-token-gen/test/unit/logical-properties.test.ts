import { describe, it, expect } from "vitest";
import {
  auditLogicalProperties,
  auditOpticalCentering
} from "../../src/domain/bidi/logical-properties.js";

describe("CSS Logical Properties Auditor", () => {
  it("flags physical margin-left and padding-right in CSS", () => {
    const physicalCss = `
      .card {
        margin-left: 1.5rem;
        padding-right: 2rem;
        text-align: left;
      }
    `;

    const report = auditLogicalProperties(physicalCss);
    expect(report.isFullyLogical).toBe(false);
    expect(report.findings.length).toBeGreaterThanOrEqual(3);
    const props = report.findings.map((f) => f.property);
    expect(props).toContain("margin-left");
    expect(props).toContain("padding-right");
    expect(props).toContain("text-align: left");
    expect(report.remediationSnippet).toContain("margin-inline-start");
  });

  it("passes clean CSS using modern logical properties", () => {
    const logicalCss = `
      .card {
        margin-inline: auto;
        padding-inline-start: 1.5rem;
        text-align: start;
      }
    `;

    const report = auditLogicalProperties(logicalCss);
    expect(report.isFullyLogical).toBe(true);
    expect(report.score).toBe(100);
    expect(report.findings.length).toBe(0);
  });

  it("detects bilingual content without bidi isolation", () => {
    const mixed = "<div>\u0647\u0646\u062f\u0633\u0629 \u0627\u0644\u0648\u0628 Web Design</div>";
    const report = auditLogicalProperties(mixed);
    expect(report.isBilingual).toBe(true);
    expect(report.bidiIsolationPassed).toBe(false);
  });
});

describe("Optical centering & overflow audit (checkCentering)", () => {
  const failing = (code: string): string[] =>
    auditOpticalCentering(code)
      .checks.filter((check) => !check.passed)
      .map((check) => check.check);

  it("detects centered body copy in CSS rules, selector lists and inline styles", () => {
    expect(failing("p { text-align: center; }")).toContain("noParagraphTextCenter");
    expect(failing("p, li { text-align:center }")).toContain("noParagraphTextCenter");
    expect(failing("<p style='text-align:center'>x</p>")).toContain("noParagraphTextCenter");
    expect(failing('<p style="text-align: center;">x</p>')).toContain("noParagraphTextCenter");
  });

  it("does not flag centered headings or start-aligned body copy", () => {
    expect(failing("p { text-align: start; }")).toHaveLength(0);
    expect(failing("<p>plain</p>")).toHaveLength(0);
    expect(failing("h1 { text-align: center; }")).toHaveLength(0);
  });

  it("detects viewport-width overflow, oversized fixed widths and unbounded auto margins", () => {
    expect(failing(".wrap { width: 100vw; }")).toContain("noViewportWidthOverflow");
    expect(failing(".wrap { width: 100svw; }")).toContain("noViewportWidthOverflow");
    expect(failing(".wrap { min-width: 1400px; }")).toContain("noFixedLargeWidth");
    expect(failing(".wrap { margin-inline: auto; }")).toContain("autoMarginHasMaxWidth");
    expect(failing(".wrap { margin-inline: auto; max-width: 70rem; }")).toHaveLength(0);
    expect(failing(".wrap { width: 100%; }")).toHaveLength(0);
  });

  it("flags over-tight tracking applied to relative font sizes", () => {
    expect(failing("body { letter-spacing: -0.05em; font-size: 1rem; }")).toContain(
      "letterSpacingNotOverTight"
    );
    expect(failing("body { letter-spacing: 0.01em; }")).toHaveLength(0);
  });

  it("returns an actionable report", () => {
    const report = auditOpticalCentering("<p style='text-align:center'>x</p><div style='width:100vw'></div>");
    expect(report.passed).toBe(false);
    expect(report.checks.length).toBeGreaterThanOrEqual(5);
    for (const check of report.checks) {
      expect(["info", "warn"]).toContain(check.severity);
      expect(check.recommendation.length).toBeGreaterThan(0);
      expect(check.detail.length).toBeGreaterThan(0);
    }
    expect(report.remediationSnippet).toContain("max-width");
    expect(auditOpticalCentering("<main></main>").passed).toBe(true);
  });
});