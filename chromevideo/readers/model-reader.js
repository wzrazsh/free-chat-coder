window.ModelReader = {
  /**
   * 读取模型模式状态
   */
  readModelState(params = {}) {
    // DeepSeek 深度思考和联网搜索按钮
    // 按钮使用 ds-toggle-button 类，点击时内部文字为 "DeepThink" 或 "Search"
    const allToggles = document.querySelectorAll('.ds-toggle-button');

    let deepThinkBtn = null;
    let searchBtn = null;

    for (const toggle of allToggles) {
      const text = toggle.textContent || '';
      if (text.includes('DeepThink')) {
        deepThinkBtn = toggle;
      } else if (text.includes('Search')) {
        searchBtn = toggle;
      }
    }

    let deepThinkEnabled = false;
    let searchEnabled = false;

    // 使用 ds-toggle-button--selected 类判断是否选中
    if (deepThinkBtn) {
      deepThinkEnabled = deepThinkBtn.classList.contains('ds-toggle-button--selected');
    }

    if (searchBtn) {
      searchEnabled = searchBtn.classList.contains('ds-toggle-button--selected');
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
