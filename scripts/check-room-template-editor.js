// Uses a separate schema and deletes it in finally. Never publishes to public.room_templates.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const { createRoomTemplateEditor } = require('../src/services/roomTemplateEditor');
const { createUserRoomService } = require('../src/services/userRooms');
const { validateRoom } = require('../src/services/roomValidation');

async function main() {
  if (!process.env.ROOM_TEST_DATABASE_URL) throw new Error('Set ROOM_TEST_DATABASE_URL explicitly');
  const config = { connectionString: process.env.ROOM_TEST_DATABASE_URL, statement_timeout: 15000 };
  const admin = new Pool(config), schema = 'template_test_' + randomUUID().replaceAll('-', '');
  let pool;
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ ...config, options: `-c search_path=${schema},pg_catalog` });
    await pool.query(`CREATE TABLE users (id uuid PRIMARY KEY);
      CREATE TABLE admin_users (id integer PRIMARY KEY);
      CREATE TABLE characters (id uuid PRIMARY KEY, name text);
      CREATE TABLE uploaded_models (id integer PRIMARY KEY, path text, file_type text);
      CREATE TABLE geometry_buildings (id serial PRIMARY KEY, user_id integer,
        name text,template_id text,geometry_data jsonb,created_at timestamptz);
      CREATE TABLE world_objects (id serial PRIMARY KEY,type text,name text,model_path text,model_type text,
        position_x float DEFAULT 0,position_y float DEFAULT 0,position_z float DEFAULT 0,
        rotation_x float DEFAULT 0,rotation_y float DEFAULT 0,rotation_z float DEFAULT 0,
        scale_x float DEFAULT 1,scale_y float DEFAULT 1,scale_z float DEFAULT 1,has_collision boolean,
        created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());`);
    for (const file of ['add_rooms.sql','add_room_seats.sql','add_user_rooms.sql','add_room_template_editor.sql','add_room_template_editor.sql','add_independent_room_seats.sql','add_independent_room_seats.sql','add_room_environment.sql','add_room_environment.sql']) {
      await pool.query(readFileSync(path.join(__dirname, '../database/migrations', file), 'utf8'));
    }
    await pool.query("INSERT INTO admin_users VALUES (1); INSERT INTO uploaded_models VALUES (1,'/models/uploaded/check.glb','glb')");
    const owner = randomUUID(); await pool.query('INSERT INTO users VALUES ($1)', [owner]);
    await require('../src/services/roomTemplateSeed').ensureRoomTemplates(pool);
    const stat = async () => ({ isFile: () => true, size: 64 });
    const service = createRoomTemplateEditor(pool, stat);
    const rooms = createUserRoomService(pool, (id, db) => validateRoom(id, db, stat));
    const createRoom = () => rooms.create(owner, { name: 'Fixture', capacity: 6, request_key: randomUUID() });
    const before = (await createRoom()).room;
    const beforeObjects = (await pool.query('SELECT * FROM world_objects WHERE room_id=$1 ORDER BY id', [before.id])).rows;
    const [a,b] = await Promise.all([service.getDraft('meeting-six', 1), service.getDraft('meeting-six', 1)]);
    assert.equal(a.revision, b.revision);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM room_template_drafts')).rows[0].n, 1);
    const unsupported = JSON.parse(JSON.stringify(a));
    unsupported.layout.find(i=>i.kind==='chair').components = [{ type: 'unsupported' }];
    await assert.rejects(service.save('meeting-six', unsupported, 1), { code:'INVALID_TEMPLATE' });
    const chair = a.layout.find(i => i.kind === 'chair');
    const seat = JSON.parse(JSON.stringify(chair.seats));
    Object.assign(chair, { type:'uploaded_model',model_id:1,model_path:'https://untrusted.invalid/x.glb',
      rotation:{x:.1,y:.2,z:.3},scale:{x:1.1,y:1.2,z:1.3} });
    delete chair.components;
    let draft = await service.save('meeting-six', a, 1);
    assert.equal(draft.layout.find(i => i.model_id === 1).model_path, '/models/uploaded/check.glb');
    assert.deepEqual(draft.layout.find(i => i.model_id === 1).seats, seat);
    await assert.rejects(service.save('meeting-six', b, 1), { code:'TEMPLATE_CHANGED' });
    const races = await Promise.allSettled([service.save('meeting-six', draft, 1),service.save('meeting-six', draft, 1)]);
    assert.equal(races.filter(r => r.status==='fulfilled').length, 1);
    draft = races.find(r => r.status==='fulfilled').value;
    assert.equal(races.find(r => r.status==='rejected').reason.code, 'TEMPLATE_CHANGED');
    await assert.rejects(pool.query('DELETE FROM uploaded_models WHERE id=1'), e => ['23503','23001'].includes(e.code));

    const invalid = JSON.parse(JSON.stringify(draft));
    invalid.layout.find(i => i.kind==='chair').seats = [];
    let bad = await service.save('meeting-six', invalid, 1);
    await assert.rejects(service.publish('meeting-six', bad.revision), { code:'INVALID_TEMPLATE' });
    draft.revision = bad.revision; draft = await service.save('meeting-six', draft, 1);
    const missing = createRoomTemplateEditor(pool, async () => { throw new Error('missing'); });
    await assert.rejects(missing.publish('meeting-six', draft.revision), { code:'MODEL_FILE_MISSING' });
    assert.equal((await pool.query('SELECT max(version) AS v FROM room_templates')).rows[0].v, 3);
    const published = await Promise.all([service.publish('meeting-six', draft.revision), service.publish('meeting-six', draft.revision)]);
    assert(published.every(p => p.version===4));
    assert.equal(published.filter(p => p.reused).length, 1);
    const envelopeSnapshot=(await pool.query("SELECT layout FROM room_templates WHERE template_key='meeting-six' AND version=4")).rows[0].layout.find(i=>i.type==='room_shell');
    assert(envelopeSnapshot);assert.equal(envelopeSnapshot.envelope.width,23.8);
    const after = (await createRoom()).room;
    assert.equal(after.template_version, 4);
    const object = (await pool.query("SELECT * FROM world_objects WHERE room_id=$1 AND type='uploaded_model'", [after.id])).rows[0];
    assert.equal(object.model_path, '/models/uploaded/check.glb');
    assert.equal(object.rotation_x,.1); assert.equal(object.rotation_z,.3);
    assert.equal(object.scale_y,1.2);
    const afterSeat = (await pool.query('SELECT * FROM room_seats WHERE object_id=$1', [object.id])).rows[0];
    assert.deepEqual(afterSeat.local_position, seat[0].local_position);
    assert.deepEqual((await pool.query('SELECT * FROM world_objects WHERE room_id=$1 ORDER BY id', [before.id])).rows, beforeObjects);
    const third = (await createRoom()).room;
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM room_seats WHERE room_id=$1', [third.id])).rows[0].n, 6);
    assert.equal((await pool.query('SELECT count(DISTINCT id)::int AS n FROM room_seats')).rows[0].n, 18);
    const {roomSeatPose}=require('../src/services/roomSeatPose');
    const {createRoomObjectSeats}=require('../src/services/roomObjectSeats');
    const samePose=(a,b)=>{ for(const k of ['position','orientation'])for(const axis of Object.keys(a[k]))assert(Math.abs(a[k][axis]-b[k][axis])<1e-8); };
    // Simulate an old scaled seat and run the conversion twice.
    await pool.query("UPDATE room_seats SET coordinate_space='legacy' WHERE id=$1",[afterSeat.id]);
    const legacyPose=roomSeatPose({...afterSeat,coordinate_space:'legacy'},object);
    const migration=readFileSync(path.join(__dirname,'../database/migrations/add_independent_room_seats.sql'),'utf8');
    await pool.query(migration);await pool.query(migration);
    const converted=(await pool.query('SELECT * FROM room_seats WHERE id=$1',[afterSeat.id])).rows[0];
    samePose(legacyPose,roomSeatPose(converted,object));
    samePose(legacyPose,roomSeatPose(converted,{...object,scale_x:99,scale_y:.01,scale_z:13}));
    // Copy attachments with fresh IDs; remove furniture without moving its seats.
    const operations=createRoomObjectSeats(pool);
    await assert.rejects(operations.mutate(after.id,object.id,'copy'),{message:'ROOM_CHANGED_OR_ACTIVE'});
    await pool.query("UPDATE rooms SET status='draft' WHERE id=$1",[after.id]);
    const copied=await operations.mutate(after.id,object.id,'copy');
    const copiedSeats=(await pool.query('SELECT * FROM room_seats WHERE object_id=$1',[copied.object.id])).rows;
    assert.equal(copiedSeats.length,1);assert.notEqual(copiedSeats[0].id,converted.id);assert.notEqual(copiedSeats[0].label,converted.label);
    assert.equal((await pool.query('SELECT count(*)::int n FROM room_seat_claims')).rows[0].n,0);
    await assert.rejects(operations.mutate(after.id,object.id,'delete'),{message:'CHOOSE_ATTACHED_SEATS_ACTION'});
    await operations.mutate(after.id,object.id,'delete','keep');
    const detached=(await pool.query('SELECT * FROM room_seats WHERE id=$1',[converted.id])).rows[0];
    assert.equal(detached.object_id,null);samePose(legacyPose,roomSeatPose(detached));
    await operations.mutate(after.id,copied.object.id,'delete','delete');
    assert.equal((await pool.query('SELECT * FROM room_seats WHERE id=$1',[copiedSeats[0].id])).rows.length,0);
    // A standalone seat survives draft -> publication -> a new room without a fake object.
    const freeDraft=await service.getDraft('meeting-six',1);
    freeDraft.layout.push({editor_id:100,type:'seat',kind:'seat',name:'Independent seats',collision:false,
      position:{x:0,y:0,z:0},rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1},seats:[{
        coordinate_space:'rigid',label:'Independent',sort_order:99,enabled:true,map_x:4,map_y:4,
        local_position:{x:4,y:1,z:4},local_rotation:{x:0,y:.4,z:0}}]});
    const freeSaved=await service.save('meeting-six',freeDraft,1);await service.publish('meeting-six',freeSaved.revision);
    const fourth=(await createRoom()).room;
    const independent=(await pool.query('SELECT * FROM room_seats WHERE room_id=$1 AND object_id IS NULL',[fourth.id])).rows;
    assert.equal(independent.length,1);assert.equal(independent[0].local_position.x,4);
    assert.equal((await pool.query('SELECT count(*)::int n FROM world_objects WHERE room_id=$1',[fourth.id])).rows[0].n,8);
    const snapshot=await require('../src/services/roomSeats').createRoomSeatService(pool).list(fourth.id);
    const freeSnapshot=snapshot.find(s=>s.object_id===null);
    assert.deepEqual(freeSnapshot.position,{x:4,y:1,z:4});
    assert(snapshot.every(s=>s.position && !Object.hasOwn(s,'seat_object') && s.room_id===fourth.id));
    console.log('Independent seats: repeat migration, preserved poses, scale independence, copy IDs, detach/delete policies and published standalone seats: OK');
    // Modify only a draft room's shell; existing rooms retain their own geometry snapshots.
    const handlers={};require('../src/routes/adminRoomEnvelope').registerRoomEnvelopeRoutes({patch:(key,fn)=>handlers[key]=fn},pool,async()=>{});
    const mutateEnvelope=async(id,body)=>{const response={statusCode:200,status(n){this.statusCode=n;return this;},json(body){this.body=body;return this;}};
      await handlers['/:id/envelope']({params:{id},body,adminUser:{id:1},ip:'127.0.0.1'},response);return response;};
    const nextEnvelope=structuredClone(envelopeSnapshot.envelope);nextEnvelope.width=30;nextEnvelope.surfaces.floor.color='#123456';
    const beforeFourth=(await require('../src/services/roomObjects').listRoomObjects(fourth.id,pool)).find(o=>o.is_room_shell);
    assert.equal((await mutateEnvelope(fourth.id,{revision:fourth.revision,envelope:nextEnvelope})).statusCode,409);
    const draftRoom=(await pool.query("UPDATE rooms SET status='draft' WHERE id=$1 RETURNING *",[fourth.id])).rows[0];
    const edited=await mutateEnvelope(fourth.id,{revision:draftRoom.revision,envelope:nextEnvelope});assert.equal(edited.statusCode,200,JSON.stringify(edited.body));
    const changed=(await require('../src/services/roomObjects').listRoomObjects(fourth.id,pool)).find(o=>o.is_room_shell);
    assert.equal(changed.room_envelope.width,30);assert.equal(changed.geometry_data.components[0].surface.appearance.color,'#123456');
    assert.equal(changed.id,beforeFourth.id);assert.notEqual(changed.model_path,beforeFourth.model_path);
    assert.equal((await mutateEnvelope(fourth.id,{revision:draftRoom.revision,envelope:nextEnvelope})).statusCode,409);
    assert.equal((await require('../src/services/roomObjects').listRoomObjects(third.id,pool)).find(o=>o.is_room_shell).room_envelope.width,23.8);
    await assert.rejects(operations.mutate(fourth.id,changed.id,'copy'),{message:'USE_ROOM_ENVELOPE_SETTINGS'});
    console.log('Room envelope PostgreSQL: compiled snapshots, draft-only settings, revision conflicts and old-room isolation: OK');
    await pool.query('DELETE FROM room_template_draft_model_refs');
    await assert.rejects(pool.query('DELETE FROM uploaded_models WHERE id=1'), e => ['23503','23001'].includes(e.code));
    // New format exercises the actual SQL constraint and old-room isolation when explicitly run on a test DB.
    const beforeOffice = (await pool.query('SELECT * FROM world_objects WHERE room_id=$1 ORDER BY id',[before.id])).rows;
    const environmentDraft = await service.getDraft('meeting-six', 1);
    environmentDraft.layout = [{ editor_id: 1, type:'room_environment',kind:'room',name:'Office',collision:false,
      model_id:1,model_path:'/models/uploaded/check.glb',position:{x:0,y:0,z:0},rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1},
      environment:{version:1,bounds:{min:{x:-4,y:0,z:-3},max:{x:4,y:3,z:3}}}},
      {editor_id:2,type:'seat',kind:'seat',name:'Office seats',collision:false,
        position:{x:0,y:0,z:0},rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1},
        seats:Array.from({length:6},(_,index)=>({label:String(index+1),sort_order:index,enabled:true,
          coordinate_space:'rigid',map_x:index-2.5,map_y:0,local_position:{x:index-2.5,y:1,z:0},local_rotation:{x:0,y:0,z:0}}))}];
    const environmentService=createRoomTemplateEditor(pool,stat,{readFile:async()=>require('./room-environment-fixtures').officeGlb()});
    const environmentSaved=await environmentService.save('meeting-six',environmentDraft,1);
    await environmentService.publish('meeting-six',environmentSaved.revision);
    const officeRoom=(await createRoom()).room;
    const officeObjects=await require('../src/services/roomObjects').listRoomObjects(officeRoom.id,pool);
    assert.equal(officeObjects.length,1);assert.equal(officeObjects[0].type,'uploaded_model');
    assert.equal(officeObjects[0].is_room_environment,true);assert.equal(officeObjects[0].has_collision,false);
    assert.deepEqual(officeObjects[0].room_environment,environmentDraft.layout[0].environment);
    await assert.rejects(pool.query('UPDATE world_objects SET has_collision=true WHERE id=$1',[officeObjects[0].id]),e=>e.code==='23514');
    await assert.rejects(pool.query("UPDATE world_objects SET room_environment='{}'::jsonb WHERE id=$1",[officeObjects[0].id]),e=>e.code==='23514');
    const guarded=require('../src/services/roomModelMutation');
    let processed=false;
    await assert.rejects(guarded.withMutableRoomModel(pool,1,async()=>{processed=true;}),{status:409});assert.equal(processed,false);
    assert.deepEqual((await pool.query('SELECT * FROM world_objects WHERE room_id=$1 ORDER BY id',[before.id])).rows,beforeOffice);
    console.log('GLB office PostgreSQL: repeated additive migration, published refs, runtime metadata, constraint guards and old-room isolation: OK');
    console.log('PostgreSQL: isolated drafts, save/publish races, model protection, GLB transforms, seat cloning, old rooms preserved: OK');
  } finally {
    if (pool) await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  }
}
main().catch(error => { console.error(error); process.exitCode=1; });
