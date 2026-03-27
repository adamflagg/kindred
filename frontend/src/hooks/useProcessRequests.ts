import { useMutation, useQueryClient } from '@tanstack/react-query'
import { pb } from '../lib/pocketbase'
import { queryKeys } from '../utils/queryKeys'
import toast from 'react-hot-toast'
import { extractErrorMessage } from './createSyncMutation'
import type { ProcessRequestOptionsState } from '../components/admin/ProcessRequestOptions'

interface ProcessRequestsResponse {
  status: string
  message: string
  session: string
  limit: number
  force: boolean
  debug: boolean
  trace: boolean
}

/**
 * Hook for processing bunk requests with enhanced options.
 * Supports session filtering, record limits, and force reprocessing.
 */
export function useProcessRequests() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (options: ProcessRequestOptionsState): Promise<ProcessRequestsResponse> => {
      // Build query params
      const params = new URLSearchParams()

      // Session is a cm_id string (e.g., '1000003') or 'all'
      if (options.session !== 'all') {
        params.set('session', options.session)
      }

      // Source fields (comma-separated)
      if (options.sourceFields.length > 0) {
        params.set('source_field', options.sourceFields.join(','))
      }

      if (options.limit !== undefined && options.limit > 0) {
        params.set('limit', String(options.limit))
      }

      if (options.forceReprocess) {
        params.set('force', 'true')
      }

      if (options.debug) {
        params.set('debug', 'true')
      }

      if (options.trace) {
        params.set('trace', 'true')
      }

      if (options.collectTraces) {
        params.set('collect_traces', 'true')
      }

      const queryString = params.toString()
      const url = `/api/custom/sync/process-requests${queryString ? `?${queryString}` : ''}`

      const response = await pb.send<ProcessRequestsResponse>(url, {
        method: 'POST',
      })

      return response
    },
    onSuccess: (_data, options) => {
      // Build description of what was started
      const parts: string[] = []

      // Session description from label (populated by ProcessRequestOptions)
      if (options.session === 'all') {
        parts.push('all sessions')
      } else {
        parts.push(options.sessionLabel)
      }

      // Add source fields if specified
      if (options.sourceFields.length > 0) {
        const fieldLabels: Record<string, string> = {
          bunk_with: 'Bunk With',
          not_bunk_with: 'Not Bunk With',
          bunking_notes: 'Bunking Notes',
          internal_notes: 'Internal Notes',
          socialize_with: 'Socialize With',
        }
        const fieldNames = options.sourceFields.map((f) => fieldLabels[f] ?? f)
        parts.push(`fields: ${fieldNames.join(', ')}`)
      }

      // Add limit if specified
      if (options.limit !== undefined && options.limit > 0) {
        parts.push(`limit ${options.limit}`)
      }

      // Add force indicator
      if (options.forceReprocess) {
        parts.push('force reprocess')
      }

      // Add debug/trace indicator
      if (options.trace) {
        parts.push('trace mode')
      } else if (options.debug) {
        parts.push('debug mode')
      }

      if (options.collectTraces) {
        parts.push('collecting traces')
      }

      const description = parts.join(', ')

      toast(`Processing requests: ${description}`, {
        icon: '🧠',
        duration: 4000,
        className: 'toast-lodge toast-lodge-success',
        style: {
          borderLeft: '4px solid hsl(174, 100%, 30%)',
        },
      })

      // Invalidate sync status to show it's running
      void queryClient.invalidateQueries({ queryKey: queryKeys.syncStatus() })
    },
    onError: (error) => {
      const errorMessage = extractErrorMessage(error)

      if (errorMessage.includes('already in progress')) {
        toast.error('Request processing is already running')
      } else {
        toast.error(`Failed to start processing: ${errorMessage}`)
      }
    },
  })
}
