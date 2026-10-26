/**
 * Analytics › Today (#3207 PR 8): summer at a glance. The approved mock (round 4) with the owner's rulings:
 *
 * - Hero: enrolled campers split Returning / New to camp, against the same point last year (decision 7),
 *   with Waitlisted and Cancelled under it, and Applied and Incomplete only when non-zero (decision 14).
 *   Registration never closes, so every change compares at the same point, all season; no "started" pill.
 * - Session fill (SessionFillCard), Pace (PaceCard) and Recent sign-ups (RecentSignupsCard).
 * - Every change in the app-wide delta tokens; Cancelled is red when it rises.
 * - Each card loads and fails on its own, with "Try again" (D-UNCOVERED).
 *
 * The mock's "Today" column (the change since this morning's stored point) waits on PR 5's hourly sync:
 * with one sync a day it would always read 0, so it is not drawn yet.
 */
import { useCallback } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router'
import {
  AidHeroBar,
  AidHeroCard,
  type HeroSegment,
} from '../../../components/camperships/kit/HeroBar'
import { DefRef, DefinitionNotes } from '../../../components/camperships/kit/DefinitionNotes'
import { CS_SMALL } from '../../../components/camperships/kit/csType'
import { useComparisonRegistrationData } from '../../../hooks/useComparisonRegistrationData'
import { useCurrentYear } from '../../../hooks/useCurrentYear'
import { useDrilldown } from '../../../hooks/useDrilldown'
import { useRegistrationMetrics } from '../../../hooks/useMetrics'
import { useMetricsSession } from '../../../hooks/useMetricsSession'
import { usePriorityRegDate } from '../../../hooks/useRegistrationDates'
import { useTodayRecent, useTodaySessions } from '../../../hooks/useToday'
import { useVelocity } from '../../../hooks/useVelocity'
import { formatCount } from '../../../utils/numberFormat'
import { DELTA_INK, type DeltaKind } from '../../../utils/deltaTokens'
import { readsThroughNextDay } from '../../../utils/priorityDay'
import { formatShortDate } from '../../../components/camperships/kit/dates'
import type { RegistrationMetrics } from '../../../types/metrics'
import { useLiveSync } from '../../../hooks/useLiveSync'
import { livePoint, staleStoredDate } from '../../../components/velocity/velocityLive'
import { PaceCard, PaceHead } from './PaceCard'
import { RecentSignupsCard } from './RecentSignupsCard'
import { SessionFillHead, SessionFillTable } from './SessionFillCard'
import { CardState, Change } from './todayParts'
import {
  analyticsHref,
  basisWords,
  noteNumber,
  pacePrior,
  priorBasisOf,
  registrationDayWords,
  todayNotes,
  type FillBasis,
  type PriorBasis,
} from './todayModel'

const FILL_TONE: Record<'done' | 'progress', string> = {
  done: 'bg-forest-700 dark:bg-forest-500',
  progress: 'bg-forest-500 dark:bg-forest-600',
}

interface StatusRow {
  label: 'Waitlisted' | 'Cancelled' | 'Applied' | 'Incomplete'
  now: number
  prior: number | null
  kind: DeltaKind
  href: string | null
}

function StatusRows({
  rows,
  basis,
  pending,
  sameNote,
  dashNote,
}: {
  rows: StatusRow[]
  basis: string
  pending: boolean
  sameNote: number | undefined
  dashNote: number | undefined
}) {
  const location = useLocation()
  const scale = Math.max(1, ...rows.map((r) => Math.max(r.now, r.prior ?? 0)))
  const grid = { gridTemplateColumns: '150px minmax(0,1fr) 90px 190px' }
  return (
    <div className="border-border mt-3 border-t pt-2.5">
      <div className={`grid items-center gap-x-3.5 pb-1 ${CS_SMALL}`} style={grid}>
        <span>Other statuses · campers</span>
        <span />
        <span className="text-right">Now</span>
        <span className="text-right">
          {basis}
          {sameNote !== undefined && <DefRef n={sameNote} />}
        </span>
      </div>
      {rows.map((r) => {
        const pct = (r.now / scale) * 100
        return (
          <div
            key={r.label}
            data-testid={`status-${r.label}`}
            className="grid items-center gap-x-3.5 py-[3px] text-[13px]"
            style={grid}
          >
            {r.href ? (
              <Link
                to={analyticsHref(r.href, location.search)}
                className="text-foreground truncate font-semibold hover:underline"
              >
                {r.label} ›
              </Link>
            ) : (
              <span className="text-foreground truncate font-semibold">{r.label}</span>
            )}
            <div className="relative">
              <div className="bg-muted relative flex h-2.5 overflow-hidden rounded-full">
                <span
                  className="min-w-1 bg-stone-300 dark:bg-stone-600"
                  style={{ flexGrow: pct, flexShrink: 1, flexBasis: 0 }}
                />
                <span style={{ flexGrow: 100 - pct, flexShrink: 1, flexBasis: 0 }} />
              </div>
              {r.prior != null && (
                <span
                  className="border-foreground/60 pointer-events-none absolute -top-1 -bottom-1 border-l-2 border-dashed"
                  style={{ left: `${String((r.prior / scale) * 100)}%` }}
                />
              )}
            </div>
            <span className="text-right font-semibold tabular-nums">{formatCount(r.now)}</span>
            <span className="text-right">
              <Change
                now={r.now}
                prior={r.prior}
                kind={r.kind}
                pending={pending && r.prior != null}
                testId="status-change"
              />
              {r.prior == null && dashNote !== undefined && <DefRef n={dashNote} />}
              {r.prior != null && !pending && (
                <span className="text-muted-foreground tabular-nums">
                  {' '}
                  · {formatCount(r.prior)}
                </span>
              )}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function Hero({
  title,
  dayWords,
  current,
  prior,
  headlinePrior,
  applied,
  incomplete,
  basis,
  priorYear,
  pending,
  notes,
  onSplit,
}: {
  title: string
  dayWords: string | null
  current: RegistrationMetrics
  prior: RegistrationMetrics | undefined
  /** #51: one session picked with embedded sessions folded in, its and their campers once each. */
  headlinePrior: number | null
  applied: number
  incomplete: number
  basis: PriorBasis
  priorYear: number
  pending: boolean
  notes: { enrolled?: number | undefined; same?: number | undefined; dash?: number | undefined }
  onSplit: (value: 'new' | 'returning') => void
}) {
  const vs = basisWords(basis, priorYear)
  const point = vs.replace(/^vs /, '')
  const enrolled = current.total_enrolled
  const priorEnrolled = headlinePrior ?? prior?.total_enrolled ?? null
  const behind = priorEnrolled != null && priorEnrolled > enrolled ? priorEnrolled - enrolled : 0
  const segments: HeroSegment[] = [
    {
      key: 'ret',
      value: current.new_vs_returning.returning_count,
      label: 'Returning',
      figure: formatCount(current.new_vs_returning.returning_count),
      tone: 'done',
    },
    {
      key: 'new',
      value: current.new_vs_returning.new_count,
      label: 'New to camp',
      figure: formatCount(current.new_vs_returning.new_count),
      tone: 'progress',
    },
  ]
  if (behind > 0) {
    segments.push({
      key: 'gap',
      value: behind,
      label: `Short of ${point}`,
      figure: formatCount(behind),
      inner: `▼ ${formatCount(behind)}`,
      tone: 'gap',
      ink: DELTA_INK.bad,
    })
  }
  const statusRows: StatusRow[] = [
    {
      label: 'Waitlisted',
      now: current.total_waitlisted ?? 0,
      prior: prior?.total_waitlisted ?? null,
      kind: 'neutral',
      href: '/analytics/registration/waitlist',
    },
    {
      label: 'Cancelled',
      now: current.total_cancelled,
      prior: prior?.total_cancelled ?? null,
      kind: 'up-bad',
      href: '/analytics/registration/cancellations',
    },
  ]
  // Decision 14: two rows, each only when non-zero, never added into Enrolled. Last year's can't be rebuilt.
  if (applied > 0)
    statusRows.push({ label: 'Applied', now: applied, prior: null, kind: 'neutral', href: null })
  if (incomplete > 0)
    statusRows.push({
      label: 'Incomplete',
      now: incomplete,
      prior: null,
      kind: 'neutral',
      href: null,
    })

  const description = [dayWords, 'counted in campers', `changes ${vs}`].filter(Boolean).join(' · ')
  return (
    <AidHeroCard
      title={title}
      description={description}
      figure={formatCount(enrolled)}
      figureLabel={
        <>
          campers enrolled{notes.enrolled !== undefined && <DefRef n={notes.enrolled} />} ·{' '}
          <Change now={enrolled} prior={priorEnrolled} pending={pending} testId="hero-change" />{' '}
          {vs}
          {notes.same !== undefined && <DefRef n={notes.same} />}
        </>
      }
    >
      <AidHeroBar
        segments={segments}
        reveal
        {...(priorEnrolled != null
          ? { marker: { at: priorEnrolled, title: `${point}: ${formatCount(priorEnrolled)}` } }
          : {})}
      />
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] leading-[18px]">
        {(['ret', 'new'] as const).map((key) => {
          const seg = segments.find((s) => s.key === key)
          if (!seg || seg.value <= 0) return null
          return (
            <button
              key={key}
              type="button"
              className="text-foreground cursor-pointer whitespace-nowrap hover:underline"
              onClick={() => onSplit(key === 'new' ? 'new' : 'returning')}
            >
              <i
                className={`mr-1.5 inline-block size-[9px] rounded-[2px] ${FILL_TONE[key === 'ret' ? 'done' : 'progress']}`}
              />
              {seg.label} <b className="tabular-nums">{seg.figure}</b>
            </button>
          )
        })}
        {behind > 0 && (
          <span className="text-foreground whitespace-nowrap">
            <i className="bg-muted mr-1.5 inline-block size-[9px] rounded-[2px]" />
            Short of {point}{' '}
            <b className={`tabular-nums ${DELTA_INK.bad}`}>▼ {formatCount(behind)}</b>
          </span>
        )}
        {priorEnrolled != null && (
          <span className="text-muted-foreground whitespace-nowrap">
            <i className="border-foreground/60 mr-1.5 inline-block h-[11px] border-l-2 border-dashed align-[-1px]" />
            {point} <b className="text-foreground tabular-nums">{formatCount(priorEnrolled)}</b>
          </span>
        )}
      </div>
      <StatusRows
        rows={statusRows}
        basis={vs}
        pending={pending}
        sameNote={notes.same}
        dashNote={notes.dash}
      />
    </AidHeroCard>
  )
}

export default function TodayPage() {
  const { currentYear: year } = useCurrentYear()
  const priorYear = year - 1
  const {
    selectedSessionCmId,
    selectedSession,
    activeSessionTypes,
    sessionTypesParam,
    durationParam,
    filterOptions,
  } = useMetricsSession()
  const [params, setParams] = useSearchParams()
  const fill: FillBasis = params.get('fill') === 'goal' ? 'goal' : 'plan'
  const setFill = useCallback(
    (next: FillBasis) =>
      setParams(
        (prev) => {
          const out = new URLSearchParams(prev)
          if (next === 'plan') out.delete('fill')
          else out.set('fill', next)
          return out
        },
        { replace: true }
      ),
    [setParams]
  )

  const { primary, comparison } = useComparisonRegistrationData(
    year,
    priorYear,
    { ...filterOptions, statuses: 'enrolled' },
    // PM-8 A: the same registration day all year, never last year's final
    { samePoint: 'allYear' }
  )
  const applied = useRegistrationMetrics(year, { ...filterOptions, statuses: 'applied' })
  const incomplete = useRegistrationMetrics(year, { ...filterOptions, statuses: 'incomplete' })
  const sessions = useTodaySessions(year, filterOptions)
  const recent = useTodayRecent(year, filterOptions)
  const velocity = useVelocity(year, {
    sessionCmId: selectedSessionCmId,
    compareYears: [priorYear],
    sessionTypes: sessionTypesParam,
    duration: durationParam,
  })
  // PR 5b: Pace's live point after the 3 a.m. count, drawn only after a fresh hourly sync
  const { sync: liveSync, now } = useLiveSync(year)
  const priorityDate = usePriorityRegDate(year)

  const { setFilter, DrilldownModal } = useDrilldown({
    year,
    sessionCmId: selectedSessionCmId ?? undefined,
    sessionTypes: [...activeSessionTypes],
    statusFilter: ['enrolled'],
    duration: durationParam,
  })

  // With no anchor there is no same day: no comparison, and never another figure in its place (PM-4 A)
  const basis: PriorBasis = priorBasisOf(comparison?.data)
  const prior = basis === 'same_point' ? comparison?.data : undefined
  const pending = basis === 'same_point' && prior?.day_offset === 0
  const throughNextDay = readsThroughNextDay(prior?.day_offset, prior?.prior_day_offset)
  const appliedCount = applied.data?.total_enrolled ?? 0
  const incompleteCount = incomplete.data?.total_enrolled ?? 0
  const recentData = recent.data
  const recentError = recent.error
  const recentShown = (recentData?.lines.length ?? 0) > 0
  const notes = todayNotes({
    basis,
    dayOffset: prior?.day_offset,
    priorYear,
    throughNextDay,
    dash:
      basis === 'same_point' &&
      (prior?.total_waitlisted == null || appliedCount > 0 || incompleteCount > 0),
    fill,
    recent: recentShown,
  })
  const n = {
    enrolled: noteNumber(notes, 'enrolled'),
    same: noteNumber(notes, 'same'),
    dash: noteNumber(notes, 'dash'),
    sessions: noteNumber(notes, 'sessions'),
    fill: noteNumber(notes, 'fill'),
    recent: noteNumber(notes, 'recent'),
  }

  const oneSession = selectedSession?.name ?? null
  // #51: only a one-session scope folds the headline; whole-scope views keep Overview's own figure
  const headlinePrior = oneSession !== null ? (sessions.data?.headline_prior ?? null) : null
  // Pace compares what the fill total compares (PR 8b); if Session fill failed, Pace shows an error (ti:P-36)
  const paceFold = sessions.data ? pacePrior(sessions.data, oneSession !== null) : null
  const title = selectedSession
    ? `${selectedSession.name}, ${String(year)}`
    : `Summer ${String(year)}`
  const priorityLabel = priorityDate ? formatShortDate(priorityDate) : null
  const busyWhat = String(year)
  const retryHero = () => {
    void primary.refetch()
    void comparison?.refetch()
    void applied.refetch()
    void incomplete.refetch()
    if (oneSession !== null) void sessions.refetch()
  }

  return (
    <div className="space-y-2.5">
      <section data-testid="today-hero">
        <CardState
          label="enrollment"
          query={{
            data: primary.data,
            isLoading: primary.isLoading || (oneSession !== null && sessions.isLoading),
            // ti:P-36: the one-session headline reads Session fill, so its failure is the hero's (never
            // last year's unfolded count in its place); with no session picked the hero does not read it
            error:
              primary.error ??
              comparison?.error ??
              (oneSession !== null ? sessions.error : null) ??
              null,
            // #51's headline reads Session fill, which may still hold the previous session's figure
            isPlaceholderData:
              primary.isPlaceholderData ||
              comparison?.isPlaceholderData === true ||
              (oneSession !== null && sessions.isPlaceholderData),
          }}
          onRetry={retryHero}
          busyWhat={busyWhat}
        >
          {(current) => (
            <Hero
              title={title}
              dayWords={registrationDayWords(prior?.day_offset, priorityLabel)}
              current={current}
              prior={prior}
              headlinePrior={headlinePrior}
              applied={appliedCount}
              incomplete={incompleteCount}
              basis={basis}
              priorYear={priorYear}
              pending={pending}
              notes={n}
              onSplit={(value) =>
                setFilter({
                  type: 'returning_status',
                  value,
                  label: value === 'new' ? 'New Campers' : 'Returning Campers',
                })
              }
            />
          )}
        </CardState>
      </section>

      <div className="grid grid-cols-1 items-start gap-x-3 gap-y-2.5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section data-testid="today-fill" className="flex min-w-0 flex-col gap-1.5">
          <CardState
            label="session fill"
            query={sessions}
            onRetry={() => void sessions.refetch()}
            busyWhat={busyWhat}
          >
            {(data) => (
              <>
                <SessionFillHead
                  data={data}
                  oneSession={oneSession}
                  basis={fill}
                  onBasis={setFill}
                  notes={n}
                />
                <SessionFillTable
                  data={data}
                  oneSession={oneSession}
                  basis={fill}
                  pending={pending}
                  notes={n}
                />
              </>
            )}
          </CardState>
        </section>

        <div className="flex min-w-0 flex-col gap-2.5">
          <section
            data-testid="today-pace"
            className="border-border bg-card overflow-hidden rounded-xl border"
          >
            <PaceHead sessionsNote={n.sessions} />
            <div className="pt-1.5 pr-2.5 pb-2 pl-3.5">
              <CardState
                label="pace"
                query={{
                  data: velocity.data,
                  isLoading: velocity.isLoading || sessions.isLoading,
                  // ti:P-36: Pace's prior is Session fill's comparison, so its failure is Pace's
                  error: velocity.error ?? sessions.error ?? null,
                  isPlaceholderData: velocity.isPlaceholderData || sessions.isPlaceholderData,
                }}
                onRetry={() => {
                  if (velocity.error) void velocity.refetch()
                  if (sessions.error) void sessions.refetch()
                }}
                busyWhat={busyWhat}
              >
                {(data) => (
                  <PaceCard
                    data={data}
                    year={year}
                    fold={paceFold}
                    live={livePoint(data, liveSync, now)}
                    storedDate={staleStoredDate(data, now)}
                  />
                )}
              </CardState>
            </div>
          </section>

          {recentError ? (
            <section className="border-border bg-card rounded-xl border">
              <CardState
                label="recent sign-ups"
                query={recent}
                onRetry={() => void recent.refetch()}
                busyWhat={busyWhat}
              >
                {() => null}
              </CardState>
            </section>
          ) : (
            recentData &&
            recentShown && (
              <RecentSignupsCard
                data={recentData}
                note={n.recent}
                onViewAll={() =>
                  setFilter({
                    type: 'status',
                    value: 'enrolled',
                    label: 'Enrolled in the last 7 days',
                    initialRows: 'enrollments',
                    enrolledSince: recentData.since,
                  })
                }
              />
            )
          )}
        </div>
      </div>

      <DefinitionNotes notes={notes} boldTerm />
      <DrilldownModal />
    </div>
  )
}
