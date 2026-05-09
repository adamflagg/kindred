import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

import ParseAnalysisPage from './ParseAnalysisPage'

vi.mock('../../components/debug', () => ({
  ParseAnalysisTab: () => <div data-testid="parse-analysis-tab" />,
  PromptEditorTab: () => <div data-testid="prompt-editor-tab" />,
}))

describe('ParseAnalysisPage', () => {
  it('renders the Parse Analysis heading and DebugTabs nav', () => {
    render(
      <MemoryRouter initialEntries={['/summer/debug/parse-analysis']}>
        <ParseAnalysisPage />
      </MemoryRouter>
    )
    expect(screen.getByRole('heading', { name: /parse analysis/i })).toBeInTheDocument()
    // DebugTabs renders four nav links
    expect(screen.getByRole('link', { name: /parse analysis/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /solver stats/i })).toBeInTheDocument()
    expect(screen.getByTestId('parse-analysis-tab')).toBeInTheDocument()
  })
})
