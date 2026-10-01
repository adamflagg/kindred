import { render } from '@testing-library/react'
import { useState } from 'react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

import type { WalkEditorProps } from '../kit/useEditorWalk'
import { GridEditorRow } from './GridEditorRow'
import { ROW_OLIVIA, ROW_SAMUEL } from './gridFixtures'

// Each mount of the preview hook gets its own number, so a test can see a fresh one.
let mounts = 0
const seen: number[] = []
vi.mock('../../../hooks/camperships/useAidEditorPreview', () => ({
  useAidEditorPreview: () => {
    const [id] = useState(() => ++mounts)
    seen.push(id)
    return { preview: { status: 'idle' }, onAmountChange: () => undefined }
  },
}))

const WALK: WalkEditorProps = {
  draft: undefined,
  saving: false,
  saveError: null,
  showProblem: false,
  onDraftChange: () => undefined,
  onSave: () => undefined,
  onMove: () => undefined,
  onCancel: () => undefined,
}
const LINKS = { href: () => '/aid/households/1', open: () => undefined }

describe('GridEditorRow', () => {
  it("starts the preview afresh when the row changes under it (Task 12's carried note)", () => {
    const row = (r: typeof ROW_OLIVIA) => (
      <MemoryRouter>
        <GridEditorRow row={r} walk={WALK} links={LINKS} />
      </MemoryRouter>
    )
    const { rerender } = render(row(ROW_OLIVIA))
    const first = seen[seen.length - 1]
    rerender(row(ROW_SAMUEL))
    expect(seen[seen.length - 1]).not.toBe(first)
  })
})
