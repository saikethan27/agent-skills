/**
 * Verifies the PACKAGED executable (bin/mcp-ink-design.js -> dist/index.js)
 * loads and serves the corrected behavior over a real MCP stdio transport.
 * Run: node docs/audit-2026-10-03/verify-dist.mjs
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(root, "bin", "mcp-ink-design.js")],
  cwd: root,
  stderr: "pipe"
});

const client = new Client({ name: "dist-verifier", version: "1.0.0" });
await client.connect(transport);

const serverInfo = client.getServerVersion();
const listed = await client.listTools();

const palette = await client.callTool({
  name: "ink_generate_palette_tokens",
  arguments: { mood: "editorial", correctionMode: "none", contrastTarget: "aa" }
});
const contrast = await client.callTool({
  name: "ink_validate_design",
  arguments: {
    code: "<main><p>ok</p></main>",
    foregroundHex: "#148700",
    backgroundHex: "#000000"
  }
});
const gradient = await client.callTool({
  name: "ink_generate_gradient",
  arguments: {
    fromOklch: { l: 0.7, c: 0.3, h: 30 },
    toOklch: { l: 0.6, c: 0.3, h: 300 },
    steps: 3,
    target: "p3"
  }
});
const invalid = await client.callTool({
  name: "ink_generate_gradient",
  arguments: {
    fromOklch: { l: 0.7, c: 0.1, h: 30 },
    toOklch: { l: 0.6, c: 0.1, h: 300 },
    steps: 2.9
  }
});

const muted = palette.structuredContent.data.contrastAnalysis.find(
  (p) => p.pairing === "textMutedOnBgSurface"
);

const report = {
  serverInfo,
  toolCount: listed.tools.length,
  tools: listed.tools.map((t) => ({
    name: t.name,
    hasOutputSchema: Boolean(t.outputSchema),
    inputProperties: Object.keys(t.inputSchema.properties ?? {}).length,
    annotations: t.annotations
  })),
  mutedTextOnBgSurface: muted,
  wcagRegression: contrast.structuredContent.data.contrast,
  gradientP3: {
    css: gradient.structuredContent.data.css,
    hexes: gradient.structuredContent.data.hexes,
    gamut: gradient.structuredContent.data.gamut
  },
  fractionalStepsRejected: Boolean(invalid.isError),
  fractionalStepsMessage: invalid.content[0].text
};

console.log(JSON.stringify(report, null, 2));
await client.close();