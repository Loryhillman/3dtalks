/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/** Dedicated authenticated meeting startup. Legacy login and RPG UI live in main.js. */
(() => {
  'use strict';
  if (location.pathname !== '/play') return;

  window.gameWorld = null;
  window.player = null;
  window.ACTIVE_ROOM = null;
  window.MOUSE = { isDragging: false, lastX: 0, lastY: 0, rotationX: 0, rotationY: 0,
    targetRotationX: 0, targetRotationY: 0, sensitivity: 0.005, smoothness: 0.1 };
  // Shared Player expects these flags. Meetings never bind movement keys.
  window.KEYS = { w: false, a: false, s: false, d: false, space: false, shift: false };
  window.GAME_STATE = { userId: null, characterId: null, characterData: null,
    isLoggedIn: false, cameraMode: 'third-person', isInVR: false };

  let stopped = false, starting, removeInput;
  const controller = new AbortController();
  const slug = new URLSearchParams(location.search).get('room') || '';
  const translate = key => window.i18n?.t(key) || key;
  function assertSession() {
    if (stopped || !localStorage.getItem('token') ||
        localStorage.getItem('userId') !== GAME_STATE.userId ||
        localStorage.getItem('characterId') !== GAME_STATE.characterId) {
      const error = new Error('Meeting session changed');
      error.name = 'AbortError';
      throw error;
    }
  }
  function stop() {
    if (stopped) return;
    stopped = true;
    controller.abort();
    removeInput?.();
    window.voiceChat?.dispose();
    if (typeof WSClient !== 'undefined') {
      WSClient.roomEnded = true;
      WSClient.messageQueue.length = 0;
      WSClient.ws?.close();
    }
    window.WSPresenceGuard?.stop();
    window.gameWorld?.clearRoomScene();
    window.gameWorld?.clearMeetingParticipants();
    window.gameWorld?.stopRendering();
  }
  function login() {
    stop();
    location.replace('/join/' + encodeURIComponent(slug));
  }
  function showError(error) {
    stop();
    console.error('[MeetingMain] Startup failed:', error);
    const panel = document.createElement('div');
    panel.id = 'meeting-startup-error';
    panel.setAttribute('role', 'alert');
    panel.style.cssText = 'position:fixed;inset:0;z-index:100000;background:#171e29;color:white;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px;padding:24px';
    const text = document.createElement('p'); text.textContent = error.message;
    const back = document.createElement('a'); back.href = '/rooms'; back.style.color = '#a7dfcf';
    back.textContent = translate('roomsLobby.back');
    panel.append(text, back); document.body.append(panel);
  }
  async function initialize() {
    if (!localStorage.getItem('token')) { login(); return; }
    GAME_STATE.userId = localStorage.getItem('userId');
    GAME_STATE.characterId = localStorage.getItem('characterId');
    if (!GAME_STATE.characterId || GAME_STATE.characterId === 'undefined') { login(); return; }
    let characterData;
    try {
      characterData = await API.getCharacter(GAME_STATE.characterId);
    } catch (error) {
      assertSession();
      if (error.status !== 404) throw error;
      for (const key of ['token', 'userId', 'characterId', 'userInfo']) localStorage.removeItem(key);
      login(); return;
    }
    assertSession();
    const response = await fetch('/api/rooms/' + encodeURIComponent(slug) +
      '?characterId=' + encodeURIComponent(GAME_STATE.characterId), {
      signal: controller.signal, headers: { Authorization: 'Bearer ' + localStorage.getItem('token') }
    });
    const data = await response.json().catch(() => ({}));
    assertSession();
    if (!response.ok || !data.success || !data.room) {
      if (response.status === 401) { login(); return; }
      throw new Error(translate(data.code === 'ROOM_NOT_FOUND' ? 'roomsLobby.ROOM_NOT_FOUND' : 'roomSeating.denied'));
    }
    const { accountAvatar } = await window.RoomAvatarSession.prepare();
    assertSession();
    window.ACTIVE_ROOM = data.room;
    GAME_STATE.characterData = characterData;
    GAME_STATE.isLoggedIn = true;
    window.RoomSeating?.enter(data.room);
    const canvas = document.getElementById('canvas');
    const world = new World(canvas);
    window.gameWorld = world;
    let position = world.getSpawnPosition();
    const saved = data.room.status === 'closed' ? data.room.resume_position : null;
    if (saved && ['x', 'y', 'z'].every(axis => typeof saved[axis] === 'number' &&
      Number.isFinite(saved[axis]) && Math.abs(saved[axis]) <= 10000)) position = saved;
    const participant = new window.MeetingPlayer(world, GAME_STATE.characterId, characterData);
    window.player = participant;
    participant.position.set(position.x, position.y, position.z);
    window.UserAvatarRenderer?.apply(participant.worldObject, accountAvatar);
    removeInput = window.MeetingInput.attach(canvas, MOUSE, GAME_STATE);
    await WSClient.connect(CONFIG.WS_URL);
    assertSession();
    WSClient.send({ type: 'PLAYER_JOIN', payload: {
      characterId: GAME_STATE.characterId, roomSlug: data.room.slug,
      token: localStorage.getItem('token'), position
    } });
    UI.hideLoadingScreen();
    UI.addChatMessage(translate('runtime.system'), window.i18n?.tp('mainUi.welcomePlayer', { name: characterData.character.name }));
  }
  function start() {
    if (!starting) starting = initialize().catch(error => {
      if (stopped) return;
      if (error.name === 'AbortError') { stop(); location.replace('/rooms'); return; }
      showError(error);
    });
    return starting;
  }
  window.MeetingMain = { start, stop };
  window.addEventListener('load', start);
  window.addEventListener('storage', event => {
    if (event.key === 'userId' || event.key === 'characterId' || event.key === null ||
        (event.key === 'token' && !event.newValue)) { stop(); location.replace('/rooms'); }
  });
  window.addEventListener('pagehide', event => { if (!event.persisted) stop(); });
})();
