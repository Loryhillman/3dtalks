const RoomEnvelope = require('../../public/js/roomEnvelope');
const RoomEnvironment = require('../../public/js/roomEnvironment');
const fs = require('node:fs/promises');
const path = require('node:path');
const { validLayout, modelPath, transform } = require('./roomTemplateLayout');
const { roomSeatPose } = require('./roomSeatPose');
const KEY = /^[a-z][a-z0-9-]{1,79}$/;
function fail(code, message, status = 409) { throw Object.assign(new Error(message), { code, status }); }
const publicDir = path.resolve(__dirname, '../../public');

function publicationErrors(layout, key) {
  const errors = [];
  if (!validLayout(layout)) return ['Неверные параметры предметов или мест'];
  if (!layout.some(i => i.kind === 'room' && ['geometry_building','room_shell','room_environment'].includes(i.type || 'geometry_building'))) {
    errors.push('Сохраните геометрию помещения: пол, стены и потолок');
  }
  const poses = [];
  const shell = layout.find(i=>i.type==='room_shell');
  const imported = layout.find(i => i.type === 'room_environment');
  const contains = shell ? point => RoomEnvelope.contains(point, shell) : imported ? point => RoomEnvironment.contains(point, imported.environment, imported) : null;
  if(contains) for(const item of layout) if(item.kind !== 'room' && item.type !== 'seat' && !contains(item.position)) errors.push('Предмет находится за пределами помещения: '+item.name);
  for (const item of layout) {
    const t = transform(item), object = {};
    for (const prefix of ['position', 'rotation', 'scale']) for (const a of ['x', 'y', 'z']) object[prefix + '_' + a] = t[prefix][a];
    for (const seat of item.seats || []) if (seat.enabled) {
      try {
        const { position } = roomSeatPose(seat, object);
        if (poses.some(p => Math.hypot(p.x - position.x, p.y - position.y, p.z - position.z) < .2)) {
          errors.push('Слишком близко расположены места: ' + seat.label);
        }
        if(contains && !contains(position)) errors.push('Посадка находится за пределами помещения: '+seat.label);
        poses.push(position);
      } catch (_) { errors.push('Некорректное положение места: ' + seat.label); }
    }
  }
  if (poses.length < (key === 'meeting-six' ? 6 : 1)) errors.push('Для этого шаблона нужно минимум ' + (key === 'meeting-six' ? 6 : 1) + ' доступных мест');
  return errors;
}

function normalizeDraft(draft) {
  for (const item of draft.layout) for (const seat of item.seats || []) if (seat.coordinate_space !== 'rigid') {
    seat.local_position = Object.fromEntries(['x','y','z'].map(a => [a, seat.local_position[a] * (item.scale?.[a] ?? 1)]));
    seat.coordinate_space = 'rigid';
  }
  draft.layout=draft.layout.map(item=>RoomEnvelope.fromLegacy(item)||item);
  return draft;
}
function createRoomTemplateEditor(pool, stat = fs.stat, { readFile = fs.readFile } = {}) {
  async function transaction(key, operation) {
    if (!KEY.test(key || '')) fail('INVALID_TEMPLATE_KEY', 'Неверный шаблон', 400);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT pg_advisory_xact_lock(hashtext('room-template-editor'), hashtext($1))", [key]);
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  async function models(client, layout, checkFiles = false) {
    const modelItems = layout.filter(i => ['uploaded_model','room_environment'].includes(i.type));
    const ids = [...new Set(modelItems.map(i => i.model_id))].sort((a, b) => a - b);
    for(const item of layout.filter(i=>i.type==='room_shell')) {
      if(!RoomEnvelope.valid(item.envelope))fail('INVALID_ROOM_ENVELOPE','Проверьте размеры и оформление помещения',400);
      if(checkFiles) for(const surface of Object.values(item.envelope.surfaces)) if(surface.mode!=='color') {
        try {const file=await stat(path.join(publicDir,surface.image));if(!file.isFile()||!file.size)throw new Error('missing');}
        catch(_){fail('SURFACE_FILE_MISSING','Не найден файл оформления поверхности',422);}
      }
    }
    if (!ids.length) return [];
    if (ids.some(id => !Number.isSafeInteger(id) || id < 1)) fail('INVALID_MODEL', 'Выберите модель из библиотеки', 400);
    const rows = (await client.query('SELECT id, path, file_type FROM uploaded_models WHERE id=ANY($1::int[]) ORDER BY id FOR SHARE', [ids])).rows;
    if (rows.length !== ids.length) fail('MODEL_NOT_FOUND', 'Одна из моделей удалена из библиотеки', 422);
    for (const item of modelItems) {
      const row = rows.find(r => r.id === item.model_id);
      if (row.file_type?.toLowerCase() !== 'glb' || !modelPath(row.path)) fail('INVALID_MODEL', 'Редактор поддерживает GLB из библиотеки', 422);
      // A draft may submit an arbitrary URL; only the library path is authoritative.
      item.model_path = row.path;
      if (checkFiles) {
        const absolute = path.join(publicDir, row.path);
        try {
          const file = await stat(absolute);
          if (!file.isFile() || file.size < 12) throw new Error('Empty model');
          if (item.type === 'room_environment' && file.size > 100 * 1024 * 1024) fail('ENVIRONMENT_FILE_TOO_LARGE','Файл помещения превышает 100 МБ',422);
        } catch (error) { if (error.status) throw error; fail('MODEL_FILE_MISSING', 'Не найден файл модели: ' + item.name, 422); }
        if (item.type === 'room_environment') {
          try { await require('./roomEnvironmentAsset').inspect(await readFile(absolute)); }
          catch (error) { fail(error.code || 'INVALID_ENVIRONMENT_GLB', 'Модель помещения не подходит: ' + item.name + ' (' + (error.code || 'INVALID_ENVIRONMENT_GLB') + ')', 422); }
        }
      }
    }
    return ids;
  }
  async function refs(client, key, ids) {
    await client.query('DELETE FROM room_template_draft_model_refs WHERE template_key=$1', [key]);
    for (const id of ids) await client.query('INSERT INTO room_template_draft_model_refs(template_key,model_id) VALUES ($1,$2)', [key,id]);
  }
  function payload(body) {
    if (!body || !Number.isInteger(body.revision) || body.revision < 1 || typeof body.name !== 'string' ||
        !body.name.trim() || body.name.trim().length > 120 || !Array.isArray(body.layout) ||
        body.layout.length < 1 || body.layout.length > 100 || JSON.stringify(body.layout).length > 500000) {
      fail('INVALID_TEMPLATE', 'Проверьте название и состав шаблона', 400);
    }
    if (body.layout.some(i => !i || !Number.isSafeInteger(i.editor_id) || i.editor_id < 1) ||
        new Set(body.layout.map(i => i.editor_id)).size !== body.layout.length) fail('INVALID_TEMPLATE', 'Повторяются идентификаторы предметов', 400);
  }
  async function getDraft(key, adminId) {
    return transaction(key, async client => {
      let draft = (await client.query('SELECT * FROM room_template_drafts WHERE template_key=$1 FOR UPDATE', [key])).rows[0];
      if (draft) return normalizeDraft(draft);
      const template = (await client.query('SELECT * FROM room_templates WHERE template_key=$1 ORDER BY version DESC LIMIT 1', [key])).rows[0];
      if (!template) fail('TEMPLATE_NOT_FOUND', 'Шаблон не найден', 404);
      const layout = template.layout.map((item, i) => ({ ...item, editor_id: i + 1 }));
      const ids = await models(client, layout);
      draft = (await client.query(`INSERT INTO room_template_drafts(template_key,name,layout,base_version,updated_by)
        VALUES ($1,$2,$3::jsonb,$4,$5) RETURNING *`, [key,template.name,JSON.stringify(layout),template.version,adminId])).rows[0];
      await refs(client, key, ids);
      return normalizeDraft(draft);
    });
  }
  async function save(key, body, adminId) {
    payload(body);
    return transaction(key, async client => {
      const draft = (await client.query('SELECT * FROM room_template_drafts WHERE template_key=$1 FOR UPDATE', [key])).rows[0];
      if (!draft || draft.revision !== body.revision) fail('TEMPLATE_CHANGED', 'Черновик изменён в другой вкладке. Обновите страницу перед сохранением');
      const layout = JSON.parse(JSON.stringify(body.layout));
      const ids = await models(client, layout);
      if (!validLayout(layout)) fail('INVALID_TEMPLATE', 'Проверьте размеры, координаты и уникальные названия мест', 400);
      const updated = (await client.query(`UPDATE room_template_drafts SET name=$2,layout=$3::jsonb,
        revision=revision+1,updated_by=$4,updated_at=now() WHERE template_key=$1 RETURNING *`,
      [key,body.name.trim(),JSON.stringify(layout),adminId])).rows[0];
      await refs(client, key, ids);
      return updated;
    });
  }
  async function publish(key, revision) {
    if (!Number.isInteger(revision) || revision < 1) fail('INVALID_REVISION', 'Не указана версия черновика', 400);
    return transaction(key, async client => {
      const draft = (await client.query('SELECT * FROM room_template_drafts WHERE template_key=$1 FOR UPDATE', [key])).rows[0];
      if (!draft || draft.revision !== revision) fail('TEMPLATE_CHANGED', 'Черновик изменился. Обновите страницу перед публикацией');
      if (draft.published_revision === revision) return { draft, version: draft.base_version, reused: true };
      const latest = (await client.query('SELECT version FROM room_templates WHERE template_key=$1 ORDER BY version DESC LIMIT 1', [key])).rows[0];
      if (!latest || latest.version !== draft.base_version) fail('TEMPLATE_CHANGED', 'У шаблона уже есть более новая опубликованная версия');
      const layout = JSON.parse(JSON.stringify(draft.layout));
      const ids = await models(client, layout, true);
      const errors = publicationErrors(layout, key);
      if (errors.length) fail('INVALID_TEMPLATE', errors.join('; '), 422);
      // Seat IDs must be allocated afresh for each created room.
      for (const item of layout) {
        delete item.editor_id;
        item.seats = (item.seats || []).map(({ id, object_id, room_id, ...seat }) => seat);
      }
      const version = latest.version + 1;
      const template = (await client.query(`INSERT INTO room_templates(template_key,version,name,layout)
        VALUES ($1,$2,$3,$4::jsonb) RETURNING id`, [key,version,draft.name,JSON.stringify(layout)])).rows[0];
      for (const id of ids) await client.query('INSERT INTO room_template_model_refs(template_id,model_id) VALUES ($1,$2)', [template.id,id]);
      const updated = (await client.query(`UPDATE room_template_drafts SET base_version=$2,published_revision=revision
        WHERE template_key=$1 RETURNING *`, [key,version])).rows[0];
      return { draft: updated, version, reused: false };
    });
  }
  return { getDraft, save, publish };
}
module.exports = { createRoomTemplateEditor, publicationErrors };
