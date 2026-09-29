/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
// 系统配置管理功能脚本
const configText = (key, params) => params
  ? window.i18n.tp(`adminConfigUi.${key}`, params)
  : window.i18n.t(`adminConfigUi.${key}`);

// 切换显示Secret Key
function toggleSecretKeyVisibility() {
  const input = document.getElementById('config-secret-key');
  const checkbox = document.getElementById('show-secret-key');
  input.type = checkbox.checked ? 'text' : 'password';
}

// 获取管理员Token
function getAdminToken() {
  return localStorage.getItem('adminToken');
}

// 加载系统配置
async function loadSystemConfig() {
  try {
    const token = getAdminToken();
    
    // 获取所有配置
    const response = await fetch('/api/admin/config', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (!response.ok) {
      throw new Error(configText('loadFailed'));
    }

    const data = await response.json();
    const configs = data.configs;

    // 填充腾讯云配置
    const secretIdInput = document.getElementById('config-secret-id');
    const secretKeyInput = document.getElementById('config-secret-key');
    const regionSelect = document.getElementById('config-region');

    if (configs['TENCENT_SECRET_ID']) {
      // 显示是否已配置
      secretIdInput.placeholder = configs['TENCENT_SECRET_ID'].has_value ? 
        configText('configuredUpdate') : configText('notConfigured');
    }

    if (configs['TENCENT_SECRET_KEY']) {
      secretKeyInput.placeholder = configs['TENCENT_SECRET_KEY'].has_value ? 
        configText('configuredUpdate') : configText('notConfigured');
    }

    if (configs['TENCENT_REGION']) {
      regionSelect.value = configs['TENCENT_REGION'].value || 'ap-guangzhou';
    }

    // 显示其他配置
    renderOtherConfigs(configs);

    // 加载审计日志
    loadConfigAuditLogs();

  } catch (error) {
    console.error('加载系统配置失败:', error);
    showConfigStatus('error', configText('loadFailedDetail', { message: error.message }));
  }
}

// 渲染其他配置
function renderOtherConfigs(configs) {
  const container = document.getElementById('other-configs-list');
  
  // 过滤掉已在专门区域显示的配置
  const excludeKeys = ['TENCENT_SECRET_ID', 'TENCENT_SECRET_KEY', 'TENCENT_REGION'];
  const otherConfigs = Object.entries(configs).filter(([key]) => !excludeKeys.includes(key));

  if (otherConfigs.length === 0) {
    container.innerHTML = `<div style="color: #888; text-align: center;">${configText('noOtherConfigs')}</div>`;
    return;
  }

  let html = '<div style="display: grid; gap: 15px;">';
  
  for (const [key, config] of otherConfigs) {
    html += `
      <div style="background: rgba(0, 0, 0, 0.3); padding: 15px; border-radius: 5px;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div>
            <strong style="color: #00ff00;">${key}</strong>
            <div style="color: #888; font-size: 12px; margin-top: 5px;">${config.description || configText('noDescription')}</div>
          </div>
          <div>
            ${config.is_sensitive ? 
              `<input type="password" id="config-${key}" placeholder="${config.has_value ? configText('configured') : configText('notConfigured')}" style="
                padding: 8px;
                background: rgba(0, 0, 0, 0.5);
                border: 1px solid #00ff00;
                color: #fff;
                border-radius: 3px;
                width: 250px;
              ">` :
              `<input type="text" id="config-${key}" value="${config.value || ''}" style="
                padding: 8px;
                background: rgba(0, 0, 0, 0.5);
                border: 1px solid #00ff00;
                color: #fff;
                border-radius: 3px;
                width: 250px;
              ">`
            }
            <button onclick="updateSingleConfig('${key}')" style="
              padding: 8px 15px;
              background: #00ff00;
              color: #000;
              border: none;
              border-radius: 3px;
              margin-left: 10px;
              cursor: pointer;
            ">${window.i18n.t('common.save')}</button>
          </div>
        </div>
      </div>
    `;
  }
  
  html += '</div>';
  container.innerHTML = html;
}

// 保存腾讯混元3D配置
async function saveHunyuan3DConfig() {
  try {
    const secretId = document.getElementById('config-secret-id').value.trim();
    const secretKey = document.getElementById('config-secret-key').value.trim();
    const region = document.getElementById('config-region').value;

    if (!secretId && !secretKey) {
      showConfigStatus('warning', configText('enterOne'));
      return;
    }

    showConfigStatus('info', configText('saving'));

    const token = getAdminToken();
    const configs = {};

    if (secretId) configs['TENCENT_SECRET_ID'] = secretId;
    if (secretKey) configs['TENCENT_SECRET_KEY'] = secretKey;
    if (region) configs['TENCENT_REGION'] = region;

    const response = await fetch('/api/admin/config/batch', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ configs })
    });

    if (!response.ok) {
      throw new Error(configText('saveFailed'));
    }

    const result = await response.json();

    if (result.success) {
      showConfigStatus('success', configText('saved'));
      
      // 清空输入框
      document.getElementById('config-secret-id').value = '';
      document.getElementById('config-secret-key').value = '';
      document.getElementById('config-secret-id').placeholder = configText('configuredUpdate');
      document.getElementById('config-secret-key').placeholder = configText('configuredUpdate');
      
      // 重新加载配置
      setTimeout(() => {
        loadSystemConfig();
      }, 1500);
    } else {
      throw new Error(result.message || configText('saveFailed'));
    }

  } catch (error) {
    console.error('保存配置失败:', error);
    showConfigStatus('error', configText('saveFailedDetail', { message: error.message }));
  }
}

// 测试混元3D连接
async function testHunyuan3DConnection() {
  try {
    showConfigStatus('info', configText('testing'));

    const token = getAdminToken();
    const response = await fetch('/api/admin/config/test-hunyuan3d', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (!response.ok) {
      throw new Error(configText('testRequestFailed'));
    }

    const result = await response.json();

    if (result.valid) {
      showConfigStatus('success', configText('testPassed'));
    } else {
      showConfigStatus('error', configText('testConnectionFailed', { message: result.message }));
    }

  } catch (error) {
    console.error('测试连接失败:', error);
    showConfigStatus('error', configText('testFailed', { message: error.message }));
  }
}

// 更新单个配置
async function updateSingleConfig(key) {
  try {
    const input = document.getElementById(`config-${key}`);
    if (!input) return;

    const value = input.value.trim();
    if (!value) {
      alert(configText('enterValue'));
      return;
    }

    const token = getAdminToken();
    const response = await fetch(`/api/admin/config/${key}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ value })
    });

    if (!response.ok) {
      throw new Error(configText('updateFailed'));
    }

    const result = await response.json();

    if (result.success) {
      alert(configText('updated'));
      loadSystemConfig();
    } else {
      throw new Error(result.error || configText('updateFailed'));
    }

  } catch (error) {
    console.error('更新配置失败:', error);
    alert(configText('updateFailedDetail', { message: error.message }));
  }
}

// 显示配置状态
function showConfigStatus(type, message) {
  const statusDiv = document.getElementById('config-status');
  statusDiv.style.display = 'block';
  
  const colors = {
    success: { bg: 'rgba(0, 200, 0, 0.2)', border: '#00cc00', text: '#00ff00' },
    error: { bg: 'rgba(200, 0, 0, 0.2)', border: '#cc0000', text: '#ff4444' },
    warning: { bg: 'rgba(200, 200, 0, 0.2)', border: '#cccc00', text: '#ffff00' },
    info: { bg: 'rgba(0, 100, 200, 0.2)', border: '#0066cc', text: '#66aaff' }
  };

  const color = colors[type] || colors.info;
  
  statusDiv.style.background = color.bg;
  statusDiv.style.border = `2px solid ${color.border}`;
  statusDiv.style.color = color.text;
  statusDiv.textContent = message;

  if (type === 'success') {
    setTimeout(() => {
      statusDiv.style.display = 'none';
    }, 3000);
  }
}

// 加载配置审计日志
async function loadConfigAuditLogs() {
  try {
    const token = getAdminToken();
    const response = await fetch('/api/admin/config/audit-logs?limit=20', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (!response.ok) {
      throw new Error(configText('auditLoadFailed'));
    }

    const data = await response.json();
    const logs = data.logs;

    const container = document.getElementById('config-audit-logs');

    if (!logs || logs.length === 0) {
      container.innerHTML = `<div style="color: #888; text-align: center;">${configText('noAuditLogs')}</div>`;
      return;
    }

    let html = '<table style="width: 100%; border-collapse: collapse;">';
    html += `
      <thead>
        <tr style="background: rgba(255, 255, 0, 0.1);">
          <th style="padding: 10px; text-align: left; color: #ffff00;">${configText('auditTime')}</th>
          <th style="padding: 10px; text-align: left; color: #ffff00;">${configText('auditSetting')}</th>
          <th style="padding: 10px; text-align: left; color: #ffff00;">${configText('auditAction')}</th>
          <th style="padding: 10px; text-align: left; color: #ffff00;">${configText('auditActor')}</th>
          <th style="padding: 10px; text-align: left; color: #ffff00;">${configText('auditIP')}</th>
        </tr>
      </thead>
      <tbody>
    `;

    logs.forEach((log, index) => {
      const bgColor = index % 2 === 0 ? 'rgba(0, 0, 0, 0.2)' : 'transparent';
      html += `
        <tr style="background: ${bgColor};">
          <td style="padding: 8px; color: #ccc;">${new Date(log.changed_at).toLocaleString(window.i18n.currentLocale)}</td>
          <td style="padding: 8px; color: #00ff00;">${log.config_key}</td>
          <td style="padding: 8px; color: #ffaa00;">
            ${log.new_value === '' ? configText('auditDeleted') : log.old_value === '' ? configText('auditCreated') : configText('auditUpdated')}
          </td>
          <td style="padding: 8px; color: #66aaff;">${log.username || configText('system')}</td>
          <td style="padding: 8px; color: #888;">${log.ip_address || '-'}</td>
        </tr>
      `;
    });

    html += '</tbody></table>';
    container.innerHTML = html;

  } catch (error) {
    console.error('加载审计日志失败:', error);
    document.getElementById('config-audit-logs').innerHTML = 
      `<div style="color: #ff4444;">${configText('auditLoadFailed')}</div>`;
  }
}

// 在页面加载时初始化
if (typeof window.onAdminPageLoad === 'undefined') {
  window.onAdminPageLoad = function() {
    // 添加到原有的加载逻辑中
    loadSystemConfig();
  };
}

window.i18n?.onLocaleChange(() => {
  if (document.getElementById('other-configs-list')) loadSystemConfig();
});
