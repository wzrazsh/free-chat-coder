const fs = require('fs');
const path = require('path');

console.log('[TestLoop] Starting auto-evolve loop test (Part 2: Consume task)...');

async function run() {
  try {
    // 1. 获取任务
    console.log('[TestLoop] Fetching tasks...');
    const res = await fetch('http://localhost:8082/tasks');
    const data = await res.json();
    
    const evolveTask = data.tasks.find(t => t.autoEvolve === true && t.status === 'pending');
    
    if (evolveTask) {
      console.log('[TestLoop] Found auto_evolve task in queue:', evolveTask.id);
      
      // 2. 模拟 AI 节点修复代码
      console.log('[TestLoop] Simulating AI code generation...');
      const handlerPath = path.join(__dirname, 'custom-handler.js');
      let code = fs.readFileSync(handlerPath, 'utf8');
      
      // 追加一行注释作为修改
      const timestamp = new Date().toISOString();
      code += `\n// [AutoEvolve Test] Loop executed at ${timestamp}`;
      
      console.log('[TestLoop] Submitting evolved code to /evolve endpoint...');
      
      // 3. 提交修复代码
      const evolveRes = await fetch('http://localhost:8082/evolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code })
      });
      
      const evolveData = await evolveRes.json();
      console.log('[TestLoop] Server response:', evolveData.message);
      
      console.log('[TestLoop] Test completed successfully. The queue-server should restart now.');
    } else {
      console.log('[TestLoop] No pending auto_evolve task found. Maybe it was already processed?');
    }
  } catch (err) {
    console.error('[TestLoop] Error:', err.message);
  }
}

run();
