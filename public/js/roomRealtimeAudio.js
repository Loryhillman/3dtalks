/** Audio-only LiveKit session. Room admission and media capture have separate lifetimes. */
(() => {
  if (!window.MeetingUI?.active) return;
  const LK = window.LivekitClient;
  const t = key => window.i18n?.t('realtimeAudio.' + key) || key;
  class RoomRealtimeAudio {
    constructor() {
      this.isRealtime = true;
      this.phase = 'connecting'; this.recording = false; this.wantRecording = false;
      this.muted = false;
      try { this.muted = localStorage.getItem('voiceChatMuted') === '1'; } catch (_) {}
      this.generation = 0; this.captureGeneration = 0; this.attempts = 0;
      this.remote = new Map(); this.pendingStream = null; this.mic = null;
      this.onDeviceChange = async () => {
        const track = this.mic?.mediaStreamTrack, ticket = this.captureGeneration;
        if (!track) return; // Permission can itself reveal device labels and emit devicechange.
        try {
          const devices = await navigator.mediaDevices.enumerateDevices(), id = track.getSettings().deviceId;
          if (ticket === this.captureGeneration && (track.readyState === 'ended' || id && !devices.some(d => d.kind === 'audioinput' && d.deviceId === id))) {
            this.stopTalk(); this.error = 'deviceGone'; this.render();
          }
        } catch (_) {} // Track.onended still detects device loss without enumeration permission.
      };
      navigator.mediaDevices?.addEventListener('devicechange', this.onDeviceChange);
      document.addEventListener('DOMContentLoaded', () => this.render(), { once: true });
      window.i18n?.onLocaleChange(() => this.render());
    }
    render() {
      if (this.disposed) return;
      const button = document.getElementById('skill-voice-btn');
      button?.classList.toggle('listening', this.recording);
      button?.classList.toggle('voice-muted', this.muted);
      button?.classList.toggle('voice-disabled', ['connecting', 'recovering'].includes(this.phase));
      if (button) {
        const label = button.querySelector('.sv-label');
        if (label) { label.removeAttribute('data-i18n'); label.textContent = t(this.error ? 'failed' : this.phase); }
        const speakers = button.querySelector('.sv-muted');
        if (speakers) { speakers.hidden = !this.muted; speakers.textContent = window.i18n?.t('meetingUi.playbackMuted') || ''; }
        button.title = t(this.recording || this.wantRecording ? 'turnOff' : 'turnOn');
        button.setAttribute('aria-pressed', String(this.recording));
        button.setAttribute('aria-label', t(this.error || this.phase) + '. ' + (this.muted ? speakers?.textContent + '. ' : '') + button.title);
        button.setAttribute('aria-disabled', 'false'); // An error always remains explicitly retryable.
      }
      if (!this.notice && document.getElementById('meeting-menu')) {
        this.notice = document.createElement('div'); this.notice.className = 'meeting-audio-notice';
        this.status = document.createElement('p'); this.status.setAttribute('role', 'status');
        this.retry = document.createElement('button'); this.retry.type = 'button'; this.retry.className = 'ui-button';
        this.retry.onclick = () => this.playbackBlocked ? void this.resumeAudio() : this.room && this.phase === 'muted' ? void this.startTalk() : this.connect();
        this.notice.append(this.status, this.retry); document.getElementById('meeting-menu').append(this.notice);
      }
      if (this.notice) {
        this.notice.hidden = !this.error && !this.playbackBlocked;
        this.status.textContent = t(this.playbackBlocked ? 'autoplay' : this.error || this.phase);
        this.retry.textContent = t(this.playbackBlocked ? 'enableAudio' : this.room && this.phase === 'muted' ? 'retryMicrophone' : 'retry');
      }
      window.MeetingAudioSettings?.refresh();
    }
    configure(config) {
      if (this.disposed) return;
      if (config?.mode !== 'realtime') { this.cancelRoomAudio(); this.fail('unavailable'); return; }
      this.admitted = true;
      this.connect();
    }
    connect() {
      if (this.disposed || !this.admitted || !window.WSClient?.isConnected()) return;
      this.cancelSession();
      this.error = null; this.phase = 'connecting'; this.render();
      const requestId = crypto.randomUUID(); this.requestId = requestId;
      this.connectTimer = setTimeout(() => { if (this.requestId === requestId) this.failedConnection(); }, 15000);
      // Never enqueue a stale media grant through the ordinary WS reconnect queue.
      window.WSClient.ws.send(JSON.stringify({ type: 'ROOM_AUDIO_CONNECT', payload: { requestId } }));
    }
    async session(payload) {
      if (this.disposed || !this.admitted || payload?.requestId !== this.requestId) return;
      this.requestId = null; clearTimeout(this.connectTimer);
      if (payload.error || !LK) { this.failedConnection(); return; }
      const ticket = this.generation;
      const room = new LK.Room({ disconnectOnPageLeave: false, singlePeerConnection: false,
        reconnectPolicy: { nextRetryDelayInMs: () => null },
        publishDefaults: { audioPreset: LK.AudioPresets.speech, dtx: true, red: true } });
      this.room = room;
      const current = () => !this.disposed && ticket === this.generation && this.room === room;
      room.on(LK.RoomEvent.TrackSubscribed, (track, publication, participant) => {
        if (current() && track.kind === LK.Track.Kind.Audio) this.attach(track, participant);
      });
      room.on(LK.RoomEvent.TrackUnsubscribed, track => { if (current()) this.detach(track); });
      room.on(LK.RoomEvent.TrackMuted, (publication, participant) => {
        if (!current()) return;
        if (participant === room.localParticipant && publication.track === this.mic) this.stopTalk();
        else this.activity(participant, false);
      });
      room.on(LK.RoomEvent.ParticipantDisconnected, participant => {
        if (!current()) return;
        for (const [track, entry] of this.remote) if (entry.participant === participant) this.detach(track);
      });
      room.on(LK.RoomEvent.AudioPlaybackStatusChanged, () => {
        if (current()) {
          for (const entry of this.remote.values()) entry.element.muted = this.muted;
          this.playbackBlocked = !room.canPlaybackAudio && !this.muted; this.render();
        }
      });
      room.on(LK.RoomEvent.Disconnected, () => { if (current()) this.failedConnection(); });
      room.on(LK.RoomEvent.Reconnecting, () => { if (current()) this.failedConnection(); });
      try {
        await room.connect(payload.url, payload.token, { autoSubscribe: true, maxRetries: 0 });
        if (!current()) { await room.disconnect(); return; }
        this.phase = 'muted'; this.attempts = 0; this.render();
        for (const p of room.remoteParticipants.values()) for (const pub of p.audioTrackPublications.values()) if (pub.track) this.attach(pub.track, p);
      } catch (_) { if (current()) this.failedConnection(); }
    }
    fail(code) { this.error = code; this.phase = 'failed'; this.render(); }
    failedConnection() {
      this.cancelSession();
      this.fail('unavailable');
      if (!this.disposed && this.admitted && this.attempts < 3) {
        const delay = 1000 * 2 ** this.attempts++;
        this.retryTimer = setTimeout(() => this.connect(), delay);
      }
    }
    async resumeAudio() {
      try { if (!this.context) this.context = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) {}
      try {
        // Invoke both while the user gesture is still active (including Safari).
        await Promise.all([this.room?.startAudio(), this.context?.resume()]);
        this.playbackBlocked = !!this.room && !this.room.canPlaybackAudio;
      } catch (_) { this.playbackBlocked = true; }
      // LiveKit.startAudio unmutes attached elements as part of autoplay recovery.
      for (const entry of this.remote.values()) entry.element.muted = this.muted;
      this.render();
    }
    async startTalk() {
      if (this.disposed || this.wantRecording || this.recording) return;
      if (this.phase === 'failed') { this.attempts = 0; this.connect(); return; }
      if (!this.room || this.phase !== 'muted') return;
      if (!isSecureContext || !navigator.mediaDevices?.getUserMedia) { this.fail('unsupported'); return; }
      window.MeetingAudioSettings?.stopTest();
      this.wantRecording = true; this.phase = 'requesting'; this.error = null;
      const ticket = ++this.captureGeneration, room = this.room;
      const current = () => !this.disposed && ticket === this.captureGeneration && this.room === room && this.wantRecording;
      this.captureTimer = setTimeout(() => { if (current()) { this.stopTalk(); this.error = 'permissionTimeout'; this.render(); } }, 15000);
      this.render(); void this.resumeAudio();
      let stream, track;
      try {
        const constraints = window.MeetingAudioSettings?.constraints() || { audio: true };
        if (typeof constraints.audio === 'object') constraints.audio.autoGainControl = true;
        stream = await navigator.mediaDevices.getUserMedia(constraints);
        if (!current()) { stream.getTracks().forEach(t => t.stop()); return; }
        clearTimeout(this.captureTimer); this.pendingStream = stream;
        track = new LK.LocalAudioTrack(stream.getAudioTracks()[0], constraints.audio, true);
        this.mic = track;
        stream.getAudioTracks()[0].onended = () => { if (current()) { this.stopTalk(); this.error = 'deviceGone'; this.render(); } };
        await room.localParticipant.publishTrack(track, { source: LK.Track.Source.Microphone });
        if (!current()) { track.stop(); await room.localParticipant.unpublishTrack(track).catch(() => {}); return; }
        this.recording = true; this.phase = 'publishing'; this.render();
        this.monitor(track, window.GAME_STATE?.characterId, true);
      } catch (e) {
        if (stream) stream.getTracks().forEach(t => t.stop());
        if (!current()) return;
        this.stopTalk();
        this.error = ({ NotAllowedError: 'permissionDenied', SecurityError: 'permissionDenied',
          NotFoundError: 'noDevice', NotReadableError: 'deviceBusy', OverconstrainedError: 'deviceGone' })[e.name] || 'publishFailed';
        this.render();
      }
    }
    stopTalk() {
      ++this.captureGeneration; clearTimeout(this.captureTimer);
      this.wantRecording = this.recording = false;
      const track = this.mic; this.mic = null;
      if (track) {
        this.unmonitor(track); track.stop();
        void this.room?.localParticipant.unpublishTrack(track).catch(() => {});
      }
      if (this.pendingStream) { this.pendingStream.getTracks().forEach(t => { t.onended = null; t.stop(); }); this.pendingStream = null; }
      if (['requesting', 'publishing'].includes(this.phase)) this.phase = 'muted';
      this.render();
    }
    activity(participant, on) {
      const id = this.character(participant);
      if (id) window.MeetingRoster?.liveAudio?.(id, { microphone: !participant.isMicrophoneEnabled ? false : true, speaking: on });
    }
    character(participant) {
      try { const id = JSON.parse(participant.metadata).characterId; return typeof id === 'string' && id.length <= 128 ? id : null; }
      catch (_) { return null; }
    }
    attach(track, participant) {
      if (this.remote.has(track) || this.remote.size >= 6) return;
      const element = track.attach(); element.hidden = true; element.muted = this.muted;
      element.dataset.roomAudio = ''; document.body.append(element);
      this.remote.set(track, { element, participant });
      this.monitor(track, this.character(participant), false);
      element.play().catch(() => { if (this.remote.has(track) && !this.muted) { this.playbackBlocked = true; this.render(); } });
    }
    detach(track) {
      const entry = this.remote.get(track); if (!entry) return;
      this.remote.delete(track); this.unmonitor(track); this.activity(entry.participant, false);
      track.detach(entry.element); entry.element.pause(); entry.element.srcObject = null; entry.element.remove();
    }
    monitor(track, id, local) {
      if (!id) return;
      try {
        if (!this.context) this.context = new (window.AudioContext || window.webkitAudioContext)();
        window.MeetingMouthAnimation?.stream(track, id, this.context, new MediaStream([track.mediaStreamTrack]),
          () => !track.isMuted && (local ? this.recording : !this.muted && !this.playbackBlocked));
      } catch (_) {} // Optional visual analysis must not interrupt playback.
      if (!this.activityTimer) this.activityTimer = setInterval(() => {
        const room = this.room; if (!room) return;
        for (const p of [room.localParticipant, ...room.remoteParticipants.values()]) {
          const id = p === room.localParticipant ? window.GAME_STATE?.characterId : this.character(p);
          if (id) window.MeetingRoster?.liveAudio?.(id, { microphone: p.isMicrophoneEnabled,
            speaking: p.isSpeaking && (p === room.localParticipant ? this.recording : !this.muted && !this.playbackBlocked) });
        }
      }, 200);
    }
    unmonitor(track) { window.MeetingMouthAnimation?.end(track); }
    toggleMute() {
      this.muted = !this.muted;
      if (this.muted) this.playbackBlocked = false;
      try { localStorage.setItem('voiceChatMuted', this.muted ? '1' : '0'); } catch (_) {}
      for (const entry of this.remote.values()) entry.element.muted = this.muted;
      if (!this.muted) void this.resumeAudio();
      this.render(); return this.muted;
    }
    resetMicrophoneError() { this.error = null; this.render(); }
    cancelSession() {
      ++this.generation; this.requestId = null;
      clearTimeout(this.connectTimer); clearTimeout(this.retryTimer); clearInterval(this.activityTimer); this.activityTimer = null;
      this.stopTalk();
      for (const track of [...this.remote.keys()]) this.detach(track);
      const room = this.room; this.room = null;
      if (room) { room.removeAllListeners(); void room.disconnect().catch(() => {}); }
      if (this.context) { void this.context.close().catch(() => {}); this.context = null; }
      window.MeetingRoster?.clearLiveAudio?.(); this.playbackBlocked = false;
    }
    cancelRoomAudio() { this.admitted = false; this.cancelSession(); this.phase = 'connecting'; this.error = null; this.render(); }
    handleServerMessage() {} // Clip messages never run in a realtime session.
    dispose() {
      if (this.disposed) return;
      this.cancelRoomAudio(); this.disposed = true; this.phase = 'stopped';
      navigator.mediaDevices?.removeEventListener('devicechange', this.onDeviceChange);
      this.notice?.remove();
    }
  }
  window.voiceChat = new RoomRealtimeAudio();
})();
