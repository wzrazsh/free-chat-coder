window.ChatReader = {
  _hashString(text) {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      hash = ((hash << 5) - hash) + text.charCodeAt(i);
      hash |= 0;
    }
    return `h${Math.abs(hash)}`;
  },

  readChatContent(params = {}) {
    const { includeUserMessages = true, includeAiMessages = true, startIndex = 0, count = -1 } = params;
    const messageNodes = Array.from(document.querySelectorAll('.fbb737a4, .ds-markdown, div[class*="markdown"]'));
    const messages = [];
    let index = 0;

    for (const node of messageNodes) {
      const isAI = node.classList.contains('ds-markdown') || node.matches('div[class*="markdown"]');
      if (isAI && !includeAiMessages) {
        continue;
      }
      if (!isAI && !includeUserMessages) {
        continue;
      }

      let content = node.innerText || node.textContent || '';
if (!content.trim()) {
          if (thinkContent.trim()) {
            content = thinkContent;
            messageType = 'think_only';
          } else {
            continue;
          }
        }

      const codeBlocks = [];
      let thinkContent = '';
      let messageType = '';

      if (isAI) {
        // 使用 extractAssistantContent 分离思考内容和正式回答
        const extracted = window.DOMHelpers.extractAssistantContent(node);
        content = extracted.finalReply;
        thinkContent = extracted.thinkContent;
        messageType = 'final';

        if (!content.trim()) {
          continue;
        }

        const pres = node.querySelectorAll('pre');
        pres.forEach((pre) => {
          const codeEl = pre.querySelector('code');
          if (codeEl) {
            const language = codeEl.className.replace('language-', '') || 'unknown';
            codeBlocks.push({ language, code: codeEl.innerText });
          }
        });
      }

      messages.push({
        role: isAI ? 'assistant' : 'user',
        content,
        timestamp: new Date().toISOString(),
        index: index++,
        contentHash: this._hashString(`${isAI ? 'assistant' : 'user'}\n${content}`),
        codeBlocks: codeBlocks.length > 0 ? codeBlocks : undefined,
        thinkContent: thinkContent || undefined,
        ...(messageType ? { messageType } : {})
      });
    }

    let finalMessages = messages.slice(startIndex);
    if (count > 0) {
      finalMessages = finalMessages.slice(0, count);
    }

    const lastMessage = finalMessages.length > 0 ? finalMessages[finalMessages.length - 1] : null;

    return {
      success: true,
      data: {
        sessionId: window.location.pathname.split('/').pop() || 'unknown',
        sessionTitle: document.title,
        messages: finalMessages,
        totalMessages: messages.length,
        lastMessageHash: lastMessage ? lastMessage.contentHash : null
      }
    };
  },

  readLatestReply(params = {}) {
    const { includeCodeBlocks = true, includeThinkContent = true } = params;
    const aiBlocks = document.querySelectorAll('.ds-markdown, div[class*="markdown"]');
    if (aiBlocks.length === 0) {
      return { success: false, error: 'No AI reply found' };
    }

    const lastBlock = aiBlocks[aiBlocks.length - 1];

    // 使用 extractAssistantContent 分离思考内容和正式回答
    const extracted = window.DOMHelpers.extractAssistantContent(lastBlock);
    let content = extracted.finalReply;
    let thinkContent = includeThinkContent ? extracted.thinkContent : '';

    const codeBlocks = [];
    if (includeCodeBlocks) {
      const pres = lastBlock.querySelectorAll('pre');
      pres.forEach((pre) => {
        const codeEl = pre.querySelector('code');
        if (codeEl) {
          const language = codeEl.className.replace('language-', '') || 'unknown';
          codeBlocks.push({ language, code: codeEl.innerText });
        }
      });
    }

    const stopBtn = document.querySelector('div[class*="stop"], button[class*="stop"], [data-testid="stop-button"]');
    const isComplete = !stopBtn;

    return {
      success: true,
      data: {
        content,
        contentHash: this._hashString(`assistant\n${content}`),
        codeBlocks: codeBlocks.length > 0 ? codeBlocks : undefined,
        thinkContent: thinkContent || undefined,
        isComplete,
        searchResults: []
      }
    };
  }
};
