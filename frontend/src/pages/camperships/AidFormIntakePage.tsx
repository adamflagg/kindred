import { ListChecks } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'

import { QueryGuard } from '../../components/QueryGuard'
import { FindUnlistedPanel } from '../../components/camperships/intake/FindUnlistedPanel'
import {
  IntakeTable,
  type IntakeMarks,
  type RowActionOf,
} from '../../components/camperships/intake/IntakeTable'
import {
  camperLabel,
  fullName,
  inChip,
  inSegment,
  readSegment,
  segmentCounts,
  SEGMENTS,
  sessionIndex,
  unreviewed,
  type IntakeSegment,
} from '../../components/camperships/intake/intakeModel'
import type {
  FormIntakeResponse,
  FormIntakeRowOut,
} from '../../components/camperships/intake/intakeTypes'
import { aidHref, type AidAsOf, type AidView } from '../../components/camperships/kit/asOf'
import { CS_BTN2, CS_LINK_SM, CS_SMALL } from '../../components/camperships/kit/csType'
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
  const segment = readSegment(params.get('show'))
  const cmaidOnly = params.get('cmaid') === '1'
  const { hasPermission } = usePermissions()
  const canWork = hasPermission(Permission.FINANCIAL_AID_CASEWORK)
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
  const [adding, setAdding] = useState<string | null>(null)
  const [finding, setFinding] = useState(false)
  const [status, setStatus] = useState<RequestsStatus | null>(null)
  const { kept, keep } = useKeptRows(`${String(view.year)}:${segment}:${cmaidOnly ? 'cmaid' : ''}`)

  const chipped = useMemo(
    () => data.rows.filter((r) => inChip(r, cmaidOnly)),
    [data.rows, cmaidOnly]
  )
  const shown = useMemo(
    () =>
      keepInView(
        chipped,
        (r) => inSegment(r, segment),
        kept,
        (r) => r.key
      ),
    [chipped, segment, kept]
  )
  const counts = useMemo(() => segmentCounts(data.rows, cmaidOnly), [data.rows, cmaidOnly])

  const setParam = (name: string, value: string | null) => {
    const next = new URLSearchParams(params)
    if (value === null) next.delete(name)
    else next.set(name, value)
    setParams(next, { replace: true })
  }
  const changeSegment = (value: IntakeSegment) => {
    setHighlighted(null)
    setAdding(null)
    setParam('show', value === 'look' ? null : value)
  }

  const review = useAidReviewAddition()
  const onHighlight = useCallback((key: string | null) => {
    setHighlighted(key)
    setAdding((now) => (now === key ? now : null))
  }, [])
  const onAdded = useCallback(
    (row: FormIntakeRowOut, words: string) => {
      keep(row.key)
      setHighlighted(row.key)
      setAdding(null)
      setFinding(false)
      setStatus(ok(words))
    },
    [keep]
  )
  const onCancelAdd = useCallback(() => setAdding(null), [])
  const actionOf = useMemo((): RowActionOf | null => {
    if (!canWork) return null
    return (r) => {
      if (r.can_add === true && (r.gap_sessions ?? []).length > 0)
        return {
          label: 'Add a Request…',
          title: `Add a request for ${camperLabel(r)}: ${(r.gap_sessions ?? []).map((g) => fullName(g.session_cm_id, names)).join(' or ')}`,
          onClick: () => {
            setStatus(null)
            setAdding(r.key)
          },
        }
      const rule = unreviewed(r)
      if (rule === undefined) return null
      return {
        label: 'Mark Reviewed',
        title: 'The request from the registration ask is right: it leaves Needs a look',
        disabled: review.isPending,
        onClick: () => {
          setAdding(null)
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
  }, [canWork, review, view.year, keep, names])

  const lead = (
    <>
      <AidSegmented<IntakeSegment>
        label="Show"
        value={segment}
        options={SEGMENTS.map((s) => ({ ...s, count: counts[s.value] }))}
        onChange={changeSegment}
      />
      {cmaidOnly && (
        <AidFilterChip title={CHIP_TITLE} onClear={() => setParam('cmaid', null)}>
          CampMinder aid on no request
        </AidFilterChip>
      )}
    </>
  )
  const findButton = canWork ? (
    <button
      type="button"
      className={CS_BTN2}
      disabled={finding}
      onClick={() => {
        setAdding(null)
        setFinding(true)
      }}
    >
      Find a Camper Not Listed…
    </button>
  ) : undefined

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
        adding={adding}
        onAdded={onAdded}
        onCancelAdd={onCancelAdd}
        csvFilename={`camperships-form-intake-${segment === 'look' ? 'needs-a-look' : segment === 'reg' ? 'registration-ask-only' : 'all-forms'}${cmaidOnly ? '-campminder-aid' : ''}-${String(view.year)}.csv`}
        emptyText={(searching) =>
          searching
            ? 'No camper matches the search.'
            : segment === 'look'
              ? 'Nothing needs a look. Every form became a request, or this list says why not. All forms shows every row.'
              : 'No rows in this view.'
        }
        toolbarLead={lead}
        toolbarStatus={<StatusSlot status={status} onDismiss={() => setStatus(null)} />}
        toolbarActions={findButton}
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
