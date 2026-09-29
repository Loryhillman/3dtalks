/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 *
 * WebGL2 能力检测与友好降级提示（Three.js r185 升级 阶段5 ④）
 *
 * 背景：Three.js r163 起彻底移除 WebGL1 后端。在仅支持 WebGL1 的旧设备 /
 * 未开启硬件加速的浏览器上，new THREE.WebGLRenderer() 直接抛错，主世界
 * 黑屏且无任何提示。
 *
 * 用法：在 three.min.js 之前引入（检测失败时可用 window.stop() 阻止后续
 * 重脚本加载，省流量也避免满屏控制台报错）：
 *   <script src="js/webgl2Guard.js?v=185"></script>
 *
 * 行为：
 *  - 支持 WebGL2：零副作用退出（不创建任何 DOM / 全局污染，仅暴露
 *    window.checkWebGL2Support 供其他页面复用）。
 *  - 不支持：设置 window.__WEBGL2_UNSUPPORTED = true，展示全屏中文提示
 *    （浏览器升级建议 + 硬件加速开关指引），并 window.stop() 中止页面
 *    剩余解析（overlay 为 JS 内联样式，不受中止影响）。
 */
(function () {
    'use strict';

    function checkWebGL2Support() {
        try {
            if (typeof window === 'undefined' || !window.WebGL2RenderingContext) return false;
            var c = document.createElement('canvas');
            return !!(c.getContext && c.getContext('webgl2'));
        } catch (e) {
            return false;
        }
    }

    // 供其他页面（编辑器等）复用；返回 true/false
    window.checkWebGL2Support = checkWebGL2Support;

    if (checkWebGL2Support()) return;

    window.__WEBGL2_UNSUPPORTED = true;

    // The main catalog loads later, so this boot failure needs synchronous copy.
    var locale = 'zh-CN';
    try { locale = localStorage.getItem('preferredLocale') || localStorage.getItem('locale') || document.documentElement.lang || 'zh-CN'; } catch (e) { /* ignore */ }
    var messages = {
        'zh-CN': {
            title: '当前浏览器不支持 WebGL2',
            description: '虚拟世界的 3D 场景需要 <b>WebGL2</b> 渲染支持，当前浏览器无法创建 3D 画面。<br><br>请尝试以下解决办法：<br>1. 升级浏览器至较新版本；<br>2. 在浏览器设置中开启硬件加速并重启浏览器；<br>3. 在手机上更新浏览器；<br>4. 若使用远程桌面或虚拟机，请在本机浏览器中打开。',
            hint: '完成调整后刷新本页面即可重新进入虚拟世界'
        },
        'en-US': {
            title: 'This browser does not support WebGL2',
            description: 'The 3D world requires <b>WebGL2</b>, but this browser cannot render it.<br><br>Try the following:<br>1. Update your browser;<br>2. Enable hardware acceleration in browser settings and restart it;<br>3. Update your mobile browser;<br>4. If using a remote desktop or virtual machine, open the page on your own computer.',
            hint: 'Refresh this page after making changes to enter the world.'
        },
        'ru-RU': {
            title: 'Браузер не поддерживает WebGL2',
            description: 'Для отображения 3D мира требуется <b>WebGL2</b>. Этот браузер не может показать сцену.<br><br>Попробуйте следующее:<br>1. Обновите браузер;<br>2. Включите аппаратное ускорение в настройках браузера и перезапустите его;<br>3. Обновите браузер на телефоне;<br>4. При использовании удалённого рабочего стола или виртуальной машины откройте страницу на своём компьютере.',
            hint: 'После изменений обновите страницу, чтобы войти в мир.'
        }
    };
    var copy = messages[locale] || messages['zh-CN'];

    // ---- 全屏友好降级提示（内联样式，不依赖任何外部 CSS） ----
    try {
        var overlay = document.createElement('div');
        overlay.id = 'webgl2-unsupported-overlay';
        overlay.setAttribute('style', [
            'position:fixed', 'inset:0', 'z-index:2147483647',
            'background:rgba(11,11,20,.96)',
            'display:flex', 'align-items:center', 'justify-content:center',
            'font-family:"Microsoft YaHei","PingFang SC",Arial,sans-serif',
            'color:#e8e8ef', 'text-align:center', 'padding:24px',
            'box-sizing:border-box'
        ].join(';'));

        var card = document.createElement('div');
        card.setAttribute('style', [
            'max-width:520px', 'background:#151527', 'border:1px solid #2c2c44',
            'border-radius:14px', 'padding:36px 40px', 'box-shadow:0 8px 40px rgba(0,0,0,.5)'
        ].join(';'));

        var icon = document.createElement('div');
        icon.textContent = '⚠️';
        icon.setAttribute('style', 'font-size:44px;margin-bottom:14px');

        var title = document.createElement('div');
        title.textContent = copy.title;
        title.setAttribute('style', 'font-size:22px;font-weight:600;color:#f87171;margin-bottom:16px');

        var desc = document.createElement('div');
        desc.setAttribute('style', 'font-size:14px;line-height:1.9;color:#c9c9e0;text-align:left');
        desc.innerHTML = copy.description;

        var hint = document.createElement('div');
        hint.textContent = copy.hint;
        hint.setAttribute('style', 'margin-top:20px;font-size:12px;color:#8a8aa0');

        card.appendChild(icon);
        card.appendChild(title);
        card.appendChild(desc);
        card.appendChild(hint);
        overlay.appendChild(card);
        (document.body || document.documentElement).appendChild(overlay);
    } catch (e) { /* DOM 构建异常时保留 flag 即可 */ }

    // 中止页面剩余解析：后续脚本（world.js 等）不再解析执行，避免 world 初始化
    // 在无 WebGL2 时抛错刷屏（overlay 已覆盖全屏）。注意：浏览器预加载扫描器
    // 可能已提前预取 three.min.js 的字节（请求已发出无法撤回），但解析中止后
    // 该脚本不会执行 —— 权威判据是 window.THREE 保持 undefined。
    try { window.stop(); } catch (e) { /* 旧浏览器兜底：忽略 */ }
})();
