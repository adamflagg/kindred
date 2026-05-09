import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

import PromptEditorPage from './PromptEditorPage'

vi.mock('../../components/debug', () => ({
  ParseAnalysisTab: () => <div data-testid="parse-analysis-tab" />,
  PromptEditorTab: () => <div data-testid="prompt-editor-tab" />,
}))

describe('PromptEditorPage', () => {
  it('renders the Prompt Editor heading and DebugTabs nav', () => {
    render(
      <MemoryRouter initialEntries={['/summer/debug/prompt-editor']}>
        <PromptEditorPage />
      </MemoryRouter>
    )
    expect(screen.getByRole('heading', { name: /prompt editor/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /prompt editor/i })).toBeInTheDocument()
    expect(screen.getByTestId('prompt-editor-tab')).toBeInTheDocument()
  })

  it('does not render the legacy in-page tab strip or Pipeline Debug button', () => {
    render(
      <MemoryRouter initialEntries={['/summer/debug/prompt-editor']}>
        <PromptEditorPage />
      </MemoryRouter>
    )
    // Legacy page had role=tab buttons and a "Pipeline Debug" navigate button
    expect(screen.queryAllByRole('tab')).toHaveLength(0)
    expect(screen.queryByRole('button', { name: /pipeline debug/i })).not.toBeInTheDocument()
  })
})
