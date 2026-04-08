import { useState, useEffect, useRef } from 'react';
import { Activity, CheckCircle, Clock, XCircle, Plus, Code, LayoutDashboard, Terminal } from 'lucide-react';
import Editor from '@monaco-editor/react';

const API_BASE = '/api';

function getWsUrl(path: string) {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}${path}`;
}

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
  const [currentView, setCurrentView] = useState<'console' | 'ide'>('console');
  const [customCode, setCustomCode] = useState('// Fetching current custom-handler.js...');
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/tasks`)
      .then(res => res.json())
      .then(data => {
        if (data.tasks) setTasks(data.tasks);
      })
      .catch(err => console.error('Failed to fetch tasks:', err));

    fetch(`${API_BASE}/evolve`)
      .then(res => res.json())
      .then(data => {
        if (data.code) setCustomCode(data.code);
      })
      .catch(err => console.error('Failed to fetch custom handler code:', err));

    const connectWs = () => {
      const ws = new WebSocket(getWsUrl('/ws'));
      
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
      await fetch(`${API_BASE}/tasks`, {
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
      await fetch(`${API_BASE}/evolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: customCode })
      });
      setIsEvolveModalOpen(false);
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
    <div className="h-screen flex flex-col bg-gray-50 text-gray-900 font-sans overflow-hidden">
      <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between flex-shrink-0 z-10">
        <div className="flex items-center gap-6">
          <h1 className="text-xl font-bold tracking-tight text-gray-800">Free Chat Coder</h1>
          
          <nav className="flex items-center gap-2 bg-gray-100 p-1 rounded-lg">
            <button
              onClick={() => setCurrentView('console')}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-md font-medium text-sm transition-all ${
                currentView === 'console' 
                  ? 'bg-white text-blue-600 shadow-sm' 
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <LayoutDashboard size={16} />
              Console
            </button>
            <button
              onClick={() => setCurrentView('ide')}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-md font-medium text-sm transition-all ${
                currentView === 'ide' 
                  ? 'bg-white text-blue-600 shadow-sm' 
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <Terminal size={16} />
              Web IDE
            </button>
          </nav>
        </div>

        <div className="flex items-center gap-6">
          {currentView === 'console' && (
            <button
              onClick={() => setIsEvolveModalOpen(true)}
              className="flex items-center gap-2 px-3 py-1.5 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 rounded-md font-medium transition-colors text-sm border border-indigo-200"
              title="Evolve System Logic"
            >
              <Code size={16} />
              Evolve Handler
            </button>
          )}
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-600">WS:</span>
            <div className={`h-2.5 w-2.5 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
          </div>
        </div>
      </header>

      <main className="flex-1 relative overflow-hidden bg-gray-50">
        <div className={`absolute inset-0 overflow-y-auto p-8 transition-opacity duration-200 ${currentView === 'console' ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none'}`}>
          <div className="max-w-4xl mx-auto space-y-8 pb-12">
            
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
              <h2 className="text-xl font-semibold mb-4">Add New Task</h2>
              <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                <div className="border border-gray-200 rounded-lg overflow-hidden h-40 focus-within:ring-2 focus-within:ring-blue-500 transition-shadow">
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
                    className="px-6 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-colors shadow-sm"
                  >
                    <Plus size={20} />
                    Submit to AI
                  </button>
                </div>
              </form>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
              <h2 className="text-xl font-semibold mb-4">Task Queue</h2>
              {tasks.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-gray-400">
                  <Activity size={48} className="mb-4 opacity-20" />
                  <p>No tasks in queue. Add one above!</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {tasks.map((task) => (
                    <div key={task.id} className="flex items-center justify-between p-4 border border-gray-100 rounded-lg hover:border-blue-100 hover:bg-blue-50/30 transition-all">
                      <div className="flex items-center gap-4 flex-1 min-w-0 pr-4">
                        {getStatusIcon(task.status)}
                        <div className="flex-1 min-w-0">
                          <h3 className="font-medium text-gray-900 truncate">{task.prompt}</h3>
                          <p className="text-xs text-gray-500 font-mono mt-1">ID: {task.id}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4 text-sm whitespace-nowrap">
                        <span className={`px-2.5 py-1 rounded-md font-medium text-xs uppercase tracking-wider ${
                          task.status === 'completed' ? 'bg-green-100 text-green-700 border border-green-200' :
                          task.status === 'processing' ? 'bg-blue-100 text-blue-700 border border-blue-200' :
                          task.status === 'failed' ? 'bg-red-100 text-red-700 border border-red-200' :
                          'bg-gray-100 text-gray-700 border border-gray-200'
                        }`}>
                          {task.status}
                        </span>
                        <span className="text-gray-400 tabular-nums">
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

        <div className={`absolute inset-0 bg-[#1e1e1e] transition-opacity duration-200 ${currentView === 'ide' ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none'}`}>
          {currentView === 'ide' && (
            <iframe 
              src="/ide/?folder=/workspace" 
              className="w-full h-full border-none"
              title="Web IDE"
              allow="clipboard-read; clipboard-write"
            />
          )}
        </div>

      </main>

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
