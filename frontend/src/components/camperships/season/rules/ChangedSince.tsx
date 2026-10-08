import { useState, type ReactNode } from 'react'

import { CS_AMBER_NOTE } from '../../kit/csType'

/** Lines shown before "+n more": a whole re-priced season ran on as one paragraph across the card. */
const SHOWN = 3

/** "Changed since v‹n›:", one change per line; past the first three the rest fold behind "+n more". */
export function ChangedSince({
  version,
  lines,
}: {
  version: number | null | undefined
  lines: readonly ReactNode[]
}) {
  const [all, setAll] = useState(false)
  if (lines.length === 0) return null
  const shown = all ? lines : lines.slice(0, SHOWN)
  return (
    <div data-testid="changed-since" className={`${CS_AMBER_NOTE} mt-1`}>
      {`Changed since v${String(version ?? '')}:`}
      <ul className="pl-3">
        {shown.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>
      {lines.length > SHOWN && (
        <button type="button" className="pl-3 font-semibold" onClick={() => setAll(!all)}>
          {all ? 'Show fewer' : `+${String(lines.length - SHOWN)} more`}
        </button>
      )}
    </div>
  )
}
