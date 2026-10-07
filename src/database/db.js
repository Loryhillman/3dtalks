/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
const { Pool } = require('pg');
const path = require('path');
const fs = require('fs').promises;
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'virtual_world',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'password',
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
});
let initialized = false;

async function initializeDatabase() {
  // Initialize the base schema.
  try {
    // Use database/init.sql as the canonical base schema.
    // Resolve the schema path relative to this module.
    const initPath = path.join(__dirname, '..', '..', 'database', 'init.sql');
    const initSQL = await fs.readFile(initPath, 'utf-8');

    await pool.query(initSQL);
    console.log('Database initialized from database/init.sql');
  } catch (error) {
    console.error('Database initialization error:', error);
    if (process.env.ROOMS_ENABLED === 'true') throw error;
  }

  // Apply migrations after the base schema initialization.
  const migrations = [
    // 'add_ui_controls_alignment.sql',  // Disabled: rerunning would overwrite user h_align/v_align settings.
    'gallery_init.sql',
    'migrations/add_ad_slot_portal_fields.sql',
    'add_security_questions.sql',
    'add_login_attempts.sql',
    'migrations/add_system_config.sql',
    'migrations/add_default_language.sql',
    'migrations/add_ui_control_layout.sql',
    'migrations/add_user_subscriptions.sql',
    'migrations/add_payment_reference.sql',
    'migrations/add_world_id_to_subscriptions.sql',
    'migrations/fix_subscription_user_id.sql',
    'migrations/add_has_collision.sql',
    'add_threejs_code_blocks.sql',
    'migrations/add_federation_trust_approval.sql',
    'migrations/add_custom_config.sql',
    'migrations/add_spatial_paging_indexes.sql',
    'migrations/add_world_objects_is_locked.sql',
    'migrations/add_agents.sql',
    'migrations/add_agent_sessions.sql',
    'migrations/add_world_chat_log.sql',
    'migrations/add_federation_nonce.sql',  // P5: federation nonce replay protection and transient sessions.
    'migrations/add_agent_push_tier.sql',   // P8: per-key agent push tiers and deletion support.
    'migrations/add_world_objects_agent_description.sql',  // AI object descriptions exposed through agent observation.
    'migrations/add_rooms.sql',
    'migrations/add_room_rejoin_grants.sql',
    'migrations/add_room_seats.sql',
    'migrations/add_user_rooms.sql',
    'migrations/add_account_room_character.sql',
    'migrations/add_room_template_editor.sql',
    'migrations/add_independent_room_seats.sql'
  ];
  for (const migFile of migrations) {
    const migrationPath = path.join(__dirname, '..', '..', 'database', migFile);
    try {
      const migrationSQL = await fs.readFile(migrationPath, 'utf-8');
      await pool.query(migrationSQL);
      console.log('Migration applied:', migFile);
    } catch (migErr) {
      if (migFile === 'migrations/add_default_language.sql' ||
          migFile === 'migrations/add_ui_control_layout.sql' ||
          migFile === 'migrations/add_rooms.sql' ||
          migFile === 'migrations/add_room_rejoin_grants.sql' ||
          migFile === 'migrations/add_room_seats.sql' ||
          migFile === 'migrations/add_user_rooms.sql' ||
          migFile === 'migrations/add_account_room_character.sql' ||
          migFile === 'migrations/add_room_template_editor.sql' ||
          migFile === 'migrations/add_independent_room_seats.sql') throw migErr;
      console.log('Migration skipped (already applied, missing file or schema mismatch):', migFile, migErr.message);
    }
  }
  await require('../services/roomTemplateSeed').ensureRoomTemplates(pool);
  await require('../services/bootstrapAdmin').ensureBootstrapAdmin(pool);
  initialized = true;
}

async function query(text, params) {
  try {
    const result = await pool.query(text, params);
    return result;
  } catch (error) {
    console.error('Database query error:', error);
    throw error;
  }
}

module.exports = {
  query,
  pool,
  initializeDatabase,
  isDatabaseInitialized: () => initialized,
};
