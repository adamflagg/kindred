/**
 * The family share marks as `MarkRunSpec`s (kindred#2759). The vocabulary is
 * unchanged and still owned by `shareMarks.ts`; the emphasis rule is unchanged
 * and still owned by `shareEmphasis.ts`. This only packages them for
 * `MarkRun`. The anchor and the cluster stay SEPARATE runs — separate halos —
 * because they answer separate questions.
 */
import { Handshake } from 'lucide-react'

import type { RosterPartyRow } from '../../types/lodging'
import type { MarkRunSpec } from './markSpec'
import { anchorIsEmphasized, clusterIsEmphasized } from './shareEmphasis'
import { resolveShareAnchor, resolveShareCluster } from './shareMarks'

export function familyShareRuns(party: RosterPartyRow): MarkRunSpec[] {
  const anchor = resolveShareAnchor(party)
  const cluster = resolveShareCluster(party)
  const runs: MarkRunSpec[] = []
  if (anchor) {
    runs.push({
      key: 'anchor',
      hot: anchorIsEmphasized(anchor),
      marks: [
        {
          key: 'anchor',
          Icon: Handshake,
          className: anchor.className,
          tooltip: anchor.tooltip,
          ariaLabel: anchor.ariaLabel,
        },
      ],
    })
  }
  if (cluster.length > 0) {
    runs.push({
      key: 'cluster',
      testId: 'share-cluster',
      hot: clusterIsEmphasized(cluster),
      marks: cluster,
    })
  }
  return runs
}
