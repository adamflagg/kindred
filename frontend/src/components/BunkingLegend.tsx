import React from 'react';
import { HelpCircle, X, Lock, AlertTriangle, Users, Home, Network, Layers } from 'lucide-react';

interface BunkingLegendProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function BunkingLegend({ isOpen, onClose }: BunkingLegendProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
      <div className="card-lodge max-w-2xl w-full max-h-[90vh] overflow-hidden shadow-lodge-lg animate-scale-in">
        {/* Header */}
        <div className="bg-muted/50 px-6 py-4 border-b border-border flex justify-between items-center">
          <h2 className="text-xl font-display font-bold text-foreground flex items-center gap-2">
            <HelpCircle className="w-5 h-5 text-primary" />
            Visual Guide
          </h2>
          <button
            onClick={onClose}
            className="btn-ghost p-2"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        {/* Content */}
        <div className="overflow-y-auto max-h-[calc(90vh-8rem)] p-6 space-y-8">

          {/* Camper Card Indicators */}
          <section>
            <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4 flex items-center gap-2">
              <Users className="w-4 h-4" />
              Camper Indicators
            </h3>
            <div className="space-y-4">
              {/* Unsatisfied Warning */}
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 w-12 flex justify-center">
                  <AlertTriangle className="w-5 h-5 text-orange-500" />
                </div>
                <div>
                  <p className="font-medium text-foreground">Unsatisfied Requests</p>
                  <p className="text-sm text-muted-foreground">Orange triangle indicates this camper has bunk requests but none are satisfied in their current placement</p>
                </div>
              </div>

              {/* Friend Group Lock */}
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 w-12 flex justify-center">
                  <span className="inline-flex items-center gap-0.5 text-amber-500">
                    <span className="text-xs font-semibold">3</span>
                    <Lock className="w-4 h-4" />
                  </span>
                </div>
                <div>
                  <p className="font-medium text-foreground">Friend Group</p>
                  <p className="text-sm text-muted-foreground">Lock icon with number shows camper is in a friend group. The number indicates group size. Color matches the group's assigned color.</p>
                </div>
              </div>

              {/* Pending Selection */}
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 w-12 flex justify-center">
                  <div className="w-10 h-6 rounded-lg border-2 border-amber-400 bg-amber-400/10 pending-lock-glow" />
                </div>
                <div>
                  <p className="font-medium text-foreground">Pending Selection</p>
                  <p className="text-sm text-muted-foreground">Amber glowing border indicates camper is selected for a new friend group. Use Ctrl+Click to add more campers.</p>
                </div>
              </div>

              {/* Name Glow */}
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 w-12 flex justify-center">
                  <span className="font-medium text-sm" style={{ textShadow: '0 0 8px #10b981, 0 0 12px #10b98180' }}>
                    Name
                  </span>
                </div>
                <div>
                  <p className="font-medium text-foreground">Group Name Glow</p>
                  <p className="text-sm text-muted-foreground">Camper names glow in their friend group's color for easy visual identification</p>
                </div>
              </div>
            </div>
          </section>

          {/* Bunk Card Indicators */}
          <section>
            <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4 flex items-center gap-2">
              <Home className="w-4 h-4" />
              Bunk Indicators
            </h3>
            <div className="space-y-4">
              {/* Capacity Bar */}
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 w-12 flex justify-center pt-1">
                  <div className="w-10 bg-muted rounded-full h-2 overflow-hidden">
                    <div className="h-2 rounded-full bg-primary" style={{ width: '60%' }} />
                  </div>
                </div>
                <div>
                  <p className="font-medium text-foreground">Capacity Bar</p>
                  <p className="text-sm text-muted-foreground mb-2">Shows beds filled with color-coded status:</p>
                  <div className="flex flex-wrap gap-3 text-xs">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-primary" />
                      <span className="text-muted-foreground">&lt;70%</span>
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-yellow-500" />
                      <span className="text-muted-foreground">70-90%</span>
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-orange-500" />
                      <span className="text-muted-foreground">90-100%</span>
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-destructive" />
                      <span className="text-muted-foreground">Over</span>
                    </span>
                  </div>
                </div>
              </div>

              {/* Social Graph Button */}
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 w-12 flex justify-center">
                  <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center">
                    <Network className="w-4 h-4 text-muted-foreground" />
                  </div>
                </div>
                <div>
                  <p className="font-medium text-foreground">Social Graph</p>
                  <p className="text-sm text-muted-foreground">Opens a network visualization showing friendship requests between campers in this bunk. Green edges = mutual requests, amber = one-way.</p>
                </div>
              </div>

              {/* Bunk Warnings */}
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 w-12 flex justify-center">
                  <div className="w-10 h-8 rounded-lg border-2 border-destructive/50 bg-destructive/5 flex items-center justify-center">
                    <span className="text-sm">⚠️</span>
                  </div>
                </div>
                <div>
                  <p className="font-medium text-foreground">Bunk Warnings</p>
                  <p className="text-sm text-muted-foreground mb-2">Red border indicates issues:</p>
                  <ul className="text-sm text-muted-foreground space-y-1">
                    <li className="flex items-center gap-2">
                      <span className="w-1 h-1 rounded-full bg-muted-foreground" />
                      Over capacity (more than 12 campers)
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="w-1 h-1 rounded-full bg-muted-foreground" />
                      Age spread exceeds 24 months
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="w-1 h-1 rounded-full bg-muted-foreground" />
                      Grade ratio exceeds 67% from one grade
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="w-1 h-1 rounded-full bg-muted-foreground" />
                      More than 2 different grades in bunk
                    </li>
                  </ul>
                </div>
              </div>

              {/* Invalid Drop Target */}
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 w-12 flex justify-center">
                  <div className="w-10 h-8 rounded-lg bg-muted/50 opacity-40" />
                </div>
                <div>
                  <p className="font-medium text-foreground">Invalid Drop Target</p>
                  <p className="text-sm text-muted-foreground">Grayed out bunks cannot accept the camper being dragged (wrong gender or grade mismatch for AG sessions)</p>
                </div>
              </div>
            </div>
          </section>

          {/* Working Modes */}
          <section>
            <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4 flex items-center gap-2">
              <Layers className="w-4 h-4" />
              Working Modes
            </h3>
            <div className="space-y-4">
              {/* Scenario Badge */}
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 w-12 flex justify-center">
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-semibold bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700">
                    Draft
                  </span>
                </div>
                <div>
                  <p className="font-medium text-foreground">Scenario Mode</p>
                  <p className="text-sm text-muted-foreground">Working in a draft scenario. Drag-and-drop is enabled. Changes won't affect live assignments until published.</p>
                </div>
              </div>

              {/* Production Mode */}
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 w-12 flex justify-center">
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-semibold bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300 border border-amber-300 dark:border-amber-700">
                    Live
                  </span>
                </div>
                <div>
                  <p className="font-medium text-foreground">Production Mode</p>
                  <p className="text-sm text-muted-foreground">Viewing live CampMinder data. Drag-and-drop is disabled. Select a scenario or create a new one to make edits.</p>
                </div>
              </div>
            </div>
          </section>

        </div>

        {/* Footer */}
        <div className="bg-muted/50 px-6 py-4 border-t border-border flex justify-end">
          <button
            onClick={onClose}
            className="btn-primary"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}

export function BunkingLegendButton() {
  const [isOpen, setIsOpen] = React.useState(false);

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="btn-ghost p-2"
        title="Show visual guide"
      >
        <HelpCircle className="w-5 h-5" />
      </button>
      <BunkingLegend isOpen={isOpen} onClose={() => setIsOpen(false)} />
    </>
  );
}
