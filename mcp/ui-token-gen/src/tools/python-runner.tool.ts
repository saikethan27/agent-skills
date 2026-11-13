import {
  MixedActionAnnotations,
  PythonRunnerInput,
  PythonRunnerInputSchema,
  PythonRunnerOutputSchema
} from "../contracts/index.js";
import { PythonBridge } from "../integrations/python/python-bridge.js";
import { createSuccessEnvelope, createErrorEnvelope, ResultEnvelope } from "../core/result-envelope.js";

export const pythonRunnerTool = {
  name: "ink_run_python_tests",
  title: "Run Python Verification Suite (AST, Contrast, APCA, Capture)",
  description:
    "PURPOSE: Execute the external Python verification suite for AST static analysis, WCAG + APCA 0.98G contrast maths, design heuristics, bidi auditing, website inspection and headless layout capture.\n\n" +
    "BEHAVIOR: Spawns the local Python 3 ink_verifier engine in a subprocess and returns its structured JSON. This tool is NOT read-only and NOT closed-world: the 'capture' action WRITES PNG/SVG snapshot files to disk, and the 'inspect' action FETCHES a remote URL. Both facts are reflected in the tool annotations (readOnlyHint: false, openWorldHint: true). Requires Python 3.10+ on PATH (override with INK_PYTHON_PATH). The optional `target` parameter is forwarded to the Python engine for the 'inspect' and 'capture' actions.\n\n" +
    "CONTRAST BEHAVIOUR: the Python engine classifies WCAG compliance from the FULL-PRECISION ratio (`ratio_exact`) and only rounds the displayed `ratio`, matching the TypeScript engine. The `contrast` action also reports APCA 0.98G computed with the reference equations. Unsupported color syntax is reported as an error instead of silently resolving to black.\n\n" +
    "USAGE GUIDELINES:\n" +
    "- When to use: deep multi-pass Python analysis, independent contrast/APCA verification, remote site inspection, or real-browser snapshots.\n" +
    "- When NOT to use: fast in-memory CSS validation without Python (ink_validate_design) or standalone client-side security audits (ink_audit_security).\n" +
    "- Alternatives: ink_validate_design for TypeScript-native verification; ink_capture_viewport for the wrapped snapshot workflow.\n\n" +
    "RETURNS: ResultEnvelope whose `data` contains the structured outcome of the invoked action ('contrast', 'security', 'visual', 'audit', 'full', 'bidi', 'inspect', 'capture').",
  annotations: MixedActionAnnotations,
  inputSchema: PythonRunnerInputSchema,
  outputSchema: PythonRunnerOutputSchema,
  execute: async (rawInput: unknown): Promise<ResultEnvelope<unknown>> => {
    const input: PythonRunnerInput = PythonRunnerInputSchema.parse(rawInput);

    const payload: Record<string, unknown> = {
      code: input.code ?? "",
      foreground: input.foregroundHex ?? "#ffffff",
      background: input.backgroundHex ?? "#0b0f19"
    };
    // Forward the target for the actions that consume a URL or file path.
    if (input.target !== undefined) {
      payload.target = input.target;
    }

    try {
      const pythonResult = await PythonBridge.execute({
        action: input.action,
        payload
      });

      if (pythonResult.status === "error") {
        return createErrorEnvelope(
          `Python verification engine encountered an error: ${pythonResult.message}`,
          { error: pythonResult.message ?? "Unknown error" },
          {
            warnings: ["Verify Python 3.10+ is available in system PATH."],
            nextActions: ["Check Python environment or run inline TypeScript tools as fallback."]
          }
        );
      }

      return createSuccessEnvelope(
        `Python verification suite (${input.action}) executed successfully.`,
        (pythonResult.data ?? {}) as Record<string, unknown>,
        {
          evidence: {
            sources: [
              {
                label: "Python ink_verifier engine",
                uri: "python/ink_verifier",
                retrievedAt: new Date().toISOString()
              }
            ]
          },
          nextActions: ["Review findings and contrast ratios reported by the Python verification engine."]
        }
      );
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return createErrorEnvelope(
        `Failed to run Python verification suite: ${errorMsg}`,
        { error: errorMsg },
        {
          warnings: ["Ensure Python 3.10+ is installed and executable."],
          nextActions: ["Run 'npm run test:python' manually or use TS-native tools."]
        }
      );
    }
  }
};