import { useState, useRef, useCallback } from 'react';
import * as api from '../../api/endpoints';
import { useExperimentStore } from '../../stores/experimentStore';

const ACCEPTED_EXT = '.afe8';
const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500 MB

export default function FileUpload() {
  const [isDragging, setIsDragging] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchExperiments = useExperimentStore((s) => s.fetchExperiments);

  const validateFiles = (files: File[]): File[] => {
    const valid: File[] = [];
    const errors: string[] = [];
    for (const f of files) {
      const ext = f.name.toLowerCase().slice(-5);
      if (ext !== ACCEPTED_EXT) {
        errors.push(`${f.name}: unsupported file type (expected .afe8)`);
        continue;
      }
      if (f.size > MAX_FILE_SIZE) {
        errors.push(`${f.name}: file too large (max 500MB)`);
        continue;
      }
      valid.push(f);
    }
    if (errors.length > 0) {
      setError(errors.join('\n'));
    } else {
      setError(null);
    }
    return valid;
  };

  const doUpload = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setError(null);
      setSuccess(null);
      setUploadProgress(0);
      try {
        await api.uploadFiles(files, (pct) => setUploadProgress(pct));
        setSuccess(`Successfully uploaded ${files.length} file(s)`);
        setUploadProgress(null);
        // Refresh experiment list
        await fetchExperiments(1);
        // Clear success message after 5 seconds
        setTimeout(() => setSuccess(null), 5000);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Upload failed');
        setUploadProgress(null);
      }
    },
    [fetchExperiments],
  );

  const handleFiles = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);
    const valid = validateFiles(files);
    if (valid.length > 0) {
      doUpload(valid);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    handleFiles(e.dataTransfer.files);
  };

  const handleClick = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className="px-4 py-3 border-b border-slate-200">
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={handleClick}
        className={`relative border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
          isDragging
            ? 'border-brand-500 bg-brand-50'
            : 'border-slate-300 bg-slate-50 hover:border-brand-400 hover:bg-brand-50'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".afe8"
          multiple
          onChange={(e) => handleFiles(e.target.files)}
          className="hidden"
        />

        {uploadProgress !== null ? (
          <div className="space-y-2">
            <div className="text-sm text-brand-700 font-medium">
              Uploading... {uploadProgress}%
            </div>
            <div className="w-full bg-slate-200 rounded-full h-2 overflow-hidden">
              <div
                className="bg-brand-600 h-full rounded-full transition-all duration-300"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <svg
              className="mx-auto h-10 w-10 text-slate-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"
              />
            </svg>
            <p className="text-sm text-slate-600 font-medium">
              Drag &amp; drop .afe8 files here
            </p>
            <p className="text-xs text-slate-400">or click to browse</p>
          </div>
        )}
      </div>

      {error && (
        <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700 whitespace-pre-line">
          {error}
        </div>
      )}
      {success && (
        <div className="mt-2 p-2 bg-green-50 border border-green-200 rounded text-xs text-green-700">
          {success}
        </div>
      )}
    </div>
  );
}