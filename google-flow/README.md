# Google Flow (Unified Video Generation & MCP Package)

A single, self-contained package bundling the **Google Flow Studio MCP Server**, **Antigravity / Claude Plugin**, **Agent Skill**, and **Automated Video Batch Runner**.

Drive **Google Flow** (`flow.google.com`) directly from AI coding agents (Antigravity, Claude, Codex) or run automated pipelines to generate photorealistic videos and images using Flow's daily free credits or Pro plan credits.

---

## Package Structure

```text
G:\agent-skills\google-flow\
├── README.md               # Package documentation & quickstart
├── SKILL.md                # Agent skill instructions & prompting guide
├── plugin.json             # Antigravity plugin manifest
├── mcp_config.json         # MCP server configuration
├── .claude-plugin/         # Claude Code plugin definition
├── plugin/                 # Standalone plugin directory
│   ├── plugin.json
│   ├── mcp_config.json
│   ├── .claude-plugin/
│   └── skills/
│       └── google-flow/
│           └── SKILL.md
└── mcp/                    # Flow MCP Server codebase & runners
    ├── src/                # TypeScript source with Windows fixes
    ├── dist/               # Compiled JavaScript ready to run
    ├── scripts/            # Automation batch scripts (generate-eventa-videos.mjs)
    ├── schemas/            # 18 JSON schemas for all MCP tools
    ├── package.json
    ├── .env.example
    └── README.md           # In-depth MCP server technical docs
```

---

## What is Included

1. **MCP Server (`mcp/`):**
   - 18 tools for video generation (`flow_generate`), status polling (`flow_status`, `flow_wait`), downloads (`flow_download`), upscaling, characters, voice narration (`flow_narrate`), and film assembly (`flow_assemble`).
   - Runs on local port `8787` and connects to dedicated Chrome on CDP port `9333`.

2. **Agent Skill (`SKILL.md`):**
   - Detailed instructions for AI agents on model economics (`Omni Flash` at 12 cr vs `Veo 3.1 Fast` at 10 cr vs `Veo 3.1 Quality` at 50 cr).
   - High-realism cinematography prompting (Steadicam push-in, crowd layering, shallow depth-of-field, lens halation, volumetric lighting).
   - 16:9 to 9:16 FFmpeg local conversion pipeline (0 extra credit cost).

3. **Plugin Manifest (`plugin.json` / `.claude-plugin/`):**
   - Configured for one-click discovery and enablement in Antigravity and Claude Code.

4. **Batch Video Automation Script (`mcp/scripts/generate-eventa-videos.mjs`):**
   - Automated runner for batch generation, status polling, 1080p upscaling, audio stripping, and aspect ratio conversion.

---

## Windows & System Enhancements Applied

- **Windows Headless Chrome Killer (`src/login.ts`):** Detects and terminates any hidden background Chrome process holding port `9333` with `MainWindowHandle == 0` before launching login.
- **UI Overlay Auto-Dismissal (`src/flow.ts`):** Automatically closes Flow's "Untitled session" / Agent side panel and onboarding banners that block DOM automation.
- **Cross-Platform Audio (`src/gemini.ts`):** Replaced Unix `rm -f` with Node's native `rmSync()`, and added configurable `FLOW_MCP_FFPROBE`.
- **Automatic `.env` Loader (`src/env.ts`):** Automatically reads `.env` variables without requiring manual environment exports in PowerShell.

---

## Quickstart & Setup on a New Machine

### 1. Install & Build
```bash
cd google-flow/mcp
npm install
npm run build
```
*(Optional: Copy `.env.example` to `.env` if you want custom ports or paths).*

### 2. One-Time Google Login
```bash
npm run login
```
A Chrome window will open. Sign into your Google account (with active Flow access), open or select your Flow project, and leave it logged in.

### 3. Add to Your MCP Client
Add this to your `mcp_config.json` (Antigravity, Claude Code, or Codex):
```json
{
  "mcpServers": {
    "flow": {
      "command": "node",
      "args": ["<PATH_TO>/google-flow/mcp/dist/index.js"],
      "env": {
        "FLOW_MCP_PORT": "8787"
      }
    }
  }
}
```

### 4. Run Batch Automation (Optional)
```bash
node scripts/generate-eventa-videos.mjs
```
