// Generates assets/default.wav: a short 440Hz sine chime with a soft fade-out.
// Pure Node, no dependencies, deterministic output.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "assets", "default.wav");
const sampleRate = 44100;
const seconds = 0.8;
const freq = 440;
const fadeSamples = 800;
const n = Math.floor(sampleRate * seconds);
const samples = new Int16Array(n);
for (let i = 0; i < n; i++) {
  const t = i / sampleRate;
  const fade = i > n - fadeSamples ? (n - i) / fadeSamples : 1;
  samples[i] = Math.round(Math.sin(2 * Math.PI * freq * t) * 0.5 * fade * 32767);
}
const header = Buffer.alloc(44);
header.write("RIFF", 0);
header.writeUInt32LE(36 + n * 2, 4);
header.write("WAVE", 8);
header.write("fmt ", 12);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20);
header.writeUInt16LE(1, 22);
header.writeUInt32LE(sampleRate, 24);
header.writeUInt32LE(sampleRate * 2, 28);
header.writeUInt16LE(2, 32);
header.writeUInt16LE(16, 34);
header.write("data", 36);
header.writeUInt32LE(n * 2, 40);
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, Buffer.concat([header, Buffer.from(samples.buffer)]));
console.log("wrote", out);
