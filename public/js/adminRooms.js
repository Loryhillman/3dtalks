(() => {
  const api = '/api/admin/rooms';
  let ready = false;
  let pendingRequest = null;
  let selectedRoom = null;
  let modelsLoaded = false;
  const t = (key, fallback) => {
    const value = window.i18n?.t('roomsAdmin.' + key);
    return value && value !== 'roomsAdmin.' + key ? value : fallback;
  };
  const auth = () => ({ Authorization: 'Bearer ' + (localStorage.getItem('adminToken') || '') });

  async function request(path, options = {}) {
    const response = await fetch(api + path, {
      ...options,
      headers: { ...auth(), ...(options.headers || {}) }
    });
    const data = await response.json().catch(() => ({}));
    if ([401, 403].includes(response.status)) window.RoomAdmin?.expire();
    if (!response.ok || !data.success) {
      const key = data.code && 'roomsLobby.' + data.code;
      const translated = key && window.i18n?.t(key);
      throw new Error(data.validation?.errors?.join('; ') ||
        (translated && translated !== key ? translated : data.error || `${response.status}`));
    }
    return data;
  }

  function fillTemplates(templates) {
    const select = document.getElementById('room-create-template');
    select.replaceChildren();
    const list = document.getElementById('room-template-list');
    if (list) list.replaceChildren();
    for (const template of templates) {
      const option = document.createElement('option');
      option.value = template.template_key;
      option.textContent = `${template.name} (v${template.version}, ${template.object_count})`;
      select.append(option);
      if (list) {
        const link = document.createElement('a');
        link.className = 'btn btn-sm'; link.style.marginRight = '8px';
        link.href = '/room_editor.html?template=' + encodeURIComponent(template.template_key);
        link.target = '_blank'; link.rel = 'noopener';
        link.textContent = t('editTemplate', 'Редактировать шаблон') + ': ' + template.name + ' (v' + template.version + ')';
        list.append(link);
      }
    }
  }

  function render(rooms) {
    const container = document.getElementById('rooms-admin-list');
    container.replaceChildren();
    if (!rooms.length) {
      container.textContent = t('empty', 'Комнат пока нет');
      return;
    }
    const table = document.createElement('table');
    table.style.width = '100%';
    table.style.borderCollapse = 'collapse';
    const head = document.createElement('tr');
    for (const label of [t('name', 'Название'), t('owner', 'Владелец'), t('status', 'Статус'),
      t('template', 'Шаблон'), t('objects', 'Предметов'), t('capacity', 'Лимит участников'), '']) {
      const cell = document.createElement('th');
      cell.textContent = label;
      cell.style.textAlign = 'left';
      cell.style.padding = '8px';
      head.append(cell);
    }
    table.append(head);
    for (const room of rooms) {
      const row = document.createElement('tr');
      for (const value of [room.name, room.owner_name || room.owner_user_id || t('systemRoom', 'Системная'), t('status_' + room.status, room.status),
        room.template_key ? `${room.template_key} v${room.template_version}` : '—',
        String(room.object_count || 0), String(room.capacity)]) {
        const cell = document.createElement('td');
        cell.textContent = value;
        cell.style.padding = '8px';
        cell.style.borderTop = '1px solid var(--border)';
        row.append(cell);
      }
      const action = document.createElement('td');
      const button = document.createElement('button');
      button.className = 'btn btn-sm';
      button.textContent = t('editObjects', 'Предметы');
      button.addEventListener('click', () => selectRoom(room));
      action.append(button);
      if (room.status === 'draft') {
        const capacityButton = document.createElement('button');
        capacityButton.className = 'btn btn-sm';
        capacityButton.textContent = t('capacity', 'Лимит участников');
        capacityButton.addEventListener('click', async () => {
          const value = prompt(t('capacity', 'Лимит участников'), String(room.capacity));
          if (value === null) return;
          try {
            await request('/' + room.id, { method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name: room.name, capacity: Number(value),
                spawn_position: room.spawn_position, revision: room.revision }) });
            await load();
          } catch (error) { alert(error.message); }
        });
        action.append(capacityButton);

        const editor = document.createElement('button');
        editor.className = 'btn btn-sm';
        editor.style.marginLeft = '6px';
        editor.textContent = t('open3dEditor', '3D-редактор');
        editor.addEventListener('click', () => {
          window.open('/room_editor.html?room=' + encodeURIComponent(room.id), '_blank', 'noopener');
        });
        action.append(editor);
        const publish = document.createElement('button');
        publish.className = 'btn btn-sm';
        publish.style.marginLeft = '6px';
        publish.textContent = t('publish', 'Открыть вход');
        publish.addEventListener('click', async () => {
          if (!confirm(t('confirmPublish', 'Открыть комнату для игроков?'))) return;
          publish.disabled = true;
          try {
            await request(`/${room.id}/open`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: room.revision }) });
            await load();
          } catch (error) {
            document.getElementById('room-create-message').textContent = error.message;
            publish.disabled = false;
          }
        });
        action.append(publish);
      } else if (room.status === 'open') {
        const link = document.createElement('a');
        link.href = '/?room=' + encodeURIComponent(room.slug);
        link.target = '_blank';
        link.rel = 'noopener';
        link.textContent = t('enterRoom', 'Войти');
        link.style.marginLeft = '8px';
        action.append(link);
      }
      if (room.status === 'open' || room.status === 'closed') {
        if (room.status === 'closed') {
          const reopen = document.createElement('button');
          reopen.className = 'btn btn-sm';
          reopen.style.marginLeft = '6px';
          reopen.textContent = t('reopenRoom', 'Открыть снова');
          reopen.addEventListener('click', async () => {
            if (!confirm(t('confirmPublish', 'Открыть комнату для игроков?'))) return;
            reopen.disabled = true;
            try {
              await request(`/${room.id}/open`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: room.revision }) });
              await load();
            } catch (error) {
              document.getElementById('room-create-message').textContent = error.message;
              reopen.disabled = false;
            }
          });
          action.append(reopen);
        }
        if (room.status === 'open') {
          const close = document.createElement('button');
          close.className = 'btn btn-sm';
          close.style.marginLeft = '6px';
          close.textContent = t('closeRoom', 'Закрыть вход');
          close.addEventListener('click', async () => {
            if (!confirm(t('confirmClose', 'Закрыть вход новым участникам? Текущие останутся.'))) return;
            close.disabled = true;
            try {
              await request(`/${room.id}/close`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: room.revision }) });
              await load();
            } catch (error) {
              document.getElementById('room-create-message').textContent = error.message;
              close.disabled = false;
            }
          });
          action.append(close);
        }
        const end = document.createElement('button');
        end.className = 'btn btn-sm';
        end.style.marginLeft = '6px';
        end.textContent = t('endRoom', 'Завершить встречу');
        end.addEventListener('click', async () => {
          if (!confirm(t('confirmEnd', 'Завершить встречу и отключить всех участников?'))) return;
          end.disabled = true;
          try {
            await request(`/${room.id}/end`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: room.revision }) });
            await load();
          } catch (error) {
            document.getElementById('room-create-message').textContent = error.message;
            end.disabled = false;
          }
        });
        action.append(end);
      }
      if (room.slug !== 'main' && !room.deleted_at) {
        const remove = document.createElement('button'); remove.className = 'btn btn-sm';
        remove.textContent = t('deleteRoom', 'Удалить комнату');
        remove.onclick = async () => {
          if (!confirm(t('confirmDeleteRoom', 'Удалить комнату и отключить участников?') + ' ' + room.name)) return;
          remove.disabled = true;
          try { await request('/' + room.id, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: room.revision }) }); await load(); }
          catch (error) { document.getElementById('room-create-message').textContent = error.message; remove.disabled = false; }
        };
        action.append(remove);
      }
      row.append(action);
      table.append(row);
    }
    container.append(table);
  }

  function numberInput(value) {
    const input = document.createElement('input');
    input.type = 'number';
    input.step = 'any';
    input.style.width = '75px';
    input.value = Number(value || 0);
    return input;
  }

  function objectTransform(object, x, y, z) {
    return {
      position_x: Number(x), position_y: Number(y), position_z: Number(z),
      rotation_x: Number(object.rotation_x || 0),
      rotation_y: Number(object.rotation_y || 0),
      rotation_z: Number(object.rotation_z || 0),
      scale_x: Number(object.scale_x ?? 1),
      scale_y: Number(object.scale_y ?? 1),
      scale_z: Number(object.scale_z ?? 1),
      has_collision: object.has_collision === true
    };
  }

  async function loadObjects() {
    if (!selectedRoom) return;
    const roomId = selectedRoom.id;
    const container = document.getElementById('room-object-list');
    const message = document.getElementById('room-object-message');
    try {
      const data = await request('/' + encodeURIComponent(roomId) + '/objects');
      if (selectedRoom?.id !== roomId) return;
      container.replaceChildren();
      for (const object of data.objects || []) {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:6px;border-top:1px solid var(--border)';
        const label = document.createElement('span');
        label.textContent = `${object.name || object.type} (#${object.id})`;
        label.style.minWidth = '180px';
        const x = numberInput(object.position_x);
        const y = numberInput(object.position_y);
        const z = numberInput(object.position_z);
        row.append(label, 'X', x, 'Y', y, 'Z', z);
        if (selectedRoom.status === 'draft') {
          const save = document.createElement('button');
          save.className = 'btn btn-sm';
          save.textContent = t('saveObject', 'Сохранить');
          save.addEventListener('click', async () => {
            save.disabled = true;
            try {
              await request(`/${roomId}/objects/${object.id}`, {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(objectTransform(object, x.value, y.value, z.value))
              });
              message.textContent = t('saved', 'Предмет сохранён');
              await loadObjects();
            } catch (error) {
              message.textContent = error.message;
              save.disabled = false;
            }
          });
          const remove = document.createElement('button');
          remove.className = 'btn btn-sm';
          remove.textContent = t('removeObject', 'Удалить');
          remove.addEventListener('click', async () => {
            if (!confirm(t('confirmRemove', 'Удалить предмет из черновика?'))) return;
            remove.disabled = true;
            try {
              await request(`/${roomId}/objects/${object.id}`, { method: 'DELETE' });
              message.textContent = t('removed', 'Предмет удалён');
              await loadObjects();
              await load();
            } catch (error) {
              message.textContent = error.message;
              remove.disabled = false;
            }
          });
          row.append(save, remove);
        }
        container.append(row);
      }
    } catch (error) {
      container.textContent = `${t('loadError', 'Не удалось загрузить комнату')}: ${error.message}`;
    }
  }

  async function selectRoom(room) {
    selectedRoom = room;
    const editor = document.getElementById('rooms-object-editor');
    editor.style.display = 'block';
    document.getElementById('rooms-editor-title').textContent = room.name;
    document.getElementById('room-object-form').style.display = room.status === 'draft' ? 'flex' : 'none';
    if (!modelsLoaded && room.status === 'draft') {
      try {
        const data = await request('/models');
        const select = document.getElementById('room-object-model');
        select.replaceChildren();
        for (const model of data.models || []) {
          const option = document.createElement('option');
          option.value = model.id;
          option.textContent = `${model.name} (#${model.id})`;
          select.append(option);
        }
        modelsLoaded = true;
      } catch (error) {
        document.getElementById('room-object-message').textContent = error.message;
      }
    }
    await loadObjects();
  }

  async function load() {
    if (!ready) return;
    const container = document.getElementById('rooms-admin-list');
    try {
      const data = await request('/');
      render(data.rooms || []);
    } catch (error) {
      container.textContent = `${t('loadError', 'Не удалось загрузить комнаты')}: ${error.message}`;
    }
  }

  async function init() {
    if (ready) return;
    const tab = document.getElementById('rooms-admin-tab');
    const form = document.getElementById('room-create-form');
    if (!tab || !form || !localStorage.getItem('adminToken')) return;
    try {
      const data = await request('/templates');
      fillTemplates(data.templates || []);
      ready = true;
      tab.style.display = '';
    } catch (error) {
      if (document.body.dataset.roomAdmin) throw error;
      // The feature flag is off; the unfinished UI stays hidden.
      return;
    }
    document.getElementById('room-create-slug').value =
      'room-' + Math.random().toString(36).slice(2, 10);
    document.getElementById('room-object-form').addEventListener('submit', async event => {
      event.preventDefault();
      if (!selectedRoom || selectedRoom.status !== 'draft') return;
      const form = event.currentTarget;
      const button = form.querySelector('button[type="submit"]');
      const message = document.getElementById('room-object-message');
      button.disabled = true;
      try {
        const transform = objectTransform({ has_collision: true },
          document.getElementById('room-object-x').value,
          document.getElementById('room-object-y').value,
          document.getElementById('room-object-z').value);
        await request(`/${selectedRoom.id}/objects`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...transform,
            model_id: Number(document.getElementById('room-object-model').value),
            name: document.getElementById('room-object-name').value })
        });
        message.textContent = t('added', 'Предмет добавлен');
        document.getElementById('room-object-name').value = '';
        await loadObjects();
        await load();
      } catch (error) {
        message.textContent = error.message;
      } finally {
        button.disabled = false;
      }
    });
    form.addEventListener('input', () => { pendingRequest = null; });
    form.addEventListener('change', () => { pendingRequest = null; });
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const button = form.querySelector('button[type="submit"]');
      const message = document.getElementById('room-create-message');
      button.disabled = true;
      pendingRequest ||= {
        name: document.getElementById('room-create-name').value,
        slug: document.getElementById('room-create-slug').value,
        capacity: Number(document.getElementById('room-create-capacity').value),
        template_key: document.getElementById('room-create-template').value,
        creation_key: crypto.randomUUID()
      };
      try {
        await request('/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(pendingRequest)
        });
        pendingRequest = null;
        message.textContent = t('created', 'Черновик создан');
        form.reset();
        document.getElementById('room-create-capacity').value = '6';
        document.getElementById('room-create-slug').value =
          'room-' + Math.random().toString(36).slice(2, 10);
        await load();
      } catch (error) {
        message.textContent = `${t('createError', 'Не удалось создать комнату')}: ${error.message}`;
      } finally {
        button.disabled = false;
      }
    });
  }

  window.AdminRooms = { init, load, async invalidateModels() {
    modelsLoaded = false;
    if (selectedRoom?.status === 'draft') await selectRoom(selectedRoom);
  } };
  if (!document.body.dataset.roomAdmin) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  }
})();
