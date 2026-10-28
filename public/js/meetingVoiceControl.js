/** Push-to-talk control for meetings, independent of the RPG skill HUD. */
(() => {
  if (!window.MeetingUI?.active) return;
  function mount() {
    if (document.getElementById('skill-voice-btn')) return;
    const button = document.createElement('button');
    // Retain this ID while the shared voice manager still uses it.
    button.id = 'skill-voice-btn'; button.type = 'button';
    const icon = document.createElement('span'); icon.className = 'sv-icon';  icon.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span'); label.className = 'sv-label'; label.dataset.i18n = 'meetingUi.microphone';label.setAttribute('aria-live','polite');
    const muted=document.createElement('span');muted.className='sv-muted';muted.hidden=true;button.append(icon, label,muted); document.body.append(button);
    function translate() {
      if(disposed)return;
      if(window.voiceChat?.isRealtime){window.voiceChat.render();return;}
      label.dataset.i18n=button.classList.contains('voice-disabled')?'meetingUi.voiceUnavailable':button.classList.contains('listening')?'meetingUi.recording':'meetingUi.microphone';label.textContent=window.i18n.t(label.dataset.i18n);
      muted.textContent=window.i18n.t('meetingUi.playbackMuted');muted.hidden=!button.classList.contains('voice-muted');
      button.title = window.i18n.t('meetingUi.holdToTalk');
      button.setAttribute('aria-label',label.textContent+'. '+(!muted.hidden?muted.textContent+'. ':'')+button.title);button.setAttribute('aria-disabled',String(button.classList.contains('voice-disabled')));
    }
    const stateObserver=new MutationObserver(translate);stateObserver.observe(button,{attributes:true,attributeFilter:['class']});
    let held = false,disposed=false;
    function start() {
      if (disposed||held) return;
      if(window.voiceChat?.isRealtime){if(window.voiceChat.recording||window.voiceChat.wantRecording)window.voiceChat.stopTalk();else void window.voiceChat.startTalk();return;}
      held = true;
      Promise.resolve(window.voiceChat?.startTalk()).catch(error => {
        held = false; console.warn('[Voice] Recording failed:', error.message);
      });
    }
    function stop() {
      if(window.voiceChat?.isRealtime)return;
      if (!held) return;
      held = false; window.voiceChat?.stopTalk();
    }
    button.addEventListener('pointerdown', event => {
      if(window.voiceChat?.isRealtime)return; // Native click also supports assistive technology.
      if (event.button !== 0) return;
      event.preventDefault(); event.stopPropagation();
      button.setPointerCapture(event.pointerId); start();
    });
    for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(event, stop);
    button.addEventListener('keydown', event => {
      if (![' ', 'Enter'].includes(event.key)) return;
      if(window.voiceChat?.isRealtime){event.stopPropagation();return;}
      event.preventDefault();event.stopPropagation(); if (!event.repeat) start();
    });
    button.addEventListener('keyup', event => {
      if(window.voiceChat?.isRealtime){if([' ','Enter'].includes(event.key))event.stopPropagation();return;}
      if ([' ', 'Enter'].includes(event.key)) { event.preventDefault();event.stopPropagation(); stop(); }
    });
    button.addEventListener('click',event=>{
      if(!window.voiceChat?.isRealtime)return;
      event.preventDefault();event.stopPropagation();start();
    });
    button.addEventListener('blur', stop);
    window.addEventListener('blur', stop);
    const visibility=()=>{if(document.hidden)stop();};document.addEventListener('visibilitychange',visibility);
    window.MeetingVoiceControl={dispose(){if(disposed)return;stop();disposed=true;stateObserver.disconnect();window.removeEventListener('blur',stop);document.removeEventListener('visibilitychange',visibility);button.disabled=true;}};
    translate(); window.i18n.onLocaleChange(translate);
    window.i18n.init().then(translate);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
