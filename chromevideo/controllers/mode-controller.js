window.ModeController = {
  _findElementByText(root, text, preferInteractive = false) {
    const walker = document.createTreeWalker(
      root || document, 
      NodeFilter.SHOW_TEXT, 
      null, 
      false
    );
    
    let node;
    let bestMatch = null;
    let bestMatchInteractive = false;
    while (node = walker.nextNode()) {
      if (node.textContent && node.textContent.includes(text)) {
        const el = node.parentElement;
        if (!el) continue;
        const isExact = node.textContent.trim() === text;
        if (preferInteractive) {
          const interactive = this._findInteractiveAncestor(el);
          if (interactive) {
            if (isExact) return interactive;
            if (!bestMatch || !bestMatchInteractive) {
              bestMatch = interactive;
              bestMatchInteractive = true;
            }
          }
        } else {
          if (isExact) return el;
          if (!bestMatch) {
            bestMatch = el;
          }
        }
      }
    }
    return bestMatch;
  },

  _findInteractiveAncestor(el, maxLevels = 5) {
    if (!el) return null;
    let current = el;
    for (let i = 0; i < maxLevels; i++) {
      if (!current) return null;
      if (current.getAttribute && current.getAttribute('role') === 'radio') return current;
      if (current.classList && (current.classList.contains('ds-toggle-button') || current.classList.contains('ds-atom-button'))) return current;
      current = current.parentElement;
    }
    return el;
  },

  _findToggleByText(text) {
    return this._findElementByText(null, text, true);
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
    return this._findToggleByText(label);
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
    const results = {};

    if (deepThink !== undefined) {
      const deepThinkBtn = this._findToggleByText('深度思考');
      if (deepThinkBtn) {
        const isActive = this._toggleState(deepThinkBtn);
        if (deepThink && !isActive) {
          deepThinkBtn.click();
        } else if (!deepThink && isActive) {
          deepThinkBtn.click();
        }
        results.deepThink = { found: true, toggled: deepThink ? (!isActive) : isActive };
      } else {
        results.deepThink = { found: false };
      }
    }

    if (search !== undefined) {
      let searchBtn = this._findToggleByText('联网搜索');
      if (!searchBtn) {
        searchBtn = this._findToggleByText('智能搜索');
      }
      if (searchBtn) {
        const isActive = this._toggleState(searchBtn);
        if (search && !isActive) {
          searchBtn.click();
        } else if (!search && isActive) {
          searchBtn.click();
        }
        results.search = { found: true, toggled: search ? (!isActive) : isActive };
      } else {
        results.search = { found: false };
      }
    }

    const anyFound = (results.deepThink?.found || results.search?.found);
    return {
      success: anyFound ? true : false,
      data: {
        modelMode: deepThink ? 'deepThink' : 'quick',
        searchEnabled: !!search,
        results
      },
      error: anyFound ? undefined : 'No toggle buttons found'
    };
  }
};
