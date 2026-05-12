import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router'
import { driver, type Driver } from 'driver.js'
import 'driver.js/dist/driver.css'
import '../styles/tour.css'
import { getTourIdForRoute, loadTourDefinition, loadLayerDefinition } from '../tours/tourRegistry'
import { getTourStorage, batchComplete } from '../tours/tourStorage'
import type {
  TourDefinition,
  TourId,
  TourStep,
  LayerId,
  LayerDefinition,
  TourStorageData,
} from '../tours/types'

/** Delay before checking readiness (ms) */
const AUTO_START_DELAY = 300

/** Max retries waiting for readiness */
const MAX_READY_RETRIES = 25

/** Interval between readiness checks (ms) */
const READY_CHECK_INTERVAL = 200

/** Days before a previously-seen shared layer replays on "Tour This Page" */
const STALE_DAYS = 30

interface LayerBoundary {
  layerId: LayerId
  version: number
  endIndex: number
}

/** Poll for `selector` in the DOM. Resolves true when found, false on timeout or abort. */
function waitForSelector(
  selector: string | null,
  schedule: (fn: () => void, ms: number) => void,
  signal: AbortSignal
): Promise<boolean> {
  if (selector === null) return Promise.resolve(true)
  return new Promise((resolve) => {
    let retries = 0
    const check = () => {
      if (signal.aborted) {
        resolve(false)
        return
      }
      if (document.querySelector(selector) !== null) {
        resolve(true)
        return
      }
      if (retries >= MAX_READY_RETRIES) {
        resolve(false)
        return
      }
      retries++
      schedule(check, READY_CHECK_INTERVAL)
    }
    schedule(check, 0)
  })
}

export function useTour() {
  const { pathname } = useLocation()
  const [tourId, setTourId] = useState<TourId | null>(null)
  const driverRef = useRef<Driver | null>(null)
  const definitionRef = useRef<TourDefinition | null>(null)
  const layerDefsRef = useRef<LayerDefinition[]>([])
  const pendingTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set())
  const abortControllerRef = useRef<AbortController | null>(null)

  const scheduleTimeout = useCallback((fn: () => void, ms: number) => {
    const id = setTimeout(() => {
      pendingTimersRef.current.delete(id)
      fn()
    }, ms)
    pendingTimersRef.current.add(id)
    return id
  }, [])

  // Load tour + layer definitions on route change
  useEffect(() => {
    const id = getTourIdForRoute(pathname)
    setTourId(id)

    // Clear cached refs synchronously so a manual replay between routes
    // cannot start the previous page's tour while the new load is in flight.
    definitionRef.current = null
    layerDefsRef.current = []

    if (!id) {
      return
    }

    let cancelled = false

    loadTourDefinition(id)
      .then(async (def) => {
        if (cancelled) return
        definitionRef.current = def

        const layerDefs = await Promise.all(def.layers.map(loadLayerDefinition))
        if (cancelled) return
        layerDefsRef.current = layerDefs
      })
      .catch(() => {
        if (cancelled) return
        definitionRef.current = null
        layerDefsRef.current = []
      })

    return () => {
      cancelled = true
    }
  }, [pathname])

  const startTour = useCallback(() => {
    const def = definitionRef.current
    if (!def) return

    const storage = getTourStorage()
    const { steps, layerBoundaries } = assembleSteps(def, layerDefsRef.current, storage)

    if (steps.length === 0) return

    if (driverRef.current) {
      driverRef.current.destroy()
      driverRef.current = null
    }

    // Clear any queued readiness timers from a prior replay so their stale
    // closures cannot fire drive()/destroy() on a freshly created driver.
    for (const id of pendingTimersRef.current) {
      clearTimeout(id)
    }
    pendingTimersRef.current.clear()

    let highestStepReached = -1

    abortControllerRef.current?.abort()
    const abortController = new AbortController()
    abortControllerRef.current = abortController

    const d = driver({
      showProgress: true,
      showButtons: ['next', 'previous', 'close'],
      popoverClass: 'kindred-tour',
      steps,
      onHighlightStarted: (_el, _step, opts) => {
        const idx = opts.state.activeIndex
        if (idx !== undefined && idx > highestStepReached) {
          highestStepReached = idx
        }
      },
      onNextClick: (_el, _step, opts) => {
        const currentIdx = opts.state.activeIndex ?? 0
        const nextIdx = currentIdx + 1
        if (nextIdx >= steps.length) {
          opts.driver.destroy()
          return
        }
        const nextSelector =
          typeof steps[nextIdx]?.element === 'string' ? steps[nextIdx].element : null
        void waitForSelector(nextSelector, scheduleTimeout, abortController.signal).then(
          (ready) => {
            if (abortController.signal.aborted) return
            if (ready) opts.driver.moveNext()
          }
        )
      },
      onPrevClick: (_el, _step, opts) => {
        const currentIdx = opts.state.activeIndex ?? 0
        const prevIdx = currentIdx - 1
        if (prevIdx < 0) return
        const prevSelector =
          typeof steps[prevIdx]?.element === 'string' ? steps[prevIdx].element : null
        void waitForSelector(prevSelector, scheduleTimeout, abortController.signal).then(
          (ready) => {
            if (abortController.signal.aborted) return
            if (ready) opts.driver.movePrevious()
          }
        )
      },
      onDestroyed: () => {
        const completedLayers = layerBoundaries
          .filter((b) => highestStepReached >= b.endIndex)
          .map((b) => ({ layerId: b.layerId, version: b.version }))
        batchComplete(completedLayers)
      },
    })

    driverRef.current = d

    const firstSelector = typeof steps[0]?.element === 'string' ? steps[0].element : null

    scheduleTimeout(() => {
      void waitForSelector(firstSelector, scheduleTimeout, abortController.signal).then((ready) => {
        if (abortController.signal.aborted) return
        if (ready) {
          d.drive()
        } else {
          d.destroy()
          driverRef.current = null
        }
      })
    }, AUTO_START_DELAY)
  }, [scheduleTimeout])

  // Cleanup on unmount
  useEffect(() => {
    const timers = pendingTimersRef.current
    return () => {
      abortControllerRef.current?.abort()
      if (driverRef.current) {
        driverRef.current.destroy()
      }
      for (const id of timers) {
        clearTimeout(id)
      }
      timers.clear()
    }
  }, [])

  return { tourId, replay: startTour }
}

function assembleSteps(
  def: TourDefinition,
  layerDefs: LayerDefinition[],
  storage: TourStorageData
): {
  steps: TourStep[]
  layerBoundaries: LayerBoundary[]
} {
  const steps: TourStep[] = []
  const layerBoundaries: LayerBoundary[] = []

  for (const layerDef of layerDefs) {
    const record = storage.layers[layerDef.id]
    let include = !record || record.completedVersion < layerDef.version
    if (!include && record) {
      const completedTime = new Date(record.completedAt).getTime()
      // Treat malformed timestamps as stale so a corrupted record can't
      // permanently suppress a layer (NaN >= STALE_DAYS would be false).
      include =
        Number.isNaN(completedTime) || (Date.now() - completedTime) / 86_400_000 >= STALE_DAYS
    }

    if (include) {
      steps.push(...layerDef.steps)
      layerBoundaries.push({
        layerId: layerDef.id,
        endIndex: steps.length - 1,
        version: layerDef.version,
      })
    }
  }

  steps.push(...def.steps)

  return { steps, layerBoundaries }
}
