/** Camera-only input for seated meetings. No movement or combat shortcuts. */
window.MeetingInput = {
  attach(canvas, mouse, state) {
    const listeners = [];
    let pointer = null;
    const on = (target, name, handler, options) => {
      target.addEventListener(name, handler, options);
      listeners.push(() => target.removeEventListener(name, handler, options));
    };
    function release() {
      const id = pointer;
      pointer = null;
      mouse.isDragging = false;
      if (id !== null && canvas.hasPointerCapture?.(id)) canvas.releasePointerCapture(id);
    }
    const previousTouchAction = canvas.style.touchAction;
    canvas.style.touchAction = 'none';
    on(canvas, 'pointerdown', event => {
      if (pointer !== null || event.isPrimary === false) return;
      pointer = event.pointerId;
      mouse.isDragging = true;
      mouse.lastX = event.clientX;
      mouse.lastY = event.clientY;
      canvas.setPointerCapture?.(pointer);
      window.UI?.hideControlsHint();
    });
    on(canvas, 'pointermove', event => {
      if (event.pointerId !== pointer) return;
      const dx = event.clientX - mouse.lastX, dy = event.clientY - mouse.lastY;
      mouse.lastX = event.clientX;
      mouse.lastY = event.clientY;
      if (Math.abs(dx) > 100 || Math.abs(dy) > 100) return;
      mouse.targetRotationY -= dx * mouse.sensitivity;
      mouse.targetRotationX += dy * mouse.sensitivity * (state.cameraMode === 'first-person' ? -1 : 1);
      mouse.targetRotationX = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, mouse.targetRotationX));
    });
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      on(canvas, name, event => { if (event.pointerId === pointer) release(); });
    }
    on(canvas, 'contextmenu', event => event.preventDefault());
    on(window, 'blur', release);
    on(document, 'visibilitychange', () => { if (document.hidden) release(); });
    const close = document.getElementById('close-controls-hint');
    if (close) on(close, 'click', () => window.UI?.hideControlsHint());
    return () => {
      release();
      for (const remove of listeners) remove();
      canvas.style.touchAction = previousTouchAction;
    };
  }
};
