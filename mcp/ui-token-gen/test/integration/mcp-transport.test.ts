import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../src/server.js";
import { PythonBridge } from "../../src/integrations/python/python-bridge.js";

/**
 * End-to-end MCP protocol tests over an in-memory transport pair.
 * No network, no Python, no browser: every external dependency is mocked with
 * a deterministic local double.
 */

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
    title: "Protocol Capture",
    outputDirectory: ".ink_snapshots",
    browserDetected: true,
    snapshots: [
      {
        viewport_id: "desktop_16_9",
        label: "Desktop Landscape (16:9)",
        aspect_ratio: "16:9",
        dimensions: { width: 1600, height: 900 },
        filePath: ".ink_snapshots/desktop_16_9.png",
        fileSize: 10,
        format: "png"
      },
      {
        viewport_id: "vertical_9_16",
        label: "Story / Mobile Tall (9:16)",
        aspect_ratio: "9:16",
        dimensions: { width: 540, height: 960 },
        filePath: ".ink_snapshots/vertical_9_16.png",
        fileSize: 10,
        format: "png"
      },
      {
        viewport_id: "mobile_view",
        label: "Standard Mobile (iPhone/Pixel)",
        aspect_ratio: "9:19.5",
        dimensions: { width: 390, height: 844 },
        filePath: ".ink_snapshots/mobile_view.png",
        fileSize: 10,
        format: "png"
      }
    ],
    viewportQualityChecks: { allThreeViewportsGenerated: true }
  }
};

async function connect() {
  const server = createServer();
  const client = new Client({ name: "ink-protocol-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, server };
}

describe("MCP protocol conformance", () => {
  it("advertises 14 tools with input schemas, output schemas and annotations", async () => {
    const { client, server } = await connect();
    try {
      const listed = await client.listTools();
      expect(listed.tools).toHaveLength(14);

      const names = listed.tools.map((t) => t.name).sort();
      expect(names).toEqual(
        [
          "ink_audit_security",
          "ink_build_threejs_experience",
          "ink_capture_viewport",
          "ink_craft_component",
          "ink_create_base",
          "ink_generate_fluid_scale",
          "ink_generate_gradient",
          "ink_generate_palette_tokens",
          "ink_generate_script_logic",
          "ink_generate_spacing_scale",
          "ink_import_custom_assets",
          "ink_inspect_website_style",
          "ink_run_python_tests",
          "ink_validate_design"
        ].sort()
      );

      for (const tool of listed.tools) {
        expect(tool.inputSchema.type).toBe("object");
        // Input properties must be published even for schemas that use
        // cross-field refinements (ZodEffects unwrapping).
        expect(Object.keys(tool.inputSchema.properties ?? {}).length).toBeGreaterThan(0);
        expect(tool.outputSchema).toBeDefined();
        expect(tool.annotations).toBeDefined();
        expect(typeof tool.annotations!.readOnlyHint).toBe("boolean");
      }

      const palette = listed.tools.find((t) => t.name === "ink_generate_palette_tokens")!;
      expect(palette.inputSchema.required ?? []).toEqual([]);
      expect(Object.keys(palette.inputSchema.properties ?? {})).toEqual(
        expect.arrayContaining([
          "mood",
          "baseHue",
          "target",
          "rampSteps",
          "lightnessMode",
          "lightnessEasing",
          "chromaProfile",
          "ramps",
          "contrastTarget",
          "correctionMode",
          "maxCorrectionDelta",
          "includeArabicTokens",
          "rootFontPx"
        ])
      );

      const gradient = listed.tools.find((t) => t.name === "ink_generate_gradient")!;
      // Endpoints are optional at the schema level; a cross-field refinement
      // requires either both endpoints or an authored stops array.
      expect(Object.keys(gradient.inputSchema.properties ?? {})).toEqual(
        expect.arrayContaining([
          "stops",
          "interpolationSpace",
          "huePath",
          "gamutValidationSamples",
          "contrastForegroundHex",
          "contrastSamplePositions",
          "contrastTarget"
        ])
      );
      // steps is an integer, so fractional counts are rejected by the schema.
      expect((gradient.inputSchema.properties as any).steps.type).toBe("integer");

      const fluid = listed.tools.find((t) => t.name === "ink_generate_fluid_scale")!;
      expect(Object.keys(fluid.inputSchema.properties ?? {})).toEqual(
        expect.arrayContaining(["entries", "minSizePx", "maxSizePx", "minViewportPx", "maxViewportPx", "rootFontPx"])
      );

      const runner = listed.tools.find((t) => t.name === "ink_run_python_tests")!;
      expect(runner.annotations!.readOnlyHint).toBe(false);
      expect(runner.annotations!.openWorldHint).toBe(true);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("returns structured success results whose text matches structuredContent", async () => {
    const { client, server } = await connect();
    try {
      const result: any = await client.callTool({
        name: "ink_generate_spacing_scale",
        arguments: { basePx: 16, ratio: 1.5, fluid: true }
      });
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toBeDefined();
      expect(JSON.stringify(JSON.parse(result.content[0].text))).toBe(JSON.stringify(result.structuredContent));
      expect(result.structuredContent.status).toBe("success");
      expect(result.structuredContent.data.tokens["--ink-space-sm"]).toBeUndefined();
      expect(result.structuredContent.data.tokens.sm.clamp).toContain("clamp(");
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("rejects invalid input with an MCP error result", async () => {
    const { client, server } = await connect();
    try {
      const fractionalSteps: any = await client.callTool({
        name: "ink_generate_gradient",
        arguments: {
          fromOklch: { l: 0.5, c: 0.1, h: 0 },
          toOklch: { l: 0.5, c: 0.1, h: 90 },
          steps: 2.9
        }
      });
      expect(fractionalSteps.isError).toBe(true);
      expect(fractionalSteps.content[0].text).toContain("integer");

      const equalViewports: any = await client.callTool({
        name: "ink_generate_spacing_scale",
        arguments: { fluid: true, minVw: 800, maxVw: 800 }
      });
      expect(equalViewports.isError).toBe(true);
      expect(equalViewports.content[0].text).toContain("maxVw");

      const negativeRatio: any = await client.callTool({
        name: "ink_generate_spacing_scale",
        arguments: { ratio: 0 }
      });
      expect(negativeRatio.isError).toBe(true);

      // Neither endpoints nor authored stops provided.
      const noEndpoints: any = await client.callTool({
        name: "ink_generate_gradient",
        arguments: { steps: 3 }
      });
      expect(noEndpoints.isError).toBe(true);
      expect(noEndpoints.content[0].text).toMatch(/fromOklch|stops/);

      // An authored stop array alone is a valid gradient.
      const stopsOnly: any = await client.callTool({
        name: "ink_generate_gradient",
        arguments: {
          stops: [
            { oklch: { l: 0.2, c: 0.05, h: 350 }, position: 0 },
            { oklch: { l: 0.8, c: 0.1, h: 40 }, position: 1 }
          ]
        }
      });
      expect(stopsOnly.isError).toBeFalsy();
      expect(stopsOnly.structuredContent.data.stops).toHaveLength(2);

      // Unordered authored stops are rejected.
      const unordered: any = await client.callTool({
        name: "ink_generate_gradient",
        arguments: {
          stops: [
            { oklch: { l: 0.2, c: 0.05, h: 0 }, position: 0.9 },
            { oklch: { l: 0.8, c: 0.05, h: 0 }, position: 0.1 }
          ]
        }
      });
      expect(unordered.isError).toBe(true);
      expect(unordered.content[0].text).toMatch(/non-decreasing/);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("preserves actionable backend errors instead of output-schema validation failures", async () => {
    const restore = mockPython({
      action: "capture",
      status: "error",
      message: "protocol-mocked backend failure",
      data: null
    });
    const { client, server } = await connect();
    try {
      const captureFailure: any = await client.callTool({
        name: "ink_capture_viewport",
        arguments: { htmlOrUrl: "<html></html>" }
      });
      expect(captureFailure.isError).toBe(true);
      // The real backend message must survive (not be replaced by an
      // "Output validation error: Required at data.title" style message).
      expect(captureFailure.content[0].text).toContain("protocol-mocked backend failure");
      expect(captureFailure.content[0].text).not.toContain("Output validation error");
      // Failed runs do not publish non-conforming structuredContent.
      expect(captureFailure.structuredContent).toBeUndefined();

      const pythonFailure: any = await client.callTool({
        name: "ink_run_python_tests",
        arguments: { action: "contrast" }
      });
      expect(pythonFailure.isError).toBe(true);
      expect(pythonFailure.content[0].text).toContain("protocol-mocked backend failure");
      expect(pythonFailure.content[0].text).not.toContain("Output validation error");
    } finally {
      await client.close();
      await server.close();
      restore();
    }
  });

  it("reports partial outcomes as successful results (not errors)", async () => {
    const { client, server } = await connect();
    try {
      const result: any = await client.callTool({
        name: "ink_generate_palette_tokens",
        arguments: { mood: "editorial", correctionMode: "none", contrastTarget: "aaa" }
      });
      expect(result.isError).toBeFalsy();
      expect(["partial", "blocked"]).toContain(result.structuredContent.status);
      expect(result.structuredContent.data.failedPairings.length).toBeGreaterThan(0);
      expect(result.structuredContent.warnings.length).toBeGreaterThan(0);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("exposes the corrected WCAG verdict for #148700 on #000000 over the protocol", async () => {
    const { client, server } = await connect();
    try {
      const result: any = await client.callTool({
        name: "ink_validate_design",
        arguments: {
          code: "<main><p>ok</p></main>",
          foregroundHex: "#148700",
          backgroundHex: "#000000"
        }
      });
      expect(result.isError).toBeFalsy();
      const contrast = result.structuredContent.data.contrast;
      expect(contrast.ratioExact).toBeCloseTo(4.4953336599, 8);
      expect(contrast.ratio).toBe(4.5);
      expect(contrast.wcagAA).toBe(false);
      expect(contrast.apca.lcExact).toBeCloseTo(-29.8973, 3);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("supports the mocked capture workflow end to end", async () => {
    const restore = mockPython(CAPTURE_MOCK);
    const { client, server } = await connect();
    try {
      const result: any = await client.callTool({
        name: "ink_capture_viewport",
        arguments: { htmlOrUrl: "<html><body>hi</body></html>", title: "Protocol" }
      });
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent.data.snapshots).toHaveLength(3);
      expect(result.structuredContent.data.snapshots[0].dimensions).toBe("1600x900");
      expect(result.structuredContent.data.browserDetected).toBe(true);
      expect(result.structuredContent.evidence.artifacts).toHaveLength(3);
    } finally {
      await client.close();
      await server.close();
      restore();
    }
  });
});