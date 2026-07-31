/**
 * Family Camp lodging settings.
 *
 * The lodging registry is seeded from the camp map, but every row is editable
 * here: a seed nobody can correct is worthless (spec §3.8). Nothing in it lives
 * in source code — not the area list, the unit list, the alias mapping, the
 * parent relations, the staff-default flags, or any amenity.
 */
import { Link, useParams } from 'react-router'

import { LodgingAliasesPanel } from './LodgingAliasesPanel'
import { LodgingAreasPanel } from './LodgingAreasPanel'
import { LodgingUnitsPanel } from './LodgingUnitsPanel'
import { UnresolvedAliasQueue } from './UnresolvedAliasQueue'

const SECTIONS = [
  { id: 'units', label: 'Units' },
  { id: 'areas', label: 'Areas' },
  { id: 'aliases', label: 'Cabin name aliases' },
  { id: 'unresolved', label: 'Unresolved names' },
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
      <nav className="flex flex-wrap gap-2" aria-label="Lodging settings sections">
        {SECTIONS.map((entry) => (
          <Link
            key={entry.id}
            to={`/admin/lodging/${entry.id}`}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              entry.id === active
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-muted/50'
            }`}
          >
            {entry.label}
          </Link>
        ))}
      </nav>

      {active === 'units' && <LodgingUnitsPanel />}
      {active === 'areas' && <LodgingAreasPanel />}
      {active === 'aliases' && <LodgingAliasesPanel />}
      {active === 'unresolved' && <UnresolvedAliasQueue />}
    </div>
  )
}
