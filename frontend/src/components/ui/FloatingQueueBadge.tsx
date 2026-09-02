/**
 * The queue that lives in the corner instead of in a rail.
 *
 * Summer's unassigned campers and the weekend's unplaced families are the same
 * interaction over different rows: a counter you can ignore, a popover you can
 * filter, and a list you will eventually drag out of. Rails cost a quarter of
 * the page width permanently; this costs a corner.
 *
 * Everything here is chrome. What the rows ARE — how they sort, what text they
 * match, how they render, whether they are draggable — belongs to the adapter,
 * so neither program's domain leaks into the other's.
 */
import clsx from 'clsx'
import { CircleCheck, Search, UserRoundSearch, Users, X } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from 'react'

/**
 * One node, two owners: the shell's own click-outside ref and the caller's
 * droppable ref. React 19 can accept an array of refs, but this tree targets
 * the callback form both `useRef` objects and dnd-kit's `setNodeRef` accept.
 */
function mergeRefs<T>(...refs: Array<Ref<T> | undefined>) {
  return (node: T | null) => {
    for (const ref of refs) {
      if (typeof ref === 'function') ref(node)
      else if (ref) (ref as { current: T | null }).current = node
    }
  }
}

export interface FloatingQueueBadgeProps<T> {
  items: T[]
  /** Comparison tokens, most significant first. Compared with localeCompare in order. */
  sortKey: (item: T) => string[]
  getSearchText: (item: T) => string
  /** Given the sorted-and-filtered items, render the list body. */
  renderList: (visible: T[]) => ReactNode
  /** "Unassigned" | "Unplaced" — the header word and half the button title. */
  label: string
  /** "campers" | "families" — the other half, and the no-matches line. */
  noun: string
  /** Clicks on one of these never close the popover: the row was clicked to OPEN something. */
  cardSelector: string
  /** Shown when there is nothing queued at all, as opposed to nothing matching the filter. */
  emptyState: ReactNode
  /**
   * A row of caller-owned controls, rendered under the name search.
   *
   * Chrome only: the shell renders the node and never reads it. What the
   * controls MEAN is the adapter's business, which is why the predicate
   * arrives separately as `itemFilter` — need-based filtering is a weekend
   * concept and a summer camper queue has no `needs_private_bathroom` to
   * offer. Both are optional, so summer passes neither and is unchanged.
   */
  filterRow?: ReactNode
  /**
   * Applied BEFORE the name search; both compose.
   *
   * `| undefined` is explicit because the project builds with
   * `exactOptionalPropertyTypes`: without it a caller cannot pass the
   * "no filter" case through as a variable, only by omitting the prop.
   */
  itemFilter?: ((item: T) => boolean) | undefined
  /** Shown when `itemFilter` hides everything — a different dead end from a name-search miss. */
  filterEmptyState?: ReactNode
  footer?: ReactNode
  isExpanded: boolean
  onToggle: () => void
  onClose: () => void
  isPanelOpen?: boolean
  /**
   * The droppable node, attached to the OUTER container.
   *
   * Deliberately not the list. The list only renders while expanded, and
   * collapsed is the default — so attaching it there left the badge with no
   * droppable node most of the time, and dragging someone onto it silently did
   * nothing. The queue is where you drag a camper to unassign or a family to
   * unplace, so that was the interaction missing, not a decoration.
   */
  dropRef?: Ref<HTMLDivElement>
  isDropTarget?: boolean
}

export function FloatingQueueBadge<T>({
  items,
  sortKey,
  getSearchText,
  renderList,
  label,
  noun,
  cardSelector,
  emptyState,
  filterRow,
  itemFilter,
  filterEmptyState,
  footer,
  isExpanded,
  onToggle,
  onClose,
  isPanelOpen = false,
  dropRef,
  isDropTarget = false,
}: FloatingQueueBadgeProps<T>) {
  const popoverRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [searchTerm, setSearchTerm] = useState('')
  // A whitespace-only term is not a filter — every site below that judges
  // "is a filter active" reads this instead of the raw box contents, so a
  // stray space can't make the count, the list, or the ESC key disagree
  // about whether anything is actually being searched for. The one
  // exception is the inline clear button: it answers "is there text to
  // clear", so it stays keyed to the raw `searchTerm`.
  const trimmedSearchTerm = searchTerm.trim()

  /**
   * THE CARD MUST NOT RESIZE WHEN A GROUP FILTER IS APPLIED.
   *
   * This popover is anchored at the BOTTOM corner and its height is its
   * content's, so a shorter list drops the top edge rather than lifting the
   * bottom one. Measured on a 1080px viewport with 73 unplaced parties: the
   * `Child under 2` filter (4 matches) moved the top edge **217px** and `Power`
   * (5 matches) **124px** — the two cases where the filtered list stops needing
   * a scrollbar. Filters with enough matches to keep overflowing (9 and 13) did
   * not move at all, which is exactly why it reads as intermittent.
   *
   * The fix is the Assign modal's, adapted: it pins its swap region to a
   * constant `h-80` because "a constant height fixes the amount". Here the
   * right constant is not a literal — it is whatever height the UNFILTERED list
   * occupies, which already respects `max-h-[70vh]` and the queue's real
   * length. So measure that, and hold it while a filter narrows the list.
   *
   * Deliberately NOT applied to the name search: typing has always resized the
   * card and nobody has asked for that to change, so this stays scoped to the
   * group filter that introduced the complaint.
   */
  const listRef = useRef<HTMLDivElement>(null)
  const unfilteredListHeight = useRef<number | null>(null)
  const isGroupFiltered = itemFilter !== undefined

  const visible = useMemo(() => {
    const sorted = items.toSorted((a, b) => {
      const left = sortKey(a)
      const right = sortKey(b)
      for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
        const compared = (left[i] ?? '').localeCompare(right[i] ?? '')
        if (compared !== 0) return compared
      }
      return 0
    })

    const grouped = itemFilter ? sorted.filter((item) => itemFilter(item)) : sorted

    if (!trimmedSearchTerm) return grouped
    const term = trimmedSearchTerm.toLowerCase()
    return grouped.filter((item) => getSearchText(item).toLowerCase().includes(term))
  }, [items, trimmedSearchTerm, sortKey, getSearchText, itemFilter])

  // Record the unfiltered height so the next render CAN pin it. `useLayoutEffect`
  // because a `useEffect` would measure a frame late and let the jump paint once.
  useLayoutEffect(() => {
    if (!isExpanded) {
      unfilteredListHeight.current = null
      return
    }
    if (isGroupFiltered) return
    const element = listRef.current
    if (element) unfilteredListHeight.current = element.clientHeight
  }, [isExpanded, isGroupFiltered, items, trimmedSearchTerm])

  const handleClickOutside = useCallback(
    (event: MouseEvent) => {
      const target = event.target as HTMLElement

      // Never close when a row is clicked — it was clicked to open something.
      if (target.closest(cardSelector)) return

      if (
        isExpanded &&
        !isPanelOpen && // The panel was opened from this list; leave the list up beside it.
        popoverRef.current &&
        !popoverRef.current.contains(target)
      ) {
        onClose()
      }
    },
    [cardSelector, isExpanded, isPanelOpen, onClose]
  )

  // ESC clears an active filter first, and only closes on the second press.
  //
  // CORRECT AS-IS, no overlay token (kindred#2237). Another CONTAINER: the
  // expanded queue is never the overlay ON TOP. The two things that stack
  // above it both hold tokens now -- the `CamperCard` context menu opened from
  // a row in this very list, and the `CamperDetailsPanel` that `isPanelOpen`
  // deliberately keeps this list open beside -- and each swallows Escape in
  // the document capture phase while topmost, before this bubble listener
  // runs. The double-close this badge was part of (menu open inside the queue,
  // one press dismissed the menu AND collapsed the queue) is fixed from the
  // card's side.
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isExpanded) {
        if (trimmedSearchTerm) setSearchTerm('')
        else onClose()
      }
    },
    [isExpanded, onClose, trimmedSearchTerm]
  )

  useEffect(() => {
    if (isExpanded) {
      document.addEventListener('mousedown', handleClickOutside)
      document.addEventListener('keydown', handleKeyDown)
      requestAnimationFrame(() => searchInputRef.current?.focus())
    } else {
      setSearchTerm('')
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isExpanded, handleClickOutside, handleKeyDown])

  return (
    <div
      data-floating-badge
      className="fixed right-6 bottom-14 z-[70] transition-transform duration-300"
      style={{ transform: isPanelOpen ? 'translateX(-28.5rem)' : 'none' }}
      ref={mergeRefs(popoverRef, dropRef)}
    >
      {!isExpanded && (
        <button
          onClick={onToggle}
          className={clsx(
            'shadow-lodge-lg relative flex h-14 w-14 items-center justify-center rounded-full transition-all',
            'hover:shadow-lodge-xl hover:scale-105 active:scale-95',
            'bg-primary text-primary-foreground border-primary-foreground/20 border-2'
          )}
          title={`${String(items.length)} ${label.toLowerCase()} ${noun}`}
          // Without this the accessible name is just the count badge's digits —
          // a button called "3". The title alone does not supply it: for a
          // button, content wins over title.
          aria-label={`${String(items.length)} ${label.toLowerCase()} ${noun}`}
        >
          {items.length > 0 ? (
            <>
              <UserRoundSearch className="h-6 w-6" />
              <span className="bg-accent text-accent-foreground absolute -top-1 -right-1 flex h-[22px] min-w-[22px] items-center justify-center rounded-full px-1 text-xs font-bold shadow-md">
                {items.length > 99 ? '99+' : items.length}
              </span>
            </>
          ) : (
            <CircleCheck className="h-6 w-6" />
          )}
        </button>
      )}

      {isExpanded && (
        <div
          className={clsx(
            'card-lodge shadow-lodge-xl animate-scale-in flex max-h-[70vh] w-80 max-w-[calc(100vw-3rem)] flex-col',
            'border-2',
            isDropTarget ? 'border-primary' : 'border-border'
          )}
        >
          <div className="border-border bg-muted/30 flex flex-shrink-0 items-center justify-between border-b px-4 py-3">
            <div className="flex items-center gap-2">
              <Users className="text-muted-foreground h-5 w-5" />
              <span className="font-semibold">
                {label}
                <span className="text-muted-foreground ml-1.5 text-sm font-normal">
                  (
                  <span>
                    {trimmedSearchTerm || itemFilter
                      ? `${String(visible.length)}/${String(items.length)}`
                      : items.length}
                  </span>
                  )
                </span>
              </span>
            </div>
            <button
              onClick={onClose}
              className="hover:bg-muted rounded-lg p-1.5 transition-colors"
              title="Close"
            >
              <X className="text-muted-foreground h-4 w-4" />
            </button>
          </div>

          {items.length > 0 && (
            <div className="border-border flex-shrink-0 border-b px-3 py-2">
              <div className="relative">
                <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchTerm}
                  onChange={(e) => {
                    setSearchTerm(e.target.value)
                  }}
                  placeholder="Filter by name..."
                  className="bg-background border-border focus:ring-primary/40 focus:border-primary w-full rounded-lg border py-1.5 pr-7 pl-8 text-sm focus:ring-2 focus:outline-none"
                />
                {searchTerm && (
                  <button
                    onClick={() => {
                      setSearchTerm('')
                      searchInputRef.current?.focus()
                    }}
                    className="hover:bg-muted absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-0.5"
                    title="Clear"
                  >
                    <X className="text-muted-foreground h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          )}

          {items.length > 0 && filterRow !== undefined && (
            <div className="border-border flex-shrink-0 border-b px-3 py-2">{filterRow}</div>
          )}

          <div
            ref={listRef}
            // The pin is a FLOOR, never a cap, and it is only ever a height this
            // same list already occupied at this viewport — so it cannot push
            // the card past `max-h-[70vh]`. A mid-filter viewport change
            // self-corrects on the next unfiltered render.
            style={
              isGroupFiltered && unfilteredListHeight.current !== null
                ? { minHeight: unfilteredListHeight.current }
                : undefined
            }
            className={clsx(
              'min-h-[200px] flex-1 overflow-y-auto p-3',
              isDropTarget && 'bg-primary/5'
            )}
          >
            {items.length === 0 ? (
              emptyState
            ) : visible.length === 0 && trimmedSearchTerm ? (
              <div className="flex h-full flex-col items-center justify-center py-8 text-center">
                <p className="text-muted-foreground text-sm">
                  No {noun} match "{trimmedSearchTerm}"
                </p>
              </div>
            ) : visible.length === 0 ? (
              filterEmptyState
            ) : (
              renderList(visible)
            )}
          </div>

          {items.length > 0 && footer !== undefined && (
            <div className="border-border bg-accent/10 flex-shrink-0 border-t px-3 py-2">
              {footer}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
