/** Room avatars come from the account, never from legacy template storage. */
window.RoomAvatarSession = {
  async prepare() {
    const response = await fetch('/api/my/avatar', {
      headers: { Authorization: 'Bearer ' + localStorage.getItem('token') }
    });
    if (!response.ok) throw new Error(window.i18n.t('avatar.SERVICE_ERROR'));
    const data = await response.json();
    if (!data.config || typeof data.config !== 'object' || Array.isArray(data.config)) {
      throw new Error(window.i18n.t('avatar.SERVICE_ERROR'));
    }
    return { accountAvatar: data.config, selectedGlbUrl: null, finalGlbUrl: null,
      selectedAnimUrls: {}, selectedWeaponConfig: null, templateData: null,
      boneMapConfig: null, weaponSocketConfig: null, calibrationConfig: null,
      scheduleLoadAnims() {} };
  }
};
