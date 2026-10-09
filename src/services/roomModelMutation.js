/** Serialize model replacement against template refs and new room object references. */
async function withMutableRoomModel(pool, id, operation, { includeGlobalObjects = false } = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const model = (await client.query('SELECT * FROM uploaded_models WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!model) throw Object.assign(new Error('Model not found'), { status: 404, errorKey: 'uploadedModelsApi.notFound' });
    const used = await client.query(`SELECT 1 WHERE
      EXISTS (SELECT 1 FROM room_template_model_refs WHERE model_id=$1) OR
      EXISTS (SELECT 1 FROM room_template_draft_model_refs WHERE model_id=$1) OR
      EXISTS (SELECT 1 FROM world_objects WHERE ($3 OR room_id IS NOT NULL) AND model_path=$2)`, [id, model.path, includeGlobalObjects]);
    if (used.rows.length) throw Object.assign(new Error('Model is used by a room or template'), { status: 409, errorKey: 'uploadedModelsApi.inUse' });
    const result = await operation(client, model);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
module.exports = { withMutableRoomModel };
