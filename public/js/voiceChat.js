/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/**
 * 附近语音对讲（PTT 半双工，轻量级方案）
 * - 按住 🎤 说话，松开整段发送（微信式），服务端中继给 30m 内玩家
 * - 附近人数超过上限时服务端拒绝 → 语音键置灰，自动降级文字模式，恢复后自动点亮
 * - 接收端按距离衰减音量播放
 */
function voiceT(key, fallback) {
  const fullKey = 'voiceChat.' + key;
  const value = window.i18n?.t(fullKey);
  return value && value !== fullKey ? value : fallback;
}

function voiceTp(key, params, fallback) {
  const fullKey = 'voiceChat.' + key;
  const value = window.i18n?.tp(fullKey, params);
  return value && value !== fullKey ? value : fallback;
}

class VoiceChatManager {
  constructor() {
    this.muted = localStorage.getItem('voiceChatMuted') === '1';
    this.disabled = false;        // 服务端判定超限后置灰
    this.wantRecording = false;   // 按钮按下的期望状态
    this.recording = false;
    this.recorder = null;
    this.chunks = [];
    this.mimeType = 'audio/webm';
    this.stream = null;
    this.recordStartTime = 0;
    this.audioCtx = null;
    this.probeTimer = null;
    this.recordingTimer = null;
    this.playbackSources = new Set();
    this.disposed = false;
    this.lastSentAt = 0;
    this._styleInjected = false;

    this.MAX_DURATION_MS = 60000;
    this.MIN_DURATION_MS = 1000;  // <1s 视为误触丢弃
    this.MAX_AUDIO_BYTES = 1.5 * 1024 * 1024;
    this.SEND_DEBOUNCE_MS = 800;
    this.VOICE_RANGE = 30;
  }

  // ─── 录音（按下/松开由 skillHUD 🎤 按钮驱动） ───────────────────

  async startTalk() {
    if (this.disposed) return;
    if (this.disabled) {
      UI.addChatMessage(voiceT('system', '系统'), voiceT('crowdedUnavailable', '当前附近人数较多，语音不可用，请使用文字聊天'));
      return;
    }
    if (this.wantRecording || this.recording || this.recorder) return;
    if (typeof WSClient === 'undefined' || !WSClient.isConnected()) {
      UI.addChatMessage(voiceT('system', '系统'), voiceT('networkUnavailable', '网络未连接，语音不可用'));
      return;
    }
    if (Date.now() - this.lastSentAt < this.SEND_DEBOUNCE_MS) return;
    if (typeof MediaRecorder === 'undefined') {
      this._setDisabled(true);
      UI.addChatMessage(voiceT('system', '系统'), voiceT('recordingUnsupported', '当前浏览器不支持录音，请使用文字聊天'));
      return;
    }

    this.wantRecording = true;

    try {
      if (!this.stream || this.stream.getTracks().every(t => t.readyState === 'ended')) {
        this.stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true }
        });
      }
    } catch (error) {
      if (this.disposed) return;
      console.warn('[VoiceChat] 麦克风获取失败:', error.name);
      this.wantRecording = false;
      this._setDisabled(true);
      UI.addChatMessage(voiceT('system', '系统'), voiceT('micPermissionDenied', '麦克风权限被拒绝，请在浏览器设置中允许后刷新页面'));
      return;
    }

    // 等待权限期间用户已松开 → 不录音
    if (!this.wantRecording) {
      this._releaseStream();
      return;
    }

    this.mimeType = this._pickMimeType();
    try {
      this.recorder = new MediaRecorder(this.stream, { mimeType: this.mimeType });
    } catch (error) {
      this.recorder = new MediaRecorder(this.stream);
      this.mimeType = this.recorder.mimeType || 'audio/webm';
    }

    this.chunks = [];
    this.recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) this.chunks.push(e.data);
    };
    this.recorder.onstop = () => { this.recorder = null; this._onRecordStop(); };

    this.recorder.start(250);
    this.recording = true;
    this.recordStartTime = Date.now();

    WSClient.send({ type: 'VOICE_START', payload: {} });
    this._setRecordingUI(true);
    // 最长 60s 自动截断
    this.recordingTimer = setTimeout(() => {
      if (this.recording) this.stopTalk();
    }, this.MAX_DURATION_MS + 500);
  }

  stopTalk() {
    clearTimeout(this.recordingTimer); this.recordingTimer = null;
    if (!this.wantRecording && !this.recording) return;
    this.wantRecording = false;
    if (this.recording && this.recorder && this.recorder.state !== 'inactive') {
      try { this.recorder.stop(); } catch (error) { /* 忽略 */ }
    }
    this.recording = false;
    this._setRecordingUI(false);
    // 通知服务端停止"正在说话"指示（无论是否成功发送）
    WSClient.send({ type: 'VOICE_END', payload: {} });
  }

  _onRecordStop() {
    clearTimeout(this.recordingTimer); this.recordingTimer = null;
    const durationMs = Date.now() - this.recordStartTime;
    const chunks = this.chunks;
    this.chunks = [];
    this._releaseStream(); // 释放麦克风（隐私优先：不说话时麦克风灯熄灭）

    if (this.disposed) return;
    if (durationMs < this.MIN_DURATION_MS) {
      UI.addChatMessage(voiceT('system', '系统'), voiceT('tooShort', '说话时间太短，已取消'));
      return;
    }
    if (!chunks.length) return;

    const blob = new Blob(chunks, { type: this.mimeType });
    if (blob.size > this.MAX_AUDIO_BYTES) {
      UI.addChatMessage(voiceT('system', '系统'), voiceT('tooLong', '语音过长，发送失败'));
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (this.disposed || !WSClient.isConnected()) return;
      const dataUrl = reader.result || '';
      const base64 = dataUrl.split(',')[1] || '';
      if (!base64) return;
      WSClient.send({
        type: 'VOICE_MESSAGE',
        payload: { audio: base64, durationMs: Math.min(durationMs, this.MAX_DURATION_MS + 1000) }
      });
      this.lastSentAt = Date.now();
    };
    reader.readAsDataURL(blob);
  }

  _pickMimeType() {
    const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
    for (const t of candidates) {
      if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) return t;
    }
    return 'audio/webm';
  }

  _releaseStream() {
    if (this.stream) {
      this.stream.getTracks().forEach(t => { try { t.stop(); } catch (e) { /* 忽略 */ } });
      this.stream = null;
    }
  }

  // ─── 播放（接收端，按距离衰减） ────────────────────────────────

  async playVoiceMessage(payload) {
    if (this.disposed || this.muted) return;
    const { characterId, audio, durationMs } = payload;
    if (!audio || characterId === (window.GAME_STATE && GAME_STATE.characterId)) return;

    // 距离衰减：30m 外静音
    let volume = 0.6;
    try {
      const speaker = window.gameWorld && gameWorld.players.get(characterId);
      const self = window.player;
      if (speaker && speaker.group && self && self.position) {
        const d = speaker.group.position.distanceTo(self.position);
        if (d > this.VOICE_RANGE) return;
        volume = Math.max(0.05, Math.min(1, 1 - d / this.VOICE_RANGE));
      }
    } catch (error) { /* 位置不可用时用默认音量 */ }

    try {
      this.audioCtx = this.audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const audioCtx = this.audioCtx;
      if (audioCtx.state === 'suspended') await audioCtx.resume();
      if (this.disposed) return;

      const raw = atob(audio);
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      const buffer = await audioCtx.decodeAudioData(bytes.buffer);

      if (this.disposed) return;
      const source = audioCtx.createBufferSource();
      source.buffer = buffer;
      const gain = audioCtx.createGain();
      gain.gain.value = volume;
      source.connect(gain).connect(audioCtx.destination);
      this.playbackSources.add(source);
      source.onended = () => { this.playbackSources.delete(source); source.disconnect(); gain.disconnect(); };
      source.start();
    } catch (error) {
      console.warn('[VoiceChat] 播放失败:', error.message);
    }
  }

  // ─── 服务端消息入口（websocket.js 分发） ──────────────────────

  handleServerMessage(type, payload) {
    if (this.disposed) return;
    switch (type) {
      case 'VOICE_DENIED':
        this._setDisabled(true);
        UI.addChatMessage(voiceT('system', '系统'), voiceTp('textModeCrowded', { count: payload.nearbyCount || '?' }, `当前人数较多（${payload.nearbyCount || '?'}人），已切换为文字模式，稍后自动恢复`));
        this._startProbe();
        break;
      case 'VOICE_PROBE_RESULT':
        if (payload.allowed) {
          this._setDisabled(false);
          this._stopProbe();
          UI.addChatMessage(voiceT('system', '系统'), voiceT('availableAgain', '语音功能已恢复可用'));
        }
        break;
      case 'VOICE_MESSAGE':
        this.playVoiceMessage(payload);
        break;
      case 'VOICE_STATE':
        if (window.nearbyBubbles) {
          window.nearbyBubbles.setSpeaking(payload.characterId, !!payload.speaking);
        }
        break;
    }
  }

  _startProbe() {
    if (this.disposed) return;
    this._stopProbe();
    this.probeTimer = setInterval(() => {
      if (typeof WSClient !== 'undefined' && WSClient.isConnected()) {
        WSClient.send({ type: 'VOICE_PROBE', payload: {} });
      }
    }, 10000);
  }

  _stopProbe() {
    if (this.probeTimer) { clearInterval(this.probeTimer); this.probeTimer = null; }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.wantRecording = false;
    this.recording = false;
    clearTimeout(this.recordingTimer); this.recordingTimer = null;
    this._stopProbe();
    if (this.recorder) {
      this.recorder.onstop = null;
      this.recorder.ondataavailable = null;
      if (this.recorder.state !== 'inactive') { try { this.recorder.stop(); } catch (_) {} }
      this.recorder = null;
    }
    this.chunks = [];
    this._releaseStream();
    for (const source of this.playbackSources) { try { source.stop(); } catch (_) {} }
    this.playbackSources.clear();
    if (this.audioCtx) {
      this.audioCtx.close().catch(error => console.warn('[VoiceChat] Audio context close failed:', error.message));
      this.audioCtx = null;
    }
    this._setRecordingUI(false);
  }

  // ─── UI 状态 ──────────────────────────────────────────────────

  _injectStyle() {
    if (this._styleInjected) return;
    this._styleInjected = true;
    const style = document.createElement('style');
    style.textContent = `
      #skill-voice-btn.voice-disabled {
        opacity: 0.35 !important;
        filter: grayscale(1);
      }
      #skill-voice-btn.voice-muted::after {
        content: '🔇';
        position: absolute;
        top: -6px;
        right: -6px;
        font-size: 14px;
      }
    `;
    document.head.appendChild(style);
  }

  _getBtn() {
    this._injectStyle();
    return document.getElementById('skill-voice-btn');
  }

  _setDisabled(disabled) {
    this.disabled = disabled;
    const btn = this._getBtn();
    if (btn) btn.classList.toggle('voice-disabled', disabled);
  }

  _setRecordingUI(on) {
    const btn = this._getBtn();
    if (btn) btn.classList.toggle('listening', on);
    if (typeof UI !== 'undefined' && UI.showVoiceIndicator) UI.showVoiceIndicator(on);
  }

  toggleMute() {
    this.muted = !this.muted;
    localStorage.setItem('voiceChatMuted', this.muted ? '1' : '0');
    const btn = this._getBtn();
    if (btn) btn.classList.toggle('voice-muted', this.muted);
    UI.addChatMessage(voiceT('system', '系统'), this.muted ? voiceT('muted', '已静音附近语音') : voiceT('unmuted', '已开启附近语音'));
    return this.muted;
  }
}

// 全局单例
if (typeof window !== 'undefined') {
  window.VoiceChatManager = VoiceChatManager;
  window.voiceChat = new VoiceChatManager();
}
