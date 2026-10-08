/** Owns meeting participants, name labels and account-avatar lifetime. */
(() => {
  class MeetingParticipants {
    constructor(world) { this.world = world; }
    add(id, name, position, avatarConfig) {
      this.remove(id);
      const parts = window.AvatarBase.create(true);
      const group = parts.characterGroup, data = group.userData;
      data.leftArm = parts.leftArmGroup;
      data.rightArm = parts.rightArmGroup;
      data.leftLeg = parts.leftLegGroup;
      data.rightLeg = parts.rightLegGroup;
      data.leftElbow = parts.leftElbowGroup;
      data.rightElbow = parts.rightElbowGroup;
      data.leftKnee = parts.leftKneeGroup;
      data.rightKnee = parts.rightKneeGroup;
      data.seatHead = data.defaultSeatHead = parts.head;
      data.seatFallbackParts = [parts.body, parts.head, parts.leftArmGroup, parts.rightArmGroup, parts.leftLegGroup, parts.rightLegGroup];
      const nameSprite = this.world.createNameSprite(name, 1.8);
      group.add(nameSprite); data.nameSprite = nameSprite;
      group.position.set(position.x, position.y, position.z);
      this.world.scene.add(group);
      this.world.players.set(id, { group, name, nameSprite, position });
      if (avatarConfig) window.UserAvatarRenderer.apply(group, avatarConfig);
      return group;
    }
    rename(id, name) {
      const entry = this.world.players.get(id);
      if (!entry || entry.name === name) return;
      const height = entry.nameSprite?.position.y ?? 1.95;
      if (entry.nameSprite) {
        entry.group.remove(entry.nameSprite);
        window.UserAvatarRenderer.dispose(entry.nameSprite);
      }
      entry.name = name;
      entry.nameSprite = this.world.createNameSprite(name);
      entry.nameSprite.position.y = height;
      entry.group.userData.nameSprite = entry.nameSprite;
      entry.group.add(entry.nameSprite);
    }
    remove(id) {
      const entry = this.world.players.get(id);
      if (!entry) return;
      // Invalidate pending GLB/image work even if its root has not been attached yet.
      const data = entry.group.userData;
      data.accountAvatarTicket = (data.accountAvatarTicket || 0) + 1;
      entry.group.parent?.remove(entry.group);
      window.UserAvatarRenderer.dispose(entry.group);
      window.nearbyBubbles?.removeFor(id);
      window.RoomSeating?.removeParticipant(id);
      this.world.players.delete(id);
    }
    clear() { for (const id of [...this.world.players.keys()]) this.remove(id); }
  }
  window.MeetingParticipants = MeetingParticipants;
})();
