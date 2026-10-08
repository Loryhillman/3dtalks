/** Push-to-talk control for meetings, independent of the RPG skill HUD. */
(() => {
  if (!window.MeetingUI?.active) return;
  function mount() {
    if (document.getElementById('skill-voice-btn')) return;
    const button = document.createElement('button');
    // Retain this ID while the shared voice manager still uses it.
    button.id = 'skill-voice-btn'; button.type = 'button';
    const icon = document.createElement('span'); icon.className = 'sv-icon'; icon.textContent = '🎤'; icon.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span'); label.className = 'sv-label'; label.dataset.i18n = 'skillHud.voice';
    button.append(icon, label); document.body.append(button);
    function translate() {
      label.textContent = window.i18n.t('skillHud.voice');
      button.title = window.i18n.t('meetingUi.holdToTalk');
      button.setAttribute('aria-label', button.title);
    }
    let held = false;
    function start() {
      if (held) return;
      held = true;
      Promise.resolve(window.voiceChat?.startTalk()).catch(error => {
        held = false; console.warn('[Voice] Recording failed:', error.message);
      });
    }
    function stop() {
      if (!held) return;
      held = false; window.voiceChat?.stopTalk();
    }
    button.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      event.preventDefault(); event.stopPropagation();
      button.setPointerCapture(event.pointerId); start();
    });
    for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(event, stop);
    button.addEventListener('keydown', event => {
      if (![' ', 'Enter'].includes(event.key)) return;
      event.preventDefault(); if (!event.repeat) start();
    });
    button.addEventListener('keyup', event => {
      if ([' ', 'Enter'].includes(event.key)) { event.preventDefault(); stop(); }
    });
    button.addEventListener('blur', stop);
    window.addEventListener('blur', stop);
    document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
    translate(); window.i18n.onLocaleChange(translate);
    window.i18n.init().then(translate);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
