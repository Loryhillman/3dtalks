/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
// Explicit initialization uses the same .env credentials as the Compose startup.
const { initializeDatabase, pool } = require('./database/db');
initializeDatabase().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
}).finally(() => pool.end());
