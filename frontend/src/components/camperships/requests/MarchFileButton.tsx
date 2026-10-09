import { Download } from 'lucide-react'

import { MARCH_FILE_HINT } from './marchFile'
import type { MarchFile } from './useMarchFile'

/**
 * The March File's item in Download CSV's menu (`csvMenu`; variant A), on Requests › Needs an offer with
 * the Round 1 chip lit, for casework on a live read (the page decides). Its hint is the one line of
 * words the file needs; its result says itself in the toolbar's status slot (requestsStatus).
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
