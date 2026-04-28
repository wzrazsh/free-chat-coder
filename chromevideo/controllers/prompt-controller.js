window.PromptController = {
  async submitPrompt(params) {
    const { prompt, prependSystemInstruction = true, mode, typingSpeed = 'human', waitForReply = true } = params;
    
    // 1. 模式预设切换 (如果指定了 mode)
    if (mode && window.ModeController) {
      window.ModeController.setModelMode(mode);
      await window.AntiDetection.delay(500);
    }

    // 2. 附件上传由 background.js 完成，PromptController 只负责提交 prompt

    // 3. 查找输入框
    const input = document.querySelector('#chat-input') || document.querySelector('textarea[placeholder*="message"]') || document.querySelector('textarea');
    if (!input) {
      throw new Error('InputAreaNotFound: Could not find the chat textarea on the page');
    }

    // 4. 模拟输入 (支持打字速度配置)
    await window.AntiDetection.simulateTyping(input, prompt, typingSpeed);
    await window.AntiDetection.delay(window.AntiDetection.randomInt(300, 700));

    // 5. 查找发送按钮
    let sendBtn = null;
    const sendBtnContainer = input.parentElement?.parentElement;
    const potentialBtns = sendBtnContainer ? sendBtnContainer.querySelectorAll('div[role="button"], button') : document.querySelectorAll('div[role="button"], button');
    
    for (let btn of Array.from(potentialBtns)) {
      if (btn.querySelector('svg') && !btn.querySelector('svg').classList.contains('attach-icon')) {
        sendBtn = btn;
      }
    }
    if (!sendBtn) {
      sendBtn = document.querySelector('div.ds-icon-button') || document.querySelector('button[aria-label="Send"]') || document.querySelector('.send-button');
    }
    
    if (!sendBtn) {
      throw new Error('SendButtonNotFound: Could not find the send button to submit the prompt');
    }

    // 6. 点击发送
    sendBtn.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    await window.AntiDetection.delay(window.AntiDetection.randomInt(100, 300));
    sendBtn.click();
    console.log('[PromptController] Clicked send button.');

    // 7. 如果不需要等待回复，直接返回
    if (!waitForReply) {
      return { success: true, status: 'sent_without_waiting' };
    }

    // 8. 等待回复
    const replyText = await this._waitForReply();
    return { success: true, reply: replyText };
  },

  _waitForReply() {
    return new Promise((resolve, reject) => {
      console.log('[PromptController] Waiting for reply...');
      
      setTimeout(() => {
        let lastText = '';
        let identicalCount = 0;
        let hasStartedReplying = false;
        const STABLE_THRESHOLD = 20; // 500ms * 20 = 10s 文本不变认为结束
        
        const pollInterval = setInterval(() => {
          const messageBlocks = document.querySelectorAll('.ds-markdown, .markdown-body, div[class*="markdown"]');
          if (messageBlocks.length === 0) return;
          
          hasStartedReplying = true;
          const lastBlock = messageBlocks[messageBlocks.length - 1];
          // 使用 extractAssistantContent 只监控正式回答，排除思考区域
          const extracted = window.DOMHelpers.extractAssistantContent(lastBlock);
          const currentText = extracted.finalReply || lastBlock.innerText || lastBlock.textContent;
          
          const stopBtn = document.querySelector('div[class*="stop"]') || document.querySelector('button[class*="stop"]') || document.querySelector('[data-testid="stop-button"]');
          const isGenerating = !!stopBtn;
          
          if (isGenerating) {
            identicalCount = 0;
            lastText = currentText;
            return;
          }
          
          if (currentText && currentText === lastText) {
            identicalCount++;
            if (identicalCount >= STABLE_THRESHOLD) {
              clearInterval(pollInterval);
              console.log('[PromptController] Reply generation finished.');
              resolve(currentText);
            }
          } else {
            lastText = currentText;
            identicalCount = 0;
          }
        }, 500);
        
        // 3 分钟超时
        setTimeout(() => {
          clearInterval(pollInterval);
          if (hasStartedReplying) {
            resolve(lastText);
          } else {
            reject(new Error('TimeoutWaitingForReply: DeepSeek did not respond within 3 minutes'));
          }
        }, 180000);
        
      }, 3000);
    });
  }
};