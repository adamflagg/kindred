import type { ApiAidScenarioOption } from '../../../../types/api-types'
import { campToday, formatShortDate } from '../../kit/dates'
import { keptGroups } from './scenarioModel'

const CODE =
  'bg-muted inline-flex min-w-8 justify-center rounded px-1.5 font-mono text-xs font-bold'

function Row({
  option,
  current,
  onLoad,
  compare,
}: {
  option: ApiAidScenarioOption
  current: boolean
  onLoad: (code: string) => void
  compare: { readonly ticked: boolean; readonly onToggle: (code: string) => void } | undefined
}) {
  return (
    <div
      className={`flex items-start gap-2 px-3 py-1 ${current ? 'bg-muted' : ''}`}
      data-kept={option.code}
    >
      {compare && (
        <input
          type="checkbox"
          aria-label={`Compare ${option.code}`}
          checked={compare.ticked}
          onChange={() => compare.onToggle(option.code)}
        />
      )}
      <button
        type="button"
        className="flex flex-1 items-start gap-2 text-left hover:underline"
        onClick={() => onLoad(option.code)}
      >
        <span className={CODE}>{option.code}</span>
        <span className="flex-1 text-sm">
          {option.label}
          <span className="text-muted-foreground block text-xs">
            {`kept by ${option.kept_by}, ${formatShortDate(campToday(new Date(option.kept_at)))}`}
            {option.stale ? ' · figures from an older snapshot' : ''}
          </span>
        </span>
      </button>
    </div>
  )
}

/**
 * Kept options, locked (spec §7.4; D36, D38): starting points (A, B…) and their variants (A1, B2…)
 * under them, never deeper. A click loads one into your draft; loading is recorded, so it never asks
 * to discard anything. Each label is only what differs from its starting point (D36).
 */
export function KeptList({
  options,
  current,
  onLoad,
  compare,
}: {
  options: readonly ApiAidScenarioOption[]
  /** The kept option the draft comes from. */
  current: string | null
  onLoad: (code: string) => void
  /** Ticking kept options to compare beside the draft, up to four (D38). */
  compare?:
    { readonly ticked: ReadonlySet<string>; readonly onToggle: (code: string) => void } | undefined
}) {
  const groups = keptGroups(options)
  if (groups.length === 0) {
    return <p className="text-muted-foreground px-3 py-2 text-sm">Nothing kept yet.</p>
  }
  const tick = (code: string) =>
    compare === undefined
      ? undefined
      : { ticked: compare.ticked.has(code), onToggle: compare.onToggle }
  return (
    <div className="py-1" data-testid="kept-list">
      {groups.map((group) => (
        <div key={group.start.code}>
          <Row
            option={group.start}
            current={group.start.code === current}
            onLoad={onLoad}
            compare={tick(group.start.code)}
          />
          <div className="pl-5">
            {group.variants.map((variant) => (
              <Row
                key={variant.code}
                option={variant}
                current={variant.code === current}
                onLoad={onLoad}
                compare={tick(variant.code)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
