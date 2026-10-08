import { Download } from 'lucide-react'

import { CS_AMBER_NOTE } from '../kit/csType'
import { MARCH_FILE_HINT } from './marchFile'
import type { MarchFile } from './useMarchFile'

/**
 * The March File's item in Download CSV's menu (`csvMenu`; variant A), on Requests › Needs an offer with
 * the Round 1 chip lit, for casework on a live read (the page decides). Its hint is the one line of
 * words the file needs; nothing is drawn under the toolbar until a click.
 */
export function MarchFileItem({ march }: { march: MarchFile }) {
  return (
    <button
      type="button"
      disabled={march.busy}
      onClick={march.download}
      className="hover:bg-muted/60 block w-full rounded-md px-2.5 py-1.5 text-left disabled:opacity-50"
    >
      <span className="flex items-center gap-2 text-sm font-semibold whitespace-nowrap">
        <Download className="text-muted-foreground h-4 w-4" />
        {march.busy ? 'Making the File…' : 'Download the March File, for CampMinder'}
      </span>
      <span className="text-muted-foreground mt-0.5 ml-6 block text-xs whitespace-nowrap">
        {MARCH_FILE_HINT}
      </span>
    </button>
  )
}

/** The status line after a click, under the toolbar: what happened, dismissible. An error stays amber. */
export function MarchFileResult({ march }: { march: MarchFile }) {
  if (march.said === null && march.error === null) return null
  const text = march.error ?? march.said
  return (
    <div
      className={`flex items-center gap-2.5 rounded-md border px-3 py-1.5 text-[13px] ${
        march.error === null
          ? 'border-emerald-600/30 bg-emerald-50 dark:border-emerald-400/30 dark:bg-emerald-950/30'
          : 'border-amber-600/30 bg-amber-50 dark:border-amber-400/30 dark:bg-amber-950/30'
      }`}
    >
      <p className={march.error === null ? '' : CS_AMBER_NOTE}>{text}</p>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={march.dismiss}
        className="text-muted-foreground hover:text-foreground ml-auto"
      >
        ✕
      </button>
    </div>
  )
}
