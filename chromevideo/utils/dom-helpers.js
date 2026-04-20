window.DOMHelpers = {
  /**
   * 等待指定的 DOM 元素出现
   * @param {string} selector CSS 选择器
   * @param {number} timeout 超时时间(ms)
   * @returns {Promise<Element>}
   */
  waitForElement(selector, timeout = 5000) {
    return new Promise((resolve, reject) => {
      const el = document.querySelector(selector);
      if (el) {
        return resolve(el);
      }

      const observer = new MutationObserver((mutations, obs) => {
        const el = document.querySelector(selector);
        if (el) {
          resolve(el);
          obs.disconnect();
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true
      });

      setTimeout(() => {
        observer.disconnect();
        resolve(null); // 不抛出错误，返回 null 以便外层处理
      }, timeout);
    });
  },

  /**
   * 根据文本内容查找元素
   * @param {string} selector CSS 选择器
   * @param {string} text 要查找的文本
   * @param {boolean} exact 是否精确匹配
   * @returns {Element|null}
   */
  findElementByText(selector, text, exact = false) {
    const elements = document.querySelectorAll(selector);
    for (const el of elements) {
      const content = el.textContent.trim();
      if (exact) {
        if (content === text) return el;
      } else {
        if (content.includes(text)) return el;
      }
    }
    return null;
  },

  /**
   * 模拟用户输入
   * @param {HTMLInputElement|HTMLTextAreaElement} element 输入框元素
   * @param {string} value 要输入的值
   */
  simulateInput(element, value) {
    element.value = value;
    element.dispatchEvent(new Event('input', { bubbles: true }));
  }
};
