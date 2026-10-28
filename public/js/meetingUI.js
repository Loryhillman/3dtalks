/** Meeting presentation for the shared player page. Keeps existing chat/voice handlers. */
(() => {
  const requested = new URLSearchParams(location.search).get('room');
  let active = location.pathname === '/play' || !!requested && requested !== 'main';
  let footer, toolbar, room, observer, resizeObserver, history, empty, logObserver, connectionObserver, cameraToggle, menu, menuToggle, menuObserver, chatToggle, unread=0, stopped=false;
  const tr = (key, fallback) => {
    const value = window.i18n?.t('meetingUi.' + key);
    return value && value !== 'meetingUi.' + key ? value : fallback;
  };
  if (active) document.documentElement.classList.add('meeting-session');
  function refreshToggles() {
    if (stopped) return;
    if (menuToggle) {
      // Keep blocked autoplay/retry discoverable while the controls are folded.
      const attention = menu.querySelector('.presentation-video-local button:not([hidden])');
      const caption = tr(menu.hidden ? 'openMenu' : 'closeMenu', menu.hidden ? 'Menu' : 'Close menu');
      const text = caption + (menu.hidden && attention ? ' · !' : '');
      if (menuToggle.textContent !== text) menuToggle.textContent = text;
      menuToggle.dataset.attention = String(!!attention);
      menuToggle.setAttribute('aria-expanded', String(!menu.hidden));
      menuToggle.setAttribute('aria-label', caption + (attention ? ' · ' + attention.textContent : ''));
    }
    if (chatToggle) {
      const open = footer.dataset.chatOpen === 'true';
      chatToggle.textContent = open ? '×' : tr('openChat', 'Chat') + (unread ? ' · ' + (unread > 99 ? '99+' : unread) : '');
      chatToggle.setAttribute('aria-expanded', String(open));
      chatToggle.setAttribute('aria-label', tr(open ? 'closeChat' : 'openChat', open ? 'Hide chat' : 'Chat') + (unread ? ' · ' + unread : ''));
    }
  }
  function setMenu(open, restore = false) {
    if (stopped || !menu) return;
    if (open) window.RoomSeating?.dismissPicker?.();
    menu.hidden = !open;
    refreshToggles();
    if (!open && restore) menuToggle.focus();
    measure();
  }
  function setChat(open, restore = false) {
    if (stopped || !footer) return;
    if (open) window.RoomSeating?.dismissPicker?.();
    footer.dataset.chatOpen = String(open);
    history.open = open;
    if (open) unread = 0;
    refreshToggles();
    if (!open && restore) chatToggle.focus();
    measure();
  }
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
    if(chat&&history&&chat.parentElement!==history){chat.setAttribute('role','log');chat.setAttribute('aria-live','polite');chat.setAttribute('aria-relevant','additions');chat.tabIndex=0;history.append(chat);logObserver=new MutationObserver(records=>{empty.hidden=!!chat.children.length;if(footer.dataset.chatOpen!=='true'||!history.open)unread+=records.reduce((n,r)=>n+[...r.addedNodes].filter(e=>e.nodeType===1&&e.classList.contains('chat-message')).length,0);refreshToggles();measure();});logObserver.observe(chat,{childList:true});}
    if(empty&&empty.hidden!==!!chat?.children.length)empty.hidden=!!chat?.children.length;
    const language = document.getElementById('btn-language');
    if(language)language.classList.add('ui-button','ui-button--ghost');
    if (toolbar && language && language.parentElement !== toolbar.querySelector('.meeting-actions')) toolbar.querySelector('.meeting-actions').append(language);
    if(toolbar&&language&&chat?.parentElement===history&&['nearby-chat-wrap','skill-voice-btn'].every(id=>document.getElementById(id)?.parentElement===footer))observer?.disconnect();
    measure();
  }
  function refresh() {
    if(stopped)return;refreshToggles();
    if (footer) {
      footer.setAttribute('aria-label', tr('communication', 'Communication'));
      history.querySelector('summary').textContent=tr('messages','Room messages');empty.textContent=tr('emptyChat','Messages will appear here.');
      const input=document.getElementById('nearby-chat-input');if(input){input.placeholder=tr('messagePlaceholder','Message the room…');input.setAttribute('aria-label',tr('messageLabel','Message to the room'));}
    }
    if (cameraToggle) {
      const first=window.GAME_STATE?.cameraMode==='first-person';
      cameraToggle.textContent=tr(first?'cameraOverview':'cameraFirstPerson',first?'Overview':'First-person view');
      cameraToggle.setAttribute('aria-pressed',String(first));
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
      empty=document.createElement('p');empty.className='meeting-chat-empty';history.append(empty);history.addEventListener('toggle',()=>{if(history.open&&footer.dataset.chatOpen==='true'){unread=0;refreshToggles();}measure();});footer.append(history);
      footer.dataset.chatOpen='false';chatToggle=document.createElement('button');chatToggle.type='button';chatToggle.id='meeting-chat-toggle';chatToggle.className='ui-button';chatToggle.setAttribute('aria-controls','nearby-chat-wrap chatBox');chatToggle.onclick=()=>setChat(footer.dataset.chatOpen!=='true');footer.append(chatToggle);
      footer.addEventListener('keydown',event=>{if(event.key==='Escape'&&!event.isComposing&&event.keyCode!==229&&footer.dataset.chatOpen==='true'){event.preventDefault();event.stopPropagation();setChat(false,true);}},true); footer.setAttribute('role', 'group'); document.body.append(footer);
      observer = new MutationObserver(adoptControls); observer.observe(document.body, { childList: true, subtree: true });
      resizeObserver = new ResizeObserver(measure); resizeObserver.observe(footer);
      window.addEventListener('resize', measure);
      window.visualViewport?.addEventListener('resize', measure);window.visualViewport?.addEventListener('scroll',measure);
      window.i18n?.onLocaleChange(refresh);
      // Initial catalog loading does not emit a locale-change event.
      window.i18n?.init().then(refresh).catch(error=>console.warn('[MeetingUI] Translation initialization failed:',error.message));
    }
    adoptControls(); refresh();
  }
  window.MeetingUI = {
    get active() { return active; },
    setMenu, setChat,
    stop() {
      if(stopped)return;stopped=true;observer?.disconnect();logObserver?.disconnect();resizeObserver?.disconnect();connectionObserver?.disconnect();menuObserver?.disconnect();
      window.removeEventListener('resize',measure);window.visualViewport?.removeEventListener('resize',measure);window.visualViewport?.removeEventListener('scroll',measure);
      window.MeetingVoiceControl?.dispose();
      window.MeetingRoomPanel?.dispose();
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
      const quick=document.createElement('div');quick.className='meeting-quick-actions';quick.append(actions.querySelector('#room-places-toggle'));
      menu=document.createElement('div');menu.id='meeting-menu';menu.hidden=true;menu.append(actions);menuObserver=new MutationObserver(refreshToggles);menuObserver.observe(menu,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden']});
      menuToggle=document.createElement('button');menuToggle.type='button';menuToggle.id='meeting-menu-toggle';menuToggle.className='ui-button ui-button--ghost';menuToggle.setAttribute('aria-controls',menu.id);menuToggle.onclick=()=>setMenu(menu.hidden);
      const header=document.createElement('div');header.className='meeting-header';header.append(identity,menuToggle);toolbar.replaceChildren(header,quick,menu);
      toolbar.addEventListener('keydown',event=>{if(event.key==='Escape'&&!menu.hidden){event.preventDefault();event.stopPropagation();setMenu(false,true);}});
      cameraToggle=document.createElement('button');cameraToggle.type='button';cameraToggle.id='meeting-camera-toggle';cameraToggle.className='ui-button';
      cameraToggle.addEventListener('click',()=>{
        if(stopped||!window.GAME_STATE)return;
        GAME_STATE.cameraMode=GAME_STATE.cameraMode==='first-person'?'third-person':'first-person';
        refresh();
      });
      quick.append(cameraToggle);
      mount(); window.MeetingRoomPanel?.mount(toolbar);const tools=toolbar.querySelector('.meeting-room-tools');if(tools)menu.append(tools);resizeObserver.observe(toolbar); measure();
    }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
