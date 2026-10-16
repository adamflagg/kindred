/**
 * P-20 option B, "Shorter names" (owner, 2026-10-15): the Retention charts keep
 * their angled, 80px-capped axis and shorten the text instead. These pin the
 * rule the approved mock states on its page.
 */
import { describe, it, expect } from 'vitest'
import { chartAxisLabels, schoolChartName, synagogueChartName } from './chartLabels'

describe('schoolChartName', () => {
  it.each([
    ['Harbor School', 'Harbor'],
    ['Lincoln Middle School', 'Lincoln Middle'],
    ['Riverbend Community School', 'Riverbend Comm.'],
    ['Sunset Preparatory Academy', 'Sunset Prep Academy'],
    ['Eastgate International School', 'Eastgate Intl.'],
    ['Eastgate International School of Languages', 'Eastgate Intl.'],
    ['Riverside Community Day School', 'Riverside Comm. Day'],
  ])('shortens %s to %s', (full, short) => {
    expect(schoolChartName(full)).toBe(short)
  })

  it.each(['Oakwood Academy', 'Fairview', 'Hillcrest Elementary'])('leaves %s whole', (name) => {
    expect(schoolChartName(name)).toBe(name)
  })

  it('keeps a "School" that is not at the end', () => {
    expect(schoolChartName('Harbor School District Magnet')).toBe('Harbor School District Magnet')
  })
})

describe('synagogueChartName', () => {
  it.each([
    ['Congregation Or Tikvah', 'Or Tikvah'],
    ['Temple Emet', 'Emet'],
    ['Kehillat Netivot', 'Netivot'],
    ['Congregation Beth Shalom of the Valley', 'Beth Shalom'],
    ['Beth Abraham of Greater Springfield', 'Beth Abraham'],
  ])('shortens %s to %s', (full, short) => {
    expect(synagogueChartName(full)).toBe(short)
  })

  it.each(['Beth El', 'Beth Chaim'])('leaves %s whole', (name) => {
    expect(synagogueChartName(name)).toBe(name)
  })

  it('never shortens a name to nothing or to a bare qualifier', () => {
    expect(synagogueChartName('Temple')).toBe('Temple')
    expect(synagogueChartName('Congregation of the Valley')).toBe('Congregation of the Valley')
  })
})

describe('chartAxisLabels', () => {
  it('shortens every name when no two shortened names match', () => {
    expect(chartAxisLabels(['Temple Emet', 'Beth El'], synagogueChartName)).toEqual([
      'Emet',
      'Beth El',
    ])
  })

  it('keeps the full names of any two that would shorten to the same label', () => {
    // The mock's readout flagged this: two congregations reading as one bar label.
    expect(
      chartAxisLabels(
        [
          'Beth Shalom',
          'Temple Emet',
          'Temple Beth Shalom',
          'Congregation Beth Shalom of the Valley',
        ],
        synagogueChartName
      )
    ).toEqual([
      'Beth Shalom',
      'Emet',
      'Temple Beth Shalom',
      'Congregation Beth Shalom of the Valley',
    ])
  })

  it('keeps going until no label is shared, when a kept full name matches another short one', () => {
    // The first two collide and keep their full names; the first's full name is then
    // exactly the third's short form, so the third keeps its full name too.
    expect(
      chartAxisLabels(
        ['Temple Beth Shalom', 'Congregation Beth Shalom', 'Kehillat Temple Beth Shalom'],
        synagogueChartName
      )
    ).toEqual(['Temple Beth Shalom', 'Congregation Beth Shalom', 'Kehillat Temple Beth Shalom'])
  })

  it('returns an empty list for no names', () => {
    expect(chartAxisLabels([], schoolChartName)).toEqual([])
  })
})
