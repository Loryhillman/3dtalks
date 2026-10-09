/** GLB room contract and bounds math shared by Node and the browser. No Three.js dependency. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RoomEnvironment = factory();
})(typeof window === 'undefined' ? globalThis : window, () => {
  'use strict';
  const axes = ['x', 'y', 'z'];
  const limits = Object.freeze({ coordinate: 10000, sourceCoordinate: 1e9, minScale: 1e-6,
    maxScale: 10000, minWidth: 1, maxWidth: 200, minHeight: 2, maxHeight: 30 });
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const vector = (value, maximum) => !!value && axes.every(axis => finite(value[axis]) && Math.abs(value[axis]) <= maximum);
  const modelPath = path => typeof path === 'string' && /^\/models\/uploaded\/[a-zA-Z0-9_-]+\.glb$/.test(path);

  function validTransform(transform) {
    return !!transform && vector(transform.position, limits.coordinate) && vector(transform.rotation, limits.coordinate) &&
      transform.rotation.x === 0 && transform.rotation.z === 0 && !!transform.scale &&
      finite(transform.scale.x) && transform.scale.x >= limits.minScale && transform.scale.x <= limits.maxScale &&
      transform.scale.x === transform.scale.y && transform.scale.x === transform.scale.z;
  }

  function apply(point, transform, inverse = false) {
    const { position: p, rotation: r, scale: { x: s } } = transform;
    const c = Math.cos(r.y), sin = Math.sin(r.y);
    if (inverse) {
      const x = point.x - p.x, z = point.z - p.z;
      return { x: (c * x - sin * z) / s, y: (point.y - p.y) / s, z: (sin * x + c * z) / s };
    }
    return { x: p.x + s * (c * point.x + sin * point.z), y: p.y + s * point.y,
      z: p.z + s * (-sin * point.x + c * point.z) };
  }

  function corners(bounds) {
    return [bounds.min.x, bounds.max.x].flatMap(x => [bounds.min.y, bounds.max.y].flatMap(y =>
      [bounds.min.z, bounds.max.z].map(z => ({ x, y, z }))));
  }

  // Bounds are in the imported model's coordinates; dimension limits are in metres after scaling.
  function valid(environment, transform) {
    const b = environment?.bounds;
    if (environment?.version !== 1 || !validTransform(transform) ||
        !vector(b?.min, limits.sourceCoordinate) || !vector(b?.max, limits.sourceCoordinate)) return false;
    const s = transform.scale.x;
    for (const axis of axes) {
      const size = (b.max[axis] - b.min[axis]) * s;
      if (!finite(size) || size < (axis === 'y' ? limits.minHeight : limits.minWidth) ||
          size > (axis === 'y' ? limits.maxHeight : limits.maxWidth)) return false;
    }
    return corners(b).every(point => vector(apply(point, transform), limits.coordinate));
  }

  function validItem(item) {
    return !!item && item.type === 'room_environment' && item.kind === 'room' && item.collision === false &&
      typeof item.name === 'string' && !!item.name.trim() && item.name.length <= 120 &&
      Number.isSafeInteger(item.model_id) && item.model_id > 0 && modelPath(item.model_path) &&
      (item.seats === undefined || Array.isArray(item.seats) && item.seats.length === 0) && valid(item.environment, item);
  }

  function requireValid(environment, transform) {
    if (!valid(environment, transform)) throw new RangeError('INVALID_ROOM_ENVIRONMENT');
  }

  function toWorld(point, transform) {
    if (!validTransform(transform) || !vector(point, limits.sourceCoordinate)) throw new RangeError('INVALID_ENVIRONMENT_POINT');
    return apply(point, transform);
  }

  function toLocal(point, transform) {
    if (!validTransform(transform) || !vector(point, limits.coordinate)) throw new RangeError('INVALID_ENVIRONMENT_POINT');
    return apply(point, transform, true);
  }

  function contains(point, environment, transform, tolerance = .01) {
    if (!valid(environment, transform) || !vector(point, limits.coordinate) || !finite(tolerance) || tolerance < 0 || tolerance > .1) return false;
    const local = apply(point, transform, true), margin = tolerance / transform.scale.x;
    return axes.every(axis => local[axis] >= environment.bounds.min[axis] - margin && local[axis] <= environment.bounds.max[axis] + margin);
  }

  function worldBounds(environment, transform) {
    requireValid(environment, transform);
    const points = corners(environment.bounds).map(point => apply(point, transform));
    return { min: Object.fromEntries(axes.map(axis => [axis, Math.min(...points.map(point => point[axis]))])),
      max: Object.fromEntries(axes.map(axis => [axis, Math.max(...points.map(point => point[axis]))])) };
  }

  // Set an explicit physical width while preserving proportions and all source coordinates.
  function withWidth(environment, transform, metres) {
    const b = environment?.bounds;
    if (!valid(environment, transform) || !finite(metres)) throw new RangeError('INVALID_ROOM_ENVIRONMENT');
    const s = metres / (b.max.x - b.min.x);
    const next = { position: { ...transform.position }, rotation: { ...transform.rotation }, scale: { x: s, y: s, z: s } };
    requireValid(environment, next);
    return next;
  }

  return Object.freeze({ limits, modelPath, validTransform, valid, validItem, toWorld, toLocal, contains, worldBounds, withWidth });
});
