window.SessionController = {
  clickByText(selectors, textCandidates) {
    const els = document.querySelectorAll(selectors);
    for (const el of els) {
      const t = (el.textContent || '').trim();
      for (const c of textCandidates) {
        if (t.includes(c)) {
          el.click();
          return true;
        }
      }
    }
    return false;
  },

  async createSession(params = {}) {
    const ok = this.clickByText('div[role="button"], button, a', ['开启新对话', '新对话', 'New chat', 'New Chat']);
    if (!ok) return { success: false, error: 'CreateSessionButtonNotFound' };
    return { success: true };
  },

  async switchSession(params = {}) {
    const { sessionId, titleMatch } = params;
    const links = Array.from(document.querySelectorAll('a[href*="/a/chat/s/"]'));
    let target = null;

    if (sessionId) {
      target = links.find((a) => (a.getAttribute('href') || '').includes(sessionId));
    }
    if (!target && titleMatch) {
      target = links.find((a) => ((a.textContent || '').trim().toLowerCase()).includes(titleMatch.toLowerCase()));
    }
    if (!target) return { success: false, error: 'SessionNotFound' };
    target.click();
    return { success: true, result: { href: target.getAttribute('href') } };
  }
};

