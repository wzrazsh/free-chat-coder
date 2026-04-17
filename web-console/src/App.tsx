import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, CheckCircle, Clock, Code, Link2, Plus, XCircle } from 'lucide-react';
import Editor from '@monaco-editor/react';
import {
  clearDiscoveredQueueServer,
  discoverQueueServer,
  requestQueueServer,
} from './queueServer';

interface Task {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  prompt: string;
  result?: string;
  error?: string;
  createdAt: string;
  updatedAt?: string;
  options?: {
    conversationId?: string;
  };
}

interface PendingConfirm {
  confirmId: string;
  action: string;
  riskLevel: string;
  taskId?: string;
  createdAt?: string;
  expiresAt?: string;
  timestamp?: string;
  params?: unknown;
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

interface ValidationCheck {
  name?: string;
  targetPath?: string | null;
  command?: string | null;
  error?: string | null;
  reason?: string | null;
}

interface ValidationPhase {
  success: boolean;
  phase?: string | null;
  decision?: string | null;
  reason?: string | null;
  checkCount?: number;
  reportPath?: string | null;
  failedChecks?: ValidationCheck[];
}

interface EvolutionValidation {
  evolutionId: string;
  action: string;
  riskLevel: string;
  targetPath: string;
  targetRelativePath: string;
  startedAt: string;
  completedAt?: string;
  success: boolean;
  blocked?: boolean;
  summary?: string;
  candidate?: {
    success: boolean;
    reason?: string | null;
  } | null;
  preflight?: ValidationPhase | null;
  postChange?: ValidationPhase | null;
  rollback?: {
    attempted?: boolean;
    success?: boolean | null;
    error?: string | null;
    createdFileRemoved?: boolean;
  } | null;
}

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

function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [pendingConfirms, setPendingConfirms] = useState<PendingConfirm[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string>('');
  const [conversationMessages, setConversationMessages] = useState<ConversationMessage[]>([]);
  const [prompt, setPrompt] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [isEvolveModalOpen, setIsEvolveModalOpen] = useState(false);
  const [customCode, setCustomCode] = useState('// Fetching current custom-handler.js...');
  const [respondingConfirmId, setRespondingConfirmId] = useState<string | null>(null);
  const [queuePort, setQueuePort] = useState<number | null>(null);
  const [latestEvolutionValidation, setLatestEvolutionValidation] = useState<EvolutionValidation | null>(null);
  const [evolveSubmitError, setEvolveSubmitError] = useState<string | null>(null);
  const [isEvolving, setIsEvolving] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const activeConversationIdRef = useRef('');

  const sortedConversations = useMemo(() => {
    return [...conversations].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }, [conversations]);

  const activeConversation = useMemo(() => {
    return sortedConversations.find((conversation) => conversation.id === activeConversationId) || null;
  }, [activeConversationId, sortedConversations]);

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

  const fetchEvolutionValidationStatus = async () => {
    const response = await queueRequest('/evolve/validation-status?limit=1');
    const data = await response.json();
    setLatestEvolutionValidation(data.latest || null);
  };

  useEffect(() => {
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let validationTimer: ReturnType<typeof setInterval> | null = null;
    let disposed = false;

    fetchTasks().catch((err) => console.error('Failed to fetch tasks:', err));
    fetchPendingConfirms().catch((err) => console.error('Failed to fetch pending confirms:', err));
    fetchConversations().catch((err) => console.error('Failed to fetch conversations:', err));
    fetchEvolutionValidationStatus().catch((err) => console.error('Failed to fetch evolution validation status:', err));

    queueRequest('/evolve')
      .then((res) => res.json())
      .then((data) => {
        if (data.code) {
          setCustomCode(data.code);
        }
      })
      .catch((err) => console.error('Failed to fetch custom handler code:', err));

    validationTimer = window.setInterval(() => {
      fetchEvolutionValidationStatus().catch((err) => console.error('Failed to refresh evolution validation status:', err));
    }, 10000);

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
      if (validationTimer) {
        clearInterval(validationTimer);
      }
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) {
      return;
    }

    const options = activeConversationId ? { conversationId: activeConversationId } : {};

    try {
      const response = await queueRequest('/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, options })
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

  const handleEvolveSubmit = async () => {
    setEvolveSubmitError(null);
    setIsEvolving(true);

    try {
      const response = await queueRequest('/evolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: customCode })
      });

      const data = await response.json();
      await fetchEvolutionValidationStatus().catch((err) => console.error('Failed to refresh validation status after evolve:', err));

      if (!response.ok || data.success === false) {
        throw new Error(data.error || `Failed with status ${response.status}`);
      }

      setIsEvolveModalOpen(false);
      setTimeout(() => {
        window.location.reload();
      }, 1500);
    } catch (err) {
      console.error('Failed to evolve code:', err);
      setEvolveSubmitError(err instanceof Error ? err.message : 'Failed to evolve code');
    } finally {
      setIsEvolving(false);
    }
  };

  const handleConfirmResponse = async (confirmId: string, approved: boolean) => {
    setRespondingConfirmId(confirmId);

    try {
      const response = await queueRequest(`/tasks/confirms/${confirmId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved })
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

  const getStatusIcon = (status: Task['status']) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="text-green-500" size={20} />;
      case 'processing':
        return <Activity className="text-blue-500 animate-pulse" size={20} />;
      case 'failed':
        return <XCircle className="text-red-500" size={20} />;
      default:
        return <Clock className="text-gray-400" size={20} />;
    }
  };

  const getMessageClassName = (role: string) => {
    if (role === 'user') {
      return 'bg-blue-50 border-blue-100';
    }
    if (role === 'assistant') {
      return 'bg-white border-gray-200';
    }
    return 'bg-amber-50 border-amber-200';
  };

  const failedValidationChecks = latestEvolutionValidation?.postChange?.failedChecks || latestEvolutionValidation?.preflight?.failedChecks || [];

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 font-sans p-8">
      <div className="max-w-7xl mx-auto">
        <header className="flex items-center justify-between mb-8 gap-6">
          <div className="flex items-center gap-4">
            <h1 className="text-3xl font-bold tracking-tight">AI Agent Queue Console</h1>
            <button
              onClick={() => {
                setEvolveSubmitError(null);
                setIsEvolveModalOpen(true);
              }}
              className="flex items-center gap-2 px-3 py-1.5 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 rounded-md font-medium transition-colors text-sm border border-indigo-200"
              title="Evolve System Logic"
            >
              <Code size={16} />
              Evolve
            </button>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500">
              Queue: {queuePort ? `:${queuePort}` : 'Detecting'}
            </span>
            <span className="text-sm font-medium">WS Status:</span>
            <div className={`h-3 w-3 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
          </div>
        </header>

        {pendingConfirms.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 mb-8">
            <div className="flex items-center justify-between gap-4 mb-4">
              <div>
                <h2 className="text-xl font-semibold text-amber-950">Pending Approvals</h2>
                <p className="text-sm text-amber-800">Manual confirms are disabled by default unless `MANUAL_CONFIRM=true`.</p>
              </div>
              <span className="px-3 py-1 rounded-full text-sm font-medium bg-amber-200 text-amber-950">
                {pendingConfirms.length} open
              </span>
            </div>

            <div className="space-y-3">
              {pendingConfirms.map((confirm) => {
                const isResponding = respondingConfirmId === confirm.confirmId;

                return (
                  <div key={confirm.confirmId} className="bg-white border border-amber-100 rounded-lg p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-4 mb-3">
                      <div>
                        <h3 className="font-medium text-gray-900">{confirm.action}</h3>
                        <p className="text-sm text-gray-500 font-mono">Confirm ID: {confirm.confirmId}</p>
                        {confirm.taskId && <p className="text-sm text-gray-500 font-mono">Task ID: {confirm.taskId}</p>}
                      </div>
                      <span className="px-3 py-1 rounded-full font-medium bg-red-100 text-red-700">
                        {(confirm.riskLevel || 'unknown').toUpperCase()}
                      </span>
                    </div>

                    {confirm.params && (
                      <pre className="text-xs text-gray-700 bg-gray-50 border border-gray-200 rounded-lg p-3 overflow-auto mb-3">
                        {JSON.stringify(confirm.params, null, 2)}
                      </pre>
                    )}

                    <div className="flex items-center justify-between gap-4">
                      <span className="text-xs text-gray-500">
                        {new Date(confirm.createdAt || confirm.timestamp || Date.now()).toLocaleString()}
                      </span>
                      <div className="flex gap-3">
                        <button
                          onClick={() => handleConfirmResponse(confirm.confirmId, false)}
                          disabled={isResponding}
                          className="px-4 py-2 text-gray-700 font-medium hover:bg-gray-200 rounded-lg transition-colors disabled:opacity-50"
                        >
                          Reject
                        </button>
                        <button
                          onClick={() => handleConfirmResponse(confirm.confirmId, true)}
                          disabled={isResponding}
                          className="px-4 py-2 bg-amber-600 text-white font-medium rounded-lg hover:bg-amber-700 transition-colors disabled:opacity-50"
                        >
                          {isResponding ? 'Submitting...' : 'Approve'}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-[320px_minmax(0,1fr)] gap-8">
          <aside className="space-y-6">
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
              <div className="flex items-center justify-between gap-3 mb-4">
                <div>
                  <h2 className="text-xl font-semibold">Conversations</h2>
                  <p className="text-sm text-gray-500">Only extension-managed sessions are shown here.</p>
                </div>
                <button
                  onClick={() => fetchConversations(activeConversationId || undefined)}
                  className="px-3 py-2 text-sm font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
                >
                  Refresh
                </button>
              </div>

              {sortedConversations.length === 0 ? (
                <p className="text-sm text-gray-500">No extension conversations yet. Create one from the extension side panel.</p>
              ) : (
                <div className="space-y-3">
                  {sortedConversations.map((conversation) => {
                    const isActive = conversation.id === activeConversationId;
                    return (
                      <button
                        key={conversation.id}
                        onClick={() => setActiveConversationId(conversation.id)}
                        className={`w-full text-left rounded-xl border p-4 transition-colors ${
                          isActive
                            ? 'border-blue-300 bg-blue-50 shadow-sm'
                            : 'border-gray-200 bg-white hover:bg-gray-50'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3 mb-2">
                          <h3 className="font-medium text-gray-900 truncate">{conversation.title || 'Untitled conversation'}</h3>
                          <span className="text-[11px] px-2 py-1 rounded-full bg-gray-100 text-gray-600 uppercase">
                            {conversation.modeProfile}
                          </span>
                        </div>
                        <p className="text-xs text-gray-500 mb-2 font-mono truncate">{conversation.deepseekSessionId || conversation.id}</p>
                        <p className="text-sm text-gray-600 line-clamp-2 min-h-10">{conversation.lastMessagePreview || 'Waiting for first message...'}</p>
                        <div className="flex items-center justify-between mt-3 text-xs text-gray-500">
                          <span>{conversation.messageCount} messages</span>
                          <span>{new Date(conversation.updatedAt).toLocaleString()}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
              <div className="flex items-center justify-between gap-3 mb-4">
                <div>
                  <h2 className="text-xl font-semibold">Transcript</h2>
                  <p className="text-sm text-gray-500">{activeConversation ? activeConversation.title || activeConversation.id : 'Select a conversation'}</p>
                </div>
                {activeConversation && (
                  <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-full bg-gray-100 text-gray-600">
                    <Link2 size={12} />
                    Bound
                  </span>
                )}
              </div>

              {!activeConversation ? (
                <p className="text-sm text-gray-500">Pick a conversation to inspect its stored transcript.</p>
              ) : conversationMessages.length === 0 ? (
                <p className="text-sm text-gray-500">Conversation has no synced messages yet.</p>
              ) : (
                <div className="space-y-3 max-h-[520px] overflow-y-auto pr-1">
                  {conversationMessages.map((message) => (
                    <div key={message.id} className={`rounded-xl border p-4 ${getMessageClassName(message.role)}`}>
                      <div className="flex items-center justify-between gap-3 mb-2">
                        <span className="text-xs font-semibold uppercase tracking-wide text-gray-600">{message.role}</span>
                        <span className="text-xs text-gray-500">#{message.seq} · {new Date(message.createdAt).toLocaleString()}</span>
                      </div>
                      <pre className="whitespace-pre-wrap break-words text-sm text-gray-800 font-sans">{message.content}</pre>
                      <div className="mt-3 text-xs text-gray-500">source: {message.source}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </aside>

          <section className="space-y-8">
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
              <div className="flex items-center justify-between gap-4 mb-4">
                <div>
                  <h2 className="text-xl font-semibold">Latest Evolution Validation</h2>
                  <p className="text-sm text-gray-500">Shows the last preflight check, post-change validation, and rollback outcome.</p>
                </div>
                <button
                  onClick={() => fetchEvolutionValidationStatus().catch((err) => console.error('Failed to fetch evolution validation status:', err))}
                  className="px-3 py-2 text-sm font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
                >
                  Refresh
                </button>
              </div>

              {!latestEvolutionValidation ? (
                <p className="text-sm text-gray-500">No evolution validation has been recorded yet.</p>
              ) : (
                <div className={`rounded-xl border p-5 ${
                  latestEvolutionValidation.success
                    ? 'border-green-200 bg-green-50'
                    : latestEvolutionValidation.blocked
                      ? 'border-amber-200 bg-amber-50'
                      : 'border-red-200 bg-red-50'
                }`}>
                  <div className="flex items-start justify-between gap-4 mb-4">
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        {latestEvolutionValidation.success ? (
                          <CheckCircle className="text-green-600" size={20} />
                        ) : latestEvolutionValidation.blocked ? (
                          <Clock className="text-amber-600" size={20} />
                        ) : (
                          <XCircle className="text-red-600" size={20} />
                        )}
                        <h3 className="font-medium text-gray-900">{latestEvolutionValidation.action}</h3>
                      </div>
                      <p className="text-sm font-mono text-gray-600">{latestEvolutionValidation.targetRelativePath}</p>
                      <p className="text-sm text-gray-700 mt-2">{latestEvolutionValidation.summary || 'No summary available.'}</p>
                    </div>
                    <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                      latestEvolutionValidation.success
                        ? 'bg-green-100 text-green-800'
                        : latestEvolutionValidation.blocked
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-red-100 text-red-800'
                    }`}>
                      {latestEvolutionValidation.success ? 'PASSED' : latestEvolutionValidation.blocked ? 'BLOCKED' : 'ROLLED BACK'}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                    <div className="rounded-lg border border-white/70 bg-white/80 p-3">
                      <div className="font-medium text-gray-900 mb-1">Candidate</div>
                      <div className={latestEvolutionValidation.candidate?.success ? 'text-green-700' : 'text-red-700'}>
                        {latestEvolutionValidation.candidate?.success ? 'Syntax passed' : 'Rejected before write'}
                      </div>
                      {latestEvolutionValidation.candidate?.reason && (
                        <p className="text-xs text-gray-600 mt-1">{latestEvolutionValidation.candidate.reason}</p>
                      )}
                    </div>
                    <div className="rounded-lg border border-white/70 bg-white/80 p-3">
                      <div className="font-medium text-gray-900 mb-1">Preflight</div>
                      <div className={latestEvolutionValidation.preflight?.success ? 'text-green-700' : 'text-red-700'}>
                        {latestEvolutionValidation.preflight?.success ? 'Passed' : 'Failed'}
                      </div>
                      {latestEvolutionValidation.preflight?.reason && (
                        <p className="text-xs text-gray-600 mt-1">{latestEvolutionValidation.preflight.reason}</p>
                      )}
                    </div>
                    <div className="rounded-lg border border-white/70 bg-white/80 p-3">
                      <div className="font-medium text-gray-900 mb-1">Post-change</div>
                      <div className={latestEvolutionValidation.postChange?.success ? 'text-green-700' : 'text-red-700'}>
                        {latestEvolutionValidation.postChange?.success ? 'Passed' : 'Failed'}
                      </div>
                      {latestEvolutionValidation.postChange?.reason && (
                        <p className="text-xs text-gray-600 mt-1">{latestEvolutionValidation.postChange.reason}</p>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-4 text-xs text-gray-600 mt-4">
                    <span>Started: {new Date(latestEvolutionValidation.startedAt).toLocaleString()}</span>
                    {latestEvolutionValidation.completedAt && (
                      <span>Completed: {new Date(latestEvolutionValidation.completedAt).toLocaleString()}</span>
                    )}
                    <span>Risk: {(latestEvolutionValidation.riskLevel || 'unknown').toUpperCase()}</span>
                  </div>

                  {latestEvolutionValidation.rollback?.attempted && (
                    <div className="mt-4 rounded-lg border border-white/70 bg-white/80 p-3 text-sm">
                      <div className="font-medium text-gray-900 mb-1">Rollback</div>
                      <p className={latestEvolutionValidation.rollback.success ? 'text-green-700' : 'text-red-700'}>
                        {latestEvolutionValidation.rollback.success ? 'Rollback succeeded' : 'Rollback failed'}
                      </p>
                      {latestEvolutionValidation.rollback.error && (
                        <p className="text-xs text-gray-600 mt-1">{latestEvolutionValidation.rollback.error}</p>
                      )}
                    </div>
                  )}

                  {failedValidationChecks.length > 0 && (
                    <div className="mt-4 rounded-lg border border-white/70 bg-white/80 p-3">
                      <div className="font-medium text-gray-900 mb-2">Failed checks</div>
                      <div className="space-y-2">
                        {failedValidationChecks.slice(0, 3).map((check) => (
                          <div key={`${check.name}-${check.targetPath || check.command || 'check'}`} className="text-sm text-gray-700">
                            <div className="font-medium">{check.name || 'validation check'}</div>
                            <div className="text-xs text-gray-500 font-mono">{check.targetPath || check.command || 'No target recorded'}</div>
                            {(check.error || check.reason) && (
                              <div className="text-xs text-red-700 mt-1">{check.error || check.reason}</div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
              <div className="flex items-center justify-between gap-4 mb-4">
                <div>
                  <h2 className="text-xl font-semibold">Add New Task</h2>
                  <p className="text-sm text-gray-500">{activeConversation ? 'New tasks will append prompt and result into the active conversation.' : 'Submit a standalone task or bind it to a conversation from the left panel.'}</p>
                </div>
                {activeConversation && (
                  <span className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded-lg bg-blue-50 text-blue-700 border border-blue-200">
                    <Link2 size={16} />
                    {activeConversation.title || activeConversation.id}
                  </span>
                )}
              </div>

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
                      fontSize: 14
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
                  {[...tasks]
                    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                    .map((task) => (
                      <div key={task.id} className="border border-gray-100 rounded-lg p-4 hover:bg-gray-50 transition-colors">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex items-start gap-4 min-w-0">
                            <div className="mt-0.5">{getStatusIcon(task.status)}</div>
                            <div className="min-w-0">
                              <h3 className="font-medium text-gray-900 break-words">{task.prompt}</h3>
                              <p className="text-sm text-gray-500 font-mono">ID: {task.id}</p>
                              {task.options?.conversationId && (
                                <p className="text-sm text-blue-600 font-mono">Conversation: {task.options.conversationId}</p>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-4 text-sm whitespace-nowrap">
                            <span
                              className={`px-3 py-1 rounded-full font-medium ${
                                task.status === 'completed'
                                  ? 'bg-green-100 text-green-700'
                                  : task.status === 'processing'
                                    ? 'bg-blue-100 text-blue-700'
                                    : task.status === 'failed'
                                      ? 'bg-red-100 text-red-700'
                                      : 'bg-gray-100 text-gray-700'
                              }`}
                            >
                              {task.status.toUpperCase()}
                            </span>
                            <span className="text-gray-400">{new Date(task.createdAt).toLocaleTimeString()}</span>
                          </div>
                        </div>

                        {(task.result || task.error) && (
                          <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
                            <pre className="whitespace-pre-wrap break-words font-sans">{task.result || task.error}</pre>
                          </div>
                        )}
                      </div>
                    ))}
                </div>
              )}
            </div>
          </section>
        </div>
      </div>

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
                onClick={() => {
                  setEvolveSubmitError(null);
                  setIsEvolveModalOpen(false);
                }}
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
              {evolveSubmitError && (
                <div className="mr-auto rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {evolveSubmitError}
                </div>
              )}
              <button
                onClick={() => {
                  setEvolveSubmitError(null);
                  setIsEvolveModalOpen(false);
                }}
                className="px-4 py-2 text-gray-700 font-medium hover:bg-gray-200 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleEvolveSubmit}
                disabled={isEvolving}
                className="px-6 py-2 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 flex items-center gap-2 transition-colors shadow-sm disabled:opacity-50"
              >
                {isEvolving ? 'Validating...' : 'Save & Restart Server'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
