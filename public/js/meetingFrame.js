/** Meeting frame work: avatar animation, seating, performance statistics and rendering. */
window.MeetingFrame = {
  update(world, delta, now) {
    // Seating poses are applied after animation, so imported clips cannot move a seat.
    for (const participant of world.players.values()) {
      const data = participant.group?.userData;
      if (!data) continue;
      data.glbMixer?.update(delta / 1000);
      if (data.sharedMixer && data.sharedMixer !== data.glbMixer) data.sharedMixer.update(delta / 1000);
    }
    world.frameCount++;
    const elapsed = now - world.lastFPSCheck;
    if (elapsed >= 1000) {
      world.currentFPS = Math.round(world.frameCount * 1000 / elapsed);
      world.frameCount = 0;
      world.lastFPSCheck = now;
    }
    // The meeting has a complete snapshot; no global-world LOD/queue suggestions.
    if (now - world.performanceMonitor.lastFrameTime >= 1000) {
      world.performanceMonitor.fps = world.currentFPS;
      world.performanceMonitor.lastFrameTime = now;
      world.performanceMonitor.objects = { total: world.generatedBuildings.size, visible: world.loadedObjects.size };
      if (performance.memory) {
        world.performanceMonitor.memory = { used: performance.memory.usedJSHeapSize, total: performance.memory.totalJSHeapSize };
      }
    }
    window.RoomSeating.renderPoses(world);
    world.renderer.render(world.scene, world.camera);
  }
};
