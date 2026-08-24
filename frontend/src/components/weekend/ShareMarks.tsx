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
 *
 * ## The emphasis wrappers (spec 2026-08-24)
 *
 * Each mark family is wrapped in a span that carries the halo and the
 * breathe for the "open to sharing" set — see `shareEmphasis.ts` for which
 * marks qualify and why the transform must never land on a glyph inside a
 * capsule. The wrappers render UNCONDITIONALLY so there is one DOM shape to
 * reason about; only the glow class and the motion handle are conditional.
 * The anchor and the cluster get SEPARATE wrappers even when both are hot,
 * because they answer separate questions and the parent spec forbids the
 * anchor looking merged into the cluster.
 */
import { Handshake } from 'lucide-react'

import type { RosterPartyRow } from '../../types/lodging'
import { Tooltip } from '../ui/Tooltip'
import { SHARE_GLOW_CLASS, anchorIsEmphasized, clusterIsEmphasized } from './shareEmphasis'
import { CAP_CLASSES, clusterCap, resolveShareAnchor, resolveShareCluster } from './shareMarks'

/** 20px frame, matching the glyph grid `NeedGlyphMark`'s `GLYPH_BASE` established. */
const FRAME = 'flex h-5 w-5 items-center justify-center'

/**
 * The halo/transform vehicle.
 *
 * `rounded-full` is load-bearing, not decoration: the halo is a `box-shadow`
 * on this wrapper, and a box-shadow follows the BORDER RADIUS. Without it the
 * capsule's pill silhouette would wear a rectangular glow. The wrapper
 * shrink-wraps its 20px content, so `rounded-full` resolves to the same 10px
 * caps the marks inside already draw.
 */
const VEHICLE = 'inline-flex rounded-full'

/*
 * `data-share-emphasis-motion` below is spelled out rather than spread from
 * `SHARE_MOTION_ATTR` — JSX cannot take a computed attribute name without a
 * spread object, which reads worse than the literal. The coupling is pinned
 * instead: `ShareMarks.test.tsx` queries with `SHARE_MOTION_SELECTOR`, so
 * renaming the constant alone turns that suite red.
 */

export function ShareMarks({ party }: { party: RosterPartyRow }) {
  const anchor = resolveShareAnchor(party)
  const cluster = resolveShareCluster(party)

  if (!anchor && cluster.length === 0) return null

  const anchorHot = anchorIsEmphasized(anchor)
  const clusterHot = clusterIsEmphasized(cluster)

  return (
    <>
      {anchor && (
        <span
          className={`${VEHICLE}${anchorHot ? ` ${SHARE_GLOW_CLASS}` : ''}`}
          data-share-emphasis-motion={anchorHot ? '' : undefined}
        >
          {/* Always its own circle — `CAP_CLASSES.solo`, never a capsule cap —
              because the anchor is a separate question from the cluster and
              must never look like it merged into it. */}
          <Tooltip
            content={anchor.tooltip}
            aria-label={anchor.ariaLabel}
            className={`${FRAME} ${anchor.className} ${CAP_CLASSES.solo}`}
          >
            <Handshake className="h-3 w-3" />
          </Tooltip>
        </span>
      )}
      {cluster.length > 0 && (
        // No gap classes here — the cap classes' own `-ml-px` (right/middle)
        // IS the flush join; an added gap would reopen the seam.
        <span
          className={`${VEHICLE}${clusterHot ? ` ${SHARE_GLOW_CLASS}` : ''}`}
          data-testid="share-cluster"
          data-share-emphasis-motion={clusterHot ? '' : undefined}
        >
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
