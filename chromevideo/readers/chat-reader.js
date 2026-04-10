window.ChatReader = {
  /**
   * 读取当前会话内容
   */
  readChatContent(params = {}) {
    const { includeUserMessages = true, includeAiMessages = true, startIndex = 0, count = -1 } = params;
    
    // DeepSeek 的消息通常在不同的 div 里
    // AI 回复通常带有 ds-markdown 或 ds-markdown--block 类
    // 我们尝试获取所有的消息节点，并推断角色
    const messageNodes = Array.from(document.querySelectorAll('.fbb737a4, .ds-markdown'));
    
    const messages = [];
    let index = 0;
    
    for (let i = 0; i < messageNodes.length; i++) {
      const node = messageNodes[i];
      const isAI = node.classList.contains('ds-markdown');
      
      if (isAI && !includeAiMessages) continue;
      if (!isAI && !includeUserMessages) continue;
      
      const content = node.innerText || node.textContent;
      
      // 提取代码块
      const codeBlocks = [];
      if (isAI) {
        const pres = node.querySelectorAll('pre');
        pres.forEach(pre => {
          const codeEl = pre.querySelector('code');
          if (codeEl) {
            const language = codeEl.className.replace('language-', '') || 'unknown';
            codeBlocks.push({
              language,
              code: codeEl.innerText
            });
          }
        });
      }
      
      // 提取思考内容 (DeepSeek 的深度思考通常在前面的某个折叠区块里)
      let thinkContent = "";
      if (isAI) {
        // 这部分逻辑依赖于 DeepSeek 具体的 DOM 结构
        // 目前简单查找前一个兄弟节点是否是思考区块
        const prev = node.previousElementSibling;
        if (prev && (prev.className.includes('think') || prev.className.includes('reasoning'))) {
          thinkContent = prev.innerText || prev.textContent;
        }
      }

      messages.push({
        role: isAI ? 'assistant' : 'user',
        content: content,
        timestamp: new Date().toISOString(), // 无法直接获取准确时间，使用当前时间或略过
        index: index++,
        codeBlocks: codeBlocks.length > 0 ? codeBlocks : undefined,
        thinkContent: thinkContent || undefined
      });
    }

    let finalMessages = messages.slice(startIndex);
    if (count > 0) {
      finalMessages = finalMessages.slice(0, count);
    }

    return {
      success: true,
      data: {
        sessionId: window.location.pathname.split('/').pop() || 'unknown',
        sessionTitle: document.title,
        messages: finalMessages,
        totalMessages: messages.length
      }
    };
  },

  /**
   * 读取最新一条回复
   */
  readLatestReply(params = {}) {
    const { includeCodeBlocks = true, includeThinkContent = true } = params;
    
    const aiBlocks = document.querySelectorAll('.ds-markdown, div[class*="markdown"]');
    if (aiBlocks.length === 0) {
      return { success: false, error: 'No AI reply found' };
    }
    
    const lastBlock = aiBlocks[aiBlocks.length - 1];
    const content = lastBlock.innerText || lastBlock.textContent;
    
    const codeBlocks = [];
    if (includeCodeBlocks) {
      const pres = lastBlock.querySelectorAll('pre');
      pres.forEach(pre => {
        const codeEl = pre.querySelector('code');
        if (codeEl) {
          const language = codeEl.className.replace('language-', '') || 'unknown';
          codeBlocks.push({
            language,
            code: codeEl.innerText
          });
        }
      });
    }
    
    let thinkContent = "";
    if (includeThinkContent) {
      const prev = lastBlock.previousElementSibling;
      if (prev && (prev.className.includes('think') || prev.className.includes('reasoning') || prev.querySelector('[class*="think"]'))) {
        thinkContent = prev.innerText || prev.textContent;
      }
    }
    
    // 检查是否生成完成
    const stopBtn = document.querySelector('div[class*="stop"]') || document.querySelector('button[class*="stop"]') || document.querySelector('[data-testid="stop-button"]');
    const isComplete = !stopBtn;

    return {
      success: true,
      data: {
        content,
        codeBlocks: codeBlocks.length > 0 ? codeBlocks : undefined,
        thinkContent: thinkContent || undefined,
        isComplete,
        searchResults: [] // 预留
      }
    };
  }
};
