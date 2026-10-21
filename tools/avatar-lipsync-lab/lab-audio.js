// One local clip, one source and one animation loop. No capture or speech service.
window.AvatarLabAudio = {
  create({ onState, onMouth }) {
    let clip, signal, context, source, gain, frame, disposed = false, generation = 0, loading;
    let phase = 'empty', name = '', error = '', amount = 0, elapsed = 0, startedAt = 0, notifiedAt = 0;
    const state = () => ({ phase, name, error, amount, elapsed, duration: clip?.duration || 0 });
    const emit = () => onState(state());
    function closeMouth() { amount = 0; onMouth(0); }
    function stop() {
      ++generation; loading?.abort(); loading = null;
      cancelAnimationFrame(frame); frame = null;
      const old = source; source = null;
      if (old) { old.onended = null; try { old.stop(); } catch (_) {} old.disconnect(); }
      gain?.disconnect(); gain = null;
      elapsed = 0; error = ''; phase = disposed ? 'disposed' : clip ? 'ready' : 'empty';
      closeMouth(); emit();
    }
    async function load(read, label) {
      if (disposed) return;
      stop(); clip = signal = null; name = label; phase = 'loading'; emit();
      const ticket = generation, controller = new AbortController(); loading = controller;
      try {
        const bytes = await read(controller.signal);
        if (disposed || ticket !== generation) return;
        clip = window.AvatarLabSignal.parseWav(bytes); signal = window.AvatarLabSignal.envelope(clip);
        phase = 'ready';
      } catch (failure) {
        if (disposed || ticket !== generation) return;
        clip = signal = null; phase = 'error'; error = failure.message;
      } finally { if (!disposed && ticket === generation) { loading = null; emit(); } }
    }
    async function play() {
      if (disposed || !clip || ['starting', 'playing'].includes(phase)) return;
      stop(); const ticket = generation; phase = 'starting'; emit();
      try {
        const Audio = window.AudioContext || window.webkitAudioContext;
        if (!Audio) throw Error('Web Audio недоступен');
        context ||= new Audio(); await context.resume();
        if (disposed || ticket !== generation) return;
        if (context.state !== 'running' || document.hidden) { stop(); return; }
        const buffer = context.createBuffer(clip.channels.length, clip.channels[0].length, clip.sampleRate);
        clip.channels.forEach((channel, index) => buffer.copyToChannel(channel, index));
        source = context.createBufferSource(); source.buffer = buffer;
        gain = context.createGain(); gain.gain.value = .65; source.connect(gain).connect(context.destination);
        source.onended = () => { if (ticket === generation) stop(); };
        startedAt = context.currentTime; phase = 'playing'; source.start(startedAt); emit();
        function tick() {
          if (disposed || ticket !== generation || phase !== 'playing') return;
          elapsed = Math.max(0, context.currentTime - startedAt);
          amount = context.state === 'running' ? window.AvatarLabSignal.at(signal, elapsed) : 0; onMouth(amount);
          if (elapsed - notifiedAt >= .1) { notifiedAt = elapsed; emit(); }
          frame = requestAnimationFrame(tick);
        }
        notifiedAt = -1; frame = requestAnimationFrame(tick);
      } catch (failure) {
        if (disposed || ticket !== generation) return;
        stop(); phase = 'error'; error = failure.message; emit();
      }
    }
    function hidden() { if (document.hidden) stop(); }
    document.addEventListener('visibilitychange', hidden);
    emit();
    return {
      getState: state, play, stop,
      loadFile(file) {
        if (disposed || !file) return;
        return load(() => {
          if (file.size > window.AvatarLabSignal.MAX_BYTES) throw Error('Файл больше 12 МиБ');
          return file.arrayBuffer();
        }, file.name);
      },
      loadDemo() {
        return load(async signal => {
          const response = await fetch('/demo.wav', { signal });
          if (!response.ok) throw Error('Пример не найден');
          return response.arrayBuffer();
        }, 'Локальная синтезированная фраза');
      },
      dispose() {
        if (disposed) return; disposed = true; stop(); clip = signal = null;
        document.removeEventListener('visibilitychange', hidden);
        const closing = context; context = null; closing?.close().catch(() => {});
      }
    };
  }
};
