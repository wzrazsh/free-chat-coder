window.ModeController = {
  /**
   * 切换深度思考或联网搜索模式
   */
  setModelMode(params) {
    const { deepThink, search } = params;
    
    if (typeof deepThink === 'boolean') {
      const deepThinkBtn = window.DOMHelpers.findElementByText('.ds-toggle-button, div[role="button"]', '深度思考');
      if (deepThinkBtn) {
        const isEnabled = deepThinkBtn.classList.contains('ds-toggle-button--selected') || deepThinkBtn.getAttribute('aria-checked') === 'true' || deepThinkBtn.style.color.includes('rgb(77, 107, 254)');
        if (deepThink !== isEnabled) {
          deepThinkBtn.click();
          console.log(`[ModeController] Toggled deepThink to ${deepThink}`);
        }
      }
    }
    
    if (typeof search === 'boolean') {
      const searchBtn = window.DOMHelpers.findElementByText('.ds-toggle-button, div[role="button"]', '联网搜索');
      if (searchBtn) {
        const isEnabled = searchBtn.classList.contains('ds-toggle-button--selected') || searchBtn.getAttribute('aria-checked') === 'true' || searchBtn.style.color.includes('rgb(77, 107, 254)');
        if (search !== isEnabled) {
          searchBtn.click();
          console.log(`[ModeController] Toggled search to ${search}`);
        }
      }
    }
    
    return { success: true };
  }
};