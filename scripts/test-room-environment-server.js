const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createRoomTemplateEditor, publicationErrors } = require('../src/services/roomTemplateEditor');
const { populateRoom } = require('../src/services/roomCreation');
const { listRoomObjects } = require('../src/services/roomObjects');
const { validateRoom } = require('../src/services/roomValidation');
const { createRoomObjectSeats } = require('../src/services/roomObjectSeats');
const { withMutableRoomModel } = require('../src/services/roomModelMutation');
const { officeGlb } = require('./room-environment-fixtures');
const clone = value => structuredClone(value);
const zero = { x: 0, y: 0, z: 0 }, one = { x: 1, y: 1, z: 1 };
const office = { editor_id: 1, type: 'room_environment', kind: 'room', name: 'Office', collision: false,
  model_id: 1, model_path: '/models/uploaded/office.glb', position: zero, rotation: zero, scale: one,
  environment: { version: 1, bounds: { min: { x: -4, y: 0, z: -3 }, max: { x: 4, y: 3, z: 3 } } } };
const seats = { editor_id: 2, type: 'seat', kind: 'seat', name: 'Seats', collision: false,
  position: zero, rotation: zero, scale: one, seats: [{ label: '1', sort_order: 1, enabled: true,
    coordinate_space: 'rigid', map_x: 0, map_y: 0, local_position: { x: 0, y: 1, z: 0 }, local_rotation: zero }] };
let state = { draft: { name: 'Office', revision: 1, base_version: 1, layout: [clone(office), clone(seats)] },
  templates: [{ id: 1, version: 1, layout: [] }], refs: [], draftRefs: [] };
let missing = false, asset = officeGlb(), operations = [];
const pool = { async connect() {
  let snapshot;
  return { release() {}, async query(sql, p = []) {
    operations.push(sql);
    if (sql === 'BEGIN') { snapshot = clone(state); return { rows: [] }; }
    if (sql === 'ROLLBACK') { state = snapshot; return { rows: [] }; }
    if (sql === 'COMMIT' || sql.includes('pg_advisory')) return { rows: [] };
    if (sql.includes('FROM room_template_drafts')) return { rows: [clone(state.draft)] };
    if (sql.includes('FROM uploaded_models')) return { rows: missing ? [] : [{ id: 1, file_type: 'glb', path: office.model_path }] };
    if (sql.includes('FROM room_templates')) return { rows: [clone(state.templates.at(-1))] };
    if (sql.includes('UPDATE room_template_drafts SET name')) {
      Object.assign(state.draft, { name: p[1], layout: JSON.parse(p[2]), revision: state.draft.revision + 1 }); return { rows: [clone(state.draft)] };
    }
    if (sql.includes('UPDATE room_template_drafts SET base_version')) {
      Object.assign(state.draft, { base_version: p[1], published_revision: state.draft.revision }); return { rows: [clone(state.draft)] };
    }
    if (sql.includes('DELETE FROM room_template_draft_model_refs')) { state.draftRefs = []; return { rows: [] }; }
    if (sql.includes('INSERT INTO room_template_draft_model_refs')) { state.draftRefs.push(p[1]); return { rows: [] }; }
    if (sql.includes('INSERT INTO room_template_model_refs')) { state.refs.push(p); return { rows: [] }; }
    if (sql.includes('INSERT INTO room_templates')) {
      const row = { id: state.templates.length + 1, version: p[1], layout: JSON.parse(p[3]) }; state.templates.push(row); return { rows: [row] };
    }
    throw new Error('Unexpected fixture SQL: ' + sql);
  } };
} };
(async () => {
  const stat = async () => ({ isFile: () => true, size: asset.length });
  const service = createRoomTemplateEditor(pool, stat, { readFile: async () => asset });
  const body = clone(state.draft); body.layout[0].model_path = 'https://untrusted.invalid/office.glb';
  const saved = await service.save('office', body, 1);
  assert.equal(saved.layout[0].model_path, office.model_path, 'library path is authoritative');
  assert.deepEqual(state.draftRefs, [1]);
  assert(operations.some(sql => sql.includes('FOR SHARE')), 'publication/mutation serialize on model row');
  const published = await service.publish('office', saved.revision);
  assert.equal(published.version, 2); assert.equal(state.refs[0][1], 1);
  assert.equal(state.templates[1].layout[0].editor_id, undefined);
  assert.equal((await service.publish('office', saved.revision)).reused, true);
  assert.equal(state.templates.length, 2, 'retry does not create another version');
  await assert.rejects(service.save('office', body, 1), { code: 'TEMPLATE_CHANGED' });
  const stableSnapshot = clone(state.templates[1]);
  const bad = clone(state.draft); bad.layout[1].seats[0].local_position.x = 100;
  const badSaved = await service.save('office', bad, 1);
  await assert.rejects(service.publish('office', badSaved.revision), { code: 'INVALID_TEMPLATE' });
  assert.deepEqual(state.templates[1], stableSnapshot, 'bad publication leaves the old snapshot unchanged');
  const repaired = clone(state.draft); repaired.layout = [clone(office), clone(seats)];
  const draft = await service.save('office', repaired, 1);
  asset = Buffer.from('This is not a GLB');
  await assert.rejects(service.publish('office', draft.revision), { code: 'INVALID_ENVIRONMENT_GLB' });
  asset = officeGlb(); missing = true;
  await assert.rejects(service.publish('office', draft.revision), { code: 'MODEL_NOT_FOUND' }); missing = false;
  const absent = createRoomTemplateEditor(pool, async () => { throw new Error('Missing file'); });
  await assert.rejects(absent.publish('office', draft.revision), { code: 'MODEL_FILE_MISSING' });
  const large = createRoomTemplateEditor(pool, async () => ({ isFile: () => true, size: 104857601 }));
  await assert.rejects(large.publish('office', draft.revision), { code: 'ENVIRONMENT_FILE_TOO_LARGE' });
  assert.equal(state.templates.length, 2); assert.equal(operations.at(-1), 'ROLLBACK');
  assert(publicationErrors([office, { ...office, editor_id: 3 }, seats], 'office').length);

  const roomId = randomUUID(), objects = [], records = [];
  const runtime = { async query(sql, p = []) {
    if (sql.includes('INSERT INTO geometry_buildings')) throw new Error('Imported office must not generate walls');
    if (sql.includes('INSERT INTO world_objects')) {
      objects.push({ id: 1, room_id: p[0], name: p[1], model_path: p[2], position_x: p[3], position_y: p[4], position_z: p[5], rotation_y: p[6],
        has_collision: p[7], type: p[8], rotation_x: p[9], rotation_z: p[10], scale_x: p[11], scale_y: p[12], scale_z: p[13], model_type: p[14], room_environment: JSON.parse(p[15]) });
      return { rows: [{ id: 1 }] };
    }
    if (sql.includes('INSERT INTO room_seats')) {
      records.push({ id: p[0], room_id: p[1], object_id: p[2], label: p[3], sort_order: p[4], local_position: JSON.parse(p[5]), local_rotation: JSON.parse(p[6]), map_x: p[7], map_y: p[8], enabled: p[9], coordinate_space: p[10] }); return { rows: [] };
    }
    if (sql.includes('FROM world_objects')) return { rows: clone(objects) };
    if (sql.includes('FROM room_seats')) return { rows: clone(records) };
    if (sql.includes('FROM rooms')) return { rows: [{ id: roomId, status: 'draft', seating_mode: 'seated' }] };
    throw new Error('Unexpected runtime SQL: ' + sql);
  } };
  await populateRoom(runtime, { id: roomId }, stableSnapshot, {});
  assert.equal(objects.length, 1); assert.equal(objects[0].type, 'uploaded_model'); assert.equal(objects[0].has_collision, false);
  assert.deepEqual(objects[0].room_environment, office.environment);
  assert.equal(records[0].object_id, null);
  assert.equal((await listRoomObjects(roomId, runtime))[0].is_room_environment, true, 'metadata survives the DTO even without geometry objects');
  assert.equal((await validateRoom(roomId, runtime, stat)).ok, true);
  records[0].local_position.x = 9;
  assert.match((await validateRoom(roomId, runtime, stat)).errors.join(' '), /Посадка за пределами помещения/);
  records[0].local_position.x = 0; records[0].object_id = 1;
  assert.equal((await validateRoom(roomId, runtime, stat)).ok, false, 'cannot attach seating to imported office');
  records[0].object_id = null;
  objects[0].has_collision = true;
  assert.equal((await validateRoom(roomId, runtime, stat)).ok, false); objects[0].has_collision = false;
  objects.push(clone(objects[0]));
  assert.match((await validateRoom(roomId, runtime, stat)).errors.join(' '), /только одно помещение/); objects.pop();

  let commit = false, rollback = false, used = true, changed = false;
  const lockedPool = { async connect() { return { release() {}, async query(sql) {
    if (sql === 'COMMIT') commit = true; if (sql === 'ROLLBACK') rollback = true;
    if (sql.includes('FROM uploaded_models')) return { rows: [{ id: 1, path: office.model_path }] };
    if (sql.startsWith('SELECT 1 WHERE')) return { rows: used ? [{}] : [] };
    return { rows: [] };
  } }; } };
  await assert.rejects(withMutableRoomModel(lockedPool, 1, async () => { changed = true; }), { status: 409 });
  assert.equal(changed, false); assert.equal(rollback, true);
  used = false; await withMutableRoomModel(lockedPool, 1, async () => { changed = true; });
  assert.equal(changed, true); assert.equal(commit, true);
  const mutations = { async connect() { return { release() {}, async query(sql, p) {
    if (['BEGIN','ROLLBACK'].includes(sql) || sql.includes('pg_advisory')) return { rows: [] };
    return runtime.query(sql, p);
  } }; } };
  await assert.rejects(createRoomObjectSeats(mutations).mutate(roomId, 1, 'copy'), { message: 'USE_ROOM_ENVIRONMENT_SETTINGS' });
  await assert.rejects(createRoomObjectSeats(mutations).mutate(roomId, 1, 'delete'), { message: 'USE_ROOM_ENVIRONMENT_SETTINGS' });
  console.log('Environment server: canonical model refs, revision/retry/rollback, static GLB publication, runtime snapshots, bounds and mutation guards OK (transactional fake)');
})().catch(error => { console.error(error); process.exitCode = 1; });
