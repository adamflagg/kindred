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
import { useSolverConfigValue } from './useSolverConfig'

/** Delay before checking readiness (ms) */
const AUTO_START_DELAY = 300

/** Max retries waiting for readiness */
const MAX_READY_RETRIES = 25

/** Interval between readiness checks (ms) */
const READY_CHECK_INTERVAL = 200

/** Default staleness threshold in days */
const DEFAULT_STALE_DAYS = 30

interface LayerBoundary {
  layerId: LayerId
  version: number
  endIndex: number
}

export function useTour() {
  const { pathname } = useLocation()
  const [tourId, setTourId] = useState<TourId | null>(null)
  const [loadedPath, setLoadedPath] = useState<string | null>(null)
  const driverRef = useRef<Driver | null>(null)
  const definitionRef = useRef<TourDefinition | null>(null)
  const layerDefsRef = useRef<LayerDefinition[]>([])
  const pendingTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set())
  const autoPlayFiredRef = useRef<string | null>(null)

  const staleDays =
    useSolverConfigValue<number>('tour.staleness_days', DEFAULT_STALE_DAYS) ?? DEFAULT_STALE_DAYS

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
    setLoadedPath(null)
    autoPlayFiredRef.current = null

    if (!id) {
      definitionRef.current = null
      layerDefsRef.current = []
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

        // Signal that definitions are loaded so auto-play effect can fire
        setLoadedPath(pathname)
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

  const startTour = useCallback(
    (mode: 'auto' | 'manual') => {
      const def = definitionRef.current
      if (!def) return

      const storage = getTourStorage()
      const { steps, layerBoundaries } = assembleSteps(
        def,
        layerDefsRef.current,
        mode,
        staleDays,
        storage
      )

      if (steps.length === 0) return

      // Clean up any existing driver
      if (driverRef.current) {
        driverRef.current.destroy()
      }

      let highestStepReached = -1

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
        onDestroyed: () => {
          const completedLayers = layerBoundaries
            .filter((b) => highestStepReached >= b.endIndex)
            .map((b) => ({ layerId: b.layerId, version: b.version }))
          const completedTour =
            mode === 'manual' && highestStepReached >= steps.length - 1
              ? { tourId: def.id, version: def.version }
              : undefined
          if (completedLayers.length > 0 || completedTour) {
            batchComplete(completedLayers, completedTour)
          }
        },
      })

      driverRef.current = d

      // Readiness: check first step's element exists in DOM (computed once, polled)
      const firstSelector = typeof steps[0]?.element === 'string' ? steps[0].element : null

      let retries = 0
      const checkReady = () => {
        const ready = firstSelector ? document.querySelector(firstSelector) !== null : true
        if (ready) {
          d.drive()
          return
        }
        if (retries >= MAX_READY_RETRIES) {
          d.destroy()
          driverRef.current = null
          return
        }
        retries++
        scheduleTimeout(checkReady, READY_CHECK_INTERVAL)
      }

      scheduleTimeout(checkReady, AUTO_START_DELAY)
    },
    [scheduleTimeout, staleDays]
  )

  // Auto-play unseen layers after definitions are loaded
  useEffect(() => {
    if (!loadedPath || !definitionRef.current || autoPlayFiredRef.current === loadedPath) return
    if (definitionRef.current.layers.length === 0) return
    if (layerDefsRef.current.length === 0) return

    const storage = getTourStorage()
    const hasUnseenLayers = definitionRef.current.layers.some((id) => !storage.layers[id])
    if (!hasUnseenLayers) return

    autoPlayFiredRef.current = loadedPath
    startTour('auto')
  }, [loadedPath, startTour])

  // Cleanup on unmount
  useEffect(() => {
    const timers = pendingTimersRef.current
    return () => {
      if (driverRef.current) {
        driverRef.current.destroy()
      }
      for (const id of timers) {
        clearTimeout(id)
      }
      timers.clear()
    }
  }, [])

  const replay = useCallback(() => {
    startTour('manual')
  }, [startTour])

  return { tourId, replay }
}

function assembleSteps(
  def: TourDefinition,
  layerDefs: LayerDefinition[],
  mode: 'auto' | 'manual',
  staleDays: number,
  storage: TourStorageData
): {
  steps: TourStep[]
  layerBoundaries: LayerBoundary[]
} {
  const steps: TourStep[] = []
  const layerBoundaries: LayerBoundary[] = []

  for (const layerDef of layerDefs) {
    const record = storage.layers[layerDef.id]
    const include =
      mode === 'auto'
        ? !record
        : !record ||
          record.completedVersion < layerDef.version ||
          (Date.now() - new Date(record.completedAt).getTime()) / 86_400_000 >= staleDays

    if (include) {
      steps.push(...layerDef.steps)
      layerBoundaries.push({
        layerId: layerDef.id,
        endIndex: steps.length - 1,
        version: layerDef.version,
      })
    }
  }

  if (mode === 'manual') {
    steps.push(...def.steps)
  }

  return { steps, layerBoundaries }
}
