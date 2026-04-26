/**
 * PatchReviewPanel Component
 * 
 * Patch proposal management panel with approve/reject workflow
 */
import { useEffect, useState, useCallback } from 'react';
import {
  FileCode,
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
  Loader2,
  RefreshCcw,
  Eye,
  Trash2,
  Shield,
} from 'lucide-react';
import { DiffViewer } from './DiffViewer';
import { requestQueueServer } from './queueServer';

interface Patch {
  id: string;
  taskId: string | null;
  conversationId: string | null;
  status: 'draft' | 'approved' | 'rejected' | 'applied' | 'failed' | 'deleted';
  summary: string;
  changes: PatchChange[];
  riskLevel: 'low' | 'medium' | 'high';
  source: string;
  createdAt: string;
  updatedAt: string;
}

interface PatchChange {
  path: string;
  oldContent: string;
  newContent: string;
  changeType: 'create' | 'modify' | 'delete';
}

interface PatchDiff {
  patchId: string;
  summary: string;
  riskLevel: string;
  status: string;
  files: DiffFile[];
  totalChanges: number;
}

interface DiffFile {
  path: string;
  changeType: 'create' | 'modify' | 'delete';
  diff: string;
  additions: number;
  deletions: number;
}

const statusStyles: Record<Patch['status'], { bg: string; text: string; icon: typeof Clock }> = {
  draft: { bg: 'bg-slate-100', text: 'text-slate-600', icon: Clock },
  approved: { bg: 'bg-emerald-100', text: 'text-emerald-700', icon: CheckCircle },
  rejected: { bg: 'bg-rose-100', text: 'text-rose-700', icon: XCircle },
  applied: { bg: 'bg-blue-100', text: 'text-blue-700', icon: CheckCircle },
  failed: { bg: 'bg-rose-100', text: 'text-rose-700', icon: AlertTriangle },
  deleted: { bg: 'bg-slate-100', text: 'text-slate-500', icon: Trash2 },
};

const riskStyles: Record<string, string> = {
  low: 'bg-emerald-100 text-emerald-700',
  medium: 'bg-amber-100 text-amber-700',
  high: 'bg-rose-100 text-rose-700',
};

interface PatchReviewPanelProps {
  onPatchCreated?: (patch: Patch) => void;
}

export function PatchReviewPanel({ onPatchCreated }: PatchReviewPanelProps) {
  const [patches, setPatches] = useState<Patch[]>([]);
  const [selectedPatch, setSelectedPatch] = useState<Patch | null>(null);
  const [patchDiff, setPatchDiff] = useState<PatchDiff | null>(null);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(false);
  const [isProcessing, setIsProcessing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchPatches = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const { response } = await requestQueueServer('/patches?limit=50');
      const data = await response.json();

      if (data.success) {
        setPatches(data.data);
      } else {
        setError(data.error || 'Failed to fetch patches');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch patches');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchPatchDiff = useCallback(async (patchId: string) => {
    try {
      const { response } = await requestQueueServer(`/patches/${patchId}/diff`);
      const data = await response.json();

      if (data.success) {
        setPatchDiff(data.data);
        // Auto-expand first file
        if (data.data.files?.length > 0) {
          setExpandedFiles(new Set([data.data.files[0].path]));
        }
      }
    } catch (err) {
      console.error('Failed to fetch patch diff:', err);
    }
  }, []);

  useEffect(() => {
    fetchPatches();
  }, [fetchPatches]);

  useEffect(() => {
    if (selectedPatch) {
      fetchPatchDiff(selectedPatch.id);
    } else {
      setPatchDiff(null);
    }
  }, [selectedPatch, fetchPatchDiff]);

  const handleApprove = async (patchId: string) => {
    setIsProcessing(patchId);

    try {
      const { response } = await requestQueueServer(`/patches/${patchId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Approved by user' }),
      });

      const data = await response.json();

      if (data.success) {
        await fetchPatches();
        setPatches(prev => prev.map(p => p.id === patchId ? data.data : p));
      } else {
        setError(data.error || 'Failed to approve patch');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to approve patch');
    } finally {
      setIsProcessing(null);
    }
  };

  const handleReject = async (patchId: string) => {
    setIsProcessing(patchId);

    try {
      const { response } = await requestQueueServer(`/patches/${patchId}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Rejected by user' }),
      });

      const data = await response.json();

      if (data.success) {
        await fetchPatches();
        setPatches(prev => prev.map(p => p.id === patchId ? data.data : p));
      } else {
        setError(data.error || 'Failed to reject patch');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reject patch');
    } finally {
      setIsProcessing(null);
    }
  };

  const handleApply = async (patchId: string) => {
    setIsProcessing(patchId);

    try {
      const { response } = await requestQueueServer(`/patches/${patchId}/apply`, {
        method: 'POST',
      });

      const data = await response.json();

      if (data.success) {
        await fetchPatches();
      } else {
        setError(data.error || 'Failed to apply patch');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to apply patch');
    } finally {
      setIsProcessing(null);
    }
  };

  const handleToggleFile = (path: string) => {
    setExpandedFiles(prev => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const draftPatches = patches.filter(p => p.status === 'draft');
  const reviewablePatches = patches.filter(p => ['draft', 'approved'].includes(p.status));

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">Patch Proposals</h2>
          <p className="text-sm text-slate-500">
            {draftPatches.length} draft, {reviewablePatches.length} pending review
          </p>
        </div>
        <button
          type="button"
          onClick={() => fetchPatches()}
          disabled={isLoading}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCcw size={14} className={isLoading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Patch List */}
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-slate-700">Patches</h3>

          {patches.length === 0 ? (
            <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
              No patches yet. Patch proposals from DeepSeek will appear here.
            </div>
          ) : (
            <div className="space-y-2">
              {patches.map(patch => {
                const StatusIcon = statusStyles[patch.status]?.icon || Clock;
                const isSelected = selectedPatch?.id === patch.id;
                const isPending = isProcessing === patch.id;

                return (
                  <div
                    key={patch.id}
                    className={`rounded-lg border p-3 transition cursor-pointer ${
                      isSelected
                        ? 'border-sky-300 bg-sky-50'
                        : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                    onClick={() => setSelectedPatch(patch)}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <FileCode size={14} className="text-slate-400 shrink-0" />
                          <span className="truncate text-sm font-medium text-slate-950">
                            {patch.summary || 'Unnamed patch'}
                          </span>
                        </div>
                        <p className="mt-1 truncate font-mono text-xs text-slate-500">
                          {patch.id}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ${statusStyles[patch.status]?.bg} ${statusStyles[patch.status]?.text}`}>
                          <StatusIcon size={12} />
                          {patch.status}
                        </span>
                        <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${riskStyles[patch.riskLevel] || 'bg-slate-100 text-slate-600'}`}>
                          {patch.riskLevel}
                        </span>
                      </div>
                    </div>

                    <div className="mt-2 flex items-center justify-between">
                      <span className="text-xs text-slate-500">
                        {patch.changes?.length || 0} files • {patch.source}
                      </span>
                      <span className="text-xs text-slate-500">
                        {new Date(patch.createdAt).toLocaleString()}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Patch Detail & Diff */}
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-slate-700">Review</h3>

          {!selectedPatch ? (
            <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
              Select a patch to review its changes
            </div>
          ) : !patchDiff ? (
            <div className="flex items-center justify-center rounded-lg border border-slate-200 bg-white p-8">
              <Loader2 size={20} className="animate-spin text-slate-400" />
            </div>
          ) : (
            <div className="space-y-3">
              {/* Patch Info */}
              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h4 className="font-medium text-slate-950">{selectedPatch.summary || 'Unnamed patch'}</h4>
                    <p className="mt-1 text-xs text-slate-500">
                      Created {new Date(selectedPatch.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`rounded px-2 py-1 text-xs font-semibold ${riskStyles[selectedPatch.riskLevel]}`}>
                      {selectedPatch.riskLevel}
                    </span>
                    {selectedPatch.riskLevel === 'high' && (
                      <Shield size={14} className="text-rose-600" />
                    )}
                  </div>
                </div>

                {/* Actions */}
                {selectedPatch.status === 'draft' && (
                  <div className="mt-4 flex gap-2">
                    <button
                      type="button"
                      onClick={() => handleReject(selectedPatch.id)}
                      disabled={isPending}
                      className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                    >
                      <XCircle size={14} />
                      Reject
                    </button>
                    <button
                      type="button"
                      onClick={() => handleApprove(selectedPatch.id)}
                      disabled={isPending}
                      className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:opacity-50"
                    >
                      {isPending ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
                      Approve
                    </button>
                  </div>
                )}

                {selectedPatch.status === 'approved' && (
                  <div className="mt-4 flex gap-2">
                    <button
                      type="button"
                      onClick={() => handleApply(selectedPatch.id)}
                      disabled={isPending}
                      className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
                    >
                      {isPending ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
                      Apply Patch
                    </button>
                  </div>
                )}
              </div>

              {/* Diff Viewer */}
              {patchDiff.files && patchDiff.files.length > 0 && (
                <DiffViewer
                  files={patchDiff.files}
                  expandedFiles={expandedFiles}
                  onToggleFile={handleToggleFile}
                />
              )}

              {/* No changes */}
              {(!patchDiff.files || patchDiff.files.length === 0) && (
                <div className="rounded-lg border border-slate-200 bg-white p-4 text-center text-sm text-slate-500">
                  No file changes to display
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default PatchReviewPanel;