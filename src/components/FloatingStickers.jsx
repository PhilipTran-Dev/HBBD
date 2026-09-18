import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { buildFrameConstraints, getRefRect, isMobileViewport } from '../lib/dom'

const STICKER_SIZE = 48

const STICKER_POOL = [
  '🌼',
  '🌻',
  '🌸',
  '🐨',
  '🦘',
  '🎂',
  '🧁',
  '🎈',
  '💖',
  '🕶️',
  '🎵',
  '📸',
  '✨',
]

// Perimeter margins only: the top bar's corners, the left/right vertical
// gutters, and the lower band above the CTA button. The central portrait card
// zone (roughly x 15–85%, y 20–65%) stays clear so stickers never clutter the
// face or steal touches on the photo.
const PERIMETER_SLOTS = [
  { left: 1, top: 3 },
  { left: 2.5, top: 9 },
  { left: 92, top: 8 },
  { left: 95, top: 12 },
  { left: 1, top: 26 },
  { left: 3, top: 44 },
  { left: 1, top: 62 },
  { left: 94, top: 28 },
  { left: 95, top: 46 },
  { left: 92, top: 64 },
  { left: 6, top: 70 },
  { left: 30, top: 74 },
  { left: 58, top: 70 },
  { left: 86, top: 74 },
]

// Mobile keeps only 5 contact points (corners + one side) so the fragment
// stays far away from 30+ simultaneous infinite transform loops.
const MOBILE_SLOTS = PERIMETER_SLOTS.slice(0, 5)

function randomBetween(min, max) {
  return min + Math.random() * (max - min)
}

function createStickers({ mobile }) {
  const slots = mobile ? MOBILE_SLOTS : PERIMETER_SLOTS
  const emojis = slots.map((_, index) => STICKER_POOL[index % STICKER_POOL.length])

  return slots.map((slot, index) => {
    const left = Math.min(96, Math.max(0.5, slot.left + randomBetween(-1, 1)))
    const top = Math.min(88, Math.max(2, slot.top + randomBetween(-1, 1)))
    const isRightHalf = slot.left >= 50

    return {
      id: `${emojis[index]}-${index}`,
      emoji: emojis[index],
      left: `${left}%`,
      top: `${top}%`,
      mobile,
      // Drift values are only consumed by the infinite float loop, which is
      // disabled on mobile — keep them cheap to compute regardless.
      driftX: (isRightHalf ? 1 : -1) * randomBetween(6, 14),
      driftY: randomBetween(4, 10),
      duration: randomBetween(4, 6.5),
      delay: randomBetween(0, 1.5),
    }
  })
}

function FloatingSticker({ sticker, containerRef }) {
  // Stays `true` while the sticker is dragged (and briefly after release so
  // the trailing synthetic click on touch-up can never fire a tap handler).
  const isDraggingRef = useRef(false)
  const [dragging, setDragging] = useState(false)

  // Numeric, viewport-relative drag constraints computed from a GUARDED read
  // of the container ref. Framer Motion measures ref-based constraints by
  // calling `ref.current.getBoundingClientRect()` internally, which throws
  // `e.getBoundingClientRect is not a function` when the ref is detached. A
  // fixed box never touches a live ref, so it cannot crash. Measured once,
  // recomputed on resize.
  const [constraints, setConstraints] = useState(null)
  useLayoutEffect(() => {
    const compute = () => {
      const frame = getRefRect(containerRef)
      if (!frame) return null
      return buildFrameConstraints(frame, {
        left: sticker.left,
        top: sticker.top,
        width: STICKER_SIZE,
        height: STICKER_SIZE,
      })
    }

    let alive = true
    const frameId = requestAnimationFrame(() => {
      if (alive) setConstraints(compute())
    })

    const onResize = () => {
      setConstraints(compute())
    }
    window.addEventListener('resize', onResize)

    return () => {
      alive = false
      cancelAnimationFrame(frameId)
      window.removeEventListener('resize', onResize)
    }
  }, [containerRef, sticker.left, sticker.top])

  const handleClick = (event) => {
    if (isDraggingRef.current) {
      event.stopPropagation()
      return
    }
  }

  const staticEmoji = sticker.mobile
    ? { style: { transform: 'translate3d(0, 0, 0)', willChange: 'transform' } }
    : null

  return (
    <motion.div
      drag
      dragConstraints={constraints ?? undefined}
      dragElastic={0.2}
      dragMomentum={!sticker.mobile}
      dragTransition={{ bounceStiffness: 260, bounceDamping: 20 }}
      onDragStart={() => {
        isDraggingRef.current = true
        setDragging(true)
      }}
      onDragEnd={() => {
        setTimeout(() => {
          isDraggingRef.current = false
        }, 100)
        setDragging(false)
      }}
      onClick={handleClick}
      whileDrag={{ scale: 1.15, cursor: 'grabbing' }}
      className={`pointer-events-auto absolute flex min-h-[48px] min-w-[48px] cursor-grab touch-none select-none items-center justify-center active:cursor-grabbing ${
        dragging ? 'z-50' : 'z-30'
      }`}
      style={{ left: sticker.left, top: sticker.top, willChange: 'transform' }}
    >
      {sticker.mobile ? (
        <motion.span
          className="text-3xl md:text-4xl"
          {...staticEmoji}
          whileTap={{ scale: 1.25 }}
        >
          {sticker.emoji}
        </motion.span>
      ) : (
        <motion.span
          className="text-3xl md:text-4xl"
          style={{ filter: 'drop-shadow(0 5px 8px rgba(30, 41, 59, 0.25))', willChange: 'transform' }}
          animate={{
            x: [0, sticker.driftX, 0],
            y: [0, sticker.driftY, 0],
            rotate: [-12, 12, -12],
          }}
          transition={{
            duration: sticker.duration,
            delay: sticker.delay,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
          whileTap={{ scale: 1.25 }}
        >
          {sticker.emoji}
        </motion.span>
      )}
    </motion.div>
  )
}

export default function FloatingStickers({ containerRef }) {
  // Screens are either mobile or desktop for a session; resolve once so the
  // whole subtree renders consistently and stays cheap.
  const mobile = useMemo(() => isMobileViewport(), [])
  const stickers = useMemo(() => createStickers({ mobile }), [mobile])

  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-30 overflow-hidden">
      {stickers.map((sticker) => (
        <FloatingSticker key={sticker.id} sticker={sticker} containerRef={containerRef} />
      ))}
    </div>
  )
}