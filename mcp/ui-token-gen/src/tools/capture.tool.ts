import {
  CaptureViewportInput,
  CaptureViewportInputSchema,
  CaptureViewportOutputSchema,
  ViewportCaptureAnnotations
} from "../contracts/index.js";
import { PythonBridge } from "../integrations/python/python-bridge.js";
import { createSuccessEnvelope, createErrorEnvelope, ResultEnvelope } from "../core/result-envelope.js";

export const captureTool = {
  name: "ink_capture_viewport",
  title: "Capture Multi-Viewport Responsive Snapshots",
  description:
    "PURPOSE: Capture viewport snapshots (16:9 desktop landscape, 9:16 vertical story, and 390x844 mobile) via headless Chromium to verify layout integrity, responsiveness, and optical centering.\n\n" +
    "BEHAVIOR: Launches a local headless browser with an isolated temporary user-data profile, renders the provided HTML string or URL, and WRITES one image file per viewport into `outputDirectory` (default '.ink_snapshots/'). When no browser is installed it writes deterministic SVG fallbacks and reports `format`. This tool therefore writes files and can fetch remote URLs (annotations: readOnlyHint false, openWorldHint true). Browser capture needs a longer timeout than the default 12s, because three sequential headless renders are performed.\n\n" +
    "ERROR BEHAVIOUR: backend failures are returned as proper MCP error results (`isError: true`) that preserve the underlying Python error message instead of being reshaped into an output-schema validation error.\n\n" +
    "USAGE GUIDELINES:\n" +
    "- When to use: after making HTML/CSS modifications or finishing a component to visually confirm alignment across desktop, mobile, and tall vertical screens.\n" +
    "- When NOT to use: fast code syntax or contrast checks without browser rendering (ink_validate_design).\n" +
    "- Alternatives: ink_validate_design for fast static design linting; ink_inspect_website_style to reverse-engineer design tokens.\n\n" +
    "RETURNS: ResultEnvelope with a 'snapshots' list (label, viewport, exact dimensions, file path, size, format) and layout overflow metrics.",
  annotations: ViewportCaptureAnnotations,
  inputSchema: CaptureViewportInputSchema,
  outputSchema: CaptureViewportOutputSchema,
  execute: async (rawInput: unknown): Promise<ResultEnvelope<unknown>> => {
    const input: CaptureViewportInput = CaptureViewportInputSchema.parse(rawInput);

    try {
      const pythonResult = await PythonBridge.execute({
        action: "capture",
        payload: {
          url: input.htmlOrUrl.startsWith("http") || input.htmlOrUrl.startsWith("file") ? input.htmlOrUrl : undefined,
          html: !input.htmlOrUrl.startsWith("http") && !input.htmlOrUrl.startsWith("file") ? input.htmlOrUrl : undefined,
          output_dir: input.outputDirectory,
          title: input.title
        }
      });

      if (pythonResult.status === "error") {
        return createErrorEnvelope(
          `Viewport capture engine reported an error: ${pythonResult.message}`,
          { error: pythonResult.message ?? "Unknown capture error" },
          {
            warnings: ["Ensure a local Chromium/Chrome/Edge executable is installed for real screenshots."],
            nextActions: ["Retry with a local file path or install a headless browser."]
          }
        );
      }

      const captureData = pythonResult.data as Record<string, any>;

      const snapshots = (captureData?.snapshots ?? []).map((s: Record<string, any>) => ({
        label: s.label,
        viewport: s.viewport_id ?? s.label,
        dimensions:
          typeof s.dimensions === "string"
            ? s.dimensions
            : `${s.dimensions?.width ?? 0}x${s.dimensions?.height ?? 0}`,
        aspect_ratio: s.aspect_ratio,
        filePath: s.filePath,
        fileSize: s.fileSize,
        format: s.format
      }));

      const mapped = {
        title: captureData?.title ?? input.title,
        outputDirectory: captureData?.outputDirectory ?? input.outputDirectory ?? ".ink_snapshots",
        snapshots,
        layoutMetrics: captureData?.viewportQualityChecks,
        browserDetected: Boolean(captureData?.browserDetected)
      };

      return createSuccessEnvelope(
        `Successfully captured ${snapshots.length} responsive viewport(s) for: ${input.title}.`,
        mapped,
        {
          warnings: captureData?.browserDetected
            ? []
            : ["No local headless browser was detected; deterministic SVG fallbacks were written instead of PNG screenshots."],
          evidence: {
            sources: [
              {
                label: "Headless Browser Viewport Capture",
                uri: mapped.outputDirectory,
                retrievedAt: new Date().toISOString()
              }
            ],
            artifacts: (captureData?.snapshots ?? []).map((s: Record<string, any>) => ({
              label: `${s.label} [${s.aspect_ratio}]`,
              uri: s.filePath
            }))
          },
          nextActions: [
            "Inspect the generated snapshots to verify optical centering and alignment.",
            "Confirm no horizontal scrollbars appeared on the mobile viewport (390x844)."
          ]
        }
      );
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return createErrorEnvelope(
        `Failed to execute viewport capture: ${errorMsg}`,
        { error: errorMsg },
        {
          warnings: ["Ensure a local Chromium/Chrome/Edge executable is installed."],
          nextActions: ["Retry the capture, or use ink_validate_design for static checks."]
        }
      );
    }
  }
};