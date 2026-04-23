const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

console.log('[TestLoop] Starting auto-evolve loop test...');

const ws = new WebSocket('ws://localhost:8082');

ws.on('open', () => {
  console.log('[TestLoop] Connected to WebSocket server');
  
  // 1. 发送触发自动进化的消息
  const mockError = {
    type: 'auto_evolve',
    errorType: 'test_loop_trigger_v2',
    errorMessage: 'Testing the end-to-end auto evolve loop',
    details: {
      test: true,
      time: Date.now()
    }
  };
  
  console.log('[TestLoop] Sending trigger message...');
  ws.send(JSON.stringify(mockError));
  
  // 2. 轮询获取任务
  let attempts = 0;
  const interval = setInterval(async () => {
    attempts++;
    if (attempts > 10) {
      clearInterval(interval);
      console.log('[TestLoop] Timeout waiting for task');
      ws.close();
      return;
    }
    
    try {
      const res = await fetch('http://localhost:8082/tasks');
      const data = await res.json();
      
      // 注意：autoEvolve 标志在 options 里
      const evolveTask = data.tasks.find(t => t.options && t.options.autoEvolve === true && t.status === 'pending');
      
      if (evolveTask) {
        clearInterval(interval);
        console.log('[TestLoop] Found auto_evolve task in queue:', evolveTask.id);
        console.log('[TestLoop] Task Prompt Preview:', evolveTask.prompt.substring(0, 100).replace(/\n/g, ' ') + '...');
        
        // 3. 模拟 AI 节点修复代码
        console.log('[TestLoop] Simulating AI code generation...');
        const handlerPath = path.join(__dirname, 'custom-handler.js');
        let code = fs.readFileSync(handlerPath, 'utf8');
        
        // 追加一行注释作为修改
        const timestamp = new Date().toISOString();
        code += `\n// [AutoEvolve Test] Loop executed at ${timestamp}`;
        
        console.log('[TestLoop] Submitting evolved code to /evolve endpoint...');
        
        // 4. 提交修复代码
        const evolveRes = await fetch('http://localhost:8082/evolve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code })
        });
        
        const evolveData = await evolveRes.json();
        console.log('[TestLoop] Server response:', evolveData.message);
        
        console.log('[TestLoop] Test completed successfully. The queue-server should restart now.');
        ws.close();
      } else {
        console.log(`[TestLoop] Attempt ${attempts}: No pending auto_evolve task found yet.`);
      }
    } catch (err) {
      console.error('[TestLoop] Error fetching tasks:', err.message);
    }
  }, 1000);
});

ws.on('error', (err) => {
  console.error('[TestLoop] WebSocket error:', err.message);
});
