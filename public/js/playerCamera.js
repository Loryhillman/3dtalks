/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
// Shared camera follow; used by the legacy player and seated participants.
window.PlayerCamera = {
  update(camera) {
    // First-person or third-person camera follow
    if (GAME_STATE.cameraMode === 'third-person') {
      // Auto-level camera pitch in third-person ONLY when not dragging
      if (!MOUSE.isDragging) {
        const levelingSpeed = 0.05;
        MOUSE.rotationX *= (1 - levelingSpeed);
        MOUSE.targetRotationX *= (1 - levelingSpeed);
      }

      // Show player model in third-person
      if (this.worldObject) {
        this.worldObject.visible = true;

        // 让人物模型跟随摄像机的水平旋转（Y轴）
        // 使用 MOUSE.rotationY 而不是 this.rotation
        this.worldObject.rotation.y = MOUSE.rotationY;
      }

      // Third-person camera: 自由旋转视角，只基于鼠标旋转（不受人物旋转影响）
      const cameraDistance = 5;

      // Calculate camera position based ONLY on mouse rotation (not player rotation)
      const horizontalAngle = MOUSE.rotationY;
      const verticalAngle = MOUSE.rotationX;

      const targetCameraPos = this.position.clone();
      // 水平旋转 + 垂直角度计算摄像机位置
      targetCameraPos.x -= Math.sin(horizontalAngle) * cameraDistance * Math.cos(verticalAngle);
      targetCameraPos.z -= Math.cos(horizontalAngle) * cameraDistance * Math.cos(verticalAngle);
      targetCameraPos.y += 2 + Math.sin(verticalAngle) * cameraDistance;

      // Use faster lerp or direct assignment to reduce camera lag
      camera.position.copy(targetCameraPos);

      // Look at player - use fixed position for third-person
      const lookTarget = new THREE.Vector3(
        this.position.x,
        this.position.y + 1.5,
        this.position.z
      );
      camera.lookAt(lookTarget);
    } else {
      // Auto-level camera pitch in first-person ONLY when not dragging
      if (!MOUSE.isDragging) {
        const levelingSpeed = 0.05;
        MOUSE.rotationX *= (1 - levelingSpeed);
        MOUSE.targetRotationX *= (1 - levelingSpeed);
      }

      // Hide player model in first-person
      if (this.worldObject) {
        this.worldObject.visible = false;
        // 同步模型朝向（本地不可见，但 broadcastPosition 广播的 rotation
        // 读自 worldObject.rotation.y，不更新会导致其他玩家看不到转向）
        this.worldObject.rotation.y = MOUSE.rotationY;
      }

      // First-person camera: use camera bone if available, otherwise use head level
      let targetCameraPos;
      if (this.worldObject && this.worldObject.userData.cameraBone) {
        const cameraBone = this.worldObject.userData.cameraBone;
        const bonePos = new THREE.Vector3();
        cameraBone.getWorldPosition(bonePos);
        targetCameraPos = bonePos;
      } else {
        // Default head level position
        const cameraOffset = new THREE.Vector3(0, 1.6, 0);
        targetCameraPos = this.position.clone().add(cameraOffset);
      }

      camera.position.lerp(targetCameraPos, 0.1);

      // Set camera rotation directly from mouse rotation
      // 视角连续性：第三人称相机在人物背后 (player − (sinθ,cosθ)·d, θ=MOUSE.rotationY)，
      // 视线方向 = (sinθ,cosθ)；欧拉 yaw=θ 的相机 forward = (−sinθ,−cosθ) 恰好反向 180°，
      // 因此第一人称 yaw 需 +π，保证按 C 切换瞬间朝向与第三人称人物朝向一致（前后移动不反转）。
      // 注意 pitch 不要在此取反：main.js 输入层已按视角模式对 pitch 增量做过方向补偿。
      const euler = new THREE.Euler(0, 0, 0, 'YXZ');
      euler.y = MOUSE.rotationY + Math.PI;
      euler.x = MOUSE.rotationX;
      camera.quaternion.setFromEuler(euler);
    }
  }
};
