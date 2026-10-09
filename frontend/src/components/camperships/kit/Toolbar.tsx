import type { ReactNode } from 'react'

import {
  CS_FCHIP,
  CS_FCHIP_WARN,
  CS_FLABEL,
  CS_TOOLBAR,
  CS_TOOLBAR_LEAD,
  CS_TOOLBAR_LEFT,
  CS_TOOLBAR_RIGHT,
  CS_TOOLBAR_STATUS,
} from './csType'

/**
 * The one-row toolbar (design-language §5–6; kit CF.bar): the lead and filters on the left; the
 * status, search, actions and Download CSV on the right, pushed to the edge. ONE row that never
 * wraps: a page that cannot fit shortens its words, it does not grow a second line.
 */
export function AidToolbar({
  lead,
  left,
  status,
  right,
  className,
}: {
  /** A count line that used to sit above the table ("13 lines open"). */
  readonly lead?: ReactNode
  readonly left?: ReactNode
  /** The result of the last action; it truncates, with the full words in its title. */
  readonly status?: string
  /** Search, actions, and Download CSV last. */
  readonly right?: ReactNode
  readonly className?: string
}) {
  return (
    <div
      data-testid="aid-toolbar"
      className={className ? `${CS_TOOLBAR} ${className}` : CS_TOOLBAR}
    >
      {(lead !== undefined || left !== undefined) && (
        <div className={CS_TOOLBAR_LEFT}>
          {lead !== undefined && <span className={CS_TOOLBAR_LEAD}>{lead}</span>}
          {left}
        </div>
      )}
      {(Boolean(status) || right !== undefined) && (
        <div className={CS_TOOLBAR_RIGHT}>
          {status && (
            <span className={CS_TOOLBAR_STATUS} title={status}>
              {status}
            </span>
          )}
          {right}
        </div>
      )}
    </div>
  )
}

/** A filter's label in the toolbar (kit .cf-lab): 12.5px muted, beside its control. */
export function ToolbarLabel({
  text,
  children,
}: {
  readonly text: string
  readonly children: ReactNode
}) {
  return (
    <label className={`${CS_FLABEL} inline-flex items-center gap-1.5`}>
      <span>{text}</span>
      {children}
    </label>
  )
}

/**
 * A filter that came from a link, as a removable chip in the toolbar row (kit CF.fchip): one line,
 * the sentence that used to sit above the table in its title, ✕ to clear. Amber when it failed.
 */
export function AidFilterChip({
  title,
  warn = false,
  onClear,
  children,
}: {
  readonly title: string
  readonly warn?: boolean
  readonly onClear: () => void
  readonly children: string
}) {
  return (
    <span className={warn ? CS_FCHIP_WARN : CS_FCHIP} title={title}>
      {children}
      <button
        type="button"
        aria-label={`Clear ${children}`}
        title="Show all"
        className="text-muted-foreground hover:bg-muted hover:text-foreground inline-flex h-4 w-4 cursor-pointer items-center justify-center rounded-full text-xs"
        onClick={onClear}
      >
        ✕
      </button>
    </span>
  )
}
