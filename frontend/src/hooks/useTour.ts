import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router'
import { driver, type Driver } from 'driver.js'
import 'driver.js/dist/driver.css'
import '../styles/tour.css'
import { getTourIdForRoute, loadTourDefinition } from '../tours/tourRegistry'
import { isTourCompleted, markTourCompleted } from '../tours/tourStorage'
import type { TourDefinition, TourId } from '../tours/types'

/** Delay before auto-starting a tour or checking isReady() (ms), to let page content render */
const AUTO_START_DELAY = 300

/** Max retries waiting for isReady() to return true. After exhausting retries, the tour force-starts anyway. */
const MAX_READY_RETRIES = 10

/** Interval between isReady() checks (ms) */
const READY_CHECK_INTERVAL = 200

export function useTour() {
  const { pathname } = useLocation()
  const [tourId, setTourId] = useState<TourId | null>(null)
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
      return
    }

    loadTourDefinition(id)
      .then((def) => {
        definitionRef.current = def
      })
      .catch(() => {
        definitionRef.current = null
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
      if (def.isReady() || retries >= MAX_READY_RETRIES) {
        d.drive()
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

  return { tourId, replay }
}
