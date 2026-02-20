import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router'
import { driver, type Driver } from 'driver.js'
import 'driver.js/dist/driver.css'
import '../styles/tour.css'
import { getTourIdForRoute, loadTourDefinition } from '../tours/tourRegistry'
import { isTourCompleted, markTourCompleted } from '../tours/tourStorage'
import type { TourDefinition, TourId } from '../tours/types'

/** Delay before auto-starting a tour (ms) to let page content render */
const AUTO_START_DELAY = 300

/** Max retries waiting for isReady() to return true */
const MAX_READY_RETRIES = 10

/** Interval between isReady() checks (ms) */
const READY_CHECK_INTERVAL = 200

export function useTour() {
  const { pathname } = useLocation()
  const [tourId, setTourId] = useState<TourId | null>(null)
  const driverRef = useRef<Driver | null>(null)
  const definitionRef = useRef<TourDefinition | null>(null)

  // Resolve tour ID from the current route
  useEffect(() => {
    const id = getTourIdForRoute(pathname)
    setTourId(id)

    if (!id) {
      definitionRef.current = null
      return
    }

    loadTourDefinition(id).then((def) => {
      definitionRef.current = def
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
      setTimeout(checkReady, READY_CHECK_INTERVAL)
    }

    setTimeout(checkReady, AUTO_START_DELAY)
  }, [])

  // Auto-start on route change if tour not yet completed
  useEffect(() => {
    if (!tourId) return

    // Wait for definition to load then check completion
    const timer = setTimeout(() => {
      const def = definitionRef.current
      if (!def) return
      if (isTourCompleted(def.id, def.version)) return
      startTour()
    }, AUTO_START_DELAY)

    return () => clearTimeout(timer)
  }, [tourId, startTour])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (driverRef.current) {
        driverRef.current.destroy()
      }
    }
  }, [])

  const replay = useCallback(() => {
    startTour()
  }, [startTour])

  return { tourId, replay }
}
