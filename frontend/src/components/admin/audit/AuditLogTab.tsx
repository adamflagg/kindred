/**
 * Manage > Audit Log (admin only): who did what to whose access, to the app's
 * settings, or behind the app, and when (spec 2026-09-26-admin-audit-log-design
 * §6, mockup v8 minus its "Mockup controls" rail).
 *
 * Filters and the page live in the URL. Sentences are built on the client from
 * the structured entry (auditSentences.ts). No expandable rows: hovering the
 * time shows the full date, seconds and IP.
 */
import { Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'

import { useAuditLog, useAuditLogActors } from '../../../hooks/useAuditLog'
import {
  AUDIT_FILTER_TYPES,
  AUDIT_PER_PAGE_OPTIONS,
  type AuditEntry,
  type AuditFilterType,
  type AuditPerPage,
  type AuditQuery,
} from '../../../types/auditLog'
import { QueryGuard } from '../../QueryGuard'
import { Pagination } from '../../ui/Pagination'
import {
  CHIP,
  GROUP,
  GROUP_BUTTON_OFF,
  GROUP_BUTTON_ON,
  MONO_NOTE,
  NEW_VALUE,
  OLD_VALUE,
  PERSON_SELECT,
  ROW,
  SEARCH_INPUT,
  TABLE_CARD,
  TD,
  TH,
  TOOLBAR,
  TYPE_PILL,
} from './auditStyles'
import {
  TYPE_LABEL,
  actorLabel,
  describeEntry,
  fieldChanges,
  firstText,
  whenLabel,
  whenTitle,
  type SentencePart,
} from './auditSentences'
import { parseAuditQuery, selectType, serializeAuditQuery, updateAuditQuery } from './auditUrlState'

/** Fields shown inline before "show all N" (spec §6). */
const INLINE_FIELDS = 3
const SEARCH_DEBOUNCE_MS = 300

function Sentence({ parts }: { parts: SentencePart[] }) {
  return (
    <>
      {parts.map((part, i) => {
        const key = `${String(i)}-${part.kind}`
        switch (part.kind) {
          case 'strong':
            return <b key={key}>{part.text}</b>
          case 'chip':
            return (
              <span key={key} className={CHIP}>
                {part.text}
              </span>
            )
          case 'mono':
            return (
              <span key={key} className="font-mono text-xs">
                {part.text}
              </span>
            )
          default:
            return <span key={key}>{part.text}</span>
        }
      })}
    </>
  )
}

function Value({ value, className }: { value: string | null; className: string }) {
  return value === null ? (
    <span className="text-muted-foreground">—</span>
  ) : (
    <span className={className}>{value}</span>
  )
}

/** The Before and After cells: up to three fields inline, then "show all N". */
function BeforeAfterCells({
  entry,
  expanded,
  onExpand,
}: {
  entry: AuditEntry
  expanded: boolean
  onExpand: () => void
}) {
  const changes = fieldChanges(entry)
  if (changes.length === 0) {
    return (
      <>
        <td className={`${TD} text-muted-foreground text-sm`}>—</td>
        <td className={`${TD} text-muted-foreground text-sm`}>—</td>
      </>
    )
  }
  const shown = expanded ? changes : changes.slice(0, INLINE_FIELDS)
  // A single field shows its name only on PB Admin rows, where the collection is arbitrary.
  const labelled = changes.length > 1 || entry.type === 'pb_admin'
  const side = (which: 'before' | 'after') =>
    shown.map((change) => (
      <div key={change.field} className="leading-snug">
        {labelled && <span className={`${MONO_NOTE} mr-1`}>{change.field}</span>}
        <Value value={change[which]} className={which === 'before' ? OLD_VALUE : NEW_VALUE} />
      </div>
    ))
  return (
    <>
      <td className={`${TD} text-sm`}>
        {side('before')}
        {!expanded && changes.length > INLINE_FIELDS && (
          <button type="button" onClick={onExpand} className="text-primary text-xs hover:underline">
            show all {changes.length}
          </button>
        )}
      </td>
      <td className={`${TD} text-sm`}>{side('after')}</td>
    </>
  )
}

function AuditRow({ entry }: { entry: AuditEntry }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <tr className={ROW} data-testid="audit-row">
      <td
        className={`${TD} text-muted-foreground cursor-help whitespace-nowrap tabular-nums`}
        title={whenTitle(entry)}
      >
        {whenLabel(entry.created)}
      </td>
      <td className={TD}>{actorLabel(entry)}</td>
      <td className={TD}>
        <span className={TYPE_PILL[entry.type]}>{TYPE_LABEL[entry.type]}</span>
      </td>
      <td className={TD}>
        <Sentence parts={describeEntry(entry)} />
        {entry.type === 'pb_admin' && entry.collection && (
          <div className={MONO_NOTE}>
            {entry.collection} {entry.record_id}
          </div>
        )}
      </td>
      <BeforeAfterCells entry={entry} expanded={expanded} onExpand={() => setExpanded(true)} />
    </tr>
  )
}

export function AuditLogTab() {
  const [params, setParams] = useSearchParams()
  const query = parseAuditQuery(params)
  const [search, setSearch] = useState(query.q)
  // The URL can move under the box (back button, a pasted link): follow it.
  // Adjusted during render, React's pattern for state derived from a prop.
  const [urlQ, setUrlQ] = useState(query.q)
  if (query.q !== urlQ) {
    setUrlQ(query.q)
    setSearch(query.q)
  }

  const apply = (change: Partial<AuditQuery>) =>
    setParams(serializeAuditQuery(updateAuditQuery(query, change)))

  // The box writes the URL once typing pauses, replacing the history entry so
  // Back is not one step per keystroke.
  useEffect(() => {
    if (search === urlQ) return
    const timer = setTimeout(() => {
      setParams(
        (current) => serializeAuditQuery(updateAuditQuery(parseAuditQuery(current), { q: search })),
        { replace: true }
      )
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [search, urlQ, setParams])

  const log = useAuditLog(query)
  const actors = useAuditLogActors()
  const typeButtons: Array<AuditFilterType | 'all'> = ['all', ...AUDIT_FILTER_TYPES]
  const activeType =
    query.types.length === 1 ? query.types[0] : query.types.length === 0 ? 'all' : null

  return (
    <div className="space-y-2">
      <div className={TOOLBAR}>
        <div className="relative min-w-[220px] flex-1">
          <Search className="text-muted-foreground absolute top-2.5 left-3 h-4 w-4" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search a person, role, collection, record id or field…"
            className={SEARCH_INPUT}
          />
        </div>
        <div className={GROUP}>
          {typeButtons.map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => apply({ types: selectType(type) })}
              className={activeType === type ? GROUP_BUTTON_ON : GROUP_BUTTON_OFF}
            >
              {type === 'all' ? 'All' : TYPE_LABEL[type]}
            </button>
          ))}
        </div>
        <select
          aria-label="Person"
          value={query.actor}
          onChange={(e) => apply({ actor: e.target.value })}
          className={PERSON_SELECT}
        >
          <option value="">Anyone</option>
          {(actors.data?.actors ?? []).map((a) => (
            <option key={a.email} value={a.email}>
              {firstText(a.name, a.email)}
            </option>
          ))}
        </select>
        <div className={GROUP}>
          <button
            type="button"
            title="Include sign-ins"
            onClick={() => apply({ signIns: !query.signIns })}
            className={query.signIns ? GROUP_BUTTON_ON : GROUP_BUTTON_OFF}
          >
            Sign-ins
          </button>
        </div>
      </div>
      <p className="text-muted-foreground px-0.5 text-xs">
        Search matches who did it, who or what it was done to (name or email), role names,
        collection names, record ids and field names. It doesn&apos;t search the before/after
        values.
      </p>

      <QueryGuard isLoading={log.isLoading} error={log.error} data={log.data} label="audit log">
        {(page) => (
          <>
            <div className="text-muted-foreground flex justify-between px-0.5 pt-2 text-sm">
              <span>
                {page.total} event{page.total === 1 ? '' : 's'}
              </span>
              <span>Admins only · entries can&apos;t be edited or deleted</span>
            </div>
            <div className={TABLE_CARD}>
              {page.items.length === 0 ? (
                <div className="text-muted-foreground p-10 text-center">No events match.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className={`${TH} w-[130px]`}>When</th>
                        <th className={`${TH} w-[140px]`}>Who</th>
                        <th className={`${TH} w-[100px]`}>Type</th>
                        <th className={TH}>What happened</th>
                        <th className={`${TH} w-[190px]`}>Before</th>
                        <th className={`${TH} w-[190px]`}>After</th>
                      </tr>
                    </thead>
                    <tbody>
                      {page.items.map((entry) => (
                        <AuditRow key={entry.id} entry={entry} />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <Pagination
                page={query.page}
                perPage={query.perPage}
                total={page.total}
                perPageOptions={AUDIT_PER_PAGE_OPTIONS}
                previousLabel="← Newer"
                nextLabel="Older →"
                onPageChange={(p) => apply({ page: p })}
                onPerPageChange={(n) => apply({ perPage: n as AuditPerPage })}
              />
            </div>
          </>
        )}
      </QueryGuard>
    </div>
  )
}
