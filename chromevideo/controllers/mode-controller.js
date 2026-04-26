window.ModeController = {
  _findElementByText(root, text) {
    const walker = document.createTreeWalker(
      root || document, 
      NodeFilter.SHOW_TEXT, 
      null, 
      false
    );
    
    let node;
    while (node = walker.nextNode()) {
      if (node.textContent && node.textContent.includes(text)) {
        const el = node.parentElement;
        if (el) return el;
      }
    }
    return null;
  },

  _toggleState(element) {
    if (!element) {
      return false;
    }

    if (element.tagName === 'INPUT' && element.type === 'radio') {
      return element.checked;
    }

    const isSelected = (el) => {
      return el.classList.contains('ds-toggle-button--selected') ||
        el.classList.contains('active') ||
        el.classList.contains('selected') ||
        el.getAttribute('aria-checked') === 'true' ||
        el.getAttribute('aria-selected') === 'true' ||
        el.getAttribute('data-state') === 'active' ||
        (el.style && el.style.color && el.style.color.includes('rgb(77, 107, 254)'));
    };

    return isSelected(element);
  },

  _findModeButton(label) {
    return this._findElementByText(null, label);
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
    const result = {
      success: true,
      data: {
        modelMode: deepThink ? 'deepThink' : 'quick',
        searchEnabled: !!search
      }
    };
    return result;
  }
};