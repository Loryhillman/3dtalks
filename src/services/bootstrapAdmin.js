const bcrypt = require('bcryptjs');

// Create the first administrator once; later .env edits never reset credentials.
async function ensureBootstrapAdmin(pool, env = process.env) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(73422, 1)');
    const { rows } = await client.query('SELECT count(*)::int AS count FROM admin_users');
    if (rows[0].count > 0) {
      await client.query('COMMIT');
      return false;
    }
    const username = env.ADMIN_USERNAME?.trim();
    const password = env.ADMIN_PASSWORD;
    if (!username || username.length > 50) {
      throw new Error('Set ADMIN_USERNAME in .env (1–50 characters)');
    }
    if (!password || password.length < 12 || Buffer.byteLength(password, 'utf8') > 72) {
      throw new Error('Set ADMIN_PASSWORD in .env (at least 12 characters, at most 72 UTF-8 bytes)');
    }
    const hash = await bcrypt.hash(password, 12);
    await client.query(`INSERT INTO admin_users (username, password_hash, full_name, role)
      VALUES ($1, $2, $3, 'super_admin')`, [username, hash, username]);
    await client.query('COMMIT');
    console.log('First administrator created from .env');
    return true;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { ensureBootstrapAdmin };
