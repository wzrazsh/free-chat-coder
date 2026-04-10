window.ModeController = {
  isEnabled(btn) {
    if (!btn) return false;
    if (btn.classList && btn.classList.contains('ds-toggle-button--selected')) return true;
    if (btn.getAttribute && btn.getAttribute('aria-checked') === 'true') return true;
    return false;
  },

  async setModelMode(params = {}) {
    const { deepThink = null, search = null } = params;

    const getBtn = (label) => {
      if (window.DOMHelpers?.findElementByText) return window.DOMHelpers.findElementByText('.ds-toggle-button, div[role="button"], button', label);
      const els = document.querySelectorAll('.ds-toggle-button, div[role="button"], button');
      for (const el of els) {
        const t = (el.textContent || '').trim();
        if (t.includes(label)) return el;
      }
      return null;
    };

    const toggleIfNeeded = async (btn, desired) => {
      if (desired === null) return { changed: false };
      if (!btn) return { changed: false, error: 'ToggleNotFound' };
      const current = this.isEnabled(btn);
      if (current === desired) return { changed: false };
      btn.click();
      return { changed: true };
    };

    const deepThinkBtn = getBtn('深度思考');
    const searchBtn = getBtn('联网搜索');

    const deepThinkRes = await toggleIfNeeded(deepThinkBtn, deepThink);
    const searchRes = await toggleIfNeeded(searchBtn, search);

    if (deepThinkRes.error || searchRes.error) {
      return { success: false, error: [deepThinkRes.error, searchRes.error].filter(Boolean).join(',') };
    }

    return {
      success: true,
      data: {
        deepThink: deepThinkRes.changed ? deepThink : undefined,
        search: searchRes.changed ? search : undefined
      }
    };
  }
};

