#!/usr/bin/env node
import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  currentPlatformSupport,
  isFile,
  listSounds,
  projectRoot,
  resolveDefaultSound,
} from "./lib.js";

const pkg = createRequire(import.meta.url)(path.join(projectRoot(), "package.json")) as { version: string };
const VERSION = pkg.version;

const ROOT = projectRoot();
const SOUNDS_DIR = path.join(ROOT, "sounds");
const BUNDLED_SOUND = path.join(ROOT, "assets", "default.wav");
const SOUND_FAIL_FAST_MS = 1500;
const BANNER_FAIL_FAST_MS = 3000;

const support = currentPlatformSupport();

type Result = { ok: boolean; error?: string };

function pickDefaultSound(): string {
  return resolveDefaultSound({
    envSound: process.env.NOTIFY_SOUND,
    sounds: listSounds(SOUNDS_DIR),
    bundledSound: BUNDLED_SOUND,
    systemSound: support.systemSound,
  });
}

function spawnAndSettle(cmd: string, args: string[], failFastMs: number): Promise<Result> {
  return new Promise((resolve) => {
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    let stderr = "";
    const finish = (r: Result) => {
      if (settled) {
        if (!r.ok) console.error(`mcp-notify: late failure: ${r.error}`);
        return;
      }
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(r);
    };
    // The command exits quickly with an error on bad input; on success it may
    // stay alive (players) or exit promptly (banners). Assume success once
    // the fail-fast window passes; late failures are logged to stderr.
    timer = setTimeout(() => finish({ ok: true }), failFastMs);
    let child: ChildProcess | undefined;
    try {
      child = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"], detached: true, windowsHide: true });
    } catch (err) {
      finish({ ok: false, error: String(err) });
      return;
    }
    child.stderr?.on("data", (d) => (stderr += String(d)));
    // A piped stderr stream keeps the event loop (and this process) alive
    // until the child exits; unref it so a still-playing sound never blocks
    // server shutdown after the client disconnects. (Readable's type doesn't
    // declare unref, but the underlying stream is a Socket which has it.)
    (child.stderr as { unref?: () => void } | null)?.unref?.();
    child.on("error", (err) => finish({ ok: false, error: err.message }));
    child.on("close", (code, signal) => {
      if (code === 0) finish({ ok: true });
      else if (code === null && signal) finish({ ok: false, error: `command killed by signal ${signal}` });
      else finish({ ok: false, error: stderr.trim() || `command exited with code ${code}` });
    });
    child.unref();
  });
}

async function playSound(file: string): Promise<Result> {
  if (!isFile(file)) return { ok: false, error: "file not found (or not a regular file)" };
  if (process.env.CI) return { ok: true };
  const player = support.pickPlayer(file);
  if (!player) return { ok: false, error: "no audio player found for this file type on this platform" };
  return spawnAndSettle(player.cmd, player.args, SOUND_FAIL_FAST_MS);
}

async function showBanner(title: string, message: string): Promise<Result> {
  if (process.env.CI) return { ok: true };
  const banner = support.bannerCommand(title, message);
  if (!banner) return { ok: false, error: "no notification facility found on this platform" };
  return spawnAndSettle(banner.cmd, banner.args, BANNER_FAIL_FAST_MS);
}

const server = new McpServer({ name: "mcp-notify", version: VERSION });

server.registerTool(
  "notify",
  {
    title: "Notify",
    description:
      "Play a notification sound on the user's computer and show a system banner. " +
      "Call this whenever a task is done, something needs the user's attention, or the user asks to be notified. " +
      "Always write a concise, human-friendly `title` and `message` describing what just happened or needs attention " +
      "(e.g. title: 'Build finished', message: 'All 142 tests passed, no errors.'). " +
      "Default sound resolution: NOTIFY_SOUND env var, then a sounds/default* file, then the first file in this " +
      "server's sounds/ folder, then the bundled chime, then the system sound. " +
      "You can pass an absolute path to any audio/video file with audio (mp4, m4a, mp3, wav, aiff) in `sound`.",
    inputSchema: {
      title: z
        .string()
        .max(50)
        .describe("Short banner title (max 50 chars), e.g. 'Task done', 'Build finished', 'Needs your input'."),
      message: z
        .string()
        .max(200)
        .describe("One or two sentence description of what happened, shown in the notification banner."),
      sound: z
        .string()
        .refine((v) => path.isAbsolute(v), { message: "sound must be an absolute file path" })
        .optional()
        .describe("Absolute path to a sound file to play instead of the default."),
    },
  },
  async ({ sound, title, message }) => {
    const file = sound ?? pickDefaultSound();
    const [soundRes, bannerRes] = await Promise.all([playSound(file), showBanner(title, message)]);
    const parts: string[] = [];
    if (soundRes.ok) {
      parts.push(`Played sound: ${file}`);
    } else {
      parts.push(`Could not play sound "${file}": ${soundRes.error}`);
    }
    if (bannerRes.ok) {
      parts.push(`Banner shown: "${title}" — ${message}`);
    } else {
      parts.push(`Banner failed: ${bannerRes.error}`);
    }
    return {
      content: [{ type: "text", text: parts.join(". ") }],
      // Sound is the primary function; a failed banner is reported in the
      // text above but does not fail the call.
      isError: !soundRes.ok,
    };
  },
);

server.registerTool(
  "list_sounds",
  {
    title: "List sounds",
    description:
      "List audio files available to the notify tool and the currently selected default sound. " +
      "Resolution order: NOTIFY_SOUND env var, sounds/default* file, first file in sounds/, bundled chime, system sound.",
    inputSchema: {},
  },
  async () => {
    const sounds = listSounds(SOUNDS_DIR);
    const def = pickDefaultSound();
    const lines = [
      `Default sound: ${def}${process.env.NOTIFY_SOUND ? " (from NOTIFY_SOUND)" : ""}`,
      `Sounds in ${SOUNDS_DIR}:`,
      ...(sounds.length ? sounds.map((s) => `  - ${s}`) : ["  (none — set NOTIFY_SOUND or pass `sound` to notify)"]),
    ];
    return { content: [{ type: "text", text: lines.join("\n") }] };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("mcp-notify: ready on stdio");
