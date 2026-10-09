/* Native modal dialogs for ordinary web pages. No transport or business rules. */
(() => {
  class AppDialog {
    constructor(dialog, fallbackFocus) {
      this.dialog = dialog;
      this.fallbackFocus = fallbackFocus;
      this.busy = false;
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
      }
    }
  }
  window.AppDialog = AppDialog;
})();
