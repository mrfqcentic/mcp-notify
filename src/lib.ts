import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function projectRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

export const AUDIO_EXT = /\.(mp4|m4a|mp3|wav|aiff|aif)$/i;

export type Player = { cmd: string; args: string[] };

/** Escape a string for use inside an AppleScript double-quoted literal. */
export function escapeAppleScript(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, "\\n")
    .replace(/[\u0000-\u001f\u007f]/g, " ");
}

/** Escape a string for use inside a PowerShell single-quoted literal. */
export function escapePowerShell(s: string): string {
  return s.replace(/'/g, "''");
}

export function listSounds(soundsDir: string): string[] {
  if (!existsSync(soundsDir)) return [];
  return readdirSync(soundsDir)
    .filter((f) => AUDIO_EXT.test(f))
    .sort()
    .map((f) => path.join(soundsDir, f));
}

export function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

/**
 * Default sound resolution order:
 * 1. NOTIFY_SOUND env var (explicit, deterministic)
 * 2. A sound whose basename starts with "default" (the user's pin)
 * 3. First sound in the list (alphabetical)
 * 4. The bundled chime shipped with the package
 * 5. The platform system sound
 */
export function resolveDefaultSound(opts: {
  envSound?: string;
  sounds: string[];
  bundledSound?: string;
  systemSound?: string;
}): string {
  if (opts.envSound) return opts.envSound;
  const pinned = opts.sounds.find((f) => path.basename(f).toLowerCase().startsWith("default"));
  if (pinned) return pinned;
  if (opts.sounds.length > 0) return opts.sounds[0];
  if (opts.bundledSound && isFile(opts.bundledSound)) return opts.bundledSound;
  return opts.systemSound ?? opts.bundledSound ?? opts.sounds[0] ?? "";
}

/**
 * First executable found on PATH, or undefined.
 * On Windows, PATHEXT suffixes (.exe/.cmd/.bat) are tried.
 */
export function findInPath(cmd: string): string | undefined {
  const exts =
    process.platform === "win32"
      ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";").filter(Boolean).map((e) => e.toLowerCase())
      : [""];
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = path.join(dir, cmd + ext);
      if (existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

export interface PlatformSupport {
  systemSound?: string;
  pickPlayer: (file: string) => Player | null;
  bannerCommand: (title: string, message: string) => Player | null;
}

export const darwinSupport: PlatformSupport = {
  systemSound: "/System/Library/Sounds/Glass.aiff",
  pickPlayer: (file) => ({ cmd: "afplay", args: [file] }),
  bannerCommand: (title, message) => ({
    cmd: "osascript",
    args: ["-e", `display notification "${escapeAppleScript(message)}" with title "${escapeAppleScript(title)}"`],
  }),
};

export const win32Support: PlatformSupport = {
  pickPlayer: (file) => ({
    cmd: "powershell",
    args: [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `Add-Type -AssemblyName System.Windows.Media; $m = New-Object System.Windows.Media.MediaPlayer; $m.Open([uri]'${escapePowerShell(file)}'); $m.Play()`,
    ],
  }),
  bannerCommand: (title, message) => ({
    cmd: "powershell",
    args: [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `Add-Type -AssemblyName System.Windows.Forms; $n = New-Object System.Windows.Forms.NotifyIcon; $n.Icon = [System.Drawing.SystemIcons]::Information; $n.Visible = $true; $n.ShowBalloonTip(5000, '${escapePowerShell(title)}', '${escapePowerShell(message)}', [System.Windows.Forms.ToolTipIcon]::Info); Start-Sleep -Seconds 2`,
    ],
  }),
};

export const linuxSupport: PlatformSupport = {
  systemSound: "/usr/share/sounds/freedesktop/stereo/bell.oga",
  // ffplay first (plays every format we accept), mpg123 for mp3-only hosts,
  // paplay for PulseAudio, aplay (ALSA, wav-only) last.
  pickPlayer: (file) => {
    const ffplay = findInPath("ffplay");
    if (ffplay) return { cmd: ffplay, args: ["-nodisp", "-autoexit", "-loglevel", "quiet", file] };
    if (/\.mp3$/i.test(file)) {
      const mpg123 = findInPath("mpg123");
      if (mpg123) return { cmd: mpg123, args: [file] };
    }
    const paplay = findInPath("paplay");
    if (paplay) return { cmd: paplay, args: [file] };
    const aplay = findInPath("aplay");
    if (aplay && /\.wav$/i.test(file)) return { cmd: aplay, args: [file] };
    return null;
  },
  bannerCommand: (title, message) => {
    const notifySend = findInPath("notify-send");
    // "--" terminates option parsing so a leading-dash title/message
    // can never be interpreted as notify-send flags.
    return notifySend ? { cmd: notifySend, args: ["--", title, message] } : null;
  },
};

const unsupportedSupport: PlatformSupport = {
  pickPlayer: () => null,
  bannerCommand: () => null,
};

export const platforms: Record<string, PlatformSupport> = {
  darwin: darwinSupport,
  win32: win32Support,
  linux: linuxSupport,
};

export function currentPlatformSupport(): PlatformSupport {
  return platforms[process.platform] ?? unsupportedSupport;
}
