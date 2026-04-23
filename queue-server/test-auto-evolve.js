const WebSocket = require('ws');

const ws = new WebSocket('ws://localhost:8082');

ws.on('open', () => {
  console.log('Connected to queue-server');
  
  // 发送自动进化触发消息
  const mockError = {
    type: 'auto_evolve',
    errorType: 'dom_selector_not_found',
    errorMessage: 'Could not find #prompt-textarea',
    details: {
      selector: '#prompt-textarea',
      url: 'https://chatgpt.com/'
    }
  };
  
  console.log('Sending auto_evolve message:', JSON.stringify(mockError, null, 2));
  ws.send(JSON.stringify(mockError));
  
  // 等待一会儿看看队列里有没有任务
  setTimeout(() => {
    fetch('http://localhost:8082/tasks')
      .then(res => res.json())
      .then(data => {
        console.log('\nCurrent Tasks in Queue:');
        console.log(JSON.stringify(data, null, 2));
        ws.close();
      })
      .catch(err => {
        console.error('Failed to fetch tasks:', err.message);
        ws.close();
      });
  }, 1000);
});

ws.on('error', (err) => {
  console.error('WebSocket Error:', err.message);
});
