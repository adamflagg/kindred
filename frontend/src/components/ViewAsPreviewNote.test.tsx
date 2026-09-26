import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { AuthContext } from '../contexts/AuthContext'
import { createMockAuthContext, createMockUser } from '../test/test-helpers'
import { writeViewAs } from '../auth/viewAs'
import { ViewAsPreviewNote } from './ViewAsPreviewNote'

function renderAs({ isAdmin, isBypassMode = false }: { isAdmin: boolean; isBypassMode?: boolean }) {
  const ctx = createMockAuthContext({ user: createMockUser({ is_admin: isAdmin }), isBypassMode })
  return render(
    createElement(AuthContext.Provider, { value: ctx }, createElement(ViewAsPreviewNote))
  )
}

describe('ViewAsPreviewNote', () => {
  beforeEach(() => window.sessionStorage.clear())

  it('renders nothing when this window is not previewing', () => {
    const { container } = renderAs({ isAdmin: true })
    expect(container.textContent).toBe('')
  })

  it('names the persona this window is enforcing', () => {
    writeViewAs({ label: 'Registrar', source: 'role', roleId: 'r2', permissions: ['metrics.geo'] })
    renderAs({ isAdmin: true })
    expect(screen.getByText(/Previewing as Registrar/)).toBeTruthy()
  })

  it('names a custom persona by its permission count', () => {
    writeViewAs({ label: 'Custom', source: 'custom', permissions: ['a.b', 'c.d'] })
    renderAs({ isAdmin: true })
    expect(screen.getByText(/Previewing as Custom \(2\)/)).toBeTruthy()
  })

  it('stays silent for a real non-admin, whose stored persona is inert', () => {
    writeViewAs({ label: 'Registrar', source: 'role', permissions: ['metrics.geo'] })
    const { container } = renderAs({ isAdmin: false })
    expect(container.textContent).toBe('')
  })

  it('stays silent in bypass mode', () => {
    writeViewAs({ label: 'Registrar', source: 'role', permissions: ['metrics.geo'] })
    const { container } = renderAs({ isAdmin: true, isBypassMode: true })
    expect(container.textContent).toBe('')
  })
})
