// Bounded PCM-WAV reader and language-independent amplitude envelope for the lab.
(function (root) {
  const MAX_BYTES = 12 * 1024 * 1024, MAX_SECONDS = 60;
  function parseWav(buffer) {
    const fail = () => { throw Error('Нужен WAV PCM 16-bit, 1–2 канала, 8–48 кГц, до 60 секунд и 12 МиБ'); };
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 44 || buffer.byteLength > MAX_BYTES) fail();
    const view = new DataView(buffer);
    const text = offset => String.fromCharCode(...new Uint8Array(buffer, offset, 4));
    if (text(0) !== 'RIFF' || text(8) !== 'WAVE' || view.getUint32(4, true) + 8 !== buffer.byteLength) fail();
    let format, data, offset = 12, count = 0;
    while (offset + 8 <= buffer.byteLength) {
      if (++count > 128) fail();
      const kind = text(offset), size = view.getUint32(offset + 4, true), start = offset + 8;
      if (start + size > buffer.byteLength) fail();
      if (kind === 'fmt ') {
        if (format || size < 16) fail();
        format = { codec: view.getUint16(start, true), channels: view.getUint16(start + 2, true),
          rate: view.getUint32(start + 4, true), byteRate: view.getUint32(start + 8, true),
          alignment: view.getUint16(start + 12, true), bits: view.getUint16(start + 14, true) };
      }
      if (kind === 'data') { if (data) fail(); data = { start, size }; }
      offset = start + size + size % 2;
    }
    if (offset !== buffer.byteLength || !format || !data) fail();
    const f = format;
    if (f.codec !== 1 || f.bits !== 16 || ![1, 2].includes(f.channels) || f.rate < 8000 || f.rate > 48000 ||
      f.alignment !== f.channels * 2 || f.byteRate !== f.rate * f.alignment || !data.size || data.size % f.alignment) fail();
    const frames = data.size / f.alignment, duration = frames / f.rate;
    if (duration > MAX_SECONDS) fail();
    const channels = Array.from({ length: f.channels }, () => new Float32Array(frames));
    for (let frame = 0; frame < frames; frame++) for (let channel = 0; channel < f.channels; channel++) {
      channels[channel][frame] = view.getInt16(data.start + frame * f.alignment + channel * 2, true) / 32768;
    }
    return { channels, sampleRate: f.rate, duration };
  }
  function envelope(clip) {
    const hop = Math.max(1, Math.round(clip.sampleRate * .02)), length = clip.channels[0].length;
    const weights = new Float32Array(Math.ceil(length / hop) + 1);
    let value = 0, open = false;
    for (let frame = 0; frame < length; frame += hop) {
      const end = Math.min(length, frame + hop); let energy = 0;
      for (const channel of clip.channels) for (let i = frame; i < end; i++) energy += channel[i] * channel[i];
      const rms = Math.sqrt(energy / ((end - frame) * clip.channels.length));
      open = rms > (open ? .009 : .014);
      const target = open ? Math.min(.85, Math.max(0, (rms - .009) * 7)) : 0;
      value += (target - value) * (1 - Math.exp(-.02 / (target > value ? .025 : .06)));
      if (value < .003) value = 0;
      weights[Math.floor(frame / hop)] = value;
    }
    return { weights, step: hop / clip.sampleRate, duration: clip.duration };
  }
  function at(signal, seconds) {
    if (!signal || seconds < 0 || seconds >= signal.duration) return 0;
    const position = seconds / signal.step, index = Math.floor(position), fraction = position - index;
    return signal.weights[index] * (1 - fraction) + signal.weights[Math.min(index + 1, signal.weights.length - 1)] * fraction;
  }
  const api = { MAX_BYTES, parseWav, envelope, at };
  if (typeof module !== 'undefined') module.exports = api; else root.AvatarLabSignal = api;
})(typeof window === 'undefined' ? globalThis : window);
