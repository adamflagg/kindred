/** The March file (spec §8.3; D73; S3-7; P-21; owner ruling E): five headers, one row per payer share. */
import { describe, expect, it } from 'vitest'

import type { ApiAidMarchFile } from '../../../types/api-types'
import { buildCsvContent } from '../../../utils/csvExport'
import {
  MARCH_HEADERS,
  marchFileName,
  marchFileRows,
  marchFileResultLine,
  marchFileWords,
  zeroLeftOutWords,
} from './marchFile'

const FILE: ApiAidMarchFile = {
  year: 2027,
  rows: [
    {
      request_id: 'reqemma00000001',
      camper_first: 'Emma',
      camper_last: 'Johnson',
      total_award: 1420,
      primary_childhood_id: 1000001,
      personal_id: 1000011,
    },
    // A split request: one row per payer share, each its own household and its share's Round 1 amount.
    {
      request_id: 'reqliam00000004',
      camper_first: 'Liam',
      camper_last: 'Garcia',
      total_award: 710.5,
      primary_childhood_id: 1000002,
      personal_id: 1000021,
    },
    {
      request_id: 'reqliam00000004',
      camper_first: 'Liam',
      camper_last: 'Garcia',
      total_award: 709.5,
      primary_childhood_id: 1000012,
      personal_id: 1000021,
    },
    // A Family Camp request with no child attending to name (ruling A3): blank names, no Personal Id.
    {
      request_id: 'reqfami00000001',
      camper_first: '',
      camper_last: '',
      total_award: 800,
      primary_childhood_id: 1000003,
      personal_id: null,
    },
  ],
  zero_left_out: 3,
}

describe('the March file', () => {
  it('writes exactly the registrar’s five headers', () => {
    expect([...MARCH_HEADERS]).toEqual([
      'Camper: (First)',
      'Camper: (Last)',
      'Total Award',
      'Primary Childhood ID',
      'Personal Id',
    ])
  })

  it('⚠ writes one row per payer share at its Round 1 amount, cents only where they exist, and no link line', () => {
    expect(marchFileRows(FILE)).toEqual([
      ['Emma', 'Johnson', '1420', '1000001', '1000011'],
      ['Liam', 'Garcia', '710.50', '1000002', '1000021'],
      ['Liam', 'Garcia', '709.50', '1000012', '1000021'],
      ['', '', '800', '1000003', ''],
    ])
    const csv = buildCsvContent([...MARCH_HEADERS], marchFileRows(FILE))
    expect(csv).not.toContain('Link')
    expect(csv).not.toContain('null')
  })

  it('names the file and says what it holds', () => {
    expect(marchFileName(2027)).toBe('camperships-march-file-2027.csv')
    expect(marchFileWords(FILE)).toBe('4 rows · 3 requests')
    expect(marchFileWords({ year: 2027, rows: FILE.rows.slice(0, 1) })).toBe('1 row · 1 request')
  })

  it('says how many $0 Round 1 offers it left out (ruling E), and nothing when none', () => {
    expect(zeroLeftOutWords(FILE)).toBe(
      "3 Round 1 offers of $0 aren't in the file; they stay in Needs an offer, for a letter and Mark Posted by hand."
    )
    // One offer: "it stays", not "they stay" (R5-13).
    expect(zeroLeftOutWords({ ...FILE, zero_left_out: 1 })).toBe(
      "1 Round 1 offer of $0 isn't in the file; it stays in Needs an offer, for a letter and Mark Posted by hand."
    )
    expect(zeroLeftOutWords({ ...FILE, zero_left_out: 0 })).toBeNull()
    expect(zeroLeftOutWords({ year: 2027, rows: [] })).toBeNull()
  })

  it('words the result line: the $0 count when some were left out, else rows and requests', () => {
    expect(marchFileResultLine(FILE)).toBe(
      "✓ March File downloaded. 3 Round 1 offers of $0 aren't in the file; they stay in Needs an offer, for a letter and Mark Posted by hand."
    )
    expect(marchFileResultLine({ ...FILE, zero_left_out: 0 })).toBe(
      '✓ March File downloaded: 4 rows · 3 requests.'
    )
  })
})
