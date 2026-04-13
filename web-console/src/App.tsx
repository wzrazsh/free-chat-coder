import { useState, useEffect, useRef } from 'react';
import { Activity, CheckCircle, Clock, XCircle, Plus, Code } from 'lucide-react';
import Editor from '@monaco-editor/react';

const API_URL = 'http://localhost:8080';
const WS_URL = 'ws://localhost:8080';

interface Task {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  prompt: string;
  result?: string;
  error?: string;
  createdAt: number;
}

function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [prompt, setPrompt] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [isEvolveModalOpen, setIsEvolveModalOpen] = useState(false);
  const [customCode, setCustomCode] = useState('// Fetching current custom-handler.js...');
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    // Fetch initial tasks
    fetch(`${API_URL}/tasks`)
      .then(res => res.json())
      .then(data => {
        if (data.tasks) setTasks(data.tasks);
      })
      .catch(err => console.error('Failed to fetch tasks:', err));

    // Fetch initial custom handler code
    fetch(`${API_URL}/evolve`)
      .then(res => res.json())
      .then(data => {
        if (data.code) setCustomCode(data.code);
      })
      .catch(err => console.error('Failed to fetch custom handler code:', err));

    // Connect WebSocket
    const connectWs = () => {
      const ws = new WebSocket(WS_URL);
      
      ws.onopen = () => {
        setIsConnected(true);
        ws.send(JSON.stringify({ type: 'register', clientType: 'web' }));
      };
      
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'task_added') {
            setTasks(prev => [...prev, data.task]);
          } else if (data.type === 'task_update') {
            setTasks(prev => prev.map(t => t.id === data.task.id ? data.task : t));
          }
        } catch (err) {
          console.error('Failed to parse WS message:', err);
        }
      };

      ws.onclose = () => {
        setIsConnected(false);
        // Try to reconnect in 3s
        setTimeout(connectWs, 3000);
      };

      wsRef.current = ws;
    };

    connectWs();

    return () => {
      if (wsRef.current) wsRef.current.close();
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) return;

    try {
      await fetch(`${API_URL}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, options: {} })
      });
      setPrompt('');
    } catch (err) {
      console.error('Failed to add task:', err);
    }
  };

  const handleEvolveSubmit = async () => {
    try {
      await fetch(`${API_URL}/evolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: customCode })
      });
      setIsEvolveModalOpen(false);
      // Wait a moment for nodemon to restart the server
      setTimeout(() => {
        window.location.reload();
      }, 1500);
    } catch (err) {
      console.error('Failed to evolve code:', err);
    }
  };

  const getStatusIcon = (status: Task['status']) => {
    switch (status) {
      case 'completed': return <CheckCircle className="text-green-500" size={20} />;
      case 'processing': return <Activity className="text-blue-500 animate-pulse" size={20} />;
      case 'failed': return <XCircle className="text-red-500" size={20} />;
      default: return <Clock className="text-gray-400" size={20} />;
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 font-sans p-8">
      <div className="max-w-4xl mx-auto">
        
        <header className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <h1 className="text-3xl font-bold tracking-tight">AI Agent Queue Console</h1>
            <button
              onClick={() => setIsEvolveModalOpen(true)}
              className="flex items-center gap-2 px-3 py-1.5 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 rounded-md font-medium transition-colors text-sm border border-indigo-200"
              title="Evolve System Logic"
            >
              <Code size={16} />
              Evolve
            </button>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">WS Status:</span>
            <div className={`h-3 w-3 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
          </div>
        </header>

        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-8">
          <h2 className="text-xl font-semibold mb-4">Add New Task</h2>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="border border-gray-200 rounded-lg overflow-hidden h-32 focus-within:ring-2 focus-within:ring-blue-500 transition-shadow">
              <Editor
                height="100%"
                defaultLanguage="markdown"
                value={prompt}
                onChange={(value) => setPrompt(value || '')}
                options={{
                  minimap: { enabled: false },
                  lineNumbers: 'off',
                  scrollBeyondLastLine: false,
                  wordWrap: 'on',
                  padding: { top: 12, bottom: 12 },
                  fontSize: 14,
                }}
              />
            </div>
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={!prompt.trim()}
                className="px-6 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-colors"
              >
                <Plus size={20} />
                Add Task
              </button>
            </div>
          </form>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h2 className="text-xl font-semibold mb-4">Task Queue</h2>
          {tasks.length === 0 ? (
            <p className="text-gray-500 text-center py-8">No tasks in queue. Add one above!</p>
          ) : (
            <div className="space-y-4">
              {[...tasks].sort((a, b) => b.createdAt - a.createdAt).map((task) => (
                <div key={task.id} className="flex items-center justify-between p-4 border border-gray-100 rounded-lg hover:bg-gray-50 transition-colors">
                  <div className="flex items-center gap-4">
                    {getStatusIcon(task.status)}
                    <div>
                      <h3 className="font-medium text-gray-900">{task.prompt}</h3>
                      <p className="text-sm text-gray-500 font-mono">ID: {task.id}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-sm whitespace-nowrap">
                    <span className={`px-3 py-1 rounded-full font-medium ${
                      task.status === 'completed' ? 'bg-green-100 text-green-700' :
                      task.status === 'processing' ? 'bg-blue-100 text-blue-700' :
                      task.status === 'failed' ? 'bg-red-100 text-red-700' :
                      'bg-gray-100 text-gray-700'
                    }`}>
                      {task.status.toUpperCase()}
                    </span>
                    <span className="text-gray-400">
                      {new Date(task.createdAt).toLocaleTimeString()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>

      {/* Evolve Modal */}
      {isEvolveModalOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl flex flex-col" style={{ height: '80vh' }}>
            <div className="flex items-center justify-between p-4 border-b border-gray-100">
              <div>
                <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                  <Code className="text-indigo-600" />
                  Evolve custom-handler.js
                </h2>
                <p className="text-sm text-gray-500 mt-1">Modify the task execution logic. Server will automatically restart.</p>
              </div>
              <button 
                onClick={() => setIsEvolveModalOpen(false)}
                className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <XCircle size={24} />
              </button>
            </div>
            
            <div className="flex-1 min-h-0 border-b border-gray-100">
              <Editor
                height="100%"
                defaultLanguage="javascript"
                theme="vs-dark"
                value={customCode}
                onChange={(value) => setCustomCode(value || '')}
                options={{
                  minimap: { enabled: false },
                  fontSize: 14,
                  padding: { top: 16 },
                  wordWrap: 'on'
                }}
              />
            </div>
            
            <div className="p-4 flex justify-end gap-3 bg-gray-50 rounded-b-xl">
              <button
                onClick={() => setIsEvolveModalOpen(false)}
                className="px-4 py-2 text-gray-700 font-medium hover:bg-gray-200 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleEvolveSubmit}
                className="px-6 py-2 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 flex items-center gap-2 transition-colors shadow-sm"
              >
                Save & Restart Server
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
