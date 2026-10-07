/**
 * The promotion dialog on its own (D39; Decision 21). Its cases moved here from FitAndPromotion.test.tsx when today's
 * Scenarios screen retired (plan Task 71). They open the dialog from a stand-in for the Compare column's link and
 * assert what they asserted there: regression guards, since the dialog does not change in that commit. Task 78
 * restates its words for the Scenarios addendum (§S5 I).
 */
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AidApiError, AidWriteError } from '../../../../services/camperships/aidApi'
import type { ApiAidPromotionPreview } from '../../../../types/api-types'
import { MakeRulesDraftDialog } from './MakeRulesDraftDialog'

let preview: ApiAidPromotionPreview | undefined
let previewError: Error | null = null
const promoted: unknown[] = []
let promoteRefusal: string | null = null
let promoteStatus = 409
let promoteBusy = false
vi.mock('../../../../hooks/camperships/useAidPromotion', () => ({
  useAidPromotionPreview: (code: string | null) => ({
    data: code === null ? undefined : preview,
    isLoading: false,
    error: code === null ? null : previewError,
  }),
  useAidMakeRulesDraft: () => ({
    isPending: promoteBusy,
    reset: vi.fn(),
    mutate: (
      vars: unknown,
      handlers: { onSuccess: (draft: { version: number }) => void; onError: (error: Error) => void }
    ) => {
      promoted.push(vars)
      if (promoteRefusal === null) handlers.onSuccess({ version: 5 })
      else handlers.onError(new AidWriteError(promoteRefusal, promoteStatus))
    },
  }),
}))
vi.mock('../../../../hooks/useCurrentYear', () => ({ useYear: () => 2027 }))

const PREVIEW: ApiAidPromotionPreview = {
  code: 'A1',
  origin_version: 3,
  base_version: 4,
  sections: [
    {
      section: 'award_tables',
      changes: [
        { path: ['general', 'tiers', '2', 'r1_pct'], kind: 'changed', before: '55', after: '58' },
      ],
      warning: {
        kind: 'unapproved_edit',
        by: 'Test User',
        at: '2027-01-21T17:00:00Z',
        via: 'B2',
        token: 'tok-1',
      },
    },
  ],
  unchanged: ['income', 'tiers'],
}

/** Stands in for the Compare column's "Make A1 the Rules Draft…": opens the dialog on A1; the dialog closes it. */
function Harness() {
  const [code, setCode] = useState<string | null>(null)
  return (
    <>
      <button type="button" onClick={() => setCode('A1')}>
        Make A1 the Rules Draft…
      </button>
      <MakeRulesDraftDialog code={code} onClose={() => setCode(null)} />
    </>
  )
}

const at = (path: string) => (
  <MemoryRouter initialEntries={[path]}>
    <Harness />
  </MemoryRouter>
)

/** Renders at `path` (its `as_of` reaches the dialog's Rules link) and opens the dialog. */
async function renderDialog(path = '/aid/season/scenarios') {
  const view = render(at(path))
  await userEvent.click(screen.getByRole('button', { name: 'Make A1 the Rules Draft…' }))
  return { ...view, rerenderAt: () => view.rerender(at(path)) }
}

beforeEach(() => {
  preview = PREVIEW
  previewError = null
  promoted.length = 0
  promoteRefusal = null
  promoteStatus = 409
  promoteBusy = false
})

// …the two describes, moved as described above.

describe('Make it the rules draft (D39; Decision 21)', () => {
  it('lists each change, makes a replaced edit be confirmed, and sends its token', async () => {
    await renderDialog('/aid/season/scenarios?compare=A1')
    const dialog = screen.getByTestId('promotion-preview')
    expect(
      within(dialog).getByText('General › Tiers › Tier 2 › Round 1 %: 55% → 58%')
    ).toBeInTheDocument()
    expect(within(dialog).getByText('Unchanged: the other 2 sections.')).toBeInTheDocument()
    const make = screen.getByRole('button', { name: 'Make It the Rules Draft' })
    expect(make).toBeDisabled()
    await userEvent.click(within(dialog).getByRole('checkbox'))
    await userEvent.click(make)
    expect(promoted[0]).toEqual({
      code: 'A1',
      body: { base_version: 4, acknowledged: { award_tables: 'tok-1' } },
    })
    expect(screen.getByTestId('promotion-done')).toHaveTextContent(
      "A1's changes are in the rules draft, v5. Each changed section now needs approval: Rules ›, or Approve… on the tab bar."
    )
    expect(screen.getByRole('link', { name: /Rules/ })).toHaveAttribute(
      'href',
      '/aid/season/rules?year=2027'
    )
    // Done closes it.
    await userEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.queryByTestId('promotion-done')).toBeNull()
    expect(screen.queryByTestId('promotion-preview')).toBeNull()
  })

  it('forgets a tick when it is closed and opened again', async () => {
    await renderDialog('/aid/season/scenarios?compare=A1')
    await userEvent.click(within(screen.getByTestId('promotion-preview')).getByRole('checkbox'))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByTestId('promotion-preview')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Make A1 the Rules Draft…' }))
    expect(within(screen.getByTestId('promotion-preview')).getByRole('checkbox')).not.toBeChecked()
  })

  it('writes nothing on a 409, and a tick on a warning that changed since no longer counts', async () => {
    promoteRefusal = 'The rules draft is version 5 now, not 4: look at the changes again'
    const view = await renderDialog('/aid/season/scenarios?compare=A1')
    await userEvent.click(within(screen.getByTestId('promotion-preview')).getByRole('checkbox'))
    await userEvent.click(screen.getByRole('button', { name: 'Make It the Rules Draft' }))
    expect(screen.getByTestId('promotion-refused')).toHaveTextContent('Nothing was changed.')

    // The rules write's invalidation refreshes the preview: the section was re-edited, so a new token.
    const section = PREVIEW.sections[0]!
    preview = {
      ...PREVIEW,
      base_version: 5,
      sections: [{ ...section, warning: { ...section.warning!, token: 'tok-2' } }],
    }
    view.rerenderAt()
    expect(within(screen.getByTestId('promotion-preview')).getByRole('checkbox')).not.toBeChecked()
    expect(screen.getByRole('button', { name: 'Make It the Rules Draft' })).toBeDisabled()
  })
})

describe('the promotion dialog (review m3, m4, m7, m8, m9, ⚠1)', () => {
  it('cannot be cancelled or escaped while the write runs', async () => {
    promoteBusy = true
    await renderDialog('/aid/season/scenarios?compare=A1')
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    await userEvent.keyboard('{Escape}')
    expect(screen.getByTestId('promotion-preview')).toBeInTheDocument()
  })

  it('dims the header X too while the write runs, and frees it after', async () => {
    promoteBusy = true
    const view = await renderDialog('/aid/season/scenarios?compare=A1')
    const x = screen.getByRole('button', { name: 'Close modal' })
    expect(x).toBeDisabled()
    expect(x).toHaveClass('disabled:opacity-50')
    promoteBusy = false
    view.rerenderAt()
    expect(screen.getByRole('button', { name: 'Close modal' })).toBeEnabled()
  })

  it('says "Nothing was changed" on a refusal, and not when it cannot tell', async () => {
    promoteRefusal = 'No such option'
    promoteStatus = 422
    await renderDialog('/aid/season/scenarios?compare=A1')
    await userEvent.click(within(screen.getByTestId('promotion-preview')).getByRole('checkbox'))
    await userEvent.click(screen.getByRole('button', { name: 'Make It the Rules Draft' }))
    expect(screen.getByTestId('promotion-refused')).toHaveTextContent('Nothing was changed.')
  })

  it('says "Nothing was changed" on a 404 too: nothing was written', async () => {
    promoteRefusal = 'No such option'
    promoteStatus = 404
    await renderDialog('/aid/season/scenarios?compare=A1')
    await userEvent.click(within(screen.getByTestId('promotion-preview')).getByRole('checkbox'))
    await userEvent.click(screen.getByRole('button', { name: 'Make It the Rules Draft' }))
    expect(screen.getByTestId('promotion-refused')).toHaveTextContent('Nothing was changed.')
  })

  it("says it couldn't tell whether it was saved on any other failure, and links the Rules tab on the same as_of", async () => {
    promoteRefusal = 'Server exploded'
    promoteStatus = 500
    await renderDialog('/aid/season/scenarios?compare=A1&as_of=2026-01-15')
    await userEvent.click(within(screen.getByTestId('promotion-preview')).getByRole('checkbox'))
    await userEvent.click(screen.getByRole('button', { name: 'Make It the Rules Draft' }))
    const unknown = screen.getByTestId('promotion-unknown')
    expect(unknown).toHaveTextContent("Server exploded. Couldn't tell whether it was saved")
    expect(unknown).not.toHaveTextContent('Nothing was changed')
    expect(within(unknown).getByRole('link', { name: /Rules/ })).toHaveAttribute(
      'href',
      '/aid/season/rules?year=2027&as_of=2026-01-15'
    )
  })

  it('keeps a past as_of on the Rules link after a promotion', async () => {
    await renderDialog('/aid/season/scenarios?compare=A1&as_of=2026-01-15')
    await userEvent.click(within(screen.getByTestId('promotion-preview')).getByRole('checkbox'))
    await userEvent.click(screen.getByRole('button', { name: 'Make It the Rules Draft' }))
    expect(screen.getByRole('link', { name: /Rules/ })).toHaveAttribute(
      'href',
      '/aid/season/rules?year=2027&as_of=2026-01-15'
    )
  })

  it('says nothing about a lock when no changed section is locked, and states no version it cannot promise', async () => {
    await renderDialog('/aid/season/scenarios?compare=A1')
    const dialog = screen.getByTestId('promotion-preview')
    expect(within(dialog).queryByText(/locked by a posted round/)).toBeNull()
    expect(dialog).not.toHaveTextContent('(v4)')
  })

  it('says how many fixed settings stay as the rules draft has them (§S5 I; §S11.3)', async () => {
    preview = { ...PREVIEW, fixed_kept: 2 }
    await renderDialog()
    expect(
      screen.getByText('2 fixed settings stay as the rules draft has them')
    ).toBeInTheDocument()
  })

  it('shows a locked refusal from the preview in the server’s words, with nothing to confirm', async () => {
    preview = undefined
    previewError = new AidApiError(
      'Round 1 award table is locked: Round 1 is posted, so Scenarios models only what is still open.',
      409
    )
    await renderDialog()
    expect(screen.getByText(/Round 1 award table is locked/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Make It the Rules Draft' })).toBeDisabled()
  })

  it('says what an empty list means accurately', async () => {
    preview = { ...PREVIEW, sections: [], unchanged: ['income'] }
    await renderDialog('/aid/season/scenarios?compare=A1')
    expect(
      within(screen.getByTestId('promotion-preview')).getByText(
        'Nothing to change: what this option changed is already in the rules draft.'
      )
    ).toBeInTheDocument()
  })
})
