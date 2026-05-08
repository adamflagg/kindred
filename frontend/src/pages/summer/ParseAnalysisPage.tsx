import { Sparkles, Trees } from 'lucide-react'

import { ParseAnalysisTab } from '../../components/debug'
import { DebugTabs } from '../../components/debug/DebugTabs'

export default function ParseAnalysisPage() {
  return (
    <div className="relative space-y-6">
      <div className="text-forest-200/30 dark:text-forest-800/20 pointer-events-none absolute -top-4 right-8">
        <Trees className="h-24 w-24" strokeWidth={1} />
      </div>

      <div className="relative flex items-center gap-4" data-tour="debug-header">
        <div className="shadow-lodge flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-amber-500 ring-4 shadow-amber-500/25 ring-amber-100 dark:ring-amber-900/30">
          <Sparkles className="text-forest-900 h-7 w-7" />
        </div>
        <div className="flex-1">
          <h1 className="font-display text-foreground text-2xl font-bold">Parse Analysis</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Analyze Phase 1 intent parsing for bunk requests
          </p>
        </div>
      </div>

      <DebugTabs />
      <ParseAnalysisTab />
    </div>
  )
}
