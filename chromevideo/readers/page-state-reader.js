window.PageStateReader = {
  /**
   * 读取页面运行状态
   */
  readPageState(params = {}) {
    // 检查是否正在生成
    const stopBtn = document.querySelector('div[class*="stop"]') || document.querySelector('button[class*="stop"]') || document.querySelector('[data-testid="stop-button"]');
    const isGenerating = !!stopBtn;

    // 检查输入框状态
    const input = document.querySelector('#chat-input') || document.querySelector('textarea[placeholder*="message"]') || document.querySelector('textarea');
    let isInputReady = false;
    if (input && !input.disabled && !input.readOnly) {
      isInputReady = true;
    }

    // 检查是否登录 (如果有登录按钮，说明没登录)
    const loginBtn = window.DOMHelpers ? window.DOMHelpers.findElementByText('div, button, a', '登录') : document.querySelector('a[href*="login"]');
    const isLoggedIn = !loginBtn;

    // 检查是否有错误提示弹窗 (比如 Network Error)
    const errorToast = document.querySelector('.ds-toast--error');
    const hasError = !!errorToast;
    const errorMessage = hasError ? (errorToast.innerText || errorToast.textContent) : null;

    return {
      success: true,
      data: {
        isGenerating,
        isInputReady,
        currentUrl: window.location.href,
        currentSessionId: (() => {
          const match = window.location.pathname.match(/\/a\/chat\/s\/([^/?#]+)/);
          return match ? match[1] : null;
        })(),
        isLoggedIn,
        hasError,
        errorMessage
      }
    };
  }
};
