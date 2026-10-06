// Explicit opt-in only. All fixtures and migrations run in a fresh schema
// inside a transaction that is rolled back even when an assertion fails.
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

async function main() {
  if (!process.env.ROOM_TEST_DATABASE_URL) {
    throw new Error('Set ROOM_TEST_DATABASE_URL to a test PostgreSQL database. No connection was attempted.');
  }
  const { Client } = require('pg');
  const client = new Client({ connectionString: process.env.ROOM_TEST_DATABASE_URL,
    connectionTimeoutMillis: 5000, statement_timeout: 15000 });
  const mainRoom = '00000000-0000-0000-0000-000000000001';
  const user = randomUUID();
  const character = randomUUID();
  const object = 1;
  const room = randomUUID();
  const schema = `room_test_${randomUUID().replaceAll('-', '')}`;
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET LOCAL search_path TO ${schema}, pg_catalog`);
    await client.query(`
      CREATE TABLE admin_users (id integer PRIMARY KEY);
      CREATE TABLE users (id uuid PRIMARY KEY);
      CREATE TABLE characters (id uuid PRIMARY KEY, user_id uuid REFERENCES users(id), name text);
      CREATE TABLE world_objects (id integer PRIMARY KEY, position_x double precision,
        position_z double precision, created_at timestamptz DEFAULT now());
    `);
    await client.query('INSERT INTO users VALUES ($1)', [user]);
    await client.query('INSERT INTO characters (id, user_id) VALUES ($1, $2)', [character, user]);
    await client.query('INSERT INTO world_objects (id) VALUES ($1)', [object]);
    const migrations = await Promise.all(['add_rooms.sql', 'add_room_rejoin_grants.sql', 'add_room_seats.sql']
      .map(file => readFile(path.join(__dirname, '../database/migrations', file), 'utf8')));
    for (const sql of migrations) await client.query(sql);
    assert.equal((await client.query('SELECT room_id FROM world_objects WHERE id=$1', [object])).rows[0].room_id, mainRoom);
    assert.equal((await client.query('SELECT last_room_id FROM characters WHERE id=$1', [character])).rows[0].last_room_id, mainRoom);
    await client.query("INSERT INTO rooms (id, slug, name, status) VALUES ($1, 'meeting', 'Test meeting', 'open')", [room]);
    await client.query('UPDATE world_objects SET room_id=$1 WHERE id=$2', [room, object]);
    await client.query('UPDATE characters SET last_room_id=$1 WHERE id=$2', [room, character]);
    // Repeated migrations must retain assignments to a non-default room.
    for (const sql of migrations) await client.query(sql);
    assert.equal((await client.query('SELECT room_id FROM world_objects WHERE id=$1', [object])).rows[0].room_id, room);
    assert.equal((await client.query('SELECT last_room_id FROM characters WHERE id=$1', [character])).rows[0].last_room_id, room);
    const fresh = 2;
    assert.equal((await client.query('INSERT INTO world_objects (id) VALUES ($1) RETURNING room_id', [fresh])).rows[0].room_id, mainRoom);
    await client.query('SAVEPOINT invalid_room');
    await assert.rejects(client.query('UPDATE world_objects SET room_id=$1 WHERE id=$2', [randomUUID(), object]), { code: '23503' });
    await client.query('ROLLBACK TO SAVEPOINT invalid_room');
    const seatA = randomUUID();
    const seatB = randomUUID();
    await client.query('INSERT INTO room_seats (id, room_id, object_id, label, sort_order) VALUES ($1, $2, $3, $4, 1)', [seatA, room, object, '1']);
    await client.query('INSERT INTO room_seats (id, room_id, object_id, label, sort_order) VALUES ($1, $2, $3, $4, 2)', [seatB, room, object, '2']);
    await client.query('SAVEPOINT invalid_seat');
    await assert.rejects(client.query('INSERT INTO room_seats (room_id, object_id, label) VALUES ($1, $2, $3)',
      [room, fresh, 'foreign object']), { code: '23503' });
    await client.query('ROLLBACK TO SAVEPOINT invalid_seat');
    assert.equal((await client.query('SELECT seating_mode FROM rooms WHERE id=$1', [room])).rows[0].seating_mode, 'free');
    await client.query("UPDATE rooms SET seating_mode='seated' WHERE id=$1", [room]);
    // Map service transactions to savepoints inside this disposable fixture.
    // This checks actual SQL, but does not simulate concurrent DB connections.
    const servicePool = { query: (sql, values) => client.query(sql, values), async connect() { return { release() {}, query(sql, values) {
      if (sql === 'BEGIN') return client.query('SAVEPOINT seat_operation');
      if (sql === 'COMMIT') return client.query('RELEASE SAVEPOINT seat_operation');
      if (sql === 'ROLLBACK') return client.query('ROLLBACK TO SAVEPOINT seat_operation');
      return client.query(sql, values);
    } }; } };
    const seats = require('../src/services/roomSeats').createRoomSeatService(servicePool);
    const input = { roomId: room, characterId: character, userId: user, sessionId: 'first' };
    assert.equal((await seats.admit(input)).seat.id, seatA);
    assert.equal((await seats.move({ ...input, seatId: seatB })).seat.id, seatB);
    await assert.rejects(seats.move({ ...input, seatId: randomUUID() }), { code: 'SEAT_UNAVAILABLE' });
    assert.equal((await client.query('SELECT seat_id FROM room_seat_claims WHERE character_id=$1', [character])).rows[0].seat_id, seatB);
    await seats.admit({ ...input, sessionId: 'replacement' });
    assert.equal(await seats.release(input), false);
    const current = { ...input, sessionId: 'replacement' };
    assert.equal(await seats.hold(current), true);
    assert.equal(await seats.hold(current), false);
    assert.equal(await seats.renew(current), false);
    await seats.admit({ ...input, sessionId: 'returned' });
    for (const sql of migrations) await client.query(sql);
    const snapshot = await seats.list(room);
    assert.equal(snapshot.find(seat => seat.id === seatB).character_id, character);
    assert.equal(snapshot.find(seat => seat.id === seatA).occupancy, 'free');
    assert.ok(snapshot.every(seat => !Object.hasOwn(seat, 'session_id')));
    // Both one-seat-per-character and one-character-per-seat are DB invariants.
    await client.query('SAVEPOINT duplicate_claim');
    await assert.rejects(client.query(`INSERT INTO room_seat_claims
      (seat_id, room_id, character_id, session_id, state, expires_at)
      VALUES ($1, $2, $3, 'duplicate', 'active', now() + interval '1 minute')`, [seatA, room, character]), { code: '23505' });
    await client.query('ROLLBACK TO SAVEPOINT duplicate_claim');
    await client.query("INSERT INTO room_rejoin_grants VALUES ($1, $2, now() + interval '5 minutes')", [room, character]);
    await client.query('DELETE FROM characters WHERE id=$1', [character]);
    assert.equal((await client.query('SELECT count(*)::integer AS count FROM room_rejoin_grants')).rows[0].count, 0);
    assert.equal((await client.query('SELECT count(*)::integer AS count FROM room_seat_claims')).rows[0].count, 0);
    console.log('Room PostgreSQL migrations and seating: defaults, repeat run, foreign keys, claims, transfers and cleanup OK');
  } finally {
    try { await client.query('ROLLBACK'); } finally { await client.end(); }
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
