import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { FullPageSpinner } from './FullPageSpinner'

describe('FullPageSpinner', () => {
  it('keeps role="status" — ProtectedRoute.test.tsx queries by it — but renders no sr-only "Loading" text (kindred#2348)', () => {
    // Regression: a `<span className="sr-only">Loading</span>` sat beside
    // the spinning icon. No assistive tech reads this app
    // (`frontend/CLAUDE.md`), and the icon alone already reads as loading —
    // deleted along with the text, but NOT the `role="status"` on the
    // wrapper, which `ProtectedRoute.test.tsx` and `AdminRoute`'s tests use
    // as their query handle for "still loading" (test infrastructure, kept
    // per policy).
    render(<FullPageSpinner />)
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.queryByText('Loading')).not.toBeInTheDocument()
  })
})
