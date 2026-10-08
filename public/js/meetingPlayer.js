/** Seated participant controller. No RPG movement, combat or portal state. */
(() => {
  class MeetingPlayer {
    constructor(world, characterId, characterData) {
      this.world = world;
      this.characterId = characterId;
      this.characterData = characterData;
      this.position = new THREE.Vector3(0, 2, 0);
      this.targetRotationY = MOUSE.rotationY;
      this.worldObject = world.addPlayer(characterId, characterData.character.name, this.position, true);
    }
    update(_delta, camera) {
      window.RoomSeating.updateLocal(this, camera);
    }
    updateCamera(camera) {
      window.PlayerCamera.update.call(this, camera);
    }
  }
  window.MeetingPlayer = MeetingPlayer;
})();
