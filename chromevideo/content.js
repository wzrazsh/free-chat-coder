// /workspace/chromevideo/content.js

console.log('[Content Script] Injected on DeepSeek page.');

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function simulateTyping(input, text) {
  input.focus();
  input.value = '';
  
  // Add initial random delay before typing
  await delay(randomInt(200, 600));

  let currentIndex = 0;
  while (currentIndex < text.length) {
    // Type a chunk of 3 to 15 characters
    const chunkSize = randomInt(3, 15);
    const chunk = text.substring(currentIndex, currentIndex + chunkSize);
    
    input.value += chunk;
    input.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    
    currentIndex += chunkSize;
    
    // Add random delay between chunks
    await delay(randomInt(30, 120));
  }
  
  input.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
  // Add random delay after typing finishes
  await delay(randomInt(300, 800));
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'submitPrompt') {
    const prompt = msg.prompt;
    console.log('[Content Script] Submitting prompt:', prompt);
    
    // Execute asynchronously to allow sending true back immediately
    (async () => {
      try {
        // 1. Find the textarea
        const input = document.querySelector('#chat-input') || document.querySelector('textarea[placeholder*="message"]') || document.querySelector('textarea');
        if (!input) {
          throw new Error('InputAreaNotFound: Could not find the chat textarea on the page');
        }
        
        // 2. Type the prompt
        await simulateTyping(input, prompt);
        await delay(randomInt(300, 700));
        
        // 3. Find the send button
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

        // 4. Click the send button
        sendBtn.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        await delay(randomInt(100, 300));
        sendBtn.click();
        console.log('[Content Script] Clicked send button.');
        
        // 5. Wait for reply
        const reply = await waitForReply();
        sendResponse({ success: true, reply });
      } catch (error) {
        console.error('[Content Script] Task failed:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    
    // Keep channel open for async response
    return true;
  }
});

function waitForReply() {
  return new Promise((resolve, reject) => {
    console.log('[Content Script] Waiting for reply...');
    
    setTimeout(() => {
      let lastText = '';
      let identicalCount = 0;
      let hasStartedReplying = false;
      const STABLE_THRESHOLD = 20;
      
      const pollInterval = setInterval(() => {
        const messageBlocks = document.querySelectorAll('.ds-markdown, .markdown-body, div[class*="markdown"]');
        if (messageBlocks.length === 0) {
          return;
        }
        
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
          if (identicalCount >= STABLE_THRESHOLD) {
            clearInterval(pollInterval);
            console.log('[Content Script] Reply generation finished.');
            resolve(currentText);
          }
        } else {
          lastText = currentText;
          identicalCount = 0;
        }
      }, 500);
      
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
