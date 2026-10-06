// Adapts the room editor's object/seat operations to an independent template draft.
(() => {
  const clone = value => JSON.parse(JSON.stringify(value));
  class RoomTemplateSession {
    constructor(key) { this.key = key; this.dirty = false; this.room = {}; this.models = []; }
    async request(suffix, body, method = 'POST') {
      const response = await fetch('/api/admin/rooms/templates/' + encodeURIComponent(this.key) + suffix, {
        method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('adminToken') },
        body: JSON.stringify(body || {})
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || `HTTP ${response.status}`);
      return data;
    }
    changed() { this.dirty = true; window.dispatchEvent(new Event('room-template-changed')); }
    adopt(draft) {
      this.draft = draft;
      // Upgrade old snapshots in memory; published versions remain immutable.
      for (const item of draft.layout) for (const seat of item.seats || []) {
        if (seat.coordinate_space !== 'rigid') {
          seat.local_position = Object.fromEntries(['x','y','z'].map(a => [a, seat.local_position[a] * (item.scale?.[a] ?? 1)]));
          seat.coordinate_space = 'rigid';
        }
      }
      Object.assign(this.room, { id: 'template-' + this.key, name: draft.name, status: 'draft',
        revision: draft.revision, seating_mode: 'seated', template_key: this.key });
      this.dirty = false;
      window.dispatchEvent(new Event('room-template-changed'));
    }
    async init() {
      this.adopt((await this.request('/draft')).draft);
      const response = await fetch('/api/admin/rooms/models', { headers: { Authorization: 'Bearer ' + localStorage.getItem('adminToken') } });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Не удалось загрузить модели');
      this.models = data.models;
    }
    objects() {
      return this.draft.layout.filter(item => item.type !== 'seat').map(item => {
        const row = { id: item.editor_id, name: item.name, type: item.type === 'room_shell' ? 'geometry_building' : item.type || 'geometry_building',
          model_path: item.model_path, model_id: item.model_id, template_kind: item.kind,
          has_collision: item.collision, is_room_shell:item.kind==='room',room_envelope:item.envelope||null,
          geometry_data: item.type==='room_shell' ? {envelope:item.envelope,components:RoomEnvelope.components(item.envelope)} : { components: item.components } };
        const values = { position: item.position, rotation: item.rotation || { x: 0, y: item.rotation_y || 0, z: 0 },
          scale: item.scale || { x: 1, y: 1, z: 1 } };
        for (const prefix of Object.keys(values)) for (const a of ['x','y','z']) row[prefix+'_'+a] = values[prefix][a];
        return row;
      });
    }
    seats() { return this.draft.layout.flatMap(item => (item.seats || []).map(s => ({ ...clone(s), object_id: item.type === 'seat' ? null : item.editor_id }))); }
    async api(path, options = {}) {
      const method = options.method || 'GET', body = options.body ? JSON.parse(options.body) : {};
      if (path === '') return { room: this.room };
      if(path==='/envelope' && method==='PATCH'){
        const item=this.draft.layout.find(i=>i.type==='room_shell');
        if(!item || !RoomEnvelope.valid(body.envelope))throw new Error('Проверьте параметры помещения');
        if(JSON.stringify(item.envelope)!==JSON.stringify(body.envelope)){item.envelope=clone(body.envelope);this.changed();}
        return {room:this.room};
      }
      if (path === '/models') return { models: this.models };
      if (path === '/objects' && method === 'GET') return { objects: this.objects() };
      if (path === '/seats' && method === 'GET') return { seats: this.seats() };
      if (path === '/seats' && method === 'POST') {
        if (body.seating_mode !== 'seated') throw new Error('Шаблон переговорной должен использовать рассадку');
        for (const seat of body.seats) if (seat.object_id !== null && !this.draft.layout.some(i => i.type !== 'seat' && i.editor_id === seat.object_id)) throw new Error('Предмет места не найден');
        const previous = JSON.stringify(this.draft.layout);
        for (const item of this.draft.layout) item.seats = body.seats.filter(s => item.type !== 'seat' && s.object_id === item.editor_id)
          .map(({ id, object_id, room_id, ...seat }) => clone(seat));
        this.draft.layout = this.draft.layout.filter(i => i.type !== 'seat');
        const free = body.seats.filter(s => s.object_id === null).map(({id,object_id,room_id,...s}) => clone(s));
        if (free.length) this.draft.layout.push({ editor_id: Math.max(0,...this.draft.layout.map(i => i.editor_id)) + 1,
          type:'seat', kind:'seat', name:'Посадочные места', collision:false,
          position:{x:0,y:0,z:0}, rotation:{x:0,y:0,z:0}, scale:{x:1,y:1,z:1}, seats:free });
        if (JSON.stringify(this.draft.layout) !== previous) this.changed();
        return { room: this.room };
      }
      if (path === '/objects' && method === 'POST') {
        if (this.draft.layout.length >= 100) throw new Error('В шаблоне может быть не более 100 предметов');
        const model = this.models.find(m => m.id === body.model_id);
        if (!model) throw new Error('Выберите модель');
        const item = { editor_id: Math.max(0, ...this.draft.layout.map(i => i.editor_id)) + 1,
          kind: 'furniture', name: body.name, type: 'uploaded_model', model_id: model.id,
          model_path: model.path, collision: body.has_collision, seats: [] };
        for (const prefix of ['position','rotation','scale']) item[prefix] = Object.fromEntries(['x','y','z'].map(a => [a, body[prefix+'_'+a]]));
        this.draft.layout.push(item); this.changed(); return { object: this.objects().find(o => o.id === item.editor_id) };
      }
      const match = /^\/objects\/(\d+)(\/copy)?$/.exec(path);
      if (!match) throw new Error('Недоступное действие редактора');
      const item = this.draft.layout.find(i => i.editor_id === Number(match[1]));
      if (!item) throw new Error('Предмет не найден');
      if (match[2] && method === 'POST') {
        if(item.kind==='room')throw new Error('Помещение редактируется отдельно от мебели');
        if (this.draft.layout.length >= 100) throw new Error('Достигнут лимит предметов');
        if (this.seats().length + (item.seats || []).length > 100) throw new Error('В комнате может быть не более 100 мест');
        if (item.position.x + 1.5 > 10000) throw new Error('Копия выходит за границы координат');
        const copy = clone(item);
        copy.editor_id = Math.max(...this.draft.layout.map(i => i.editor_id)) + 1;
        copy.name = (item.name + ' — копия').slice(0,120); copy.position.x += 1.5;
        const labels = new Set(this.seats().map(s => s.label));
        let order = Math.max(0, ...this.seats().map(s => s.sort_order));
        for (const seat of copy.seats || []) {
          let label = 1; while (labels.has(String(label))) label++;
          seat.label = String(label); labels.add(seat.label); seat.sort_order = Math.min(10000, ++order); seat.map_x = Math.min(10000, seat.map_x + 1.5);
        }
        this.draft.layout.push(copy); this.changed(); return { object: this.objects().find(o => o.id === copy.editor_id) };
      }
      if (method === 'DELETE') {
        if (item.kind === 'room') throw new Error('Помещение нужно сохранить в шаблоне');
        if (item.seats?.length && !['keep','delete'].includes(body.seats)) throw new Error('Выберите действие для прикреплённых мест');
        if (body.seats === 'keep' && item.seats?.length) {
          const object = this.objects().find(o => o.id === item.editor_id);
          const remaining = this.seats().map(s => s.object_id === item.editor_id
            ? { ...s, object_id:null, ...RoomSeatCoordinates.local(RoomSeatCoordinates.world(s, object), null) } : s);
          await this.api('/seats', {method:'POST',body:JSON.stringify({seats:remaining,seating_mode:'seated'})});
        }
        this.draft.layout = this.draft.layout.filter(i => i.editor_id !== item.editor_id); this.changed(); return {};
      }
      if (method === 'PATCH') {
        if(item.kind==='room')throw new Error('Используйте настройки помещения');
        const previous = JSON.stringify(item);
        if (body.model_id !== undefined) {
          if (item.kind === 'room') throw new Error('Заменять модель помещения пока нельзя');
          const model = this.models.find(m => m.id === body.model_id);
          if (!model) throw new Error('Выберите модель');
          Object.assign(item, { type: 'uploaded_model', model_id: model.id, model_path: model.path });
          delete item.components;
        }
        if (typeof body.name === 'string') item.name = body.name;
        for (const prefix of ['position','rotation','scale']) if (body[prefix+'_x'] !== undefined) {
          item[prefix] = Object.fromEntries(['x','y','z'].map(a => [a, body[prefix+'_'+a]]));
        }
        if (body.has_collision !== undefined) item.collision = body.has_collision;
        if (JSON.stringify(item) !== previous) this.changed();
        return { object: this.objects().find(o => o.id === item.editor_id), room: this.room };
      }
      throw new Error('Недоступное действие редактора');
    }
    async save() {
      if (!this.dirty) return;
      this.adopt((await this.request('/draft', { revision: this.draft.revision, name: this.draft.name, layout: this.draft.layout }, 'PUT')).draft);
    }
    async publish() {
      await this.save();
      const data = await this.request('/publish', { revision: this.draft.revision });
      this.adopt(data.draft); return data.version;
    }
  }
  window.RoomTemplateSession = RoomTemplateSession;
})();
