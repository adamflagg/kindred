import type { ReactNode } from 'react'

const MARK_CLASS = 'bg-amber-200 dark:bg-amber-800/50 rounded px-0.5'

/**
 * Highlight the AI's captured source fragment inside the original source text.
 *
 * The fragment is the verbatim substring that Phase 1 AI parsing identified as
 * supporting this particular request. A simple case-sensitive `indexOf` is
 * sufficient because the fragment was extracted from the same source text.
 *
 * If the fragment is empty, null, or cannot be located in the source (e.g. the
 * AI paraphrased instead of quoting), the source text is returned unchanged.
 */
export function highlightSourceText(
  sourceText: string | null | undefined,
  sourceFragment: string | null | undefined
): ReactNode {
  if (!sourceText) return ''
  if (!sourceFragment) return sourceText

  const idx = sourceText.indexOf(sourceFragment)
  if (idx === -1) return sourceText

  const before = sourceText.slice(0, idx)
  const match = sourceText.slice(idx, idx + sourceFragment.length)
  const after = sourceText.slice(idx + sourceFragment.length)

  return (
    <>
      {before}
      <mark className={MARK_CLASS}>{match}</mark>
      {after}
    </>
  )
}
