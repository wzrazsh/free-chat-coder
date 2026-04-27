import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  Clock,
  Link2,
  Loader2,
  MessageSquare,
  Plus,
  RefreshCcw,
  Send,
  Server,
  Terminal,
  XCircle,
} from 'lucide-react';
import Editor from '@monaco-editor/react';
import {
  clearDiscoveredQueueServer,
  discoverQueueServer,
  requestQueueServer,
} from './queueServer';
import heroAsset from './assets/hero.png';

interface Task {
  id: string;
  status: 'pending' | 'assigned' | 'running' | 'waiting_approval' | 'processing' | 'completed' | 'failed';
  prompt: string;
  result?: string;
  error?: string;
  createdAt: string;
  updatedAt?: string;
  options?: {
    conversationId?: string;
    provider?: string;
  };
  executionChannel?: string;
}

interface PendingConfirm {
  confirmId: string;
  action: string;
  riskLevel: string;
  taskId?: string;
  createdAt?: string;
  expiresAt?: string;
  timestamp?: string;
  params?: Record<string, unknown>;
}

interface Conversation {
  id: string;
  deepseekSessionId?: string | null;
  origin: string;
  modeProfile: string;
  title?: string | null;
  status: string;
  lastMessageHash?: string | null;
  lastMessagePreview?: string | null;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

interface ConversationMessage {
  id: string;
  conversationId: string;
  seq: number;
  role: string;
  content: string;
  source: string;
  createdAt: string;
}

interface ApiTestResult {
  status: number;
  statusText: string;
  durationMs: number;
  body: string;
  headers: Record<string, string>;
}

const API_TEST_PRESETS = [
  {
    label: 'Health',
    method: 'GET',
    path: '/health',
    body: '',
  },
  {
    label: 'Tasks',
    method: 'GET',
    path: '/tasks',
    body: '',
  },
  {
    label: 'Conversations',
    method: 'GET',
    path: '/conversations?origin=extension&limit=20',
    body: '',
  },
  {
    label: 'Create Task',
    method: 'POST',
    path: '/tasks',
    body: JSON.stringify({ prompt: 'API tester task from web console' }, null, 2),
  },
] as const;

const methodOptions = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

const formatApiPayload = (value: unknown) => {
  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const formatDateTime = (value?: string) => {
  if (!value) {
    return 'Unknown';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Unknown';
  }

  return date.toLocaleString();
};

const formatTime = (value?: string) => {
  if (!value) {
    return '--:--';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '--:--';
  }

  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const upsertTask = (taskList: Task[], nextTask: Task) => {
  const existingIndex = taskList.findIndex((task) => task.id === nextTask.id);
  if (existingIndex === -1) {
    return [...taskList, nextTask];
  }

  const nextTasks = [...taskList];
  nextTasks[existingIndex] = nextTask;
  return nextTasks;
};

const upsertConfirm = (confirmList: PendingConfirm[], nextConfirm: PendingConfirm) => {
  const existingIndex = confirmList.findIndex((confirm) => confirm.confirmId === nextConfirm.confirmId);
  if (existingIndex === -1) {
    return [nextConfirm, ...confirmList];
  }

  const nextConfirms = [...confirmList];
  nextConfirms[existingIndex] = nextConfirm;
  return nextConfirms;
};

const upsertConversation = (conversationList: Conversation[], nextConversation: Conversation) => {
  const existingIndex = conversationList.findIndex((conversation) => conversation.id === nextConversation.id);
  if (existingIndex === -1) {
    return [...conversationList, nextConversation];
  }

  const nextConversations = [...conversationList];
  nextConversations[existingIndex] = nextConversation;
  return nextConversations;
};

const taskStatusStyles: Record<Task['status'], string> = {
  pending: 'border-slate-200 bg-slate-50 text-slate-700',
  assigned: 'border-sky-300 bg-sky-50 text-sky-700',
  running: 'border-sky-200 bg-sky-50 text-sky-700',
  waiting_approval: 'border-amber-200 bg-amber-50 text-amber-700',
  processing: 'border-sky-200 bg-sky-50 text-sky-700',
  completed: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  failed: 'border-rose-200 bg-rose-50 text-rose-700',
};

const messageStyles: Record<string, string> = {
  user: 'border-sky-200 bg-sky-50',
  assistant: 'border-slate-200 bg-white',
};

function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [pendingConfirms, setPendingConfirms] = useState<PendingConfirm[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string>('');
  const [conversationMessages, setConversationMessages] = useState<ConversationMessage[]>([]);
  const [prompt, setPrompt] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [respondingConfirmId, setRespondingConfirmId] = useState<string | null>(null);
  const [queuePort, setQueuePort] = useState<number | null>(null);
  const [apiTestMethod, setApiTestMethod] = useState('GET');
  const [apiTestPath, setApiTestPath] = useState('/health');
  const [apiTestHeaders, setApiTestHeaders] = useState('{\n  "Content-Type": "application/json"\n}');
  const [apiTestBody, setApiTestBody] = useState('');
  const [apiTestResult, setApiTestResult] = useState<ApiTestResult | null>(null);
  const [apiTestError, setApiTestError] = useState<string | null>(null);
  const [isApiTesting, setIsApiTesting] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const activeConversationIdRef = useRef('');
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set());

  const toggleTaskExpand = (taskId: string) => {
    setExpandedTasks((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }
      return next;
    });
  };

  const sortedConversations = useMemo(() => {
    return [...conversations].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }, [conversations]);

  const activeConversation = useMemo(() => {
    return sortedConversations.find((conversation) => conversation.id === activeConversationId) || null;
  }, [activeConversationId, sortedConversations]);

  const sortedTasks = useMemo(() => {
    return [...tasks].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [tasks]);

  const taskStats = useMemo(() => {
    return tasks.reduce(
      (acc, task) => {
        acc.total += 1;
        acc[task.status] = (acc[task.status] || 0) + 1;
        return acc;
      },
      {
        total: 0,
        pending: 0,
        assigned: 0,
        running: 0,
        waiting_approval: 0,
        processing: 0,
        completed: 0,
        failed: 0,
      } as Record<string, number>,
    );
  }, [tasks]);

  useEffect(() => {
    activeConversationIdRef.current = activeConversationId;
  }, [activeConversationId]);

  const queueRequest = async (path: string, init?: RequestInit) => {
    const { response, target } = await requestQueueServer(path, init);
    setQueuePort(target.port);
    return response;
  };

  const fetchTasks = async () => {
    const response = await queueRequest('/tasks');
    const data = await response.json();
    if (data.tasks) {
      setTasks(data.tasks);
    }
  };

  const fetchPendingConfirms = async () => {
    const response = await queueRequest('/tasks/confirms');
    const data = await response.json();
    if (data.confirms) {
      setPendingConfirms(data.confirms);
    }
  };

  const fetchConversations = async (preferredId?: string) => {
    const response = await queueRequest('/conversations?origin=extension&limit=100');
    const data = await response.json();
    const nextConversations = Array.isArray(data.conversations) ? data.conversations : [];
    setConversations(nextConversations);

    if (preferredId) {
      setActiveConversationId(preferredId);
    } else if (!activeConversationId && nextConversations.length > 0) {
      setActiveConversationId(nextConversations[0].id);
    } else if (activeConversationId && !nextConversations.some((conversation: Conversation) => conversation.id === activeConversationId)) {
      setActiveConversationId(nextConversations[0]?.id || '');
    }
  };

  const fetchConversationMessages = async (conversationId: string) => {
    if (!conversationId) {
      setConversationMessages([]);
      return;
    }

    const response = await queueRequest(`/conversations/${conversationId}/messages`);
    const data = await response.json();
    setConversationMessages(Array.isArray(data.messages) ? data.messages : []);
  };

  const refreshAll = async () => {
    await Promise.all([
      fetchTasks(),
      fetchPendingConfirms(),
      fetchConversations(activeConversationId || undefined),
    ]);
  };

  useEffect(() => {
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    fetchTasks().catch((err) => console.error('Failed to fetch tasks:', err));
    fetchPendingConfirms().catch((err) => console.error('Failed to fetch pending confirms:', err));
    fetchConversations().catch((err) => console.error('Failed to fetch conversations:', err));

    const connectWs = () => {
      discoverQueueServer()
        .then((target) => {
          setQueuePort(target.port);
          const ws = new WebSocket(target.wsUrl);

          ws.onopen = () => {
            setIsConnected(true);
            ws.send(JSON.stringify({ type: 'register', clientType: 'web' }));
          };

          ws.onmessage = (event) => {
            try {
              const data = JSON.parse(event.data);

              if (data.type === 'task_added' || data.type === 'task_update') {
                setTasks((prev) => upsertTask(prev, data.task));
              } else if (data.type === 'confirm_request') {
                setPendingConfirms((prev) => upsertConfirm(prev, data));
              } else if (data.type === 'confirm_resolved') {
                setPendingConfirms((prev) => prev.filter((confirm) => confirm.confirmId !== data.confirmId));
              } else if (data.type === 'conversation_created' || data.type === 'conversation_updated') {
                setConversations((prev) => upsertConversation(prev, data.conversation));
              } else if (data.type === 'conversation_messages_updated') {
                if (data.conversationId === activeConversationIdRef.current) {
                  fetchConversationMessages(data.conversationId).catch((err) => console.error('Failed to refresh conversation messages:', err));
                }
                fetchConversations(data.conversationId).catch((err) => console.error('Failed to refresh conversations:', err));
              }
            } catch (err) {
              console.error('Failed to parse WS message:', err);
            }
          };

          ws.onclose = () => {
            setIsConnected(false);
            clearDiscoveredQueueServer();
            if (!disposed) {
              reconnectTimer = setTimeout(connectWs, 3000);
            }
          };

          ws.onerror = () => {
            ws.close();
          };

          wsRef.current = ws;
        })
        .catch((err) => {
          console.error('Failed to discover queue server for WebSocket:', err);
          setIsConnected(false);
          clearDiscoveredQueueServer();
          if (!disposed) {
            reconnectTimer = setTimeout(connectWs, 3000);
          }
        });
    };

    connectWs();

    return () => {
      disposed = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  useEffect(() => {
    fetchConversationMessages(activeConversationId).catch((err) => console.error('Failed to fetch conversation messages:', err));
  }, [activeConversationId]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) {
      return;
    }

    const options = activeConversationId ? { conversationId: activeConversationId } : {};

    try {
      const response = await queueRequest('/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, options }),
      });

      if (!response.ok) {
        throw new Error(`Failed with status ${response.status}`);
      }

      setPrompt('');
      if (activeConversationId) {
        await fetchConversationMessages(activeConversationId);
        await fetchConversations(activeConversationId);
      }
    } catch (err) {
      console.error('Failed to add task:', err);
    }
  };

  const handleConfirmResponse = async (confirmId: string, approved: boolean) => {
    setRespondingConfirmId(confirmId);

    try {
      const response = await queueRequest(`/tasks/confirms/${confirmId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved }),
      });

      if (!response.ok) {
        throw new Error(`Failed with status ${response.status}`);
      }

      setPendingConfirms((prev) => prev.filter((confirm) => confirm.confirmId !== confirmId));
    } catch (err) {
      console.error('Failed to respond confirm:', err);
    } finally {
      setRespondingConfirmId(null);
    }
  };

  const handleApiPreset = (preset: (typeof API_TEST_PRESETS)[number]) => {
    setApiTestMethod(preset.method);
    setApiTestPath(preset.path);
    setApiTestBody(preset.body);
    setApiTestError(null);
  };

  const handleRunApiTest = async () => {
    const path = apiTestPath.trim();
    if (!path) {
      setApiTestError('Path is required.');
      return;
    }

    setApiTestError(null);
    setIsApiTesting(true);

    try {
      const rawHeaders = apiTestHeaders.trim();
      const parsedHeaders = rawHeaders ? JSON.parse(rawHeaders) : {};
      if (parsedHeaders && typeof parsedHeaders !== 'object') {
        throw new Error('Headers must be a JSON object.');
      }

      const init: RequestInit = {
        method: apiTestMethod,
        headers: parsedHeaders as HeadersInit,
      };

      if (apiTestMethod !== 'GET' && apiTestMethod !== 'HEAD') {
        init.body = apiTestBody;
      }

      const startedAt = performance.now();
      const response = await queueRequest(path.startsWith('/') ? path : `/${path}`, init);
      const durationMs = Math.round(performance.now() - startedAt);
      const bodyText = await response.text();
      let formattedBody = bodyText;

      try {
        formattedBody = JSON.stringify(JSON.parse(bodyText), null, 2);
      } catch {
        formattedBody = bodyText;
      }

      setApiTestResult({
        status: response.status,
        statusText: response.statusText,
        durationMs,
        body: formattedBody,
        headers: Object.fromEntries(response.headers.entries()),
      });
    } catch (error) {
      setApiTestResult(null);
      setApiTestError(error instanceof Error ? error.message : 'API test failed.');
    } finally {
      setIsApiTesting(false);
    }
  };

  const getStatusIcon = (status: Task['status']) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="text-emerald-600" size={18} />;
      case 'processing':
      case 'running':
      case 'assigned':
        return <Activity className="text-sky-600" size={18} />;
      case 'waiting_approval':
        return <AlertTriangle className="text-amber-600" size={18} />;
      case 'failed':
        return <XCircle className="text-rose-600" size={18} />;
      default:
        return <Clock className="text-slate-500" size={18} />;
    }
  };

  return (
    <div className="min-h-screen bg-[#f5f7f8] text-slate-950">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-[1500px] flex-col gap-4 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <img src={heroAsset} alt="" className="h-11 w-11 rounded-lg border border-slate-200 object-cover" />
            <div className="min-w-0">
              <h1 className="truncate text-xl font-semibold tracking-normal text-slate-950">AI Agent Queue Console</h1>
              <p className="truncate text-sm text-slate-500">Queue orchestration, transcript review, and direct API inspection.</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
            <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
              <Server size={16} className="text-slate-500" />
              <span className="text-slate-500">Queue</span>
              <span className="font-medium text-slate-900">{queuePort ? `:${queuePort}` : 'Detecting'}</span>
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
              <span className={`h-2.5 w-2.5 rounded-full ${isConnected ? 'bg-emerald-500' : 'bg-rose-500'}`} />
              <span className="font-medium text-slate-900">{isConnected ? 'WS online' : 'WS offline'}</span>
            </div>
            <button
              type="button"
              onClick={() => refreshAll().catch((err) => console.error('Failed to refresh console:', err))}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 transition hover:bg-slate-100"
              title="Refresh console data"
            >
              <RefreshCcw size={16} />
              Refresh
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1500px] space-y-5 px-4 py-5 sm:px-6">
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {[
            { label: 'Total tasks', value: taskStats.total, icon: Terminal, tone: 'text-slate-700' },
            { label: 'Processing', value: taskStats.processing, icon: Activity, tone: 'text-sky-700' },
            { label: 'Pending', value: taskStats.pending, icon: Clock, tone: 'text-amber-700' },
            { label: 'Failed', value: taskStats.failed, icon: XCircle, tone: 'text-rose-700' },
            { label: 'Conversations', value: sortedConversations.length, icon: MessageSquare, tone: 'text-emerald-700' },
          ].map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.label} className="rounded-lg border border-slate-200 bg-white p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-normal text-slate-500">{item.label}</p>
                    <p className="mt-1 text-2xl font-semibold text-slate-950">{item.value}</p>
                  </div>
                  <Icon size={22} className={item.tone} />
                </div>
              </div>
            );
          })}
        </section>

        <div className="grid gap-5 xl:grid-cols-[320px_minmax(0,1fr)_390px]">
          <aside className="space-y-5">
            <section className="rounded-lg border border-slate-200 bg-white">
              <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
                <div>
                  <h2 className="text-sm font-semibold text-slate-950">Conversations</h2>
                  <p className="text-xs text-slate-500">Extension-managed sessions</p>
                </div>
                <button
                  type="button"
                  onClick={() => fetchConversations(activeConversationId || undefined).catch((err) => console.error('Failed to refresh conversations:', err))}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-600 transition hover:bg-slate-100"
                  title="Refresh conversations"
                >
                  <RefreshCcw size={15} />
                </button>
              </div>

              {sortedConversations.length === 0 ? (
                <div className="px-4 py-10 text-sm text-slate-500">No extension conversations yet.</div>
              ) : (
                <div className="max-h-[640px] overflow-y-auto p-2">
                  {sortedConversations.map((conversation) => {
                    const isActive = conversation.id === activeConversationId;
                    return (
                      <button
                        key={conversation.id}
                        type="button"
                        onClick={() => setActiveConversationId(conversation.id)}
                        className={`mb-2 w-full rounded-lg border p-3 text-left transition ${
                          isActive
                            ? 'border-sky-300 bg-sky-50'
                            : 'border-transparent bg-white hover:border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <h3 className="min-w-0 truncate text-sm font-medium text-slate-950">{conversation.title || 'Untitled conversation'}</h3>
                          <span className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium uppercase text-slate-500">
                            {conversation.modeProfile}
                          </span>
                        </div>
                        <p className="mt-1 truncate font-mono text-xs text-slate-500">{conversation.deepseekSessionId || conversation.id}</p>
                        <p className="mt-2 line-clamp-2 min-h-9 text-sm text-slate-600">{conversation.lastMessagePreview || 'Waiting for first message...'}</p>
                        <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
                          <span>{conversation.messageCount} messages</span>
                          <span>{formatTime(conversation.updatedAt)}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>

            <section className="rounded-lg border border-slate-200 bg-white">
              <div className="border-b border-slate-200 px-4 py-3">
                <h2 className="text-sm font-semibold text-slate-950">Pending Approvals</h2>
                <p className="text-xs text-slate-500">{pendingConfirms.length} open confirmation requests</p>
              </div>

              {pendingConfirms.length === 0 ? (
                <div className="flex items-center gap-2 px-4 py-5 text-sm text-slate-500">
                  <CheckCircle size={17} className="text-emerald-600" />
                  No approvals waiting.
                </div>
              ) : (
                <div className="space-y-3 p-3">
                  {pendingConfirms.map((confirm) => {
                    const isResponding = respondingConfirmId === confirm.confirmId;

                    return (
                      <div key={confirm.confirmId} className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <h3 className="break-words text-sm font-medium text-slate-950">{confirm.action}</h3>
                            <p className="mt-1 truncate font-mono text-xs text-slate-600">{confirm.confirmId}</p>
                          </div>
                          <span className="rounded-md bg-rose-100 px-2 py-1 text-xs font-semibold uppercase text-rose-700">
                            {confirm.riskLevel || 'unknown'}
                          </span>
                        </div>

                        {confirm.params && (
                          <pre className="mt-3 max-h-32 overflow-auto rounded-lg border border-amber-200 bg-white p-2 text-xs text-slate-700">
                            {JSON.stringify(confirm.params, null, 2)}
                          </pre>
                        )}

                        <div className="mt-3 flex items-center justify-between gap-2">
                          <span className="text-xs text-slate-500">{formatTime(confirm.createdAt || confirm.timestamp)}</span>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => handleConfirmResponse(confirm.confirmId, false)}
                              disabled={isResponding}
                              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:opacity-50"
                            >
                              Reject
                            </button>
                            <button
                              type="button"
                              onClick={() => handleConfirmResponse(confirm.confirmId, true)}
                              disabled={isResponding}
                              className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-amber-700 disabled:opacity-50"
                            >
                              {isResponding && <Loader2 size={14} className="animate-spin" />}
                              Approve
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </aside>

          <section className="space-y-5">
            <section className="rounded-lg border border-slate-200 bg-white">
              <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold text-slate-950">Transcript</h2>
                  <p className="truncate text-xs text-slate-500">
                    {activeConversation ? activeConversation.title || activeConversation.id : 'Select a conversation to inspect stored messages'}
                  </p>
                </div>
                {activeConversation && (
                  <span className="inline-flex w-fit items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-1.5 text-sm font-medium text-sky-700">
                    <Link2 size={15} />
                    Bound
                  </span>
                )}
              </div>

              {!activeConversation ? (
                <div className="px-4 py-16 text-center text-sm text-slate-500">Pick a conversation from the left panel.</div>
              ) : conversationMessages.length === 0 ? (
                <div className="px-4 py-16 text-center text-sm text-slate-500">Conversation has no synced messages yet.</div>
              ) : (
                <div className="max-h-[520px] space-y-3 overflow-y-auto p-4">
                  {conversationMessages.map((message) => (
                    <article
                      key={message.id}
                      className={`rounded-lg border p-4 ${messageStyles[message.role] || 'border-amber-200 bg-amber-50'}`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs font-semibold uppercase text-slate-600">{message.role}</span>
                        <span className="text-xs text-slate-500">#{message.seq} / {formatDateTime(message.createdAt)}</span>
                      </div>
                      <pre className="mt-3 whitespace-pre-wrap break-words font-sans text-sm leading-6 text-slate-800">{message.content}</pre>
                      <div className="mt-3 text-xs text-slate-500">source: {message.source}</div>
                    </article>
                  ))}
                </div>
              )}
            </section>

            <section className="rounded-lg border border-slate-200 bg-white">
              <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-slate-950">New Task</h2>
                  <p className="text-xs text-slate-500">
                    {activeConversation ? 'The prompt will append to the active conversation.' : 'Submit a standalone task or bind a conversation first.'}
                  </p>
                </div>
                {activeConversation && (
                  <span className="inline-flex max-w-full items-center gap-2 truncate rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-700">
                    <MessageSquare size={15} />
                    <span className="truncate">{activeConversation.title || activeConversation.id}</span>
                  </span>
                )}
              </div>

              <form onSubmit={handleSubmit} className="space-y-4 p-4">
                <div className="h-36 overflow-hidden rounded-lg border border-slate-300 bg-white focus-within:ring-2 focus-within:ring-sky-500">
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
                    className="inline-flex items-center gap-2 rounded-lg bg-slate-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Plus size={17} />
                    Add Task
                  </button>
                </div>
              </form>
            </section>
          </section>

          <aside className="space-y-5">
            <section className="rounded-lg border border-slate-200 bg-white">
              <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
                <div>
                  <h2 className="text-sm font-semibold text-slate-950">API Tester</h2>
                  <p className="text-xs text-slate-500">Direct queue-server request runner</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-500">
                  {queuePort ? `127.0.0.1:${queuePort}` : 'auto'}
                </div>
              </div>

              <div className="space-y-4 p-4">
                <div className="grid grid-cols-2 gap-2">
                  {API_TEST_PRESETS.map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => handleApiPreset(preset)}
                      className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>

                <div className="flex gap-2">
                  <select
                    value={apiTestMethod}
                    onChange={(event) => setApiTestMethod(event.target.value)}
                    className="w-28 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-900"
                  >
                    {methodOptions.map((method) => (
                      <option key={method} value={method}>{method}</option>
                    ))}
                  </select>
                  <input
                    value={apiTestPath}
                    onChange={(event) => setApiTestPath(event.target.value)}
                    placeholder="/health"
                    className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm text-slate-900"
                  />
                </div>

                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium uppercase text-slate-500">Headers JSON</span>
                  <textarea
                    value={apiTestHeaders}
                    onChange={(event) => setApiTestHeaders(event.target.value)}
                    spellCheck={false}
                    className="h-24 w-full resize-y rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 font-mono text-sm text-slate-900"
                  />
                </label>

                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium uppercase text-slate-500">Request Body</span>
                  <textarea
                    value={apiTestBody}
                    onChange={(event) => setApiTestBody(event.target.value)}
                    spellCheck={false}
                    className="h-28 w-full resize-y rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 font-mono text-sm text-slate-900"
                  />
                </label>

                {apiTestError && (
                  <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                    <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                    <span>{apiTestError}</span>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => handleRunApiTest().catch((err) => console.error('Failed to run API test:', err))}
                  disabled={isApiTesting}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isApiTesting ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                  {isApiTesting ? 'Running' : 'Send Request'}
                </button>

                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-medium text-slate-950">Response</h3>
                      <p className="text-xs text-slate-500">Status, headers, and body</p>
                    </div>
                    {apiTestResult && (
                      <span className={`rounded-md px-2 py-1 text-xs font-semibold ${
                        apiTestResult.status >= 200 && apiTestResult.status < 300
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-rose-100 text-rose-700'
                      }`}
                      >
                        {apiTestResult.status}
                      </span>
                    )}
                  </div>

                  {!apiTestResult ? (
                    <div className="py-10 text-center text-sm text-slate-500">Run a request to inspect a response.</div>
                  ) : (
                    <div className="mt-3 space-y-3">
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                          <div className="text-xs uppercase text-slate-500">Duration</div>
                          <div className="font-medium text-slate-950">{apiTestResult.durationMs} ms</div>
                        </div>
                        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                          <div className="text-xs uppercase text-slate-500">Headers</div>
                          <div className="font-medium text-slate-950">{Object.keys(apiTestResult.headers).length}</div>
                        </div>
                      </div>
                      <pre className="max-h-36 overflow-auto rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-700 whitespace-pre-wrap break-all">
                        {formatApiPayload(apiTestResult.headers)}
                      </pre>
                      <pre className="max-h-56 overflow-auto rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-800 whitespace-pre-wrap break-all">
                        {apiTestResult.body || '(empty response body)'}
                      </pre>
                    </div>
                  )}
                </div>
              </div>
            </section>
          </aside>
        </div>

        <section className="rounded-lg border border-slate-200 bg-white">
          <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-950">Task Queue</h2>
              <p className="text-xs text-slate-500">Newest tasks first, with result and error previews.</p>
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 font-medium text-emerald-700">{taskStats.completed} completed</span>
              <span className="rounded-md border border-sky-200 bg-sky-50 px-2 py-1 font-medium text-sky-700">{taskStats.processing} processing</span>
              <span className="rounded-md border border-rose-200 bg-rose-50 px-2 py-1 font-medium text-rose-700">{taskStats.failed} failed</span>
            </div>
          </div>

          {sortedTasks.length === 0 ? (
            <div className="px-4 py-12 text-center text-sm text-slate-500">No tasks in queue. Add one above.</div>
          ) : (
            <div className="divide-y divide-slate-200">
              {sortedTasks.map((task) => (
                <article key={task.id} className="p-4 transition hover:bg-slate-50">
                  <div
                    className="flex cursor-pointer flex-col gap-3 lg:flex-row lg:items-start lg:justify-between"
                    onClick={() => toggleTaskExpand(task.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleTaskExpand(task.id); } }}
                  >
                    <div className="flex min-w-0 gap-3">
                      <div className="mt-0.5">{getStatusIcon(task.status)}</div>
                      <div className="min-w-0">
                        <h3 className="break-words text-sm font-medium leading-6 text-slate-950">{task.prompt}</h3>
                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 font-mono text-xs text-slate-500">
                          <span>ID: {task.id}</span>
                          {task.options?.conversationId && <span>Conversation: {task.options.conversationId}</span>}
                        </div>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-3 text-sm">
                      <span className={`rounded-md border px-2 py-1 text-xs font-semibold uppercase ${taskStatusStyles[task.status]}`}>
                        {task.status.replace('_', ' ')}
                      </span>
                      <span className="text-slate-500">{formatTime(task.createdAt)}</span>
                      <span className="text-slate-400">
                        {expandedTasks.has(task.id) ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                      </span>
                    </div>
                  </div>

                  {(task.result || task.error) && (
                    <pre className="mt-4 max-h-64 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-3 whitespace-pre-wrap break-words font-sans text-sm leading-6 text-slate-700">
                      {task.result || task.error}
                    </pre>
                  )}

                  {expandedTasks.has(task.id) && (
                    <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div>
                          <span className="text-xs font-medium uppercase text-slate-500">State Machine</span>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {(['pending', 'assigned', 'running', 'waiting_approval', 'completed', 'failed'] as const).map((state) => {
                              const isState = task.status === state;
                              const isPast = ['completed', 'failed'].includes(task.status)
                                ? ['pending', 'assigned', 'running'].includes(state) || (task.status === 'completed' && state !== 'failed') || (task.status === 'failed' && state === 'failed')
                                : task.status === 'waiting_approval'
                                  ? ['pending', 'assigned', 'running', 'waiting_approval'].includes(state)
                                  : task.status === 'running'
                                    ? ['pending', 'assigned', 'running'].includes(state)
                                    : task.status === 'assigned'
                                      ? ['pending', 'assigned'].includes(state)
                                      : task.status === 'pending'
                                        ? state === 'pending'
                                        : false;
                              return (
                                <span
                                  key={state}
                                  className={`rounded-md border px-2 py-0.5 text-xs font-medium ${
                                    isState
                                      ? 'border-sky-300 bg-sky-100 text-sky-800'
                                      : isPast
                                        ? 'border-slate-200 bg-white text-slate-400'
                                        : 'border-slate-100 bg-slate-50 text-slate-300'
                                  }`}
                                >
                                  {state === 'waiting_approval' ? 'Awaiting' : state.charAt(0).toUpperCase() + state.slice(1)}
                                </span>
                              );
                            })}
                          </div>
                        </div>
                        <div>
                          <span className="text-xs font-medium uppercase text-slate-500">Details</span>
                          <div className="mt-2 space-y-1.5 text-sm text-slate-600">
                            <div className="flex justify-between">
                              <span className="text-slate-400">Created</span>
                              <span>{new Date(task.createdAt).toLocaleString()}</span>
                            </div>
                            {task.updatedAt && (
                              <div className="flex justify-between">
                                <span className="text-slate-400">Updated</span>
                                <span>{new Date(task.updatedAt).toLocaleString()}</span>
                              </div>
                            )}
                            {task.options?.provider && (
                              <div className="flex justify-between">
                                <span className="text-slate-400">Provider</span>
                                <span className="font-mono text-xs">{task.options.provider}</span>
                              </div>
                            )}
                            {task.executionChannel && (
                              <div className="flex justify-between">
                                <span className="text-slate-400">Channel</span>
                                <span className="font-mono text-xs">{task.executionChannel}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

export default App;
