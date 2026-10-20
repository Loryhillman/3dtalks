/** Meeting presentation for the shared player page. Keeps existing chat/voice handlers. */
(() => {
  const requested = new URLSearchParams(location.search).get('room');
  let active = location.pathname === '/play' || !!requested && requested !== 'main';
  let footer, toolbar, room, observer, resizeObserver, history, empty, logObserver, connectionObserver, stopped=false;
  const tr = (key, fallback) => {
    const value = window.i18n?.t('meetingUi.' + key);
    return value && value !== 'meetingUi.' + key ? value : fallback;
  };
  if (active) document.documentElement.classList.add('meeting-session');
  function measure() {
    if(stopped)return;
    const viewport=window.visualViewport;
    document.documentElement.classList.toggle('meeting-short-viewport',(viewport?.height||innerHeight)<480);
    document.documentElement.style.setProperty('--meeting-visible-top',(viewport?.offsetTop||0)+'px');
    document.documentElement.style.setProperty('--meeting-visible-bottom',Math.max(0,innerHeight-(viewport?.offsetTop||0)-(viewport?.height||innerHeight))+'px');
    document.documentElement.style.setProperty('--meeting-visible-height',(viewport?.height||innerHeight)+'px');
    if (toolbar) document.documentElement.style.setProperty('--meeting-top-edge', Math.ceil(toolbar.getBoundingClientRect().bottom + 10) + 'px');
    if(footer)document.documentElement.style.setProperty('--meeting-footer-height',Math.ceil(footer.getBoundingClientRect().height)+'px');
    if (footer) document.documentElement.style.setProperty('--meeting-bottom-space', Math.ceil(innerHeight - footer.getBoundingClientRect().top + 10) + 'px');
  }
  function adoptControls() {
    if(stopped)return;
    for (const id of ['nearby-chat-wrap', 'skill-voice-btn']) {
      const element = document.getElementById(id);
      if (element && element.parentElement !== footer) {footer.append(element);if(id==='nearby-chat-wrap')element.classList.add('meeting-composer');}
    }
    const chat=document.getElementById('chatBox');
    if(chat&&history&&chat.parentElement!==history){chat.setAttribute('role','log');chat.setAttribute('aria-live','polite');chat.setAttribute('aria-relevant','additions');chat.tabIndex=0;history.append(chat);logObserver=new MutationObserver(()=>{empty.hidden=!!chat.children.length;measure();});logObserver.observe(chat,{childList:true});}
    if(empty&&empty.hidden!==!!chat?.children.length)empty.hidden=!!chat?.children.length;
    const language = document.getElementById('btn-language');
    if(language)language.classList.add('ui-button','ui-button--ghost');
    if (toolbar && language && language.parentElement !== toolbar.querySelector('.meeting-actions')) toolbar.querySelector('.meeting-actions').append(language);
    if(toolbar&&language&&chat?.parentElement===history&&['nearby-chat-wrap','skill-voice-btn'].every(id=>document.getElementById(id)?.parentElement===footer))observer?.disconnect();
    measure();
  }
  function refresh() {
    if(stopped)return;
    if (footer) {
      footer.setAttribute('aria-label', tr('communication', 'Communication'));
      history.querySelector('summary').textContent=tr('messages','Room messages');empty.textContent=tr('emptyChat','Messages will appear here.');
      const input=document.getElementById('nearby-chat-input');if(input){input.placeholder=tr('messagePlaceholder','Message the room…');input.setAttribute('aria-label',tr('messageLabel','Message to the room'));}
    }
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
    if (stopped || !active || !document.body) return;
    if (!footer) {
      footer = document.createElement('div'); footer.id = 'meeting-footer';footer.className='meeting-ui';
      history=document.createElement('details');history.className='meeting-history';const summary=document.createElement('summary');summary.className='ui-button ui-button--ghost';history.append(summary);summary.addEventListener('keydown',event=>{event.stopPropagation();if(event.key==='Escape'&&history.open){history.open=false;summary.focus();}});summary.addEventListener('keyup',event=>event.stopPropagation());
      empty=document.createElement('p');empty.className='meeting-chat-empty';history.append(empty);history.addEventListener('toggle',measure);footer.append(history); footer.setAttribute('role', 'group'); document.body.append(footer);
      observer = new MutationObserver(adoptControls); observer.observe(document.body, { childList: true, subtree: true });
      resizeObserver = new ResizeObserver(measure); resizeObserver.observe(footer);
      window.addEventListener('resize', measure);
      window.visualViewport?.addEventListener('resize', measure);window.visualViewport?.addEventListener('scroll',measure);
      window.i18n?.onLocaleChange(refresh);
    }
    adoptControls(); refresh();
  }
  window.MeetingUI = {
    get active() { return active; },
    stop() {
      if(stopped)return;stopped=true;observer?.disconnect();logObserver?.disconnect();resizeObserver?.disconnect();connectionObserver?.disconnect();
      window.removeEventListener('resize',measure);window.visualViewport?.removeEventListener('resize',measure);window.visualViewport?.removeEventListener('scroll',measure);
      window.MeetingVoiceControl?.dispose();
      for(const item of [toolbar,footer,document.getElementById('room-seat-picker')])if(item){item.inert=false;item.hidden=true;}
      document.getElementById('chatBox')?.replaceChildren();const overlay=document.getElementById('room-connection-overlay');if(overlay)overlay.style.display='none';
    },
    connectOverlay(overlay) {
      if(stopped||!active)return;const status=overlay.querySelector('[data-status]');status.id='meeting-connection-status';overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');overlay.setAttribute('aria-labelledby',status.id);
      let previousFocus,shown=false;
      const sync=()=>{
        if(stopped)return;const visible=overlay.style.display!=='none';
        for(const item of [toolbar,footer,document.getElementById('room-seat-picker')])if(item)item.inert=visible;
        if(visible&&!shown){previousFocus=document.activeElement;overlay.querySelector('button')?.focus();}
        else if(!visible&&shown&&previousFocus?.isConnected&&!previousFocus.disabled)previousFocus.focus({preventScroll:true});
        shown=visible;
      };
      overlay.addEventListener('keydown',event=>{event.stopPropagation();if(event.key!=='Tab')return;
        const nodes=[...overlay.querySelectorAll('button')].filter(n=>!n.disabled),first=nodes[0],last=nodes.at(-1);
        if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
      });
      connectionObserver?.disconnect();connectionObserver=new MutationObserver(sync);connectionObserver.observe(overlay,{attributes:true,attributeFilter:['style']});sync();
    },
    enter(value, bar) {
      if(stopped)return;active = true; room = value; toolbar = bar;
      document.documentElement.classList.add('meeting-session');
      toolbar.id = 'meeting-toolbar';toolbar.classList.add('meeting-ui');
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
