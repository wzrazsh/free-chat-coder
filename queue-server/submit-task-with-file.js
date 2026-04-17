const fs = require('fs');
const path = require('path');
const http = require('http');
const { discoverQueueServer } = require('../shared/queue-server');

const pdfPath = path.resolve(__dirname, '../free-chat-coder_code.pdf');

if (!fs.existsSync(pdfPath)) {
  console.error('File not found:', pdfPath);
  process.exit(1);
}

// 1. 读取文件并转换为 Base64
console.log(`Reading PDF file: ${pdfPath}`);
const fileBuffer = fs.readFileSync(pdfPath);
const base64Data = fileBuffer.toString('base64');
console.log(`File size: ${(fileBuffer.length / 1024).toFixed(2)} KB`);

// 2. 构造任务负载
const payload = JSON.stringify({
  prompt: '请查看这份项目代码架构说明文件（free-chat-coder_code.pdf），这是通过系统原生 API 上传的。',
  options: {
    attachments: [
      {
        filename: 'free-chat-coder_code.pdf',
        mimeType: 'application/pdf',
        data: base64Data
      }
    ]
  }
});

async function submitTask() {
  const queueServer = await discoverQueueServer();
  if (!queueServer) {
    console.error('Queue-Server is not running on the candidate ports.');
    process.exit(1);
  }

  console.log(`Submitting task to Queue-Server on port ${queueServer.port}...`);

  const req = http.request({
    hostname: queueServer.host,
    port: queueServer.port,
    path: '/tasks',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload)
    }
  }, (res) => {
    let responseData = '';
    res.on('data', (chunk) => { responseData += chunk; });
    res.on('end', () => {
      console.log(`Status Code: ${res.statusCode}`);
      console.log('Response:', responseData);
      console.log('\nTask submitted! The Chrome extension should now automatically upload the file and send the prompt in the DeepSeek window.');
    });
  });

  req.on('error', (e) => {
    console.error(`Problem with request: ${e.message}`);
  });

  req.write(payload);
  req.end();
}

submitTask().catch((error) => {
  console.error('Failed to submit task:', error);
  process.exit(1);
});
