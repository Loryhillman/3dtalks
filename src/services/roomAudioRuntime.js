let service;
module.exports = {
  initialize(identity) {
    if (!service) service = require('./roomAudio').createRoomAudio({ identity,
      warn: code => console.warn('[RoomAudio]', code) });
    service.start();
    return service;
  },
  authorize(token) { return service?.authorize(token) || false; }
};
