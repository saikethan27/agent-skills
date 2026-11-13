import { describe, it, expect } from "vitest";
import { createServer } from "../../src/server.js";
import { inkResources } from "../../src/resources/index.js";
import { inkPrompts } from "../../src/prompts/index.js";
import { createBaseTool } from "../../src/tools/base.tool.js";
import { tokensTool } from "../../src/tools/tokens.tool.js";
import { componentTool } from "../../src/tools/component.tool.js";
import { threejsTool } from "../../src/tools/threejs.tool.js";
import { scriptTool } from "../../src/tools/script.tool.js";
import { securityTool } from "../../src/tools/security.tool.js";
import { validateTool } from "../../src/tools/validate.tool.js";
import { pythonRunnerTool } from "../../src/tools/python-runner.tool.js";
import { captureTool } from "../../src/tools/capture.tool.js";
import { inspectTool } from "../../src/tools/inspect.tool.js";
import { assetsTool } from "../../src/tools/assets.tool.js";
import { gradientTool } from "../../src/tools/gradient.tool.js";
import { spacingTool } from "../../src/tools/spacing.tool.js";
import { fluidTool } from "../../src/tools/fluid.tool.js";
import { PythonBridge } from "../../src/integrations/python/python-bridge.js";

const allTools = [
  createBaseTool,
  tokensTool,
  componentTool,
  threejsTool,
  scriptTool,
  securityTool,
  validateTool,
  pythonRunnerTool,
  captureTool,
  inspectTool,
  assetsTool,
  gradientTool,
  spacingTool,
  fluidTool
];

/** Deterministic mock so contract tests never need Python, a browser or network. */
function mockPython(result: unknown) {
  const original = PythonBridge.execute;
  PythonBridge.execute = (async () => result) as typeof PythonBridge.execute;
  return () => {
    PythonBridge.execute = original;
  };
}

const CAPTURE_MOCK = {
  action: "capture",
  status: "success" as const,
  data: {
    title: "Mock Capture",
    outputDirectory: ".ink_snapshots",
    browserDetected: true,
    snapshots: [
      {
        viewport_id: "desktop_16_9",
        label: "Desktop Landscape (16:9)",
        aspect_ratio: "16:9",
        dimensions: { width: 1600, height: 900 },
        filePath: ".ink_snapshots/desktop_16_9.png",
        fileSize: 1234,
        format: "png"
      },
      {
        viewport_id: "vertical_9_16",
        label: "Story / Mobile Tall (9:16)",
        aspect_ratio: "9:16",
        dimensions: { width: 540, height: 960 },
        filePath: ".ink_snapshots/vertical_9_16.png",
        fileSize: 1234,
        format: "png"
      },
      {
        viewport_id: "mobile_view",
        label: "Standard Mobile (iPhone/Pixel)",
        aspect_ratio: "9:19.5",
        dimensions: { width: 390, height: 844 },
        filePath: ".ink_snapshots/mobile_view.png",
        fileSize: 1234,
        format: "png"
      }
    ],
    viewportQualityChecks: { allThreeViewportsGenerated: true }
  }
};

const INSPECT_MOCK = {
  action: "inspect",
  status: "success" as const,
  data: {
    source: "https://example.com",
    inferredArchetype: "Luxury Dark",
    extractedPalette: {
      hexColors: ["#0b0f19", "#38bdf8"],
      rgbColors: ["rgb(255, 255, 255)"],
      oklchColors: [],
      totalColorsDetected: 3
    },
    extractedTypography: { fontFamilies: ["Inter"], usesFluidClamp: true },
    extractedTactileElements: { shadowStyles: ["0 4px 6px rgba(0,0,0,0.3)"], borderRadiusValues: ["16px"] }
  }
};

describe("MCP Server Contract & Public Surfaces", () => {
  it("initializes McpServer without throwing", () => {
    expect(createServer()).toBeDefined();
  });

  it("registers 14 tools following ink_<verb>_<noun>", () => {
    expect(allTools).toHaveLength(14);
    const verbNounRegex = /^ink_(create|generate|craft|build|audit|validate|run|capture|inspect|import)_[a-z_]+$/;

    for (const tool of allTools) {
      expect(tool.name).toMatch(verbNounRegex);
      expect(tool.name.split("_").length).toBeGreaterThanOrEqual(3);
    }

    expect(createBaseTool.name).toBe("ink_create_base");
    expect(tokensTool.name).toBe("ink_generate_palette_tokens");
    expect(componentTool.name).toBe("ink_craft_component");
    expect(threejsTool.name).toBe("ink_build_threejs_experience");
    expect(scriptTool.name).toBe("ink_generate_script_logic");
    expect(securityTool.name).toBe("ink_audit_security");
    expect(validateTool.name).toBe("ink_validate_design");
    expect(pythonRunnerTool.name).toBe("ink_run_python_tests");
    expect(captureTool.name).toBe("ink_capture_viewport");
    expect(inspectTool.name).toBe("ink_inspect_website_style");
    expect(assetsTool.name).toBe("ink_import_custom_assets");
    expect(gradientTool.name).toBe("ink_generate_gradient");
    expect(spacingTool.name).toBe("ink_generate_spacing_scale");
    expect(fluidTool.name).toBe("ink_generate_fluid_scale");
  });

  it("defines annotations and structured descriptions for every tool", () => {
    for (const tool of allTools) {
      expect(tool.title.length).toBeGreaterThan(5);
      expect(tool.description).toContain("PURPOSE:");
      expect(tool.description).toContain("BEHAVIOR:");
      expect(tool.description).toContain("USAGE GUIDELINES:");
      expect(tool.description).toContain("RETURNS:");
      expect(typeof tool.annotations.readOnlyHint).toBe("boolean");
      expect(typeof tool.annotations.destructiveHint).toBe("boolean");
      expect(typeof tool.annotations.idempotentHint).toBe("boolean");
      expect(typeof tool.annotations.openWorldHint).toBe("boolean");
      expect(tool.inputSchema).toBeDefined();
      expect(tool.outputSchema).toBeDefined();
    }
  });

  it("declares accurate annotations for tools that write files or access websites", () => {
    // capture writes PNG/SVG files and can fetch URLs
    expect(captureTool.annotations.readOnlyHint).toBe(false);
    expect(captureTool.annotations.openWorldHint).toBe(true);
    expect(captureTool.annotations.destructiveHint).toBe(false);

    // the Python runner dispatches to capture/inspect, so it cannot claim
    // read-only / closed-world (this was an audited contract gap)
    expect(pythonRunnerTool.annotations.readOnlyHint).toBe(false);
    expect(pythonRunnerTool.annotations.openWorldHint).toBe(true);
    expect(pythonRunnerTool.description).toContain("NOT read-only");
    expect(pythonRunnerTool.description).not.toContain("Purely read-only");

    // inspection is read-only but open-world
    expect(inspectTool.annotations.readOnlyHint).toBe(true);
    expect(inspectTool.annotations.openWorldHint).toBe(true);

    // pure in-memory generators stay read-only and closed-world
    for (const tool of [tokensTool, gradientTool, spacingTool, fluidTool, validateTool]) {
      expect(tool.annotations.readOnlyHint).toBe(true);
      expect(tool.annotations.openWorldHint).toBe(false);
    }
  });

  it("executes every tool and satisfies its declared output schema", async () => {
    const restore = mockPython(CAPTURE_MOCK);
    try {
      // 1. ink_create_base
      const baseRes = await createBaseTool.execute({
        projectName: "contract-test-app",
        designStyle: "editorial",
        direction: "rtl",
        language: "ar"
      });
      expect(baseRes.status).toBe("success");
      expect((baseRes.data as any).files["index.html"]).toContain('dir="rtl"');
      expect(createBaseTool.outputSchema.safeParse(baseRes).success).toBe(true);

      // 2. ink_generate_palette_tokens
      const tokenRes = await tokensTool.execute({ mood: "editorial" });
      expect(tokenRes.status).toBe("success");
      expect((tokenRes.data as any).tokens.bgSurface).toMatch(/^oklch\(/);
      expect((tokenRes.data as any).contrastAnalysis.length).toBeGreaterThanOrEqual(10);
      expect(tokensTool.outputSchema.safeParse(tokenRes).success).toBe(true);

      // 3. ink_craft_component
      const compRes = await componentTool.execute({ componentType: "glass-card" });
      expect(compRes.status).toBe("success");
      expect((compRes.data as any).html).toContain("ink-card");
      expect(componentTool.outputSchema.safeParse(compRes).success).toBe(true);

      // 4. ink_build_threejs_experience
      const threeRes = await threejsTool.execute({ sceneType: "particle-constellation" });
      expect(threeRes.status).toBe("success");
      expect((threeRes.data as any).html).toContain("inkThreeCanvas");
      expect(threejsTool.outputSchema.safeParse(threeRes).success).toBe(true);

      // 5. ink_generate_script_logic
      const scriptRes = await scriptTool.execute({ pattern: "state-store", moduleName: "AppStore" });
      expect(scriptRes.status).toBe("success");
      expect((scriptRes.data as any).code).toContain("class AppStore");
      expect(scriptTool.outputSchema.safeParse(scriptRes).success).toBe(true);

      // 6. ink_audit_security
      const secRes = await securityTool.execute({ code: "const x = 1;" });
      expect(secRes.status).toBe("success");
      expect((secRes.data as any).passed).toBe(true);
      expect(securityTool.outputSchema.safeParse(secRes).success).toBe(true);

      // 7. ink_validate_design
      const valRes = await validateTool.execute({
        code: "<main style='text-align: start; margin-inline: auto; max-width: 70rem;'></main>",
        foregroundHex: "#ffffff",
        backgroundHex: "#000000"
      });
      expect(valRes.status).toBe("success");
      expect((valRes.data as any).craftScore).toBeDefined();
      expect((valRes.data as any).bidiAndAlignment).toBeDefined();
      expect((valRes.data as any).centeringAudit).not.toBeNull();
      expect(validateTool.outputSchema.safeParse(valRes).success).toBe(true);

      // 8. ink_import_custom_assets
      const assetRes = await assetsTool.execute({ primaryFont: "Cairo", weights: [400, 700] });
      expect(assetRes.status).toBe("success");
      expect((assetRes.data as any).htmlLinkTags).toContain("Cairo");
      expect(assetsTool.outputSchema.safeParse(assetRes).success).toBe(true);

      // 9. ink_inspect_website_style (inline)
      const inspectRes = await inspectTool.execute({
        urlOrCode: "body { font-family: 'Amiri'; background: #0b0f19; }"
      });
      expect(inspectRes.status).toBe("success");
      expect((inspectRes.data as any).archetype).toBeDefined();
      expect(inspectTool.outputSchema.safeParse(inspectRes).success).toBe(true);

      // 10. ink_capture_viewport (mocked backend: no browser, no disk)
      const capRes = await captureTool.execute({
        htmlOrUrl: "<html><body><h1>Contract Test</h1></body></html>",
        title: "Contract Viewport Test"
      });
      expect(capRes.status).toBe("success");
      expect((capRes.data as any).snapshots).toHaveLength(3);
      expect((capRes.data as any).browserDetected).toBe(true);
      expect(captureTool.outputSchema.safeParse(capRes).success).toBe(true);

      // 11. ink_run_python_tests (mocked backend)
      const pyRes = await pythonRunnerTool.execute({ action: "contrast" });
      expect(pyRes.status).toBe("success");
      expect(pythonRunnerTool.outputSchema.safeParse(pyRes).success).toBe(true);

      // 12. ink_generate_gradient
      const gradRes = await gradientTool.execute({
        fromOklch: { l: 0.7, c: 0.12, h: 250 },
        toOklch: { l: 0.5, c: 0.15, h: 30 },
        steps: 5
      });
      expect(gradRes.status).toBe("success");
      expect((gradRes.data as any).stops).toHaveLength(5);
      expect((gradRes.data as any).hexes).toHaveLength(5);
      expect(gradientTool.outputSchema.safeParse(gradRes).success).toBe(true);

      // 13. ink_generate_spacing_scale
      const spaceRes = await spacingTool.execute({ basePx: 16, ratio: 1.25 });
      expect(spaceRes.status).toBe("success");
      expect((spaceRes.data as any).css).toContain("--ink-space-md");
      expect(spacingTool.outputSchema.safeParse(spaceRes).success).toBe(true);

      // 14. ink_generate_fluid_scale
      const fluidRes = await fluidTool.execute({ minSizePx: 16, maxSizePx: 32 });
      expect(fluidRes.status).toBe("success");
      expect((fluidRes.data as any).values[0].clampCss).toContain("clamp(");
      expect((fluidRes.data as any).containsInvalidNumbers).toBe(false);
      expect(fluidTool.outputSchema.safeParse(fluidRes).success).toBe(true);
    } finally {
      restore();
    }
  }, 30000);

  it("returns failed envelopes (not thrown errors) when a backend fails", async () => {
    const restore = mockPython({
      action: "capture",
      status: "error",
      message: "mocked backend failure",
      data: null
    });
    try {
      const captureFailure = await captureTool.execute({ htmlOrUrl: "<html></html>" });
      expect(captureFailure.status).toBe("failed");
      expect((captureFailure.data as any).error).toBe("mocked backend failure");
      // The capture payload cannot describe a successful capture, so it does
      // not match the success-only schema: the server therefore reports it as
      // an MCP error result instead of an output validation failure.
      expect(captureTool.outputSchema.safeParse(captureFailure).success).toBe(false);

      const pythonFailure = await pythonRunnerTool.execute({ action: "contrast" });
      expect(pythonFailure.status).toBe("failed");
      expect((pythonFailure.data as any).error).toBe("mocked backend failure");
      // The Python runner payload schema declares an explicit error branch, so
      // its failure payload is schema-valid and reaches clients intact.
      expect(pythonRunnerTool.outputSchema.safeParse(pythonFailure).success).toBe(true);
    } finally {
      restore();
    }
  });

  it("forwards the python runner target parameter", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const original = PythonBridge.execute;
    PythonBridge.execute = (async (options: any) => {
      calls.push(options.payload as Record<string, unknown>);
      return { action: options.action, status: "success" as const, data: { ok: true } };
    }) as typeof PythonBridge.execute;

    try {
      await pythonRunnerTool.execute({ action: "inspect", target: "https://example.com" });
      expect(calls[0]!.target).toBe("https://example.com");

      await pythonRunnerTool.execute({ action: "contrast" });
      expect(calls[1]!.target).toBeUndefined();
    } finally {
      PythonBridge.execute = original;
    }
  });

  it("includeArabicTokens changes the generated output", async () => {
    const without = await tokensTool.execute({ includeArabicTokens: false });
    const with_ = await tokensTool.execute({ includeArabicTokens: true });

    expect((without.data as any).arabicTokens).toBeNull();
    expect((with_.data as any).arabicTokens).toBeDefined();
    expect((with_.data as any).arabicTokens.lineHeightBody).toBeGreaterThanOrEqual(1.7);
    expect((with_.data as any).cssVariables).toContain("--ink-font-ar-primary");
    expect((with_.data as any).cssVariables).toContain("--ink-leading-body-ar");
    expect(without.data).not.toEqual(with_.data);
  });

  it("checkCentering controls a meaningful alignment/overflow check", async () => {
    // High-craft code that only violates the centering/overflow rules.
    const code = `<header><nav></nav></header>
      <main><section style="font-size: clamp(1rem, 2vw, 2rem); width: 100vw; transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1); box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -2px rgba(0,0,0,0.1);"></section></main>
      <footer></footer>`;

    const enabled = await validateTool.execute({ code, checkCentering: true });
    const disabled = await validateTool.execute({ code, checkCentering: false });

    expect((enabled.data as any).craftScore).toBeGreaterThanOrEqual(75);
    expect((enabled.data as any).centeringAudit).not.toBeNull();
    expect((enabled.data as any).centeringAudit.passed).toBe(false);
    expect((enabled.data as any).centeringAudit.checks.length).toBeGreaterThan(0);
    expect((enabled.data as any).remediationAdvice.join(" ")).toContain("noViewportWidthOverflow");
    expect((enabled.data as any).isHighCraft).toBe(false);

    expect((disabled.data as any).centeringAudit).toBeNull();
    // With the audit disabled the centering violation no longer gates the verdict.
    expect((disabled.data as any).isHighCraft).toBe(true);

    // clean code passes the audit when enabled
    const clean = await validateTool.execute({
      code: "<main><p style='text-align:start'>ok</p></main>",
      checkCentering: true
    });
    expect((clean.data as any).centeringAudit.passed).toBe(true);
  });

  it("checkBidi still toggles the logical-property audit", async () => {
    const code = "<div style='margin-left: 10px'></div>";
    expect((await validateTool.execute({ code, checkBidi: true })).data).toMatchObject({
      bidiAndAlignment: expect.objectContaining({ isFullyLogical: false })
    });
    expect((await validateTool.execute({ code, checkBidi: false })).data).toMatchObject({
      bidiAndAlignment: null
    });
  });

  it("extractOklchPalette converts extracted colors for inline and URL inspection", async () => {
    const inlineOn = await inspectTool.execute({
      urlOrCode: ":root { --bg: #0b0f19; --accent: rgb(56 189 248); }",
      extractOklchPalette: true
    });
    const inlineOff = await inspectTool.execute({
      urlOrCode: ":root { --bg: #0b0f19; --accent: rgb(56 189 248); }",
      extractOklchPalette: false
    });

    const converted = (inlineOn.data as any).convertedColors as Array<Record<string, unknown>>;
    expect(converted).toHaveLength(2);
    expect(converted[0]!.source).toBe("#0b0f19");
    expect(String(converted[0]!.css)).toMatch(/^oklch\(/);
    expect(String(converted[0]!.hex)).toBe("#0b0f19");
    expect(converted[1]!.source).toBe("rgb(56 189 248)");
    expect(String(converted[1]!.hex)).toBe("#38bdf8");
    expect(String((inlineOn.data as any).oklchPaletteCss)).toContain("--ink-bg");
    expect((inlineOff.data as any).convertedColors).toBeUndefined();

    const restore = mockPython(INSPECT_MOCK);
    try {
      const urlOn = await inspectTool.execute({
        urlOrCode: "https://example.com",
        extractOklchPalette: true
      });
      const urlOff = await inspectTool.execute({
        urlOrCode: "https://example.com",
        extractOklchPalette: false
      });

      expect((urlOn.data as any).convertedColors.length).toBeGreaterThan(0);
      expect(String((urlOn.data as any).convertedColors[0].css)).toMatch(/^oklch\(/);
      expect((urlOff.data as any).convertedColors).toBeUndefined();
      expect(inspectTool.outputSchema.safeParse(urlOn).success).toBe(true);
    } finally {
      restore();
    }
  });

  it("rejects invalid numeric input instead of emitting invalid CSS", async () => {
    await expect(spacingTool.execute({ ratio: 0 })).rejects.toThrow();
    await expect(spacingTool.execute({ fluid: true, minVw: 800, maxVw: 800 })).rejects.toThrow();
    await expect(spacingTool.execute({ basePx: -16 })).rejects.toThrow();
    await expect(fluidTool.execute({ minViewportPx: 800, maxViewportPx: 800 })).rejects.toThrow();
    await expect(fluidTool.execute({ minSizePx: 0 })).rejects.toThrow();
    await expect(gradientTool.execute({ fromOklch: { l: 0.5, c: 0.1, h: 0 }, toOklch: { l: 0.5, c: 0.1, h: 90 }, steps: 2.9 })).rejects.toThrow();
    await expect(
      tokensTool.execute({ minVw: 800, maxVw: 800 })
    ).rejects.toThrow();
    await expect(
      gradientTool.execute({
        fromOklch: { l: 0.5, c: 0.1, h: 0 },
        toOklch: { l: 0.5, c: 0.1, h: 90 },
        steps: 3,
        stops: [
          { oklch: { l: 0.2, c: 0.05, h: 0 }, position: 0.9 },
          { oklch: { l: 0.8, c: 0.05, h: 0 }, position: 0.1 }
        ]
      })
    ).rejects.toThrow();
  });

  it("exposes ink://master/philosophy resource returning constitution text", async () => {
    const res = inkResources.find((r) => r.uri === "ink://master/philosophy");
    expect(res).toBeDefined();
    const data = await res!.read();
    expect(data.contents[0]!.text).toContain("INK_MASTER");
  });

  it("generates structured prompt messages for creative direction", () => {
    const prompt = inkPrompts.find((p) => p.name === "ink_creative_direction");
    expect(prompt).toBeDefined();
    const generated = prompt!.generateMessages({
      product_description: "Fintech Dashboard",
      desired_vibe: "luxury-dark"
    });
    expect(generated.messages[0]!.content.text).toContain("Fintech Dashboard");
    expect(generated.messages[0]!.content.text).toContain("luxury-dark");
  });
});