import { describe, expect, it } from 'vitest'

import * as aidApi from './aidApi'
import { queryKeys } from '../../utils/queryKeys'

describe('session capacity is gone from the aid client', () => {
  it('exports no capacity function and keeps no capacity query key', () => {
    expect(Object.keys(aidApi).filter((k) => /capacit/i.test(k))).toEqual([])
    expect(Object.keys(queryKeys).filter((k) => /capacit/i.test(k))).toEqual([])
  })

  it('has no capacity form, model or hook module left', () => {
    const found = Object.keys(
      import.meta.glob([
        '../../components/camperships/season/rules/*apacity*',
        '../../hooks/camperships/useAidCapacity*',
      ])
    ).filter((f) => !f.includes('noCapacity'))
    expect(found).toEqual([])
  })
})
