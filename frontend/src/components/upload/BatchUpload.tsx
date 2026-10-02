/**
 * BatchUpload — multi-file upload component for batch processing.
 *
 * Allows selecting multiple .afe8 files at once and uploading them. Shows
 * progress and per-file status. After upload, experiments are available
 * as targets in the BatchProcessor.
 */
import { useState, useRef } from 'react';
import * as api from '../../api/endpoints';
import { useExperimentStore } from '../../stores/experimentStore';

export default function BatchUpload() {
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<{ name: string; status: string; error?: string }[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const fetchExperiments = useExperimentStore((s) => s.fetchExperiments);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files || []);
    const afe8Files = selected.filter((f) => f.name.toLowerCase().endsWith('.afe8'));
    setFiles(afe8Files);
    setResults([]);
  };

  const handleUpload = async () => {
    if (files.length === 0) return;
    setUploading(true);
    setProgress(0);
    setResults([]);
    const newResults: { name: string; status: string; error?: string }[] = [];
    for (let i = 0; i < files.length; i++) {
      try {
        await api.uploadFiles([files[i]]);
        newResults.push({ name: files[i].name, status: 'uploaded' });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Upload failed';
        if (msg.includes('already uploaded')) {
          newResults.push({ name: files[i].name, status: 'already exists' });
        } else {
          newResults.push({ name: files[i].name, status: 'failed', error: msg });
        }
      }
      setProgress(Math.round(((i + 1) / files.length) * 100));
    }
    setResults(newResults);
    setUploading(false);
    fetchExperiments(1);
  };

  return (
    <div className="border-t-2 border-slate-200 p-4 space-y-3 bg-white">
      <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
        Batch Upload
      </h4>

      <div
        className="border-2 border-dashed border-slate-300 rounded-lg p-4 text-center cursor-pointer hover:border-brand-400 transition-colors"
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".afe8"
          onChange={handleFileChange}
          className="hidden"
        />
        <div className="text-xs text-slate-400">
          {files.length === 0
            ? 'Click to select multiple .afe8 files'
            : `${files.length} file(s) selected`}
        </div>
      </div>

      {files.length > 0 && (
        <div className="text-xs text-slate-500 space-y-0.5">
          {files.map((f, i) => (
            <div key={i} className="truncate">{f.name} ({(f.size / 1024).toFixed(0)} KB)</div>
          ))}
        </div>
      )}

      <button
        onClick={handleUpload}
        disabled={uploading || files.length === 0}
        className="w-full text-xs px-3 py-2 rounded bg-brand-600 text-white hover:bg-brand-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {uploading ? `Uploading\u2026 ${progress}%` : `Upload ${files.length} file(s)`}
      </button>

      {uploading && (
        <div className="h-1.5 bg-slate-200 rounded overflow-hidden">
          <div
            className="h-full bg-brand-500 transition-all duration-200"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      {results.length > 0 && (
        <div className="space-y-0.5">
          {results.map((r, i) => (
            <div
              key={i}
              className={`text-xs px-2 py-0.5 rounded ${
                r.status === 'failed'
                  ? 'text-red-700 bg-red-50'
                  : r.status === 'already exists'
                    ? 'text-amber-700 bg-amber-50'
                    : 'text-green-700 bg-green-50'
              }`}
            >
              {r.name}: {r.status}
              {r.error && ` \u2014 ${r.error}`}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}