window.PromptController = {
  getInput() {
    return document.querySelector('#chat-input') || document.querySelector('textarea[placeholder*="message"]') || document.querySelector('textarea');
  },

  getSendButton(input) {
    let sendBtn = null;
    const container = input?.parentElement?.parentElement;
    const btns = container ? container.querySelectorAll('div[role="button"], button') : document.querySelectorAll('div[role="button"], button');
    for (const btn of Array.from(btns)) {
      if (btn.querySelector('svg') && !btn.querySelector('svg')?.classList?.contains('attach-icon')) {
        sendBtn = btn;
      }
    }
    if (!sendBtn) {
      sendBtn = document.querySelector('div.ds-icon-button') || document.querySelector('button[aria-label="Send"]') || document.querySelector('.send-button');
    }
    return sendBtn;
  },

  async waitForReply(timeoutMs = 180000) {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        let lastText = '';
        let identicalCount = 0;
        let hasStartedReplying = false;
        const stableThreshold = 20;

        const pollInterval = setInterval(() => {
          const messageBlocks = document.querySelectorAll('.ds-markdown, .markdown-body, div[class*="markdown"]');
          if (messageBlocks.length === 0) return;

          hasStartedReplying = true;
          const lastBlock = messageBlocks[messageBlocks.length - 1];
          const currentText = lastBlock.innerText || lastBlock.textContent;

          const stopBtn = document.querySelector('div[class*="stop"]') || document.querySelector('button[class*="stop"]') || document.querySelector('[data-testid="stop-button"]');
          const isGenerating = !!stopBtn;

          if (isGenerating) {
            identicalCount = 0;
            lastText = currentText;
            return;
          }

          if (currentText && currentText === lastText) {
            identicalCount++;
            if (identicalCount >= stableThreshold) {
              clearInterval(pollInterval);
              resolve(currentText);
            }
          } else {
            lastText = currentText;
            identicalCount = 0;
          }
        }, 500);

        setTimeout(() => {
          clearInterval(pollInterval);
          if (hasStartedReplying) resolve(lastText);
          else reject(new Error('TimeoutWaitingForReply'));
        }, timeoutMs);
      }, 3000);
    });
  },

  buildSystemInstruction() {
    return [
      '[SYSTEM CONTEXT - 你正在通过自动化代理桥与用户交互]',
      '',
      '你可以通过在回复中嵌入 JSON 动作指令来执行本地操作（后续阶段会启用解析与执行）。',
      '',
      '如果你要触发动作，请使用 ```action 代码块包裹 JSON。'
    ].join('\n');
  },

  async submitPrompt(params = {}) {
    const {
      prompt,
      prependSystemInstruction = false,
      systemInstruction,
      mode,
      attachments = [],
      typingSpeed = 'human',
      waitForReply = true,
      replyTimeout = 180000
    } = params;

    if (!prompt) return { success: false, error: 'MissingPrompt' };

    const input = this.getInput();
    if (!input) return { success: false, error: 'InputAreaNotFound' };

    if (mode && window.ModeController?.setModelMode) {
      await window.ModeController.setModelMode(mode);
      await window.AntiDetection.delay(window.AntiDetection.randomInt(150, 350));
    }

    for (const att of attachments) {
      const res = await window.UploadController.uploadAttachment(att);
      if (!res?.success) return { success: false, error: res?.error || 'UploadFailed' };
      await window.AntiDetection.delay(window.AntiDetection.randomInt(200, 400));
    }

    const prefix = prependSystemInstruction ? (systemInstruction || this.buildSystemInstruction()) + '\n\n' : '';
    const finalPrompt = prefix + prompt;

    await window.AntiDetection.simulateTyping(input, finalPrompt, typingSpeed);
    await window.AntiDetection.delay(window.AntiDetection.randomInt(300, 700));

    const sendBtn = this.getSendButton(input);
    if (!sendBtn) return { success: false, error: 'SendButtonNotFound' };
    sendBtn.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    await window.AntiDetection.delay(window.AntiDetection.randomInt(100, 300));
    sendBtn.click();

    if (!waitForReply) return { success: true, data: { sent: true } };
    const reply = await this.waitForReply(replyTimeout);
    return { success: true, data: { reply } };
  }
};

