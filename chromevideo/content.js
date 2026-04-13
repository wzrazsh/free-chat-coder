// /workspace/chromevideo/content.js

console.log('[Content Script] Injected on DeepSeek page.');

// 内容脚本错误监控
function reportContentScriptError(errorType, details) {
  try {
    chrome.runtime.sendMessage({
      type: 'content_script_error',
      errorType: errorType,
      details: details,
      timestamp: new Date().toISOString(),
      url: window.location.href
    }, (response) => {
      if (chrome.runtime.lastError) {
        console.warn('[Content Script] Failed to report error:', chrome.runtime.lastError);
      } else {
        console.log('[Content Script] Error reported:', errorType);
      }
    });
  } catch (error) {
    console.error('[Content Script] Error reporting failed:', error);
  }
}

// DOM选择器监控包装器
function monitorSelectorQuery(selector, context) {
  const element = document.querySelector(selector);
  if (!element && selector && context) {
    // 报告DOM选择器失败
    reportContentScriptError('dom_selector_not_found', {
      selector: selector,
      context: context,
      url: window.location.href,
      timestamp: new Date().toISOString()
    });
  }
  return element;
}

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
    
    // Find the textarea
    // DeepSeek uses an editable div/textarea with specific IDs or generic selectors
    const input = monitorSelectorQuery('textarea', 'Find textarea for prompt input') ||
                  monitorSelectorQuery('#chat-input', 'Find chat input by ID');

    if (input) {
      // Execute simulated typing asynchronously
      (async () => {
        try {
          await simulateTyping(input, prompt);
          
          // Give UI a moment to respond and enable the send button
          await delay(randomInt(300, 700));
          
          // Find send button (DeepSeek usually has an SVG or specific class for send)
          // A common selector for DeepSeek is the div containing the icon, or button nearby
          // Using common structural patterns:
          const sendBtnContainer = input.parentElement?.parentElement;
          const potentialBtns = sendBtnContainer ? sendBtnContainer.querySelectorAll('div[role="button"], button') : document.querySelectorAll('div[role="button"], button');
          
          // Find the button that is likely the send button (often near the end of the input container)
          // Or look for an SVG that looks like a send icon
          let sendBtn = null;
          for (let btn of Array.from(potentialBtns)) {
            if (btn.querySelector('svg') && !btn.querySelector('svg').classList.contains('attach-icon')) {
              sendBtn = btn;
            }
          }
          // Fallback to the specific selector mentioned in design doc or simple nextElementSibling
          if (!sendBtn) {
             sendBtn = document.querySelector('div.ds-icon-button') || document.querySelector('button[aria-label="Send"]') || document.querySelector('.send-button') || input.nextElementSibling;
          }
          
          if (sendBtn) {
            // Hover simulation before clicking
            sendBtn.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
            await delay(randomInt(100, 300));
            
            sendBtn.click();
            console.log('[Content Script] Clicked send button.');
            
            // Start polling for reply
            waitForReply()
              .then(reply => sendResponse({ success: true, reply }))
              .catch(err => sendResponse({ success: false, error: err.message }));
              
          } else {
            // 上报发送按钮未找到错误
            reportContentScriptError('element_interaction_failed', {
              selector: 'send button (various selectors attempted)',
              context: 'Find and click send button after typing',
              interaction: 'click',
              attemptedSelectors: [
                'div[role="button"] with SVG',
                'button[aria-label="Send"]',
                'div.ds-icon-button',
                '.send-button',
                'input.nextElementSibling'
              ],
              url: window.location.href,
              timestamp: new Date().toISOString()
            });
            sendResponse({ success: false, error: 'Send button not found' });
          }
        } catch (error) {
          sendResponse({ success: false, error: error.message });
        }
      })();
      
      // Keep channel open for async response
      return true;
    } else {
      // 上报textarea未找到错误
      reportContentScriptError('dom_selector_not_found', {
        selector: 'textarea or #chat-input',
        context: 'Find input for prompt submission',
        url: window.location.href,
        timestamp: new Date().toISOString(),
        attemptedSelectors: ['textarea', '#chat-input']
      });
      sendResponse({ success: false, error: 'Textarea not found on page' });
    }
  }
});

function waitForReply() {
  return new Promise((resolve, reject) => {
    console.log('[Content Script] Waiting for reply...');
    
    const INITIAL_WAIT = 3000;
    const POLL_INTERVAL = 500;
    const STABLE_THRESHOLD = 6;
    const TIMEOUT_MS = 180000;
    
    setTimeout(() => {
      let lastText = '';
      let identicalCount = 0;
      let pollTimer;
      let timeoutTimer;
      
      function cleanup() {
        clearInterval(pollTimer);
        clearTimeout(timeoutTimer);
      }
      
      pollTimer = setInterval(() => {
        const messageBlocks = document.querySelectorAll('.ds-markdown, .markdown-body');
        if (messageBlocks.length === 0) return;
        
        const lastBlock = messageBlocks[messageBlocks.length - 1];
        const currentText = lastBlock.innerText || lastBlock.textContent;
        
        if (!currentText) return;
        
        if (currentText === lastText) {
          identicalCount++;
          if (identicalCount >= STABLE_THRESHOLD) {
            cleanup();
            console.log('[Content Script] Reply generation finished.');
            resolve(currentText);
          }
        } else {
          lastText = currentText;
          identicalCount = 0;
        }
      }, POLL_INTERVAL);
      
      timeoutTimer = setTimeout(() => {
        cleanup();
        const messageBlocks = document.querySelectorAll('.ds-markdown, .markdown-body');
        const lastBlock = messageBlocks.length > 0 ? messageBlocks[messageBlocks.length - 1] : null;
        const partialText = lastBlock ? (lastBlock.innerText || lastBlock.textContent) : '';
        
        if (partialText && partialText.length > 50) {
          console.log('[Content Script] Timeout but partial reply found, returning it.');
          resolve(partialText);
        } else {
          try {
            reportContentScriptError('page_load_timeout', {
              timeout: TIMEOUT_MS,
              phase: 'waiting for AI reply',
              url: window.location.href,
              timestamp: new Date().toISOString(),
              selectorAttempted: '.ds-markdown, .markdown-body',
              currentBlocks: messageBlocks.length
            });
          } catch (reportError) {
            console.error('[Content Script] Failed to report timeout error:', reportError);
          }
          reject(new Error('Timeout waiting for reply'));
        }
      }, TIMEOUT_MS);
      
    }, INITIAL_WAIT);
  });
}
