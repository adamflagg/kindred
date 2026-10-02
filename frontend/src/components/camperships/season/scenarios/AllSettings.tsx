import type { ApiAidRulesSection, ApiAidScenarioDraft } from '../../../../types/api-types'
import { PILL } from '../../kit/kitStyles'
import { sectionContent } from '../rules/rulesDraft'
import { MONEY_SECTIONS, SEASON_SECTIONS, SECTION_TITLES } from '../rules/rulesModel'
import { SectionEditor } from '../rules/SectionEditor'

const GROUPS: ReadonlyArray<{ title: string; sections: readonly ApiAidRulesSection[] }> = [
  { title: 'Settings that move the money', sections: MONEY_SECTIONS },
  { title: 'Settings that describe the season', sections: SEASON_SECTIONS },
]

/** The sections the draft changed against its starting point (the server's `changes`, whole-document paths). */
function changedSections(draft: ApiAidScenarioDraft): ReadonlySet<string> {
  return new Set(draft.changes.map((change) => change.path[0] ?? ''))
}

/**
 * "All settings" (spec §7.5; D39: one editor per section, two homes): the same section editors as the
 * Rules tab, against your scenario draft. Each says it edits the draft, not the rules; a save records
 * the draft with that section replaced, a trail row like any release. Nothing reaches the rules until
 * a kept option is made the rules draft.
 */
export function AllSettings({
  draft,
  open,
  busy,
  held,
  error,
  onOpen,
  onSave,
}: {
  draft: ApiAidScenarioDraft
  open: ApiAidRulesSection | null
  busy: boolean
  /** A slider is moving: Save waits until it is let go (as Keep does), or it would record under it. */
  held: boolean
  error: string | null
  onOpen: (section: ApiAidRulesSection | null) => void
  onSave: (section: ApiAidRulesSection, content: Record<string, unknown>) => void
}) {
  const changed = changedSections(draft)
  return (
    <div className="card-lodge space-y-2 px-3 py-2" data-testid="all-settings">
      <div className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
        All settings, in your draft
      </div>
      {/* Decision 15: while a section holds typing the list stands still; Cancel is the way out. */}
      {open !== null && (
        <p className="text-muted-foreground text-xs">Save or cancel the edit first.</p>
      )}
      {GROUPS.map((group) => (
        <div key={group.title} className="text-sm">
          <div className="text-muted-foreground text-xs">{group.title}</div>
          {group.sections.map((section) => (
            <button
              key={section}
              type="button"
              disabled={open !== null}
              className={`flex w-full items-center gap-2 py-0.5 text-left enabled:hover:underline disabled:opacity-50 ${section === open ? 'font-semibold' : ''}`}
              onClick={() => onOpen(section)}
            >
              {SECTION_TITLES[section]}
              {changed.has(section) && <span className={PILL.amber}>changed in your draft</span>}
            </button>
          ))}
        </div>
      ))}
      {open !== null && (
        <SectionEditor
          key={open}
          opened={sectionContent(draft.document, open)}
          heading={`Editing ${SECTION_TITLES[open]} in your scenario draft (from ${draft.from_code}), not the rules`}
          saving={busy}
          canSave={!held}
          error={error}
          onSave={(content) => onSave(open, content)}
          onCancel={() => onOpen(null)}
        />
      )}
    </div>
  )
}
