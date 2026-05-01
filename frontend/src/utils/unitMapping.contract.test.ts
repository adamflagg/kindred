/**
 * Contract test: TypeScript unit-mapping matches the shared JSON fixture.
 *
 * The fixture at tests/fixtures/unit_mapping_cases.json is the canonical
 * reference shared with the Python implementation
 * (bunking/utils/units.py). If anyone changes either impl without updating
 * both + the fixture, this test (or its Python sibling at
 * tests/unit/bunking/utils/test_units_contract.py) will fail in CI.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { getUnitForBunk, UNIT_NAMES } from './unitMapping'
import { unitToSlug } from '../components/graph/graphFilter'

interface Case {
  bunk: string
  unit: string | null
}

interface Fixture {
  cases: Case[]
  unit_names: string[]
  unit_slugs: Record<string, string>
}

const fixturePath = resolve(__dirname, '../../../tests/fixtures/unit_mapping_cases.json')
const fixture = JSON.parse(readFileSync(fixturePath, 'utf-8')) as Fixture

describe('unitMapping contract', () => {
  describe('getUnitForBunk matches fixture', () => {
    fixture.cases.forEach(({ bunk, unit }) => {
      it(`maps "${bunk}" → ${unit ?? 'null'}`, () => {
        expect(getUnitForBunk(bunk)).toBe(unit)
      })
    })
  })

  it('UNIT_NAMES matches fixture order', () => {
    expect([...UNIT_NAMES]).toEqual(fixture.unit_names)
  })

  describe('unitToSlug matches fixture', () => {
    Object.entries(fixture.unit_slugs).forEach(([unit, slug]) => {
      it(`slugs "${unit}" → ${slug}`, () => {
        expect(unitToSlug(unit)).toBe(slug)
      })
    })
  })
})
