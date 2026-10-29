// Audio energy drives room mouths; capture/playback lifetimes belong to audio sessions.
(() => {
  const tracks = new Map(), bindings = new Map();
  function reset(binding) {
    for (const target of binding?.targets || []) target.mesh.morphTargetInfluences[target.index] = 0;
  }
  function bind(group) {
    const root = group.userData.accountAvatarRoot;
    let binding = bindings.get(group);
    const version = group.userData.accountAvatarGeometryVersion;
    if (binding && binding.root === root && binding.version === version) return binding;
    reset(binding);
    const targets = [];
    root?.traverse(mesh => {
      if (!mesh.morphTargetInfluences || !mesh.morphTargetDictionary) return;
      // Choose one opening target per mesh; adding both would exaggerate the jaw.
      const index = mesh.morphTargetDictionary.viseme_aa ?? mesh.morphTargetDictionary.jawOpen;
      if (Number.isInteger(index) && index >= 0 && index < mesh.morphTargetInfluences.length) targets.push({ mesh, index });
    });
    binding = { root, version, targets }; bindings.set(group, binding); return binding;
  }
  window.MeetingMouthAnimation = {
    prepare(buffer) {
      try {
        return window.AvatarAudioSignal.envelope({ sampleRate: buffer.sampleRate, duration: buffer.duration,
          channels: Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i)) });
      } catch (_) { return null; } // Optional animation must never break voice playback.
    },
    start(id, source, context, startedAt, signal) {
      const world = window.gameWorld;
      if (!signal || !world?.isMeeting || !world.players.has(id) || tracks.size >= 16) return;
      tracks.set(source, { id, context, startedAt, signal, group: world.players.get(id).group });
    },
    stream(key, id, context, stream, enabled) {
      this.end(key);
      if (tracks.size >= 16) return;
      const source = context.createMediaStreamSource(stream), analyser = context.createAnalyser();
      analyser.fftSize = 1024; source.connect(analyser);
      tracks.set(key, { id, context, source, analyser, enabled, samples: new Float32Array(analyser.fftSize), value: 0, open: false, previous: context.currentTime });
    },
    end(source) {
      const track = tracks.get(source); tracks.delete(source);
      if (track) { track.source?.disconnect(); track.analyser?.disconnect(); reset(bindings.get(track.group)); }
    },
    update(world) {
      const amounts = new Map();
      const groups = new Set([...world.players.values()].map(entry => entry.group));
      for (const [source, track] of tracks) {
        const group = world.players.get(track.id)?.group;
        if (!group || (track.group && group !== track.group)) { this.end(source); continue; }
        track.group = group;
        let amount = 0;
        if (!document.hidden && track.context.state === 'running') {
          if (track.analyser && track.enabled()) {
            track.analyser.getFloatTimeDomainData(track.samples);
            let energy = 0; for (const sample of track.samples) energy += sample * sample;
            const rms = Math.sqrt(energy / track.samples.length);
            track.open = rms > (track.open ? .009 : .014);
            const target = track.open ? Math.min(.85, Math.max(0, (rms - .009) * 7)) : 0;
            const dt = Math.min(.1, Math.max(0, track.context.currentTime - track.previous));
            track.value += (target - track.value) * (1 - Math.exp(-dt / (target > track.value ? .025 : .06)));
            amount = track.value;
          } else if (!track.analyser) amount = window.AvatarAudioSignal.at(track.signal, track.context.currentTime - track.startedAt);
        }
        if (track.analyser) { track.previous = track.context.currentTime; if (!amount) track.value = 0; }
        amounts.set(track.group, Math.max(amounts.get(track.group) || 0, amount));
      }
      for (const [group, binding] of bindings) {
        if (!groups.has(group)) { reset(binding); bindings.delete(group); }
      }
      for (const { group } of world.players.values()) {
        const binding = bind(group), amount = window.AvatarAudioSignal.calibrate(amounts.get(group) || 0, group.userData.accountAvatarConfig?.mouthGain);
        for (const target of binding.targets) target.mesh.morphTargetInfluences[target.index] = amount;
      }
    },
    remove(group) {
      for (const [source, track] of tracks) if (track.group === group) this.end(source);
      reset(bindings.get(group)); bindings.delete(group);
    },
    clear() { for (const source of [...tracks.keys()]) this.end(source); for (const binding of bindings.values()) reset(binding); bindings.clear(); }
  };
})();
