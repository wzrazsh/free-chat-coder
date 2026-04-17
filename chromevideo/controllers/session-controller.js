window.SessionController = {
  _extractSessionId(value = window.location.pathname) {
    const match = value && value.match(/\/a\/chat\/s\/([^/?#]+)/);
    return match ? match[1] : null;
  },

  _resolveActiveSession() {
    const activeLink = document.querySelector('a[href*="/a/chat/s/"][aria-current="page"], a[href*="/a/chat/s/"].active, a[href*="/a/chat/s/"][data-active="true"]');
    if (activeLink) {
      const href = activeLink.getAttribute('href') || '';
      return {
        sessionId: this._extractSessionId(href) || this._extractSessionId(),
        href,
        title: (activeLink.querySelector('.truncate') || activeLink).textContent.trim()
      };
    }

    return {
      sessionId: this._extractSessionId(),
      href: window.location.pathname,
      title: document.title
    };
  },

  async createSession(params = {}) {
    const { title } = params;
    const newChatBtn =
      window.DOMHelpers.findElementByText('div, button', '开启新对话') ||
      window.DOMHelpers.findElementByText('div, button', '新对话') ||
      window.DOMHelpers.findElementByText('div, button', '开始新对话');

    if (!newChatBtn) {
      return { success: false, error: 'NewChatButtonNotFound: Could not find the new chat button' };
    }

    newChatBtn.click();
    console.log('[SessionController] Clicked new chat button.');
    await window.AntiDetection.delay(1200);

    return {
      success: true,
      message: 'New session created',
      data: {
        requestedTitle: title || null,
        ...this._resolveActiveSession(),
        hasBoundSessionId: !!this._resolveActiveSession().sessionId
      }
    };
  },

  async switchSession(params = {}) {
    const { sessionId, titleMatch } = params;
    const sessionLinks = document.querySelectorAll('a[href*="/a/chat/s/"]');

    for (const link of sessionLinks) {
      const href = link.getAttribute('href') || '';
      if (sessionId && href.includes(sessionId)) {
        link.click();
        await window.AntiDetection.delay(1200);
        return {
          success: true,
          message: `Switched to session ${sessionId}`,
          data: this._resolveActiveSession()
        };
      }

      if (titleMatch) {
        const titleEl = link.querySelector('.truncate') || link;
        const title = titleEl.innerText || titleEl.textContent || '';
        if (title.includes(titleMatch)) {
          link.click();
          await window.AntiDetection.delay(1200);
          return {
            success: true,
            message: `Switched to session matching "${titleMatch}"`,
            data: this._resolveActiveSession()
          };
        }
      }
    }

    return { success: false, error: 'SessionNotFound: Could not find matching session' };
  }
};
