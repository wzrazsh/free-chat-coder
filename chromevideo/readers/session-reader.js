window.SessionReader = {
  _extractSessionId(value) {
    const match = value && value.match(/\/a\/chat\/s\/([^/?#]+)/);
    return match ? match[1] : null;
  },

  readSessionList(params = {}) {
    const { includeDates = true } = params;
    const sessionLinks = document.querySelectorAll('a[href*="/a/chat/s/"]');
    const sessions = [];
    const currentSessionId = this._extractSessionId(window.location.pathname);

    sessionLinks.forEach((link) => {
      const href = link.getAttribute('href') || '';
      const id = this._extractSessionId(href);
      const titleEl = link.querySelector('.truncate') || link;
      const title = (titleEl.innerText || titleEl.textContent || '').trim();

      let dateGroup = '未知';
      if (includeDates) {
        let prev = link.previousElementSibling;
        while (prev && prev.tagName !== 'DIV') {
          prev = prev.previousElementSibling;
        }
        if (prev && prev.textContent) {
          dateGroup = prev.textContent.trim();
        }
      }

      const isActive =
        link.classList.contains('active') ||
        link.getAttribute('aria-current') === 'page' ||
        link.getAttribute('data-active') === 'true' ||
        (id && currentSessionId && id === currentSessionId);

      sessions.push({
        id,
        title,
        href,
        dateGroup,
        isActive
      });
    });

    return {
      success: true,
      data: {
        sessions,
        currentSessionId,
        totalCount: sessions.length
      }
    };
  }
};
