/**
 * 济宁米多信息科技有限公司 版权所有
 * 找回密码 - 三步弹窗模块
 * 步骤1：输入账号 → 步骤2：验证安全问题 → 步骤3：重置密码
 */

(function () {
  'use strict';
  const fpT = key => window.i18n.t('passwordRecoveryUi.' + key);

  /**
   * 打开找回密码弹窗（三步流程）
   * @param {HTMLElement} loginScreen - 登录页元素（关闭时清理用）
   */
  window.showForgotPasswordDialog = async function (loginScreen) {
    await window.i18n.init();
    // 🆕 清理所有已存在的找回密码弹窗，防止重复ID冲突
    document.querySelectorAll('[data-fp-dialog]').forEach(el => el.remove());

    const state = { step: 1, username: '', questionText: '', resetToken: '' };

    const dialog = document.createElement('div');
    dialog.setAttribute('data-fp-dialog', 'true'); // 标识此弹窗
    dialog.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      background: rgba(0,0,0,0.85); display: flex; justify-content: center;
      align-items: center; z-index: 2200;
    `;

    const boxStyle = `
      background: rgba(0,0,0,0.95); border: 3px solid #00ff00;
      padding: 35px; border-radius: 12px; width: 400px; text-align: center;
      font-family: 'Courier New', monospace;
      box-shadow: 0 0 25px rgba(0,255,0,0.4);
    `;

    const inputStyle = `
      width: 100%; padding: 12px; background: rgba(0,100,0,0.2);
      border: 2px solid #00ff00; border-radius: 5px; color: #00ff00;
      font-family: 'Courier New', monospace; font-size: 14px; margin: 8px 0;
    `;
    const btnStyle = `
      width: 100%; padding: 12px; margin: 6px 0; border-radius: 5px;
      cursor: pointer; font-family: 'Courier New', monospace; font-weight: bold;
    `;
    const primaryBtn = `${btnStyle} background: #00ff00; color: #000; border: none; font-size: 15px;`;
    const secondaryBtn = `${btnStyle} background: transparent; color: #00ff00; border: 2px solid #00ff00; font-size: 14px;`;
    const errorStyle = 'color: #ff0000; font-size: 12px; margin-top: 10px; min-height: 20px;';
    const successStyle = 'color: #00ff00; font-size: 12px; margin-top: 10px; min-height: 20px;';
    const labelStyle = 'color: #00ff00; font-size: 13px; display: block; margin: 12px 0 5px; text-align: left;';

    // 渲染当前步骤
    function render() {
      let html = `<div style="${boxStyle}">`;

      if (state.step === 1) {
        html += `
          <h2 style="color:#00ff00;margin-bottom:15px;font-size:22px;">${fpT('title')}</h2>
          <p style="color:#88ff88;font-size:12px;margin-bottom:20px;">${fpT('step1')}</p>
          <div style="text-align:left">
            <label style="${labelStyle}">${fpT('username')}</label>
            <input type="text" id="fp-username" placeholder="${fpT('usernamePlaceholder')}" maxlength="20" style="${inputStyle}">
          </div>
          <div id="fp-error" style="${errorStyle}"></div>
          <button id="fp-step1-btn" style="${primaryBtn}">${fpT('next')}</button>
          <button id="fp-cancel-btn" style="${secondaryBtn}">${fpT('backToLogin')}</button>
        `;
      } else if (state.step === 2) {
        html += `
          <h2 style="color:#00ff00;margin-bottom:15px;font-size:22px;">${fpT('verifyTitle')}</h2>
          <p style="color:#88ff88;font-size:12px;margin-bottom:12px;">${fpT('step2')}</p>
          <div style="background:rgba(255,255,0,0.1);border:1px solid rgba(255,255,0,0.4);border-radius:8px;padding:14px;margin:12px 0;">
            <span style="color:#ffff00;font-size:13px;">${fpT('securityQuestion')}</span>
            <span style="color:#fff;font-size:15px;font-weight:bold;display:block;margin-top:6px;">${escapeHtml(state.questionText)}</span>
          </div>
          <div style="text-align:left">
            <label style="${labelStyle}">${fpT('answer')}</label>
            <input type="text" id="fp-answer" placeholder="${fpT('answerPlaceholder')}" style="${inputStyle}">
          </div>
          <div id="fp-error" style="${errorStyle}"></div>
          <button id="fp-step2-btn" style="${primaryBtn}">${fpT('verifyNext')}</button>
          <button id="fp-back-btn" style="${secondaryBtn}">${fpT('back')}</button>
        `;
      } else if (state.step === 3) {
        html += `
          <h2 style="color:#00ff00;margin-bottom:15px;font-size:22px;">${fpT('resetTitle')}</h2>
          <p style="color:#88ff88;font-size:12px;margin-bottom:20px;">${fpT('step3')}</p>
          <div style="text-align:left">
            <label style="${labelStyle}">${fpT('newPassword')}</label>
            <input type="password" id="fp-new-password" placeholder="${fpT('newPasswordPlaceholder')}" style="${inputStyle}">
            <label style="${labelStyle}">${fpT('confirmPassword')}</label>
            <input type="password" id="fp-new-password-confirm" placeholder="${fpT('confirmPasswordPlaceholder')}" style="${inputStyle}">
          </div>
          <div id="fp-error" style="${errorStyle}"></div>
          <div id="fp-success" style="${successStyle}"></div>
          <button id="fp-step3-btn" style="${primaryBtn}">${fpT('resetPassword')}</button>
          <button id="fp-back-btn" style="${secondaryBtn}">${fpT('back')}</button>
        `;
      }
      html += '</div>';
      dialog.innerHTML = html;

      // 绑定事件
      bindEvents();
    }

    function setError(msg) {
      const el = dialog.querySelector('#fp-error');
      if (el) { el.textContent = msg; el.style.color = '#ff0000'; }
    }

    function setSuccess(msg) {
      const el = dialog.querySelector('#fp-success');
      if (el) { el.textContent = msg; el.style.color = '#00ff00'; }
    }

    function disableBtn(id, text) {
      const btn = dialog.querySelector('#' + id);
      if (!btn) return;
      btn.disabled = true;
      btn.textContent = text || fpT('processing');
      btn.style.opacity = '0.6';
    }

    function enableBtn(id, text) {
      const btn = dialog.querySelector('#' + id);
      if (!btn) return;
      btn.disabled = false;
      btn.textContent = text || fpT('submit');
      btn.style.opacity = '1';
    }

    function bindEvents() {
      // 取消按钮
      const cancelBtn = dialog.querySelector('#fp-cancel-btn');
      if (cancelBtn) {
        cancelBtn.addEventListener('click', () => dialog.remove());
      }

      // 返回按钮
      const backBtn = dialog.querySelector('#fp-back-btn');
      if (backBtn) {
        backBtn.addEventListener('click', () => {
          state.step--;
          render();
        });
      }

      // Enter 键提交
      const inputs = dialog.querySelectorAll('input');
      inputs.forEach(input => {
        input.addEventListener('keypress', (e) => {
          if (e.key === 'Enter') {
            const btnId = state.step === 1 ? 'fp-step1-btn' : state.step === 2 ? 'fp-step2-btn' : 'fp-step3-btn';
            const btn = dialog.querySelector('#' + btnId);
            if (btn && !btn.disabled) btn.click();
          }
        });
      });

      // === 步骤1：查询安全问题 ===
      if (state.step === 1) {
        const btn = dialog.querySelector('#fp-step1-btn');
        if (!btn) return;
        btn.addEventListener('click', async () => {
          const username = dialog.querySelector('#fp-username').value.trim();
          if (!username) { setError(fpT('enterUsername')); return; }

          disableBtn('fp-step1-btn', fpT('querying'));
          setError('');

          try {
            const result = await API.forgotStep1(username);
            state.username = username;
            state.questionText = window.i18n.apiMessage({ message: result.questionText, messageKey: result.questionKey });
            state.step = 2;
            render();
          } catch (error) {
            setError('❌ ' + (error.message || fpT('queryFailed')));
            enableBtn('fp-step1-btn', fpT('next'));
          }
        });
      }

      // === 步骤2：验证答案 ===
      if (state.step === 2) {
        const btn = dialog.querySelector('#fp-step2-btn');
        if (!btn) return;
        btn.addEventListener('click', async () => {
          const answer = dialog.querySelector('#fp-answer').value.trim();
          if (!answer) { setError(fpT('enterAnswer')); return; }

          disableBtn('fp-step2-btn', fpT('verifying'));
          setError('');

          try {
            const result = await API.forgotStep2(state.username, answer);
            state.resetToken = result.resetToken;
            state.step = 3;
            render();
          } catch (error) {
            setError('❌ ' + (error.message || fpT('verifyFailed')));
            enableBtn('fp-step2-btn', fpT('verifyNext'));
          }
        });
      }

      // === 步骤3：重置密码 ===
      if (state.step === 3) {
        const btn = dialog.querySelector('#fp-step3-btn');
        if (!btn) return;
        btn.addEventListener('click', async () => {
          const newPassword = dialog.querySelector('#fp-new-password').value;
          const confirm = dialog.querySelector('#fp-new-password-confirm').value;

          setError('');
          setSuccess('');

          if (!newPassword) { setError(fpT('enterNewPassword')); return; }
          if (newPassword.length < 6) { setError(fpT('passwordTooShort')); return; }
          if (newPassword !== confirm) { setError(fpT('passwordMismatch')); return; }

          disableBtn('fp-step3-btn', fpT('resetting'));

          try {
            await API.resetPassword(state.resetToken, newPassword);
            setSuccess(fpT('resetSuccess'));
            setTimeout(() => {
              dialog.remove();
            }, 1500);
          } catch (error) {
            setError('❌ ' + (error.message || fpT('resetFailed')));
            enableBtn('fp-step3-btn', fpT('resetPassword'));
          }
        });
      }
    }

    function escapeHtml(str) {
      const div = document.createElement('div');
      div.textContent = str;
      return div.innerHTML;
    }

    render();
    document.body.appendChild(dialog);
  };
})();
