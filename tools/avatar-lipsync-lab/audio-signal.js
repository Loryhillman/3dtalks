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
  const { envelope, at } = typeof module !== 'undefined' ? require('../../public/js/avatarAudioSignal') : root.AvatarAudioSignal;
  const api = { MAX_BYTES, parseWav, envelope, at };
  if (typeof module !== 'undefined') module.exports = api; else root.AvatarLabSignal = api;
})(typeof window === 'undefined' ? globalThis : window);
