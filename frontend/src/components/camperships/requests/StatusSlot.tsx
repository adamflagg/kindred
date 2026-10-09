import { CS_TOOLBAR_STATUS } from '../kit/csType'
import type { RequestsStatus } from './requestsStatus'

const TONE = {
  muted: '',
  ok: 'text-forest-700 dark:text-forest-300 font-semibold',
  warn: 'text-amber-700 dark:text-amber-300 font-semibold',
} as const

/**
 * Requests' one status slot (design-language §5–6): the words of requestsStatus, truncating, the full
 * words in the title, with a ✕ for a result that can be dismissed. It is the toolbar's right group's
 * only part that shrinks.
 */
export function StatusSlot({
  status,
  onDismiss,
}: {
  status: RequestsStatus | null
  onDismiss: (which: 'result' | 'march') => void
}) {
  if (status === null) return null
  const dismiss = status.dismiss
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className={`${CS_TOOLBAR_STATUS} ${TONE[status.tone]}`} title={status.title}>
        {status.text}
      </span>
      {dismiss !== undefined && (
        <button
          type="button"
          aria-label="Dismiss"
          title="Dismiss"
          className="text-muted-foreground hover:text-foreground flex-none cursor-pointer text-xs"
          onClick={() => onDismiss(dismiss)}
        >
          ✕
        </button>
      )}
    </span>
  )
}
