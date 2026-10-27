// Editor references use the same server-owned default as account and room avatars.
(() => {
  let pending;
  async function load() {
    if (!pending) pending = (async () => {
      const controller = new AbortController(), deadline = setTimeout(() => controller.abort(), 15000);
      try {
        const response = await fetch('/api/admin/rooms/avatar-catalog', {signal:controller.signal,
          headers:{Authorization:'Bearer '+(localStorage.getItem('adminToken')||'')}});
        if (!response.ok) throw Error('AVATAR_CATALOG_UNAVAILABLE');
        const data = await response.json();
        if (data.defaultConfig?.mode !== 'builtin' || !data.defaultConfig.asset?.path) throw Error('INVALID_AVATAR_CATALOG');
        return data;
      } finally { clearTimeout(deadline); }
    })().catch(error => {pending=null;throw error;});
    return pending;
  }
  window.BuiltinAvatarCatalog = {
    load,
    async applyDefault(group,id) {
      const data = await load();
      if (!group.parent) return;
      const config=id?data.presets.find(p=>p.id===id)?.config:data.defaultConfig;
      if(!config)throw Error('INVALID_AVATAR_PRESET');
      await window.UserAvatarRenderer.apply(group,config);
      if (group.userData.accountAvatarError) throw Error(group.userData.accountAvatarError);
    }
  };
})();
