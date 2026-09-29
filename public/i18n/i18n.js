/**
 * 国际化（i18n）核心库
 * Supports Chinese, English and Russian interfaces.
 * 
 * 特性：
 * - 语言切换器显示对方语言（中文界面显示"Language"，英文界面显示"语言"）
 * - The server stores the default for new visitors.
 * - Each browser stores its own explicit choice.
 * 
 * 济宁米多信息科技有限公司 版权所有
 */
class I18n {
  constructor() {
    this.supportedLocales = ['zh-CN', 'en-US', 'ru-RU'];
    this.currentLocale = 'zh-CN';
    this.translations = {};
    this.initialized = false;
    this.callbacks = [];
    this._initPromise = null;
  }

  /**
   * 获取存储的语言设置（仅本地缓存）
   */
  getStoredLocale() {
    try {
      const locale = localStorage.getItem('preferredLocale');
      return this.supportedLocales.includes(locale) ? locale : null;
    } catch (e) {
      return null;
    }
  }

  /**
   * 从服务器获取系统语言设置（权威来源）
   */
  async fetchLocaleFromServer() {
    try {
      const response = await fetch('/api/config/language');
      if (response.ok) {
        const data = await response.json();
        if (data.language && this.supportedLocales.includes(data.language)) {
          // A world default applies only when this browser has no personal choice.
          this.currentLocale = this.getStoredLocale() || data.language;
          try { localStorage.setItem('locale', this.currentLocale); } catch (e) { /* ignore */ }
          console.log('[i18n] 从服务器获取语言:', this.currentLocale);
          return this.currentLocale;
        }
      }
    } catch (error) {
      console.warn('[i18n] 从服务器获取语言失败，使用本地缓存:', error.message);
    }
    
    // 降级：使用本地缓存或默认中文
    const cached = this.getStoredLocale();
    this.currentLocale = cached || 'zh-CN';
    console.log('[i18n] 使用缓存/默认语言:', this.currentLocale);
    return this.currentLocale;
  }

  /**
   * 初始化 i18n：获取语言设置 + 加载语言包
   */
  async init() {
    if (this.initialized) return Promise.resolve();
    
    if (this._initPromise) return this._initPromise;
    
    this._initPromise = (async () => {
      // 1. 从服务器获取语言设置
      await this.fetchLocaleFromServer();
      
      // 2. 加载对应的语言包
      await this._loadTranslations(this.currentLocale);
      if (this.currentLocale !== 'en-US') await this._loadTranslations('en-US');
      
      this.initialized = true;
      console.log('[i18n] 初始化完成, locale:', this.currentLocale);
      return;
    })();
    
    return this._initPromise;
  }

  /**
   * 加载语言包 JSON
   */
  async _loadTranslations(locale) {
    // 如果已缓存则跳过
    if (this.translations[locale]) return;

    try {
      const response = await fetch(`/i18n/${locale}.json`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      this.translations[locale] = await response.json();
      console.log('[i18n] 语言包加载完成:', locale);
    } catch (error) {
      console.error('[i18n] 加载语言包失败:', error);
      // Fall back to a complete source catalog.
      const fallback = locale === 'zh-CN' ? 'en-US' : 'zh-CN';
      if (!this.translations[fallback]) {
        try {
          const fbResp = await fetch(`/i18n/${fallback}.json`, { cache: 'no-store' });
          if (fbResp.ok) {
            this.translations[fallback] = await fbResp.json();
            console.warn('[i18n] 已降级到:', fallback);
          }
        } catch (e) {
          console.error('[i18n] 降级也失败:', e);
        }
      }
    }
  }

  /**
   * Admin changes the default for new visitors and their current browser.
   * @returns {Promise<boolean>} 是否成功
   */
  async setLocaleToServer(locale) {
    if (!this.supportedLocales.includes(locale)) {
      console.error('[i18n] 无效的语言:', locale);
      return false;
    }

    try {
      const token = localStorage.getItem('adminToken');
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const response = await fetch('/api/config/language', {
        method: 'PUT',
        headers,
        body: JSON.stringify({ language: locale })
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${response.status}`);
      }

      // 保存成功后本地切换
      this.currentLocale = locale;
      // The admin also explicitly chose this language for this browser.
      try { localStorage.setItem('preferredLocale', locale); localStorage.setItem('locale', locale); } catch (e) { /* ignore */ }
      this.initialized = false;
      this._initPromise = null;
      // 清除旧的语言包缓存，强制重新加载（确保最新翻译生效）
      delete this.translations[locale];
      await this._loadTranslations(locale);
      if (locale !== 'en-US') await this._loadTranslations('en-US');
      this.initialized = true;

      // 触发所有回调
      this.callbacks.forEach(cb => {
        try { cb(this.currentLocale); } catch (e) { console.error('[i18n] callback error:', e); }
      });

      console.log('[i18n] 语言已切换到:', locale);
      return true;
    } catch (error) {
      console.error('[i18n] 保存语言到服务器失败:', error);
      return false;
    }
  }

  /**
   * Store this browser's language preference without changing the world default.
   */
  async setLocaleLocal(locale) {
    if (!this.supportedLocales.includes(locale)) return;
    if (this.currentLocale === locale && this.initialized) return;

    this.currentLocale = locale;
    try { localStorage.setItem('preferredLocale', locale); localStorage.setItem('locale', locale); } catch (e) { /* ignore */ }
    this.initialized = false;
    this._initPromise = null;
    await this._loadTranslations(locale);
    if (locale !== 'en-US') await this._loadTranslations('en-US');
    this.initialized = true;

    this.callbacks.forEach(cb => {
      try { cb(this.currentLocale); } catch (e) { console.error('[i18n] callback error:', e); }
    });
  }

  /**
   * 注册语言切换回调
   */
  onLocaleChange(callback) {
    if (typeof callback === 'function') {
      this.callbacks.push(callback);
    }
  }

  /**
   * 翻译函数
   * @param {string} key - 点分隔的翻译键，如 "admin.title"、"world.health"
   * @returns {string} 翻译后的文字
   */
  t(key) {
    if (!this.initialized) return key;

    const keys = key.split('.');
    const resolve = locale => {
      let result = this.translations[locale];
      for (const k of keys) {
        if (!result || typeof result !== 'object' || !(k in result)) return null;
        result = result[k];
      }
      return typeof result === 'string' ? result : null;
    };
    return resolve(this.currentLocale) || resolve('en-US') || resolve('zh-CN') || key;
  }

  /**
   * Translate API metadata, preserving messages from older or unknown responses.
   * @param {Object} response - errorKey/messageKey and optional messageParams
   * @param {string} fallback - Used when the response has no message
   */
  apiMessage(response, fallback = '') {
    if (!response || typeof response !== 'object') return fallback;
    const key = response.errorKey || response.messageKey;
    if (typeof key === 'string') {
      const translated = this.t(key);
      if (translated !== key) return this.tp(key, response.messageParams || {});
    }
    return response.error || response.message || fallback;
  }

  /** Substitute {{name}} parameters in a catalog translation. */
  tp(key, params = {}) {
    let text = this.t(key);
    if (params && typeof text === 'string') {
      Object.keys(params).forEach(param => {
        text = text.replaceAll(`{{${param}}}`, params[param]);
      });
    }
    return text;
  }

  /**
   * 获取语言切换器的显示文字（显示对方的语言）
   * 中文界面 → 返回 "Language"
   * 英文界面 → 返回 "语言"
   */
  getSwitchText() {
    return this.t('language_switch');
  }

  /**
   * 获取当前语言代码
   */
  getCurrentLocale() {
    return this.currentLocale;
  }
}

// 创建全局实例
window.i18n = new I18n();
