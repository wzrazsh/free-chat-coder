// /workspace/chromevideo/content.js

console.log('[Content Script] Injected on DeepSeek page.');

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'submitPrompt') {
    const prompt = msg.prompt;
    console.log('[Content Script] Submitting prompt:', prompt);
    
    // Find the textarea
    // DeepSeek uses an editable div/textarea with specific IDs or generic selectors
    const input = document.querySelector('textarea') || document.querySelector('#chat-input');
    
    if (input) {
      // Focus the input first
      input.focus();
      // Clear and fill value
      input.value = prompt;
      // Dispatch input event to trigger React binding
      input.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
      // Also try change event
      input.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
      
      // Give UI a moment to respond and enable the send button
      setTimeout(() => {
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
          sendBtn.click();
          console.log('[Content Script] Clicked send button.');
          
          // Start polling for reply
          waitForReply()
            .then(reply => sendResponse({ success: true, reply }))
            .catch(err => sendResponse({ success: false, error: err.message }));
            
        } else {
          sendResponse({ success: false, error: 'Send button not found' });
        }
      }, 500);
      
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
