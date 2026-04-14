import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { highlightSourceText } from './highlightSourceText'

function renderToString(node: React.ReactNode): string {
  const { container } = render(<>{node}</>)
  return container.innerHTML
}

describe('highlightSourceText', () => {
  it('returns plain text when fragment is empty', () => {
    const out = highlightSourceText('Emma and Liam please', '')
    const html = renderToString(out)
    expect(html).not.toContain('<mark')
    expect(html).toContain('Emma and Liam please')
  })

  it('returns plain text when fragment is null or undefined', () => {
    const out = highlightSourceText('Emma and Liam please', null)
    const html = renderToString(out)
    expect(html).not.toContain('<mark')
  })

  it('returns plain text when source is empty', () => {
    const out = highlightSourceText('', 'Emma')
    const html = renderToString(out)
    expect(html).toBe('')
  })

  it('wraps a single match in <mark>', () => {
    const out = highlightSourceText('wants to be with Emma please', 'with Emma')
    const html = renderToString(out)
    expect(html).toContain('<mark')
    expect(html).toContain('with Emma')
    expect(html).toContain('wants to be ')
    expect(html).toContain(' please')
  })

  it('preserves original casing inside the <mark>', () => {
    const out = highlightSourceText('With Emma please', 'With Emma')
    const html = renderToString(out)
    expect(html).toContain('>With Emma<')
  })

  it('does not match case-insensitively (fragment must be verbatim)', () => {
    // Fragment casing must match source exactly; if it does not, no highlight.
    const out = highlightSourceText('Wants Emma please', 'wants emma')
    const html = renderToString(out)
    expect(html).not.toContain('<mark')
  })

  it('highlights only the first occurrence when fragment appears multiple times', () => {
    const out = highlightSourceText('Emma and Emma and Emma', 'Emma')
    const html = renderToString(out)
    // Expect exactly one <mark> element
    const markCount = (html.match(/<mark/g) ?? []).length
    expect(markCount).toBe(1)
  })

  it('returns plain text when fragment is not found in source', () => {
    // Graceful degradation when AI paraphrased instead of quoting verbatim
    const out = highlightSourceText('Emma please', 'Sarah please')
    const html = renderToString(out)
    expect(html).not.toContain('<mark')
    expect(html).toContain('Emma please')
  })

  it('handles fragments with regex special characters safely', () => {
    const out = highlightSourceText('not (Emma) please', '(Emma)')
    const html = renderToString(out)
    expect(html).toContain('<mark')
    expect(html).toContain('(Emma)')
  })

  it('returns plain text when fragment equals the entire source (whole-list AI bug)', () => {
    // When the AI returns the full comma-separated list as the fragment for every
    // individual request, highlighting everything adds no value — degrade to plain text.
    const list = 'Sasha Doerig-Krugman, Edo Firstenberg, Dean Roitman'
    const out = highlightSourceText(list, list)
    const html = renderToString(out)
    expect(html).not.toContain('<mark')
    expect(html).toContain(list)
  })

  it('still highlights when fragment is a proper subset of the source', () => {
    // Sanity check: a name-only entry from a comma list should still highlight.
    const out = highlightSourceText(
      'Sasha Doerig-Krugman, Edo Firstenberg, Dean Roitman',
      'Edo Firstenberg'
    )
    const html = renderToString(out)
    expect(html).toContain('<mark')
    expect(html).toContain('Edo Firstenberg')
  })
})
