/**
 * ZIP codes fixtures (slice 4): an invented season in the shape of `ZipResponse`. ZIPs are in the
 * unassigned 000xx range; groups carry invented labels; every figure is invented. Rows are ZIPs,
 * never families (D90).
 */
import type { ApiAidZip, ApiAidZipRow } from '../../../types/api-types'

const zip = (over: Partial<ApiAidZipRow>): ApiAidZipRow => ({
  zip: '00010',
  kind: 'us',
  campers: 0,
  families: 0,
  dollars: null,
  ...over,
})

export const ZIP: ApiAidZip = {
  year: 2027,
  figures_on: '2027-06-03',
  group: 'pool_a',
  group_label: 'Pool A',
  groups: [
    { key: 'pool_a', label: 'Pool A' },
    { key: 'pool_b', label: 'Pool B' },
    { key: 'all', label: 'All groups' },
  ],
  every_camper: {
    rows: [
      zip({ zip: '00010', campers: 4, families: 3 }),
      zip({ zip: '00012', campers: 9, families: 6 }),
      zip({ zip: 'Outside the US', kind: 'outside_us', campers: 2, families: 1 }),
      zip({ zip: 'No ZIP on file', kind: 'none', campers: 1, families: 1 }),
    ],
    total: zip({ zip: '', campers: 16, families: 11 }),
    zips: 2,
  },
  with_aid: {
    rows: [
      zip({ zip: '00010', campers: 1, families: 1, dollars: 2000 }),
      zip({ zip: '00012', campers: 3, families: 2, dollars: 5400 }),
    ],
    total: zip({ zip: '', campers: 4, families: 3, dollars: 7400 }),
    zips: 2,
  },
  not_built: [],
}

/** A season whose decisions aren't loaded yet: no aid table, and the server says why. */
export const ZIP_NO_AID: ApiAidZip = {
  ...ZIP,
  with_aid: null,
  not_built: [{ figure: 'with_aid', reason: "The aid table waits on the season's decisions" }],
}
