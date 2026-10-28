/** Upload furniture into the shared library without changing the current room. */
window.RoomModelUpload = {
  async upload(file, {profile='furniture',signal,onProgress}={}) {
    const tr = key => window.i18n.t('roomEditor.' + key);
    if (!/\.glb$/i.test(file.name)) throw new Error(tr('glbRequired'));
    if (file.size > 100 * 1024 * 1024) throw new Error(tr('modelTooLarge'));
    const body = new FormData();
    body.append('model', file);
    body.append('display_name', file.name.replace(/\.glb$/i, ''));
    body.append('profile',profile);
    const response = onProgress ? await new Promise((resolve,reject)=>{
      const xhr=new XMLHttpRequest();
      const abort=()=>xhr.abort();
      const finish=()=>signal?.removeEventListener('abort',abort);
      xhr.open('POST','/api/admin/rooms/models/upload');
      xhr.setRequestHeader('Authorization','Bearer '+localStorage.getItem('adminToken'));
      xhr.upload.onprogress=e=>{if(e.lengthComputable)onProgress(Math.round(e.loaded/e.total*100));};
      xhr.onload=()=>{finish();resolve({ok:xhr.status>=200&&xhr.status<300,status:xhr.status,json:async()=>JSON.parse(xhr.responseText)});};
      xhr.onerror=()=>{finish();reject(new Error(tr('modelUploadFailed')));};
      xhr.onabort=()=>{finish();reject(new DOMException('Upload cancelled','AbortError'));};
      xhr.timeout=120000;xhr.ontimeout=()=>{finish();reject(new Error(tr('modelUploadFailed')));};
      if(signal?.aborted)return reject(new DOMException('Upload cancelled','AbortError'));
      signal?.addEventListener('abort',abort,{once:true});xhr.send(body);
    }) : await fetch('/api/admin/rooms/models/upload', {
      method: 'POST', headers: { Authorization: 'Bearer ' + localStorage.getItem('adminToken') }, body, signal
    });
    const data = await response.json().catch(() => ({}));
    if ([401, 403].includes(response.status)) window.RoomAdmin?.expire();
    if (!response.ok || !data.success || !data.model?.id) {
      const translated = data.errorKey && window.i18n.t(data.errorKey);
      throw new Error(translated && translated !== data.errorKey ? translated : tr('modelUploadFailed'));
    }
    return { ...data.model, name: data.model.display_name || data.model.file_name };
  }
};
