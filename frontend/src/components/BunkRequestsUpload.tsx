import { type ChangeEvent, useState, useRef } from 'react'
import { Upload, Loader2, FileText, AlertCircle, CheckCircle } from 'lucide-react'
import { useApiWithAuth } from '../hooks/useApiWithAuth'
import { syncService, type UploadError } from '../services/sync'
import { clearCsvUploadMarker, markCsvUploadStarted } from '../services/csvPipelineStatus'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { useCurrentYear } from '../hooks/useCurrentYear'
import { queryKeys } from '../utils/queryKeys'

interface BunkRequestsUploadProps {
  compact?: boolean
  /**
   * The full-width button label, and the button this component's success toast
   * tells the reader to watch (kindred#2478 §4).
   *
   * Parameterised because the weekend surface renders this same component as
   * "Upload Bunk Notes" — one CSV, one upload lane, but each program reads a
   * different column of it. It MUST be threaded through both places: the toast
   * hardcoded "Upload Requests" while the button said something else, which
   * pointed weekend staff at a button that is not on their screen.
   *
   * The default keeps summer's strings byte-identical.
   */
  label?: string
}

export default function BunkRequestsUpload({
  compact = false,
  label = 'Upload Requests',
}: BunkRequestsUploadProps) {
  const { fetchWithAuth } = useApiWithAuth()
  const queryClient = useQueryClient()
  const { currentYear } = useCurrentYear()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [showModal, setShowModal] = useState(false)

  const uploadMutation = useMutation({
    mutationFn: (file: File) => syncService.uploadBunkRequestsCSV(file, fetchWithAuth, currentYear),
    onMutate: () => {
      // Mark this browser session as having initiated a CSV upload so the
      // CsvPipelineIndicator can attribute the next bunk_requests sync to
      // the upload (rather than the nightly cron, which also runs that sync).
      markCsvUploadStarted()
    },
    onSuccess: () => {
      toast.success(
        `Importing CSV — this may take a few minutes. The icon next to the ${label} button will update when it's done.`,
        { duration: 6000 }
      )
      setShowModal(false)
      setSelectedFile(null)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
      // Invalidate sync status and csv pipeline status
      void queryClient.invalidateQueries({ queryKey: queryKeys.syncStatus() })
      void queryClient.invalidateQueries({ queryKey: queryKeys.csvPipelineStatus() })
    },
    onError: (error: UploadError) => {
      // Upload failed before the sync could start — clear the marker so a
      // subsequent cron run isn't falsely attributed to this upload.
      clearCsvUploadMarker()
      if (error.missing_columns) {
        toast.error(
          <div>
            <p className="font-medium">Missing required columns:</p>
            <ul className="mt-1 list-inside list-disc text-sm">
              {error.missing_columns.map((col) => (
                <li key={col}>{col}</li>
              ))}
            </ul>
            {error.found_columns && error.found_columns.length > 0 && (
              <p className="text-muted-foreground mt-2 text-xs">
                Found columns: {error.found_columns.join(', ')}
              </p>
            )}
          </div>,
          { duration: 8000 }
        )
      } else {
        toast.error(
          <div>
            <p>{error.error || 'Failed to upload CSV'}</p>
            {error.details && <p className="text-muted-foreground mt-1 text-sm">{error.details}</p>}
          </div>,
          { duration: 6000 }
        )
      }
    },
  })

  const handleFileSelect = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) {
      // Check file extension or MIME type
      const isCSV = file.name.toLowerCase().endsWith('.csv') || file.type === 'text/csv'
      if (isCSV) {
        setSelectedFile(file)
        setShowModal(true)
      } else {
        toast.error('Please select a CSV file (must have .csv extension)')
      }
    }
  }

  const handleUpload = () => {
    if (selectedFile) {
      uploadMutation.mutate(selectedFile)
    }
  }

  return (
    <>
      {/* Upload Button */}
      <button
        onClick={() => fileInputRef.current?.click()}
        className={
          compact ? 'btn-secondary px-3 py-1.5' : 'btn-secondary nav-btn-icon-only px-4 py-2'
        }
        title="Camper report: API Bunking Info"
      >
        <Upload className="h-4 w-4 flex-shrink-0" />
        {compact ? (
          <span>Upload</span>
        ) : (
          <>
            <span className="nav-text-short">Upload</span>
            <span className="nav-text-full">{label}</span>
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
        <div className="animate-fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="card-lodge animate-scale-in max-h-[90vh] w-full max-w-md overflow-y-auto p-6">
            <h2 className="font-display mb-4 text-xl font-bold">Upload Bunk Requests CSV</h2>

            {selectedFile && (
              <div className="bg-muted/30 border-border/50 mb-4 flex items-center gap-3 rounded-xl border p-4">
                <div className="bg-primary/10 flex h-10 w-10 items-center justify-center rounded-xl">
                  <FileText className="text-primary h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{selectedFile.name}</p>
                  <p className="text-muted-foreground text-xs">
                    {(selectedFile.size / 1024).toFixed(1)} KB
                  </p>
                </div>
              </div>
            )}

            <div className="mb-6 space-y-3">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-amber-500/10">
                  <AlertCircle className="h-3 w-3 text-amber-600" />
                </div>
                <p className="text-muted-foreground text-sm">
                  This will replace the existing bunk requests CSV file.
                </p>
              </div>
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-green-500/10">
                  <CheckCircle className="h-3 w-3 text-green-600" />
                </div>
                <p className="text-muted-foreground text-sm">
                  The file will be validated before replacing the existing one.
                </p>
              </div>
            </div>

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                onClick={() => {
                  setShowModal(false)
                  setSelectedFile(null)
                  if (fileInputRef.current) {
                    fileInputRef.current.value = ''
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
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Uploading...
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4" />
                    Upload
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
