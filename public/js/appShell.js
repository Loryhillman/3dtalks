/* Ordinary web pages only: no API calls or Three.js dependencies. */
(() => {
  const main = document.querySelector('main');
  if (!main || !document.body.classList.contains('app-shell')) return;
  const avatar = document.body.dataset.appPage === 'avatar';
  const mobile = matchMedia('(max-width: 767px)');
  const labels = [];
  const element = (tag, className, textKey) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (textKey) labels.push([node, textKey]);
    return node;
  };
  const icon = name => {
    const image = element('img', 'shell-icon');
    image.src = '/icons/lucide/' + name + '.svg';
    image.alt = ''; image.width = image.height = 20;
    return image;
  };
  const control = (className, name) => {
    const button = element('button', 'ui-button ' + className);
    button.type = 'button'; button.dataset.shellControl = '';
    button.append(icon(name));
    return button;
  };
  const header = element('header', 'shell-header');
  const sidebar = element('aside', 'shell-sidebar');
  sidebar.id = 'app-sidebar';
  const backdrop = element('div', 'shell-backdrop'); backdrop.hidden = true;
  const toggle = control('shell-toggle ui-button--ghost', 'panel-left');
  toggle.setAttribute('aria-controls', sidebar.id);
  const context = element('span', 'shell-context', avatar ? 'myAvatar' : location.pathname.startsWith('/join/') ? 'invitation' : 'myRooms');
  const brand = element('a', 'shell-brand'); brand.href = '/rooms'; brand.textContent = '3DTalks';
  const close = control('shell-close ui-button--ghost', 'x');
  const navigation = element('nav', 'shell-nav');
  for (const [href, key, name, active] of [
    ['/rooms', 'myRooms', 'layout-grid', !avatar && !location.pathname.startsWith('/join/')],
    ['/avatar.html', 'myAvatar', 'user-round', avatar]
  ]) {
    const link = element('a', 'shell-link'); link.href = href;
    link.append(icon(name), element('span', 'shell-link-label', key));
    link.dataset.labelKey = key;
    if (active) link.setAttribute('aria-current', 'page');
    navigation.append(link);
  }
  sidebar.append(brand, close, navigation);
  main.id = 'app-content'; main.tabIndex = -1;
  const skip = element('a', 'shell-skip', 'skipContent'); skip.href = '#app-content';
  const tools = element('div', 'shell-tools');
  const oldHeader = main.querySelector('header');
  let languageLabel = oldHeader?.querySelector('.lobby-language');
  if (!languageLabel) {
    languageLabel = element('label', 'lobby-language');
    const select = element('select'); select.id = 'shell-language';
    for (const [value, text] of [['en-US', 'English'], ['ru-RU', 'Русский'], ['zh-CN', '中文']]) select.append(new Option(text, value));
    languageLabel.append(element('span', 'shell-language-label', 'language'), select);
    select.addEventListener('change', async () => {
      select.disabled = true;
      try { await window.i18n.setLocaleLocal(select.value); location.reload(); }
      catch (_) { document.getElementById('avatar-status').textContent = window.i18n.t('appShell.languageFailed'); }
      finally { select.disabled = false; }
    });
  }
  languageLabel.classList.add('shell-language');
  const language = languageLabel.querySelector('select');
  const account = element('details', 'shell-account');
  const summary = element('summary', 'ui-button ui-button--ghost');
  summary.append(icon('user-round'), element('span', 'shell-account-label', 'account'), icon('chevron-down'));
  const dropdown = element('div', 'shell-dropdown');
  const avatarLink = element('a', 'shell-dropdown-link', 'myAvatar'); avatarLink.href = '/avatar.html';
  let logout = document.getElementById('logout');
  if (!logout) {
    logout = element('button', 'ui-button ui-button--ghost', 'logout'); logout.type = 'button';
    logout.addEventListener('click', () => {
      for (const key of ['token', 'userId', 'characterId', 'userInfo']) localStorage.removeItem(key);
      location.assign('/rooms');
    });
  }
  dropdown.append(avatarLink, logout); account.append(summary, dropdown);
  tools.append(languageLabel, account); header.append(toggle, context, tools);
  if (avatar && oldHeader?.querySelector('h1')) main.prepend(oldHeader.querySelector('h1'));
  oldHeader?.remove();
  // These links are now in the navigation and user dropdown.
  document.querySelector('#cabinet > a[href="/avatar.html"]')?.remove();
  document.body.prepend(skip, backdrop, sidebar, header);
  let collapsed = false, drawerOpen = false, previousFocus, previousOverflow;
  try { collapsed = localStorage.getItem('app-sidebar-collapsed') === 'true'; } catch (_) {}
  function render() {
    document.body.classList.toggle('shell-collapsed', collapsed);
    document.body.classList.toggle('shell-drawer-open', drawerOpen);
    toggle.setAttribute('aria-expanded', String(mobile.matches ? drawerOpen : !collapsed));
    sidebar.inert = mobile.matches && !drawerOpen;
    sidebar.setAttribute('aria-hidden', String(sidebar.inert || sidebar.hidden));
    backdrop.hidden = !drawerOpen;
    for (const link of navigation.querySelectorAll('a')) {
      link.setAttribute('aria-label', window.i18n.t('appShell.' + link.dataset.labelKey));
      if (!mobile.matches && collapsed) link.title = window.i18n.t('appShell.' + link.dataset.labelKey);
      else link.removeAttribute('title');
    }
  }
  function setDrawer(open, restore = true) {
    if (drawerOpen === open) return;
    drawerOpen = open;
    if (open) {
      account.open = false;
      previousFocus = document.activeElement;
      previousOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      main.inert = header.inert = skip.inert = true;
      sidebar.setAttribute('role', 'dialog'); sidebar.setAttribute('aria-modal', 'true');
      render(); close.focus();
    } else {
      document.body.style.overflow = previousOverflow;
      main.inert = header.inert = skip.inert = false;
      sidebar.removeAttribute('role'); sidebar.removeAttribute('aria-modal');
      render(); if (restore && previousFocus?.isConnected) previousFocus.focus();
    }
  }
  toggle.addEventListener('click', () => {
    if (mobile.matches) setDrawer(!drawerOpen);
    else {
      collapsed = !collapsed;
      try { localStorage.setItem('app-sidebar-collapsed', String(collapsed)); } catch (_) {}
      render();
    }
  });
  close.addEventListener('click', () => setDrawer(false));
  backdrop.addEventListener('click', () => setDrawer(false));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      if (drawerOpen) { event.preventDefault(); setDrawer(false); }
      if (account.open) { event.preventDefault(); account.open = false; summary.focus(); }
    }
    if (drawerOpen && event.key === 'Tab') {
      const controls = [...sidebar.querySelectorAll('a, button')].filter(node => !node.hidden && !node.disabled);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
  document.addEventListener('click', event => { if (!account.contains(event.target)) account.open = false; });
  account.addEventListener('focusout', event => { if (!account.contains(event.relatedTarget)) account.open = false; });
  mobile.addEventListener('change', () => { setDrawer(false); render(); });
  function sessionView() {
    const authenticated = avatar ? Boolean(localStorage.getItem('token')) : !logout.hidden;
    if (!authenticated) { setDrawer(false, false); account.open = false; }
    sidebar.hidden = toggle.hidden = account.hidden = !authenticated;
    document.body.classList.toggle('shell-signed-out', !authenticated);
    render();
  }
  if (!avatar) new MutationObserver(sessionView).observe(logout, { attributes: true, attributeFilter: ['hidden'] });
  sessionView();
  window.i18n.init().then(() => {
    for (const [node, key] of labels) node.textContent = window.i18n.t('appShell.' + key);
    for (const [node, key] of [[toggle, 'toggleNavigation'], [close, 'closeNavigation'], [sidebar, 'navigation'], [navigation, 'navigation']]) node.setAttribute('aria-label', window.i18n.t('appShell.' + key));
    language.setAttribute('aria-label', window.i18n.t('appShell.language'));
    language.value = window.i18n.currentLocale;
    render();
  });
})();
