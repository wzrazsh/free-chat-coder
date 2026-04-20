window.ModelReader = {
  /**
   * 读取模型模式状态
   */
  readModelState(params = {}) {
    // DeepSeek 深度思考和联网搜索按钮
    const deepThinkBtn = window.DOMHelpers ? window.DOMHelpers.findElementByText('.ds-toggle-button, div[role="button"]', '深度思考') : null;
    const searchBtn = window.DOMHelpers ? window.DOMHelpers.findElementByText('.ds-toggle-button, div[role="button"]', '联网搜索') : null;
    
    let deepThinkEnabled = false;
    let searchEnabled = false;
    
    // 假设被选中时会带有某个 class 或者 aria-checked="true"
    if (deepThinkBtn) {
      deepThinkEnabled = deepThinkBtn.classList.contains('ds-toggle-button--selected') || deepThinkBtn.getAttribute('aria-checked') === 'true' || deepThinkBtn.style.color.includes('rgb(77, 107, 254)');
    }
    
    if (searchBtn) {
      searchEnabled = searchBtn.classList.contains('ds-toggle-button--selected') || searchBtn.getAttribute('aria-checked') === 'true' || searchBtn.style.color.includes('rgb(77, 107, 254)');
    }
    
    return {
      success: true,
      data: {
        deepThink: {
          enabled: deepThinkEnabled,
          label: "深度思考"
        },
        search: {
          enabled: searchEnabled,
          label: "联网搜索"
        },
        currentModel: "DeepSeek-V3" // 如果需要，可以从页面的下拉框读取
      }
    };
  }
};
