import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router'
import { driver, type Driver } from 'driver.js'
import 'driver.js/dist/driver.css'
import '../styles/tour.css'
import { getTourIdForRoute, loadTourDefinition } from '../tours/tourRegistry'
import { markTourCompleted } from '../tours/tourStorage'
import type { TourDefinition, TourId } from '../tours/types'

/** Delay before checking isReady() (ms), to let page content render */
const AUTO_START_DELAY = 300

/** Max retries waiting for isReady() to return true. After exhausting retries, the tour silently aborts. */
const MAX_READY_RETRIES = 25

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
