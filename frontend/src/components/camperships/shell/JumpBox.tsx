import { Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useNavigate } from 'react-router'

import { useAidAsOf } from '../../../hooks/camperships/useAidAsOf'
import { useAidJumpIndex } from '../../../hooks/camperships/useAidJumpIndex'
import { useYear } from '../../../hooks/useCurrentYear'
import type { ApiAidJumpHousehold } from '../../../types/api-types'
import { aidHref } from '../kit/asOf'
import { searchJumpIndex, type JumpMatch } from '../kit/jumpSearch'
import { isPageKey } from '../kit/keyboard'

const NO_HOUSEHOLDS: readonly ApiAidJumpHousehold[] = []

/**
 * The jump box (§3.5; D13): "/" focuses it from anywhere on the page; it matches as you type,
 * from an index loaded once; ↑/↓ move through the matches; Enter opens the household page; Esc
 * lets go. Its keys are the input's own (a control). "/" stands aside while another field has
 * focus, a modifier is held or a modal is open (Decision 6, RULED 2026-10-01; `isPageKey`).
 * The target carries the season and the as-of (D15).
 */
export function JumpBox() {
  const navigate = useNavigate()
  const year = useYear()
  const asOf = useAidAsOf()
  const { data, isPending, error } = useAidJumpIndex()
  // Four states (frontend/CLAUDE.md; Ruling 2026-10-01 (plan review)): loading and error take no search.
  const unavailable = isPending || error !== null
  const placeholder =
    error !== null
      ? 'Search unavailable'
      : isPending
        ? 'Loading families…'
        : 'Family, camper or CM id'
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const matches = useMemo(
    () => searchJumpIndex(data?.households ?? NO_HOUSEHOLDS, query),
    [data, query]
  )

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== '/' || !isPageKey(event)) return
      event.preventDefault()
      inputRef.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const letGo = () => {
    setQuery('')
    setActive(0)
    setOpen(false)
    inputRef.current?.blur()
  }

  const go = (match: JumpMatch | undefined) => {
    if (match === undefined) return
    letGo()
    void navigate(aidHref(`/aid/households/${String(match.householdCmId)}`, { year, asOf }))
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((a) => Math.min(a + 1, Math.max(matches.length - 1, 0)))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      go(matches[active])
    } else if (event.key === 'Escape') {
      event.preventDefault()
      letGo()
    }
  }

  return (
    <div className="relative w-56">
      <Search className="text-muted-foreground absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2" />
      <input
        ref={inputRef}
        type="text"
        aria-label="Jump to a family"
        placeholder={placeholder}
        disabled={unavailable}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value)
          setActive(0)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        className="border-border bg-background focus:ring-primary/50 w-full rounded-lg border py-1 pr-7 pl-8 text-xs focus:ring-2 focus:outline-none disabled:opacity-60"
      />
      <kbd className="border-border text-muted-foreground absolute top-1/2 right-2 -translate-y-1/2 rounded border px-1 font-mono text-xs">
        /
      </kbd>
      {open && matches.length > 0 && (
        <ul className="card-lodge shadow-lodge-lg absolute right-0 z-50 mt-1 w-80 p-1">
          {matches.map((match, index) => (
            <li key={match.householdCmId}>
              <button
                type="button"
                // mousedown, so the input's blur doesn't close the list before the click lands
                onMouseDown={(event) => {
                  event.preventDefault()
                  go(match)
                }}
                className={`w-full rounded-md px-2 py-1.5 text-left text-sm ${index === active ? 'bg-muted/60' : ''}`}
              >
                <span className="font-medium">{match.familyName}</span>{' '}
                <span className="text-muted-foreground text-xs">{match.detail}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
