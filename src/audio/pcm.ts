export type Pcm16 = {
  sampleRate: number;
  channels: Float32Array[];
};

const PCM_FORMAT = 1;
const PCM_BITS = 16;

export function parseWavPcm16(bytes: ArrayBuffer): Pcm16 | null {
  if (bytes.byteLength < 12) return null;
  const view = new DataView(bytes);
  if (chunkId(view, 0) !== "RIFF" || chunkId(view, 8) !== "WAVE") return null;

  let offset = 12;
  let format = 0;
  let channelCount = 0;
  let sampleRate = 0;
  let bits = 0;
  let blockAlign = 0;
  let dataOffset = -1;
  let dataBytes = 0;

  while (offset + 8 <= bytes.byteLength) {
    const id = chunkId(view, offset);
    const size = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (size > bytes.byteLength - start) return null;
    if (id === "fmt ") {
      if (size < 16) return null;
      format = view.getUint16(start, true);
      channelCount = view.getUint16(start + 2, true);
      sampleRate = view.getUint32(start + 4, true);
      blockAlign = view.getUint16(start + 12, true);
      bits = view.getUint16(start + 14, true);
    } else if (id === "data") {
      dataOffset = start;
      dataBytes = size;
      break;
    }
    offset = start + size + (size & 1);
  }

  if (format !== PCM_FORMAT || bits !== PCM_BITS) return null;
  if (channelCount < 1 || sampleRate < 1 || dataOffset < 0) return null;
  const frameBytes = channelCount * 2;
  if (blockAlign !== frameBytes) return null;
  const frames = Math.floor(dataBytes / frameBytes);
  if (frames < 1) return null;

  const channels: Float32Array[] = [];
  for (let channel = 0; channel < channelCount; channel += 1) {
    const samples = new Float32Array(frames);
    for (let frame = 0; frame < frames; frame += 1) {
      const sample = view.getInt16(dataOffset + frame * frameBytes + channel * 2, true);
      samples[frame] = sample / 32768;
    }
    channels.push(samples);
  }
  return { sampleRate, channels };
}

export function resampleLinear(
  channels: Float32Array[],
  srcRate: number,
  dstRate: number,
): Float32Array[] {
  if (channels.length === 0) return [];
  const frames = channels[0].length;
  if (
    frames === 0 ||
    srcRate === dstRate ||
    !Number.isFinite(srcRate) ||
    !Number.isFinite(dstRate) ||
    srcRate <= 0 ||
    dstRate <= 0
  ) {
    return channels;
  }
  const dstFrames = Math.round((frames * dstRate) / srcRate);
  if (dstFrames <= 0) return channels.map(() => new Float32Array(0));
  const step = srcRate / dstRate;
  return channels.map((src) => {
    const dst = new Float32Array(dstFrames);
    const last = src.length - 1;
    if (last < 0) return dst;
    for (let index = 0; index < dstFrames; index += 1) {
      const position = index * step;
      const left = Math.min(last, Math.floor(position));
      const right = Math.min(last, left + 1);
      const fraction = position - left;
      dst[index] = src[left] + (src[right] - src[left]) * fraction;
    }
    return dst;
  });
}

function chunkId(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}
