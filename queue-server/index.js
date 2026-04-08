// /workspace/queue-server/index.js
const express = require('express');
const cors = require('cors');
const http = require('http');
const setupWebSocket = require('./websocket/handler');
const taskRoutes = require('./routes/tasks');
const evolutionRoutes = require('./evolution/hot-reload');
const watchExtension = require('./evolution/extension-watcher');

const app = express();
const port = process.env.PORT || 8082;

app.use(cors());
app.use(express.json());

// Basic health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Setup RESTful routes
app.use('/tasks', taskRoutes);
app.use('/evolve', evolutionRoutes);

// Create HTTP Server
const server = http.createServer(app);

// Initialize WebSocket Handler
setupWebSocket(server);

// Watch Chrome extension for hot reload
watchExtension();

server.listen(port, () => {
  console.log(`[Queue-Server] HTTP Server listening on port ${port}`);
});
