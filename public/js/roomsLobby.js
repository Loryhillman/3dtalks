(() => {
  const $ = id => document.getElementById(id);
  const t = (key, values) => window.i18n.tp('roomsLobby.' + key, values || {});
  let registering = false, createKey = null, createPayload = null, busy = false;
  const dialogFallback = () => $('auth').hidden ? $('create-launcher') : $('auth-submit');
  const createDialog = new window.AppDialog($('create-dialog'), dialogFallback);
  const editDialog = new window.AppDialog($('edit-dialog'), dialogFallback);
  const confirmDialog = new window.AppDialog($('confirm-dialog'), dialogFallback);
  let editedRoom, editedField, confirmedRoom, confirmedVerb;
  const slug = location.pathname.startsWith('/join/') ? decodeURIComponent(location.pathname.slice(6)) : null;
  function message(text = '') { $('message').textContent = text; }
  function clearSession() {
    for (const key of ['token', 'userId', 'characterId', 'userInfo']) localStorage.removeItem(key);
  }
  function showAuth() {
    for (const dialog of [createDialog, editDialog, confirmDialog]) dialog.close(true);
    $('cabinet').hidden = $('invitation').hidden = $('logout').hidden = true;
    $('auth').hidden = false;
  }
  async function api(url, options = {}) {
    const response = await fetch(url, { ...options, headers: {
      'Content-Type': 'application/json', Authorization: 'Bearer ' + (localStorage.getItem('token') || ''), ...options.headers
    } });
    const data = await response.json().catch(() => ({}));
    const renewed = response.headers.get('X-Renewed-Token');
    if (renewed) localStorage.setItem('token', renewed);
    if (!response.ok) {
      if ([401, 403].includes(response.status) && !url.includes('/auth/')) { clearSession(); showAuth(); }
      const key = data.errorKey || data.code;
      const translated = key && (data.errorKey ? window.i18n.tp(key, data.messageParams || {}) : t(key, data.messageParams));
      let errorMessage = translated && translated !== key && translated !== 'roomsLobby.' + key ? translated : t('failed');
      if (response.status === 429 && errorMessage === t('failed')) {
        const seconds = Number(data.retryAfter || response.headers.get('Retry-After'));
        errorMessage = Number.isFinite(seconds) && seconds > 0
          ? window.i18n.tp('authLimits.rateLimited', { seconds: Math.ceil(seconds) })
          : window.i18n.t('authLimits.rateLimitedUnknown');
      }
      throw Object.assign(new Error(errorMessage), { status: response.status, code: key });
    }
    return data;
  }
  async function action(fn) {
    if (busy) return;
    busy = true; message();
    const controls = [...document.querySelectorAll('button:not([data-shell-control])')];
    const disabled = controls.map(c => c.disabled); controls.forEach(c => { c.disabled = true; });
    try { await fn(); } catch (error) { message(error.message); }
    finally { controls.forEach((c, i) => { if (c.isConnected) c.disabled = disabled[i]; }); busy = false; }
  }
  function button(parent, label, handler, className = '', opensDialog = false) {
    const element = document.createElement('button'); element.textContent = t(label);
    element.className = 'ui-button' + (['delete', 'end'].includes(label) ? ' ui-button--destructive' : '') + (className ? ' ' + className : '');
    element.addEventListener('click', () => { if (opensDialog) { if (!busy) handler(); } else action(handler); }); parent.append(element);
  }
  // The API has no cover/template metadata: use an explicitly generic illustration.
  const ROOM_COVER = '/images/room-covers/neutral-v1.svg';
  let openRoomMenu = null;
  function roomMenu(room) {
    const menu = document.createElement('details'); menu.className = 'room-menu';
    const summary = document.createElement('summary'); summary.className = 'ui-button ui-button--ghost';
    summary.setAttribute('aria-label', t('roomActions', { name: room.name }));
    const icon = document.createElement('img'); icon.src = '/icons/lucide/ellipsis.svg'; icon.alt = ''; icon.width = icon.height = 20;
    summary.append(icon);
    const items = document.createElement('div'); items.className = 'room-menu-items';
    menu.append(summary, items);
    summary.addEventListener('click', () => {
      if (openRoomMenu && openRoomMenu !== menu) openRoomMenu.open = false;
      openRoomMenu = menu;
    });
    menu.addEventListener('toggle', () => {
      if (menu.open) { if (openRoomMenu && openRoomMenu !== menu) openRoomMenu.open = false; openRoomMenu = menu; }
      else if (openRoomMenu === menu) openRoomMenu = null;
    });
    menu.addEventListener('focusout', event => { if (!menu.contains(event.relatedTarget)) menu.open = false; });
    items.addEventListener('click', event => { if (event.target.closest('button')) menu.open = false; });
    return { menu, items, summary };
  }
  document.addEventListener('click', event => { if (openRoomMenu && !openRoomMenu.contains(event.target)) openRoomMenu.open = false; });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && openRoomMenu) {
      event.preventDefault(); const menu = openRoomMenu; menu.open = false; menu.querySelector('summary').focus();
    }
  });
  function invitationUrl(room) { return location.origin + '/join/' + encodeURIComponent(room.slug); }
  async function copyInvitation(url) {
    if (navigator.clipboard?.writeText) {
      try { await navigator.clipboard.writeText(url); return; } catch (_) { /* Try the HTTP-compatible path. */ }
    }
    const previousFocus = document.activeElement;
    const selection = window.getSelection?.();
    const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i).cloneRange()) : [];
    const field = document.createElement('textarea');
    field.value = url;
    field.readOnly = true;
    field.style.cssText = 'position:fixed;left:0;top:0;opacity:0;pointer-events:none;font-size:16px';
    document.body.append(field);
    try {
      field.focus({ preventScroll: true });
      field.select();
      field.setSelectionRange(0, url.length);
      if (!document.execCommand('copy')) throw new Error(t('copyFailed'));
    } catch (_) {
      throw new Error(t('copyFailed'));
    } finally {
      field.remove();
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
      if (selection) { selection.removeAllRanges(); ranges.forEach(range => selection.addRange(range)); }
    }
  }
  async function mutate(room, verb, body = {}, method = 'POST') {
    await api('/api/my/rooms/' + room.id + (verb ? '/' + verb : ''), {
      method, body: JSON.stringify({ revision: room.revision, ...body })
    });
    await load();
  }
  function dialogError(controller, error) {
    const text = error.status ? error.message : t('failed');
    controller.dialog.querySelector('[data-dialog-error]').textContent = text;
    if (error.code === 'INVALID_CAPACITY') {
      const field = controller.dialog.querySelector('[name=capacity]');
      if (field && !field.closest('label').hidden) controller.fieldError(field, text);
    }
  }
  function validate(controller, form, fields) {
    controller.clearErrors();
    let firstInvalid;
    for (const key of fields) {
      const field = form.elements[key], value = field.value.trim();
      const invalid = key === 'name' ? !value || value.length > 120 : !value || !Number.isInteger(Number(value)) || Number(value) < 1 || Number(value) > 6;
      if (invalid) { controller.fieldError(field, t(key === 'name' ? 'nameValidation' : 'capacityValidation')); firstInvalid ||= field; }
    }
    firstInvalid?.focus();
    return !firstInvalid;
  }
  async function refreshAfterChange(successKey) {
    message(t(successKey));
    try { await load(); if (document.activeElement === document.body) dialogFallback()?.focus({ preventScroll: true }); }
    catch (_) { message(t('savedRefreshFailed')); }
  }
  function openEdit(room, field, opener) {
    if (busy || editDialog.busy) return;
    editedRoom = room; editedField = field;
    if (openRoomMenu) { openRoomMenu.open = false; openRoomMenu = null; }
    const form = $('edit-room');
    for (const key of ['name', 'capacity']) {
      $('edit-' + key + '-field').hidden = key !== field;
      form.elements[key].disabled = key !== field;
      form.elements[key].value = String(room[key]);
    }
    $('edit-title').textContent = t(field === 'name' ? 'rename' : 'capacity');
    $('edit-room-name').textContent = room.name;
    editDialog.open(opener); form.elements[field].focus();
  }
  function openConfirm(room, verb, opener) {
    if (busy || confirmDialog.busy) return;
    confirmedRoom = room; confirmedVerb = verb;
    if (openRoomMenu) { openRoomMenu.open = false; openRoomMenu = null; }
    $('confirm-title').textContent = $('confirm-submit').textContent = t(verb);
    $('confirm-room-name').textContent = room.name;
    $('confirm-description').textContent = t(verb === 'end' ? 'endConsequences' : 'deleteConsequences');
    confirmDialog.open(opener);
  }
  async function load() {
    const data = await api('/api/my/rooms');
    $('auth').hidden = true; $('logout').hidden = false;
    if (slug) {
      $('cabinet').hidden = true; $('invitation').hidden = false;
      $('enter').hidden = true;
      const result = await api('/api/rooms/' + encodeURIComponent(slug) + '?characterId=' + encodeURIComponent(localStorage.getItem('characterId') || ''));
      $('invite-name').textContent = result.room.name;
      $('invite-info').textContent = t('capacity') + ': ' + result.room.capacity;
      $('enter').href = '/play?room=' + encodeURIComponent(slug); $('enter').hidden = false;
      return;
    }
    $('cabinet').hidden = false; $('invitation').hidden = true;
    $('quota').textContent = t('quota', { used: data.quota.used, limit: data.quota.limit });
    if (openRoomMenu) { openRoomMenu.open = false; openRoomMenu = null; }
    $('rooms').replaceChildren();
    if (!data.rooms.length) $('rooms').textContent = t('empty');
    for (const room of data.rooms) {
      const card = document.createElement('article'), name = document.createElement('h3'), info = document.createElement('span');
      card.className = 'ui-card room-card';
      const cover = document.createElement('div'); cover.className = 'room-cover';
      const image = document.createElement('img'); image.src = ROOM_COVER; image.alt = ''; image.width = 640; image.height = 360; image.loading = 'lazy'; image.decoding = 'async';
      image.addEventListener('error', () => { image.hidden = true; });
      const caption = document.createElement('span'); caption.className = 'room-cover-caption'; caption.textContent = t('coverIllustration');
      cover.append(image, caption);
      const body = document.createElement('div'); body.className = 'room-card-body';
      name.textContent = room.name;
      const status = room.status === 'closed' && !room.allow_rejoin ? 'ended' : room.status;
      info.className = 'room-status room-status--' + (['open', 'closed', 'ended', 'draft', 'archived'].includes(status) ? status : 'draft');
      info.textContent = t(status);
      const capacity = document.createElement('p'); capacity.className = 'room-capacity'; capacity.textContent = t('capacity') + ': ' + room.capacity;
      const occupancy = document.createElement('p');
      occupancy.className = 'room-occupancy';
      occupancy.textContent = t('occupancy', { active: room.active ?? 0, held: room.held ?? 0, available: room.available ?? 0 });
      body.append(info, name, capacity, occupancy); card.append(cover, body);
      const actions = document.createElement('div'); actions.className = 'actions room-card-actions'; body.append(actions);
      if (room.status === 'open') { const link = document.createElement('a'); link.className = 'ui-button ui-button--primary'; link.textContent = t('enter'); link.href = '/play?room=' + encodeURIComponent(room.slug); actions.append(link); }
      button(actions, 'copy', async () => {
        await copyInvitation(invitationUrl(room));
        message(t('copied'));
      }, 'room-copy');
      const { menu, items, summary } = roomMenu(room);
      actions.append(menu);
      button(items, 'rename', () => openEdit(room, 'name', summary), '', true);
      if (room.status === 'draft' || (room.status === 'closed' && !room.allow_rejoin)) {
        button(items, 'capacity', () => openEdit(room, 'capacity', summary), '', true);
      }
      if (['closed', 'draft'].includes(room.status)) button(items, 'openAction', () => mutate(room, 'open'));
      if (room.status === 'open') button(items, 'closeAction', () => mutate(room, 'close'));
      if (room.status === 'open' || (room.status === 'closed' && room.allow_rejoin)) button(items, 'end', () => openConfirm(room, 'end', summary), '', true);
      button(items, 'delete', () => openConfirm(room, 'delete', summary), '', true);
      $('rooms').append(card);
    }
  }
  $('create-launcher').onclick = () => { if (!busy) createDialog.open(); };
  $('edit-room').onsubmit = event => {
    event.preventDefault();
    if (editDialog.busy || !validate(editDialog, event.target, [editedField])) return;
    const value = event.target.elements[editedField].value.trim();
    const room = editedRoom, field = editedField;
    editDialog.submit(async () => {
      await api('/api/my/rooms/' + room.id, { method: 'PATCH', body: JSON.stringify({ revision: room.revision, [field]: field === 'capacity' ? Number(value) : value }) });
      editDialog.close(true); await refreshAfterChange('roomUpdated');
    }, error => dialogError(editDialog, error));
  };
  $('confirm-room').onsubmit = event => {
    event.preventDefault();
    const room = confirmedRoom, verb = confirmedVerb;
    confirmDialog.submit(async () => {
      await api('/api/my/rooms/' + room.id + (verb === 'end' ? '/end' : ''), { method: verb === 'delete' ? 'DELETE' : 'POST', body: JSON.stringify({ revision: room.revision }) });
      confirmDialog.close(true); await refreshAfterChange(verb === 'end' ? 'meetingEnded' : 'roomDeleted');
    }, error => dialogError(confirmDialog, error));
  };
  $('auth-toggle').onclick = () => {
    registering = !registering; $('registration').hidden = !registering;
    for (const field of $('registration').querySelectorAll('input,select')) field.required = registering;
    $('auth-submit').textContent = t(registering ? 'register' : 'login');
    $('auth-toggle').textContent = t(registering ? 'login' : 'register');
    $('auth-form').elements.password.autocomplete = registering ? 'new-password' : 'current-password';
  };
  $('auth-form').onsubmit = event => { event.preventDefault(); action(async () => {
    const body = Object.fromEntries(new FormData(event.target));
    if (registering) body.securityQuestionId = Number(body.securityQuestionId);
    const data = await api('/api/auth/' + (registering ? 'register' : 'login'), { method: 'POST', body: JSON.stringify(body) });
    clearSession();
    for (const key of ['token', 'userId', 'characterId']) localStorage.setItem(key, data[key]);
    event.target.elements.password.value = ''; event.target.elements.securityAnswer.value = '';
    await load();
  }); };
  $('create').onsubmit = event => { event.preventDefault();
    if (createDialog.busy || !validate(createDialog, event.target, ['name', 'capacity'])) return;
    createDialog.submit(async () => {
    const body = { name: event.target.elements.name.value.trim(), capacity: Number(event.target.elements.capacity.value) };
    const serialized = JSON.stringify(body);
    const storageKey = 'room-create:' + localStorage.getItem('userId');
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey));
      if (saved?.payload === serialized) { createKey = saved.key; createPayload = saved.payload; }
    } catch (_) {}
    if (serialized !== createPayload) { createKey = null; createPayload = serialized; }
    if (!createKey) {
      // getRandomValues also works on HTTP during local/IP testing.
      const bytes = crypto.getRandomValues(new Uint8Array(16)); bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
      const hex = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
      createKey = `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
    }
    sessionStorage.setItem(storageKey, JSON.stringify({ key: createKey, payload: serialized }));
    await api('/api/my/rooms', { method: 'POST', body: JSON.stringify({ ...body, request_key: createKey }) });
    sessionStorage.removeItem(storageKey); createKey = createPayload = null; event.target.reset(); createDialog.close(true);
    await refreshAfterChange('roomCreated');
  }, error => dialogError(createDialog, error)); };
  $('join').onsubmit = event => { event.preventDefault(); action(async () => {
    const url = new URL(event.target.elements.link.value.trim(), location.origin);
    const match = /^\/join\/([a-z0-9-]+)$/.exec(url.pathname);
    if (url.origin !== location.origin || !match) throw new Error(t('invalidLink'));
    location.assign('/join/' + match[1]);
  }); };
  $('refresh').onclick = () => action(load);
  $('logout').onclick = () => { clearSession(); showAuth(); message(); };
  $('lobby-language').onchange = event => action(async () => {
    await window.i18n.setLocaleLocal(event.target.value);
    location.reload();
  });
  window.addEventListener('storage', event => { if (['token', 'userId'].includes(event.key)) location.reload(); });
  (async () => {
    await window.i18n.init();
    document.documentElement.lang = window.i18n.currentLocale;
    $('lobby-language').value = window.i18n.currentLocale;
    for (const element of document.querySelectorAll('[data-t]')) element.textContent = t(element.dataset.t);
    try {
      const data = await api('/api/auth/security-questions');
      for (const question of data.questions || []) {
        if (!question.id) continue;
        const option = document.createElement('option'); option.value = question.id;
        option.textContent = question.questionKey ? window.i18n.t(question.questionKey) : question.question_text;
        $('auth-form').elements.securityQuestionId.append(option);
      }
    } catch (_) { /* Login remains available if questions cannot be loaded. */ }
    if (localStorage.getItem('token')) await action(async () => {
      try {
        const session = await api('/api/auth/me');
        localStorage.setItem('userId', session.user.id);
        localStorage.setItem('characterId', session.characterId);
      } catch (error) {
        if (error.status === 401 || error.status === 404) { clearSession(); showAuth(); }
        throw error;
      }
      await load();
    }); else showAuth();
  })().catch(error => message(error.message));
})();
