/**
 * DebugPage - Phase 1 AI parse analysis debug tool
 *
 * A tabbed interface for analyzing and iterating on Phase 1 AI intent parsing
 * without running the full 3-phase pipeline.
 *
 * Design: Sierra Lodge aesthetic with warm, nature-inspired tones
 * that match the overall app theme while retaining developer focus.
 */

import { useState } from 'react'
import { Bug, FileCode, Sparkles, Trees } from 'lucide-react'
import { ParseAnalysisTab, PromptEditorTab } from '../../components/debug'
import { useTour } from '../../hooks/useTour'
import { TourReplayButton } from '../../components/tour'

type TabId = 'parse-analysis' | 'prompt-editor'

interface Tab {
  id: TabId
  label: string
  icon: React.ReactNode
  disabled?: boolean
}

const TABS: Tab[] = [
  {
    id: 'parse-analysis',
    label: 'Parse Analysis',
    icon: <Sparkles className="h-4 w-4" />,
  },
  {
    id: 'prompt-editor',
    label: 'Prompt Editor',
    icon: <FileCode className="h-4 w-4" />,
  },
]

export default function DebugPage() {
  const [activeTab, setActiveTab] = useState<TabId>('parse-analysis')
  const { tourId, replay } = useTour()

  return (
    <div className="relative space-y-6">
      {/* Subtle decorative element */}
      <div className="text-forest-200/30 dark:text-forest-800/20 pointer-events-none absolute -top-4 right-8">
        <Trees className="h-24 w-24" strokeWidth={1} />
      </div>

      {/* Header */}
      <div className="relative flex items-center gap-4" data-tour="debug-header">
        <div className="shadow-lodge flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-amber-500 ring-4 shadow-amber-500/25 ring-amber-100 dark:ring-amber-900/30">
          <Bug className="text-forest-900 h-7 w-7" />
        </div>
        <div className="flex-1">
          <h1 className="font-display text-foreground text-2xl font-bold">Debug Tools</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Analyze and iterate on Phase 1 AI intent parsing
          </p>
        </div>
        <TourReplayButton tourId={tourId} onReplay={replay} />
      </div>

      {/* Tabs */}
      <div className="border-border/70 border-b" data-tour="debug-tabs">
        <nav className="flex gap-1" aria-label="Debug tool tabs">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => !tab.disabled && setActiveTab(tab.id)}
              disabled={tab.disabled}
              className={`relative -mb-px inline-flex items-center gap-2 rounded-t-lg border-b-2 px-5 py-3 text-sm font-medium transition-all duration-200 ${
                activeTab === tab.id
                  ? 'border-forest-500 text-forest-700 dark:text-forest-400 bg-forest-50/50 dark:bg-forest-900/20'
                  : 'text-muted-foreground hover:text-foreground hover:bg-parchment-200/50 dark:hover:bg-bark-800/30 border-transparent'
              } ${tab.disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'} `}
              aria-selected={activeTab === tab.id}
              role="tab"
            >
              {tab.icon}
              {tab.label}
              {tab.disabled && (
                <span className="ml-1 rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">
                  Soon
                </span>
              )}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab content */}
      <div role="tabpanel" className="relative" data-tour="debug-content">
        {activeTab === 'parse-analysis' && <ParseAnalysisTab />}
        {activeTab === 'prompt-editor' && <PromptEditorTab />}
      </div>
    </div>
  )
}
