// One local clip, one bounded microphone capture, one source and one animation loop.
window.AvatarLabAudio = {
  create({ onState, onMouth }) {
    let clip, signal, context, source, gain, frame, disposed = false, generation = 0, loading;
    let capture = null, permissionTimer;
    let phase = 'empty', name = '', error = '', amount = 0, elapsed = 0, startedAt = 0, notifiedAt = 0;
    const state = () => ({ phase, name, error, amount, elapsed, duration: clip?.duration || 0 });
    const emit = () => onState(state());
    function closeMouth() { amount = 0; onMouth(0); }
    function releaseCapture() {
      clearTimeout(permissionTimer); permissionTimer = null;
      const old = capture; capture = null;
      if (!old) return;
      clearTimeout(old.deadline); clearInterval(old.timer);
      if (old.recorder) {
        old.recorder.ondataavailable = old.recorder.onstop = old.recorder.onerror = null;
        if (old.recorder.state !== 'inactive') { try { old.recorder.stop(); } catch (_) {} }
      }
      for (const track of old.stream.getTracks()) { track.onended = null; track.stop(); }
      old.chunks.length = 0;
    }
    function stop() {
      ++generation; loading?.abort(); loading = null;
      releaseCapture();
      cancelAnimationFrame(frame); frame = null;
      const old = source; source = null;
      if (old) { old.onended = null; try { old.stop(); } catch (_) {} old.disconnect(); }
      gain?.disconnect(); gain = null;
      elapsed = 0; error = ''; phase = disposed ? 'disposed' : clip ? 'ready' : 'empty';
      closeMouth(); emit();
    }
    function recordingError(failure, ticket) {
      if (disposed || ticket !== generation) return;
      stop(); phase = 'error';
      error = failure.name === 'NotAllowedError' ? 'Доступ к микрофону запрещён. Разрешите его в браузере и повторите запись.' :
        failure.name === 'NotFoundError' ? 'Микрофон не найден.' : failure.message;
      emit();
    }
    async function record() {
      if (disposed || ['requesting', 'recording', 'preparing'].includes(phase)) return;
      stop(); clip = signal = null; name = 'Моя запись с микрофона'; phase = 'requesting'; emit();
      const ticket = generation;
      if (!isSecureContext || !navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
        recordingError(Error('Запись недоступна: откройте localhost или HTTPS в браузере с поддержкой микрофона.'), ticket); return;
      }
      permissionTimer = setTimeout(() => recordingError(Error('Разрешение микрофона не получено за 15 секунд. Повторите запись.'), ticket), 15000);
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
        if (disposed || ticket !== generation || document.hidden) {
          stream.getTracks().forEach(track => track.stop());
          if (!disposed && ticket === generation) stop();
          return;
        }
        clearTimeout(permissionTimer); permissionTimer = null;
        const current = capture = { stream, ticket, chunks: [], bytes: 0, started: performance.now() };
        const mime = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'].find(type => MediaRecorder.isTypeSupported(type));
        const recorder = current.recorder = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: 64000 });
        recorder.ondataavailable = event => {
          if (ticket !== generation || disposed || capture !== current) return;
          if (current.bytes + event.data.size > window.AvatarLabSignal.MAX_BYTES) {
            recordingError(Error('Превышен размер записи. Попробуйте записать короче.'), ticket); return;
          }
          if (event.data.size) { current.chunks.push(event.data); current.bytes += event.data.size; }
        };
        recorder.onerror = () => recordingError(Error('Не удалось записать микрофон. Повторите попытку.'), ticket);
        recorder.onstop = () => completeRecording(current);
        for (const track of stream.getTracks()) track.onended = () => recordingError(Error('Микрофон отключён во время записи.'), ticket);
        recorder.start(250); phase = 'recording'; emit();
        current.timer = setInterval(() => { if (capture === current) { elapsed = (performance.now() - current.started) / 1000; emit(); } }, 100);
        current.deadline = setTimeout(finishRecording, 30000);
      } catch (failure) { recordingError(failure, ticket); }
    }
    function finishRecording() {
      if (!capture || phase !== 'recording') return;
      const current = capture; phase = 'preparing';
      clearTimeout(current.deadline); clearInterval(current.timer); emit();
      try {
        current.recorder.stop();
        for (const track of current.stream.getTracks()) { track.onended = null; track.stop(); }
      } catch (failure) { recordingError(failure, current.ticket); }
    }
    async function completeRecording(current) {
      const ticket = current.ticket;
      if (disposed || ticket !== generation || capture !== current) return;
      try {
        phase = 'preparing'; emit();
        const blob = new Blob(current.chunks, { type: current.recorder.mimeType });
        releaseCapture();
        if (!blob.size) throw Error('Запись получилась пустой. Попробуйте ещё раз.');
        const bytes = await blob.arrayBuffer();
        if (disposed || ticket !== generation) return;
        const Audio = window.AudioContext || window.webkitAudioContext;
        if (!Audio) throw Error('Web Audio недоступен');
        context ||= new Audio();
        const decoded = await context.decodeAudioData(bytes);
        if (disposed || ticket !== generation) return;
        if (!decoded.length || decoded.duration > 31 || decoded.numberOfChannels > 2 || decoded.sampleRate > 96000) throw Error('Параметры записи не поддерживаются.');
        clip = { duration: decoded.duration, sampleRate: decoded.sampleRate,
          channels: Array.from({ length: decoded.numberOfChannels }, (_, i) => decoded.getChannelData(i).slice()) };
        signal = window.AvatarLabSignal.envelope(clip); elapsed = 0; phase = 'ready'; emit();
      } catch (failure) { recordingError(failure, ticket); }
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
      getState: state, play, stop, record, finishRecording,
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
