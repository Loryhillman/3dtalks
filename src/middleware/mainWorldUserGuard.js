const { authenticateToken } = require('./auth');
const { query } = require('../database/db');
const { MAIN_ROOM_ID } = require('../services/roomScope');

// Legacy shops and plots have no room_id. While rooms are enabled, their
// writes are available only to their owner while the acting character is in
// the main world. Keep the original route behavior when rooms are disabled.
function mainWorldUserGuard(ownerQuery, ownerId) {
  return async (req, res, next) => {
    if (process.env.ROOMS_ENABLED !== 'true') return next();
    return authenticateToken(req, res, async () => {
      try {
        const userId = req.user?.userId;
        if (!userId) return res.status(403).json({ error: 'Forbidden' });
        const characterId = req.get('X-Character-Id');
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(characterId || '')) {
          return res.status(400).json({ error: 'Character ID required' });
        }
        const active = await query(
          'SELECT 1 FROM characters WHERE id = $1 AND user_id = $2 AND last_room_id = $3',
          [characterId, userId, MAIN_ROOM_ID]
        );
        if (!active.rows.length) return res.status(403).json({ error: 'Main world only' });
        if (ownerId) {
          if (ownerId(req) !== userId) return res.status(403).json({ error: 'Forbidden' });
        } else if (ownerQuery) {
          const owned = await query(ownerQuery, [req.params.plotId || req.params.buildingId || req.body.shopId, userId]);
          if (!owned.rows.length) return res.status(403).json({ error: 'Forbidden' });
        }
        next();
      } catch (error) {
        console.error('[mainWorldUserGuard]', error);
        res.status(500).json({ error: 'World access check failed' });
      }
    });
  };
}

module.exports = { mainWorldUserGuard };
