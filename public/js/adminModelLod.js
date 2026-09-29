/**
 * adminModelLod.js — 管理后台「🗿 本世界模型设置」卡片逻辑（模型 LOD 三版方案 · 阶段 3）
 *
 * 为什么独立成文件：admin.html 已超 1 万行属黑名单文件，禁止追加新功能代码（项目红线），
 * 故卡片逻辑放独立模块，页面只保留卡片标记与一个入口调用。
 *
 * 依赖页面元素：lod-enabled-checkbox / lod-status-line / lod-save-msg /
 *              lod-progress / lod-regen-btn /
 *              lod-near|mid|far-dist / lod-mid-cap-mode / lod-mid-max-faces /
 *              lod-mid-percent / lod-low-target-faces
 * 暴露全局：loadLodStatus / refreshLodStatus / saveLodEnabled / runLodRegen
 * （2026-09-14 原「一键生成」按钮已合并进 runLodRegen：变体缺失在后端也判违规）
 */
(function () {
  'use strict';

  const API = '/api/admin/model-lod';
  const WS_API = '/api/config/world-settings';
  const BATCH_LIMIT = 3;    // 每批 3 个
  const MAX_ROUNDS = 1000;  // 死循环保护（正常远小于此值）

  let running = false;

  const $ = (id) => document.getElementById(id);
  const token = () => localStorage.getItem('adminToken') || '';
  const lodText = (key, params) => params
    ? window.i18n.tp(`adminLodUi.${key}`, params)
    : window.i18n.t(`adminLodUi.${key}`);

  async function jreq(method, url, body) {
    const opts = { method, headers: { 'Authorization': 'Bearer ' + token() } };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const r = await fetch(url, opts);
    let j = null;
    try { j = await r.json(); } catch (e) { /* 非 JSON 响应 */ }
    if (!r.ok) throw new Error((j && (j.error || j.details)) || ('HTTP ' + r.status));
    return j || {};
  }

  function showMsg(text, ok) {
    const el = $('lod-save-msg');
    if (!el) return;
    el.style.display = 'block';
    el.style.background = ok ? 'rgba(0,255,0,0.08)' : 'rgba(255,68,68,0.12)';
    el.style.color = ok ? 'var(--green)' : 'var(--red)';
    el.style.border = ok ? '1px solid rgba(0,255,0,0.2)' : '1px solid rgba(255,68,68,0.3)';
    el.textContent = text;
    if (ok) setTimeout(() => { el.style.display = 'none'; }, 3000);
  }

  function setProgress(text) {
    const el = $('lod-progress');
    if (!el) return;
    if (!text) { el.style.display = 'none'; el.textContent = ''; return; }
    el.style.display = 'block';
    el.textContent = text;
  }

  function renderStatus(s) {
    const el = $('lod-status-line');
    const cb = $('lod-enabled-checkbox');
    if (cb && s) cb.checked = !!s.enabled;
    if (!el) return;
    if (!s) { el.textContent = lodText('statusFailed'); return; }
    let line = lodText('statusSummary', { total: s.total, mid: s.midCount, low: s.lowCount, pending: s.pending });
    if (s.lowPolySkipped) line += lodText('lowPolySkipped', { count: s.lowPolySkipped });
    el.textContent = line;
  }

  /** 分带距离输入框读写（二期 C：后台可调，默认 30/60/400） */
  const DIST_INPUTS = [
    { id: 'lod-near-dist', key: 'lod_near_dist', def: 30 },
    { id: 'lod-mid-dist',  key: 'lod_mid_far_dist', def: 60 },
    { id: 'lod-far-dist',  key: 'lod_far_dist', def: 400 },
  ];

  function fillDistInputs(ws) {
    DIST_INPUTS.forEach((d) => {
      const el = $(d.id);
      if (el && ws && Number.isFinite(ws[d.key])) el.value = ws[d.key];
    });
  }

  function readDistInputs() {
    const out = {};
    let near = 0; let mid = 0; let far = 0;
    for (const d of DIST_INPUTS) {
      const el = $(d.id);
      if (!el || el.value === '') continue;
      const n = parseInt(el.value, 10);
      if (!Number.isFinite(n) || n <= 0) {
      showMsg(lodText('distanceInvalid', { value: el.value || lodText('empty') }), false);
        return null;
      }
      if (d.id === 'lod-near-dist') near = n;
      if (d.id === 'lod-mid-dist') mid = n;
      if (d.id === 'lod-far-dist') far = n;
      out[d.key] = n;
    }
    if (near && mid && near >= mid) { showMsg(lodText('nearBeforeMid'), false); return null; }
    if (mid && far && mid >= far) { showMsg(lodText('midBeforeFar'), false); return null; }
    return out;
  }

  // ===== 变体压缩标准（2026-09-14 后台可调）：模式下拉 + 中模上限面数 + 中模百分比 + 低模目标面数 =====
  const FACE_INPUTS = [
    { id: 'lod-mid-max-faces',    key: 'lod_mid_max_faces',    def: 50000, min: 1000, max: 5000000, labelKey: 'midFaceLimit' },
    { id: 'lod-mid-percent',      key: 'lod_mid_percent',      def: 25,    min: 1,    max: 99,      labelKey: 'midPercent' },
    { id: 'lod-low-target-faces', key: 'lod_low_target_faces', def: 100,   min: 16,   max: 2000,    labelKey: 'lowFaceTarget' },
  ];

  function fillFaceInputs(ws) {
    if (!ws) return;
    const modeEl = $('lod-mid-cap-mode');
    if (modeEl && (ws.lod_mid_cap_mode === 'faces' || ws.lod_mid_cap_mode === 'percent')) {
      modeEl.value = ws.lod_mid_cap_mode;
    }
    FACE_INPUTS.forEach((d) => {
      const el = $(d.id);
      if (el && Number.isFinite(ws[d.key])) el.value = ws[d.key];
    });
    applyFaceModeUi();
  }

  /** 模式联动：faces 高亮面数上限框、percent 高亮百分比框，另一项置灰（仍可查看） */
  function applyFaceModeUi() {
    const modeEl = $('lod-mid-cap-mode');
    if (!modeEl) return;
    const isFaces = modeEl.value !== 'percent';
    const facesEl = $('lod-mid-max-faces');
    const pctEl = $('lod-mid-percent');
    if (facesEl) facesEl.disabled = !isFaces;
    if (pctEl) pctEl.disabled = isFaces;
  }

  function readFaceInputs() {
    const out = {};
    const modeEl = $('lod-mid-cap-mode');
    if (modeEl && modeEl.value) out.lod_mid_cap_mode = modeEl.value;
    const isFaces = !modeEl || modeEl.value !== 'percent';
    for (const d of FACE_INPUTS) {
      const el = $(d.id);
      if (!el || el.value === '') continue;
      // 非当前模式的输入框跳过校验与提交（其值由后台保留不变）
      if (d.id === 'lod-mid-max-faces' && !isFaces) continue;
      if (d.id === 'lod-mid-percent' && isFaces) continue;
      const n = parseInt(el.value, 10);
      if (!Number.isFinite(n) || n < d.min || n > d.max) {
      showMsg(lodText('fieldInvalid', { label: lodText(d.labelKey), min: d.min, max: d.max, value: el.value || lodText('empty') }), false);
        return null;
      }
      out[d.key] = n;
    }
    return out;
  }

  async function loadLodStatus(silent) {
    try {
      const s = await jreq('GET', API + '/status');
      renderStatus(s);
      // 分带距离 + 压缩标准随世界设置一起读取（失败不阻断状态展示）
      try { const ws = await jreq('GET', WS_API); fillDistInputs(ws); fillFaceInputs(ws); } catch (e) { /* ignore */ }
      if (!silent) showMsg(lodText('statusRefreshed'), true);
      return s;
    } catch (e) {
      renderStatus(null);
      if (!silent) showMsg(lodText('statusReadFailed', { message: e.message }), false);
      return null;
    }
  }

  async function saveLodEnabled() {
    const cb = $('lod-enabled-checkbox');
    if (!cb) return;
    const enabled = !!cb.checked;
    const dists = readDistInputs();
    if (dists === null) return; // 校验失败已提示
    const faces = readFaceInputs();
    if (faces === null) return; // 校验失败已提示
    showMsg(lodText('saving'), true);
    try {
      // 只改 LOD 相关：先取当前世界设置再整体 PUT，避免覆盖名称/URL/描述
      const cur = await jreq('GET', WS_API);
      if (!cur.world_name || !cur.world_url) {
        showMsg(lodText('worldSettingsRequired'), false);
        return;
      }
      const r = await jreq('PUT', WS_API, Object.assign({
        world_name: cur.world_name,
        world_url: cur.world_url,
        world_description: cur.world_description || '',
        lod_enabled: enabled,
      }, dists, faces));
      if (r && r.success) {
        showMsg(enabled
          ? lodText('enabledSaved', { near: dists.lod_near_dist || cur.lod_near_dist,
            mid: dists.lod_mid_far_dist || cur.lod_mid_far_dist, far: dists.lod_far_dist || cur.lod_far_dist })
          : lodText('disabledSaved'), true);
      } else {
        showMsg(lodText('saveFailedDetail', { message: (r && (r.error || r.details)) || lodText('saveFailed') }), false);
      }
    } catch (e) {
      showMsg(lodText('saveFailedDetail', { message: e.message }), false);
    }
  }

  /**
   * 按当前压缩标准重生成违规的存量变体（POST /regen 分批轮询，每批 3 个）。
   * 2026-09-14 合并原「一键生成」按钮：变体缺失（上传失败/被删/磁盘孤儿）在后端
   * 也判为违规，本按钮同时承担补齐与按标准重压两类工作。
   * 触底保护在后端（同基准名本进程只尝试一次，配置变化自动重置），
   * 重生成后仍违规的模型不会再被选中 —— 本循环必然收敛。
   */
  async function runLodRegen() {
    if (running) return;
    const btn = $('lod-regen-btn');
    if (!confirm(lodText('regenConfirm'))) {
      return;
    }

    running = true;
    if (btn) btn.disabled = true;
    let processed = 0;
    let succeeded = 0;
    let failed = 0;

    try {
      setProgress(lodText('regenScanning'));
      for (let round = 0; round < MAX_ROUNDS; round += 1) {
        const r = await jreq('POST', API + '/regen', { limit: BATCH_LIMIT });
        if (!r || !r.processed) break;   // 无违规或全部已尝试过 → 收敛结束
        processed += r.processed;
        succeeded += r.succeeded || 0;
        failed += r.failed || 0;
        const list = r.results || [];
        const last = list[list.length - 1] || {};
        setProgress(lodText('regenItem', { count: processed, name: last.name || '', mid: last.mid || '?' }));
      }

      const done = await jreq('GET', API + '/status').catch(() => null);
      if (done) renderStatus(done);
      setProgress(lodText('regenDone', { processed, succeeded, failed }) +
        (done && done.dbError ? lodText('dbError') : ''));
      showMsg(lodText(processed > 0 ? 'regenEnded' : 'regenNotNeeded'), true);
    } catch (e) {
      setProgress(lodText('regenInterrupted', { count: processed, message: e.message }));
      showMsg(lodText('regenFailed', { message: e.message }), false);
    } finally {
      running = false;
      if (btn) btn.disabled = false;
    }
  }

  // 模式下拉联动（faces ↔ percent 高亮对应输入框）
  (function bindModeToggle() {
    const modeEl = $('lod-mid-cap-mode');
    if (modeEl && !modeEl.dataset.lodBound) {
      modeEl.dataset.lodBound = '1';
      modeEl.addEventListener('change', applyFaceModeUi);
    }
  })();

  window.loadLodStatus = loadLodStatus;
  window.refreshLodStatus = function () { return loadLodStatus(false); };
  window.saveLodEnabled = saveLodEnabled;
  window.runLodRegen = runLodRegen;
  window.i18n?.onLocaleChange(() => {
    if ($('lod-status-line')) loadLodStatus(true);
  });
})();
