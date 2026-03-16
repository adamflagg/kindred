/**
 * ActionButtons - Shared "Run Again" and "Run From Here" buttons for detail panels.
 *
 * "Run Again" is always dry-run only.
 * "Run From Here" supports opt-in production write with confirmation dialog.
 */

import { useState } from 'react'
import { Play, FastForward, AlertTriangle } from 'lucide-react'

export interface ActionButtonsProps {
  onRunAgain: () => void
  onRunFromHere: (writeToProduction: boolean) => void
  /** Number of bunk_requests that would be written if production write is enabled */
  productionWriteCount?: number
  /** Number of original_requests that would be marked processed */
  processedCount?: number
  isRunning?: boolean | undefined
}

export function ActionButtons({
  onRunAgain,
  onRunFromHere,
  productionWriteCount = 0,
  processedCount = 0,
  isRunning = false,
}: ActionButtonsProps) {
  const [writeToProduction, setWriteToProduction] = useState(false)
  const [showConfirmation, setShowConfirmation] = useState(false)

  function handleRunFromHere() {
    if (writeToProduction) {
      setShowConfirmation(true)
    } else {
      onRunFromHere(false)
    }
  }

  function handleConfirm() {
    setShowConfirmation(false)
    onRunFromHere(true)
  }

  function handleCancel() {
    setShowConfirmation(false)
  }

  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-gray-200 pt-4 dark:border-gray-700">
      <button
        onClick={onRunAgain}
        disabled={isRunning}
        className="inline-flex items-center gap-1.5 rounded-lg bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 transition-colors hover:bg-blue-100 disabled:opacity-50 dark:bg-blue-900/30 dark:text-blue-300 dark:hover:bg-blue-900/50"
        aria-label="Run Again"
      >
        <Play className="h-3.5 w-3.5" />
        Run Again
      </button>

      <button
        onClick={handleRunFromHere}
        disabled={isRunning}
        className="inline-flex items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-700 transition-colors hover:bg-amber-100 disabled:opacity-50 dark:bg-amber-900/30 dark:text-amber-300 dark:hover:bg-amber-900/50"
        aria-label="Run From Here"
      >
        <FastForward className="h-3.5 w-3.5" />
        Run From Here
      </button>

      <label className="inline-flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
        <input
          type="checkbox"
          checked={writeToProduction}
          onChange={(e) => setWriteToProduction(e.target.checked)}
          className="rounded border-gray-300 text-amber-500 focus:ring-amber-500"
          aria-label="Write to production"
        />
        Write to production
      </label>

      {/* Confirmation dialog overlay */}
      {showConfirmation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="mx-4 max-w-md rounded-xl bg-white p-6 shadow-xl dark:bg-gray-800">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/40">
                <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                Confirm Production Write
              </h3>
            </div>
            <p className="mb-6 text-sm text-gray-600 dark:text-gray-400">
              This will write {productionWriteCount} bunk_requests to production and mark{' '}
              {processedCount} original requests as processed. Proceed?
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={handleCancel}
                className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirm}
                className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
