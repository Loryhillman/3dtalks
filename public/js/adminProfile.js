/**
 * 管理员个人设置模块
 * 功能：修改密码、修改个人信息（显示名称、邮箱）
 * 依赖：后端 API /api/admin-auth/* (adminAuth.js)
 */
(function() {
  'use strict';

  var API_BASE = '/api/admin-auth';
  var token = localStorage.getItem('adminToken');
  function profileText(key) { return window.i18n.t('adminProfileUi.' + key); }

  // ===== 初始化 =====
  function init() {
    loadProfile();
    bindEvents();
  }

  // ===== 加载个人信息 =====
  function loadProfile() {
    fetch(API_BASE + '/profile', {
      headers: { 'Authorization': 'Bearer ' + token }
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.success && data.adminUser) {
        var u = data.adminUser;
        document.getElementById('profileUsername').textContent = u.username || '-';
        document.getElementById('profileFullName').value = u.full_name || '';
        document.getElementById('profileEmail').value = u.email || '';
        // 同步更新侧边栏显示名称
        var sidebarName = document.getElementById('adminName');
        if (sidebarName) sidebarName.textContent = u.full_name || u.username;
      }
    })
    .catch(function(err) {
      console.error('加载个人信息失败:', err);
    });
  }

  // ===== 绑定事件 =====
  function bindEvents() {
    // 保存个人信息
    document.getElementById('btnSaveProfile').addEventListener('click', saveProfile);
    // 修改密码
    document.getElementById('btnChangePassword').addEventListener('click', changePassword);
  }

  // ===== 保存个人信息 =====
  function saveProfile() {
    var fullName = document.getElementById('profileFullName').value.trim();
    var email = document.getElementById('profileEmail').value.trim();

    if (!fullName) {
      showMsg('profileMsg', profileText('nameRequired'), 'error');
      return;
    }

    var btn = document.getElementById('btnSaveProfile');
    btn.disabled = true;
    btn.textContent = profileText('saving');
    hideMsg('profileMsg');

    fetch(API_BASE + '/profile', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
      },
      body: JSON.stringify({ full_name: fullName, email: email })
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.success) {
        showMsg('profileMsg', profileText('profileSaved'), 'success');
        // 更新 localStorage
        var adminUser = JSON.parse(localStorage.getItem('adminUser') || '{}');
        adminUser.full_name = fullName;
        adminUser.email = email;
        localStorage.setItem('adminUser', JSON.stringify(adminUser));
        // 更新侧边栏
        var sidebarName = document.getElementById('adminName');
        if (sidebarName) sidebarName.textContent = fullName;
      } else {
        showMsg('profileMsg', data.error || profileText('updateFailed'), 'error');
      }
    })
    .catch(function(err) {
      showMsg('profileMsg', profileText('networkError'), 'error');
      console.error('保存信息失败:', err);
    })
    .finally(function() {
      btn.disabled = false;
      btn.textContent = profileText('saveChanges');
    });
  }

  // ===== 修改密码 =====
  function changePassword() {
    var currentPwd = document.getElementById('currentPassword').value;
    var newPwd = document.getElementById('newPassword').value;
    var confirmPwd = document.getElementById('confirmPassword').value;

    // 验证
    if (!currentPwd) { showMsg('pwdMsg', profileText('currentPasswordRequired'), 'error'); return; }
    if (!newPwd) { showMsg('pwdMsg', profileText('newPasswordRequired'), 'error'); return; }
    if (newPwd.length < 8) { showMsg('pwdMsg', profileText('passwordTooShort'), 'error'); return; }
    if (newPwd !== confirmPwd) { showMsg('pwdMsg', profileText('passwordMismatch'), 'error'); return; }

    var btn = document.getElementById('btnChangePassword');
    btn.disabled = true;
    btn.textContent = profileText('changing');
    hideMsg('pwdMsg');

    fetch(API_BASE + '/change-password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
      },
      body: JSON.stringify({
        currentPassword: currentPwd,
        newPassword: newPwd
      })
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.success) {
        showMsg('pwdMsg', profileText('passwordChanged'), 'success');
        // 清空表单
        document.getElementById('currentPassword').value = '';
        document.getElementById('newPassword').value = '';
        document.getElementById('confirmPassword').value = '';
      } else {
        showMsg('pwdMsg', data.error || profileText('changeFailed'), 'error');
      }
    })
    .catch(function(err) {
      showMsg('pwdMsg', profileText('networkError'), 'error');
      console.error('修改密码失败:', err);
    })
    .finally(function() {
      btn.disabled = false;
      btn.textContent = profileText('changePassword');
    });
  }

  // ===== 消息提示 =====
  function showMsg(id, text, type) {
    var el = document.getElementById(id);
    el.textContent = text;
    el.className = 'form-msg ' + (type === 'success' ? 'msg-success' : 'msg-error');
    el.style.display = 'block';
  }

  function hideMsg(id) {
    var el = document.getElementById(id);
    if (el) el.style.display = 'none';
  }

  // ===== 暴露给全局 =====
  window.initAdminProfile = init;

})();
