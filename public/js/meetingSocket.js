/** Meeting protocol: seats, account avatars, room chat and room audio admission. */
(() => {
  if (location.pathname !== '/play') return;
  const seatMessages = new Set(['ROOM_SEAT_ASSIGNED', 'ROOM_SEATS_STATE', 'ROOM_SEAT_CHANGED',
    'ROOM_SEAT_RESULT', 'ROOM_LEFT', 'ROOM_SEAT_EXPIRED', 'ROOM_LOOK']);
  const voiceMessages = new Set(['VOICE_GRANTED', 'VOICE_DENIED', 'VOICE_PROBE_RESULT', 'VOICE_MESSAGE', 'VOICE_STATE']);
  const record = value => value && typeof value === 'object' && !Array.isArray(value);
  const identity = value => typeof value === 'string' && value.length > 0;
  const position = value => record(value) && ['x','y','z'].every(axis => Number.isFinite(value[axis]));
  const ownId = () => window.GAME_STATE?.characterId;
  const world = () => window.gameWorld;
  const text = (key, params) => params ? window.i18n?.tp('websocketUi.' + key, params) : window.i18n?.t('websocketUi.' + key);
  function participant(data) {
    if (!record(data) || !identity(data.characterId) || typeof data.characterName !== 'string' || !position(data.position)) return false;
    const scene = world();
    if (!scene) return false;
    const existing = scene.players.get(data.characterId);
    // Legacy GLB/weapon/animation fields are deliberately not passed to World.
    if (!existing) {
      if (data.characterId === ownId()) return false;
      scene.addPlayer(data.characterId, data.characterName, data.position, true, null, null, null, null, null, record(data.avatarConfig) ? data.avatarConfig : null);
    } else {
      if (existing.name !== data.characterName) scene.updatePlayerName(data.characterId, data.characterName);
      if (data.characterId !== ownId()) existing.group.position.set(data.position.x, data.position.y, data.position.z);
      if (record(data.avatarConfig)) window.UserAvatarRenderer?.apply(existing.group, data.avatarConfig);
    }
    return true;
  }
  class MeetingSocket extends window.SocketClient {
    static messageQueue = [];
    static handleMessage(data) {
      if (!record(data) || typeof data.type !== 'string') return;
      const { type, payload } = data;
      if (type === 'ROOM_AUDIO_CONFIG') { window.voiceChat?.configure?.(payload); return; }
      if (type === 'ROOM_AUDIO_SESSION') { window.voiceChat?.session?.(payload); return; }
      if(['ROOM_PRESENTATION_SESSION','ROOM_PRESENTATION_STATE','ROOM_PRESENTATION_RESULT','ROOM_PRESENTATION_AVAILABLE','ROOM_PRESENTATION_CAPABILITIES_RESULT','ROOM_PRESENTATION_CLOCK_RESULT'].includes(type)){
        if(record(payload))window.RoomPresentation?.message(type,payload);return;
      }
      if (seatMessages.has(type)) {
        if (record(payload)) window.RoomSeating?.message(type, payload);
      } else if (voiceMessages.has(type)) {
        if (record(payload)) {
          if(type==='VOICE_STATE')window.MeetingRoster?.recording(payload.characterId,payload.speaking);
          window.voiceChat?.handleServerMessage(type, payload);
        }
      } else switch (type) {
        case 'WORLD_STATE':
          if (record(payload) && Array.isArray(payload.players)) {
            this.handleWorldState(payload);
            window.RoomSeating?.message(type, payload);
            window.RoomPresentation?.joined();
          }
          break;
        case 'PLAYER_JOINED':
          if (participant(payload)) {
            window.MeetingRoster?.joined(payload);
            if (payload.characterId !== ownId()) UI.addChatMessage(text('system'), window.i18n?.tp('meetingUi.participantJoined', { name: payload.characterName }));
            window.RoomSeating?.message(type, payload);
          }
          break;
        case 'PLAYER_LEFT':
          this.handlePlayerLeft(payload);
          break;
        case 'CHAT':
          this.handleChat(payload);
          break;
        case 'ROOM_SESSION_REPLACED':
          window.RoomPresentation?.stop();
          this.sessionReplaced = true;
          this.messageQueue.length = 0;
          window.RoomSeating?.blocked('replaced');
          this.ws?.close();
          break;
        case 'ROOM_JOIN_DENIED':
          window.RoomPresentation?.stop();
          this.roomEnded = true;
          this.messageQueue.length = 0;
          window.RoomSeating?.blocked(payload?.code === 'ROOM_FULL' ? 'full' : 'denied');
          this.ws?.close();
          break;
        case 'ROOM_ENDED':
          window.RoomPresentation?.stop();
          window.MeetingRoomPanel?.close(false);window.voiceChat?.cancelRoomAudio?.();window.MeetingRoster?.stop();
          this.roomEnded = true;
          this.messageQueue.length = 0;
          this.ws?.close();
          location.replace('/rooms');
          break;
        // Gameplay, federation and legacy model updates are not meeting messages.
      }
    }
    static handleWorldState(payload) {
      if (!record(payload) || !Array.isArray(payload.players)) return;
      for (const data of payload.players) participant(data);
      window.MeetingRoster?.snapshot(payload.players.filter(p=>record(p)&&identity(p.characterId)&&typeof p.characterName==='string'&&position(p.position)));
    }
    static handlePlayerLeft(payload) {
      if (!record(payload) || !identity(payload.characterId) || payload.characterId === ownId()) return;
      window.MeetingRoster?.left(payload.characterId);
      if(!world()?.players.has(payload.characterId))return;
      world().removePlayer(payload.characterId);
      window.nearbyBubbles?.removeFor(payload.characterId);
      UI.addChatMessage(text('system'), window.i18n?.tp('meetingUi.participantLeft', { name: payload.characterName || payload.characterId }));
    }
    static handleChat(payload) {
      if (!record(payload) || typeof payload.sender !== 'string' || typeof payload.message !== 'string') return;
      UI.addChatMessage(payload.sender, payload.message);
      if (identity(payload.characterId) && world()?.players.has(payload.characterId)) {
        window.nearbyBubbles?.show(payload.characterId, payload.sender, payload.message);
      }
    }
  }
  window.WSClient = MeetingSocket;
})();
