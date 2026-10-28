const { AccessToken, RoomServiceClient, TrackSource } = require('livekit-server-sdk');
const jwt = require('jsonwebtoken');

// Product admission is deliberately independent of LiveKit's long-lived sessions.
function createRoomAudio({ identity, config = process.env, client, warn = () => {} }) {
  const enabled = config.ROOM_REALTIME_AUDIO_ENABLED === 'true';
  const grants = new Map();
  let pending = false, timer;
  const key = config.LIVEKIT_API_KEY, secret = config.LIVEKIT_API_SECRET;
  if (enabled && (!key || !secret || secret.length < 32 || !config.LIVEKIT_URL || !config.LIVEKIT_INTERNAL_URL)) {
    throw Error('Realtime audio requires configured LiveKit endpoints and strong credentials');
  }
  const api = enabled ? client || new RoomServiceClient(config.LIVEKIT_INTERNAL_URL, key, secret, { requestTimeout: 3 }) : null;
  const roomName = p => `3dtalks_${p.roomId}_${p.epoch}`;
  const current = grant => {
    const p = identity(grant.connectionId);
    return p && roomName(p) === grant.room && p.characterId === grant.characterId;
  };
  const remove = async (room, id) => {
    try { await api.removeParticipant(room, id); }
    catch (e) { if (e.code !== 'not_found') warn('remove_failed'); }
  };
  return {
    enabled,
    async grant(connectionId) {
      if (!enabled) throw Error('AUDIO_DISABLED');
      const p = identity(connectionId);
      if (!p) throw Error('AUDIO_ADMISSION_REQUIRED');
      const room = roomName(p), id = `ws_${connectionId}`;
      const grant = { connectionId, room, characterId: p.characterId };
      grants.set(id, grant);
      const token = new AccessToken(key, secret, { identity: id, ttl: 60,
        metadata: JSON.stringify({ characterId: p.characterId }) });
      token.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true,
        canPublishData: false, canUpdateOwnMetadata: false, canPublishSources: [TrackSource.MICROPHONE] });
      const value = await token.toJwt();
      if (!current(grant) || grants.get(id) !== grant) throw Error('AUDIO_ADMISSION_REQUIRED');
      return { url: config.LIVEKIT_URL, token: value, identity: id, characterId: p.characterId };
    },
    authorize(token) {
      if (!enabled || typeof token !== 'string' || token.length > 16384) return false;
      try {
        const claims = jwt.verify(token, secret, { algorithms: ['HS256'], issuer: key });
        const grant = grants.get(claims.sub);
        return !!(grant && claims.video?.roomJoin && claims.video.room === grant.room &&
          claims.metadata === JSON.stringify({ characterId: grant.characterId }) && current(grant));
      } catch (_) { return false; }
    },
    revoke(connectionId) {
      const id = `ws_${connectionId}`, grant = grants.get(id);
      grants.delete(id);
      if (grant) void remove(grant.room, id);
    },
    async reconcile() {
      if (!enabled || pending) return;
      pending = true;
      try {
        for (const [id, grant] of grants) if (!current(grant)) grants.delete(id);
        const rooms = (await api.listRooms()).filter(r => /^3dtalks_/.test(r.name));
        for (const room of rooms) {
          for (const participant of await api.listParticipants(room.name)) {
            const grant = grants.get(participant.identity);
            if (!grant || grant.room !== room.name || !current(grant)) await remove(room.name, participant.identity);
          }
        }
      } catch (_) { warn('reconcile_failed'); }
      finally { pending = false; }
    },
    start() { if (enabled && !timer) { timer = setInterval(() => void this.reconcile(), 5000); timer.unref?.(); void this.reconcile(); } },
    stop() { clearInterval(timer); timer = null; for (const grant of grants.values()) void remove(grant.room, `ws_${grant.connectionId}`); grants.clear(); }
  };
}
module.exports = { createRoomAudio };
