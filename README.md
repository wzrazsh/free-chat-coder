# Free Chat Coder

Free Chat Coder is an automated assistant system that bridges your local environment with AI chat interfaces (like DeepSeek) via a browser extension. It manages prompt tasks through a centralized queue server and a web console, automatically simulating human typing to interact with the AI and capturing its responses.

## Project Structure

The repository is divided into three main components:

- **`queue-server/`**: A Node.js backend that manages the task queue and communicates with the Chrome extension via WebSockets.
- **`web-console/`**: A React + Vite frontend application for adding, monitoring, and managing tasks in the queue.
- **`chromevideo/`**: A Chrome extension that receives tasks from the server, injects them into the AI chat interface (e.g., DeepSeek), simulates human typing, and sends the AI's reply back to the server.

## Features & Recent Updates

- **Human-like Typing Simulation**: The Chrome extension simulates realistic typing with random chunking and delays, including a simulated mouse hover before clicking the "Send" button.
- **Extension Hot Reloading**: The queue server watches for file changes in the `chromevideo/` directory and automatically broadcasts a reload command to the connected extension during development.
- **Task Persistence**: The queue server saves tasks locally to `queue-server/data/tasks.json`, ensuring no data is lost upon server restarts.
- **Real-time Task Dispatching**: Seamless WebSocket connection between the queue server and the Chrome extension.

## Getting Started

### 1. Start the Queue Server
The queue server runs on port 8080 by default.
```bash
cd queue-server
npm install
npm run dev
```

### 2. Start the Web Console
The web console provides a UI to interact with the queue.
```bash
cd web-console
npm install
npm run dev
```

### 3. Load the Chrome Extension
1. Open Chrome and navigate to `chrome://extensions/`.
2. Enable **Developer mode** in the top right corner.
3. Click **Load unpacked** and select the `chromevideo` directory from this repository.
4. The extension will automatically connect to the queue server (`ws://localhost:8080`).

## Usage

1. Open the DeepSeek chat page in your Chrome browser (where the extension is active).
2. Open the Web Console in another tab/window.
3. Submit a new task/prompt through the Web Console.
4. Switch to the DeepSeek tab to watch the extension automatically type and send your prompt.
5. The response will be captured and returned to the Web Console once generated.
