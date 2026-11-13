/**
 * Central MCP Server Assembly
 * Registers tools, resources, and prompts under the Ink Design architecture.
 *
 * Error contract (MCP 2025-11-25):
 * - `status: "failed"` envelopes are returned as proper MCP error results
 *   (`isError: true`). `structuredContent` is intentionally omitted for
 *   failures so an execution error can never be reshaped into an
 *   output-schema validation failure that hides the real backend message.
 * - `status: "partial"` / `"blocked"` are legitimate tool outcomes (the tool
 *   ran and reported what it could not satisfy), so they are returned as
 *   successful results whose payload documents the shortfall.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { loadConfig } from "./config/index.js";
import { logger } from "./core/logger.js";
import { ResultEnvelope } from "./core/result-envelope.js";

import { createBaseTool } from "./tools/base.tool.js";
import { tokensTool } from "./tools/tokens.tool.js";
import { componentTool } from "./tools/component.tool.js";
import { threejsTool } from "./tools/threejs.tool.js";
import { scriptTool } from "./tools/script.tool.js";
import { securityTool } from "./tools/security.tool.js";
import { validateTool } from "./tools/validate.tool.js";
import { pythonRunnerTool } from "./tools/python-runner.tool.js";
import { captureTool } from "./tools/capture.tool.js";
import { inspectTool } from "./tools/inspect.tool.js";
import { assetsTool } from "./tools/assets.tool.js";
import { gradientTool } from "./tools/gradient.tool.js";
import { spacingTool } from "./tools/spacing.tool.js";
import { fluidTool } from "./tools/fluid.tool.js";
import { inkResources } from "./resources/index.js";
import { inkPrompts } from "./prompts/index.js";

/**
 * Extract the raw property shape from a Zod schema, transparently unwrapping
 * `.refine()`/`.superRefine()` wrappers so the published tools/list JSON schema
 * still describes every property. Cross-field refinements remain enforced in the
 * tool implementation (and are documented in the parameter descriptions).
 */
export function inputRawShape(schema: z.ZodTypeAny): z.ZodRawShape {
  const candidate = schema as unknown as {
    shape?: z.ZodRawShape;
    _def?: { schema?: z.ZodTypeAny; innerType?: z.ZodTypeAny };
  };
  if (candidate.shape) return candidate.shape;
  const inner = candidate._def?.schema ?? candidate._def?.innerType;
  if (inner) return inputRawShape(inner);
  throw new Error("Input schema must be a Zod object with refinements, not a bare shape.");
}

export function createServer(): McpServer {
  const config = loadConfig();

  const server = new McpServer({
    name: config.serverName,
    version: config.serverVersion
  });

  const formatToolResult = (envelope: ResultEnvelope<unknown>) => {
    const text = JSON.stringify(envelope, null, 2);
    if (envelope.status === "failed") {
      // Execution failure: proper MCP error result. No structuredContent is
      // published because the payload intentionally does not match the
      // success-only output schema.
      return { content: [{ type: "text" as const, text }], isError: true };
    }
    return {
      content: [
        {
          type: "text" as const,
          text
        }
      ],
      structuredContent: envelope as unknown as Record<string, unknown>
    };
  };

  // All standardized tools
  const tools = [
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

  // Register every tool with full schema contracts and annotations
  for (const tool of tools) {
    (server as any).registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: inputRawShape(tool.inputSchema),
        outputSchema: tool.outputSchema.shape,
        annotations: tool.annotations
      },
      async (args: any) => {
        logger.debug(`Executing ${tool.name}`, args);
        const res = await tool.execute(args);
        return formatToolResult(res);
      }
    );
  }

  // Register MCP Resources
  for (const r of inkResources) {
    server.resource(r.name, r.uri, async (uri) => {
      logger.debug(`Reading resource ${uri.href}`);
      const data = await r.read();
      return {
        contents: data.contents.map((c) => ({
          uri: uri.href,
          mimeType: c.mimeType,
          text: c.text
        }))
      };
    });
  }

  // Register MCP Prompts
  for (const p of inkPrompts) {
    const promptArgsShape: Record<string, z.ZodTypeAny> = {};
    if (p.arguments) {
      for (const a of p.arguments) {
        promptArgsShape[a.name] = a.required ? z.string() : z.string().optional();
      }
    }

    server.prompt(p.name, p.description, promptArgsShape, async (args) => {
      logger.debug(`Generating prompt ${p.name}`, args);
      return p.generateMessages(args as Record<string, string>);
    });
  }

  return server;
}