import { describe, it, expect } from "vitest";
import {
  convertExtractedColors,
  extractColorLiterals,
  inspectDesignStyle
} from "../../src/domain/inspection/style-extractor.js";

describe("Style extractor: real color conversion", () => {
  const code = `
    :root {
      --surface: #0b0f19;
      --accent: rgb(56 189 248);
      --warm: #f59e0b;
      --pale: hsl(200 50% 40%);
    }
    body { font-family: 'Cairo', 'Outfit', sans-serif; }
    .card { backdrop-filter: blur(16px); font-size: clamp(1rem, 2vw, 2rem); }
  `;

  it("extracts hex, rgb() and oklch() literals with their token names", () => {
    const literals = extractColorLiterals(code);
    const sources = literals.map((l) => l.source);
    expect(sources).toContain("#0b0f19");
    expect(sources).toContain("rgb(56 189 248)");
    expect(sources).toContain("#f59e0b");
    const byToken = Object.fromEntries(literals.filter((l) => l.token).map((l) => [l.token, l.source]));
    expect(byToken["--surface"]).toBe("#0b0f19");
    expect(byToken["--accent"]).toBe("rgb(56 189 248)");
    expect(byToken["--warm"]).toBe("#f59e0b");
  });

  it("converts extracted colors to OKLCH with real color math", () => {
    const report = inspectDesignStyle(code);
    const surface = report.convertedColors.find((c) => c.source === "#0b0f19")!;
    const accent = report.convertedColors.find((c) => c.source === "rgb(56 189 248)")!;

    expect(surface.oklch.l).toBeCloseTo(0.1695, 3);
    expect(surface.oklch.c).toBeCloseTo(0.022, 3);
    expect(surface.oklch.h).toBeCloseTo(267.3, 1);
    expect(surface.hex).toBe("#0b0f19");
    expect(surface.css).toBe("oklch(0.170 0.022 267)");
    expect(surface.gamutMapped).toBe(false);
    expect(surface.token).toBe("--surface");

    expect(accent.hex).toBe("#38bdf8");
    expect(accent.oklch.l).toBeCloseTo(0.7535, 3);
    expect(accent.gamutMapped).toBe(false);
  });

  it("REGRESSION: reports unsupported literals instead of substituting a fixed palette", () => {
    const report = inspectDesignStyle(code);
    // hsl() is not converted and must be reported, never silently replaced.
    expect(report.unsupportedColors).toContain("hsl(200 50% 40%)");
    expect(report.convertedColors.some((c) => c.source.includes("hsl"))).toBe(false);

    // Every converted entry is a genuine conversion of its own source value.
    for (const color of report.convertedColors) {
      expect(color.oklch.l).toBeGreaterThanOrEqual(0);
      expect(color.oklch.l).toBeLessThanOrEqual(1);
      expect(color.oklch.c).toBeGreaterThanOrEqual(0);
      expect(color.css).toMatch(/^oklch\(/);
    }
  });

  it("derives the recommended blueprint from the extracted colors", () => {
    const report = inspectDesignStyle(code);
    expect(report.upgradeBlueprint.bgSurfaceOklch).toBe(report.convertedColors
      .slice()
      .sort((a, b) => a.oklch.l - b.oklch.l)[0]!.css);
    expect(report.upgradeBlueprint.bgSurfaceOklch).toBe("oklch(0.170 0.022 267)");
    expect(report.upgradeBlueprint.textPrimaryOklch).toMatch(/^oklch\(/);
    expect(report.upgradeBlueprint.accentPrimaryOklch).toMatch(/^oklch\(/);
    expect(report.upgradeBlueprint.shadowSystem).toContain("rgba");
  });

  it("handles oklch() literals and gamut mapping for wide-gamut targets", () => {
    const report = inspectDesignStyle(
      ":root { --brand: oklch(0.7 0.25 30); --safe: #38bdf8; }",
      "p3"
    );
    const brand = report.convertedColors.find((c) => c.token === "--brand")!;
    expect(brand.source).toBe("oklch(0.7 0.25 30)");
    expect(brand.oklch.l).toBeGreaterThan(0.6);
    expect(brand.css).toMatch(/^oklch\(/);
    expect(brand.hex).toMatch(/^#[0-9a-f]{6}$/);
    expect(brand.gamutMapped).toBe(true);
  });

  it("keeps the archetype, font and typography detections", () => {
    const report = inspectDesignStyle(code);
    expect(report.fonts).toContain("Cairo");
    expect(report.hasGlassmorphism).toBe(true);
    expect(report.hasFluidTypography).toBe(true);
    expect(report.hasArabicTypography).toBe(true);
    expect(report.archetype).toBe("Bilingual High-Craft");
    expect(report.colors).toContain("#0b0f19");
  });

  it("convertExtractedColors can run standalone with a limit", () => {
    const literals = [
      { source: "#000000" },
      { source: "#ffffff" },
      { source: "#ff0000" },
      { source: "#00ff00" }
    ];
    const { colors, unsupported } = convertExtractedColors(literals, "srgb", 2);
    expect(colors).toHaveLength(2);
    expect(unsupported).toHaveLength(0);
    expect(colors[0]!.hex).toBe("#000000");
  });
});