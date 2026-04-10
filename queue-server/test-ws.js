const WebSocket = require('ws');
const http = require('http');
const ws = new WebSocket('ws://localhost:8082');
ws.on('open', () => {
  console.log('WS Connected');
  ws.send(JSON.stringify({ type: 'register', clientType: 'extension' }));
  setTimeout(() => {
    const req = http.request('http://localhost:8082/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => console.log('Task created:', data));
    });
    req.write(JSON.stringify({ prompt: 'test task' }));
    req.end();
  }, 500);
});
ws.on('message', (data) => {
  const msg = JSON.parse(data);
  console.log('WS Msg:', msg);
  if (msg.type === 'task_assigned') {
    console.log('Got task, completing it...');
    ws.send(JSON.stringify({ type: 'task_update', taskId: msg.task.id, status: 'completed', result: 'done' }));
    setTimeout(() => process.exit(0), 500);
  }
});
