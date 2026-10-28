const {pool}=require('../database/db');
const service=require('./roomMedia').createRoomMediaService(pool);
module.exports={service};
