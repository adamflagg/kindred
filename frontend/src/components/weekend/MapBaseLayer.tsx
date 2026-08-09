/**
 * The camp map's base layer: the illustration, the scrim that keeps marks
 * legible over it, and the notice that stands in when the art is missing.
 *
 * EXTRACTED FROM `LodgingMap` (kindred#2013) rather than written a second
 * time. The admin unit editor needs the same backdrop under its draggable pin,
 * and a second renderer would be a second thing to keep registered with
 * `MAP_ASPECT`, with the private art's path, and with how that art's ABSENCE
 * is reported. Nothing about roster, clustering or peeks lives here — this is
 * the picture and nothing else, which is what makes it shareable.
 *
 * IMPORT BY DIRECT PATH, never through `../weekend`'s barrel (kindred#1964).
 * The barrel re-exports `LodgingBoard`/`LodgingMap`, and
 * `WeekendRosterPage.chunkGraph.test.ts` asserts neither is reachable by a
 * STATIC import edge; the admin surface is eager, so a barrel import from
 * there would drag the whole weekend map into the app's first load.
 *
 * IMAGE-FAILURE STATE LIVES HERE, not in the caller. It is a fact about this
 * one <img> element and nothing above it ever read it — keeping it local is
 * what lets both callers get the fallback for free.
 */
import { useState } from 'react'

import type { Viewport } from './mapViewport'

/** Served from the private repo, exactly as the logos are. */
export const MAP_IMAGE_URL = '/local/assets/camp-map.webp'

/**
 * The scrim over the map, so the marks read against a busy illustration.
 *
 * A CONSTANT AND NOT A PROP (kindred#1997): "Fade map" used to be a control
 * and was deliberately retired, so a `fade` override here would quietly hand
 * one caller the knob every caller had taken away.
 */
export const DEFAULT_FADE = 25

export interface MapBaseLayerProps {
  /** Pan/zoom of the surface drawing over this layer. */
  view: Viewport
  /** Canvas size in real pixels; the image is laid out against it. */
  width: number
  height: number
}

export function MapBaseLayer({ view, width, height }: MapBaseLayerProps) {
  const [imageFailed, setImageFailed] = useState(false)

  return (
    <>
      {!imageFailed && (
        <img
          data-testid="map-backdrop"
          src={MAP_IMAGE_URL}
          alt=""
          loading="lazy"
          onError={() => {
            setImageFailed(true)
          }}
          style={{
            width,
            height,
            transform: `translate(${String(view.tx)}px, ${String(view.ty)}px) scale(${String(view.k)})`,
            // LOAD-BEARING, not incidental. The marks are placed at
            // `u * size * k + t`, which matches this image only while it
            // scales about its top-left. With the CSS default of 50% 50%
            // an image point lands at `k*a + (1-k)*w/2 + t` — an offset
            // that is ZERO ONLY AT k=1, so the map would look
            // pixel-perfect at rest and drift further out of register the
            // more you zoom. jsdom performs no layout, so no test here can
            // catch it; the algebra is the only guard.
            transformOrigin: '0 0',
          }}
          className="pointer-events-none absolute top-0 left-0 max-w-none"
        />
      )}
      {/* Pinned at DEFAULT_FADE, not a control anymore (kindred#1997):
          marks reading against a busy illustration is not a question
          the user should be asked. */}
      <div
        data-testid="map-scrim"
        aria-hidden="true"
        style={{ opacity: DEFAULT_FADE / 100 }}
        className="bg-card pointer-events-none absolute inset-0"
      />
      {imageFailed && (
        <p className="text-muted-foreground pointer-events-none absolute top-3 left-3 text-xs">
          Map image unavailable — showing positions only.
        </p>
      )}
    </>
  )
}
