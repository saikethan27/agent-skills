#!/usr/bin/env node
/**
 * Automated Eventa 16:9 Video Generator (Hero Loop + 10 Highlight Film Clips)
 * Reads inputs from: G:\eventa\assets\AI_images\images
 * Writes outputs to: G:\eventa\images\video AND G:\eventa\assets\AI_images\images\video
 * Also auto-converts 16:9 -> 9:16 via FFmpeg (0 extra credits).
 *
 * Usage:
 *   node scripts/generate-eventa-videos.mjs --phase=hero
 *   node scripts/generate-eventa-videos.mjs --phase=film
 *   node scripts/generate-eventa-videos.mjs --phase=all
 *   Optional flags:
 *     --model="Veo 3.1 - Fast" (default, 20 credits/clip)
 *     --model="Veo 3.1 - Quality" --max_credits=100 (100 credits/clip)
 *     --model="Omni 1.1 Flash" (12 credits/clip)
 */
import { execFile } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const exec = promisify(execFile);

const SRC_DIR = "G:\\eventa\\assets\\AI_images\\images";
const OUT_DIRS = [
  "G:\\eventa\\images\\video",
  "G:\\eventa\\assets\\AI_images\\images\\video",
];
for (const d of OUT_DIRS) mkdirSync(d, { recursive: true });

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"];
  }),
);
const PHASE = args.phase ?? "all";
const MODEL = args.model ?? "Omni";
const DURATION = MODEL.includes("Omni") ? 8 : undefined;
const RESOLUTION = MODEL.includes("Omni") ? "720p" : undefined;
const MAX_CREDITS = Number(args.max_credits ?? (MODEL.includes("Quality") ? 100 : 25));

const NEGATIVE_SUFFIX =
  " Generate an ultra-realistic, photorealistic live-action cinema video shot on a professional ARRI Alexa cinema camera that matches the exact realism, lighting, and textures of the starting frame, with natural human physics, lifelike faces and hands, and authentic real-world motion. Avoid: text, letters, logos, watermarks, camera shake, fast motion, morphing faces, distorted hands, extra fingers, flicker, sudden lighting jumps, cuts, zoom bursts, CGI, 3D render, synthetic look, or cartoon look.";

const FILM_CLIPS = [
  {
    num: "01",
    name: "Baraat arrival",
    prompt:
      "Slow tracking shot moving backward in front of the groom on a decorated white horse at night. Relatives in colorful kurtas and sherwanis dance around him with joyful, natural movements. Dhol players drum. Golden sparks from fireworks fall softly in the background. Warm street lights and marigold garlands. Camera stays smooth and steady.",
  },
  {
    num: "02",
    name: "Mandap pheras",
    prompt:
      "Slow, smooth orbit around the wedding mandap at waist height. The bride in a red lehenga and the groom in an ivory sherwani walk slowly around the sacred fire. Flames flicker gently in the brass havan kund. A few rose petals fall through the air. Calm, sacred, emotional mood.",
  },
  {
    num: "03",
    name: "Sangeet dance",
    prompt:
      "Low-angle slow push-in toward a group of young women in pastel lehengas dancing in sync on an LED dance floor. Graceful, rhythmic movements. Confetti floats down through magenta and blue stage light beams. Joyful energy, smooth camera.",
  },
  {
    num: "04",
    name: "Haldi",
    prompt:
      "Steady close shot. Family members gently apply yellow haldi paste to the laughing bride. Marigold petals are tossed in the air and fall slowly. Bright morning sunlight under a marigold canopy. Warm, playful mood. Small, natural movements.",
  },
  {
    num: "05",
    name: "Mehendi",
    prompt:
      "Slow macro slide along the bride's hand as a henna cone draws a fine pattern on the skin. The henna line grows smoothly. Soft bokeh lights and hanging lanterns in the blurred background. Calm, intimate mood. Hands stay natural and steady.",
  },
  {
    num: "06",
    name: "Reception entry",
    prompt:
      "Slow push-in toward the couple as they walk hand in hand through a floral arch into the reception hall. Cold pyro fountains on both sides send up sparks. Guests on both sides clap. Crystal chandeliers glow above. Grand, cinematic mood.",
  },
  {
    num: "07",
    name: "Dandiya night",
    prompt:
      "High wide crane shot slowly descending over large circles of dancers in colorful chaniya choli and kediyu, striking dandiya sticks in rhythm. Colorful lights strung overhead sway slightly. Festive, energetic, smooth camera.",
  },
  {
    num: "08",
    name: "Conference keynote",
    prompt:
      "Slow dolly forward from the back of a large conference hall over the heads of seated delegates toward the stage. The speaker gestures calmly in front of a curved LED wall with slowly moving abstract blue and magenta graphics. Light beams in soft haze. Professional, confident mood.",
  },
  {
    num: "09",
    name: "Product launch reveal",
    prompt:
      "A silk cover slides smoothly off a product on a pedestal on a dark stage. Light beams sweep across the haze and converge on the product. Audience silhouettes in the foreground raise their phones. Dramatic, premium mood. Camera stays still, slight push-in.",
  },
  {
    num: "10",
    name: "Awards night",
    prompt:
      "Slow push-in on the winner on stage holding a trophy and smiling. Gold confetti bursts from above and falls slowly. Colleagues at round tables in the foreground cheer and clap. Gold and deep blue stage lights. Celebratory mood.",
  },
];

const client = new Client({ name: "eventa-video-runner", version: "1.0.0" });
await client.connect(new StdioClientTransport({ command: "node", args: ["dist/index.js"], env: process.env }));

const call = async (name, toolArgs = {}) => {
  const res = await client.callTool({ name, arguments: toolArgs }, undefined, { timeout: 960_000 });
  const parsed = JSON.parse(res.content[0].text);
  if (res.isError || parsed.error) throw new Error(parsed.error ?? `Tool ${name} failed`);
  return parsed;
};

async function runAndWait(project, scenes) {
  const gen = await call("flow_generate", { project, scenes });
  const ids = gen.jobs.map((j) => j.id);
  console.log(`[QUEUED] project=${project} jobs=${ids.join(",")}`);
  let done;
  do {
    done = await call("flow_wait", { job_ids: ids, timeout_seconds: 40 });
    const summary = done.jobs
      .map((j) => `${j.id}:${j.status}${j.progress ? ` (${j.progress})` : ""}`)
      .join(" | ");
    console.log(`[${new Date().toISOString().slice(11, 19)}] ${done.pacing ?? "active"} -> ${summary}`);
  } while (!done.finished);

  for (const job of done.jobs) {
    if (job.status !== "done" || !job.files?.length) {
      throw new Error(`Job ${job.id} (${job.scene}) failed: ${job.error ?? "no output file"}`);
    }
  }
  return done.jobs;
}

// Strips generated audio and normalizes to 24fps H.264 1080p silent MP4, copying to both target video directories.
async function saveSilentMp4(rawFile, fileName, extraFfmpegArgs = []) {
  const primaryOut = join(OUT_DIRS[0], fileName);
  await exec("ffmpeg", [
    "-y",
    "-i",
    rawFile,
    "-an",
    "-r",
    "24",
    ...extraFfmpegArgs,
    "-c:v",
    "libx264",
    "-crf",
    "18",
    "-preset",
    "medium",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    primaryOut,
  ]);
  for (const dir of OUT_DIRS.slice(1)) {
    copyFileSync(primaryOut, join(dir, fileName));
  }
  console.log(`[SAVED] ${fileName} -> ${OUT_DIRS.join(" & ")}`);
  return primaryOut;
}

// Converts a 16:9 1080p MP4 into a 9:16 (1080x1920) vertical MP4 via FFmpeg center-crop (0 credits).
async function convert16x9To9x16(file16x9Name, file9x16Name) {
  if (outExists(file9x16Name)) return;
  const srcPath = join(OUT_DIRS[0], file16x9Name);
  await saveSilentMp4(srcPath, file9x16Name, ["-vf", "crop=ih*9/16:ih,scale=1080:1920:flags=lanczos"]);
}

const outExists = (fileName) => existsSync(join(OUT_DIRS[0], fileName));

async function runHeroPhase() {
  console.log("\n=== PHASE 1: HERO IDLE LOOP 16:9 (H-01) ===");
  const posterPath = join(SRC_DIR, "hero", "ai-hero-poster-16x9.png");
  const darkPath = join(SRC_DIR, "hero", "ai-hero-dark-16x9.png");

  if (!existsSync(darkPath)) {
    console.log("[Hero 16:9] Step 1: Generating dark first frame (0 credits)...");
    const [job] = await runAndWait("Eventa_Hero_Dark_16x9", [
      {
        type: "image",
        aspect_ratio: "16:9",
        max_credits: 0,
        reference_images: [posterPath],
        download_quality: "upscaled",
        prompt:
          "Turn off all the lights in this scene. Keep the exact same stage, flowers, chandeliers, furniture, floor and camera angle as the reference image. Only a very faint deep-blue glow on the stage backdrop. Chandeliers off. Fairy lights off. Candles out. The hall is almost dark but the shapes are still visible. Ultra-realistic, photorealistic real-world architectural photography matching the exact realism of the reference image.",
      },
    ]);
    copyFileSync(job.files[0], darkPath);
    const mirrorHeroDir = "G:\\eventa\\images\\hero";
    if (existsSync(mirrorHeroDir)) copyFileSync(job.files[0], join(mirrorHeroDir, "ai-hero-dark-16x9.png"));
    console.log(`[Hero 16:9] Saved dark first frame -> ${darkPath}`);
  } else {
    console.log(`[Hero 16:9] Dark first frame already exists: ${darkPath}`);
  }

  const clipAName = "ai-hero-loop-a-16x9.mp4";
  const clipBName = "ai-hero-loop-b-16x9.mp4";
  const finalLoopName = "ai-hero-loop-16x9.mp4";

  if (!outExists(clipAName)) {
    console.log("[Hero 16:9] Step 2: Generating Clip A (Lights on, 8s)...");
    const [jobA] = await runAndWait("Eventa_Hero_A_16x9", [
      {
        type: "video",
        model: MODEL,
        aspect_ratio: "16:9",
        duration: DURATION,
        resolution: RESOLUTION,
        max_credits: MAX_CREDITS,
        first_frame: darkPath,
        last_frame: posterPath,
        download_quality: "upscaled",
        prompt:
          "Static camera with a very slow push-in. An empty Indian wedding reception stage in a dark hall comes alive. The lights switch on in order: first deep blue uplights on the backdrop, then a soft magenta wash, then warm golden fairy lights across the floral backdrop, then the candles and brass urlis glow, and last the crystal chandeliers light up. Thin haze drifts slowly through the light beams. Flower petals shimmer gently. No people. Smooth, calm, cinematic." +
          NEGATIVE_SUFFIX,
      },
    ]);
    await saveSilentMp4(jobA.files[0], clipAName);
  }

  if (!outExists(clipBName)) {
    console.log("[Hero 16:9] Step 3: Generating Clip B (Lights off, 8s)...");
    const [jobB] = await runAndWait("Eventa_Hero_B_16x9", [
      {
        type: "video",
        model: MODEL,
        aspect_ratio: "16:9",
        duration: DURATION,
        resolution: RESOLUTION,
        max_credits: MAX_CREDITS,
        first_frame: posterPath,
        last_frame: darkPath,
        download_quality: "upscaled",
        prompt:
          "Static camera with a very slow pull-back. The fully lit Indian wedding reception stage slowly fades to darkness. The chandeliers dim first, then the fairy lights, then the magenta wash, and the deep blue glow on the backdrop stays last. Thin haze drifts slowly. No people. Smooth, calm, cinematic." +
          NEGATIVE_SUFFIX,
      },
    ]);
    await saveSilentMp4(jobB.files[0], clipBName);
  }

  if (!outExists(finalLoopName)) {
    console.log(`[Hero 16:9] Step 4: Joining Clip A + 2s hold + Clip B -> ${finalLoopName}...`);
    const clipAPath = join(OUT_DIRS[0], clipAName);
    const clipBPath = join(OUT_DIRS[0], clipBName);
    const finalPath = join(OUT_DIRS[0], finalLoopName);
    await exec("ffmpeg", [
      "-y",
      "-i",
      clipAPath,
      "-i",
      clipBPath,
      "-filter_complex",
      "[0:v]tpad=stop_mode=clone:stop_duration=2,fps=24,setsar=1[v0];[1:v]fps=24,setsar=1[v1];[v0][v1]concat=n=2:v=1:a=0[v]",
      "-map",
      "[v]",
      "-an",
      "-c:v",
      "libx264",
      "-crf",
      "18",
      "-preset",
      "medium",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      finalPath,
    ]);
    for (const dir of OUT_DIRS.slice(1)) copyFileSync(finalPath, join(dir, finalLoopName));
    console.log(`[SAVED] ${finalLoopName}`);
  }

  // Also convert the finished 16:9 loop into 9:16 via FFmpeg (0 credits)
  await convert16x9To9x16(finalLoopName, "ai-hero-loop-9x16.mp4");
}

async function runFilmPhase() {
  console.log("\n=== PHASE 2: HIGHLIGHT FILM 16:9 (H-02, 10 CLIPS) ===");

  for (const clip of FILM_CLIPS) {
    const out16x9 = `ai-film-${clip.num}-16x9.mp4`;
    const out9x16 = `ai-film-${clip.num}-9x16.mp4`;

    if (outExists(out16x9)) {
      console.log(`[Skip] ${out16x9} already exists.`);
    } else {
      const firstFrame = join(SRC_DIR, "film", `ai-film-${clip.num}-first-frame-16x9.png`);
      const prompt = clip.prompt + NEGATIVE_SUFFIX;

      console.log(`[Film 16:9] Generating ${clip.num} (${clip.name})...`);
      const [job] = await runAndWait(`Eventa_Film_16x9_${clip.num}`, [
        {
          type: "video",
          model: MODEL,
          aspect_ratio: "16:9",
          duration: DURATION,
          resolution: RESOLUTION,
          max_credits: MAX_CREDITS,
          first_frame: firstFrame,
          download_quality: "upscaled",
          prompt,
        },
      ]);
      await saveSilentMp4(job.files[0], out16x9);
    }

    // Auto-convert 16:9 -> 9:16 via FFmpeg (0 credits)
    await convert16x9To9x16(out16x9, out9x16);
  }

  // Story order from VIDEO-PROMPTS.md Section 2: 01 -> 04 -> 05 -> 03 -> 02 -> 06 -> 07 -> 08 -> 09 -> 10
  const storyOrder = ["01", "04", "05", "03", "02", "06", "07", "08", "09", "10"];
  const stitched16x9 = "ai-film-16x9.mp4";
  if (!outExists(stitched16x9)) {
    const inputs = [];
    for (const num of storyOrder) {
      inputs.push("-i", join(OUT_DIRS[0], `ai-film-${num}-16x9.mp4`));
    }
    const n = storyOrder.length;
    const filter =
      storyOrder.map((_, i) => `[${i}:v]fps=24,setsar=1[v${i}];`).join("") +
      storyOrder.map((_, i) => `[v${i}]`).join("") +
      `concat=n=${n}:v=1:a=0,fade=t=out:st=${n * 8 - 2}:d=2[v]`;
    const finalPath = join(OUT_DIRS[0], stitched16x9);
    await exec("ffmpeg", [
      "-y",
      ...inputs,
      "-filter_complex",
      filter,
      "-map",
      "[v]",
      "-an",
      "-c:v",
      "libx264",
      "-crf",
      "18",
      "-preset",
      "medium",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      finalPath,
    ]);
    for (const dir of OUT_DIRS.slice(1)) copyFileSync(finalPath, join(dir, stitched16x9));
    console.log(`[SAVED] Stitched film -> ${stitched16x9}`);
  }

  await convert16x9To9x16(stitched16x9, "ai-film-9x16.mp4");
}

const status = await call("flow_status", { detailed: true });
console.log("FLOW SESSION:", JSON.stringify(status.flow));
if (!status.flow.signedIn || !status.flow.inProject) {
  throw new Error(status.flow.hint ?? "Flow is not ready.");
}

if (PHASE === "hero" || PHASE === "all") await runHeroPhase();
if (PHASE === "film" || PHASE === "all") await runFilmPhase();

await client.close();
console.log("\nAll requested Eventa 16:9 video tasks completed!");
process.exit(0);
