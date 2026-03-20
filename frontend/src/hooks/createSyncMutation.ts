import { useMutation, useQueryClient } from '@tanstack/react-query'
import { pb } from '../lib/pocketbase'
import { queryKeys } from '../utils/queryKeys'
import toast from 'react-hot-toast'

export const SYNC_STARTED_TOAST_OPTIONS = {
  icon: '\u2713',
  duration: 3000,
  className: 'toast-lodge toast-lodge-success',
  style: { borderLeft: '4px solid hsl(160, 100%, 21%)' },
} as const

export function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const pbError = error as {
      response?: { data?: { error?: string; message?: string }; message?: string }
    }
    if (pbError.response?.data?.error) return pbError.response.data.error
    if (pbError.response?.data?.message) return pbError.response.data.message
    if (pbError.response?.message) return pbError.response.message
    return error.message
  }
  return 'Unknown error'
}

interface SyncMutationConfig<TParams> {
  /** URL path or function that builds the URL from params */
  endpoint: string | ((params: TParams) => string)
  /** HTTP method (default: POST) */
  method?: 'POST' | 'DELETE'
  /** Human-readable name for toast messages */
  displayName: string | ((params: TParams) => string)
  /** Custom message when sync is already running */
  alreadyRunningMessage?: string
  /** Additional query keys to invalidate on success */
  extraInvalidateKeys?: readonly unknown[][]
  /** Custom success message; return null to suppress toast */
  onSuccessMessage?: (data: unknown, params: TParams) => string | null
}

/**
 * Factory that creates a typed useMutation hook for sync operations.
 *
 * Handles the common pattern: call pb.send → show toast → invalidate syncStatus.
 * Extracts PocketBase error messages and supports "already in progress" detection.
 */
export function createSyncMutation<TParams = void>(config: SyncMutationConfig<TParams>) {
  return function useSyncMutation() {
    const queryClient = useQueryClient()

    return useMutation({
      mutationFn: async (params: TParams) => {
        const url =
          typeof config.endpoint === 'function' ? config.endpoint(params) : config.endpoint
        return await pb.send(url, { method: config.method ?? 'POST' })
      },
      onSuccess: (data: unknown, params: TParams) => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.syncStatus() })
        if (config.extraInvalidateKeys) {
          for (const key of config.extraInvalidateKeys) {
            void queryClient.invalidateQueries({ queryKey: key })
          }
        }
        if (config.onSuccessMessage) {
          const msg = config.onSuccessMessage(data, params)
          if (msg) toast.success(msg, { duration: 3000 })
        } else {
          const name =
            typeof config.displayName === 'function'
              ? config.displayName(params)
              : config.displayName
          const status = (data as { status?: string } | null)?.status
          if (status === 'started') {
            toast(`${name} started`, SYNC_STARTED_TOAST_OPTIONS)
          } else {
            toast.success(`${name} complete`, { duration: 3000 })
          }
        }
      },
      onError: (error: Error, variables: TParams) => {
        const name =
          typeof config.displayName === 'function'
            ? config.displayName(variables)
            : config.displayName
        let errorMessage = extractErrorMessage(error)
        if (config.alreadyRunningMessage && errorMessage.includes('already in progress')) {
          errorMessage = config.alreadyRunningMessage
        }
        toast.error(
          errorMessage.includes(name) ? errorMessage : `${name} failed: ${errorMessage}`,
          { duration: 5000 }
        )
      },
    })
  }
}
