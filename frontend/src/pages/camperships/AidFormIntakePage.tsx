import { ListChecks } from 'lucide-react'
import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router'

import { QueryGuard } from '../../components/QueryGuard'
import { AddRequestEditor } from '../../components/camperships/intake/AddRequestEditor'
import {
  formChangeToReview,
  gridCounts,
  gridRows,
  GRID_SEGMENTS,
  inGridChip,
  inGridSegment,
  lastReadWords,
  PULLED_WORDS,
  readGridSegment,
  refusedBand,
  type GridSegment,
  type IntakeGridRow,
} from '../../components/camperships/intake/adultFormModel'
import { FindUnlistedPanel } from '../../components/camperships/intake/FindUnlistedPanel'
import { IgnoreResponseEditor } from '../../components/camperships/intake/IgnoreResponseEditor'
import { LinkResponsePanel } from '../../components/camperships/intake/LinkResponsePanel'
import {
  IntakeTable,
  type IntakeMarks,
  type RowActionOf,
} from '../../components/camperships/intake/IntakeTable'
import {
  camperLabel,
  defaultSegment,
  fullName,
  sessionIndex,
  targetFromRow,
  unreviewed,
} from '../../components/camperships/intake/intakeModel'
import type {
  FormIntakeResponse,
  FormIntakeRowOut,
} from '../../components/camperships/intake/intakeTypes'
import { aidHref, type AidAsOf, type AidView } from '../../components/camperships/kit/asOf'
import {
  CS_BTN2,
  CS_LINK_SM,
  CS_POPEN_META,
  CS_SMALL,
} from '../../components/camperships/kit/csType'
import { AidSegmented } from '../../components/camperships/kit/Segmented'
import { keepInView } from '../../components/camperships/kit/table'
import { AidFilterChip } from '../../components/camperships/kit/Toolbar'
import { useKeptRows } from '../../components/camperships/kit/useKeptRows'
import type { RequestsStatus } from '../../components/camperships/requests/requestsStatus'
import { StatusSlot } from '../../components/camperships/requests/StatusSlot'
import { AidDefinitionNotes } from '../../components/camperships/shell/AidDefinitionNotes'
import { AidPageBand } from '../../components/camperships/shell/AidPageBand'
import { AidPageHead } from '../../components/camperships/shell/AidPageHead'
import { Permission } from '../../constants/permissions'
import { useAidDefinitions } from '../../hooks/camperships/useAidDefinitions'
import {
  useAidIgnoreResponse,
  useAidLinkResponse,
  useAidPullForm,
  useAidReviewFormChange,
} from '../../hooks/camperships/useAidFormResponses'
import { useAidIntakeForms } from '../../hooks/camperships/useAidIntake'
import { useAidReviewAddition } from '../../hooks/camperships/useAidIntakeWrites'
import { useAidProgramNames } from '../../hooks/camperships/useAidProgramNames'
import { usePermissions } from '../../hooks/usePermissions'
import { useYear } from '../../hooks/useCurrentYear'

/** Form intake is today's: its reads take no as-of, so the band says live. */
const LIVE: AidAsOf = { kind: 'live' }
export const SURFACE = 'requests-form-intake'
const CHIP_TITLE =
  'You came from Season\'s "CampMinder aid on no request" line: this list shows only the families it counts. ✕ shows every row.'

/** The editor a row's action opened, by the grid row's key. */
interface Editing {
  readonly key: string
  readonly kind: 'add' | 'link' | 'ignore'
}
const CSV_NAMES: Readonly<Record<GridSegment, string>> = {
  look: 'needs-a-look',
  link: 'responses-to-link',
  reg: 'registration-ask-only',
  all: 'all-forms',
}

const ok = (text: string): RequestsStatus => ({ text, title: text, tone: 'ok', dismiss: 'result' })
const warn = (text: string): RequestsStatus => ({
  text,
  title: text,
  tone: 'warn',
  dismiss: 'result',
})

function GrantsLine({ count, view }: { count: number; view: AidView }) {
  if (count === 0) return null
  return (
    <p className={`${CS_SMALL} mt-1`}>
      {`${String(count)} outside ${count === 1 ? 'grant waits' : 'grants wait'} for a camper → `}
      <Link
        to={aidHref('/aid/money/to-place', view)}
        className={CS_LINK_SM}
        title="Open Money › To place: the outside grants posted to a family that wait for a camper"
      >
        Money › To place
      </Link>
    </p>
  )
}

function IntakeBody({ data, view }: { data: FormIntakeResponse; view: AidView }) {
  const [params, setParams] = useSearchParams()
  // CLOSED-SEASONS-DONE (owner ruling NG-01): a closed season's forms are history. It opens on All forms (CSD-6),
  // offers no action and no Find a Camper Not Listed…, and draws CampMinder's aid in plain ink.
  const closed = data.season_done === true
  const segment = readGridSegment(params.get('show'), closed)
  const cmaidOnly = params.get('cmaid') === '1'
  const { hasPermission } = usePermissions()
  const canWork = hasPermission(Permission.FINANCIAL_AID_CASEWORK) && !closed
  const programs = useAidProgramNames()
  const names = useMemo(() => sessionIndex(data.sessions), [data.sessions])
  const definitions = useAidDefinitions(SURFACE)
  const { entries, numberOf } = definitions
  const marks = useMemo((): IntakeMarks => {
    const mark = (key: string) => {
      const n = numberOf(key)
      return n === null ? undefined : { n, title: entries.find((e) => e.key === key)?.text }
    }
    return {
      asked: mark('intake_form_asked'),
      became: mark('intake_became'),
      campminder: mark('intake_campminder_aid'),
    }
    // `numberOf` is rebuilt each render; `entries` changes exactly when it does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries])

  const [highlighted, setHighlighted] = useState<string | null>(null)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [finding, setFinding] = useState(false)
  const [status, setStatus] = useState<RequestsStatus | null>(null)
  const { kept, keep } = useKeptRows(`${String(view.year)}:${segment}:${cmaidOnly ? 'cmaid' : ''}`)

  // Every Form intake row, then a row per live adult aid form response no person holds (mock v2).
  const grid = useMemo(
    () => gridRows(data.rows, data.form_responses ?? []),
    [data.rows, data.form_responses]
  )
  const chipped = useMemo(() => grid.filter((r) => inGridChip(r, cmaidOnly)), [grid, cmaidOnly])
  const shown = useMemo(
    () =>
      keepInView(
        chipped,
        (r) => inGridSegment(r, segment),
        kept,
        (r) => r.key
      ),
    [chipped, segment, kept]
  )
  const counts = useMemo(() => gridCounts(grid, cmaidOnly), [grid, cmaidOnly])
  const googleForm = data.google_form ?? null
  const lastRead = useMemo(() => lastReadWords(googleForm), [googleForm])
  const band = useMemo(() => refusedBand(googleForm), [googleForm])

  const setParam = (name: string, value: string | null) => {
    const next = new URLSearchParams(params)
    if (value === null) next.delete(name)
    else next.set(name, value)
    setParams(next, { replace: true })
  }
  const changeSegment = (value: GridSegment) => {
    setHighlighted(null)
    setEditing(null)
    setParam('show', value === defaultSegment(closed) ? null : value)
  }

  const review = useAidReviewAddition()
  const reviewChange = useAidReviewFormChange()
  const linkWrite = useAidLinkResponse()
  const ignoreWrite = useAidIgnoreResponse()
  const pull = useAidPullForm()
  const onHighlight = useCallback((key: string | null) => {
    setHighlighted(key)
    setEditing((now) => (now?.key === key ? now : null))
  }, [])
  const onAdded = useCallback(
    (row: FormIntakeRowOut, words: string) => {
      keep(row.key)
      setHighlighted(row.key)
      setEditing(null)
      setFinding(false)
      setStatus(ok(words))
    },
    [keep]
  )
  const onCancelEdit = useCallback(() => setEditing(null), [])
  const open = useCallback((key: string, kind: Editing['kind']) => {
    setStatus(null)
    setFinding(false)
    setEditing({ key, kind })
  }, [])

  const actionOf = useMemo((): RowActionOf | null => {
    if (!canWork) return null
    return (g) => {
      if (g.kind === 'response') {
        const r = g.response
        const link = {
          label: 'Link…',
          title: `Link “${r.name_typed ?? ''}”'s response to a registered person`,
          onClick: () => open(g.key, 'link'),
        }
        if (r.match_status === 'ignored')
          return { ...link, title: 'Link the ignored response to a person: it undoes the ignore' }
        if (r.to_link !== true) return null
        return [
          link,
          {
            label: 'Ignore…',
            title: `Ignore “${r.name_typed ?? ''}”'s response: a test, a duplicate or junk. Never matched again`,
            onClick: () => open(g.key, 'ignore'),
          },
        ]
      }
      const r = g.row
      if (r.can_add === true && (r.gap_sessions ?? []).length > 0)
        return {
          label: 'Add a Request…',
          title: `Add a request for ${camperLabel(r)}: ${(r.gap_sessions ?? []).map((s) => fullName(s.session_cm_id, names)).join(' or ')}`,
          onClick: () => open(g.key, 'add'),
        }
      const changed = formChangeToReview(r)
      if (changed !== undefined)
        return {
          label: 'Mark Reviewed',
          title:
            changed.form_change?.kind === 'deleted'
              ? 'The response was deleted in Google: the request and its decisions stay as they are, and it leaves Needs a look'
              : 'A second response came after a decision: the request stays as it is, and it leaves Needs a look',
          disabled: reviewChange.isPending,
          onClick: () => {
            setEditing(null)
            reviewChange
              .mutateAsync({ year: view.year, requestId: changed.request_id })
              .then(() => {
                keep(r.key)
                setStatus(ok(`✓ Marked reviewed: ${camperLabel(r)}'s request stays as it is`))
              })
              .catch((caught: unknown) =>
                setStatus(
                  warn(caught instanceof Error ? caught.message : "Couldn't mark it reviewed")
                )
              )
          },
        }
      const rule = unreviewed(r)
      if (rule === undefined) return null
      return {
        label: 'Mark Reviewed',
        title: 'The request from the registration ask is right: it leaves Needs a look',
        disabled: review.isPending,
        onClick: () => {
          setEditing(null)
          review
            .mutateAsync({ year: view.year, additionId: rule.addition_id ?? '' })
            .then(() => {
              keep(r.key)
              setStatus(
                ok(`✓ Marked reviewed: ${camperLabel(r)}'s request from a registration ask`)
              )
            })
            .catch((caught: unknown) =>
              setStatus(
                warn(caught instanceof Error ? caught.message : "Couldn't mark it reviewed")
              )
            )
        },
      }
    }
  }, [canWork, review, reviewChange, view.year, keep, names, open])

  const editorOf = useCallback(
    (g: IntakeGridRow): ReactNode => {
      if (editing === null || editing.key !== g.key || !canWork) return null
      if (g.kind === 'row')
        return editing.kind === 'add' ? (
          <AddRequestEditor
            target={targetFromRow(g.row)}
            names={names}
            onSaved={(words) => onAdded(g.row, words)}
            onCancel={onCancelEdit}
          />
        ) : null
      const r = g.response
      const typed = `“${r.name_typed ?? ''}”`
      if (editing.kind === 'link')
        return (
          <LinkResponsePanel
            response={r}
            year={view.year}
            names={names}
            onCancel={onCancelEdit}
            onLink={(personCmId) =>
              linkWrite.mutateAsync({ year: view.year, id: r.id, personCmId }).then(() => {
                setEditing(null)
                setHighlighted(null)
                setStatus(
                  ok(`✓ Linked ${typed}'s response: its request is made from its own figures`)
                )
              })
            }
          />
        )
      if (editing.kind === 'ignore')
        return (
          <IgnoreResponseEditor
            response={r}
            year={view.year}
            onCancel={onCancelEdit}
            onIgnore={(body) =>
              ignoreWrite.mutateAsync({ year: view.year, id: r.id, body }).then(() => {
                keep(g.key)
                setEditing(null)
                setStatus(
                  ok(`✓ Ignored ${typed}'s response: All forms shows it, never matched again`)
                )
              })
            }
          />
        )
      return null
    },
    [editing, canWork, names, onAdded, onCancelEdit, linkWrite, ignoreWrite, view.year, keep]
  )

  const lead = (
    <>
      <AidSegmented<GridSegment>
        label="Show"
        value={segment}
        options={GRID_SEGMENTS.map((s) => ({ ...s, count: counts[s.value] }))}
        onChange={changeSegment}
      />
      {cmaidOnly && (
        <AidFilterChip title={CHIP_TITLE} onClear={() => setParam('cmaid', null)}>
          CampMinder aid on no request
        </AidFilterChip>
      )}
    </>
  )
  const actions = canWork ? (
    <>
      {googleForm !== null && (
        <button
          type="button"
          className={CS_BTN2}
          disabled={pull.isPending}
          title="Read the adult aid form from Google now, rather than at the next hourly read"
          onClick={() => {
            setStatus(null)
            pull
              .mutateAsync({ year: view.year })
              .then(() => setStatus(ok(PULLED_WORDS)))
              .catch((caught: unknown) =>
                setStatus(
                  warn(
                    caught instanceof Error ? caught.message : "Couldn't start the read from Google"
                  )
                )
              )
          }}
        >
          Pull Now
        </button>
      )}
      <button
        type="button"
        className={CS_BTN2}
        disabled={finding}
        onClick={() => {
          setEditing(null)
          setFinding(true)
        }}
      >
        Find a Camper Not Listed…
      </button>
    </>
  ) : undefined
  // K4 a: the last read sits in the status slot beside Pull Now, until a result takes it.
  const shownStatus: RequestsStatus | null =
    status ??
    (lastRead === null ? null : { text: lastRead.text, title: lastRead.title, tone: lastRead.tone })

  return (
    <>
      <IntakeTable
        rows={shown}
        kept={kept}
        names={names}
        programs={programs}
        view={view}
        marks={marks}
        actionOf={actionOf}
        highlighted={highlighted}
        onHighlight={onHighlight}
        editorOf={editorOf}
        csvFilename={`camperships-form-intake-${CSV_NAMES[segment]}${cmaidOnly ? '-campminder-aid' : ''}-${String(view.year)}.csv`}
        emptyText={(searching) =>
          searching
            ? 'No camper matches the search.'
            : segment === 'look'
              ? closed
                ? `Nothing needs a look. ${String(view.year)} is closed, so its forms show as history. All forms shows every row.`
                : 'Nothing needs a look. Every form became a request, or this list says why not. All forms shows every row.'
              : segment === 'link'
                ? 'No responses to link. Every adult aid form response found its person, or was ignored.'
                : 'No rows in this view.'
        }
        toolbarLead={lead}
        toolbarStatus={<StatusSlot status={shownStatus} onDismiss={() => setStatus(null)} />}
        toolbarActions={actions}
        closed={closed}
        bandRow={
          band === null
            ? undefined
            : {
                tone: 'warn',
                title: `${band.lead} ${band.meta}`,
                content: (
                  <>
                    {band.lead} <span className={`${CS_POPEN_META} font-normal`}>{band.meta}</span>
                  </>
                ),
              }
        }
        belowToolbar={
          finding && canWork ? (
            <FindUnlistedPanel onAdded={onAdded} onClose={() => setFinding(false)} />
          ) : undefined
        }
      />
      <GrantsLine count={data.grants_waiting_for_camper} view={view} />
    </>
  )
}

/**
 * `/aid/requests/intake` (spec 71 §2.4; owner Q1-A to Q5-A): Requests › Form intake. Every aid form answer and
 * registration ask this season, the request it became or why not, and CampMinder's camp aid on the family. One read;
 * the filter (`?show=`) and Season's chip (`?cmaid=1`) live in the URL. Casework adds the requests the form never
 * named and marks rule-made ones reviewed.
 */
export default function AidFormIntakePage() {
  const year = useYear()
  const view = useMemo((): AidView => ({ year, asOf: LIVE }), [year])
  const forms = useAidIntakeForms()
  return (
    <div className="space-y-2.5">
      <AidPageHead
        band={
          <AidPageBand
            icon={ListChecks}
            title="Form intake"
            subtitle={`Requests · Season ${String(year)}`}
            asOf={LIVE}
            closed={forms.data?.season_done === true}
            stats={
              <Link
                to={aidHref('/aid/requests', view)}
                className="text-forest-200 text-sm whitespace-nowrap hover:underline"
                title="Back to the Requests pipeline"
              >
                ‹ Requests
              </Link>
            }
          />
        }
      />
      <QueryGuard
        isLoading={forms.isLoading}
        // A failed background refetch keeps what loaded.
        error={forms.data ? null : forms.error}
        data={forms.data}
        label="Form intake"
      >
        {(data) => <IntakeBody data={data} view={view} />}
      </QueryGuard>
      <AidDefinitionNotes surface={SURFACE} boldTerm />
    </div>
  )
}
