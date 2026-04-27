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
   * 当前 DeepSeek DOM 结构（2026.04）：
   *   <div class="ds-message">
   *     <div class="_74c0879">思考内容（含 "已思考（用时 x 秒）" 标题）</div>
   *     <div class="ds-markdown">正式回答</div>
   *   </div>
   *
   * @param {Element} node - 助手消息的 DOM 节点（通常为 .ds-markdown 或类似容器）
   * @returns {{ finalReply: string, thinkContent: string }}
   */
  extractAssistantContent(node) {
    if (!node) {
      return { finalReply: '', thinkContent: '' };
    }

    // 1. 尝试从思考区域提取思考内容
    let thinkContent = '';

    // 1a. 新结构：node 可能只是 .ds-markdown，思考区域是其兄弟节点
    //     从 node 向上找到 .ds-message 容器，再在其中查找思考区域
    const messageContainer = node.closest('.ds-message');
    if (messageContainer) {
      // 在 .ds-message 容器中查找包含 "已思考" 的思考区域
      // 排除 .ds-markdown（正文）、.dbe8cf4a（免责声明）、.f93f59e4（搜索结果数）
      // 排除 .fbb737a4（用户消息）
      const excludeSelectors = '.ds-markdown, .dbe8cf4a, .f93f59e4, .fbb737a4';
      const children = messageContainer.children;
      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        if (child.matches && child.matches(excludeSelectors)) continue;
        const text = (child.innerText || child.textContent || '').trim();
        if (text && (text.indexOf('已思考') === 0 || text.indexOf('已深度思考') === 0 || text.indexOf('reasoning') === 0)) {
          thinkContent = text;
          break;
        }
      }
    }

    // 1b. 优先查找 class 匹配的思考区域（旧结构兼容）
    if (!thinkContent) {
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
    }

    // 1c. 如果没找到，检查 <details> 折叠元素
    if (!thinkContent) {
      const details = node.querySelector('details');
      if (details) {
        const text = (details.innerText || details.textContent || '').trim();
        if (text && (text.includes('已思考') || text.includes('已深度思考') || text.includes('reasoning'))) {
          thinkContent = text;
        }
      }
    }

    // 1d. 如果还没找到，检查兄弟节点（兼容旧结构）
    if (!thinkContent) {
      const prev = node.previousElementSibling;
      if (prev && (prev.className.includes('think') || prev.className.includes('reasoning'))) {
        thinkContent = (prev.innerText || prev.textContent || '').trim();
      }
    }

    // 2. 克隆节点并删除所有思考区域，提取纯正文
    try {
      const clone = node.cloneNode(true);

      // 2a. 如果 node 在 .ds-message 中，克隆整个 message 容器来删除思考区域
      if (messageContainer) {
        const fullClone = messageContainer.cloneNode(true);
        // 删除思考区域（非排除选择器的子节点中包含 "已思考" 的）
        const fullChildren = fullClone.querySelectorAll('*');
        for (let i = 0; i < fullChildren.length; i++) {
          const el = fullChildren[i];
          const text = (el.innerText || el.textContent || '').trim();
          if (text.indexOf('已思考') === 0 || text.indexOf('已深度思考') === 0 || text.indexOf('reasoning') === 0) {
            // 向上找直接子节点并移除
            let ancestor = el;
            while (ancestor && ancestor.parentElement !== fullClone) {
              ancestor = ancestor.parentElement;
            }
            if (ancestor) ancestor.remove();
            break;
          }
        }
        // 移除免责声明和搜索结果计数
        const metaToRemove = fullClone.querySelectorAll('.dbe8cf4a, .f93f59e4');
        metaToRemove.forEach(function(el) { el.remove(); });
        const finalReply = (fullClone.innerText || fullClone.textContent || '').trim();
        return { finalReply, thinkContent };
      }

      // 2b. 旧结构：移除 class 匹配的思考区域
      const toRemove = clone.querySelectorAll(
        '[class*="think"], [class*="reasoning"], [class*="thought"]'
      );
      toRemove.forEach(el => {
        const text = (el.innerText || el.textContent || '').trim();
        if (text && (text.includes('已思考') || text.includes('已深度思考') || text.includes('reasoning') || text.includes('Thinking'))) {
          el.remove();
        }
      });

      // 2c. 移除 <details> 折叠元素（如果其内容匹配思考特征）
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
      const rawText = (node.innerText || node.textContent || '').trim();
      console.warn('[DOMHelpers] extractAssistantContent failed, falling back to raw text:', err.message || err);
      return { finalReply: rawText, thinkContent };
    }
  }
};
