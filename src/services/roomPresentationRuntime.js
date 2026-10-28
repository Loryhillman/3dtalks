const {pool}=require('../database/db');
const service=require('./roomPresentation').createRoomPresentationService(pool,{
  identity:connectionId=>require('../websocket/wsServer').presentationIdentity(connectionId),
  broadcast:(roomId,message)=>require('../websocket/wsServer').broadcastToRoom(roomId,message)
});
module.exports={service};
