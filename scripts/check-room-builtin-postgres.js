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
        'add_room_template_editor.sql', 'add_independent_room_seats.sql', 'add_room_environment.sql', 'add_room_avatar_scale.sql',
        'add_room_builtin_bundles.sql', 'add_room_builtin_bundles.sql',
        'add_room_presentation_screen.sql', 'add_room_presentation_screen.sql']) {
        await pool.query(await fs.readFile(path.resolve(__dirname, '../database/migrations', file), 'utf8'));
      }
      await ensureRoomTemplates(pool);
      await operation(pool, { publicDir, directory: source });
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
      await assert.rejects(pool.query('DELETE FROM uploaded_models'), error => ['23503','23001'].includes(error.code));
      const file = path.join(options.publicDir, template.layout[1].model_path);
      await fs.unlink(file);
      assert.equal((await ensureBuiltinMeeting(pool, {publicDir:options.publicDir})).status, 'present');
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
      // New startup restores an installed predecessor without installing v2.
      assert.equal((await ensureBuiltinMeeting(pool,{publicDir:options.publicDir})).templateId,template.id);
      assert.deepEqual((await pool.query('SELECT bundle_key FROM room_builtin_bundles')).rows,[{bundle_key:'meeting-six-v1'}]);
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

      // A new publication receives its own screen snapshot; old rooms stay intact.
      draft=await editor.getDraft('meeting-six',1);
      const screen=require('../public/js/roomScreen').create();
      // Pick the tested interior center of this bundled GLB, rather than a global origin.
      const environment=draft.layout.find(i=>i.type==='room_environment');
      const bounds=environment.environment.bounds;
      screen.position=require('../public/js/roomEnvironment').toWorld({x:(bounds.min.x+bounds.max.x)/2,y:(bounds.min.y+bounds.max.y)/2,z:(bounds.min.z+bounds.max.z)/2},environment);
      screen.editor_id=Math.max(...draft.layout.map(i=>i.editor_id))+1;
      draft.layout.push(screen);draft=await editor.save('meeting-six',draft,1);
      assert.equal((await editor.publish('meeting-six',draft.revision)).version,6);
      const third=(await rooms.create(owner,{name:'Screen meeting',capacity:6,request_key:randomUUID()})).room;
      const stored=(await pool.query("SELECT * FROM world_objects WHERE room_id=$1 AND type='presentation_screen'",[third.id])).rows[0];
      assert.deepEqual(stored.presentation_screen,screen.screen);assert.equal(stored.model_path,null);
      assert.equal((await validateRoom(third.id,pool,stat)).ok,true);
      assert.deepEqual((await pool.query('SELECT * FROM world_objects WHERE room_id=$1 ORDER BY id',[first.id])).rows,snapshot);
      for(const update of ["scale_x=2","has_collision=true","rotation_x=1","model_path='/bad.glb'", "presentation_screen=NULL", "presentation_screen='{}'", "presentation_screen='[]'", "presentation_screen='{\"version\":1,\"width\":9,\"height\":1}'"]){
        await assert.rejects(pool.query('UPDATE world_objects SET '+update+' WHERE id=$1',[stored.id]),e=>e.code==='23514');
      }
      await assert.rejects(pool.query(`INSERT INTO world_objects(room_id,type,name,has_collision,presentation_screen)
        VALUES ($1,'presentation_screen','Second',false,$2::jsonb)`,[third.id,JSON.stringify(screen.screen)]),e=>e.code==='23505');
      await assert.rejects(pool.query('UPDATE room_seats SET object_id=$1 WHERE room_id=$2',[stored.id,third.id]),e=>e.code==='23514');
      await pool.query("UPDATE rooms SET status='draft' WHERE id=$1",[third.id]);
      for(const operation of ['copy','delete'])await assert.rejects(require('../src/services/roomObjectSeats').createRoomObjectSeats(pool).mutate(third.id,stored.id,operation),/USE_TEMPLATE_SCREEN_SETTINGS/);

      const changedSource = path.join(temporary, 'changed-source');
      await fs.cp(source, changedSource, { recursive: true });
      const manifest = JSON.parse(await fs.readFile(path.join(changedSource, 'manifest.json')));
      manifest.name = 'Changed without a version';
      await fs.writeFile(path.join(changedSource, 'manifest.json'), JSON.stringify(manifest));
      await assert.rejects(ensureBuiltinMeeting(pool, { ...options, directory: changedSource }), /without a new version/);
      await fs.writeFile(path.join(changedSource, 'office.glb'), 'broken source');
      await assert.rejects(readBundle(changedSource), /checksum mismatch/);
    });
    await scenario('fresh-v2-and-restart',async(pool,{publicDir})=>{
      const directory=path.resolve(__dirname,'../database/seeds/meeting-six-v2');
      const bundle=await readBundle(directory);assert.equal(bundle.manifest.bundle,'meeting-six-v2');
      const predecessor=await readBundle(source);
      assert.deepEqual(bundle.assets.map(a=>a.runtimePath),predecessor.assets.map(a=>a.runtimePath));
      assert.deepEqual(bundle.layout.slice(0,-1),predecessor.layout,'the screen must not move furniture or seats');
      const results=await Promise.all([ensureBuiltinMeeting(pool,{publicDir,directory}),ensureBuiltinMeeting(pool,{publicDir,directory})]);
      assert.deepEqual(results.map(r=>r.status).sort(),['installed','present']);
      const template=(await pool.query('SELECT * FROM room_templates ORDER BY version DESC LIMIT 1')).rows[0];
      assert.equal(template.version,4);assert.equal(template.layout.length,9);
      assert.equal(template.layout.filter(i=>i.type==='presentation_screen').length,1);
      assert.equal(template.layout.flatMap(i=>i.seats||[]).length,6);
      assert.equal((await pool.query('SELECT * FROM uploaded_models')).rows.length,3);
      assert.equal((await fs.readdir(path.join(publicDir,'models/uploaded'))).length,3);
      const file=path.join(publicDir,bundle.assets[0].runtimePath);
      await fs.unlink(file);await ensureBuiltinMeeting(pool,{publicDir});
      assert.equal((await fs.stat(file)).size,bundle.assets[0].bytes);
      const screen=template.layout.find(i=>i.type==='presentation_screen');assert.equal(screen.model_id,undefined);assert.equal(screen.model_path,undefined);
      const stat=absolute=>fs.stat(path.join(publicDir,path.relative(realPublic,absolute)));
      const owner=randomUUID();await pool.query('INSERT INTO users VALUES($1)',[owner]);
      const rooms=createUserRoomService(pool,(id,db)=>validateRoom(id,db,stat));
      const first=(await rooms.create(owner,{name:'New default',capacity:6,request_key:randomUUID()})).room;
      const snapshot=(await pool.query('SELECT * FROM world_objects WHERE room_id=$1 ORDER BY id',[first.id])).rows;
      assert.equal(snapshot.length,9);assert.equal((await validateRoom(first.id,pool,stat)).ok,true);
      assert.deepEqual(snapshot.find(i=>i.type==='presentation_screen').presentation_screen,screen.screen);
      await ensureBuiltinMeeting(pool,{publicDir});
      assert.deepEqual((await pool.query('SELECT * FROM world_objects WHERE room_id=$1 ORDER BY id',[first.id])).rows,snapshot);
      assert.equal((await pool.query('SELECT count(*)::int n FROM room_templates')).rows[0].n,4);
      const second=(await rooms.create(owner,{name:'Second default',capacity:6,request_key:randomUUID()})).room;
      assert.equal((await pool.query('SELECT count(*)::int n FROM room_seats WHERE room_id=$1',[second.id])).rows[0].n,6);
      const changedSource=path.join(temporary,'changed-v2');await fs.mkdir(changedSource);
      const manifest=JSON.parse(await fs.readFile(path.join(__dirname,'../database/seeds/meeting-six-v2/manifest.json')));
      manifest.assets[0].fromBundle='../../untrusted';await fs.writeFile(path.join(changedSource,'manifest.json'),JSON.stringify(manifest));
      await assert.rejects(readBundle(changedSource),/Invalid built-in asset reference/);
      manifest.assets[0].fromBundle='meeting-six-v1';manifest.name='Changed without version';
      await fs.writeFile(path.join(changedSource,'manifest.json'),JSON.stringify(manifest));
      await assert.rejects(ensureBuiltinMeeting(pool,{publicDir,directory:changedSource}),/without a new version/);
    });
    await scenario('fresh-v3-approved-calibration',async(pool,{publicDir})=>{
      const bundle=await readBundle();assert.equal(bundle.manifest.bundle,'meeting-six-v3');assert.equal(bundle.manifest.avatarScale,1.25);
      const invalidDirectory=path.join(temporary,'invalid-v3');await fs.mkdir(invalidDirectory);
      const invalidManifest={...bundle.manifest};delete invalidManifest.avatarScale;
      await fs.writeFile(path.join(invalidDirectory,'manifest.json'),JSON.stringify(invalidManifest));
      await assert.rejects(readBundle(invalidDirectory),/Invalid built-in meeting manifest/);
      const predecessor=await readBundle(source);
      assert.deepEqual(bundle.assets.map(a=>a.runtimePath),predecessor.assets.map(a=>a.runtimePath),'no duplicate GLBs');
      const results=await Promise.all([ensureBuiltinMeeting(pool,{publicDir}),ensureBuiltinMeeting(pool,{publicDir})]);
      assert.deepEqual(results.map(r=>r.status).sort(),['installed','present']);
      const template=(await pool.query('SELECT * FROM room_templates ORDER BY version DESC LIMIT 1')).rows[0];
      assert.equal(template.avatar_scale,1.25);assert.equal(template.layout.length,9);
      assert.deepEqual(template.layout.flatMap(i=>i.seats||[]),bundle.layout.flatMap(i=>i.seats||[]));
      const stat=absolute=>fs.stat(path.join(publicDir,path.relative(realPublic,absolute)));
      const owner=randomUUID();await pool.query('INSERT INTO users VALUES($1)',[owner]);
      const rooms=createUserRoomService(pool,(id,db)=>validateRoom(id,db,stat));
      const first=(await rooms.create(owner,{name:'Approved default',capacity:6,request_key:randomUUID()})).room;
      assert.equal(first.avatar_scale,1.25);assert.equal((await validateRoom(first.id,pool,stat)).ok,true);
      const snapshot=(await pool.query('SELECT * FROM room_seats WHERE room_id=$1 ORDER BY label',[first.id])).rows;
      await ensureBuiltinMeeting(pool,{publicDir});
      assert.deepEqual((await pool.query('SELECT * FROM room_seats WHERE room_id=$1 ORDER BY label',[first.id])).rows,snapshot);
      assert.equal((await pool.query('SELECT count(*)::int n FROM uploaded_models')).rows[0].n,3);
      assert.deepEqual((await pool.query('SELECT bundle_key FROM room_builtin_bundles')).rows,[{bundle_key:'meeting-six-v3'}]);
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
      assert.equal((await ensureBuiltinMeeting(pool, {publicDir:options.publicDir})).status, 'preserved');
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
