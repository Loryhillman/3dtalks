const router = require('express').Router();
const { query } = require('../database/db');
const { authenticateAdminToken } = require('../middleware/adminAuth');
router.use(authenticateAdminToken);

// Read-only account directory. Destructive legacy account/RPG operations are
// deliberately not part of room administration.
router.get('/', async (req, res) => {
  const offset = Number(req.query.offset || 0);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1000000) {
    return res.status(400).json({ success: false, code: 'INVALID_OFFSET' });
  }
  try {
    const { rows } = await query(`
      SELECT u.id, u.username, u.email, u.created_at,
        (SELECT count(*)::int FROM rooms r
          WHERE r.owner_user_id=u.id AND r.deleted_at IS NULL) AS room_count
      FROM users u ORDER BY u.created_at DESC, u.id
      LIMIT 51 OFFSET $1`, [offset]);
    res.json({ success: true, users: rows.slice(0, 50),
      nextOffset: rows.length > 50 ? offset + 50 : null });
  } catch (error) {
    console.error('[RoomAdmin] Account directory failed:', error.message);
    res.status(500).json({ success: false, code: 'USER_LIST_ERROR' });
  }
});
module.exports = router;
