// Requires an explicit, separate test database. All SQL uses temporary schemas.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const { ensureRoomTemplates } = require('../src/services/roomTemplateSeed');
const { ensureBuiltinMeeting, readBundle } = require('../src/services/roomBuiltinBundle');
const { createUserRoomService } = require('../src/services/userRooms');
const { createRoomTemplateEditor } = require('../src/services/roomTemplateEditor');
const { validateRoom } = require('../src/services/roomValidation');

const source = path.resolve(__dirname, '../database/seeds/meeting-six-v1');
const realPublic = path.resolve(__dirname, '../public');
async function main() {
  if (!process.env.ROOM_TEST_DATABASE_URL) throw new Error('Set ROOM_TEST_DATABASE_URL to a separate test database');
  const config = { connectionString: process.env.ROOM_TEST_DATABASE_URL, statement_timeout: 15000 };
  const admin = new Pool(config);
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), '3dtalks-builtin-'));
  async function scenario(name, operation) {
    const schema = 'builtin_test_' + randomUUID().replaceAll('-', '');
    await admin.query(`CREATE SCHEMA ${schema}`);
    const pool = new Pool({ ...config, options: `-c search_path=${schema},pg_catalog` });
    const publicDir = path.join(temporary, name);
    try {
      await pool.query(`CREATE TABLE users (id uuid PRIMARY KEY);
        CREATE TABLE admin_users (id integer PRIMARY KEY);
        CREATE TABLE characters (id uuid PRIMARY KEY, name text);
        CREATE TABLE uploaded_models (id serial PRIMARY KEY, file_name text NOT NULL,
          saved_file_name text NOT NULL,display_name text,path text NOT NULL,
          file_type text NOT NULL,file_size bigint NOT NULL,category text);
        ALTER SEQUENCE uploaded_models_id_seq RESTART WITH 101;
        CREATE TABLE geometry_buildings (id serial PRIMARY KEY,user_id integer,name text,
          template_id text,geometry_data jsonb,created_at timestamptz);
        CREATE TABLE world_objects (id serial PRIMARY KEY,type text,name text,model_path text,model_type text,
          position_x float DEFAULT 0,position_y float DEFAULT 0,position_z float DEFAULT 0,
          rotation_x float DEFAULT 0,rotation_y float DEFAULT 0,rotation_z float DEFAULT 0,
          scale_x float DEFAULT 1,scale_y float DEFAULT 1,scale_z float DEFAULT 1,
          has_collision boolean,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());`);
      for (const file of ['add_rooms.sql', 'add_room_seats.sql', 'add_user_rooms.sql',
        'add_room_template_editor.sql', 'add_independent_room_seats.sql', 'add_room_environment.sql',
        'add_room_builtin_bundles.sql', 'add_room_builtin_bundles.sql']) {
        await pool.query(await fs.readFile(path.resolve(__dirname, '../database/migrations', file), 'utf8'));
      }
      await ensureRoomTemplates(pool);
      await operation(pool, { publicDir });
      console.log('Built-in meeting PostgreSQL: ' + name + ': OK');
    } finally {
      await pool.end();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    }
  }
  try {
    await scenario('fresh-and-restart', async (pool, options) => {
      const legacy = (await pool.query('SELECT * FROM room_templates ORDER BY version')).rows;
      const results = await Promise.all([ensureBuiltinMeeting(pool, options), ensureBuiltinMeeting(pool, options)]);
      assert.deepEqual(results.map(r => r.status).sort(), ['installed', 'present']);
      const templates = (await pool.query('SELECT * FROM room_templates ORDER BY version')).rows;
      assert.deepEqual(templates.slice(0, 3), legacy);
      const template = templates[3];
      assert.equal(template.version, 4);
      assert.equal(template.layout.length, 8);
      assert.equal(template.layout.filter(i => i.type === 'room_environment').length, 1);
      assert.equal(template.layout.flatMap(i => i.seats || []).length, 6);
      assert(template.layout.every(i => i.model_id >= 101), 'server IDs must not be reused');
      assert.equal((await pool.query('SELECT * FROM uploaded_models')).rows.length, 3);
      assert.equal((await pool.query('SELECT * FROM room_template_model_refs')).rows.length, 3);
      await assert.rejects(pool.query('DELETE FROM uploaded_models'), error => error.code === '23503');
      const file = path.join(options.publicDir, template.layout[1].model_path);
      await fs.unlink(file);
      assert.equal((await ensureBuiltinMeeting(pool, options)).status, 'present');
      assert.equal((await fs.stat(file)).size, 1176952);
      assert.equal((await fs.readdir(path.dirname(file))).length, 3);
      await fs.writeFile(file, 'corrupted');
      await assert.rejects(ensureBuiltinMeeting(pool, options), /differs from the shipped file/);
      assert.equal(await fs.readFile(file, 'utf8'), 'corrupted', 'must not overwrite a conflicting file');
      await fs.unlink(file);
      await ensureBuiltinMeeting(pool, options);

      const stat = absolute => fs.stat(path.join(options.publicDir, path.relative(realPublic, absolute)));
      const readFile = absolute => fs.readFile(path.join(options.publicDir, path.relative(realPublic, absolute)));
      const owner = randomUUID();
      await pool.query('INSERT INTO users VALUES ($1)', [owner]);
      await pool.query('INSERT INTO admin_users VALUES (1)');
      const rooms = createUserRoomService(pool, (id, db) => validateRoom(id, db, stat));
      const first = (await rooms.create(owner, { name: 'Bundled meeting', capacity: 6, request_key: randomUUID() })).room;
      assert.equal(first.template_version, 4);
      const snapshot = (await pool.query('SELECT * FROM world_objects WHERE room_id=$1 ORDER BY id', [first.id])).rows;
      assert.equal(snapshot.length, 8);
      assert.equal((await pool.query('SELECT * FROM room_seats WHERE room_id=$1', [first.id])).rows.length, 6);
      assert.equal((await validateRoom(first.id, pool, stat)).ok, true);
      const editor = createRoomTemplateEditor(pool, stat, { readFile });
      let draft = await editor.getDraft('meeting-six', 1);
      draft.layout.find(i => i.kind === 'chair').position.x += .1;
      draft = await editor.save('meeting-six', draft, 1);
      assert.equal((await editor.publish('meeting-six', draft.revision)).version, 5);
      const savedDraft = (await pool.query('SELECT * FROM room_template_drafts')).rows;
      await ensureBuiltinMeeting(pool, options);
      assert.deepEqual((await pool.query('SELECT * FROM room_template_drafts')).rows, savedDraft);
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM room_templates')).rows[0].n, 5);
      assert.deepEqual((await pool.query('SELECT * FROM world_objects WHERE room_id=$1 ORDER BY id', [first.id])).rows, snapshot);
      const second = (await rooms.create(owner, { name: 'Edited meeting', capacity: 6, request_key: randomUUID() })).room;
      assert.equal(second.template_version, 5);
      assert.equal((await pool.query('SELECT * FROM uploaded_models')).rows.length, 3);

      const changedSource = path.join(temporary, 'changed-source');
      await fs.cp(source, changedSource, { recursive: true });
      const manifest = JSON.parse(await fs.readFile(path.join(changedSource, 'manifest.json')));
      manifest.name = 'Changed without a version';
      await fs.writeFile(path.join(changedSource, 'manifest.json'), JSON.stringify(manifest));
      await assert.rejects(ensureBuiltinMeeting(pool, { ...options, directory: changedSource }), /without a new version/);
      await fs.writeFile(path.join(changedSource, 'office.glb'), 'broken source');
      await assert.rejects(readBundle(changedSource), /checksum mismatch/);
    });
    for (const kind of ['publication', 'draft', 'room']) await scenario('preserved-' + kind, async (pool, options) => {
      if (kind === 'publication') await pool.query(`INSERT INTO room_templates(template_key,version,name,layout)
        SELECT template_key,4,'Custom room',layout FROM room_templates WHERE version=3`);
      if (kind === 'draft') await pool.query(`INSERT INTO room_template_drafts(template_key,name,layout,base_version)
        SELECT template_key,name,layout,version FROM room_templates WHERE version=3`);
      if (kind === 'room') await pool.query(`INSERT INTO rooms(slug,name,template_key,template_version)
        VALUES ('existing-room','Old room','meeting-six',3)`);
      const before = (await pool.query('SELECT * FROM room_templates ORDER BY version')).rows;
      assert.equal((await ensureBuiltinMeeting(pool, options)).status, 'preserved');
      assert.equal((await ensureBuiltinMeeting(pool, options)).status, 'preserved');
      assert.deepEqual((await pool.query('SELECT * FROM room_templates ORDER BY version')).rows, before);
      assert.equal((await pool.query('SELECT * FROM uploaded_models')).rows.length, 0);
      assert.equal((await pool.query('SELECT * FROM room_builtin_bundles')).rows.length, 0);
      await assert.rejects(fs.stat(options.publicDir), { code: 'ENOENT' });
    });
    await scenario('transaction-rollback', async (pool, options) => {
      await pool.query(`CREATE FUNCTION reject_bundle() RETURNS trigger LANGUAGE plpgsql AS
        $$ BEGIN RAISE EXCEPTION 'Fixture receipt failure'; END $$;
        CREATE TRIGGER reject_bundle BEFORE INSERT ON room_builtin_bundles
        FOR EACH ROW EXECUTE FUNCTION reject_bundle()`);
      await assert.rejects(ensureBuiltinMeeting(pool, options), /Fixture receipt failure/);
      assert.equal((await pool.query('SELECT * FROM room_templates')).rows.length, 3);
      assert.equal((await pool.query('SELECT * FROM uploaded_models')).rows.length, 0);
      assert.equal((await pool.query('SELECT * FROM room_template_model_refs')).rows.length, 0);
      await pool.query('DROP TRIGGER reject_bundle ON room_builtin_bundles');
      assert.equal((await ensureBuiltinMeeting(pool, options)).status, 'installed');
    });
  } finally {
    await admin.end();
    await fs.rm(temporary, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
