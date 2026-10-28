/* Native modal dialogs for ordinary web pages. No transport or business rules. */
(() => {
  class AppDialog {
    constructor(dialog, fallbackFocus, onSettled = () => {}) {
      this.dialog = dialog;
      this.fallbackFocus = fallbackFocus;
      this.busy = false;
      this.onSettled = onSettled;
      dialog.addEventListener('cancel', event => { event.preventDefault(); this.close(); });
      dialog.addEventListener('close', () => { if (!dialog.open) this.restore(); });
      for (const button of dialog.querySelectorAll('[data-dialog-close]')) button.addEventListener('click', () => this.close());
      dialog.addEventListener('input', event => {
        if (event.target.name) this.fieldError(event.target, '');
      });
      dialog.addEventListener('keydown', event => {
        if (event.key !== 'Tab') return;
        const controls = [...dialog.querySelectorAll('button, input, select, textarea, a[href]')]
          .filter(node => !node.disabled && node.getClientRects().length);
        const first = controls[0], last = controls.at(-1);
        if (!first) { event.preventDefault(); return; }
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      });
    }
    open(opener = document.activeElement) {
      if (this.dialog.open || this.busy) return;
      this.clearErrors();
      this.opener = opener;
      this.overflow = document.body.style.overflow;
      this.active = true;
      this.dialog.showModal();
      document.body.style.overflow = 'hidden';
      this.dialog.querySelector('[autofocus]')?.focus();
    }
    close(force = false) {
      if ((!force && this.busy) || !this.dialog.open) return;
      this.dialog.close();
      this.restore();
    }
    restore() {
      if (!this.active) return;
      this.active = false;
      document.body.style.overflow = this.overflow;
      const target = this.opener?.isConnected && this.opener.getClientRects().length ? this.opener : this.fallbackFocus();
      target?.focus({ preventScroll: true });
    }
    clearErrors() {
      this.dialog.querySelector('[data-dialog-error]').textContent = '';
      for (const field of this.dialog.querySelectorAll('[aria-invalid]')) this.fieldError(field, '');
    }
    fieldError(field, text) {
      const output = document.getElementById(field.getAttribute('aria-describedby'));
      if (output) output.textContent = text;
      if (text) field.setAttribute('aria-invalid', 'true');
      else field.removeAttribute('aria-invalid');
    }
    async submit(fn, onError) {
      if (this.busy || !this.dialog.open) return;
      this.clearErrors();
      this.busy = true;
      const controls = [...this.dialog.querySelectorAll('button, input, select')];
      const disabled = controls.map(node => node.disabled);
      controls.forEach(node => { node.disabled = true; });
      this.dialog.setAttribute('aria-busy', 'true');
      try { await fn(); }
      catch (error) { if (this.dialog.open) onError(error); }
      finally {
        controls.forEach((node, i) => { node.disabled = disabled[i]; });
        this.dialog.removeAttribute('aria-busy');
        this.busy = false;
        this.onSettled();
      }
    }
  }
  window.AppDialog = AppDialog;
  class AppToasts {
    constructor(closeLabel) {
      this.closeLabel = closeLabel;
      this.queue = [];
      this.active = new Map();
      this.host = document.createElement('div');
      this.host.className = 'ui-toasts';
      document.body.append(this.host);
      window.addEventListener('pagehide', () => this.clear(), { once: true });
    }
    show(text, type = 'info') {
      if (!text) return;
      this.queue.push({ text, type: ['success', 'info', 'error'].includes(type) ? type : 'info' });
      this.flush();
    }
    flush() {
      while (this.active.size < 3 && this.queue.length) {
        const { text, type } = this.queue.shift();
        const toast = document.createElement('div'); toast.className = 'ui-toast ui-toast--' + type;
        toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
        const icon = document.createElement('span'); icon.className = 'ui-toast-icon'; icon.setAttribute('aria-hidden', 'true');
        const content = document.createElement('span'); content.textContent = text;
        const close = document.createElement('button'); close.type = 'button'; close.className = 'ui-button ui-button--ghost ui-toast-close';
        close.dataset.shellControl = ''; close.setAttribute('aria-label', this.closeLabel());
        const closeIcon = document.createElement('img'); closeIcon.src = '/icons/lucide/x.svg'; closeIcon.alt = ''; closeIcon.width = closeIcon.height = 20;
        close.append(closeIcon);
        close.addEventListener('click', () => this.dismiss(toast));
        toast.append(icon, content, close); this.host.append(toast);
        const timer = type === 'error' ? null : setTimeout(() => this.dismiss(toast), type === 'success' ? 4000 : 5000);
        this.active.set(toast, timer);
      }
    }
    dismiss(toast) {
      if (!this.active.has(toast) || toast.dataset.dismissing) return;
      clearTimeout(this.active.get(toast)); toast.dataset.dismissing = 'true';
      const finish = () => {
        const focused = toast.contains(document.activeElement);
        this.active.delete(toast); toast.remove(); this.flush();
        if (focused) (this.host.querySelector('button') || document.getElementById('app-content'))?.focus({ preventScroll: true });
      };
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) finish();
      else {
        toast.classList.add('ui-toast--leaving');
        this.active.set(toast, setTimeout(finish, 200));
      }
    }
    clear() {
      for (const [toast, timer] of this.active) { clearTimeout(timer); toast.remove(); }
      this.active.clear(); this.queue = [];
    }
  }
  window.AppToasts = AppToasts;
})();
