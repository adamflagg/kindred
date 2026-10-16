import { Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { UNLISTED_MIN, useAidIntakeUnlisted } from '../../../hooks/camperships/useAidIntake'
import { CS_BODY, CS_BTN2, CS_POPEN_META, CS_SEARCH, CS_SMALL } from '../kit/csType'
import { EditorForm } from '../kit/EditorLayout'
import { AidRowAction } from '../kit/RowAction'
import { AddRequestEditor } from './AddRequestEditor'
import { enrolledWords, sessionIndex, targetFromRow } from './intakeModel'
import type { FormIntakeRowOut } from './intakeTypes'

/**
 * Find a Camper Not Listed… (the mock's `findPanel`): a page-level editor between the toolbar and the table, as
 * Record a Commitment… is. It searches the campers enrolled this season who are on no row (no aid form, no
 * registration ask), and opens Add a Request… on one. A camper CampMinder links to no household cannot be added.
 */
export function FindUnlistedPanel({
  onAdded,
  onClose,
}: {
  onAdded: (row: FormIntakeRowOut, status: string) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<FormIntakeRowOut | null>(null)
  const read = useAidIntakeUnlisted(query)
  const names = useMemo(() => sessionIndex(read.data?.sessions ?? []), [read.data])
  const box = useRef<HTMLInputElement>(null)
  useEffect(() => box.current?.focus(), [])
  const searching = query.trim().length >= UNLISTED_MIN
  const rows = searching ? (read.data?.rows ?? []) : []

  const results = !searching ? (
    <span className={CS_POPEN_META}>
      Lists campers enrolled this season who are on no form row and no registration ask.
    </span>
  ) : read.isLoading ? (
    <span className={CS_POPEN_META}>Searching…</span>
  ) : read.error !== null && read.data === undefined ? (
    <span className={CS_POPEN_META}>The search couldn&apos;t load.</span>
  ) : rows.length === 0 ? (
    <span className={CS_POPEN_META}>
      No enrolled camper by that name is missing from this list.
    </span>
  ) : (
    <div className="mt-0.5 flex flex-col gap-1">
      {rows.map((r) => (
        <div key={r.key} className={`flex items-center gap-2.5 ${CS_BODY}`}>
          <b>{r.camper_name}</b>
          <span className={CS_POPEN_META}>
            {enrolledWords(r, names).text} ·{' '}
            {r.household_cm_id > 0 ? `⌂ ${r.household_label ?? ''}` : 'no household in CampMinder'}
          </span>
          {r.can_add === true ? (
            <AidRowAction label="Add a Request…" onClick={() => setPicked(r)} />
          ) : (
            <span className={CS_SMALL}>
              {r.household_cm_id > 0
                ? 'nothing to add: every enrolled session holds a request'
                : 'fix the household in CampMinder first'}
            </span>
          )}
        </div>
      ))}
    </div>
  )

  return (
    <div data-testid="find-unlisted" className="mb-2.5">
      <EditorForm heading="phead" title="Find a camper not listed">
        <div className="flex items-center gap-2">
          <div className="relative w-[220px] flex-none">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 h-3.5 w-3.5 -translate-y-1/2" />
            <input
              ref={box}
              type="search"
              aria-label="A camper's name"
              placeholder="A camper's name"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setPicked(null)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') onClose()
              }}
              className={CS_SEARCH}
            />
          </div>
          <button type="button" className={CS_BTN2} onClick={onClose}>
            Close
          </button>
          <span className={CS_POPEN_META}>For a family with no CampMinder aid answer at all</span>
        </div>
        {picked === null ? (
          results
        ) : (
          <AddRequestEditor
            target={targetFromRow(picked)}
            names={names}
            onSaved={(status) => onAdded(picked, status)}
            onCancel={() => setPicked(null)}
            onWhite
          />
        )}
      </EditorForm>
    </div>
  )
}
