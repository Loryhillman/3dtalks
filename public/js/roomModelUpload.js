/** Upload furniture into the shared library without changing the current room. */
window.RoomModelUpload = {
  async upload(file) {
    const tr = key => window.i18n.t('roomEditor.' + key);
    if (!/\.glb$/i.test(file.name)) throw new Error(tr('glbRequired'));
    if (file.size > 100 * 1024 * 1024) throw new Error(tr('modelTooLarge'));
    const body = new FormData();
    body.append('model', file);
    body.append('display_name', file.name.replace(/\.glb$/i, ''));
    const response = await fetch('/api/admin/rooms/models/upload', {
      method: 'POST', headers: { Authorization: 'Bearer ' + localStorage.getItem('adminToken') }, body
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success || !data.model?.id) {
      const translated = data.errorKey && window.i18n.t(data.errorKey);
      throw new Error(translated && translated !== data.errorKey ? translated : tr('modelUploadFailed'));
    }
    return { ...data.model, name: data.model.display_name || data.model.file_name };
  }
};
