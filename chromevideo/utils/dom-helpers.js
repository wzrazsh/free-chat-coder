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
  },

  /**
   * 从助手消息 DOM 节点中提取正式回答正文，排除思考区域
   * DeepSeek 将模型的推理过程放在 "已思考" 折叠区域内，
   * 正式回答在单独的正文区域。此函数负责将两者分离。
   *
   * @param {Element} node - 助手消息的 DOM 节点（通常为 .ds-markdown 或类似容器）
   * @returns {{ finalReply: string, thinkContent: string }}
   */
  extractAssistantContent(node) {
    if (!node) {
      return { finalReply: '', thinkContent: '' };
    }

    // 1. 尝试从思考区域提取思考内容
    //    DeepSeek 的思考区域特征：
    //    - class 包含 think / reasoning / thought
    //    - 或者是一个 <details> 折叠元素
    //    - 或者标题文本包含 "已思考" / "已深度思考"
    let thinkContent = '';

    // 1a. 优先查找 class 匹配的思考区域
    const thinkSelectors = [
      '[class*="think"]',
      '[class*="reasoning"]',
      '[class*="thought"]'
    ];
    for (const selector of thinkSelectors) {
      const thinkEl = node.querySelector(selector);
      if (thinkEl) {
        const text = (thinkEl.innerText || thinkEl.textContent || '').trim();
        if (text && (text.includes('已思考') || text.includes('已深度思考') || text.includes('reasoning') || text.includes('Thinking'))) {
          thinkContent = text;
          break;
        }
      }
    }

    // 1b. 如果没找到，检查 <details> 折叠元素
    if (!thinkContent) {
      const details = node.querySelector('details');
      if (details) {
        const text = (details.innerText || details.textContent || '').trim();
        if (text && (text.includes('已思考') || text.includes('已深度思考') || text.includes('reasoning'))) {
          thinkContent = text;
        }
      }
    }

    // 1c. 如果还没找到，检查兄弟节点（兼容旧结构）
    if (!thinkContent) {
      const prev = node.previousElementSibling;
      if (prev && (prev.className.includes('think') || prev.className.includes('reasoning'))) {
        thinkContent = (prev.innerText || prev.textContent || '').trim();
      }
    }

    // 2. 克隆节点并删除所有思考区域，提取纯正文
    try {
      const clone = node.cloneNode(true);

      // 2a. 移除 class 匹配的思考区域
      const toRemove = clone.querySelectorAll(
        '[class*="think"], [class*="reasoning"], [class*="thought"]'
      );
      toRemove.forEach(el => {
        const text = (el.innerText || el.textContent || '').trim();
        // 双重验证：只有匹配思考关键字的才删除，避免误删正文中的<style>等
        if (text && (text.includes('已思考') || text.includes('已深度思考') || text.includes('reasoning') || text.includes('Thinking'))) {
          el.remove();
        }
      });

      // 2b. 移除 <details> 折叠元素（如果其内容匹配思考特征）
      const details = clone.querySelector('details');
      if (details) {
        const text = (details.innerText || details.textContent || '').trim();
        if (text && (text.includes('已思考') || text.includes('已深度思考') || text.includes('reasoning'))) {
          details.remove();
        }
      }

      // 3. 读取剩余文本作为正式回答
      const finalReply = (clone.innerText || clone.textContent || '').trim();

      return { finalReply, thinkContent };
    } catch (err) {
      // 兜底：如果 DOM 操作失败，直接返回原始文本
      const rawText = (node.innerText || node.textContent || '').trim();
      console.warn('[DOMHelpers] extractAssistantContent failed, falling back to raw text:', err.message || err);
      return { finalReply: rawText, thinkContent };
    }
  }
};
