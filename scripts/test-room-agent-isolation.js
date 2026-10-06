const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

const mainRoom = '00000000-0000-0000-0000-000000000001';
const positions = new Map([
  ['agent', { characterId: 'agent:one', characterName: 'Agent', entityType: 'agent',
    roomId: mainRoom, position: { x: 0, y: 2, z: 0 } }],
  ['main', { characterId: 'main-human', characterName: 'Main', roomId: mainRoom,
    position: { x: 1, y: 2, z: 0 } }],
  ['room', { characterId: 'room-human', characterName: 'Room', roomId: 'room-a',
    position: { x: 1, y: 2, z: 0 } }]
]);
const queries = [];
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (parent?.filename.endsWith(path.join('src', 'agent', 'agentObservationService.js')) &&
      request === '../database/db') return { query: async sql => {
        queries.push(sql);
        return { rows: [] };
      } };
  if (request === '../websocket/wsServer' &&
      parent?.filename.endsWith(path.join('src', 'agent', 'agentObservationService.js'))) {
    return { getPlayerPositions: () => positions };
  }
  return originalLoad(request, parent, isMain);
};
const observation = require('../src/agent/agentObservationService');
process.env.ROOMS_ENABLED = 'true';
(async () => {
  try {
    const result = await observation.observe({ id: 'agent:one', name: 'Agent' }, {},
      { x: 0, y: 2, z: 0, radius: 20 });
    assert.deepEqual(result.entities.map(entity => entity.id).sort(),
      ['agent:one', 'main-human']);
    assert.ok(queries.some(sql => sql.includes('FROM world_objects') &&
      sql.includes(`room_id = '${mainRoom}'`)));
    console.log('Room agent isolation: OK');
  } finally {
    Module._load = originalLoad;
  }
})().catch(error => { Module._load = originalLoad; console.error(error); process.exitCode = 1; });
