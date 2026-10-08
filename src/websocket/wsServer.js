/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const { query } = require('../database/db');
const voiceRelay = require('./voiceRelay');
const jwt = require('jsonwebtoken');
const { MAIN_ROOM_ID } = require('../services/roomScope');
const { runRoomOperation } = require('../services/roomOperationQueue');

let wss = null;

// In-memory player positions for real-time updates
const playerPositions = new Map();
const activeConnections = new Map();

// 未登记连接（断线重连但没重发 PLAYER_JOIN 的"幽灵"）告警去重时间戳
const ghostWarnAt = new Map();
const supersededConnections = new Set();
const joinQueues = new Map();
const rejoinGrants = new Map();
const roomEpochs = new Map();
const seatIdentities = new Map();
const seatVersions = new Map();
let seatsUsed = false;
let seatService;
function getSeatService() {
  if (!seatService) seatService = require('../services/roomSeats')
    .createRoomSeatService(require('../database/db').pool);
  seatsUsed = true;
  return seatService;
}
function seatIdentity(connectionId, player) {
  return { roomId: player.roomId, characterId: player.characterId,
    sessionId: connectionId, userId: seatIdentities.get(connectionId) };
}
async function publishSeats(roomId) {
  try {
    const seats = await getSeatService().list(roomId);
    const version = (seatVersions.get(roomId) || 0) + 1;
    seatVersions.set(roomId, version);
    broadcastToRoom(roomId, { type: 'ROOM_SEATS_STATE', payload: { roomId, version, seats } });
  } catch (error) { console.warn('[WS] Seat snapshot:', error.message); }
}

async function handleSeatCommand(connectionId, ws, type, payload) {
  const player = playerPositions.get(connectionId);
  if (supersededConnections.has(connectionId) || ws.readyState !== WebSocket.OPEN || !player?.seat) return;
  const requestId = payload.requestId;
  if (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(requestId)) {
    ws.send(JSON.stringify({ type: 'ROOM_SEAT_RESULT', payload: { success: false, code: 'INVALID_REQUEST_ID' } }));
    return;
  }
  const requests = ws.seatRequests || (ws.seatRequests = new Map());
  const signature = JSON.stringify([type, payload.seatId]);
  const previous = requests.get(requestId);
  if (previous) {
    ws.send(JSON.stringify(previous.signature === signature ? previous.message : {
      type: 'ROOM_SEAT_RESULT', payload: { requestId, success: false, code: 'REQUEST_ID_CONFLICT' }
    }));
    return;
  }
  // Retain all results for this connection; bound the cache without allowing
  // an evicted old request to execute again.
  if (requests.size >= 256 && type !== 'ROOM_LEAVE') {
    ws.send(JSON.stringify({ type: 'ROOM_SEAT_RESULT', payload: { requestId, success: false, code: 'SEAT_REQUEST_LIMIT' } }));
    return;
  }
  let message;
  try {
    if (type === 'ROOM_LEAVE') {
      await getSeatService().release({ ...seatIdentity(connectionId, player), leave: true });
      voiceRelay.handleDisconnect(connectionId);
      playerPositions.delete(connectionId);
      seatIdentities.delete(connectionId);
      broadcastToRoom(player.roomId, { type: 'PLAYER_LEFT', payload: { characterId: player.characterId } });
      message = { type: 'ROOM_LEFT', payload: { requestId, roomId: player.roomId } };
    } else {
      const assignment = await getSeatService().move({ ...seatIdentity(connectionId, player), seatId: payload.seatId,
        isCurrent: () => ws.readyState === WebSocket.OPEN && playerPositions.get(connectionId) === player });
      player.seat = { id: assignment.seat.id, ...assignment.pose };
      player.position = assignment.pose.position;
      broadcastToRoom(player.roomId, { type: 'ROOM_SEAT_CHANGED', payload: {
        roomId: player.roomId, characterId: player.characterId, seat: player.seat
      } });
      message = { type: 'ROOM_SEAT_RESULT', payload: { requestId, success: true, seat: player.seat } };
    }
  } catch (error) {
    message = { type: 'ROOM_SEAT_RESULT', payload: { requestId, success: false, code: error.code || 'SEAT_ERROR' } };
  }
  requests.set(requestId, { signature, message });
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
    if (message.type === 'ROOM_LEFT') ws.close(4004, 'Left room');
  }
  await publishSeats(player.roomId);
}
const REJOIN_GRACE_MS = 5 * 60 * 1000;

function validRoomPosition(position) {
  return position && ['x', 'y', 'z'].every(axis =>
    typeof position[axis] === 'number' && Number.isFinite(position[axis]) &&
    Math.abs(position[axis]) <= 10000);
}

function roomGrantKey(roomId, characterId) {
  return `${roomId}:${characterId}`;
}

function hasRoomReturnAccess(roomId, characterId) {
  if (!roomId || !characterId) return false;
  for (const player of playerPositions.values()) {
    if (player.roomId === roomId && player.characterId === characterId) return true;
  }
  const key = roomGrantKey(roomId, characterId);
  const until = rejoinGrants.get(key) || 0;
  if (until > Date.now()) return true;
  rejoinGrants.delete(key);
  return false;
}

async function hasPersistentRoomReturnAccess(roomId, characterId) {
  if (!roomId || !characterId) return false;
  const { rows } = await query(`
    SELECT 1 FROM room_rejoin_grants g JOIN rooms r ON r.id = g.room_id
    WHERE g.room_id = $1 AND g.character_id = $2 AND g.expires_at > now()
      AND r.status = 'closed' AND r.allow_rejoin = true
  `, [roomId, characterId]);
  return rows.length > 0 || hasRoomReturnAccess(roomId, characterId);
}

function roomParticipants(roomId) {
  return [...new Set([...playerPositions.values()]
    .filter(player => player.roomId === roomId && player.characterId)
    .map(player => player.characterId))];
}

// Keep the return window open while a participant remains connected to a closed room.
// UPDATE cannot recreate a grant removed by "end meeting", even if that action races this tick.
async function refreshActiveRoomGrants() {
  if (process.env.ROOMS_ENABLED !== 'true') return;
  const byRoom = new Map();
  for (const [connectionId, player] of playerPositions) {
    if (!player?.roomId || player.roomId === MAIN_ROOM_ID || !player.characterId ||
        player.roomEpoch !== (roomEpochs.get(player.roomId) || 0) ||
        activeConnections.get(connectionId)?.readyState !== WebSocket.OPEN) continue;
    if (!byRoom.has(player.roomId)) byRoom.set(player.roomId, new Map());
    byRoom.get(player.roomId).set(player.characterId, player.position);
  }
  for (const [roomId, characters] of byRoom) {
    await query(`
      UPDATE room_rejoin_grants g
      SET expires_at = GREATEST(g.expires_at, now() + interval '5 minutes')
      WHERE g.room_id = $1 AND g.character_id = ANY($2::uuid[])
        AND EXISTS (SELECT 1 FROM rooms r WHERE r.id = g.room_id
          AND r.status = 'closed' AND r.allow_rejoin = true)
    `, [roomId, [...characters.keys()]]);
    const positions = [...characters].filter(([, position]) => validRoomPosition(position))
      .map(([id, position]) => ({ id, position }));
    if (positions.length) await query(`
      UPDATE characters c SET last_position = p.position
      FROM jsonb_to_recordset($2::jsonb) AS p(id uuid, position jsonb)
      WHERE c.id = p.id AND c.last_room_id = $1
        AND EXISTS (SELECT 1 FROM rooms r WHERE r.id = $1
          AND r.status = 'closed' AND r.allow_rejoin = true)
    `, [roomId, JSON.stringify(positions)]);
  }
}

/**
 * 连接已建立但服务器没有它的玩家登记（playerPositions）时的提示。
 * 这类连接发来的位置/模型更新会被静默忽略，对方就"永远看不到它移动"，
 * 排查时极难发现，因此每 30s 打一次日志（前端 wsPresenceGuard 会自动重发
 * PLAYER_JOIN 根治该状态，这里只做可观测性兜底）。
 */
function warnUnregistered(connectionId, type) {
  const now = Date.now();
  const last = ghostWarnAt.get(connectionId) || 0;
  if (now - last < 30000) return;
  ghostWarnAt.set(connectionId, now);
  console.warn(`[WS] Ignored ${type} from an unregistered connection (PLAYER_JOIN not received): ${connectionId}`);
}

/**
 * 设置 WebSocket 服务器，附加到现有的 HTTP server 上（共享端口）
 * @param {import('http').Server} httpServer - Express HTTP server 实例
 */
function setupWebSocketServer(httpServer) {
  try {
    // noServer 模式：upgrade 由 upgradeRouter 分发（/ws/agent→agent，其余→人类兜底）
    wss = new WebSocket.Server({ noServer: true });

    wss.on('connection', (ws) => {
      const connectionId = uuidv4();
      activeConnections.set(connectionId, ws);

      // 【内存治理】心跳探活标记（配合 setupWebSocketServer 末尾的全局 ping 定时器）
      ws.isAlive = true;
      ws.on('pong', () => { ws.isAlive = true; });

      console.log(`Client connected: ${connectionId}`);

      ws.on('message', (message) => {
        try {
          const data = JSON.parse(message);
          handleMessage(connectionId, ws, data);
        } catch (error) {
          console.error('WebSocket message error:', error);
        }
      });

      ws.on('close', async () => {
        // 保存用户最后位置（下线时停留在当前位置）
        const playerData = playerPositions.get(connectionId);
        if (playerData?.seat) {
          await runRoomOperation(async () => {
            await getSeatService().hold(seatIdentity(connectionId, playerData));
            await publishSeats(playerData.roomId);
          }).catch(error => console.warn('[WS] Seat disconnect:', error.message));
        }
        if (playerData && !supersededConnections.has(connectionId) &&
            playerData.characterId && playerData.position) {
          try {
            await query(
              `UPDATE characters 
               SET last_position = $1, 
                   last_online = CURRENT_TIMESTAMP 
               WHERE id = $2`,
              [JSON.stringify(playerData.position), playerData.characterId]
            );
            console.log(`💾 Saving last position for ${playerData.characterName}:`, playerData.position);
          } catch (error) {
            console.error('Failed to save player position:', error);
          }
        }
        if (!supersededConnections.has(connectionId) &&
            process.env.ROOMS_ENABLED === 'true' && playerData?.roomId &&
            playerData.roomId !== MAIN_ROOM_ID) {
          try {
            const room = await query('SELECT status, allow_rejoin FROM rooms WHERE id = $1', [playerData.roomId]);
            if (room.rows[0]?.status === 'closed' && room.rows[0]?.allow_rejoin &&
                playerData.roomEpoch === (roomEpochs.get(playerData.roomId) || 0)) {
              rejoinGrants.set(roomGrantKey(playerData.roomId, playerData.characterId),
                Date.now() + REJOIN_GRACE_MS);
              await query(`
                UPDATE room_rejoin_grants g
                SET expires_at = GREATEST(g.expires_at, now() + interval '5 minutes')
                WHERE g.room_id = $1 AND g.character_id = $2
                  AND EXISTS (SELECT 1 FROM rooms r WHERE r.id = g.room_id
                    AND r.status = 'closed' AND r.allow_rejoin = true)
              `, [playerData.roomId, playerData.characterId]);
            }
          } catch (error) { console.warn('[WS] Could not record room rejoin:', error.message); }
        }
        
        activeConnections.delete(connectionId);
        seatIdentities.delete(connectionId);
        playerPositions.delete(connectionId);
        ghostWarnAt.delete(connectionId);
        voiceRelay.handleDisconnect(connectionId);
        
        // 广播玩家离线
        if (playerData && !supersededConnections.has(connectionId)) {
          broadcastToRoom(playerData.roomId || MAIN_ROOM_ID, {
            type: 'PLAYER_LEFT',
            payload: {
              characterId: playerData.characterId,
              characterName: playerData.characterName,
              lastPosition: playerData.position,
            },
          });
        }
        supersededConnections.delete(connectionId);
        
        console.log(`Client disconnected: ${connectionId}`);
      });

      ws.on('error', (error) => {
        console.error('WebSocket error:', error);
      });
    });

    wss.on('error', (error) => {
      console.error('WebSocket server error:', error);
    });

    // 注入语音中继模块所需的内部引用（避免循环 require）
    voiceRelay.init({
      activeConnections,
      playerPositions,
      calculateDistance,
      broadcastToNearby,
    });
    voiceRelay.ensureDefaultConfig();

    // 【内存治理】心跳：每 30s ping 一次，两周期无 pong 判死并 terminate。
    // 移动网络半开连接/杀进程等场景不会触发 'close'，playerPositions 中的
    // 僵尸玩家会永久驻留并持续进入新玩家的 WORLD_STATE。terminate 会触发
    // 'close'，接上既有的保存位置/清理/PLAYER_LEFT 广播逻辑。
    const hbTimer = setInterval(() => {
      wss.clients.forEach((client) => {
        if (client.isAlive === false) { client.terminate(); return; }
        client.isAlive = false;
        try { client.ping(); } catch (e) {}
      });
    }, 30000);
    if (hbTimer.unref) hbTimer.unref();
    const grantTimer = setInterval(() => {
      refreshActiveRoomGrants().catch(error =>
        console.warn('[WS] Could not refresh room grants:', error.message));
    }, 60000);
    if (grantTimer.unref) grantTimer.unref();
    let seatTickPending = false;
    const seatTimer = setInterval(() => {
      if (!seatsUsed || seatTickPending) return;
      seatTickPending = true;
      runRoomOperation(async () => {
        for (const [cid, player] of playerPositions) {
          const socket = activeConnections.get(cid);
          if (!player.seat || socket?.readyState !== WebSocket.OPEN || socket.isAlive === false) continue;
          if (!(await getSeatService().renew(seatIdentity(cid, player)))) {
            voiceRelay.handleDisconnect(cid);
            playerPositions.delete(cid);
            seatIdentities.delete(cid);
            socket.send(JSON.stringify({ type: 'ROOM_SEAT_EXPIRED', payload: {} }));
            socket.close(4003, 'Seat expired');
            broadcastToRoom(player.roomId, { type: 'PLAYER_LEFT', payload: { characterId: player.characterId } });
          }
        }
        const expired = await getSeatService().cleanupExpired();
        const changedRooms = new Set(expired.map(row => row.room_id));
        for (const player of playerPositions.values()) if (player.seat) changedRooms.add(player.roomId);
        for (const roomId of changedRooms) await publishSeats(roomId);
      }).catch(error => console.warn('[WS] Seat heartbeat:', error.message))
        .finally(() => { seatTickPending = false; });
    }, 20000);
    if (seatTimer.unref) seatTimer.unref();
    wss.on('close', () => { clearInterval(hbTimer); clearInterval(grantTimer); clearInterval(seatTimer); });

    console.log(`WebSocket server attached to HTTP server (shared port)`);
  } catch (error) {
    console.warn('WebSocket server setup failed, continuing without WebSocket:', error.message);
  }
}

function handleMessage(connectionId, ws, data) {
  if (supersededConnections.has(connectionId)) return;
  const { type, payload } = data;

  switch (type) {
    case 'ROOM_LOOK': {
      const player = playerPositions.get(connectionId);
      if (!player?.seat || !payload || !Number.isFinite(payload.yaw) || !Number.isFinite(payload.pitch)) break;
      if (Date.now() - (player.lastLookAt || 0) < 80) break;
      player.lastLookAt = Date.now();
      const look = { yaw: Math.max(-1.2, Math.min(1.2, payload.yaw)), pitch: Math.max(-.65, Math.min(.65, payload.pitch)) };
      broadcastToRoom(player.roomId, { type: 'ROOM_LOOK', payload: { roomId: player.roomId, characterId: player.characterId, look } });
      break;
    }
    case 'ROOM_SEAT_SELECT':
    case 'ROOM_LEAVE':
      runRoomOperation(() => handleSeatCommand(connectionId, ws, type, payload || {}))
        .catch(error => {
          console.warn('[WS] Seat command:', error.message);
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ROOM_SEAT_RESULT',
            payload: { requestId: payload?.requestId, success: false, code: error.code || 'SEAT_ERROR' } }));
        });
      break;
    case 'PLAYER_JOIN':
      queuePlayerJoin(connectionId, ws, payload || {}).catch(error => {
        console.error('[WS] Room join failed:', error);
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({
          type: 'ROOM_JOIN_DENIED', payload: { reason: 'Не удалось войти в комнату' }
        }));
      });
      break;

    case 'POSITION_UPDATE':
      handlePositionUpdate(connectionId, payload);
      break;

    case 'SKILL_CAST':
      handleSkillCast(connectionId, payload);
      break;

    case 'MONSTER_ATTACK':
      handleMonsterAttack(connectionId, payload);
      break;

    case 'VOICE_COMMAND':
      handleVoiceCommand(connectionId, payload);
      break;

    case 'PING':
      // 客户端应用层探活（public/js/wsPresenceGuard.js）：立刻回 PONG。
      // 半开连接（TCP 已死但 onclose 不触发）时客户端收不到 PONG，
      // 据此判定链路失效并强制重连——协议层 ping/pong 在浏览器端没有 JS 事件。
      try { ws.send(JSON.stringify({ type: 'PONG', payload: { t: Date.now() } })); } catch (e) {}
      break;

    case 'VOICE_START':
      voiceRelay.handleVoiceStart(connectionId, ws);
      break;

    case 'VOICE_PROBE':
      voiceRelay.handleVoiceProbe(connectionId, ws);
      break;

    case 'VOICE_END':
      voiceRelay.handleVoiceEnd(connectionId, ws);
      break;

    case 'VOICE_MESSAGE':
      voiceRelay.handleVoiceMessage(connectionId, ws, payload);
      break;

    case 'CHAT': {
      // 附近聊天：30m 内玩家可见，带服务端权威 characterId 供头顶气泡定位
      const sender = playerPositions.get(connectionId);
      if (process.env.ROOMS_ENABLED === 'true' && !sender) break;
      const text = String(payload.message || '').slice(0, 200).trim();
      if (!text) break;
      const chatMessage = {
        type: 'CHAT',
        payload: {
          sender: (sender && sender.characterName) || payload.sender || '未知',
          characterId: (sender && sender.characterId) || null,
          message: text,
          position: sender ? sender.position : null,   // P4：携带位置供 Agent 距离过滤
          timestamp: new Date(),
        },
      };
      // P4：异步写入聊天记录（不阻塞广播，失败仅日志，chat_log_enabled=false 时跳过）
      const _senderRef = sender;
      const _msgRef = text;
      if (process.env.APP_MODE !== 'rooms' && (sender?.roomId || MAIN_ROOM_ID) === MAIN_ROOM_ID) Promise.resolve().then(() => {
        try {
          const chatLogService = require('../agent/chatLogService');
          return chatLogService.insertLog({
            senderType: 'human',
            senderId: _senderRef && _senderRef.characterId,
            senderName: _senderRef && _senderRef.characterName,
            message: _msgRef,
            position: _senderRef && _senderRef.position
          });
        } catch (e) { /* non-fatal */ }
      }).catch(() => {});
      if (sender && sender.position && process.env.ROOMS_ENABLED === 'true' && sender.roomId !== MAIN_ROOM_ID) {
        broadcastToNearby(sender.position, 30, chatMessage, null, sender.roomId);
      } else if (sender && sender.position) {
        // 必须经 module.exports 调用：CHAT 旁路 patch（agentWsServer）替换的是导出属性，
        // 裸调用内部函数会绕过 patch，导致人类消息永远转发不到 Agent
        module.exports.broadcastToNearby(sender.position, 30, chatMessage);
      } else {
        module.exports.broadcastToAll(chatMessage);
      }
      break;
    }

    case 'PORTAL_CREATE':
      handlePortalCreate(connectionId, payload);
      break;

    case 'PORTAL_TELEPORT':
      handlePortalTeleport(connectionId, payload);
      break;

    case 'REQUEST_PORTALS':
      handleRequestPortals(connectionId, ws);
      break;

    case 'MODEL_UPDATE':
      handleModelUpdate(connectionId, payload);
      break;

    default:
      console.log('Unknown message type:', type);
  }
}

// Serialize joins for one character. Otherwise two concurrent database updates
// can finish out of order and leave last_room_id pointing at the old room.
function queuePlayerJoin(connectionId, ws, payload) {
  const characterId = payload.characterId;
  const key = typeof characterId === 'string' && characterId.length <= 128
    ? `character:${characterId}` : `connection:${connectionId}`;
  const previous = joinQueues.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(() => {
    const join = () => {
      if (supersededConnections.has(connectionId) || ws.readyState !== WebSocket.OPEN) return;
      return handlePlayerJoin(connectionId, ws, payload);
    };
    return process.env.ROOMS_ENABLED === 'true' ? runRoomOperation(join) : join();
  });
  joinQueues.set(key, current);
  const cleanup = () => { if (joinQueues.get(key) === current) joinQueues.delete(key); };
  current.then(cleanup, cleanup);
  return current;
}

/**
 * 处理玩家模型URL更新（当客户端异步补全GLB URL后发送）
 * 更新服务器内存中的 glbUrl，并广播给其他在线玩家
 */
function handleModelUpdate(connectionId, payload) {
  const { characterId, glbUrl, animUrls, isSelfContainedBundle } = payload;
  const p = playerPositions.get(connectionId);
  if (p?.avatarConfig) return; // Account avatars are resolved from the database on join.
  if (p) {
    p.glbUrl = glbUrl || null;
    if (animUrls) p.animUrls = animUrls;
    p.isSelfContainedBundle = isSelfContainedBundle === true;
  } else {
    warnUnregistered(connectionId, 'MODEL_UPDATE');
    return;
  }
  // 广播给所有其他玩家，让他们刷新该玩家的模型和动画
  broadcastToRoom(p.roomId || MAIN_ROOM_ID, {
    type: 'MODEL_UPDATE',
    payload: {
      characterId: p.characterId,
      glbUrl: glbUrl || null,
      animUrls: animUrls || null,
      isSelfContainedBundle: isSelfContainedBundle === true,
    },
  });
}

async function handlePlayerJoin(connectionId, ws, payload) {
  if (supersededConnections.has(connectionId)) return;
  if (process.env.APP_MODE === 'rooms' && (!payload.roomSlug || payload.roomSlug === 'main')) {
    ws.send(JSON.stringify({ type: 'ROOM_JOIN_DENIED', payload: { code: 'ROOM_REQUIRED', reason: 'Выберите комнату' } }));
    return;
  }
  let { characterId, characterName, position, glbUrl, animUrls, weaponConfig, boneMapConfig, weaponSocketConfig, calibrationConfig, isGuest, isSelfContainedBundle } = payload;
  let avatarConfig = null;
  let roomId = MAIN_ROOM_ID;
  let roomPosition = position;
  let verifiedName = characterName;
  let verifiedCharacter = false;
  let seatAssignment = null;
  let seatUserId;
  if (process.env.ROOMS_ENABLED === 'true' && payload.roomSlug && payload.roomSlug !== 'main') {
    let decoded;
    try { decoded = jwt.verify(payload.token, process.env.JWT_SECRET); } catch (_) {}
    if (!decoded?.userId || !characterId) {
      ws.send(JSON.stringify({ type: 'ROOM_JOIN_DENIED', payload: { reason: 'Нужна авторизация' } }));
      return;
    }
    if (process.env.APP_MODE === 'rooms') {
      const canonical = await query('SELECT c.id FROM users u JOIN characters c ON c.id=u.room_character_id AND c.user_id=u.id WHERE u.id=$1', [decoded.userId]);
      if (canonical.rows[0]?.id !== characterId) {
        ws.send(JSON.stringify({ type: 'ROOM_JOIN_DENIED', payload: { code: 'CHARACTER_SESSION_CHANGED', reason: 'Обновите вход через кабинет' } }));
        return;
      }
    }
    const avatarUser = (await query('SELECT avatar_config FROM users WHERE id=$1', [decoded.userId])).rows[0];
    avatarConfig = Object.keys(avatarUser?.avatar_config || {}).length ? avatarUser.avatar_config : { ...require('../services/userAvatars').DEFAULT };
    glbUrl = animUrls = weaponConfig = boneMapConfig = weaponSocketConfig = calibrationConfig = null;
    isSelfContainedBundle = isGuest = false;
    const { rows } = await query(`
      SELECT r.id, r.capacity, r.spawn_position, r.status, r.allow_rejoin, r.seating_mode,
        c.name AS character_name, c.last_room_id, c.last_position
      FROM rooms r JOIN characters c ON c.user_id = $2 AND c.id = $3
      WHERE r.slug = $1 AND r.status IN ('open', 'closed')
    `, [payload.roomSlug, decoded.userId, characterId]);
    if (!rows.length || (rows[0].status === 'closed' &&
        !rows[0].allow_rejoin) || (rows[0].status === 'closed' &&
        !(await hasPersistentRoomReturnAccess(rows[0].id, characterId)))) {
      ws.send(JSON.stringify({ type: 'ROOM_JOIN_DENIED', payload: { reason: 'Комната недоступна' } }));
      return;
    }
    roomId = rows[0].id;
    verifiedCharacter = true;
    seatUserId = decoded.userId;
    const spawn = rows[0].spawn_position || { x: 0, y: 0, z: 0 };
    roomPosition = { x: Number(spawn.x) || 0, y: (Number(spawn.y) || 0) + 2,
      z: Number(spawn.z) || 0 };
    if (rows[0].status === 'closed' && rows[0].last_room_id === roomId) {
      if (validRoomPosition(position)) roomPosition = position;
      else if (validRoomPosition(rows[0].last_position)) roomPosition = rows[0].last_position;
    }
    verifiedName = rows[0].character_name;
    const occupied = new Set([...playerPositions.entries()].filter(([cid, player]) =>
      cid !== connectionId && player.roomId === roomId).map(([, player]) => player.characterId));
    if (rows[0].seating_mode !== 'seated' && !occupied.has(characterId) && occupied.size >= rows[0].capacity) {
      ws.send(JSON.stringify({ type: 'ROOM_JOIN_DENIED', payload: { reason: 'Комната заполнена' } }));
      return;
    }
    rejoinGrants.delete(roomGrantKey(roomId, characterId));
    if (rows[0].seating_mode === 'seated') {
      try {
        seatAssignment = await getSeatService().admit({ roomId, characterId, userId: decoded.userId,
          sessionId: connectionId, isCurrent: () => ws.readyState === WebSocket.OPEN && !supersededConnections.has(connectionId) });
      } catch (error) {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ROOM_JOIN_DENIED',
          payload: { code: error.code || 'SEAT_ERROR', reason: error.code === 'ROOM_FULL' ? 'Комната заполнена' : 'Не удалось занять место' } }));
        return;
      }
      roomPosition = seatAssignment.pose.position;
      seatUserId = decoded.userId;
    } else {
      await query('UPDATE characters SET last_room_id = $1 WHERE id = $2 AND user_id = $3',
        [roomId, characterId, decoded.userId]);
    }
  } else if (process.env.ROOMS_ENABLED === 'true' && payload.token && characterId) {
    try {
      const decoded = jwt.verify(payload.token, process.env.JWT_SECRET);
      const result = await query(`
        UPDATE characters SET last_room_id = $1
        WHERE id = $2 AND user_id = $3 RETURNING name
      `, [MAIN_ROOM_ID, characterId, decoded.userId]);
      if (result.rows.length) {
        verifiedName = result.rows[0].name;
        verifiedCharacter = true;
        seatUserId = decoded.userId;
      }
    } catch (_) { /* Legacy main-world guests and stale tokens retain old flow. */ }
  }

  // The browser may have closed while authorization/database work was pending.
  if (supersededConnections.has(connectionId) || ws.readyState !== WebSocket.OPEN) return;
  const previous = playerPositions.get(connectionId);
  if (previous && previous.roomId !== roomId) {
    voiceRelay.handleDisconnect(connectionId);
    broadcastToRoom(previous.roomId || MAIN_ROOM_ID, { type: 'PLAYER_LEFT', payload: {
      characterId: previous.characterId, characterName: previous.characterName
    } });
  }

  // An authenticated room character has one live session. Remove the old record
  // before broadcasting the replacement, so snapshots never contain a double.
  if (verifiedCharacter) {
    if (!seatAssignment) {
      // Also release a held claim from an already disconnected old tab.
      const released = await query(`DELETE FROM room_seat_claims
        WHERE character_id = $1 AND room_id <> $2 RETURNING room_id`, [characterId, roomId]);
      for (const oldRoom of new Set(released.rows.map(row => row.room_id))) await publishSeats(oldRoom);
    }
    for (const [cid, oldPlayer] of playerPositions) {
      if ((oldPlayer.characterId === characterId || (process.env.APP_MODE === 'rooms' && seatUserId && seatIdentities.get(cid) === seatUserId)) && oldPlayer.seat && (oldPlayer.roomId !== roomId || oldPlayer.characterId !== characterId)) {
        await getSeatService().release(seatIdentity(cid, oldPlayer));
        await publishSeats(oldPlayer.roomId);
      }
    }
    playerPositions.forEach((oldPlayer, cid) => {
      if (cid === connectionId || (oldPlayer?.characterId !== characterId && (process.env.APP_MODE !== 'rooms' || !seatUserId || seatIdentities.get(cid) !== seatUserId))) return;
      if (!seatAssignment && oldPlayer.roomId === roomId && validRoomPosition(oldPlayer.position)) {
        roomPosition = oldPlayer.position;
      }
      supersededConnections.add(cid);
      const expiry = setTimeout(() => supersededConnections.delete(cid), 120000);
      if (expiry.unref) expiry.unref();
      playerPositions.delete(cid);
      seatIdentities.delete(cid);
      ghostWarnAt.delete(cid);
      voiceRelay.handleDisconnect(cid);
      if (oldPlayer.roomId !== roomId || oldPlayer.characterId !== characterId) {
        broadcastToRoom(oldPlayer.roomId || MAIN_ROOM_ID, { type: 'PLAYER_LEFT', payload: {
          characterId: oldPlayer.characterId, characterName: oldPlayer.characterName
        } });
      }
      const oldSocket = activeConnections.get(cid);
      if (oldSocket?.readyState === WebSocket.OPEN) {
        try {
          oldSocket.send(JSON.stringify({ type: 'ROOM_SESSION_REPLACED', payload: {} }));
          oldSocket.close(4002, 'Session replaced');
        } catch (_) { try { oldSocket.terminate(); } catch (_) {} }
      }
    });
  }

  playerPositions.set(connectionId, {
    seat: seatAssignment ? { id: seatAssignment.seat.id, ...seatAssignment.pose } : null,
    roomId,
    roomEpoch: roomEpochs.get(roomId) || 0,
    characterId,
    characterName: verifiedName,
    position: roomPosition,
    avatarConfig,
    glbUrl: glbUrl || null,
    animUrls: animUrls || null,
    weaponConfig: weaponConfig || null,
    boneMapConfig: boneMapConfig || null,
    weaponSocketConfig: weaponSocketConfig || null,
    calibrationConfig: calibrationConfig || null,
    isGuest: isGuest || false,
    isSelfContainedBundle: isSelfContainedBundle === true,
    lastUpdate: new Date(),
  });
  if (verifiedCharacter && seatUserId) seatIdentities.set(connectionId, seatUserId);
  if (seatAssignment) {
    ws.send(JSON.stringify({ type: 'ROOM_SEAT_ASSIGNED', payload: {
      roomId, seat: playerPositions.get(connectionId).seat
    } }));
    await publishSeats(roomId);
  }

  // Notify all players (含 glbUrl + animUrls + 武器配置 + 校准配置 + 游客标记 + 自包含包标记)
  broadcastToRoom(roomId, {
    type: 'PLAYER_JOINED',
    payload: {
      characterId,
      characterName: verifiedName,
      position: roomPosition,
      seat: playerPositions.get(connectionId)?.seat || null,
      avatarConfig,
      glbUrl: glbUrl || null,
      animUrls: animUrls || null,
      weaponConfig: weaponConfig || null,
      boneMapConfig: boneMapConfig || null,
      weaponSocketConfig: weaponSocketConfig || null,
      calibrationConfig: calibrationConfig || null,
      isGuest: isGuest || false,
      isSelfContainedBundle: isSelfContainedBundle === true,
    },
  });

  if (roomId !== MAIN_ROOM_ID) {
    if (ws.readyState !== WebSocket.OPEN || playerPositions.get(connectionId)?.roomId !== roomId) return;
    ws.send(JSON.stringify({ type: 'WORLD_STATE', payload: {
      players: [...playerPositions.values()].filter(player => (player.roomId || MAIN_ROOM_ID) === roomId),
      weather: null, timestamp: new Date()
    } }));
    return;
  }

  // Send current world state to new player (含已在线玩家的 glbUrl 和当前天气)
  // 异步读取当前天气配置
  query('SELECT config_value FROM game_config WHERE config_key = \'world_weather\'')
    .then(async weatherResult => {
      let currentWeather = { type: 'clear', intensity: 50, wind: 20, auto_cycle: false, cycle_interval: 30 };
      if (weatherResult.rows.length > 0) {
        try { currentWeather = JSON.parse(weatherResult.rows[0].config_value); } catch(e) {}
      }
      // 内联当前选中的自定义天空（新进玩家与在线玩家看到一致的天空）
      try {
        const { resolveSky } = require('../routes/sky');
        currentWeather.sky = await resolveSky(currentWeather);
      } catch(e) {}
      if (ws.readyState !== WebSocket.OPEN || playerPositions.get(connectionId)?.roomId !== roomId) return;
      ws.send(JSON.stringify({
        type: 'WORLD_STATE',
        payload: {
          players: [...playerPositions.values()].filter(player => player.roomId === roomId),
          weather: currentWeather,
          timestamp: new Date(),
        },
      }));
    })
    .catch(() => {
      if (ws.readyState !== WebSocket.OPEN || playerPositions.get(connectionId)?.roomId !== roomId) return;
      ws.send(JSON.stringify({
        type: 'WORLD_STATE',
        payload: {
          players: [...playerPositions.values()].filter(player => player.roomId === roomId),
          weather: { type: 'clear', intensity: 50, wind: 20 },
          timestamp: new Date(),
        },
      }));
    });
}

function handlePositionUpdate(connectionId, payload) {
  const { position, characterId, animMode, rotation } = payload;

  if (!playerPositions.has(connectionId)) {
    // 断线重连后没重发 PLAYER_JOIN 的连接会一直走到这里：此前是静默丢弃，
    // 表现为"对方完全看不到我移动"，而前端毫无提示（前端已加 wsPresenceGuard 自愈）
    warnUnregistered(connectionId, 'POSITION_UPDATE');
    return;
  }

  const player = playerPositions.get(connectionId);
  if (player.seat) return;
  player.position = position;
  if (animMode !== undefined) player.animMode = animMode;
  if (rotation !== undefined) player.rotation = rotation;
  player.lastUpdate = new Date();

  // Broadcast position to nearby players
  broadcastToRoom(player.roomId || MAIN_ROOM_ID, {
    type: 'POSITION_UPDATE',
    payload: {
      characterId: player.characterId,
      position,
      animMode: animMode || null,
      rotation: rotation !== undefined ? rotation : null,
    },
  });
}

function handleSkillCast(connectionId, payload) {
  const sender = playerPositions.get(connectionId);
  if (sender?.seat) return;
  if (process.env.ROOMS_ENABLED === 'true' && !sender) return;
  const { characterId, skillId, targetPosition, skillEffect } = payload;

  broadcastToRoom(sender?.roomId || MAIN_ROOM_ID, {
    type: 'SKILL_CAST',
    payload: {
      characterId: sender?.characterId || characterId,
      skillId,
      targetPosition,
      skillEffect,
      timestamp: new Date(),
    },
  });
}

function handleMonsterAttack(connectionId, payload) {
  const sender = playerPositions.get(connectionId);
  if (sender?.seat) return;
  if (process.env.ROOMS_ENABLED === 'true' && !sender) return;
  const { monsterId, targetCharacterId, damage } = payload;

  broadcastToRoom(sender?.roomId || MAIN_ROOM_ID, {
    type: 'MONSTER_ATTACK',
    payload: {
      monsterId,
      targetCharacterId,
      damage,
      timestamp: new Date(),
    },
  });
}

function handleVoiceCommand(connectionId, payload) {
  const sender = playerPositions.get(connectionId);
  if (process.env.ROOMS_ENABLED === 'true' && !sender) return;
  const { characterId, command, recognizedText } = payload;

  // Broadcast voice command to all players (for immersion)
  broadcastToRoom(sender?.roomId || MAIN_ROOM_ID, {
    type: 'VOICE_COMMAND',
    payload: {
      characterId: sender?.characterId || characterId,
      command,
      recognizedText,
      timestamp: new Date(),
    },
  });

  // Check if it matches any skill trigger
  // This would call the skill detection API
}

function broadcastToAll(message) {
  if (process.env.ROOMS_ENABLED === 'true') return broadcastToRoom(MAIN_ROOM_ID, message);
  const data = JSON.stringify(message);

  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
}

function broadcastToRoom(roomId, message) {
  if (process.env.ROOMS_ENABLED !== 'true') return broadcastToAll(message);
  const data = JSON.stringify(message);
  let count = 0;
  playerPositions.forEach((player, connectionId) => {
    if (player.roomId !== roomId) return;
    const client = activeConnections.get(connectionId);
    if (client?.readyState === WebSocket.OPEN) {
      client.send(data);
      count++;
    }
  });
  return count;
}

function invalidateRoomReturnAccess(roomId) {
  roomEpochs.set(roomId, (roomEpochs.get(roomId) || 0) + 1);
  clearRoomReturnGrants(roomId);
}

function clearRoomReturnGrants(roomId) {
  for (const key of rejoinGrants.keys()) {
    if (key.startsWith(`${roomId}:`)) rejoinGrants.delete(key);
  }
}

function endRoom(roomId) {
  if (process.env.ROOMS_ENABLED !== 'true' || roomId === MAIN_ROOM_ID) return 0;
  invalidateRoomReturnAccess(roomId);
  let count = 0;
  playerPositions.forEach((player, connectionId) => {
    if (player.roomId !== roomId) return;
    const client = activeConnections.get(connectionId);
    if (client?.readyState === WebSocket.OPEN) {
      try {
        client.send(JSON.stringify({ type: 'ROOM_ENDED', payload: { roomId } }));
        client.close(4001, 'Room ended');
      } catch (error) {
        try { client.terminate(); } catch (_) {}
      }
    }
    voiceRelay.handleDisconnect(connectionId);
    playerPositions.delete(connectionId);
    seatIdentities.delete(connectionId);
    ghostWarnAt.delete(connectionId);
    count++;
  });
  return count;
}

function broadcastToNearby(sourcePosition, range, message, excludeConnectionId = null, roomId = MAIN_ROOM_ID) {
  const data = JSON.stringify(message);
  let count = 0;

  // 按玩家真实位置计算距离（playerPositions 由 PLAYER_JOIN / POSITION_UPDATE 维护）
  playerPositions.forEach((player, connectionId) => {
    if (excludeConnectionId && connectionId === excludeConnectionId) return;
    if (!player || !player.position) return;
    if (process.env.ROOMS_ENABLED === 'true' && player.roomId !== roomId) return;
    const distance = calculateDistance(sourcePosition, player.position);
    if (distance <= range) {
      const client = activeConnections.get(connectionId);
      if (client && client.readyState === WebSocket.OPEN) {
        client.send(data);
        count++;
      }
    }
  });

  return count;
}

function calculateDistance(pos1, pos2) {
  const dx = pos1.x - pos2.x;
  const dy = pos1.y - pos2.y;
  const dz = pos1.z - pos2.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// ==================== 传送门WebSocket处理 ====================

/**
 * 处理传送门创建通知
 */
function handlePortalCreate(connectionId, payload) {
  if (process.env.ROOMS_ENABLED === 'true' &&
      playerPositions.get(connectionId)?.roomId !== MAIN_ROOM_ID) return;
  const { portalId, name, sourcePosition, targetPosition, portalType } = payload;

  console.log(`🌀 Portal created: ${name} (${portalType})`);

  // 广播传送门创建事件给所有玩家
  broadcastToAll({
    type: 'PORTAL_CREATED',
    payload: {
      portalId,
      name,
      sourcePosition,
      targetPosition,
      portalType,
      timestamp: new Date(),
    },
  });
}

/**
 * 处理传送门传送事件
 */
function handlePortalTeleport(connectionId, payload) {
  if (process.env.ROOMS_ENABLED === 'true' &&
      playerPositions.get(connectionId)?.roomId !== MAIN_ROOM_ID) return;
  const { characterId, portalId, fromPosition, toPosition } = payload;

  console.log(`✨ Player ${characterId} teleported through portal ${portalId}`);

  // 更新玩家位置
  if (playerPositions.has(connectionId)) {
    const player = playerPositions.get(connectionId);
    player.position = toPosition;
    player.lastUpdate = new Date();
  }

  // 广播传送事件（其他玩家会看到传送特效）
  broadcastToAll({
    type: 'PORTAL_TELEPORT',
    payload: {
      characterId,
      portalId,
      fromPosition,
      toPosition,
      timestamp: new Date(),
    },
  });
}

/**
 * 处理请求传送门列表
 */
async function handleRequestPortals(connectionId, ws) {
  try {
    if (process.env.ROOMS_ENABLED === 'true' &&
        playerPositions.get(connectionId)?.roomId !== MAIN_ROOM_ID) {
      ws.send(JSON.stringify({ type: 'PORTALS_LIST', payload: {
        portals: [], timestamp: new Date()
      } }));
      return;
    }
    // 从数据库获取所有活跃的传送门
    const result = await query(
      `SELECT id, name, source_position, target_position, portal_type, 
              target_world_url, required_level, cooldown_seconds
       FROM portals 
       WHERE is_active = true 
       ORDER BY created_at DESC`
    );

    // 发送传送门列表给请求的客户端
    ws.send(JSON.stringify({
      type: 'PORTALS_LIST',
      payload: {
        portals: result.rows,
        timestamp: new Date(),
      },
    }));

    console.log(`📋 Sending portal list: ${result.rows.length} portals`);
  } catch (error) {
    console.error('❌ Failed to list portals:', error);
    ws.send(JSON.stringify({
      type: 'ERROR',
      payload: {
        message: '获取传送门列表失败',
        error: error.message,
      },
    }));
  }
}

// ==================== 传送门WebSocket处理结束 ====================

module.exports = {
  setupWebSocketServer,
  broadcastToAll,
  broadcastToRoom,
  endRoom,
  invalidateRoomReturnAccess,
  clearRoomReturnGrants,
  hasRoomReturnAccess,
  hasPersistentRoomReturnAccess,
  roomParticipants,
  refreshActiveRoomGrants,
  broadcastToNearby,
  getPlayerPositions: () => playerPositions,
  getWss: () => wss,                     // P3：noServer 模式下供 upgradeRouter 调 wss.handleUpgrade
};
