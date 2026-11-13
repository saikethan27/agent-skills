---
name: flow-video
description: Generate, edit, wait, download, upscale, and assemble cinematic AI videos and images using Google Flow Studio via MCP or automated scripts. Supports Veo 3.1 Fast, Veo 3.1 Quality, and Gemini Omni Flash.
license: MIT
metadata:
  version: "1.1.0"
  server: flow
  tools: 18
  platform: "Windows / Cross-platform"
---

# Google Flow Video & Studio Automation

Model Context Protocol (MCP) server and automation toolset for generating, editing, extending, upscaling, and assembling cinematic AI videos and images using Google Flow (`flow.google.com`).

---

## 1. When to Use / When Not to Use

- **Use when:**
  - Generating ultra-realistic live-action video clips from text or starting reference images (I2V / T2V).
  - Automating batch video generation pipelines for websites, marketing reels, or product showcases.
  - Converting 16:9 cinematic videos to 9:16 vertical reels locally without extra AI credit consumption.
  - Adding AI voice narration (Gemini TTS) and assembling multi-clip films with transitions and audio.
  - Managing Google Flow projects, character consistency, ingredients, and upscaling.

- **Do NOT use when:**
  - Simple 2D icon or vector creation (use standard design tools).
  - Unauthenticated environments where Google login cannot be performed via the dedicated Chrome profile.

---

## 2. Models & Credit Economics

| Model | Credits / Clip | Resolution & Duration | Best For | Notes |
| :--- | :---: | :---: | :--- | :--- |
| **`Omni` (Gemini Omni 1.1 Flash)** | **12** | 720p / 8 seconds | **High Realism & Narrative Coherence** | **Recommended balance.** Richer lighting, natural movement, free 1080p upscale. |
| **`Veo 3.1 Fast`** | 10 | 720p / 5–8 seconds | Quick drafts & prototyping | Faster generation turnaround. |
| **`Veo 3.1 Quality`** | 50 | High fidelity / 5–8 seconds | Hero showcase pieces | Highest credit consumption (5x of Fast). |
| **1080p Upscale** | **0 (Free)** | 1080p | Final production master | Always upscale completed 720p clips in Flow before downloading. |

> [!TIP]
> **Aspect Ratio Strategy:** Generate only in **16:9** in Flow (`12 credits`). Convert to **9:16** locally using FFmpeg with center-crop (`-vf "crop=ih*9/16:ih"`) or directional panning. This saves 50% of your AI credits.

---

## 3. Tool Reference (18 MCP Tools)

| Tool | Parameters | Purpose |
| :--- | :--- | :--- |
| `flow_generate` | `scenePrompt`, `model?`, `aspectRatio?`, `imageInput?`, `subjectRef?`, `styleRef?`, `fps?` | Launch video or image generation in Flow. Returns job ID. |
| `flow_status` | `detailed?` | Get current project status, active jobs, credits balance, and recent outputs. |
| `flow_wait` | `jobId`, `timeoutMs?` | Poll until a specific generation job finishes or fails. |
| `flow_download` | `jobId`, `targetDir?`, `filename?` | Download completed video (MP4) or image (JPEG/PNG) to disk. |
| `flow_cancel` | `jobId` | Cancel a running generation job to avoid credit waste. |
| `flow_retry` | `jobId` | Retry a failed generation with the same parameters. |
| `flow_character` | `name`, `images[]`, `description?` | Register a consistent character identity across multiple scenes. |
| `flow_character_edit` | `name`, `images[]` | Update reference imagery for an existing character. |
| `flow_characters` | *none* | List all registered characters in the current project. |
| `flow_techniques` | *none* | List available cinematic camera techniques and shot presets. |
| `flow_narrate` | `text`, `voice?`, `outputFile?` | Generate voiceover audio using Gemini TTS or Windows local speech. |
| `flow_voices` | *none* | List available voice personas for audio narration. |
| `flow_assemble` | `clips[]`, `audio?`, `outputFile?`, `transitions?` | Concatenate video clips, overlay soundtrack/narration via FFmpeg. |
| `flow_agent_images` | `prompt`, `count?` | Generate 2D image concepts/stills using Flow's image engine. |
| `flow_edit` | `jobId`, `prompt` | Inpaint or modify specific elements in an existing clip. |
| `flow_continue` | `jobId`, `prompt`, `direction?` | Extend an existing video clip forward in time. |
| `flow_trash` | `jobId` | Remove unwanted assets or failed runs from Flow project history. |

---

## 4. Realism & Cinematic Prompting Guide

To avoid the "AI look" (floaty camera, plastic skin, jittery hands), use **physical camera specifications and live-action cinematic choreography**:

### Key Prompt Components:
1. **Camera Sensor & Lens:** `ARRI Alexa Mini LF`, `RED V-Raptor`, `35mm / 85mm anamorphic lens at f/1.8`.
2. **Camera Movement:** `Steadicam push-in`, `low-angle tracking shot`, `speed-ramped slow motion (120fps)`, `macro rack-focus`, `smooth 45-degree drone orbit`.
3. **Foreground Layering (Crucial for Depth):** Place decor, glowing filaments, hanging flowers, or crowd shoulders inches away from the lens passing in soft bokeh.
4. **Lighting & Physics:** `Volumetric amber light beams`, `tungsten halation`, `cold sparkler pyro jets`, `drifting incense smoke`, `lens flares`.
5. **Realism Suffix:** `Ultra-realistic live-action 4K cinema footage, photorealistic skin textures, documentary event cinematography, matching starting frame.`

---

## 5. Automated Batch Scripting (`scripts/generate-eventa-videos.mjs`)

For batch tasks, run the automated script directly via Node:

```powershell
node scripts/generate-eventa-videos.mjs
```

### Script Capabilities:
- Reads clip definitions and prompts from configuration.
- Uploads reference starting images automatically.
- Requests `Omni` model at 16:9 aspect ratio.
- Polls Flow status until generation finishes.
- Automatically triggers free 1080p upscale and downloads.
- Runs FFmpeg locally:
  - Strips AI-generated audio artifacts (`-an`).
  - Converts 16:9 master to 9:16 vertical crop.
  - Encodes to standard H.264 24fps.
  - Saves simultaneously to project production folders.

---

## 6. Windows Setup & Troubleshooting

### One-Time Login:
```powershell
cd G:\agent-skills\mcp\flow-mcp
npm run login
```
A visible Chrome window opens on `https://flow.google.com/about` using the dedicated profile `C:\Users\madha\.flow-mcp\chrome-profile`. Sign in once, select or create your project, and close the window.

### Built-in Windows Enhancements:
- **Headless Port 9333 Conflict:** Automatically detects and terminates any hidden/background Chrome process holding the CDP port before launching login.
- **UI Overlay Auto-Dismiss:** Automatically closes the Flow "Untitled session" Agent panel and onboarding banners that otherwise block automated DOM clicks.
- **Cross-Platform Audio:** Uses Node `rmSync()` instead of Unix `rm`, and supports configurable `FLOW_MCP_FFPROBE` path.
- **Automatic `.env` Loader:** Reads configuration without requiring manual environment exports in PowerShell.
