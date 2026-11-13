import { describe, it, expect } from "vitest";
import { PythonBridge } from "../../src/integrations/python/python-bridge.js";
import { pythonRunnerTool } from "../../src/tools/python-runner.tool.js";
import { dualContrastForHex } from "../../src/domain/design-tokens/color-math.js";

/**
 * Integration tests against the REAL local Python engine.
 *
 * Mathematical policy is cross-checked here: the TypeScript and Python
 * engines must agree on the full-precision WCAG ratio and on the reference
 * APCA 0.98G Lc value (documented tolerance: 0.01).
 */
describe("Python Bridge & External Suite Integration", () => {
  it("executes Python contrast check via stdin stream", async () => {
    const result = await PythonBridge.execute({
      action: "contrast",
      payload: { foreground: "#ffffff", background: "#000000" }
    });

    expect(result.status).toBe("success");
    const data = result.data as any;
    expect(data.ratio).toBe(21.0);
    expect(data.ratio_exact).toBeCloseTo(21, 8);
    expect(data.wcag.normal_text_aaa).toBe(true);
    expect(data.apca.algorithm).toContain("0.98G");
    expect(data.apca.lc_exact).toBeCloseTo(-107.8847, 3);
  }, 30000);

  it("REGRESSION: Python classifies WCAG from the full-precision ratio", async () => {
    const result = await PythonBridge.execute({
      action: "contrast",
      payload: { foreground: "#148700", background: "#000000" }
    });
    const data = result.data as any;
    expect(data.ratio_exact).toBeCloseTo(4.4953336599, 8);
    expect(data.ratio).toBe(4.5);
    // Displayed 4.50 but exact 4.4953 -> normal text AA must FAIL.
    expect(data.wcag.normal_text_aa).toBe(false);
    expect(data.wcag.grade).toBe("AA Large");
    expect(data.wcag.large_text_aa).toBe(true);
  }, 30000);

  it("matches the TypeScript engine for WCAG ratios and APCA Lc", async () => {
    const pairs: Array<[string, string]> = [
      ["#777777", "#ffffff"],
      ["#888888", "#777777"],
      ["#148700", "#000000"],
      ["#38bdf8", "#0b0f19"],
      ["#f8fafc", "#ffffff"],
      ["#000000", "#000000"]
    ];

    for (const [fg, bg] of pairs) {
      const result = await PythonBridge.execute({
        action: "contrast",
        payload: { foreground: fg, background: bg }
      });
      expect(result.status).toBe("success");
      const data = result.data as any;
      const ts = dualContrastForHex(fg, bg);

      // WCAG: full-precision ratio and every classification flag must agree.
      expect(data.ratio_exact).toBeCloseTo(ts.ratioExact, 10);
      expect(data.ratio).toBe(ts.ratio);
      expect(data.wcag.normal_text_aa).toBe(ts.normalTextAA);
      expect(data.wcag.normal_text_aaa).toBe(ts.normalTextAAA);
      expect(data.wcag.large_text_aa).toBe(ts.largeTextAA);
      expect(data.wcag.large_text_aaa).toBe(ts.largeTextAAA);
      expect(data.wcag.ui_component_aa).toBe(ts.uiComponentAA);
      expect(data.wcag.grade).toBe(ts.grade);

      // APCA 0.98G: documented tolerance 0.01 Lc.
      expect(data.apca.lc_exact).toBeCloseTo(ts.apcaLcExact, 6);
      expect(Math.abs(data.apca.lc_exact - ts.apcaLcExact)).toBeLessThan(0.01);
      expect(data.apca.lc).toBe(ts.apcaLc);
    }
  }, 60000);

  it("reports invalid color syntax instead of silently using black", async () => {
    const result = await PythonBridge.execute({
      action: "contrast",
      payload: { foreground: "definitely-not-a-color", background: "#ffffff" }
    });
    expect(result.status).toBe("error");
    expect(result.message).toContain("Unsupported color syntax");

    const envelope = await pythonRunnerTool.execute({
      action: "contrast",
      foregroundHex: "not-a-color",
      backgroundHex: "#ffffff"
    });
    expect(envelope.status).toBe("failed");
    expect((envelope.data as any).error).toContain("Unsupported color syntax");
  }, 30000);

  it("parses hex, rgb() and oklch() color syntax", async () => {
    const hex = await PythonBridge.execute({
      action: "contrast",
      payload: { foreground: "#38bdf8", background: "rgb(11 15 25)" }
    });
    expect(hex.status).toBe("success");

    const oklch = await PythonBridge.execute({
      action: "contrast",
      payload: { foreground: "oklch(0.96 0.01 215)", background: "oklch(0.11 0.015 215)" }
    });
    expect(oklch.status).toBe("success");
    expect((oklch.data as any).ratio_exact).toBeGreaterThan(7);
  }, 30000);

  it("executes Python security linter catching bad code", async () => {
    const result = await PythonBridge.execute({
      action: "security",
      payload: { code: "element.innerHTML = userInput; eval('bad');" }
    });

    expect(result.status).toBe("success");
    const data = result.data as any;
    expect(data.passed).toBe(false);
    expect(data.total_findings).toBeGreaterThanOrEqual(2);
  }, 30000);

  it("runs the full ink_run_python_tests tool with envelope wrapping", async () => {
    const envelope = await pythonRunnerTool.execute({
      action: "full",
      code: "<header><nav></nav></header><main style='font-size: clamp(1rem, 2vw, 2rem)'></main>",
      foregroundHex: "#f8fafc",
      backgroundHex: "#0b0f19"
    });

    expect(envelope.status).toBe("success");
    expect(envelope.evidence.sources).toBeDefined();
    const data = envelope.data as any;
    expect(data.visual_audit).toBeDefined();
    expect(data.security_lint).toBeDefined();
    expect(data.contrast_check).toBeDefined();
    expect(data.contrast_check.apca).toBeDefined();
  }, 60000);

  it("forwards the target parameter to the Python inspector", async () => {
    const result = await PythonBridge.execute({
      action: "inspect",
      payload: { target: "<html><style>:root{--bg:#0b0f19}</style></html>" }
    });
    expect(result.status).toBe("success");
    const data = result.data as any;
    expect(data.extractedPalette.hexColors).toContain("#0b0f19");
  }, 30000);
});