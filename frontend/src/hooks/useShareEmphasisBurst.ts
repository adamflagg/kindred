import { useEffect, useRef } from 'react'

import {
  defaultShareEmphasisRunner,
  type ShareEmphasisBurst,
  type ShareEmphasisRunner,
} from '../components/weekend/shareEmphasis'

export interface UseShareEmphasisBurstOptions {
  /**
   * "This roster just became visible" — the board has a payload with cards in
   * it. NOT component mount: the board stays mounted behind `Activity` across
   * tab switches, and a mount-keyed trigger would also fire on every scenario
   * switch and every refetch.
   */
  ready: boolean
  /**
   * A drag is in flight. #2528 put a three-state hatch/wash highlight on unit
   * cards during a drag, and reading a hatch pattern is a precision task —
   * thirteen marks pulsing in the periphery compete with it.
   */
  suppressed: boolean
  /** Injectable for tests; the GSAP runner otherwise. */
  runner?: ShareEmphasisRunner
}

/**
 * Fires the share-emphasis burst ONCE per board arrival, and kills it the
 * moment a drag starts.
 *
 * The ref is the whole point. A CSS animation keyed to mount re-fires on
 * every remount — a scenario switch, a refetch after
 * `invalidateLodgingRegistryQueries`, a tab return — and a board that
 * re-breathes every time staff confirm a cabin is worse than one that never
 * breathes at all. The weekend roster inherits the app-default 30-minute
 * `staleTime`, so ordinary refetches are rare, but rare is not never and the
 * failure is invisible until staff complain.
 *
 * Arming happens on the first render where `ready` is true and no drag is in
 * flight; nothing re-arms it afterwards, for the life of the mount.
 */
export function useShareEmphasisBurst({
  ready,
  suppressed,
  runner = defaultShareEmphasisRunner,
}: UseShareEmphasisBurstOptions): void {
  const armed = useRef(true)
  const burst = useRef<ShareEmphasisBurst | null>(null)

  useEffect(() => {
    if (suppressed) {
      // KILL, never pause-and-resume. `armed` stays false afterwards, so the
      // burst does not pick up again when the family lands.
      burst.current?.kill()
      burst.current = null
      return
    }
    if (!armed.current || !ready) return
    armed.current = false
    burst.current = runner.run()
  }, [ready, suppressed, runner])

  // A navigation away mid-burst must not leave a timeline ticking against
  // elements React has unmounted.
  useEffect(
    () => () => {
      burst.current?.kill()
      burst.current = null
    },
    []
  )
}
