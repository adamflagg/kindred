import { useState } from 'react'
import {
  HelpCircle,
  Lock,
  AlertTriangle,
  Users,
  Home,
  Network,
  Layers,
  History,
  Handshake,
  HeartHandshake,
  Milestone,
  Bath,
  Plug,
  Refrigerator,
  Baby,
  Repeat,
  Star,
} from 'lucide-react'

import { Modal } from './ui/Modal'
import { BATHHOUSE_BLUE, CONSENT_AMBER } from './weekend/mapColors'

/** What one legend row and one legend section share: an icon and a title.
 *  A row's body is `children` (rendered inline by `LegendEntry` below); a
 *  section's is `content` (one or more rows, rendered by `VisualGuideModal`).
 *  Different field names because the two nest — a section's `content` IS a
 *  list of entries — so reusing `children` for both would blur which level
 *  a given JSX blob belongs to. */
interface LegendIconTitle {
  icon: React.ReactNode
  title: string
}

interface LegendEntryProps extends LegendIconTitle {
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

interface LegendSection extends LegendIconTitle {
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
 *
 * Built on `ui/Modal` (kindred#2156) rather than hand-rolled chrome, so the
 * guide inherits Modal's Escape-key listener, its `document.body` portal
 * and a named close button — none of which this component provided when it
 * painted its own `fixed inset-0` shell. Traded away deliberately: the
 * card's `animate-fade-in`/`animate-scale-in` open animation, which Modal
 * doesn't have and isn't gaining one here — adding a pass-through animation
 * prop to `Modal.tsx` would edit the same file kindred#2025 is adding a
 * focus trap to in parallel, turning two independent PRs into a merge
 * conflict for a cosmetic difference.
 */
function VisualGuideModal({ isOpen, onClose, sections }: VisualGuideModalProps) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="lg"
      noPadding
      scrollable
      ariaLabelledBy="visual-guide-title"
      header={
        <div className="bg-muted/50 border-border flex items-center border-b px-6 py-4">
          <h2
            id="visual-guide-title"
            className="font-display text-foreground flex items-center gap-2 text-xl font-bold"
          >
            <HelpCircle className="text-primary h-5 w-5" />
            Visual Guide
          </h2>
        </div>
      }
      footer={
        <div className="bg-muted/50 border-border flex justify-end border-t px-6 py-4">
          <button onClick={onClose} className="btn-primary">
            Got it
          </button>
        </div>
      }
    >
      <div className="space-y-8 p-6">
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
    </Modal>
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
              style={{ backgroundColor: BATHHOUSE_BLUE }}
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
          {/* The parenthetical is for staff who remember the ring, not a changelog —
              keep the tracker id (kindred#2179) here in the source, never in the
              rendered copy. This is the Visual Guide: staff read it, and an issue
              number means nothing to them. */}
          <p className="text-muted-foreground text-sm">
            Fill and border color group rooms by the area they sit in — the same color on the map's
            mark and the board's card edge. A secondary channel only: nothing depends on telling one
            hue from another. (It used to ring a shared room too; that ring was removed because it
            fired on every cabin built to hold several families.)
          </p>
        </LegendEntry>

        <LegendEntry
          icon={
            <div
              style={{ boxShadow: `0 0 0 2px #fff, 0 0 0 4.5px ${CONSENT_AMBER}` }}
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

/**
 * The chip frame every family-card mark shares (`NeedGlyph`'s `GLYPH_BASE`),
 * and the circle the share marks use instead.
 *
 * COPIED, not imported, and that is forced rather than lazy. This button mounts
 * EAGERLY in the weekend header, so importing `NeedGlyph`, `ShareMarks` or
 * `LodgingUnitCard` would pull the board's lazy chunk into the eager bundle --
 * exactly what `WeekendRosterPage.chunkGraph.test.ts` runs a real `vite build`
 * to catch (kindred#2057). `mapColors.ts` exists as a leaf module for the same
 * reason, and is the only shared import here.
 *
 * So these strings can drift from the board's. The guard against that is the
 * vocabulary doc: `docs/reference/weekend-card-vocabulary.md` §§1-2 is the
 * source of truth for every mark below, and a mark that moves there moves here.
 */
const GUIDE_CHIP = 'inline-flex h-5 w-5 items-center justify-center rounded-md border'
const GUIDE_CIRCLE = 'inline-flex h-5 w-5 items-center justify-center rounded-full'

/**
 * The BOARD's marks -- the Housing tab, and only it.
 *
 * Split from `WEEKEND_SECTIONS` (2026-09-02) because one list could not be
 * honest about both surfaces. A dashed edge is the collision that forced it:
 * on a board card it means AN EMPTY ROOM (`parties.length === 0`,
 * `LodgingUnitCard`'s `dashed`), and on the map it means STAFF HOUSING
 * (`inventory_class === 'staff_default'`, `LodgingMap`'s `borderStyle`). The
 * one legend said "staff cabin", which was right for the map and told board
 * staff that the rooms they most need to fill are rooms they must not touch.
 *
 * The other tabs keep `WEEKEND_SECTIONS` unchanged. This is not a claim that
 * theirs are accurate -- only that the board's are now, and that reworking the
 * map's is its own pass against `LodgingMap`'s own §6.3 encoding list.
 */
const WEEKEND_BOARD_SECTIONS: LegendSection[] = [
  {
    icon: <Users className="h-4 w-4" />,
    title: 'On a family card',
    content: (
      <>
        <LegendEntry
          icon={
            <span
              className={`${GUIDE_CIRCLE} bg-forest-100 text-forest-800 dark:bg-forest-950/50 dark:text-forest-300`}
            >
              <Handshake className="h-3 w-3" />
            </span>
          }
          title="Share answer"
        >
          <p className="text-muted-foreground text-sm">
            Always drawn, one per family: the handshake says how they answered the share question.
            Green is <em>open to sharing</em>, amber <em>only if mutual</em>, plain grey{' '}
            <em>will not share</em>, and a dotted outline means they never answered. Grey is
            deliberate — a refusal is not an alarm, and red belongs to unmet needs.
          </p>
        </LegendEntry>

        <LegendEntry
          icon={
            <span className="flex items-center">
              <span
                className={`${GUIDE_CIRCLE} bg-forest-100 text-forest-800 dark:bg-forest-950/50 dark:text-forest-300 rounded-r-none`}
              >
                <HeartHandshake className="h-3 w-3" />
              </span>
              <span
                className={`${GUIDE_CIRCLE} -ml-px rounded-l-none bg-indigo-100 text-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-400`}
              >
                <Milestone className="h-3 w-3" />
              </span>
            </span>
          }
          title="Who they asked to be near"
        >
          <p className="text-muted-foreground text-sm">
            Up to three circles beside the handshake, one per box the family ticked — a named family
            to share with, kids of similar ages, or another family to be <em>near</em>. Green is a
            sharing ask, indigo a proximity one. Hover any of them for the names they wrote.
          </p>
        </LegendEntry>

        <LegendEntry
          icon={
            <span className="flex items-center gap-0.5">
              <span className={`${GUIDE_CHIP} border-border`}>
                <Bath className="h-3 w-3 text-sky-500 dark:text-sky-400" />
              </span>
              <span className={`${GUIDE_CHIP} border-red-800/40 bg-red-100 dark:bg-red-950/40`}>
                <Plug className="h-3 w-3 text-red-800 dark:text-red-300" />
              </span>
            </span>
          }
          title="What they asked for"
        >
          <p className="text-muted-foreground text-sm">
            One chip per need the family raised — bathroom in the unit, power, fridge, step-free —
            and nothing at all for a need they did not raise. In colour the room answers it; in{' '}
            <strong>red</strong> it does not. A room nobody has recorded the answer for reads red
            too: the guide will not claim a cabin meets a need on missing evidence.
          </p>
        </LegendEntry>

        <LegendEntry
          icon={
            <span className={`${GUIDE_CHIP} border-border`}>
              <Baby className="h-3.5 w-3.5 text-pink-500 dark:text-pink-400" />
            </span>
          }
          title="Child under 2"
        >
          <p className="text-muted-foreground text-sm">
            A fact about the family, not an ask — so it never turns red. Where the child is also
            under the bed rule, the tooltip says they do not count toward the room's capacity.
          </p>
        </LegendEntry>

        <LegendEntry
          icon={
            <span className="flex items-center gap-1">
              <Repeat className="h-5 w-5 text-green-700 dark:text-green-300" />
              <Star className="h-5 w-5 text-amber-700 dark:text-amber-300" />
            </span>
          }
          title="Returning or first-time"
        >
          <p className="text-muted-foreground text-sm">
            Bottom-right of the card. Green loop for a family who has been to Family Camp before,
            amber star for their first. Amber is the card's "notice this household" tone — the
            single-parent mark on line 2 wears it too.
          </p>
        </LegendEntry>
      </>
    ),
  },
  {
    icon: <Home className="h-4 w-4" />,
    title: 'On a cabin card',
    content: (
      <>
        <LegendEntry
          icon={
            <div className="border-muted-foreground/70 h-5 w-5 rounded-[3px] border-2 border-dashed" />
          }
          title="Empty room"
        >
          <p className="text-muted-foreground text-sm">
            A dashed edge means nobody is in it yet — the remaining work is here. It is about the
            room being empty, not about what kind of room it is; a cabin someone is written into is
            not empty and loses the dashes.
          </p>
        </LegendEntry>

        <LegendEntry
          icon={
            <span className="flex items-center gap-0.5">
              <Bath className="text-muted-foreground h-4 w-4" />
              <Plug className="text-muted-foreground h-4 w-4" />
              <Refrigerator className="text-muted-foreground h-4 w-4" />
            </span>
          }
          title="What the room offers"
        >
          <p className="text-muted-foreground text-sm">
            Beside the room name, to read against the family's asks on the card below it.{' '}
            <strong>At most three</strong>, always — bathroom, power and fridge come first, then
            heat, step-free, not-weatherized and AC. A room can offer more than it shows, so the
            three are a summary and not an inventory.
          </p>
        </LegendEntry>

        <LegendEntry
          icon={<span className="text-destructive text-sm font-semibold tabular-nums">5/4</span>}
          title="Placed of capacity"
        >
          <p className="text-muted-foreground text-sm">
            Top-right of the card. Red when more people are placed than the room holds — the figure
            is the whole warning, there is no separate pill. A dash for the capacity means nobody
            has measured the beds.
          </p>
        </LegendEntry>

        <LegendEntry
          icon={
            <div
              style={{ boxShadow: `0 0 0 2px #fff, 0 0 0 4.5px ${CONSENT_AMBER}` }}
              className="h-5 w-5 rounded-full bg-white"
            />
          }
          title="Sharing not consented"
        >
          <p className="text-muted-foreground text-sm">
            An amber ring round the whole card: two families are sharing the same rooms and one of
            them did not ask to share, or never answered the question. The card spells out which, in
            a line of its own. Two families in their own rooms of one combined house are not sharing
            and draw no ring.
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
          title="Area colour"
        >
          <p className="text-muted-foreground text-sm">
            The card's edge colour groups rooms by the area they sit in — the same colour the map
            gives that area's marks. A secondary channel only: nothing depends on telling one hue
            from another.
          </p>
        </LegendEntry>
      </>
    ),
  },
  {
    icon: <Layers className="h-4 w-4" />,
    title: 'While you drag a family',
    content: (
      <>
        <LegendEntry
          icon={<div className="bg-primary/20 border-border h-5 w-5 rounded-[3px] border" />}
          title="This room answers what they asked for"
        >
          <p className="text-muted-foreground text-sm">
            A forest wash while a family is in hand. A lighter wash at rest, before any drag, means
            something different and simpler: the room is empty.
          </p>
        </LegendEntry>

        <LegendEntry
          icon={
            <div className="border-border h-5 w-5 rounded-[3px] border [background-image:repeating-linear-gradient(45deg,transparent_0_4px,hsl(var(--foreground)_/_0.06)_4px_7px)]" />
          }
          title="Something they asked for is missing"
        >
          <p className="text-muted-foreground text-sm">
            Diagonal hatching, and it is a caution rather than a bar — you can still drop here.
            Tight lines mean the room answers none of what they asked; wider lines mean it answers
            some. Graded on bathroom, power and fridge only.
          </p>
        </LegendEntry>

        <LegendEntry
          icon={<div className="border-border h-5 w-5 rounded-[3px] border opacity-40" />}
          title="Not a valid target"
        >
          <p className="text-muted-foreground text-sm">
            Faded and unclickable, only while merging rooms: this one cannot join the merge. Fading
            is the board's one way of saying <em>you may not</em>, and nothing else uses it.
          </p>
        </LegendEntry>
      </>
    ),
  },
]

/**
 * `view` is the weekend tab being looked at. The Housing tab gets the board's
 * own marks; every other tab keeps the older list until it gets a pass of its
 * own. Optional so a caller with no tab in hand still renders something.
 */
export function WeekendLegendButton({ view }: { view?: string }) {
  return <LegendButton sections={view === 'housing' ? WEEKEND_BOARD_SECTIONS : WEEKEND_SECTIONS} />
}
