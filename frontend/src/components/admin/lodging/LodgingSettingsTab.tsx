/**
 * Family Camp lodging settings.
 *
 * The lodging registry is seeded from the camp map, but every row is editable
 * here: a seed nobody can correct is worthless (spec §3.8). Nothing in it lives
 * in source code — not the area list, the unit list, the alias mapping, the
 * parent relations, the staff-default flags, or any amenity.
 */
import {
  AlertCircle,
  Ban,
  BedDouble,
  CalendarCheck,
  CalendarPlus,
  ClipboardList,
  Link2,
} from 'lucide-react'
import { Link, useParams } from 'react-router'

import { CabinWeekendsQueue } from './CabinWeekendsQueue'
import { JotformPanel } from './JotformPanel'
import { LodgingAliasesPanel } from './LodgingAliasesPanel'
import { LodgingUnitsPanel } from './LodgingUnitsPanel'
import { TAB_NAV, TAB_PILL_ACTIVE, TAB_PILL_IDLE } from './lodgingStyles'
import { SeasonRollForwardPanel } from './SeasonRollForwardPanel'
import { UnresolvedAliasQueue } from './UnresolvedAliasQueue'
import { WeekendStatusPanel } from './WeekendStatusPanel'

// The summer session view's tab grammar (`SessionTabs`), not a second one.
// An icon per section for the same reason it has them: seven pills of similar
// length are hard to reacquire after looking away at a 93-row table.
//
// `status` is here rather than on the weekend lander because every other
// season-grain fact is edited on this screen, behind the route's single
// `bunking.manage` gate — the lander badges a cancelled weekend and never sets
// it (kindred#2092).
const SECTIONS = [
  { id: 'units', label: 'Units', icon: BedDouble },
  { id: 'aliases', label: 'Cabin name aliases', icon: Link2 },
  { id: 'unresolved', label: 'Unresolved names', icon: AlertCircle },
  // kindred#2648 UI half. Which weekend an ambiguous CampMinder cabin value
  // belongs to — distinct from `unresolved` above (which unit a raw string
  // means) and from `status` below (whether a weekend is running at all).
  { id: 'attribution', label: 'Cabin Weekends', icon: CalendarCheck },
  { id: 'season', label: 'Season', icon: CalendarPlus },
  { id: 'status', label: 'Weekend status', icon: Ban },
  // kindred#2759: adult-weekend Jotform forms, the pull, and the unmatched queue.
  { id: 'jotform', label: 'Jotform', icon: ClipboardList },
] as const

type SectionId = (typeof SECTIONS)[number]['id']

function isSectionId(value: string | undefined): value is SectionId {
  return SECTIONS.some((section) => section.id === value)
}

export function LodgingSettingsTab() {
  const { section } = useParams<{ section?: string }>()
  // An unknown section falls back to units rather than rendering an empty
  // page — a mistyped URL should not look like a broken feature.
  const active: SectionId = isSectionId(section) ? section : 'units'

  return (
    <div className="flex flex-col gap-4">
      <nav className={TAB_NAV} aria-label="Lodging settings sections">
        <div className="flex flex-wrap items-center gap-1.5">
          {SECTIONS.map((entry) => {
            const Icon = entry.icon
            const isActive = entry.id === active
            return (
              <Link
                key={entry.id}
                to={`/manage/lodging/${entry.id}`}
                aria-current={isActive ? 'page' : undefined}
                className={isActive ? TAB_PILL_ACTIVE : TAB_PILL_IDLE}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                <span>{entry.label}</span>
              </Link>
            )
          })}
        </div>
      </nav>

      {active === 'units' && <LodgingUnitsPanel />}
      {active === 'aliases' && <LodgingAliasesPanel />}
      {active === 'unresolved' && <UnresolvedAliasQueue />}
      {active === 'attribution' && <CabinWeekendsQueue />}
      {active === 'season' && <SeasonRollForwardPanel />}
      {active === 'status' && <WeekendStatusPanel />}
      {active === 'jotform' && <JotformPanel />}
    </div>
  )
}
