/**
 * editorObjectLock.js - 世界编辑器「对象锁定」模块
 *
 * 功能：
 *  1. 锁定/解锁持久化：PUT /api/world/objects/:id/lock 写库，刷新后仍保持
 *  2. 解锁确认态（两击解锁）：第一次点击进入「确认态」标红按钮 + 提示，
 *     3 秒内再次点击同一对象才执行解锁；超时 / 点击其他对象自动重置
 *  3. 组内对象拒绝锁定：mesh.parent.userData.isEditorGroup 为真时提示先解组，
 *     避免编组整体拖动/保存时误动锁定对象
 *  4. 提供锁定按钮 HTML（供左右两个对象列表渲染）、工具栏批量锁定入口
 *
 * 依赖（world_editor.html 提供，均为全局顶层声明，直接按标识符引用）：
 *  worldObjects/selectedObjects/API_BASE/updateSelection/highlightObject/
 *  updateObjectList/updateRightObjectList/showNotification
 */
(function () {
    'use strict';

    var API_HEADERS = { 'Content-Type': 'application/json' };
    function lockText(key, params) {
        return params ? window.i18n.tp('editorLockUi.' + key, params) : window.i18n.t('editorLockUi.' + key);
    }

    // ===== 锁定状态 =====
    function isLocked(obj) {
        return !!(obj && obj.data && obj.data.is_locked === true);
    }

    // 可锁定：只有 world_objects 真实行带 is_locked 列（ad_slot 等合成对象无此字段）
    function isLockable(obj) {
        return !!(obj && obj.data && obj.data.is_locked !== undefined);
    }

    // 对象是否位于编辑器编组内（mesh 父级为编辑组 Group）
    function isInEditorGroup(obj) {
        return !!(obj && obj.mesh && obj.mesh.parent &&
            obj.mesh.parent.userData && obj.mesh.parent.userData.isEditorGroup === true);
    }

    // ===== 通知 =====
    function objName(obj) {
        return (obj && obj.data && obj.data.name) || (obj ? lockText('objectNumber', { id: obj.id }) : '');
    }

    function notifyLocked(obj) {
        var name = objName(obj);
        showNotification(lockText('alreadyLocked', { name: name }), 'warning');
    }

    function notifyInGroup(obj) {
        var name = objName(obj);
        showNotification(lockText('inGroup', { name: name }), 'warning');
    }

    // ===== 两击解锁确认态 =====
    var _arm = null; // { id, timer }

    function armUnlock(id) {
        disarmUnlock();
        _arm = { id: id, timer: setTimeout(disarmUnlock, 3000) };
        setArmingClass(id, true);
        showNotification(lockText('confirmUnlock'), 'warning');
    }

    function disarmUnlock() {
        if (_arm) {
            setArmingClass(_arm.id, false);
            clearTimeout(_arm.timer);
            _arm = null;
        }
    }

    function isArmed(id) {
        return !!(id !== undefined && _arm && _arm.id === id);
    }

    // 确认态标红：同时命中左右两个列表中的同 id 按钮
    function setArmingClass(id, on) {
        document.querySelectorAll('[data-lock-btn="' + id + '"]').forEach(function (btn) {
            if (on) {
                btn.classList.add('arming');
                btn.textContent = '⚠️';
            } else {
                btn.classList.remove('arming');
                btn.textContent = isLocked(findObj(id)) ? '🔓' : '🔒';
            }
        });
    }

    function findObj(id) {
        if (typeof worldObjects === 'undefined' || !worldObjects) return null;
        return worldObjects.find(function (o) { return o && o.id === id; }) || null;
    }

    // ===== 锁定/解锁 =====
    function setObjectLocked(id, locked, silent) {
        disarmUnlock();
        return fetch(API_BASE + '/objects/' + id + '/lock', {
            method: 'PUT',
            headers: API_HEADERS,
            body: JSON.stringify({ locked: !!locked })
        }).then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.json();
        }).then(function (data) {
            if (!data.success) throw new Error(data.error || lockText('saveFailed'));
            var obj = findObj(id);
            if (obj && obj.data) {
                obj.data.is_locked = !!locked;
                // 净化选中集：锁定对象不可处于选中状态（各入口最终汇合 updateSelection）
                var idx = selectedObjects.indexOf(obj);
                if (idx >= 0) {
                    selectedObjects.splice(idx, 1);
                    if (obj.mesh) highlightObject(obj.mesh, false);
                }
                updateSelection();
                refreshLists();
                if (!silent) {
                    showNotification(
                        locked
                            ? lockText('locked', { name: objName(obj) })
                            : lockText('unlocked', { name: objName(obj) }),
                        'success'
                    );
                }
            }
            return data;
        }).catch(function (err) {
            console.error('设置锁定状态失败:', err);
            showNotification(lockText('saveFailedDetail', { message: err.message }), 'error');
            throw err;
        });
    }

    // 强制左右列表全量重建（锁图标/锁定态需重新渲染，不能走选中样式快路径）
    function refreshLists() {
        if (typeof updateObjectList !== 'function') return;
        window.__weLockDirty = true;
        updateObjectList();
        if (typeof updateRightObjectList === 'function') {
            window.__weLockDirty = true;
            updateRightObjectList();
        }
    }

    // ===== 列表行按钮点击 =====
    function toggleObjectLock(id, event) {
        if (event) event.stopPropagation();
        var obj = findObj(id);
        if (!obj) return;

        if (isLocked(obj)) {
            // 已锁定 → 两击解锁确认
            if (isArmed(id)) {
                disarmUnlock();
                setObjectLocked(id, false);
            } else {
                armUnlock(id);
            }
        } else {
            // 未锁定 → 组内拒绝；否则直接锁定
            disarmUnlock();
            if (isInEditorGroup(obj)) {
                notifyInGroup(obj);
                return;
            }
            if (!isLockable(obj)) {
                showNotification(lockText('unsupported'), 'warning');
                return;
            }
            setObjectLocked(id, true);
        }
    }

    // ===== 工具栏：锁定当前选中对象 =====
    function lockSelectedObjects() {
        if (!selectedObjects || selectedObjects.length === 0) {
            showNotification(lockText('selectFirst'), 'info');
            return;
        }
        var targets = selectedObjects.filter(function (o) {
            return o && isLockable(o) && !isLocked(o);
        });
        if (targets.length === 0) {
            showNotification(lockText('noneLockable'), 'info');
            return;
        }
        var inGroup = targets.filter(isInEditorGroup);
        if (inGroup.length > 0) {
            notifyInGroup(inGroup[0]);
            return;
        }
        // 逐项锁定（组内检查通过后）
        var lockedCount = 0;
        var chain = Promise.resolve();
        targets.forEach(function (o) {
            chain = chain.then(function () {
                return setObjectLocked(o.id, true, true).then(function () { lockedCount++; });
            });
        });
        chain.then(function () {
            showNotification(lockText('lockedCount', { count: lockedCount }), 'success');
        }).catch(function () {});
    }

    // ===== 列表按钮 HTML =====
    function renderLockButton(obj) {
        if (!isLockable(obj)) return '';
        var locked = isLocked(obj);
        var icon = locked ? '🔓' : '🔒';
        var title = locked
            ? lockText('unlockTitle')
            : lockText('lockTitle');
        return '<button class="lock-btn' + (locked ? ' locked' : '') +
            '" data-lock-btn="' + obj.id + '"' +
            ' onclick="EditorObjectLock.toggleObjectLock(' + obj.id + ', event)"' +
            ' title="' + title + '">' + icon + '</button>';
    }

    window.i18n.onLocaleChange(refreshLists);

    // ===== 对外暴露 =====
    window.EditorObjectLock = {
        isLocked: isLocked,
        isLockable: isLockable,
        isInEditorGroup: isInEditorGroup,
        notifyLocked: notifyLocked,
        toggleObjectLock: toggleObjectLock,
        lockSelectedObjects: lockSelectedObjects,
        renderLockButton: renderLockButton,
        disarmUnlock: disarmUnlock
    };
})();
