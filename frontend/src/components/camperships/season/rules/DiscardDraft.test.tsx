/** Discard draft's refusal reaches the Season notice even when the refusal's refetch re-keys the button (scan #3093). */
import { QueryClient, QueryClientProvider, useMutation } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { SeasonChromeContext, type SeasonChrome } from '../seasonChrome'
import { DiscardDraft } from './DiscardDraft'

const moved = vi.hoisted(() => ({ bump: () => {} }))
// The real useMutation: React Query skips mutate()'s own callbacks once the component that called it is gone.
vi.mock('../../../../hooks/camperships/useAidRulesWrites', () => ({
  useAidDiscardRulesDraft: () =>
    useMutation({
      mutationFn: () => {
        moved.bump() // the 409's refetch: the draft moved on, so the button re-keys before the refusal lands
        return new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error('Version 4 of 2027 is not the rules draft any more')),
            30
          )
        )
      },
    }),
}))

function Harness() {
  const [version, setVersion] = useState(4)
  moved.bump = () => setVersion(5)
  return <DiscardDraft key={version} draftVersion={version} approvedVersion={3} />
}

describe('DiscardDraft', () => {
  it('says a refusal on the Season notice line though the draft moved on and the button re-keyed', async () => {
    const setNotice = vi.fn()
    render(
      <QueryClientProvider client={new QueryClient()}>
        <SeasonChromeContext.Provider value={{ setNotice } as unknown as SeasonChrome}>
          <Harness />
        </SeasonChromeContext.Provider>
      </QueryClientProvider>
    )
    await userEvent.click(screen.getByRole('button', { name: 'Discard draft' }))
    await userEvent.click(screen.getByRole('button', { name: 'Discard' }))
    await waitFor(() =>
      expect(setNotice).toHaveBeenCalledWith('Version 4 of 2027 is not the rules draft any more')
    )
  })
})
