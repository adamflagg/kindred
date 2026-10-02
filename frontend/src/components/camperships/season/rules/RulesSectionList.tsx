import { Link } from 'react-router'

import type { ApiAidRulesSection } from '../../../../types/api-types'
import { PILL } from '../../kit/kitStyles'
import { MONEY_SECTIONS, SEASON_SECTIONS, SECTION_TITLES, type StatusWords } from './rulesModel'

export interface SectionItem {
  readonly section: ApiAidRulesSection
  readonly status: StatusWords
  /** "1 error · 2 warnings", or null. */
  readonly issues: string | null
}

const GROUPS: ReadonlyArray<{ title: string; sections: readonly ApiAidRulesSection[] }> = [
  { title: 'Settings that move the money', sections: MONEY_SECTIONS },
  { title: 'Settings that describe the season', sections: SEASON_SECTIONS },
]

/**
 * The rules document by section (spec §7.5; D39; rules.html A): money settings, then the season's
 * description, each with its status, who and when. A section is a link (`?section=`), so a pasted
 * link opens on it (D15).
 */
export function RulesSectionList({
  items,
  selected,
  hrefOf,
}: {
  items: readonly SectionItem[]
  selected: ApiAidRulesSection
  hrefOf: (section: ApiAidRulesSection) => string
}) {
  return (
    <nav className="card-lodge divide-border divide-y text-sm">
      {GROUPS.map((group) => (
        <div key={group.title} className="py-1">
          <div className="text-muted-foreground px-3 pt-1 text-xs font-semibold tracking-wide uppercase">
            {group.title}
          </div>
          {group.sections.map((section) => {
            const item = items.find((i) => i.section === section)
            if (item === undefined) return null
            return (
              <Link
                key={section}
                to={hrefOf(section)}
                replace
                data-rules-section={section}
                className={`hover:bg-muted/50 block px-3 py-1.5 ${section === selected ? 'bg-muted font-semibold' : ''}`}
              >
                <span className="flex flex-wrap items-center gap-2">
                  <span>{SECTION_TITLES[section]}</span>
                  <span className={PILL[item.status.tone]}>{item.status.pill}</span>
                </span>
                {(item.status.meta !== '' || item.issues !== null) && (
                  <span className="text-muted-foreground block text-xs font-normal">
                    {[item.status.meta, item.issues].filter(Boolean).join(' · ')}
                  </span>
                )}
              </Link>
            )
          })}
        </div>
      ))}
    </nav>
  )
}
