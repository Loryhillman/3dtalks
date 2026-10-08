/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/** Legacy world character preparation, isolated from account avatars. */
window.LegacyAvatarSession = {
  async prepare() {
    let templateData = null;
    // 读取已选角色模板 GLB 及所有MVP动画
    // 防御字符串 "null"（localStorage.setItem('key', null) 会存入字符串 "null"）
    let selectedGlbUrl = (() => {
      const v = localStorage.getItem('selectedTemplateGlbUrl');
      return (!v || v === 'null' || v.trim() === '') ? null : v;
    })();
    const selectedWalkUrl = localStorage.getItem('selectedTemplateWalkUrl') || null;
    const selectedRunUrl = localStorage.getItem('selectedTemplateRunUrl') || null;
    const selectedTemplateId = localStorage.getItem('selectedTemplateId') || null;
    // 读取武器配置
    let selectedWeaponConfig = null;
    try {
      const wcRaw = localStorage.getItem('selectedTemplateWeaponConfig');
      if (wcRaw) selectedWeaponConfig = JSON.parse(wcRaw);
    } catch(e) {}
    // 读取全部基础动画URL（不限制文件名白名单，支持所有新建角色模板）
    const MVP_ANIM_KEYS = ['idle','walk','run','jump','attack1','attack2','attack3','hit','death',
      'turn_left','turn_right','attack_stab','attack_slash','attack_swing','attack_uppercut','draw_sword','sheath'];
    const selectedAnimUrls = {};
    MVP_ANIM_KEYS.forEach(k => {
      const v = localStorage.getItem('selectedTemplateAnim_'+k);
      if (v && v.trim() !== '') selectedAnimUrls[k] = v;
    });
    // 兼容旧存储（walk/run）
    if (!selectedAnimUrls.walk && selectedWalkUrl) selectedAnimUrls.walk = selectedWalkUrl;
    if (!selectedAnimUrls.run  && selectedRunUrl)  selectedAnimUrls.run  = selectedRunUrl;
    // 读取扩展技能动画URL
    try {
      const skillAnimsRaw = localStorage.getItem('selectedTemplateSkillAnims');
      if (skillAnimsRaw) {
        const skillAnims = JSON.parse(skillAnimsRaw);
        skillAnims.forEach(s => {
          if (s.id && s.anim_glb_url) {
            selectedAnimUrls['skill_' + s.id] = s.anim_glb_url;
          }
        });
      }
    } catch(e) { console.warn('[main] 读取技能动画缓存失败', e); }

    if (selectedGlbUrl) {
      console.log('🎭 使用角色模板 GLB:', selectedGlbUrl,
        '| 已配置动画:', Object.keys(selectedAnimUrls).join('/'));
    }

    // 加载动画的函数（统一入口，接收实际生效的 glbUrl 参数，避免闭包旧值问题）
    const scheduleLoadAnims = (animUrls, effectiveGlbUrl, world, characterId) => {
      const glb = effectiveGlbUrl || selectedGlbUrl;
      if (!glb || Object.keys(animUrls).length === 0) return;
      console.log('🎬 开始加载动画，模型URL:', glb, '动画列表:', Object.keys(animUrls).join('/'));
      Object.entries(animUrls).forEach(([type, url]) => {
        if (url) world._loadPlayerAnimGlb(characterId, type, url);
      });
    };

    // 从API加载模板完整配置的函数（统一入口）
    const loadTemplateFromApi = (resolvedGlbUrlArg) => {
      return fetch('/api/public/character-templates')
        .then(r => {
          if (!r.ok) throw new Error(`Character templates: HTTP ${r.status}`);
          return r.json();
        })
        .then(data => {
          if (!Array.isArray(data.templates)) throw new Error('Invalid character template response');
          const templates = data.templates;
          // 优先按 templateId 匹配，fallback 用 glbUrl 反查
          let tmpl = selectedTemplateId
            ? templates.find(t => String(t.id) === String(selectedTemplateId))
            : null;
          if (!tmpl) {
            const glbToMatch = resolvedGlbUrlArg || selectedGlbUrl;
            if (glbToMatch) {
              tmpl = templates.find(t => t.glb_url && (
                t.glb_url === glbToMatch ||
                glbToMatch.endsWith(t.glb_url) ||
                t.glb_url.endsWith(glbToMatch.replace(/^.*\/uploads\//, '/uploads/'))
              ));
              if (tmpl) {
                console.log('🔍 [main] 通过GLB URL反查到模板:', tmpl.name);
                localStorage.setItem('selectedTemplateId', tmpl.id);
              }
            }
          }
          if (!tmpl) {
            // A deleted local template can remain selected in browser storage.
            // Clear its dependent assets before constructing Player; network
            // failures above still preserve the cached selection for a retry.
            if (selectedTemplateId || /^\/(uploads|models)\//.test(selectedGlbUrl || '')) {
              for (const key of Object.keys(localStorage)) {
                if (key.startsWith('selectedTemplate')) localStorage.removeItem(key);
              }
              selectedGlbUrl = null;
              selectedWeaponConfig = null;
              for (const key of Object.keys(selectedAnimUrls)) delete selectedAnimUrls[key];
              templateData = null;
              console.info('[Character] Selected template is unavailable; using the built-in avatar');
              return null;
            }
            console.warn('🚫 API中未找到模板ID:', selectedTemplateId, '且GLB URL无法反查, glbToMatch:', resolvedGlbUrlArg || selectedGlbUrl);
            console.warn('🚫 服务器返回模板列表:', templates.map(t => t.id + '|' + t.name + '|' + t.glb_url).join(', '));
            return resolvedGlbUrlArg;
          }
          console.log('✅ API返回模板:', tmpl.name, 'GLB:', tmpl.glb_url);

          // 确定最终 GLB URL
          let finalGlbUrl = resolvedGlbUrlArg || selectedGlbUrl;
          if (!finalGlbUrl && tmpl.glb_url && tmpl.glb_url !== 'null') {
            finalGlbUrl = tmpl.glb_url;
            localStorage.setItem('selectedTemplateGlbUrl', finalGlbUrl);
            console.log('🔄 从API补全GLB URL:', finalGlbUrl);
          }

          // 补全动画URL
          MVP_ANIM_KEYS.forEach(k => {
            const url = tmpl[`anim_${k}_url`];
            if (url && url !== 'null' && !selectedAnimUrls[k]) {
              selectedAnimUrls[k] = url;
              localStorage.setItem('selectedTemplateAnim_' + k, url);
            }
          });

          // 无论如何都覆盖写入骨骼映射、校准参数、武器插槽（以服务器数据为准）
          if (tmpl.bone_mapping_config)  localStorage.setItem('selectedTemplateBoneMap',      JSON.stringify(tmpl.bone_mapping_config));
          if (tmpl.weapon_socket_config) localStorage.setItem('selectedTemplateWeaponSocket', JSON.stringify(tmpl.weapon_socket_config));
          if (tmpl.calibration_config)   localStorage.setItem('selectedTemplateCalibration',  JSON.stringify(tmpl.calibration_config));
          if (tmpl.fit_config)           localStorage.setItem('selectedTemplateFitConfig',     JSON.stringify(tmpl.fit_config));
          // 武器配置：始终以服务器数据为准（覆盖旧缓存）
          // weapon_lib_config 是武器库实际配置（服务器新旧版本均会返回），优先使用
          const _effectiveWeaponConfig = (() => {
            const base = (tmpl.weapon_config && typeof tmpl.weapon_config === 'object') ? tmpl.weapon_config : {};
            const lib  = (tmpl.weapon_lib_config && typeof tmpl.weapon_lib_config === 'object') ? tmpl.weapon_lib_config : {};
            const merged = Object.assign({}, base, lib);
            if (tmpl.weapon_id) {
              merged.weapon_id = tmpl.weapon_id;
              if (tmpl.weapon_name) merged.weapon_name = tmpl.weapon_name;
              if (tmpl.weapon_type_from_lib) merged.weapon_type = tmpl.weapon_type_from_lib;
            }
            return merged;
          })();
          console.log('[main] 模板 weapon_id:', tmpl.weapon_id, '| weapon_config:', JSON.stringify(tmpl.weapon_config), '| weapon_lib_config:', JSON.stringify(tmpl.weapon_lib_config), '| merged:', JSON.stringify(_effectiveWeaponConfig));
          if (tmpl.weapon_id && Object.keys(_effectiveWeaponConfig).length > 0) {
            localStorage.setItem('selectedTemplateWeaponConfig', JSON.stringify(_effectiveWeaponConfig));
            selectedWeaponConfig = _effectiveWeaponConfig;
            console.log('✅ [main] 武器配置已从服务器同步:', JSON.stringify(_effectiveWeaponConfig));
          } else if (!tmpl.weapon_id) {
            // 模板无武器，清空缓存
            localStorage.removeItem('selectedTemplateWeaponConfig');
            selectedWeaponConfig = null;
          }

          if (tmpl.model_height) localStorage.setItem('selectedTemplateHeight', String(tmpl.model_height));

          // 保存模板数据（含音效配置），供声音系统使用
          templateData = tmpl;

          console.log('✅ 模板配置已从API补全，GLB:', finalGlbUrl, '动画:', Object.keys(selectedAnimUrls).join('/') || '(无)');
          return finalGlbUrl;
        });
    };

    // 在创建 Player 之前，先从 API 补全模板配置（确保 weaponConfig 写入 localStorage 再创建角色）
    console.log('[main] 预加载检查 selectedTemplateId:', selectedTemplateId, '| selectedGlbUrl:', selectedGlbUrl);
    let _finalGlbUrl = selectedGlbUrl;
    const skipTemplateApi = window.SelfContainedChar &&
      window.SelfContainedChar.isActive() &&
      window.SelfContainedChar.isSelfContainedModeEnabled();
    if (skipTemplateApi) {
      console.log('[main] 自包含角色包模式：跳过本地模板 API 补全，使用源世界动画');
    }
    if (!skipTemplateApi && (selectedTemplateId || selectedGlbUrl)) {
      try {
        _finalGlbUrl = await loadTemplateFromApi(selectedGlbUrl);
        console.log('✅ [main] 模板配置预加载完成，动画:', Object.keys(selectedAnimUrls).join('/') || '(无)');
      } catch (err) {
        console.warn('🚫 [main] 模板配置预加载失败，使用缓存:', err);
      }
    } else if (!skipTemplateApi) {
      console.log('[main] 未选择角色模板，跳过预加载，将使用默认外观');
    }

    let boneMapConfig = null, weaponSocketConfig = null, calibrationConfig = null;
    try {
      const bmRaw = localStorage.getItem('selectedTemplateBoneMap');
      if (bmRaw) boneMapConfig = JSON.parse(bmRaw);
    } catch(e) {}
    try {
      const wsRaw = localStorage.getItem('selectedTemplateWeaponSocket');
      if (wsRaw) weaponSocketConfig = JSON.parse(wsRaw);
    } catch(e) {}
    try {
      const calRaw = localStorage.getItem('selectedTemplateCalibration');
      if (calRaw) calibrationConfig = JSON.parse(calRaw);
    } catch(e) {}
    return { selectedGlbUrl, finalGlbUrl: _finalGlbUrl, selectedAnimUrls,
      selectedWeaponConfig, templateData, scheduleLoadAnims, accountAvatar: null,
      boneMapConfig, weaponSocketConfig, calibrationConfig };
  }
};
