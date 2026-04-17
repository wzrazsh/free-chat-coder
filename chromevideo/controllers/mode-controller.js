window.ModeController = {
  _toggleState(element) {
    if (!element) {
      return false;
    }

    return element.classList.contains('ds-toggle-button--selected') ||
      element.classList.contains('active') ||
      element.getAttribute('aria-checked') === 'true' ||
      element.getAttribute('aria-selected') === 'true' ||
      element.getAttribute('data-state') === 'active' ||
      element.style.color.includes('rgb(77, 107, 254)');
  },

  _findModeButton(label) {
    return window.DOMHelpers.findElementByText('button, div[role="button"], div', label);
  },

  readModeProfile() {
    const expertButton = this._findModeButton('专家模式');
    const quickButton = this._findModeButton('快速模式');

    let profile = 'unknown';
    if (expertButton && this._toggleState(expertButton)) {
      profile = 'expert';
    } else if (quickButton && this._toggleState(quickButton)) {
      profile = 'quick';
    }

    return {
      success: true,
      data: {
        profile,
        hasExpertToggle: !!expertButton,
        hasQuickToggle: !!quickButton
      }
    };
  },

  setModeProfile(params = {}) {
    const profile = params.profile || 'expert';
    const targetLabel = profile === 'quick' ? '快速模式' : '专家模式';
    const targetButton = this._findModeButton(targetLabel);

    if (targetButton) {
      if (!this._toggleState(targetButton)) {
        targetButton.click();
      }

      return {
        success: true,
        data: {
          profile,
          switchedBy: 'native_profile_toggle'
        }
      };
    }

    const fallback = profile === 'expert'
      ? this.setModelMode({ deepThink: true, search: true })
      : this.setModelMode({ deepThink: false, search: false });

    return {
      success: fallback.success,
      data: {
        profile,
        switchedBy: 'deepthink_search_fallback',
        fallback: fallback.data || null
      },
      error: fallback.error
    };
  },

  setModelMode(params = {}) {
    const { deepThink, search } = params;

    if (typeof deepThink === 'boolean') {
      const deepThinkBtn = window.DOMHelpers.findElementByText('.ds-toggle-button, div[role="button"]', '深度思考');
      if (deepThinkBtn) {
        const isEnabled = this._toggleState(deepThinkBtn);
        if (deepThink !== isEnabled) {
          deepThinkBtn.click();
          console.log(`[ModeController] Toggled deepThink to ${deepThink}`);
        }
      }
    }

    if (typeof search === 'boolean') {
      const searchBtn = window.DOMHelpers.findElementByText('.ds-toggle-button, div[role="button"]', '联网搜索');
      if (searchBtn) {
        const isEnabled = this._toggleState(searchBtn);
        if (search !== isEnabled) {
          searchBtn.click();
          console.log(`[ModeController] Toggled search to ${search}`);
        }
      }
    }

    return {
      success: true,
      data: {
        deepThink: typeof deepThink === 'boolean' ? deepThink : null,
        search: typeof search === 'boolean' ? search : null
      }
    };
  }
};
