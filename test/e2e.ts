import { existsSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { escapeAppleScript, platforms, projectRoot, resolveDefaultSound } from "../src/lib.js";

const entry = path.join(projectRoot(), "dist", "index.js");
const SOUNDS_DIR = path.join(projectRoot(), "sounds");

const TIMEOUT_MS = 20000;
function withTimeout<T>(p: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timeout: ${label}`)), TIMEOUT_MS)),
  ]);
}

type CallResult = Awaited<ReturnType<Client["callTool"]>>;
function textOf(res: CallResult): string {
  const content = (res as { content?: Array<{ text?: string }> }).content ?? [];
  return content.map((c) => c.text ?? "").join("\n");
}

// --- unit: AppleScript escaping (T2) ---
const esc1 = escapeAppleScript('a"b');
if (esc1 !== 'a\\"b') throw new Error(`escape quotes failed: ${esc1}`);
const esc2 = escapeAppleScript("line1\nline2");
if (esc2.includes("\n")) throw new Error(`escape newlines failed: ${JSON.stringify(esc2)}`);
if (!esc2.includes("\\n")) throw new Error(`expected literal backslash-n: ${JSON.stringify(esc2)}`);
const esc3 = escapeAppleScript("back\\slash");
if (esc3 !== "back\\\\slash") throw new Error(`escape backslash failed: ${esc3}`);
console.log("escaping unit checks: PASS");

// --- unit: platform support table (T8) ---
if (platforms.darwin.pickPlayer("x.mp4")?.cmd !== "afplay") throw new Error("darwin player expected afplay");
if (platforms.darwin.bannerCommand("t", "m")?.cmd !== "osascript") throw new Error("darwin banner expected osascript");
if (platforms.win32.pickPlayer("x.mp3")?.cmd !== "powershell") throw new Error("win32 player expected powershell");
if (platforms.win32.bannerCommand("t", "m")?.cmd !== "powershell") throw new Error("win32 banner expected powershell");
const winBanner = platforms.win32.bannerCommand("a'b", "c'd");
if (!winBanner) throw new Error("win32 banner expected a command");
const psBanner = winBanner.args.join(" ");
if (!psBanner.includes("a''b") || !psBanner.includes("c''d")) throw new Error("win32 powershell escaping failed");
console.log("platform unit checks: PASS");

// --- unit: default sound resolution, incl. bundled-chime branch (T4) ---
const tmp = mkdtempSync(path.join(tmpdir(), "mcp-notify-test-"));
try {
  const bundled = path.join(tmp, "chime.wav");
  const soundA = path.join(tmp, "a.mp3");
  const soundB = path.join(tmp, "b.mp3");
  const pinned = path.join(tmp, "default-x.mp3");
  writeFileSync(bundled, "x");
  if (resolveDefaultSound({ envSound: "/env.wav", sounds: [soundA], bundledSound: bundled }) !== "/env.wav") {
    throw new Error("envSound should win");
  }
  if (resolveDefaultSound({ sounds: [soundA, soundB, pinned], bundledSound: bundled }) !== pinned) {
    throw new Error("default* pin should win over alphabetical");
  }
  if (resolveDefaultSound({ sounds: [soundA, soundB], bundledSound: bundled }) !== soundA) {
    throw new Error("alphabetical first should win");
  }
  if (resolveDefaultSound({ sounds: [], bundledSound: bundled }) !== bundled) {
    throw new Error("bundled chime should be used when sounds/ is empty");
  }
  const missingBundled = path.join(tmp, "missing.wav");
  if (resolveDefaultSound({ sounds: [], bundledSound: missingBundled, systemSound: "/sys.oga" }) !== "/sys.oga") {
    throw new Error("system sound should be the last fallback");
  }
  console.log("resolveDefaultSound unit checks: PASS");
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

// --- e2e: main client ---
const transport = new StdioClientTransport({ command: process.execPath, args: [entry] });
const client = new Client({ name: "e2e-test", version: "0.0.0" });
await withTimeout(client.connect(transport), "connect");

const tools = await withTimeout(client.listTools(), "listTools");
const names = tools.tools.map((t) => t.name).sort();
console.log("tools:", names.join(", "));
if (!names.includes("notify") || !names.includes("list_sounds")) throw new Error("missing tools");

const listRes = await withTimeout(client.callTool({ name: "list_sounds", arguments: {} }), "list_sounds");
const listText = textOf(listRes);
console.log("list_sounds:", listText);
const defaultLine = listText.split("\n").find((l) => l.startsWith("Default sound:")) ?? "";
const defaultPath = defaultLine.replace("Default sound: ", "").replace(" (from NOTIFY_SOUND)", "");
if (!defaultPath || !existsSync(defaultPath)) throw new Error(`default sound does not exist: ${defaultPath}`);

const ok = await withTimeout(
  client.callTool({ name: "notify", arguments: { title: "E2E test", message: "E2E test notification" } }),
  "notify",
);
const okText = textOf(ok);
console.log("notify:", okText);
if (ok.isError) throw new Error("notify reported an error");
if (!okText.includes("Played sound") || !okText.includes("Banner shown")) throw new Error("missing sound/banner in result");

const newline = await withTimeout(
  client.callTool({ name: "notify", arguments: { title: "Multi line", message: "line one\nline two" } }),
  "notify-newline",
);
const newlineText = textOf(newline);
console.log("notify(newline message):", newlineText);
if (newline.isError) throw new Error("newline message rejected: " + newlineText);

const bad = await withTimeout(
  client.callTool({
    name: "notify",
    arguments: { title: "Bad file", message: "Testing error path", sound: "/tmp/does-not-exist.m4a" },
  }),
  "notify-bad",
);
const badText = textOf(bad);
console.log("notify(bad path):", badText);
if (!bad.isError) throw new Error("expected error for missing sound file");
if (!/Banner (shown|failed)/.test(badText)) throw new Error("banner result missing when sound fails (T3): " + badText);

const relative = await withTimeout(
  client.callTool({
    name: "notify",
    arguments: { title: "Relative", message: "Should be rejected", sound: "sounds/notify-me.mp3" },
  }),
  "notify-relative",
);
if (!relative.isError) throw new Error("expected validation error for relative sound path");
console.log("notify(relative sound path) rejected as expected");

const missing = await withTimeout(client.callTool({ name: "notify", arguments: { title: "x" } }), "notify-missing");
if (!missing.isError) throw new Error("expected validation error for missing message");
console.log("notify(missing message) rejected as expected");

// --- default selection with multiple sounds (T4) ---
const tmpA = path.join(SOUNDS_DIR, "aaa-test-a.mp3");
const tmpB = path.join(SOUNDS_DIR, "aaa-test-b.mp3");
const tmpD = path.join(SOUNDS_DIR, "default-test.mp3");
const defaultOf = (text: string) => (text.match(/Default sound: (.+)/) ?? [])[1]?.replace(" (from NOTIFY_SOUND)", "");
// Pre-clean: a previous crashed run could have left these behind, and a
// leftover default-test.mp3 would hijack the pinned default resolution.
for (const f of [tmpA, tmpB, tmpD]) {
  if (existsSync(f)) unlinkSync(f);
}
try {
  writeFileSync(tmpA, "x");
  writeFileSync(tmpB, "x");
  const r1 = textOf(await withTimeout(client.callTool({ name: "list_sounds", arguments: {} }), "list_sounds-2"));
  const def1 = defaultOf(r1);
  if (def1 !== tmpA) throw new Error(`expected alphabetical default ${tmpA}, got ${def1}`);
  writeFileSync(tmpD, "x");
  const r2 = textOf(await withTimeout(client.callTool({ name: "list_sounds", arguments: {} }), "list_sounds-3"));
  const def2 = defaultOf(r2);
  if (def2 !== tmpD) throw new Error(`expected pinned default ${tmpD}, got ${def2}`);
  console.log("default selection (alphabetical + default* pin): PASS");
} finally {
  for (const f of [tmpA, tmpB, tmpD]) {
    if (existsSync(f)) unlinkSync(f);
  }
}

await withTimeout(client.close(), "close");

// --- e2e: NOTIFY_SOUND env override (T4) ---
const override = "/tmp/notify-sound-override.wav";
const transport2 = new StdioClientTransport({
  command: process.execPath,
  args: [entry],
  env: { ...process.env, NOTIFY_SOUND: override },
});
const client2 = new Client({ name: "e2e-test-env", version: "0.0.0" });
await withTimeout(client2.connect(transport2), "connect-env");
const list2 = textOf(await withTimeout(client2.callTool({ name: "list_sounds", arguments: {} }), "list_sounds-env"));
if (!list2.includes(override)) throw new Error("NOTIFY_SOUND env not honored: " + list2);
console.log("NOTIFY_SOUND override: PASS");
await withTimeout(client2.close(), "close-env");

console.log("PASS");
