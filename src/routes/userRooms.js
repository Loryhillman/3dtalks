const router = require('express').Router();
const { pool } = require('../database/db');
const { authenticateToken } = require('../middleware/auth');
const service = require('../services/userRooms').createUserRoomService(pool);
router.use(authenticateToken);
function errorResponse(res, error) {
  if (!error.status) console.error('[userRooms]', error);
  res.status(error.status || 500).json({ success: false, code: error.status ? error.code : 'ROOM_SERVICE_ERROR' });
}
router.get('/', async (req, res) => {
  try { res.json({ success: true, ...await service.list(req.user.userId) }); }
  catch (error) { errorResponse(res, error); }
});
router.post('/', async (req, res) => {
  try {
    const result = await service.create(req.user.userId, req.body);
    res.status(result.reused ? 200 : 201).json({ success: true, ...result });
  } catch (error) { errorResponse(res, error); }
});
const lifecycle = require('../services/userRoomLifecycle').createUserRoomLifecycle(pool);
function mutation(action) {
  return async (req, res) => {
    try {
      res.json({ success: true, ...await lifecycle.mutate(req.user.userId, req.params.id, action, req.body) });
    } catch (error) { errorResponse(res, error); }
  };
}
router.patch('/:id', mutation('settings'));
router.delete('/:id', mutation('delete'));
for (const action of ['open', 'close', 'end']) router.post('/:id/' + action, mutation(action));
module.exports = router;
