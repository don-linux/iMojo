import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parseWavPcm16, resampleLinear } from "./pcm.ts";

function encode(options: {
  format?: number;
  sampleRate?: number;
  bits?: number;
  channels?: Int16Array[];
  preamble?: Uint8Array;
} = {}): ArrayBuffer {
  const format = options.format ?? 1;
  const sampleRate = options.sampleRate ?? 32_000;
  const bits = options.bits ?? 16;
  const channels = options.channels ?? [Int16Array.of(16_384, -16_384), Int16Array.of(0, 32_767)];
  const count = channels.length;
  const frames = channels[0]?.length ?? 0;
  const preamble = options.preamble;
  const preambleSpan = preamble ? 8 + preamble.length + (preamble.length & 1) : 0;
  const dataBytes = frames * count * 2;
  const bytes = new ArrayBuffer(36 + preambleSpan + 8 + dataBytes);
  const view = new DataView(bytes);
  const mark = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index += 1) {
      view.setUint8(offset + index, text.charCodeAt(index));
    }
  };
  mark(0, "RIFF");
  view.setUint32(4, bytes.byteLength - 8, true);
  mark(8, "WAVE");
  mark(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, count, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * Math.max(count, 1) * (bits / 8), true);
  view.setUint16(32, count * (bits / 8), true);
  view.setUint16(34, bits, true);
  let offset = 36;
  if (preamble) {
    mark(offset, "fact");
    view.setUint32(offset + 4, preamble.length, true);
    new Uint8Array(bytes, offset + 8, preamble.length).set(preamble);
    offset += preambleSpan;
  }
  mark(offset, "data");
  view.setUint32(offset + 4, dataBytes, true);
  offset += 8;
  for (let frame = 0; frame < frames; frame += 1) {
    for (let channel = 0; channel < count; channel += 1) {
      view.setInt16(offset, channels[channel]?.[frame] ?? 0, true);
      offset += 2;
    }
  }
  return bytes;
}

test("parses stereo 16-bit PCM and skips an odd-sized chunk", () => {
  const parsed = parseWavPcm16(encode({ preamble: Uint8Array.of(1, 2, 3) }));
  assert.ok(parsed);
  assert.equal(parsed.sampleRate, 32_000);
  assert.equal(parsed.channels.length, 2);
  assert.equal(parsed.channels[0].length, 2);
  assert.ok(Math.abs(parsed.channels[0][0] - 0.5) < 1e-6);
  assert.ok(Math.abs(parsed.channels[0][1] + 0.5) < 1e-6);
  assert.notEqual(parsed.channels[0][0], parsed.channels[1][0]);
  assert.notEqual(parsed.channels[0][1], parsed.channels[1][1]);
});

test("rejects anything other than 16-bit PCM", () => {
  assert.equal(parseWavPcm16(new ArrayBuffer(8)), null);
  assert.equal(parseWavPcm16(encode({ format: 3 })), null);
  assert.equal(parseWavPcm16(encode({ bits: 8 })), null);
  assert.equal(parseWavPcm16(encode({ bits: 24 })), null);
  assert.equal(parseWavPcm16(encode({ sampleRate: 0 })), null);
  assert.equal(parseWavPcm16(encode({ channels: [] })), null);
  const ripped = encode();
  new Uint8Array(ripped)[0] = 0;
  assert.equal(parseWavPcm16(ripped), null);
  const notWave = encode();
  new DataView(notWave).setUint8(8, 0);
  assert.equal(parseWavPcm16(notWave), null);
  assert.equal(parseWavPcm16(encode().slice(0, 20)), null);
  const oversized = encode();
  new DataView(oversized).setUint32(40, 999_999, true);
  assert.equal(parseWavPcm16(oversized), null);
  const align = encode();
  new DataView(align).setUint16(32, 6, true);
  assert.equal(parseWavPcm16(align), null);
  const missingFmt = encode();
  new DataView(missingFmt).setUint8(12, "X".charCodeAt(0));
  assert.equal(parseWavPcm16(missingFmt), null);
});

test("resamples 1827 frames at 32 kHz without changing duration or equal rates", () => {
  const channels = [new Float32Array(1827), new Float32Array(1827)];
  channels[0][0] = 0.25;
  const to48 = resampleLinear(channels, 32_000, 48_000);
  const to44 = resampleLinear(channels, 32_000, 44_100);
  assert.equal(to48[0].length, 2741);
  assert.equal(to48[1].length, 2741);
  assert.equal(to44[0].length, Math.round((1827 * 44_100) / 32_000));
  const srcMs = (1827 / 32_000) * 1000;
  assert.ok(Math.abs(srcMs - 57.09) < 0.01);
  assert.ok(Math.abs((to48[0].length / 48_000) * 1000 - srcMs) < 0.02);
  assert.ok(Math.abs((to44[0].length / 44_100) * 1000 - srcMs) < 0.02);
  assert.equal(to48[0][0], 0.25);
  const same = resampleLinear(channels, 32_000, 32_000);
  assert.equal(same, channels);
  assert.equal(same[0], channels[0]);
});

test("guards empty and single-frame input", () => {
  assert.deepEqual(resampleLinear([], 32_000, 48_000), []);
  const empty = [new Float32Array(0)];
  assert.equal(resampleLinear(empty, 32_000, 48_000)[0], empty[0]);
  const one = [new Float32Array([0.5]), new Float32Array([-0.25])];
  const stretched = resampleLinear(one, 32_000, 48_000);
  assert.equal(stretched[0].length, 2);
  assert.equal(stretched[1].length, 2);
  assert.equal(stretched[0][0], 0.5);
  assert.equal(stretched[0][1], 0.5);
  assert.equal(stretched[1][0], -0.25);
  const ramp = resampleLinear([new Float32Array([0, 1])], 100, 200);
  assert.deepEqual(Array.from(ramp[0]), [0, 0.5, 1, 1]);
  assert.equal(resampleLinear([new Float32Array([1])], 100, 1)[0].length, 0);
});

test("reads the shipped click as stereo 32 kHz, 1827 frames", () => {
  const file = readFileSync(fileURLToPath(new URL("../ipod/assets/click.wav", import.meta.url)));
  const bytes = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
  const parsed = parseWavPcm16(bytes);
  assert.ok(parsed);
  assert.equal(parsed.channels.length, 2);
  assert.equal(parsed.sampleRate, 32_000);
  assert.equal(parsed.channels[0].length, 1827);
  assert.equal(parsed.channels[1].length, 1827);
  const durationMs = (parsed.channels[0].length / parsed.sampleRate) * 1000;
  assert.ok(Math.abs(durationMs - 57.09) < 0.01);
  let differs = false;
  for (let index = 0; index < parsed.channels[0].length; index += 1) {
    const left = parsed.channels[0][index];
    const right = parsed.channels[1][index];
    assert.ok(left >= -1 && left <= 1 && right >= -1 && right <= 1);
    if (left !== right) differs = true;
  }
  assert.equal(differs, true);
  assert.equal(resampleLinear(parsed.channels, parsed.sampleRate, 48_000)[0].length, 2741);
});
