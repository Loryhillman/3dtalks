const { randomUUID } = require('node:crypto');

// All account creation/repair writes use one transaction. Locking the user row
// makes concurrent logins select/create the same canonical character.
function createAccountCharacterService(pool) {
  async function transaction(operation) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { client.release(); }
  }
  async function ensure(client, userId, username, selectedId) {
    let character = selectedId ? (await client.query('SELECT id FROM characters WHERE user_id=$1 AND id=$2', [userId, selectedId])).rows[0] : null;
    if (!character) character = (await client.query('SELECT id FROM characters WHERE user_id=$1 ORDER BY id LIMIT 1', [userId])).rows[0];
    if (!character) {
      character = { id: randomUUID() };
      await client.query('INSERT INTO characters (id, user_id, name) VALUES ($1,$2,$3)', [character.id, userId, username]);
    }
    await client.query('INSERT INTO character_appearance (character_id) VALUES ($1) ON CONFLICT (character_id) DO NOTHING', [character.id]);
    await client.query('UPDATE users SET room_character_id=$2 WHERE id=$1', [userId, character.id]);
    return character.id;
  }
  async function register({ username, email, passwordHash, questionId, answerHash }) {
    return transaction(async client => {
      const userId = randomUUID();
      await client.query(`INSERT INTO users (id, username, email, password_hash, security_question_id, security_answer)
        VALUES ($1,$2,$3,$4,$5,$6)`, [userId, username, email, passwordHash, questionId, answerHash]);
      const characterId = await ensure(client, userId, username);
      return { userId, characterId };
    });
  }
  async function repair(userId) {
    return transaction(async client => {
      const user = (await client.query('SELECT id, username, room_character_id FROM users WHERE id=$1 FOR UPDATE', [userId])).rows[0];
      if (!user) throw Object.assign(new Error('ACCOUNT_NOT_FOUND'), { code: 'ACCOUNT_NOT_FOUND' });
      return ensure(client, userId, user.username, user.room_character_id);
    });
  }
  return { register, repair };
}
module.exports = { createAccountCharacterService };
