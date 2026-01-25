import React, { useState, useRef } from 'react';
import { Upload, Loader2, FileText, AlertCircle, CheckCircle } from 'lucide-react';
import { useApiWithAuth } from '../hooks/useApiWithAuth';
import { syncService, type UploadError } from '../services/sync';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { useCurrentYear } from '../hooks/useCurrentYear';

interface BunkRequestsUploadProps {
  compact?: boolean;
}

export default function BunkRequestsUpload({ compact = false }: BunkRequestsUploadProps) {
  const { fetchWithAuth } = useApiWithAuth();
  const queryClient = useQueryClient();
  const { currentYear } = useCurrentYear();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [showModal, setShowModal] = useState(false);

  const uploadMutation = useMutation({
    mutationFn: (file: File) => syncService.uploadBunkRequestsCSV(file, fetchWithAuth, currentYear),
    onSuccess: (data) => {
      const message = data.process_requests_started
        ? `CSV uploaded - syncing and processing requests...`
        : `CSV uploaded successfully: ${data.filename}`;
      toast.success(message, {
        duration: 4000,
      });
      setShowModal(false);
      setSelectedFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      // Invalidate sync status
      queryClient.invalidateQueries({ queryKey: ['sync-status'] });
    },
    onError: (error: UploadError) => {
      if (error.missing_columns) {
        toast.error(
          <div>
            <p className="font-medium">Missing required columns:</p>
            <ul className="list-disc list-inside text-sm mt-1">
              {error.missing_columns.map((col) => (
                <li key={col}>{col}</li>
              ))}
            </ul>
            {error.found_columns && error.found_columns.length > 0 && (
              <p className="text-xs mt-2 text-muted-foreground">
                Found columns: {error.found_columns.join(', ')}
              </p>
            )}
          </div>,
          { duration: 8000 }
        );
      } else {
        toast.error(
          <div>
            <p>{error.error || 'Failed to upload CSV'}</p>
            {error.details && (
              <p className="text-sm mt-1 text-muted-foreground">{error.details}</p>
            )}
          </div>,
          { duration: 6000 }
        );
      }
    },
  });

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      // Check file extension or MIME type
      const isCSV = file.name.toLowerCase().endsWith('.csv') || file.type === 'text/csv';
      if (isCSV) {
        setSelectedFile(file);
        setShowModal(true);
      } else {
        toast.error('Please select a CSV file (must have .csv extension)');
      }
    }
  };

  const handleUpload = () => {
    if (selectedFile) {
      uploadMutation.mutate(selectedFile);
    }
  };

  return (
    <>
      {/* Upload Button */}
      <button
        onClick={() => fileInputRef.current?.click()}
        className={
          compact
            ? "btn-secondary py-1.5 px-3"
            : "btn-secondary py-2 px-4 nav-btn-icon-only"
        }
        title="Upload Bunk Requests CSV"
      >
        <Upload className="w-4 h-4 flex-shrink-0" />
        {compact ? (
          <span>Upload</span>
        ) : (
          <>
            <span className="nav-text-short">Upload</span>
            <span className="nav-text-full">Upload Requests</span>
          </>
        )}
      </button>

      {/* Hidden File Input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv"
        onChange={handleFileSelect}
        className="hidden"
      />

      {/* Upload Confirmation Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
          <div className="card-lodge p-6 max-w-md w-full max-h-[90vh] overflow-y-auto animate-scale-in">
            <h2 className="text-xl font-display font-bold mb-4">Upload Bunk Requests CSV</h2>

            {selectedFile && (
              <div className="mb-4 p-4 bg-muted/30 rounded-xl flex items-center gap-3 border border-border/50">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                  <FileText className="w-5 h-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{selectedFile.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {(selectedFile.size / 1024).toFixed(1)} KB
                  </p>
                </div>
              </div>
            )}

            <div className="mb-6 space-y-3">
              <div className="flex items-start gap-3">
                <div className="w-5 h-5 rounded-full bg-amber-500/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <AlertCircle className="w-3 h-3 text-amber-600" />
                </div>
                <p className="text-sm text-muted-foreground">
                  This will replace the existing bunk requests CSV file.
                </p>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-5 h-5 rounded-full bg-green-500/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <CheckCircle className="w-3 h-3 text-green-600" />
                </div>
                <p className="text-sm text-muted-foreground">
                  The file will be validated before replacing the existing one.
                </p>
              </div>
            </div>

            <div className="flex flex-col-reverse sm:flex-row gap-3 sm:justify-end">
              <button
                onClick={() => {
                  setShowModal(false);
                  setSelectedFile(null);
                  if (fileInputRef.current) {
                    fileInputRef.current.value = '';
                  }
                }}
                className="btn-ghost py-2.5"
                disabled={uploadMutation.isPending}
              >
                Cancel
              </button>
              <button
                onClick={handleUpload}
                disabled={uploadMutation.isPending}
                className="btn-primary"
              >
                {uploadMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Uploading...
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4" />
                    Upload
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
