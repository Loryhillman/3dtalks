/**
 * adminAgentSettings.js — 管理后台「🤖 AI Agent」+「📦 聊天归档」两个子页签逻辑（P4）
 *
 * 为什么独立成文件：admin.html 已超 1 万行属黑名单文件，禁止追加新功能代码（项目红线），
 * 故卡片逻辑放独立模块，页面只保留卡片标记与入口调用（switchSubTab 懒加载钩子）。
 *
 * 依赖页面元素：
 *   AI Agent  — agent-enabled-checkbox / agent-push-default /
 *               agent-voice-relay-checkbox / max-agents / agent-save-msg /
 *               new-agent-name / new-agent-description / new-agent-glburl /
 *               new-agent-push-tier / agent-list-content
 *   聊天归档  — chat-log-enabled-checkbox / chat-log-retention-days /
 *               chat-log-remote-enabled-checkbox / chat-log-remote-provider /
 *               chat-log-upload-hour / chat-log-s3-endpoint|bucket|prefix|access-key|secret-key /
 *               chat-archive-save-msg / archive-run-now-btn
 * 暴露全局：window.adminAgentSettings
 * API：/api/agent/v1/admin/agents（GET/POST）、/agents/:id/{disable,enable,regenerate-key}、
 *      /admin/config（GET/PUT）、/admin/archive/run-now（POST）
 */
(function () {
  'use strict';

  const API = '/api/agent/v1/admin';

  const $ = (id) => document.getElementById(id);
  const token = () => localStorage.getItem('adminToken') || '';
  const agentText = (key, params) => params
    ? window.i18n.tp(`adminAgentUi.${key}`, params)
    : window.i18n.t(`adminAgentUi.${key}`);

  async function jreq(method, url, body) {
    const opts = { method, headers: { 'Authorization': 'Bearer ' + token() } };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const r = await fetch(url, opts);
    let j = null;
    try { j = await r.json(); } catch (e) { /* 非 JSON 响应 */ }
    if (!r.ok) throw new Error((j && (j.error || j.message)) || ('HTTP ' + r.status));
    return j || {};
  }

  function showMsg(id, text, ok) {
    const el = $(id);
    if (!el) return;
    el.style.display = 'block';
    el.style.background = ok ? 'rgba(0,255,0,0.08)' : 'rgba(255,68,68,0.12)';
    el.style.color = ok ? 'var(--green)' : 'var(--red)';
    el.style.border = ok ? '1px solid rgba(0,255,0,0.2)' : '1px solid rgba(255,68,68,0.3)';
    el.textContent = text;
    if (ok) setTimeout(() => { el.style.display = 'none'; }, 3000);
  }

  // ==================== 推送档位白话说明 ====================
  // 面向不懂技术的管理员：不出现任何专业术语，只讲"服务器会给 AI 什么、AI 还得自己问什么"。
  function updatePushTierHint() {
    const sel = $('agent-push-default');
    const box = $('agent-push-tier-hint');
    if (!sel || !box) return;
    const tierKey = { eco: 'hintEco', standard: 'hintStandard', realtime: 'hintRealtime' }[sel.value] || 'hintEco';
    box.innerHTML = agentText(tierKey) + agentText('hintFooter');
  }

  // ==================== 接入设置（5.3 节） ====================

  function fillAgentConfig(cfg) {
    const setCb = (id, v) => { const el = $(id); if (el) el.checked = !!v; };
    const setVal = (id, v) => { const el = $(id); if (el && v !== undefined && v !== null) el.value = v; };
    setCb('agent-enabled-checkbox', cfg.agentEnabled);
    setVal('agent-push-default', cfg.pushDefault);
    setCb('agent-voice-relay-checkbox', cfg.voiceRelay);
    setVal('max-agents', cfg.maxAgents);
    updatePushTierHint();
  }

  function fillChatArchiveConfig(cfg) {
    const setCb = (id, v) => { const el = $(id); if (el) el.checked = !!v; };
    const setVal = (id, v) => { const el = $(id); if (el && v !== undefined && v !== null) el.value = v; };
    setCb('chat-log-enabled-checkbox', cfg.chatLogEnabled);
    setVal('chat-log-retention-days', cfg.chatLogRetentionDays);
    setCb('chat-log-remote-enabled-checkbox', cfg.chatLogRemoteEnabled);
    setVal('chat-log-remote-provider', cfg.chatLogRemoteProvider);
    setVal('chat-log-upload-hour', cfg.chatLogUploadHour);
    setVal('chat-log-s3-endpoint', cfg.chatLogS3Endpoint);
    setVal('chat-log-s3-bucket', cfg.chatLogS3Bucket);
    setVal('chat-log-s3-prefix', cfg.chatLogS3Prefix);
    setVal('chat-log-s3-access-key', cfg.chatLogS3AccessKey);
    setVal('chat-log-s3-secret-key', cfg.chatLogS3SecretKey);
  }

  async function loadAgentConfig() {
    try {
      const r = await jreq('GET', API + '/config');
      const cfg = r.config || {};
      fillAgentConfig(cfg);
      fillChatArchiveConfig(cfg);
    } catch (e) {
      showMsg('agent-save-msg', agentText('configLoadFailed', { message: e.message }), false);
    }
  }

  async function saveAgentConfig() {
    const maxEl = $('max-agents');
    const maxAgents = maxEl ? parseInt(maxEl.value, 10) : NaN;
    if (!Number.isFinite(maxAgents) || maxAgents < 1 || maxAgents > 500) {
      showMsg('agent-save-msg', agentText('maxAgentsInvalid'), false);
      return;
    }
    const body = {
      agent_enabled: !!($('agent-enabled-checkbox') || {}).checked,
      agent_push_default: ($('agent-push-default') || {}).value,
      agent_voice_relay: !!($('agent-voice-relay-checkbox') || {}).checked,
      max_agents: String(maxAgents)
    };
    showMsg('agent-save-msg', agentText('saving'), true);
    try {
      await jreq('PUT', API + '/config', body);
      showMsg('agent-save-msg', agentText('configSaved'), true);
    } catch (e) {
      showMsg('agent-save-msg', agentText('saveFailed', { message: e.message }), false);
    }
  }

  // ==================== 聊天归档设置（5.5 节） ====================

  async function saveChatArchiveConfig() {
    const daysEl = $('chat-log-retention-days');
    const hourEl = $('chat-log-upload-hour');
    const days = daysEl ? parseInt(daysEl.value, 10) : NaN;
    const hour = hourEl ? parseInt(hourEl.value, 10) : NaN;
    if (!Number.isFinite(days) || days < 1 || days > 365) {
      showMsg('chat-archive-save-msg', agentText('retentionInvalid'), false);
      return;
    }
    if (!Number.isFinite(hour) || hour < 0 || hour > 23) {
      showMsg('chat-archive-save-msg', agentText('archiveHourInvalid'), false);
      return;
    }
    const val = (id) => { const el = $(id); return el ? el.value : ''; };
    const body = {
      chat_log_enabled: !!($('chat-log-enabled-checkbox') || {}).checked,
      chat_log_retention_days: String(days),
      chat_log_remote_enabled: !!($('chat-log-remote-enabled-checkbox') || {}).checked,
      chat_log_remote_provider: val('chat-log-remote-provider'),
      chat_log_upload_hour: String(hour),
      chat_log_s3_endpoint: val('chat-log-s3-endpoint'),
      chat_log_s3_bucket: val('chat-log-s3-bucket'),
      chat_log_s3_prefix: val('chat-log-s3-prefix'),
      chat_log_s3_access_key: val('chat-log-s3-access-key'),
      chat_log_s3_secret_key: val('chat-log-s3-secret-key')
    };
    showMsg('chat-archive-save-msg', agentText('saving'), true);
    try {
      await jreq('PUT', API + '/config', body);
      showMsg('chat-archive-save-msg', agentText('archiveSaved'), true);
    } catch (e) {
      showMsg('chat-archive-save-msg', agentText('saveFailed', { message: e.message }), false);
    }
  }

  async function runArchiveNowTest() {
    const btn = $('archive-run-now-btn');
    if (btn) btn.disabled = true;
    showMsg('chat-archive-save-msg', agentText('archiving'), true);
    try {
      const r = await jreq('POST', API + '/archive/run-now', {});
      const res = r.result || {};
      const text = res.skipped
        ? agentText('archiveSkipped', { reason: res.skipped })
        : agentText('archiveSuccess', { result: res.key || res.day || JSON.stringify(res) });
      showMsg('chat-archive-save-msg', text, !res.skipped);
    } catch (e) {
      showMsg('chat-archive-save-msg', agentText('archiveFailed', { message: e.message }), false);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // ==================== Agent 列表 ====================

  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function fmtTime(v) {
    if (!v) return '—';
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString(window.i18n.currentLocale);
  }

  // 档位下拉选项（Key Agent：跟随全局默认 / 第 2 档 / 第 3 档；第 1 档是公开游客，不在此列）
  const TIER_OPTIONS = ['inherit', 'standard', 'realtime'];
  const tierLabel = tier => ({
    inherit: agentText('tierInherit'), eco: agentText('tierEco'),
    standard: agentText('tierStandard'), realtime: agentText('tierRealtime')
  })[tier] || tier;

  function renderAgents(agents) {
    const box = $('agent-list-content');
    if (!box) return;
    if (!agents.length) {
      box.className = '';
      box.textContent = agentText('empty');
      return;
    }
    box.className = 'table-wrap';
    const rows = agents.map((a) => {
      const badge = a.status === 'active'
        ? `<span style="color:var(--green)">${agentText('active')}</span>`
        : `<span style="color:var(--red)">${agentText('inactive')}</span>`;
      const keyInfo = a.lastKeyPrefix ? esc(a.lastKeyPrefix) + '…' : agentText('none');
      const actions = (a.status === 'active'
        ? `<button class="btn btn-sm btn-secondary" onclick="adminAgentSettings.regenerateKey('${esc(a.id)}')">${agentText('regenerateButton')}</button>
           <button class="btn btn-sm btn-danger" onclick="adminAgentSettings.disableAgent('${esc(a.id)}')">${agentText('disableButton')}</button>`
        : `<button class="btn btn-sm btn-blue" onclick="adminAgentSettings.enableAgent('${esc(a.id)}')">${agentText('enableButton')}</button>`)
        + ` <button class="btn btn-sm btn-danger" onclick="adminAgentSettings.deleteAgent('${esc(a.id)}')">${agentText('deleteButton')}</button>`;
      // 档位内联下拉：改完立即生效（在线连接即时切换，无需重连）
      const tierSel = `<select onchange="adminAgentSettings.changeTier('${esc(a.id)}', this.value)"
          style="font-size:11px;padding:3px 5px;border:1px solid var(--border);border-radius:4px;">
          ${TIER_OPTIONS.map(tier => `<option value="${tier}"${tier === (a.pushTier || 'inherit') ? ' selected' : ''}>${tierLabel(tier)}</option>`).join('')}
        </select>
        <div style="font-size:10px;color:var(--muted);margin-top:2px;">${agentText('tierEffective', { tier: esc(tierLabel(a.effectivePushTier || '—')) })}</div>`;
      return `<tr>
        <td>${esc(a.name)}</td>
        <td>${esc(a.description || '')}</td>
        <td>${badge}</td>
        <td>${tierSel}</td>
        <td>${a.activeKeyCount}</td>
        <td><code style="font-size:11px">${keyInfo}</code></td>
        <td>${agentText(a.canTeleport ? 'yes' : 'no')}</td>
        <td style="font-size:11px;color:var(--muted)">${fmtTime(a.createdAt)}</td>
        <td style="white-space:nowrap">${actions}</td>
      </tr>`;
    }).join('');
    box.innerHTML = `<table>
      <thead><tr>
        <th>${agentText('columnName')}</th><th>${agentText('columnDescription')}</th><th>${agentText('columnStatus')}</th><th>${agentText('columnTier')}</th><th>${agentText('columnActiveKeys')}</th><th>${agentText('columnKeyPrefix')}</th>
        <th>${agentText('columnCanTeleport')}</th><th>${agentText('columnCreatedAt')}</th><th>${agentText('columnActions')}</th>
      </tr></thead>
      <tbody>${rows}</tbody></table>`;
  }

  async function loadAgentsList() {
    const box = $('agent-list-content');
    if (box) { box.className = 'loading'; box.textContent = agentText('loading'); }
    try {
      const r = await jreq('GET', API + '/agents');
      renderAgents(r.agents || []);
    } catch (e) {
      if (box) { box.className = ''; box.textContent = agentText('loadFailed', { message: e.message }); }
    }
  }

  // 推送档位下拉联动说明（管理员切换时立刻看到这一档到底推什么）
  (function bindPushTierHint() {
    const sel = $('agent-push-default');
    if (sel && !sel.dataset.pushHintBound) {
      sel.dataset.pushHintBound = '1';
      sel.addEventListener('change', updatePushTierHint);
    }
  })();

  async function createAgent() {
    const nameEl = $('new-agent-name');
    const descEl = $('new-agent-description');
    const glbEl = $('new-agent-glburl');
    const name = nameEl ? nameEl.value.trim() : '';
    if (name.length < 2) {
      showMsg('agent-save-msg', agentText('nameRequired'), false);
      return;
    }
    const glbUrl = glbEl ? glbEl.value.trim() : '';
    const tierEl = $('new-agent-push-tier');
    const body = {
      name,
      description: descEl ? descEl.value.trim() : '',
      avatarConfig: glbUrl ? { glbUrl } : {},
      pushTier: tierEl ? tierEl.value : 'inherit'
    };
    showMsg('agent-save-msg', agentText('creating'), true);
    try {
      const r = await jreq('POST', API + '/agents', body);
      if (nameEl) nameEl.value = '';
      if (descEl) descEl.value = '';
      if (glbEl) glbEl.value = '';
      if (tierEl) tierEl.value = 'inherit';
      // 明文 Key 仅此一次返回，必须立刻展示给管理员
      const key = r.apiKey || '';
      showMsg('agent-save-msg', agentText('created', { key }), true);
      if (key && window.prompt) window.prompt(agentText('copyKey'), key);
      await loadAgentsList();
    } catch (e) {
      showMsg('agent-save-msg', agentText('createFailed', { message: e.message }), false);
    }
  }

  async function disableAgent(id) {
    if (window.confirm && !window.confirm(agentText('disableConfirm'))) return;
    try {
      await jreq('POST', API + '/agents/' + encodeURIComponent(id) + '/disable', {});
      showMsg('agent-save-msg', agentText('disabled'), true);
      await loadAgentsList();
    } catch (e) {
      showMsg('agent-save-msg', agentText('disableFailed', { message: e.message }), false);
    }
  }

  async function enableAgent(id) {
    try {
      const r = await jreq('POST', API + '/agents/' + encodeURIComponent(id) + '/enable', {});
      showMsg('agent-save-msg', '✅ ' + (r.note || agentText('enabled')), true);
      await loadAgentsList();
    } catch (e) {
      showMsg('agent-save-msg', agentText('enableFailed', { message: e.message }), false);
    }
  }

  async function regenerateKey(id) {
    if (window.confirm && !window.confirm(agentText('regenerateConfirm'))) return;
    try {
      const r = await jreq('POST', API + '/agents/' + encodeURIComponent(id) + '/regenerate-key', {});
      const key = r.apiKey || '';
      showMsg('agent-save-msg', agentText('newKey', { key }), true);
      if (key && window.prompt) window.prompt(agentText('copyNewKey'), key);
      await loadAgentsList();
    } catch (e) {
      showMsg('agent-save-msg', agentText('regenerateFailed', { message: e.message }), false);
    }
  }

  async function deleteAgent(id) {
    if (window.confirm && !window.confirm(agentText('deleteConfirm'))) return;
    try {
      const r = await jreq('DELETE', API + '/agents/' + encodeURIComponent(id), {});
      showMsg('agent-save-msg', agentText('deleted', { name: r.deleted || '' }) + (r.kicked ? agentText('kicked', { count: r.kicked }) : ''), true);
      await loadAgentsList();
    } catch (e) {
      showMsg('agent-save-msg', agentText('deleteFailed', { message: e.message }), false);
    }
  }

  async function changeTier(id, tier) {
    try {
      const r = await jreq('POST', API + '/agents/' + encodeURIComponent(id) + '/tier', { pushTier: tier });
      const note = r.applied > 0 ? agentText('tierApplied') : '';
      showMsg('agent-save-msg', agentText('tierChanged', { tier: tierLabel(r.effectivePushTier), note }), true);
      await loadAgentsList();
    } catch (e) {
      showMsg('agent-save-msg', agentText('tierFailed', { message: e.message }), false);
      await loadAgentsList();  // 失败时回读真实值，避免下拉显示与实际不符
    }
  }

  window.adminAgentSettings = {
    loadAgentConfig,
    saveAgentConfig,
    loadAgentsList,
    createAgent,
    disableAgent,
    enableAgent,
    regenerateKey,
    deleteAgent,
    changeTier,
    saveChatArchiveConfig,
    runArchiveNowTest
  };
  window.i18n?.onLocaleChange(() => {
    updatePushTierHint();
    if ($('agent-list-content')) loadAgentsList();
  });
})();
