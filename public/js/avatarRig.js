// Shared by GLB validation and the seated avatar renderer.
(function (root) {
  const aliases = {
    hips:['hips','pelvis'], head:['head'],
    leftUpLeg:['leftupleg','leftthigh','thighl'], leftLeg:['leftleg','leftcalf','calfl'], leftFoot:['leftfoot','footl'],
    rightUpLeg:['rightupleg','rightthigh','thighr'], rightLeg:['rightleg','rightcalf','calfr'], rightFoot:['rightfoot','footr'],
    leftArm:['leftarm','upperarml'], leftForeArm:['leftforearm','lowerarml'], leftHand:['lefthand','handl'],
    rightArm:['rightarm','upperarmr'], rightForeArm:['rightforearm','lowerarmr'], rightHand:['righthand','handr']
  };
  const normalize = name => String(name || '').toLowerCase().replace(/^mixamorig\d*:?/, '').replace(/[^a-z0-9]/g, '');
  function mapNodes(nodes, joints) {
    const result = {};
    for (const [key,names] of Object.entries(aliases)) {
      const matches = nodes.map((node,i) => joints.has(i) && names.includes(normalize(node.name)) ? i : -1).filter(i => i >= 0);
      if (matches.length === 1) result[key] = matches[0];
    }
    return result;
  }
  const api = { aliases, normalize, mapNodes };
  if (typeof module !== 'undefined') module.exports = api;
  else root.AvatarRig = api;
})(typeof window === 'undefined' ? globalThis : window);
