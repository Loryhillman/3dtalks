// Audio-clock-independent energy analysis shared by room playback and the local lab.
(function (root) {
  function envelope(clip) {
    if (!clip || !Number.isFinite(clip.sampleRate) || clip.sampleRate < 8000 || clip.sampleRate > 96000 ||
        !Number.isFinite(clip.duration) || clip.duration <= 0 || clip.duration > 61 ||
        !Array.isArray(clip.channels) || ![1, 2].includes(clip.channels.length)) throw Error('INVALID_AUDIO_SIGNAL');
    const length = clip.channels[0]?.length;
    if (!length || length > 61 * clip.sampleRate || clip.channels.some(channel => channel.length !== length)) throw Error('INVALID_AUDIO_SIGNAL');
    const hop = Math.max(1, Math.round(clip.sampleRate * .02));
    const weights = new Float32Array(Math.ceil(length / hop) + 1);
    let value = 0, open = false;
    for (let frame = 0; frame < length; frame += hop) {
      const end = Math.min(length, frame + hop); let energy = 0;
      for (const channel of clip.channels) for (let i = frame; i < end; i++) {
        const sample = channel[i];
        if (!Number.isFinite(sample)) throw Error('INVALID_AUDIO_SIGNAL');
        energy += sample * sample;
      }
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
    if (!signal || !Number.isFinite(seconds) || seconds < 0 || seconds >= signal.duration) return 0;
    const position = seconds / signal.step, index = Math.floor(position), fraction = position - index;
    return signal.weights[index] * (1 - fraction) + signal.weights[Math.min(index + 1, signal.weights.length - 1)] * fraction;
  }
  const api = { envelope, at };
  if (typeof module !== 'undefined') module.exports = api; else root.AvatarAudioSignal = api;
})(typeof window === 'undefined' ? globalThis : window);
