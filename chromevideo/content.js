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
    
    // Find the textarea
    // DeepSeek uses an editable div/textarea with specific IDs or generic selectors
    const input = document.querySelector('textarea') || document.querySelector('#chat-input');
    
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
            sendResponse({ success: false, error: 'Send button not found' });
          }
        } catch (error) {
          sendResponse({ success: false, error: error.message });
        }
      })();
      
      // Keep channel open for async response
      return true;
    } else {
      sendResponse({ success: false, error: 'Textarea not found on page' });
    }
  }
});

function waitForReply() {
  return new Promise((resolve, reject) => {
    console.log('[Content Script] Waiting for reply...');
    // Simplify for MVP: Just poll for new message bubbles or wait for a specific time
    // DeepSeek reply text is usually inside a div with class like "ds-markdown"
    
    // 1. Wait a bit for the user message to appear and bot to start typing
    setTimeout(() => {
      let lastText = '';
      let identicalCount = 0;
      
      const pollInterval = setInterval(() => {
        // Find the last markdown block
        const messageBlocks = document.querySelectorAll('.ds-markdown, .markdown-body');
        if (messageBlocks.length === 0) return;
        
        const lastBlock = messageBlocks[messageBlocks.length - 1];
        const currentText = lastBlock.innerText || lastBlock.textContent;
        
        if (currentText && currentText === lastText) {
          identicalCount++;
          // If text hasn't changed for 10 iterations (5 seconds), assume generation complete
          if (identicalCount >= 10) {
            clearInterval(pollInterval);
            console.log('[Content Script] Reply generation finished.');
            resolve(currentText);
          }
        } else {
          lastText = currentText;
          identicalCount = 0; // reset count if text is still changing
        }
      }, 500);
      
      // Timeout after 2 minutes
      setTimeout(() => {
        clearInterval(pollInterval);
        reject(new Error('Timeout waiting for reply'));
      }, 120000);
      
    }, 2000);
  });
}
