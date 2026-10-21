// Only audible room playback drives remote mouths. No microphone, timers or network state.
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
    end(source) {
      const track = tracks.get(source); tracks.delete(source);
      if (track) reset(bindings.get(track.group));
    },
    update(world) {
      const amounts = new Map();
      const groups = new Set([...world.players.values()].map(entry => entry.group));
      for (const [source, track] of tracks) {
        if (world.players.get(track.id)?.group !== track.group) { tracks.delete(source); continue; }
        const amount = !document.hidden && track.context.state === 'running' ?
          window.AvatarAudioSignal.at(track.signal, track.context.currentTime - track.startedAt) : 0;
        amounts.set(track.group, Math.max(amounts.get(track.group) || 0, amount));
      }
      for (const [group, binding] of bindings) {
        if (!groups.has(group)) { reset(binding); bindings.delete(group); }
      }
      for (const { group } of world.players.values()) {
        const binding = bind(group), amount = amounts.get(group) || 0;
        for (const target of binding.targets) target.mesh.morphTargetInfluences[target.index] = amount;
      }
    },
    remove(group) {
      for (const [source, track] of tracks) if (track.group === group) tracks.delete(source);
      reset(bindings.get(group)); bindings.delete(group);
    },
    clear() { tracks.clear(); for (const binding of bindings.values()) reset(binding); bindings.clear(); }
  };
})();
