/**
 * DebugPage - Phase 1 AI parse analysis debug tool
 *
 * A tabbed interface for analyzing and iterating on Phase 1 AI intent parsing
 * without running the full 3-phase pipeline.
 *
 * Design: Sierra Lodge aesthetic with warm, nature-inspired tones
 * that match the overall app theme while retaining developer focus.
 */

import { useState } from 'react';
import { Bug, FileCode, Sparkles, Trees } from 'lucide-react';
import { ParseAnalysisTab, PromptEditorTab } from '../../components/debug';

type TabId = 'parse-analysis' | 'prompt-editor';

interface Tab {
  id: TabId;
  label: string;
  icon: React.ReactNode;
  disabled?: boolean;
}

const TABS: Tab[] = [
  {
    id: 'parse-analysis',
    label: 'Parse Analysis',
    icon: <Sparkles className="w-4 h-4" />,
  },
  {
    id: 'prompt-editor',
    label: 'Prompt Editor',
    icon: <FileCode className="w-4 h-4" />,
  },
];

export default function DebugPage() {
  const [activeTab, setActiveTab] = useState<TabId>('parse-analysis');

  return (
    <div className="relative space-y-6">
      {/* Subtle decorative element */}
      <div className="absolute -top-4 right-8 text-forest-200/30 dark:text-forest-800/20 pointer-events-none">
        <Trees className="w-24 h-24" strokeWidth={1} />
      </div>

      {/* Header */}
      <div className="relative flex items-center gap-4">
        <div
          className="
            w-14 h-14 rounded-2xl flex items-center justify-center
            bg-gradient-to-br from-amber-400 to-amber-500
            shadow-lodge shadow-amber-500/25
            ring-4 ring-amber-100 dark:ring-amber-900/30
          "
        >
          <Bug className="w-7 h-7 text-forest-900" />
        </div>
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground">
            Debug Tools
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Analyze and iterate on Phase 1 AI intent parsing
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-border/70">
        <nav className="flex gap-1" aria-label="Debug tool tabs">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => !tab.disabled && setActiveTab(tab.id)}
              disabled={tab.disabled}
              className={`
                relative inline-flex items-center gap-2 px-5 py-3 text-sm font-medium
                transition-all duration-200 border-b-2 -mb-px rounded-t-lg
                ${
                  activeTab === tab.id
                    ? 'border-forest-500 text-forest-700 dark:text-forest-400 bg-forest-50/50 dark:bg-forest-900/20'
                    : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-parchment-200/50 dark:hover:bg-bark-800/30'
                }
                ${tab.disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
              `}
              aria-selected={activeTab === tab.id}
              role="tab"
            >
              {tab.icon}
              {tab.label}
              {tab.disabled && (
                <span className="ml-1 px-1.5 py-0.5 text-[10px] rounded-md bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400 font-semibold">
                  Soon
                </span>
              )}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab content */}
      <div role="tabpanel" className="relative">
        {activeTab === 'parse-analysis' && <ParseAnalysisTab />}
        {activeTab === 'prompt-editor' && <PromptEditorTab />}
      </div>
    </div>
  );
}
