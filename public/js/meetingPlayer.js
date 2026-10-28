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
      if (GAME_STATE.cameraMode !== 'first-person') {
        window.PlayerCamera.update.call(this, camera);
        return;
      }
      // The room origin is at the seated hips, not the standing feet.
      // Follow the loaded/scaled head instead of the legacy 1.6 m offset.
      const group=this.worldObject, head=group?.userData.roomSeatRig?.found?.head;
      const scale=window.RoomAvatarScale?.resolve(group?.userData.roomAvatarScale)??1;
      if(head){
        head.updateWorldMatrix(true,false);
        head.getWorldPosition(camera.position);
        camera.position.y+=.1*scale;
      } else camera.position.copy(this.position).add(new THREE.Vector3(0,.85*scale,0));
      if(group)group.visible=false;
      camera.quaternion.setFromEuler(new THREE.Euler(MOUSE.rotationX,MOUSE.rotationY+Math.PI,0,'YXZ'));
    }
  }
  window.MeetingPlayer = MeetingPlayer;
})();
