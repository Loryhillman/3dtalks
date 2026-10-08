(() => {
  const $ = id => document.getElementById(id);
  const t = key => window.i18n.t('roomAdminShell.' + key);
  let users = [], nextOffset = null, models = [], usersBusy = false;
  function expire() {
    localStorage.removeItem('adminToken'); localStorage.removeItem('adminUser');
    location.replace('/admin_login.html');
  }
  async function request(path, options = {}) {
    const response = await fetch(path, { ...options, headers: {
      Authorization: 'Bearer ' + (localStorage.getItem('adminToken') || ''),
      ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {})
    } });
    if ([401, 403].includes(response.status)) { expire(); throw new Error(t('sessionExpired')); }
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.success === false) throw new Error(data.error || t('requestFailed'));
    return data;
  }
  function message(text) { $('admin-message').textContent = text; }
  function table(container, headings, rows) {
    container.replaceChildren();
    if (!rows.length) { container.textContent = t('empty'); return; }
    const table = document.createElement('table'), head = document.createElement('thead');
    const header = document.createElement('tr');
    for (const title of headings) { const th = document.createElement('th'); th.textContent = title; header.append(th); }
    head.append(header); table.append(head);
    const body = document.createElement('tbody');
    for (const values of rows) {
      const row = document.createElement('tr');
      for (const value of values) { const td = document.createElement('td'); td.textContent = String(value ?? '—'); row.append(td); }
      body.append(row);
    }
    table.append(body); container.append(table);
  }
  function renderModels() { table($('admin-models'), ['ID', t('name'), t('format')], models.map(model => [model.id, model.name, 'GLB'])); }
  function renderUsers() {
    table($('admin-users'), [t('name'), t('email'), t('created'), t('savedRooms')], users.map(user =>
      [user.username, user.email, new Date(user.created_at).toLocaleDateString(window.i18n.currentLocale), user.room_count]));
    $('users-more').hidden = nextOffset === null;
  }
  async function loadModels() { models = (await request('/api/admin/rooms/models')).models || []; renderModels(); }
  async function loadUsers(reset = false) {
    if (usersBusy) return;
    usersBusy = true; $('users-more').disabled = true;
    try {
      const data = await request('/api/admin/users?offset=' + (reset ? 0 : nextOffset || 0));
      users = reset ? data.users : [...users, ...data.users]; nextOffset = data.nextOffset; renderUsers();
    } finally { usersBusy = false; $('users-more').disabled = false; }
  }
  function translate() {
    document.documentElement.lang = window.i18n.currentLocale.split('-')[0];
    document.querySelectorAll('[data-i18n]').forEach(node => { node.textContent = window.i18n.t(node.dataset.i18n); });
    $('admin-locale').value = window.i18n.currentLocale;
    renderModels(); renderUsers();
  }
  async function run(action) { try { await action(); } catch (error) { message(error.message); } }
  function form(id, action) {
    $(id).addEventListener('submit', async event => {
      event.preventDefault(); const button = event.currentTarget.querySelector('button[type="submit"]');
      if (button.disabled) return;
      button.disabled = true; message('');
      try { await action(); message(t('saved')); }
      catch (error) { message(error.message); }
      finally { button.disabled = false; }
    });
  }
  const put = (path, body) => request(path, { method: 'PUT', body: JSON.stringify(body) });
  async function init() {
    await window.i18n.init(); translate();
    if (!localStorage.getItem('adminToken')) return expire();
    const session = await request('/api/admin-auth/verify');
    $('admin-name').textContent = session.adminUser.full_name || session.adminUser.username;
    $('profile-name').value = session.adminUser.full_name || session.adminUser.username;
    $('profile-email').value = session.adminUser.email || '';
    await window.AdminRooms.init(); await window.AdminRooms.load();
    $('admin-app').hidden = false;
    $('admin-logout').onclick = expire;
    $('admin-locale').onchange = event => run(() => window.i18n.setLocaleLocal(event.target.value));
    window.i18n.onLocaleChange(() => { translate(); window.AdminRooms.load(); });
    for (const button of document.querySelectorAll('[data-panel]')) button.onclick = () => run(async () => {
      const panel = button.dataset.panel; message('');
      for (const item of document.querySelectorAll('[data-panel]')) {
        item.setAttribute('aria-pressed', String(item === button));
        $('panel-' + item.dataset.panel).hidden = item !== button;
      }
      if (panel === 'models') await loadModels();
      if (panel === 'users') await loadUsers(true);
      if (panel === 'settings') $('default-language').value = (await request('/api/config/language')).language;
    });
    $('refresh-rooms').onclick = () => window.AdminRooms.load();
    $('refresh-models').onclick = () => run(loadModels);
    $('refresh-users').onclick = () => run(() => loadUsers(true));
    $('users-more').onclick = () => run(() => loadUsers());
    form('model-upload-form', async () => {
      await window.RoomModelUpload.upload($('model-file').files[0]);
      $('model-upload-form').reset(); await loadModels(); await window.AdminRooms.invalidateModels();
    });
    form('profile-form', async () => {
      await put('/api/admin-auth/profile', { full_name: $('profile-name').value.trim(), email: $('profile-email').value.trim() });
      $('admin-name').textContent = $('profile-name').value.trim();
    });
    form('password-form', async () => {
      if ($('password-new').value !== $('password-confirm').value) throw new Error(t('passwordMismatch'));
      await request('/api/admin-auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword: $('password-current').value, newPassword: $('password-new').value }) });
      $('password-form').reset();
    });
    form('language-form', () => put('/api/config/language', { language: $('default-language').value }));
  }
  window.RoomAdmin = { request, expire };
  $('admin-retry').onclick = () => location.reload();
  init().catch(error => { message(error.message); $('admin-retry').hidden = false; });
})();
