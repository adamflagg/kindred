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

interface BunkingLegendProps {
  isOpen: boolean
  onClose: () => void
}

export default function BunkingLegend({ isOpen, onClose }: BunkingLegendProps) {
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
          {/* Camper Card Indicators */}
          <section>
            <h3 className="text-muted-foreground mb-4 flex items-center gap-2 text-sm font-medium tracking-wider uppercase">
              <Users className="h-4 w-4" />
              Camper Indicators
            </h3>
            <div className="space-y-4">
              {/* Unsatisfied Warning */}
              <div className="flex items-start gap-4">
                <div className="flex w-12 flex-shrink-0 justify-center">
                  <AlertTriangle className="h-5 w-5 text-orange-500" />
                </div>
                <div>
                  <p className="text-foreground font-medium">Unsatisfied Requests</p>
                  <p className="text-muted-foreground text-sm">
                    Orange triangle indicates this camper has bunk requests but none are satisfied
                    in their current placement
                  </p>
                </div>
              </div>

              {/* Friend Group Lock */}
              <div className="flex items-start gap-4">
                <div className="flex w-12 flex-shrink-0 justify-center">
                  <span className="inline-flex items-center gap-0.5 text-amber-500">
                    <span className="text-xs font-semibold">3</span>
                    <Lock className="h-4 w-4" />
                  </span>
                </div>
                <div>
                  <p className="text-foreground font-medium">Friend Group</p>
                  <p className="text-muted-foreground text-sm">
                    Lock icon with number shows camper is in a friend group. The number indicates
                    group size. Color matches the group's assigned color.
                  </p>
                </div>
              </div>

              {/* Pending Selection */}
              <div className="flex items-start gap-4">
                <div className="flex w-12 flex-shrink-0 justify-center">
                  <div className="pending-lock-glow h-6 w-10 rounded-lg border-2 border-amber-400 bg-amber-400/10" />
                </div>
                <div>
                  <p className="text-foreground font-medium">Pending Selection</p>
                  <p className="text-muted-foreground text-sm">
                    Amber glowing border indicates camper is selected for a new friend group. Use
                    Ctrl+Click to add more campers.
                  </p>
                </div>
              </div>

              {/* Name Glow */}
              <div className="flex items-start gap-4">
                <div className="flex w-12 flex-shrink-0 justify-center">
                  <span
                    className="text-sm font-medium"
                    style={{
                      textShadow: '0 0 8px #10b981, 0 0 12px #10b98180',
                    }}
                  >
                    Name
                  </span>
                </div>
                <div>
                  <p className="text-foreground font-medium">Group Name Glow</p>
                  <p className="text-muted-foreground text-sm">
                    Camper names glow in their friend group's color for easy visual identification
                  </p>
                </div>
              </div>

              {/* Gender Card Color */}
              <div className="flex items-start gap-4">
                <div className="flex w-12 flex-shrink-0 items-center justify-center gap-1">
                  <div className="h-5 w-3 rounded border-2 border-blue-300 bg-blue-100 dark:border-blue-700 dark:bg-blue-900/30" />
                  <div className="h-5 w-3 rounded border-2 border-pink-300 bg-pink-100 dark:border-pink-700 dark:bg-pink-900/30" />
                  <div className="h-5 w-3 rounded border-2 border-purple-300 bg-purple-100 dark:border-purple-700 dark:bg-purple-900/30" />
                </div>
                <div>
                  <p className="text-foreground font-medium">Gender Card Color</p>
                  <p className="text-muted-foreground text-sm">
                    Card background color reflects gender identity: blue = boy/man, pink =
                    girl/woman, purple = all other identities
                  </p>
                </div>
              </div>

              {/* Prior Year History */}
              <div className="flex items-start gap-4">
                <div className="flex w-12 flex-shrink-0 justify-center">
                  <History className="text-muted-foreground h-5 w-5" />
                </div>
                <div>
                  <p className="text-foreground font-medium">Prior-Year History</p>
                  <p className="text-muted-foreground text-sm">
                    Dim text on the right of the card shows where this camper bunked last year
                    (e.g.&nbsp;"S1 B-4"). Blank if this is the camper's first year.
                  </p>
                </div>
              </div>
            </div>
          </section>

          {/* Bunk Card Indicators */}
          <section>
            <h3 className="text-muted-foreground mb-4 flex items-center gap-2 text-sm font-medium tracking-wider uppercase">
              <Home className="h-4 w-4" />
              Bunk Indicators
            </h3>
            <div className="space-y-4">
              {/* Capacity Bar */}
              <div className="flex items-start gap-4">
                <div className="flex w-12 flex-shrink-0 justify-center pt-1">
                  <div className="bg-muted h-2 w-10 overflow-hidden rounded-full">
                    <div className="bg-primary h-2 rounded-full" style={{ width: '60%' }} />
                  </div>
                </div>
                <div>
                  <p className="text-foreground font-medium">Capacity Bar</p>
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
                </div>
              </div>

              {/* Social Graph Button */}
              <div className="flex items-start gap-4">
                <div className="flex w-12 flex-shrink-0 justify-center">
                  <div className="bg-muted flex h-8 w-8 items-center justify-center rounded-lg">
                    <Network className="text-muted-foreground h-4 w-4" />
                  </div>
                </div>
                <div>
                  <p className="text-foreground font-medium">Social Graph</p>
                  <p className="text-muted-foreground text-sm">
                    Opens a network visualization showing friendship requests between campers in
                    this bunk. Green edges = mutual requests, amber = one-way.
                  </p>
                </div>
              </div>

              {/* Bunk Warnings */}
              <div className="flex items-start gap-4">
                <div className="flex w-12 flex-shrink-0 justify-center">
                  <div className="border-destructive/50 bg-destructive/5 flex h-8 w-10 items-center justify-center rounded-lg border-2">
                    <span className="text-sm">⚠️</span>
                  </div>
                </div>
                <div>
                  <p className="text-foreground font-medium">Bunk Warnings</p>
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
                </div>
              </div>

              {/* Active Drop Target */}
              <div className="flex items-start gap-4">
                <div className="flex w-12 flex-shrink-0 justify-center">
                  <div className="ring-primary bg-primary/5 h-8 w-10 rounded-lg ring-2" />
                </div>
                <div>
                  <p className="text-foreground font-medium">Active Drop Target</p>
                  <p className="text-muted-foreground text-sm">
                    Blue ring highlights the bunk currently being dragged over, showing it will
                    accept the camper on release
                  </p>
                </div>
              </div>

              {/* Invalid Drop Target */}
              <div className="flex items-start gap-4">
                <div className="flex w-12 flex-shrink-0 justify-center">
                  <div className="bg-muted/50 h-8 w-10 rounded-lg opacity-40" />
                </div>
                <div>
                  <p className="text-foreground font-medium">Invalid Drop Target</p>
                  <p className="text-muted-foreground text-sm">
                    Grayed out bunks cannot accept the camper being dragged (wrong gender or grade
                    mismatch for AG sessions)
                  </p>
                </div>
              </div>
            </div>
          </section>

          {/* Working Modes */}
          <section>
            <h3 className="text-muted-foreground mb-4 flex items-center gap-2 text-sm font-medium tracking-wider uppercase">
              <Layers className="h-4 w-4" />
              Working Modes
            </h3>
            <div className="space-y-4">
              {/* Scenario Badge */}
              <div className="flex items-start gap-4">
                <div className="flex w-12 flex-shrink-0 justify-center">
                  <span className="inline-flex items-center gap-1 rounded-lg border border-emerald-300 bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
                    Draft
                  </span>
                </div>
                <div>
                  <p className="text-foreground font-medium">Scenario Mode</p>
                  <p className="text-muted-foreground text-sm">
                    Working in a draft scenario. Drag-and-drop is enabled. Changes won't affect live
                    assignments until published.
                  </p>
                </div>
              </div>

              {/* Production Mode */}
              <div className="flex items-start gap-4">
                <div className="flex w-12 flex-shrink-0 justify-center">
                  <span className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
                    Live
                  </span>
                </div>
                <div>
                  <p className="text-foreground font-medium">Production Mode</p>
                  <p className="text-muted-foreground text-sm">
                    Viewing live CampMinder data. Drag-and-drop is disabled. Select a scenario or
                    create a new one to make edits.
                  </p>
                </div>
              </div>
            </div>
          </section>
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

export function BunkingLegendButton() {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <>
      <button onClick={() => setIsOpen(true)} className="btn-ghost p-2" title="Show visual guide">
        <HelpCircle className="h-5 w-5" />
      </button>
      <BunkingLegend isOpen={isOpen} onClose={() => setIsOpen(false)} />
    </>
  )
}
