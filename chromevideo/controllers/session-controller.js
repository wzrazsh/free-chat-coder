window.SessionController = {
  /**
   * 创建新会话
   */
  createSession(params) {
    const { title } = params;
    
    const newChatBtn = window.DOMHelpers.findElementByText('div, button', '开启新对话');
    if (newChatBtn) {
      newChatBtn.click();
      console.log('[SessionController] Clicked new chat button.');
      
      // TODO: 如果提供了 title，可能需要在创建后修改，目前先只创建
      return { success: true, message: 'New session created' };
    }
    
    return { success: false, error: 'NewChatButtonNotFound: Could not find the "开启新对话" button' };
  },

  /**
   * 切换会话
   */
  switchSession(params) {
    const { sessionId, titleMatch } = params;
    
    const sessionLinks = document.querySelectorAll('a[href*="/a/chat/s/"]');
    for (let link of sessionLinks) {
      if (sessionId && link.getAttribute('href').includes(sessionId)) {
        link.click();
        return { success: true, message: `Switched to session ${sessionId}` };
      }
      
      if (titleMatch) {
        const titleEl = link.querySelector('.truncate') || link;
        const title = titleEl.innerText || titleEl.textContent;
        if (title.includes(titleMatch)) {
          link.click();
          return { success: true, message: `Switched to session matching "${titleMatch}"` };
        }
      }
    }
    
    return { success: false, error: 'SessionNotFound: Could not find matching session' };
  }
};