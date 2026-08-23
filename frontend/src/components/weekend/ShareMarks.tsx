/**
 * ShareMarks — the anchor circle and the flush capsule, drawn.
 *
 * `shareMarks.ts` grades two independent questions into two mark families:
 * the radio's always-on anchor (`resolveShareAnchor`, zero or one mark) and
 * the checkbox cluster (`resolveShareCluster`, zero to three ticks, flushed
 * into one capsule). This module owns ONLY the markup — the vocabulary, the
 * colors, the icons and the wording are LOCKED there
 * (`docs/plans/2026-08-22-share-icons-spec.md`, LOCAL ONLY, artifact
 * `LOCKED-final-picks`); read that module's header before changing any of
 * them here.
 *
 * The anchor draws lucide's `Handshake` fixed, in this file rather than the
 * vocabulary module — every anchor state draws the same icon, so
 * `ShareAnchorSpec` carries no `Icon` field at all (see `shareMarks.ts`'s
 * header comment).
 */
import { Handshake } from 'lucide-react'

import type { RosterPartyRow } from '../../types/lodging'
import { Tooltip } from '../ui/Tooltip'
import { CAP_CLASSES, clusterCap, resolveShareAnchor, resolveShareCluster } from './shareMarks'

/** 20px frame, matching the glyph grid `NeedGlyphMark`'s `GLYPH_BASE` established. */
const FRAME = 'flex h-5 w-5 items-center justify-center'

export function ShareMarks({ party }: { party: RosterPartyRow }) {
  const anchor = resolveShareAnchor(party)
  const cluster = resolveShareCluster(party)

  if (!anchor && cluster.length === 0) return null

  return (
    <>
      {anchor && (
        // Always its own circle — `CAP_CLASSES.solo`, never a capsule cap —
        // because the anchor is a separate question from the cluster and
        // must never look like it merged into it.
        <Tooltip
          content={anchor.tooltip}
          aria-label={anchor.ariaLabel}
          className={`${FRAME} ${anchor.className} ${CAP_CLASSES.solo}`}
        >
          <Handshake className="h-3 w-3" />
        </Tooltip>
      )}
      {cluster.length > 0 && (
        // No gap classes here — the cap classes' own `-ml-px` (right/middle)
        // IS the flush join; an added gap would reopen the seam.
        <span className="inline-flex" data-testid="share-cluster">
          {cluster.map((mark, index) => {
            // Caps come from the mark's POSITION IN THE ARRAY, never CSS tree
            // position — `ui/Tooltip` nests each glyph in its own trigger
            // element, which defeats `:only-child` / `:last-child` (the
            // half-pill trap `shareMarks.ts`'s `ClusterCap` doc names).
            const cap = CAP_CLASSES[clusterCap(index, cluster.length)]
            const Icon = mark.Icon
            return (
              <Tooltip
                key={mark.key}
                content={mark.tooltip}
                aria-label={mark.ariaLabel}
                className={`${FRAME} ${mark.className} ${cap}`}
              >
                <Icon className="h-3 w-3" />
              </Tooltip>
            )
          })}
        </span>
      )}
    </>
  )
}
