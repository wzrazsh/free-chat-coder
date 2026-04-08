import { useState, useEffect, useRef } from 'react';
import { Activity, CheckCircle, Clock, XCircle, Plus } from 'lucide-react';

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
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    // Fetch initial tasks
    fetch(`${API_URL}/tasks`)
      .then(res => res.json())
      .then(data => {
        if (data.tasks) setTasks(data.tasks);
      })
      .catch(err => console.error('Failed to fetch tasks:', err));

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
          <h1 className="text-3xl font-bold tracking-tight">AI Agent Queue Console</h1>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">WS Status:</span>
            <div className={`h-3 w-3 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
          </div>
        </header>

        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-8">
          <h2 className="text-xl font-semibold mb-4">Add New Task</h2>
          <form onSubmit={handleSubmit} className="flex gap-4">
            <input
              type="text"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Enter your prompt here..."
              className="flex-1 px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition-shadow"
            />
            <button
              type="submit"
              disabled={!prompt.trim()}
              className="px-6 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-colors"
            >
              <Plus size={20} />
              Add Task
            </button>
          </form>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h2 className="text-xl font-semibold mb-4">Task Queue</h2>
          {tasks.length === 0 ? (
            <p className="text-gray-500 text-center py-8">No tasks in queue. Add one above!</p>
          ) : (
            <div className="space-y-4">
              {tasks.map((task) => (
                <div key={task.id} className="flex items-center justify-between p-4 border border-gray-100 rounded-lg hover:bg-gray-50 transition-colors">
                  <div className="flex items-center gap-4">
                    {getStatusIcon(task.status)}
                    <div>
                      <h3 className="font-medium text-gray-900">{task.prompt}</h3>
                      <p className="text-sm text-gray-500 font-mono">ID: {task.id}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-sm">
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
    </div>
  );
}

export default App;
