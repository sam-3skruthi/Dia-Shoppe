import { useEffect, useRef, useState } from 'react'

/*
  Background video reel for the hero: plays `clips` one after another with a
  crossfade, then repeats. Two <video> layers take turns: while one plays, the
  next clip is already loading in the other, so there is never a black gap.
  A clip that fails to load is skipped. If every clip fails, onFail() lets the
  hero fall back to its still image.

  With a single clip it simply loops it. With prefers-reduced-motion it shows
  the first clip's first frame, paused.
*/
const FADE_MS = 700

export default function HeroReel({ clips, className = '', onFail }) {
  const videos = useRef([])                        // the two <video> layers
  const [front, setFront] = useState(0)            // which layer is visible
  const [indexes, setIndexes] = useState([0, clips.length > 1 ? 1 : 0])
  const failed = useRef(new Set())
  const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const single = clips.length <= 1

  // start the visible layer from the top whenever the front layer changes
  // (NOT when the hidden layer loads its next clip — that must not restart it)
  useEffect(() => {
    const v = videos.current[front]
    if (!v || reduced) return
    v.currentTime = 0
    v.play().catch(() => {})
  }, [front, reduced])

  const nextIndex = (from) => {
    for (let step = 1; step <= clips.length; step += 1) {
      const i = (from + step) % clips.length
      if (!failed.current.has(i)) return i
    }
    return -1
  }

  // when the visible clip ends: show the other layer (already loaded with the
  // next clip), then load the clip after that into the now-hidden layer
  const advance = () => {
    if (single) return
    const back = 1 - front
    setFront(back)
    setTimeout(() => {
      videos.current[front]?.pause()                 // the faded-out clip stops (no hidden playback)
      setIndexes((cur) => {
        const copy = [...cur]
        const n = nextIndex(cur[back])
        if (n >= 0) copy[front] = n
        return copy
      })
    }, FADE_MS)
  }

  const onError = (layer) => {
    failed.current.add(indexes[layer])
    if (failed.current.size >= clips.length) { onFail?.(); return }
    if (layer === front) advance()
    else setIndexes((cur) => { const copy = [...cur]; copy[layer] = nextIndex(cur[layer]); return copy })
  }

  return (
    <>
      {[0, 1].map((layer) => {
        if (single && layer === 1) return null
        const clip = clips[indexes[layer]]
        if (!clip) return null
        return (
          <video
            key={layer}
            ref={(el) => { videos.current[layer] = el }}
            className={`${className} transition-opacity ease-in-out`}
            style={{ opacity: layer === front ? 1 : 0, transitionDuration: `${FADE_MS}ms` }}
            src={clip.src}
            poster={clip.poster}
            muted
            playsInline
            autoPlay={layer === front && !reduced}
            loop={single}
            preload="auto"
            onEnded={layer === front ? advance : undefined}
            onError={() => onError(layer)}
            aria-hidden="true"
          />
        )
      })}
    </>
  )
}
