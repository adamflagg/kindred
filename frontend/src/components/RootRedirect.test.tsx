import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Program } from '../contexts/ProgramContext'
import { RootRedirect } from './RootRedirect'

let saved: Program | null = null
let granted: string[] = []

vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ isLoading: false }) }))
vi.mock('../contexts/ProgramContext', () => ({
  useProgram: () => ({ currentProgram: saved, setProgram: vi.fn(), clearProgram: vi.fn() }),
}))
vi.mock('../hooks/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: (p: string) => granted.includes(p) }),
}))
vi.mock('../pages/ProgramLandingPage', () => ({ default: () => <div>Program picker</div> }))

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>
}

function renderRoot() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<RootRedirect />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>
  )
}

beforeEach(() => {
  saved = null
  granted = []
})

describe('RootRedirect', () => {
  it('opens a saved program the user can open', () => {
    saved = 'summer'
    renderRoot()
    expect(screen.getByTestId('where')).toHaveTextContent('/summer/sessions')
  })

  it('opens Camperships for a saved choice the user still holds', () => {
    saved = 'aid'
    granted = ['financial_aid.view']
    renderRoot()
    expect(screen.getByTestId('where')).toHaveTextContent('/aid')
  })

  it('falls back to the picker when the saved program is no longer permitted (spec §3.1)', () => {
    saved = 'aid'
    renderRoot()
    expect(screen.getByText('Program picker')).toBeInTheDocument()
  })

  it('shows the picker when nothing is saved', () => {
    renderRoot()
    expect(screen.getByText('Program picker')).toBeInTheDocument()
  })
})
