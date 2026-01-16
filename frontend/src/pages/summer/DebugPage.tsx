/**
 * DebugPage - Phase 1 AI parse analysis debug tool
 *
 * A tabbed interface for analyzing and iterating on Phase 1 AI intent parsing
 * without running the full 3-phase pipeline.
 *
 * Design: Terminal-inspired aesthetic with high contrast and
 * utilitarian feel befitting a debug/developer tool.
 */

import { useState } from 'react';
import { Bug, FileCode, Sparkles, Terminal } from 'lucide-react';
import { ParseAnalysisTab } from '../../components/debug';

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
    disabled: true, // TODO: Implement prompt editor
  },
];

export default function DebugPage() {
  const [activeTab, setActiveTab] = useState<TabId>('parse-analysis');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <div
          className="
            w-12 h-12 rounded-xl flex items-center justify-center
            bg-gradient-to-br from-violet-500 to-purple-600
            shadow-lg shadow-violet-500/30
          "
        >
          <Bug className="w-6 h-6 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            Debug Tools
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-mono bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-400">
              <Terminal className="w-3 h-3" />
              DEV
            </span>
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Analyze and iterate on Phase 1 AI intent parsing
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-border">
        <nav className="flex gap-1" aria-label="Debug tool tabs">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => !tab.disabled && setActiveTab(tab.id)}
              disabled={tab.disabled}
              className={`
                relative inline-flex items-center gap-2 px-4 py-3 text-sm font-medium
                transition-colors border-b-2 -mb-px
                ${
                  activeTab === tab.id
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
                }
                ${tab.disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
              `}
              aria-selected={activeTab === tab.id}
              role="tab"
            >
              {tab.icon}
              {tab.label}
              {tab.disabled && (
                <span className="ml-1 px-1.5 py-0.5 text-[10px] rounded bg-muted text-muted-foreground">
                  Soon
                </span>
              )}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab content */}
      <div role="tabpanel">
        {activeTab === 'parse-analysis' && <ParseAnalysisTab />}
        {activeTab === 'prompt-editor' && (
          <div className="flex items-center justify-center h-64 border-2 border-dashed border-border/50 rounded-xl">
            <div className="flex flex-col items-center gap-3 text-muted-foreground">
              <FileCode className="w-12 h-12 opacity-30" />
              <span className="text-sm font-medium">Prompt Editor Coming Soon</span>
              <span className="text-xs">Edit AI prompts directly in the browser</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
