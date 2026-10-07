// Standard avatar geometry shared by the room and its editor preview.
(() => {
  function create(isLoggedIn = true) {
    const characterGroup = new THREE.Group();

    const bodyGeometry = new THREE.BoxGeometry(0.6, 1.2, 0.3);
    const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0x4a90e2 });
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    body.position.y = 0.3;
    body.castShadow = true;
    body.receiveShadow = true;
    characterGroup.add(body);

    const headGeometry = new THREE.SphereGeometry(0.4, 8, 8);
    const headColor = isLoggedIn ? 0xffaa99 : 0x888888;
    const headMaterial = new THREE.MeshStandardMaterial({ color: headColor });
    const head = new THREE.Mesh(headGeometry, headMaterial);
    head.position.y = 1.2;
    head.castShadow = true;
    head.receiveShadow = true;
    characterGroup.add(head);

    const upperArmGeometry = new THREE.CylinderGeometry(0.08, 0.08, 0.5, 6);
    const forearmGeometry = new THREE.CylinderGeometry(0.07, 0.07, 0.5, 6);
    const armMaterial = new THREE.MeshStandardMaterial({ color: 0xffaa99 });
    
    const leftArmGroup = new THREE.Group();
    leftArmGroup.position.set(-0.38, 0.8, 0);
    
    const leftUpperArm = new THREE.Mesh(upperArmGeometry, armMaterial);
    leftUpperArm.position.y = -0.25;
    leftUpperArm.castShadow = true;
    leftArmGroup.add(leftUpperArm);
    
    const leftElbowGroup = new THREE.Group();
    leftElbowGroup.position.set(0, -0.5, 0);
    
    const leftForearm = new THREE.Mesh(forearmGeometry, armMaterial);
    leftForearm.position.y = -0.25;
    leftForearm.castShadow = true;
    leftElbowGroup.add(leftForearm);
    
    leftArmGroup.add(leftElbowGroup);
    characterGroup.add(leftArmGroup);

    const rightArmGroup = new THREE.Group();
    rightArmGroup.position.set(0.38, 0.8, 0);
    
    const rightUpperArm = new THREE.Mesh(upperArmGeometry, armMaterial);
    rightUpperArm.position.y = -0.25;
    rightUpperArm.castShadow = true;
    rightArmGroup.add(rightUpperArm);
    
    const rightElbowGroup = new THREE.Group();
    rightElbowGroup.position.set(0, -0.5, 0);
    
    const rightForearm = new THREE.Mesh(forearmGeometry, armMaterial);
    rightForearm.position.y = -0.25;
    rightForearm.castShadow = true;
    rightElbowGroup.add(rightForearm);
    
    rightArmGroup.add(rightElbowGroup);
    characterGroup.add(rightArmGroup);

    const thighGeometry = new THREE.CylinderGeometry(0.1, 0.1, 0.6, 6);
    const calfGeometry = new THREE.CylinderGeometry(0.09, 0.09, 0.6, 6);
    const legMaterial = new THREE.MeshStandardMaterial({ color: 0x2c3e50 });
    
    const leftLegGroup = new THREE.Group();
    leftLegGroup.position.set(-0.18, -0.3, 0);
    
    const leftThigh = new THREE.Mesh(thighGeometry, legMaterial);
    leftThigh.position.y = -0.3;
    leftThigh.castShadow = true;
    leftLegGroup.add(leftThigh);
    
    const leftKneeGroup = new THREE.Group();
    leftKneeGroup.position.set(0, -0.6, 0);
    
    const leftCalf = new THREE.Mesh(calfGeometry, legMaterial);
    leftCalf.position.y = -0.3;
    leftCalf.castShadow = true;
    leftKneeGroup.add(leftCalf);
    
    leftLegGroup.add(leftKneeGroup);
    characterGroup.add(leftLegGroup);

    const rightLegGroup = new THREE.Group();
    rightLegGroup.position.set(0.18, -0.3, 0);
    
    const rightThigh = new THREE.Mesh(thighGeometry, legMaterial);
    rightThigh.position.y = -0.3;
    rightThigh.castShadow = true;
    rightLegGroup.add(rightThigh);
    
    const rightKneeGroup = new THREE.Group();
    rightKneeGroup.position.set(0, -0.6, 0);
    
    const rightCalf = new THREE.Mesh(calfGeometry, legMaterial);
    rightCalf.position.y = -0.3;
    rightCalf.castShadow = true;
    rightKneeGroup.add(rightCalf);
    
    rightLegGroup.add(rightKneeGroup);
    characterGroup.add(rightLegGroup);
    
    Object.assign(characterGroup.userData, {seatHead:head,defaultSeatHead:head,seatFallbackParts:[body,head,leftArmGroup,rightArmGroup,leftLegGroup,rightLegGroup],leftArm:leftArmGroup,rightArm:rightArmGroup,leftLeg:leftLegGroup,rightLeg:rightLegGroup,leftElbow:leftElbowGroup,rightElbow:rightElbowGroup,leftKnee:leftKneeGroup,rightKnee:rightKneeGroup});
    return {characterGroup,body,head,leftArmGroup,rightArmGroup,leftLegGroup,rightLegGroup,leftElbowGroup,rightElbowGroup,leftKneeGroup,rightKneeGroup};
  }
  window.AvatarBase = {create};
})();
