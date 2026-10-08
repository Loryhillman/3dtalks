/** Meeting scene ownership. World supplies only the renderer and scene registries. */
(function () {
  'use strict';

  function cancelled() {
    const error = new Error('Room scene loading cancelled');
    error.name = 'AbortError';
    return error;
  }

  // Sources and instances may share GPU resources. Release each resource once.
  function disposeRoots(roots) {
    const geometries = new Set(), materials = new Set();
    for (const root of roots) root.traverse(node => {
      if (node.geometry) geometries.add(node.geometry);
      for (const material of [].concat(node.material || [])) materials.add(material);
    });
    const textures = new Set();
    for (const material of materials) {
      for (const [key, value] of Object.entries(material)) {
        if (value?.isTexture && !(key === 'map' && material.userData?.roomSurfaceTextureOwned)) textures.add(value);
      }
      // Room wall materials own their asynchronously loaded surface texture.
      // Their dispose listener releases it, including loads that finish later.
      material.dispose();
    }
    for (const texture of textures) texture.dispose();
    for (const geometry of geometries) geometry.dispose();
  }

  class RoomScene {
    constructor(world, { fetch: request = window.fetch.bind(window) } = {}) {
      this.world = world;
      this.request = request;
      this.current = null;
      window.addEventListener?.('pagehide', event => { if (!event.persisted) this.clear(); });
    }

    clear() {
      const run = this.current;
      if (!run) return;
      this.current = null;
      run.controller.abort();
      this.world.isLoadingBuildings = false;
      for (const [id, entry] of run.entries) {
        entry.model.removeFromParent ? entry.model.removeFromParent() : entry.model.parent?.remove(entry.model);
        if (this.world.generatedBuildings.get(id) === entry) this.world.generatedBuildings.delete(id);
        this.world.loadedObjects.delete(id);
        window.CapsuleCollision?.unregisterModel(id);
      }
      const ids = new Set(run.entries.keys());
      this.world.collisionObjects = this.world.collisionObjects.filter(item => !ids.has(item.id));
      disposeRoots(run.roots);
      run.roots.clear();
      run.entries.clear();
      run.sources.clear();
    }

    begin() {
      this.clear();
      const run = { controller: new AbortController(), roots: new Set(), entries: new Map(), sources: new Map() };
      this.current = run;
      // Rooms load complete snapshots, without the global world's distance queue.
      this.world.allWorldObjects = [];
      this.world.loadingQueue = [];
      return run;
    }

    assertCurrent(run) {
      if (this.current !== run || run.controller.signal.aborted) throw cancelled();
    }

    async model(object, run) {
      if (!object.model_path) throw new Error(`Room model path missing: ${object.id}`);
      let source = run.sources.get(object.model_path);
      if (!source) {
        const response = await this.request(object.model_path, { signal: run.controller.signal });
        if (!response.ok) throw new Error(`Room model unavailable: ${object.id} (HTTP ${response.status})`);
        const buffer = await response.arrayBuffer();
        this.assertCurrent(run);
        const directory = new URL('.', new URL(object.model_path, window.location.href)).href;
        const gltf = await new Promise((resolve, reject) => this.world.gltfLoader.parse(buffer, directory, resolve, reject));
        source = gltf.scene;
        if (!source) throw new Error(`Room model scene missing: ${object.id}`);
        if (this.current !== run) {
          disposeRoots([source]);
          throw cancelled();
        }
        run.roots.add(source);
        run.sources.set(object.model_path, source);
      }
      return source.clone(true);
    }

    async populate(objects, run) {
      if (!Array.isArray(objects) || !objects.length) throw new Error('Room scene is empty');
      const ids = new Set();
      for (const object of objects) {
        this.assertCurrent(run);
        if (!object || object.id == null || ids.has(object.id)) throw new Error('Room object ID missing or duplicated');
        ids.add(object.id);
        let model;
        if (object.type === 'geometry_building') {
          const geometry = typeof object.geometry_data === 'string' ? JSON.parse(object.geometry_data) : object.geometry_data;
          if (!geometry?.components?.length) throw new Error(`Room geometry missing: ${object.id}`);
          model = GeometryRenderer.renderFromComponents(geometry.components, THREE);
          model.userData.componentCollision = true;
        } else if (object.type === 'uploaded_model') {
          model = await this.model(object, run);
        } else {
          throw new Error(`Unsupported room object: ${object.type}`);
        }
        run.roots.add(model);
        this.assertCurrent(run);
        model.position.set(object.position_x ?? 0, object.position_y ?? 0, object.position_z ?? 0);
        model.rotation.set(object.rotation_x ?? 0, object.rotation_y ?? 0, object.rotation_z ?? 0);
        model.scale.set(object.scale_x ?? 1, object.scale_y ?? 1, object.scale_z ?? 1);
        model.userData.worldObjectId = object.id;
        model.userData.name = object.name;
        model.traverse(node => { if (node.isMesh) { node.castShadow = true; node.receiveShadow = true; } });
        const entry = { model, data: object, isGeometry: object.type === 'geometry_building' };
        run.entries.set(object.id, entry);
        this.world.scene.add(model);
        model.updateMatrixWorld(true);
        this.world.generatedBuildings.set(object.id, entry);
        this.world.loadedObjects.add(object.id);
        if (object.has_collision === true) {
          if (entry.isGeometry) {
            this.world.collisionObjects.push(...GeometryRenderer.buildCollisionObjects(model, object, THREE));
          } else {
            const box = new THREE.Box3().setFromObject(model), size = box.getSize(new THREE.Vector3());
            this.world.collisionObjects.push({ type: 'box', id: object.id, anchor: model.position.clone(),
              position: box.getCenter(new THREE.Vector3()), size: { width: size.x, height: size.y, depth: size.z }, boundingBox: box });
          }
        }
      }
    }

    async load(objects) {
      const run = this.begin();
      try { await this.populate(objects, run); }
      catch (error) { if (this.current === run) this.clear(); throw error; }
    }

    async enter(slug) {
      const run = this.begin();
      this.world.isLoadingBuildings = true;
      this.world.updateLoadingStatus(0, 1);
      this.world.showLoadingProgress();
      try {
        const response = await this.request('/api/rooms/' + encodeURIComponent(slug) +
          '/objects?characterId=' + encodeURIComponent(localStorage.getItem('characterId') || ''), {
          signal: run.controller.signal, headers: { Authorization: 'Bearer ' + localStorage.getItem('token') }
        });
        const data = await response.json();
        this.assertCurrent(run);
        if (!response.ok || !data.success) throw new Error(`Room objects unavailable (HTTP ${response.status})`);
        await this.populate(data.objects, run);
        this.assertCurrent(run);
        this.world.updateLoadingStatus(1, 1);
        window.RoomSeating?.sceneReady();
      } catch (error) {
        if (this.current !== run) return;
        this.clear();
        console.error('[RoomScene] Loading failed:', error);
        this.world.updateLoadingStatus(1, 1);
        window.RoomSeating?.sceneFailed();
      } finally {
        if (this.current === run || !this.current) this.world.isLoadingBuildings = false;
      }
    }
  }

  window.RoomScene = RoomScene;
})();
