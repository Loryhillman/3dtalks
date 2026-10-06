// Opt-in integration test: isolated schema in a TEST database, removed in finally.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { createUserRoomService } = require('../src/services/userRooms');
async function main() {
  if (!process.env.ROOM_TEST_DATABASE_URL) throw new Error('Set ROOM_TEST_DATABASE_URL to a test database. No connection attempted.');
  const { Pool } = require('pg');
  const schema = 'user_room_test_' + randomUUID().replaceAll('-', '');
  const config = { connectionString: process.env.ROOM_TEST_DATABASE_URL, connectionTimeoutMillis: 5000, statement_timeout: 15000 };
  const admin = new Pool(config);
  let pool;
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ ...config, options: `-c search_path=${schema},pg_catalog` });
    await pool.query(`CREATE TABLE users (id uuid PRIMARY KEY, username text);
      CREATE TABLE admin_users (id integer PRIMARY KEY);
      CREATE TABLE characters (id uuid PRIMARY KEY, user_id uuid REFERENCES users(id), name text);
      CREATE TABLE character_appearance (character_id uuid UNIQUE REFERENCES characters(id));
      CREATE TABLE geometry_buildings (id serial PRIMARY KEY, user_id integer NOT NULL,
        name text, template_id text, geometry_data jsonb, created_at timestamptz DEFAULT now());
      CREATE TABLE world_objects (id serial PRIMARY KEY, type text, name text, model_path text, model_type text,
        position_x double precision DEFAULT 0, position_y double precision DEFAULT 0,
        position_z double precision DEFAULT 0, rotation_x double precision DEFAULT 0,
        rotation_y double precision DEFAULT 0, rotation_z double precision DEFAULT 0,
        scale_x double precision DEFAULT 1, scale_y double precision DEFAULT 1, scale_z double precision DEFAULT 1,
        has_collision boolean, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());`);
    for (const file of ['add_rooms.sql', 'add_room_rejoin_grants.sql', 'add_room_seats.sql', 'add_user_rooms.sql', 'add_user_rooms.sql', 'add_account_room_character.sql', 'add_independent_room_seats.sql']) {
      await pool.query(readFileSync(path.join(__dirname, '../database/migrations', file), 'utf8'));
    }
    await require('../src/services/roomTemplateSeed').ensureRoomTemplates(pool);
    const owner = randomUUID(), other = randomUUID();
    await pool.query('INSERT INTO users (id) VALUES ($1), ($2)', [owner, other]);
    const accounts = require('../src/services/accountCharacter').createAccountCharacterService(pool);
    const repaired = await Promise.all([accounts.repair(owner), accounts.repair(owner)]);
    assert.equal(repaired[0], repaired[1]);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM characters WHERE user_id=$1', [owner])).rows[0].n, 1);
    const service = createUserRoomService(pool);
    const body = () => ({ name: 'Test', capacity: 1, request_key: randomUUID() });
    const first = body();
    const room = (await service.create(owner, first)).room;
    assert.equal(room.status, 'open');
    let summary = (await service.list(owner)).rooms[0];
    assert.equal(summary.available, 1); assert.equal(summary.seat_count, 6);
    const seat = (await pool.query('SELECT id FROM room_seats WHERE room_id=$1 LIMIT 1', [room.id])).rows[0].id;
    await pool.query(`INSERT INTO room_seat_claims (seat_id,room_id,character_id,session_id,state,expires_at)
      VALUES ($1,$2,$3,'test','active',now()+interval '1 minute')`, [seat, room.id, repaired[0]]);
    summary = (await service.list(owner)).rooms[0];
    assert.equal(summary.active, 1); assert.equal(summary.available, 0);
    await pool.query("UPDATE room_seat_claims SET state='held' WHERE room_id=$1", [room.id]);
    summary = (await service.list(owner)).rooms[0];
    assert.equal(summary.active, 0); assert.equal(summary.held, 1); assert.equal(summary.available, 0);
    await pool.query("UPDATE room_seat_claims SET expires_at=now()-interval '1 second' WHERE room_id=$1", [room.id]);
    summary = (await service.list(owner)).rooms[0];
    assert.equal(summary.held, 0); assert.equal(summary.available, 1);

    assert.equal((await pool.query('SELECT count(*)::int AS n FROM room_seats WHERE room_id=$1', [room.id])).rows[0].n, 6);
    assert.equal((await service.create(owner, first)).room.id, room.id);
    assert.notEqual((await service.create(other, first)).room.id, room.id);
    assert.equal((await service.list(owner)).rooms.length, 1);
    const broken = createUserRoomService(pool, async () => ({ ok: false }));
    const before = (await pool.query('SELECT count(*) FROM geometry_buildings')).rows[0].count;
    await assert.rejects(broken.create(owner, body()), { code: 'INVALID_TEMPLATE' });
    assert.equal((await pool.query('SELECT count(*) FROM geometry_buildings')).rows[0].count, before);
    for (let i = 0; i < 3; i++) await service.create(owner, body());
    const race = await Promise.allSettled([service.create(owner, body()), service.create(owner, body())]);
    assert.equal(race.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(race.find(r => r.status === 'rejected').reason.code, 'ROOM_QUOTA_EXCEEDED');
    assert.equal((await service.list(owner)).quota.used, 5);
    assert.equal((await service.create(owner, first)).reused, true);
    const events = [];
    const lifecycle = require('../src/services/userRoomLifecycle').createUserRoomLifecycle(pool, () => ({
      roomParticipants: () => [], endRoom: roomId => events.push(roomId), clearRoomReturnGrants() {}
    }));
    await assert.rejects(lifecycle.mutate(other, room.id, 'delete', { revision: room.revision }), { code: 'ROOM_NOT_FOUND' });
    await pool.query('INSERT INTO admin_users VALUES (1)');
    const ended = await lifecycle.mutateAsAdmin(1, room.id, 'end', { revision: room.revision });
    assert.equal((await pool.query('SELECT admin_user_id FROM room_user_actions WHERE room_id=$1', [room.id])).rows[0].admin_user_id, 1);
    const changed = await lifecycle.mutate(owner, room.id, 'settings', { revision: ended.room.revision, capacity: 2 });
    assert.equal(changed.room.capacity, 2);
    const opened = await lifecycle.mutate(owner, room.id, 'open', { revision: changed.room.revision });
    const deleted = await lifecycle.mutate(owner, room.id, 'delete', { revision: opened.room.revision });
    assert.ok(deleted.room.deleted_at);
    assert.equal((await lifecycle.mutate(owner, room.id, 'delete', { revision: opened.room.revision })).reused, true);
    assert.equal((await service.list(owner)).quota.used, 4);
    await assert.rejects(service.create(owner, first), { code: 'ROOM_DELETED' });
    await service.create(owner, body());
    assert.equal((await service.list(owner)).quota.used, 5);
    assert.ok(events.includes(room.id));
    console.log('PostgreSQL user rooms: migrations, real template validation, ownership, quota race and rollback OK');
  } finally {
    if (pool) await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
