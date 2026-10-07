/** Meeting presentation for the shared player page. Keeps existing chat/voice handlers. */
(() => {
  const requested = new URLSearchParams(location.search).get('room');
  let active = location.pathname === '/play' || !!requested && requested !== 'main';
  let footer, toolbar, room, observer, resizeObserver;
  const tr = (key, fallback) => {
    const value = window.i18n?.t('meetingUi.' + key);
    return value && value !== 'meetingUi.' + key ? value : fallback;
  };
  if (active) document.documentElement.classList.add('meeting-session');
  function measure() {
    if (toolbar) document.documentElement.style.setProperty('--meeting-top-edge', Math.ceil(toolbar.getBoundingClientRect().bottom + 10) + 'px');
    if (footer) document.documentElement.style.setProperty('--meeting-bottom-space', Math.ceil(innerHeight - footer.getBoundingClientRect().top + 10) + 'px');
  }
  function adoptControls() {
    for (const id of ['nearby-chat-wrap', 'skill-voice-btn']) {
      const element = document.getElementById(id);
      if (element && element.parentElement !== footer) footer.append(element);
    }
    const language = document.getElementById('btn-language');
    if (toolbar && language && language.parentElement !== toolbar.querySelector('.meeting-actions')) toolbar.querySelector('.meeting-actions').append(language);
    if (toolbar && language && ['nearby-chat-wrap','skill-voice-btn'].every(id => document.getElementById(id)?.parentElement === footer)) observer?.disconnect();
    measure();
  }
  function refresh() {
    if (footer) footer.setAttribute('aria-label', tr('communication', 'Communication'));
    if (toolbar) {
      toolbar.setAttribute('aria-label', tr('controls', 'Room controls'));
      toolbar.querySelectorAll('[data-i18n]').forEach(element => {
        const value = window.i18n?.t(element.dataset.i18n);
        if (value && value !== element.dataset.i18n) element.textContent = value;
      });
      const language = document.getElementById('btn-language');
      if (language) { language.setAttribute('aria-label', tr('language', 'Change language')); language.title = tr('language', 'Change language'); }
    }
  }
  function mount() {
    if (!active || !document.body) return;
    if (!footer) {
      footer = document.createElement('div'); footer.id = 'meeting-footer'; footer.setAttribute('role', 'group'); document.body.append(footer);
      observer = new MutationObserver(adoptControls); observer.observe(document.body, { childList: true, subtree: true });
      resizeObserver = new ResizeObserver(measure); resizeObserver.observe(footer);
      window.addEventListener('resize', measure);
      window.visualViewport?.addEventListener('resize', measure);
      window.i18n?.onLocaleChange(refresh);
    }
    adoptControls(); refresh();
  }
  window.MeetingUI = {
    get active() { return active; },
    enter(value, bar) {
      active = true; room = value; toolbar = bar;
      document.documentElement.classList.add('meeting-session');
      toolbar.id = 'meeting-toolbar';
      const identity = document.createElement('div'); identity.className = 'meeting-identity';
      const name = document.createElement('strong'); name.textContent = room.name; name.title = room.name; identity.append(name);
      const capacity = toolbar.querySelector('span');
      if (capacity) { capacity.className = 'meeting-capacity'; identity.append(capacity); }
      const actions = document.createElement('div'); actions.className = 'meeting-actions';
      for (const child of [...toolbar.children]) actions.append(child);
      toolbar.replaceChildren(identity, actions);
      mount(); resizeObserver.observe(toolbar); measure();
    }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
