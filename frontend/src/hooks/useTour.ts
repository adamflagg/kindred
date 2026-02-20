import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router'
import { driver, type Driver } from 'driver.js'
import 'driver.js/dist/driver.css'
import '../styles/tour.css'
import { getTourIdForRoute, loadTourDefinition } from '../tours/tourRegistry'
import { isTourCompleted, markTourCompleted } from '../tours/tourStorage'
import type { HintDefinition, TourDefinition, TourId } from '../tours/types'

/** Delay before auto-starting a tour or checking isReady() (ms), to let page content render */
const AUTO_START_DELAY = 300

/** Max retries waiting for isReady() to return true. After exhausting retries, the tour silently aborts. */
const MAX_READY_RETRIES = 25

/** Interval between isReady() checks (ms) */
const READY_CHECK_INTERVAL = 200

export function useTour() {
  const { pathname } = useLocation()
  const [tourId, setTourId] = useState<TourId | null>(null)
  const [hints, setHints] = useState<HintDefinition[]>([])
  const driverRef = useRef<Driver | null>(null)
  const definitionRef = useRef<TourDefinition | null>(null)
  const pendingTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set())

  /** Track a timeout so it can be cancelled on unmount */
  const scheduleTimeout = useCallback((fn: () => void, ms: number) => {
    const id = setTimeout(() => {
      pendingTimersRef.current.delete(id)
      fn()
    }, ms)
    pendingTimersRef.current.add(id)
    return id
  }, [])

  // Resolve tour ID and load definition from the current route
  useEffect(() => {
    const id = getTourIdForRoute(pathname)
    setTourId(id)

    if (!id) {
      definitionRef.current = null
      setHints([])
      return
    }

    loadTourDefinition(id)
      .then((def) => {
        definitionRef.current = def
        setHints(def.hints ?? [])
      })
      .catch(() => {
        definitionRef.current = null
        setHints([])
      })
  }, [pathname])

  const startTour = useCallback(() => {
    const def = definitionRef.current
    if (!def || def.steps.length === 0) return

    // Clean up any existing driver
    if (driverRef.current) {
      driverRef.current.destroy()
    }

    const d = driver({
      showProgress: true,
      showButtons: ['next', 'previous', 'close'],
      popoverClass: 'kindred-tour',
      steps: def.steps,
      onDestroyed: () => {
        markTourCompleted(def.id, def.version)
      },
    })

    driverRef.current = d

    // Wait for page elements to be ready
    let retries = 0
    const checkReady = () => {
      if (def.isReady()) {
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
  }, [scheduleTimeout])

  // Auto-start on route change: wait for definition to load, then check completion
  useEffect(() => {
    if (!tourId) return

    // Chain auto-start off the definition promise to avoid racing with the async import
    loadTourDefinition(tourId)
      .then((def) => {
        definitionRef.current = def
        if (isTourCompleted(def.id, def.version)) return
        startTour()
      })
      .catch(() => {
        // Definition failed to load — gracefully skip auto-start
      })
  }, [tourId, startTour])

  // Cleanup on unmount: destroy driver and cancel pending timers
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
    startTour()
  }, [startTour])

  return { tourId, replay, hints }
}

/**
 * Lightweight hook that returns only the hints for the current route's tour.
 * Does NOT auto-play or manage the driver instance — use this in pages/components
 * that need hint data without triggering the tour lifecycle.
 */
export function useTourHints(): HintDefinition[] {
  const { pathname } = useLocation()
  const [hints, setHints] = useState<HintDefinition[]>([])

  useEffect(() => {
    let cancelled = false
    const id = getTourIdForRoute(pathname)
    if (!id) {
      // Reset via functional approach — no direct setState in effect body
      setHints((prev) => (prev.length === 0 ? prev : []))
      return
    }
    loadTourDefinition(id)
      .then((def) => {
        if (!cancelled) setHints(def.hints ?? [])
      })
      .catch(() => {
        if (!cancelled) setHints([])
      })
    return () => {
      cancelled = true
    }
  }, [pathname])

  return hints
}
