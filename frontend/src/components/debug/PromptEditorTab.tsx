/**
 * PromptEditorTab - Edit AI prompts directly in the browser
 *
 * A full-featured prompt editor with CodeMirror for syntax highlighting,
 * unsaved changes detection, and save functionality.
 *
 * Design: Sierra Lodge aesthetic with warm, nature-inspired tones
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Check, ChevronDown, Clock, FileText, Loader2, Save } from 'lucide-react';
import { EditorView, basicSetup } from 'codemirror';
import type { ViewUpdate } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { oneDark } from '@codemirror/theme-one-dark';
import { usePromptsList, usePrompt, useUpdatePrompt } from '../../hooks/useParseAnalysis';
import { useTheme } from '../../hooks/useTheme';

/**
 * Format a prompt name for display
 * e.g. "parse_bunk_with" -> "Parse Bunk With"
 */
function formatPromptName(name: string): string {
  return name
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Format a date string for display
 */
function formatDate(dateStr: string | null): string {
  if (!dateStr) return 'Unknown';
  try {
    return new Date(dateStr).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return 'Unknown';
  }
}

// Light theme for CodeMirror
const lightTheme = EditorView.theme({
  '&': {
    backgroundColor: '#faf8f5',
    color: '#2d3a2e',
  },
  '.cm-content': {
    caretColor: '#006d4a',
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: '#006d4a',
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: '#d4e8dc',
  },
  '.cm-gutters': {
    backgroundColor: '#f0ece6',
    color: '#8a8378',
    border: 'none',
  },
  '.cm-activeLineGutter': {
    backgroundColor: '#e8e4dc',
  },
  '.cm-activeLine': {
    backgroundColor: '#f5f2ed',
  },
});

export function PromptEditorTab() {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  // State - user-selected prompt (null means use first from list)
  const [userSelectedPrompt, setUserSelectedPrompt] = useState<string | null>(null);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [editorContent, setEditorContent] = useState<string>('');
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [lastLoadedPromptName, setLastLoadedPromptName] = useState<string | null>(null);

  // Queries and mutations
  const { data: promptsData, isLoading: isLoadingList, error: listError } = usePromptsList();

  // Derive the effective selected prompt (user selection or first from list)
  const selectedPrompt = useMemo(() => {
    if (userSelectedPrompt) return userSelectedPrompt;
    return promptsData?.prompts?.[0]?.name ?? null;
  }, [userSelectedPrompt, promptsData]);

  const { data: promptContent, isLoading: isLoadingContent, error: contentError } = usePrompt(selectedPrompt);
  const updatePromptMutation = useUpdatePrompt();

  // Combined error for display
  const queryError = listError || contentError;

  // Update editor content when prompt loads
  useEffect(() => {
    if (promptContent?.content && selectedPrompt !== lastLoadedPromptName) {
      setEditorContent(promptContent.content);
      setHasUnsavedChanges(false);
      setLastLoadedPromptName(selectedPrompt);
    }
  }, [promptContent, selectedPrompt, lastLoadedPromptName]);

  // Setup CodeMirror
  useEffect(() => {
    if (!editorRef.current) return;

    // Destroy existing editor
    if (viewRef.current) {
      viewRef.current.destroy();
    }

    const state = EditorState.create({
      doc: editorContent,
      extensions: [
        basicSetup,
        markdown(),
        isDark ? oneDark : lightTheme,
        EditorView.updateListener.of((update: ViewUpdate) => {
          if (update.docChanged) {
            const newContent = update.state.doc.toString();
            setEditorContent(newContent);
            // Check if content differs from original
            if (promptContent?.content) {
              setHasUnsavedChanges(newContent !== promptContent.content);
            }
          }
        }),
        EditorView.theme({
          '&': {
            height: '100%',
            fontSize: '14px',
          },
          '.cm-scroller': {
            overflow: 'auto',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
          },
        }),
      ],
    });

    viewRef.current = new EditorView({
      state,
      parent: editorRef.current,
    });

    return () => {
      viewRef.current?.destroy();
    };
  }, [editorContent, isDark, promptContent?.content]);

  // Handle save
  const handleSave = useCallback(async () => {
    if (!selectedPrompt || !hasUnsavedChanges) return;

    try {
      await updatePromptMutation.mutateAsync({
        name: selectedPrompt,
        content: editorContent,
      });
      setHasUnsavedChanges(false);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (error) {
      console.error('Failed to save prompt:', error);
    }
  }, [selectedPrompt, hasUnsavedChanges, editorContent, updatePromptMutation]);

  // Keyboard shortcut for save
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSave]);

  // Warn about unsaved changes on navigation
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges]);

  // Selected prompt metadata
  const selectedPromptMeta = useMemo(() => {
    return promptsData?.prompts?.find((p) => p.name === selectedPrompt);
  }, [promptsData, selectedPrompt]);

  const isLoading = isLoadingList || isLoadingContent;

  return (
    <div className="space-y-4">
      {/* Header row with dropdown and save button */}
      <div className="flex items-center justify-between gap-4">
        {/* Prompt selector dropdown */}
        <div className="relative">
          <button
            onClick={() => setIsDropdownOpen(!isDropdownOpen)}
            disabled={isLoadingList}
            className={`
              flex items-center gap-3 px-4 py-2.5 rounded-xl border-2
              bg-white dark:bg-bark-800
              border-bark-200 dark:border-bark-600
              hover:border-forest-300 dark:hover:border-forest-600
              transition-all duration-200
              min-w-[280px] text-left
              ${isDropdownOpen ? 'ring-2 ring-forest-500/30 border-forest-400 dark:border-forest-500' : ''}
            `}
          >
            <FileText className="w-4 h-4 text-forest-600 dark:text-forest-400 flex-shrink-0" />
            <span className="flex-1 font-medium text-foreground truncate">
              {selectedPrompt ? formatPromptName(selectedPrompt) : 'Select a prompt...'}
            </span>
            {isLoadingList ? (
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            ) : (
              <ChevronDown
                className={`w-4 h-4 text-muted-foreground transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`}
              />
            )}
          </button>

          {/* Dropdown menu */}
          {isDropdownOpen && promptsData?.prompts && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setIsDropdownOpen(false)} />
              <div
                className="
                  absolute top-full left-0 mt-2 z-20
                  w-full min-w-[280px]
                  bg-white dark:bg-bark-800
                  border-2 border-bark-200 dark:border-bark-600
                  rounded-xl shadow-lodge overflow-hidden
                "
              >
                {promptsData.prompts.map((prompt) => (
                  <button
                    key={prompt.name}
                    onClick={() => {
                      if (hasUnsavedChanges) {
                        const confirmSwitch = window.confirm(
                          'You have unsaved changes. Are you sure you want to switch prompts?'
                        );
                        if (!confirmSwitch) return;
                      }
                      // Reset the loaded prompt name so content will load for the new prompt
                      setLastLoadedPromptName(null);
                      setUserSelectedPrompt(prompt.name);
                      setIsDropdownOpen(false);
                    }}
                    className={`
                      w-full px-4 py-3 text-left flex items-center gap-3
                      transition-colors duration-150
                      ${
                        selectedPrompt === prompt.name
                          ? 'bg-forest-50 dark:bg-forest-900/30 text-forest-700 dark:text-forest-400'
                          : 'hover:bg-parchment-100 dark:hover:bg-bark-700/50 text-foreground'
                      }
                    `}
                  >
                    <FileText className="w-4 h-4 flex-shrink-0" />
                    <span className="flex-1 font-medium truncate">{formatPromptName(prompt.name)}</span>
                    {selectedPrompt === prompt.name && <Check className="w-4 h-4 text-forest-600" />}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Save button */}
        <button
          onClick={handleSave}
          disabled={!hasUnsavedChanges || updatePromptMutation.isPending}
          className={`
            btn-primary !rounded-xl flex items-center gap-2
            disabled:opacity-50 disabled:cursor-not-allowed
            ${saveSuccess ? '!bg-forest-600 !border-forest-600' : ''}
          `}
        >
          {updatePromptMutation.isPending ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Saving...
            </>
          ) : saveSuccess ? (
            <>
              <Check className="w-4 h-4" />
              Saved!
            </>
          ) : (
            <>
              <Save className="w-4 h-4" />
              Save
            </>
          )}
        </button>
      </div>

      {/* Editor container */}
      <div className="card-lodge overflow-hidden">
        {/* Status bar */}
        <div
          className="
            flex items-center justify-between gap-4 px-4 py-2.5
            border-b-2 border-bark-200/70 dark:border-bark-700/70
            bg-parchment-100/50 dark:bg-bark-900/30
          "
        >
          <div className="flex items-center gap-3 text-sm">
            {selectedPromptMeta && (
              <>
                <span className="font-mono text-xs px-2 py-0.5 rounded-md bg-bark-100 dark:bg-bark-700 text-bark-600 dark:text-bark-300">
                  {selectedPromptMeta.filename}
                </span>
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <Clock className="w-3.5 h-3.5" />
                  {formatDate(promptContent?.modified_at ?? selectedPromptMeta.modified_at)}
                </span>
              </>
            )}
          </div>

          <div className="flex items-center gap-2">
            {hasUnsavedChanges && (
              <span className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400 text-sm font-medium">
                <AlertCircle className="w-3.5 h-3.5" />
                Unsaved changes
              </span>
            )}
          </div>
        </div>

        {/* CodeMirror editor */}
        <div className="relative" style={{ height: '500px' }}>
          {isLoading ? (
            <div className="absolute inset-0 flex items-center justify-center bg-parchment-100/50 dark:bg-bark-900/30">
              <div className="flex flex-col items-center gap-3">
                <Loader2 className="w-8 h-8 animate-spin text-forest-600" />
                <span className="text-sm text-muted-foreground">Loading prompt...</span>
              </div>
            </div>
          ) : (
            <div ref={editorRef} className="h-full overflow-hidden" />
          )}
        </div>
      </div>

      {/* Query error display */}
      {queryError && (
        <div className="card-lodge p-4 bg-rose-50 dark:bg-rose-950/30 !border-rose-200 dark:!border-rose-800">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-rose-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-rose-800 dark:text-rose-300">Failed to Load Prompts</p>
              <p className="mt-1 text-sm text-rose-700 dark:text-rose-400">
                {queryError instanceof Error ? queryError.message : 'An unknown error occurred'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Save error display */}
      {updatePromptMutation.isError && (
        <div className="card-lodge p-4 bg-rose-50 dark:bg-rose-950/30 !border-rose-200 dark:!border-rose-800">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-rose-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-rose-800 dark:text-rose-300">Save Failed</p>
              <p className="mt-1 text-sm text-rose-700 dark:text-rose-400">
                {updatePromptMutation.error instanceof Error
                  ? updatePromptMutation.error.message
                  : 'An unknown error occurred'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Keyboard shortcut hint */}
      <p className="text-xs text-muted-foreground text-center">
        Press <kbd className="px-1.5 py-0.5 rounded bg-bark-100 dark:bg-bark-700 font-mono">Ctrl+S</kbd> or{' '}
        <kbd className="px-1.5 py-0.5 rounded bg-bark-100 dark:bg-bark-700 font-mono">Cmd+S</kbd> to save
      </p>
    </div>
  );
}
