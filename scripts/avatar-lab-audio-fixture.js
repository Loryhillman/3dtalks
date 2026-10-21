// Three seconds: tone, silence, tone. Test signal, not a speech/lip-sync reference.
function wav({ channels = 1, sampleRate = 16000, amplitude = .18, opposite = false } = {}) {
  const frames = sampleRate * 3, size = frames * channels * 2, data = Buffer.alloc(44 + size);
  data.write('RIFF', 0); data.writeUInt32LE(36 + size, 4); data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(channels, 22);
  data.writeUInt32LE(sampleRate, 24); data.writeUInt32LE(sampleRate * channels * 2, 28);
  data.writeUInt16LE(channels * 2, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(size, 40);
  for (let i = 0; i < frames; i++) for (let c = 0; c < channels; c++) {
    const time = i / sampleRate, value = time < 1 || time >= 2 ? Math.sin(2 * Math.PI * 170 * time) * amplitude : 0;
    data.writeInt16LE(Math.round(value * 32767 * (opposite && c === 1 ? -1 : 1)), 44 + (i * channels + c) * 2);
  }
  return data;
}
module.exports = { wav };
