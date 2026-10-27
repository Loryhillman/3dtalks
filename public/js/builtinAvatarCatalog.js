// Editor references use the same server-owned default as account and room avatars.
(() => {
  let pending;
  async function load() {
    if (!pending) pending = (async () => {
      const controller = new AbortController(), deadline = setTimeout(() => controller.abort(), 15000);
      try {
        const response = await fetch('/api/my/avatar/catalog', {signal:controller.signal,
          headers:{Authorization:'Bearer '+(localStorage.getItem('token')||'')}});
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
    async applyDefault(group) {
      const data = await load();
      if (!group.parent) return;
      await window.UserAvatarRenderer.apply(group,data.defaultConfig);
      if (group.userData.accountAvatarError) throw Error(group.userData.accountAvatarError);
    }
  };
})();
