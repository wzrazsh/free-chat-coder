/**
 * DiffViewer Component
 * 
 * Renders unified diff with syntax highlighting
 */
import { useMemo } from 'react';
import { FileDiff, Plus, Minus, File, ChevronDown, ChevronRight } from 'lucide-react';

interface DiffFile {
  path: string;
  changeType: 'create' | 'modify' | 'delete';
  diff: string;
  additions: number;
  deletions: number;
}

interface DiffViewerProps {
  files: DiffFile[];
  expandedFiles?: Set<string>;
  onToggleFile?: (path: string) => void;
}

export function DiffViewer({ files, expandedFiles = new Set(), onToggleFile }: DiffViewerProps) {
  const stats = useMemo(() => {
    return files.reduce(
      (acc, file) => ({
        additions: acc.additions + file.additions,
        deletions: acc.deletions + file.deletions,
      }),
      { additions: 0, deletions: 0 }
    );
  }, [files]);

  if (files.length === 0) {
    return (
      <div className="p-4 text-center text-sm text-slate-500">
        No files to display
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3">
        <div className="flex items-center gap-2">
          <FileDiff size={16} className="text-slate-500" />
          <span className="text-sm font-medium text-slate-700">
            {files.length} file{files.length !== 1 ? 's' : ''} changed
          </span>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="flex items-center gap-1 text-emerald-600">
            <Plus size={14} />
            {stats.additions}
          </span>
          <span className="flex items-center gap-1 text-rose-600">
            <Minus size={14} />
            {stats.deletions}
          </span>
        </div>
      </div>

      <div className="divide-y divide-slate-100">
        {files.map((file) => (
          <DiffFileView
            key={file.path}
            file={file}
            isExpanded={expandedFiles.has(file.path)}
            onToggle={() => onToggleFile?.(file.path)}
          />
        ))}
      </div>
    </div>
  );
}

interface DiffFileViewProps {
  file: DiffFile;
  isExpanded: boolean;
  onToggle: () => void;
}

function DiffFileView({ file, isExpanded, onToggle }: DiffFileViewProps) {
  const lines = useMemo(() => {
    return file.diff.split('\n');
  }, [file.diff]);

  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between px-4 py-2 text-left transition hover:bg-slate-50"
      >
        <div className="flex items-center gap-2">
          <File size={14} className="text-slate-400" />
          <span className="font-mono text-sm text-slate-700">{file.path}</span>
          <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${
            file.changeType === 'create' ? 'bg-emerald-100 text-emerald-700' :
            file.changeType === 'delete' ? 'bg-rose-100 text-rose-700' :
            'bg-slate-100 text-slate-600'
          }`}>
            {file.changeType}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-emerald-600">+{file.additions}</span>
          <span className="text-xs text-rose-600">-{file.deletions}</span>
          {isExpanded ? (
            <ChevronDown size={14} className="text-slate-400" />
          ) : (
            <ChevronRight size={14} className="text-slate-400" />
          )}
        </div>
      </button>

      {isExpanded && (
        <div className="border-t border-slate-100">
          <pre className="max-h-96 overflow-auto bg-slate-50 p-4 font-mono text-xs leading-5">
            {lines.map((line, index) => {
              const isAddition = line.startsWith('+') && !line.startsWith('+++');
              const isDeletion = line.startsWith('-') && !line.startsWith('---');
              const isHunk = line.startsWith('@@');
              const isHeader = line.startsWith('---') || line.startsWith('+++');

              return (
                <div
                  key={index}
                  className={`${
                    isAddition ? 'bg-emerald-50 text-emerald-800' :
                    isDeletion ? 'bg-rose-50 text-rose-800' :
                    isHunk ? 'bg-blue-50 text-blue-800 font-medium' :
                    isHeader ? 'text-slate-500' :
                    'text-slate-700'
                  }`}
                >
                  <span className="mr-3 select-none text-slate-400">
                    {String(index + 1).padStart(4, ' ')}
                  </span>
                  {line}
                </div>
              );
            })}
          </pre>
        </div>
      )}
    </div>
  );
}

export default DiffViewer;