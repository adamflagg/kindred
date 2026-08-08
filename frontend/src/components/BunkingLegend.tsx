import { useState } from 'react'
import {
  HelpCircle,
  X,
  Lock,
  AlertTriangle,
  Users,
  Home,
  Network,
  Layers,
  History,
} from 'lucide-react'

interface LegendEntryProps {
  icon: React.ReactNode
  title: string
  children: React.ReactNode
  iconClass?: string
}

function LegendEntry({ icon, title, children, iconClass }: LegendEntryProps) {
  return (
    <div className="flex items-start gap-4">
      <div className={`flex w-12 flex-shrink-0 justify-center ${iconClass ?? ''}`}>{icon}</div>
      <div>
        <p className="text-foreground font-medium">{title}</p>
        {children}
      </div>
    </div>
  )
}

interface LegendSection {
  icon: React.ReactNode
  title: string
  content: React.ReactNode
}

interface VisualGuideModalProps {
  isOpen: boolean
  onClose: () => void
  sections: LegendSection[]
}

/**
 * The shared "Visual Guide" shell — header, section list and "Got it"
 * footer — behind whichever `HelpCircle` button mounts it.
 *
 * Parameterised on `sections` rather than forked (kindred#1997): summer and
 * the weekend document entirely different signals — friend groups and AG
 * grade ratios have no weekend equivalent — but the modal chrome, the
 * section shape and the `LegendEntry` primitive are the one shell both use.
 * Copying this file to give the weekend its own guide would be the thing
 * CLAUDE.md §4 names by name.
 */
function VisualGuideModal({ isOpen, onClose, sections }: VisualGuideModalProps) {
  if (!isOpen) return null

  return (
    <div className="animate-fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="card-lodge shadow-lodge-lg animate-scale-in max-h-[90vh] w-full max-w-2xl overflow-hidden">
        {/* Header */}
        <div className="bg-muted/50 border-border flex items-center justify-between border-b px-6 py-4">
          <h2 className="font-display text-foreground flex items-center gap-2 text-xl font-bold">
            <HelpCircle className="text-primary h-5 w-5" />
            Visual Guide
          </h2>
          <button onClick={onClose} className="btn-ghost p-2">
            <X className="h-6 w-6" />
          </button>
        </div>

        {/* Content */}
        <div className="max-h-[calc(90vh-8rem)] space-y-8 overflow-y-auto p-6">
          {sections.map((section) => (
            <section key={section.title}>
              <h3 className="text-muted-foreground mb-4 flex items-center gap-2 text-sm font-medium tracking-wider uppercase">
                {section.icon}
                {section.title}
              </h3>
              <div className="space-y-4">{section.content}</div>
            </section>
          ))}
        </div>

        {/* Footer */}
        <div className="bg-muted/50 border-border flex justify-end border-t px-6 py-4">
          <button onClick={onClose} className="btn-primary">
            Got it
          </button>
        </div>
      </div>
    </div>
  )
}

const CAMPER_SECTIONS: LegendSection[] = [
  {
    icon: <Users className="h-4 w-4" />,
    title: 'Camper Indicators',
    content: (
      <>
        <LegendEntry
          icon={<AlertTriangle className="h-5 w-5 text-orange-500" />}
          title="Unsatisfied Requests"
        >
          <p className="text-muted-foreground text-sm">
            Orange triangle indicates this camper has bunk requests but none are satisfied in their
            current placement
          </p>
        </LegendEntry>

        <LegendEntry
          icon={
            <span className="inline-flex items-center gap-0.5 text-amber-500">
              <span className="text-xs font-semibold">3</span>
              <Lock className="h-4 w-4" />
            </span>
          }
          title="Friend Group"
        >
          <p className="text-muted-foreground text-sm">
            Lock icon with number shows camper is in a friend group. The number indicates group
            size. Color matches the group's assigned color.
          </p>
        </LegendEntry>

        <LegendEntry
          icon={
            <div className="pending-lock-glow h-6 w-10 rounded-lg border-2 border-amber-400 bg-amber-400/10" />
          }
          title="Pending Selection"
        >
          <p className="text-muted-foreground text-sm">
            Amber glowing border indicates camper is selected for a new friend group. Use Ctrl+Click
            to add more campers.
          </p>
        </LegendEntry>

        <LegendEntry
          icon={
            <span
              className="text-sm font-medium"
              style={{ textShadow: '0 0 8px #10b981, 0 0 12px #10b98180' }}
            >
              Name
            </span>
          }
          title="Group Name Glow"
        >
          <p className="text-muted-foreground text-sm">
            Camper names glow in their friend group's color for easy visual identification
          </p>
        </LegendEntry>

        <LegendEntry
          icon={
            <>
              <div className="h-5 w-3 rounded border-2 border-blue-300 bg-blue-100 dark:border-blue-700 dark:bg-blue-900/30" />
              <div className="h-5 w-3 rounded border-2 border-pink-300 bg-pink-100 dark:border-pink-700 dark:bg-pink-900/30" />
              <div className="h-5 w-3 rounded border-2 border-purple-300 bg-purple-100 dark:border-purple-700 dark:bg-purple-900/30" />
            </>
          }
          title="Gender Card Color"
          iconClass="items-center gap-1"
        >
          <p className="text-muted-foreground text-sm">
            Card background color reflects gender identity: blue = boy/man, pink = girl/woman,
            purple = all other identities
          </p>
        </LegendEntry>

        <LegendEntry
          icon={<History className="text-muted-foreground h-5 w-5" />}
          title="Prior-Year History"
        >
          <p className="text-muted-foreground text-sm">
            Dim text on the right of the card shows where this camper bunked last year
            (e.g.&nbsp;"S1 B-4"). Blank if this is the camper's first year.
          </p>
        </LegendEntry>
      </>
    ),
  },
  {
    icon: <Home className="h-4 w-4" />,
    title: 'Bunk Indicators',
    content: (
      <>
        <LegendEntry
          icon={
            <div className="bg-muted h-2 w-10 overflow-hidden rounded-full">
              <div className="bg-primary h-2 rounded-full" style={{ width: '60%' }} />
            </div>
          }
          title="Capacity Bar"
          iconClass="pt-1"
        >
          <p className="text-muted-foreground mb-2 text-sm">
            Shows beds filled with color-coded status:
          </p>
          <div className="flex flex-wrap gap-3 text-xs">
            <span className="inline-flex items-center gap-1.5">
              <span className="bg-primary h-2.5 w-2.5 rounded-full" />
              <span className="text-muted-foreground">&lt;70%</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-yellow-500" />
              <span className="text-muted-foreground">70-90%</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-orange-500" />
              <span className="text-muted-foreground">90-100%</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="bg-destructive h-2.5 w-2.5 rounded-full" />
              <span className="text-muted-foreground">Over</span>
            </span>
          </div>
        </LegendEntry>

        <LegendEntry
          icon={
            <div className="bg-muted flex h-8 w-8 items-center justify-center rounded-lg">
              <Network className="text-muted-foreground h-4 w-4" />
            </div>
          }
          title="Social Graph"
        >
          <p className="text-muted-foreground text-sm">
            Opens a network visualization showing friendship requests between campers in this bunk.
            Green edges = mutual requests, amber = one-way.
          </p>
        </LegendEntry>

        <LegendEntry
          icon={
            <div className="border-destructive/50 bg-destructive/5 flex h-8 w-10 items-center justify-center rounded-lg border-2">
              <span className="text-sm">⚠️</span>
            </div>
          }
          title="Bunk Warnings"
        >
          <p className="text-muted-foreground mb-2 text-sm">Red border indicates issues:</p>
          <ul className="text-muted-foreground space-y-1 text-sm">
            <li className="flex items-center gap-2">
              <span className="bg-muted-foreground h-1 w-1 rounded-full" />
              Over capacity (exceeds bunk's configured capacity)
            </li>
            <li className="flex items-center gap-2">
              <span className="bg-muted-foreground h-1 w-1 rounded-full" />
              Age spread exceeds 24 months
            </li>
            <li className="flex items-center gap-2">
              <span className="bg-muted-foreground h-1 w-1 rounded-full" />
              Grade ratio exceeds 67% from one grade
            </li>
            <li className="flex items-center gap-2">
              <span className="bg-muted-foreground h-1 w-1 rounded-full" />
              More than 2 different grades in bunk
            </li>
          </ul>
        </LegendEntry>

        <LegendEntry
          icon={<div className="ring-primary bg-primary/5 h-8 w-10 rounded-lg ring-2" />}
          title="Active Drop Target"
        >
          <p className="text-muted-foreground text-sm">
            Primary-colored ring highlights the bunk currently being dragged over, showing it will
            accept the camper on release
          </p>
        </LegendEntry>

        <LegendEntry
          icon={<div className="bg-muted/50 h-8 w-10 rounded-lg opacity-40" />}
          title="Invalid Drop Target"
        >
          <p className="text-muted-foreground text-sm">
            Grayed out bunks cannot accept the camper being dragged (wrong gender or grade mismatch
            for AG sessions)
          </p>
        </LegendEntry>
      </>
    ),
  },
  {
    icon: <Layers className="h-4 w-4" />,
    title: 'Working Modes',
    content: (
      <>
        <LegendEntry
          icon={
            <span className="inline-flex items-center gap-1 rounded-lg border border-emerald-300 bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
              Draft
            </span>
          }
          title="Scenario Mode"
        >
          <p className="text-muted-foreground text-sm">
            Working in a draft scenario. Drag-and-drop is enabled. Changes won't affect live
            assignments until published.
          </p>
        </LegendEntry>

        <LegendEntry
          icon={
            <span className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
              Live
            </span>
          }
          title="Production Mode"
        >
          <p className="text-muted-foreground text-sm">
            Viewing live CampMinder data. Drag-and-drop is disabled. Select a scenario or create a
            new one to make edits.
          </p>
        </LegendEntry>
      </>
    ),
  },
]

interface BunkingLegendProps {
  isOpen: boolean
  onClose: () => void
}

export default function BunkingLegend({ isOpen, onClose }: BunkingLegendProps) {
  return <VisualGuideModal isOpen={isOpen} onClose={onClose} sections={CAMPER_SECTIONS} />
}

/** The open/close state and trigger both `BunkingLegendButton` and
 *  `WeekendLegendButton` share; only the `sections` they open differ. */
function LegendButton({ sections }: { sections: LegendSection[] }) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <>
      <button onClick={() => setIsOpen(true)} className="btn-ghost p-2" title="Show visual guide">
        <HelpCircle className="h-5 w-5" />
      </button>
      <VisualGuideModal isOpen={isOpen} onClose={() => setIsOpen(false)} sections={sections} />
    </>
  )
}

export function BunkingLegendButton() {
  return <LegendButton sections={CAMPER_SECTIONS} />
}

/**
 * DUPLICATED, not imported, from `LodgingMap.tsx` / `MapUnitPopover.tsx`.
 *
 * This button mounts unconditionally in the weekend header (WeekendRosterPage,
 * outside the lazy tab panels), so an import from either would drag
 * `LodgingMap`'s whole lazy chunk into the eager bundle — exactly what
 * `WeekendRosterPage.chunkGraph.test.ts` exists to catch (kindred#2057).
 * A colour literal is cheap to keep in sync by hand; a chunk-graph regression
 * is not.
 */
const WEEKEND_BATHHOUSE_BLUE = '#2563eb'
const WEEKEND_CONSENT_AMBER = '#fbbf24'

const WEEKEND_SECTIONS: LegendSection[] = [
  {
    icon: <Home className="h-4 w-4" />,
    title: 'Room Indicators',
    content: (
      <>
        <LegendEntry
          icon={
            <div className="border-muted-foreground/70 h-5 w-5 rounded-[3px] border-2 border-dashed" />
          }
          title="Staff Cabin"
        >
          <p className="text-muted-foreground text-sm">
            Dashed square marks permanent staff housing — never family inventory, and never occupied
            by a roster party.
          </p>
        </LegendEntry>

        <LegendEntry
          icon={
            <span
              style={{ backgroundColor: WEEKEND_BATHHOUSE_BLUE }}
              className="h-3 w-3 rounded-full ring-1 ring-white"
            />
          }
          title="Near Bathhouse"
        >
          <p className="text-muted-foreground text-sm">
            Blue dot marks a room within walking distance of a bathhouse.
          </p>
        </LegendEntry>

        <LegendEntry
          icon={
            <span aria-hidden="true" className="flex items-center gap-0.5">
              <span className="h-3 w-3 rounded-full bg-emerald-400" />
              <span className="h-3 w-3 rounded-full bg-sky-400" />
              <span className="h-3 w-3 rounded-full bg-amber-400" />
            </span>
          }
          title="Area Color"
        >
          <p className="text-muted-foreground text-sm">
            Fill and border color group rooms by the area they sit in — the same color on the map's
            mark, the board's card edge and its shared-room ring.
          </p>
        </LegendEntry>

        <LegendEntry
          icon={
            <div
              style={{ boxShadow: `0 0 0 2px #fff, 0 0 0 4.5px ${WEEKEND_CONSENT_AMBER}` }}
              className="h-5 w-5 rounded-full bg-white"
            />
          }
          title="Sharing Not Consented"
        >
          <p className="text-muted-foreground text-sm">
            Amber ring marks a shared room where a family answered "prefers not to share" — the
            placement needs a look before the weekend.
          </p>
        </LegendEntry>
      </>
    ),
  },
]

export function WeekendLegendButton() {
  return <LegendButton sections={WEEKEND_SECTIONS} />
}
