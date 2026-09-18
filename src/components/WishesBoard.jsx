import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { motion, useAnimationControls } from 'framer-motion'
import { Loader2, Mail, MailOpen } from 'lucide-react'
import {
  buildFrameConstraints,
  getBoundingClientRectSafe,
  getRefRect,
  isMobileViewport,
} from '../lib/dom'

const MAX_ENVELOPES = 12

// Safe-area drag margins (px). The top band protects the status bar / camera
// notch, the bottom band clears the action buttons, and the side bumpers keep
// an envelope's full box on screen. Everything below derives from these, so a
// letter can NEVER leave the visible viewport.
const SAFE_LEFT = 16
const SAFE_RIGHT = 16
const SAFE_TOP = 70
const SAFE_BOTTOM = 80

const ENVELOPE_PALETTES = [
  { bg: 'from-amber-200 to-yellow-300', border: 'border-amber-400', badge: 'bg-amber-100 text-amber-800' },
  { bg: 'from-pink-200 to-rose-300', border: 'border-pink-400', badge: 'bg-pink-100 text-pink-800' },
  { bg: 'from-sky-200 to-blue-300', border: 'border-sky-400', badge: 'bg-sky-100 text-sky-800' },
  { bg: 'from-purple-200 to-violet-300', border: 'border-purple-400', badge: 'bg-purple-100 text-purple-800' },
  { bg: 'from-emerald-200 to-teal-300', border: 'border-emerald-400', badge: 'bg-emerald-100 text-emerald-800' },
]

function seededUnit(seed) {
  let hash = 2166136261
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return ((hash >>> 0) % 1000) / 1000
}

/**
 * Deterministic full-viewport layout, clamped to zones that are guaranteed
 * clear on mobile:
 *   - top 16%..65%: stays below the status bar / notch AND above the bottom
 *     navigation / action buttons.
 *   - left 8%..72%: stays inside the screen edges and clear of edge gestures.
 */
function buildLayout(wishes) {
  const clamped = wishes.slice(0, MAX_ENVELOPES)
  if (clamped.length === 1) {
    const wish = clamped[0]
    return [
      {
        wish: wish,
        left: '15%',
        top: '22%',
        duration: 6 + seededUnit('999-d') * 4,
        delay: seededUnit('999-t') * 1.2,
        tilt: -8 + seededUnit('999-r') * 16,
        palette: ENVELOPE_PALETTES[Number(wish.id) % ENVELOPE_PALETTES.length],
      },
    ]
  }

  return clamped.map((wish) => {
    const key = String(wish.id)
    return {
      wish,
      left: `${8 + seededUnit(`${key}-x`) * 64}%`,
      top: `${16 + seededUnit(`${key}-y`) * 49}%`,
      duration: 6 + seededUnit(`${key}-d`) * 4,
      delay: seededUnit(`${key}-t`) * 1.2,
      tilt: -8 + seededUnit(`${key}-r`) * 16,
      palette: ENVELOPE_PALETTES[Number(key) % ENVELOPE_PALETTES.length],
    }
  })
}

// On mobile the continuous backdrop-blur compositing on a busy canvas is one
// of the biggest GPU-overdraw culprits, so it degrades to a near-solid panel.
function FloatingStatus({ children, mobile }) {
  return (
    <div
      className={`pointer-events-none absolute left-1/2 top-[12%] flex -translate-x-1/2 items-center gap-2 rounded-full px-4 py-2 text-center shadow ${
        mobile ? 'bg-white/95' : 'bg-white/80 backdrop-blur'
      }`}
    >
      {children}
    </div>
  )
}

function FloatingEnvelope({
  boardRef,
  wish,
  left,
  top,
  duration,
  delay,
  tilt,
  palette,
  paused,
  onOpenWish,
}) {
  // Stays `true` while the envelope is being dragged and held right after
  // release, absorbing the synthetic click browsers emit on touch-up.
  const isDraggingRef = useRef(false)

  // Boundary snapback: a defensive second layer — even though the constraint
  // deltas alone guarantee the envelope stays in the safe area, this eases it
  // home if a mid-drag viewport change ever leaves it slightly out of bounds.
  const snapControls = useAnimationControls()

  // Numeric drag constraints are DELTAS from the envelope's initial CSS
  // position (x=y=0 at rest), never absolute viewport coords. We compute the
  // safe region from the full-screen board rect (with SAFE_* margins) and
  // convert it into exact min/max deltas via buildFrameConstraints, so the
  // envelope's box physically cannot cross the padded screen edge. Pure math,
  // no ref handed to framer — it cannot crash on a detached ref either.
  const [constraints, setConstraints] = useState(null)
  useLayoutEffect(() => {
    const isSm = typeof window !== 'undefined' && window.matchMedia('(min-width: 640px)').matches
    const size = isSm ? 96 : 80

    const compute = () => {
      const rect = getRefRect(boardRef)
      const width = rect?.width ?? (typeof window !== 'undefined' ? window.innerWidth : 0)
      const height = rect?.height ?? (typeof window !== 'undefined' ? window.innerHeight : 0)
      const originX = rect?.left ?? 0
      const originY = rect?.top ?? 0

      const safeFrame = {
        left: originX + SAFE_LEFT,
        top: originY + SAFE_TOP,
        width,
        height,
        right: originX + width - SAFE_RIGHT,
        bottom: originY + height - SAFE_BOTTOM,
      }
      return buildFrameConstraints(safeFrame, { left, top, width: size, height: size })
    }

    let alive = true
    const frameId = requestAnimationFrame(() => {
      if (alive) setConstraints(compute())
    })

    // Recompute on rotation / resize so constraints never go stale.
    const onResize = () => {
      setConstraints(compute())
    }
    window.addEventListener('resize', onResize)

    return () => {
      alive = false
      cancelAnimationFrame(frameId)
      window.removeEventListener('resize', onResize)
    }
  }, [boardRef, left, top])

  const handleClick = (event) => {
    // A drag / hold-and-move must never open the letter modal. Only a clean,
    // deliberate tap without any pointer displacement should.
    if (isDraggingRef.current) {
      event.stopPropagation()
      return
    }
    onOpenWish(wish)
  }

  const handleDragEnd = (event) => {
    // Keep the flag true momentarily so the trailing click emitted on
    // touch release is swallowed and cannot open the modal.
    setTimeout(() => {
      isDraggingRef.current = false
    }, 100)

    // Defensive snapback against the same SAFE_* bounds used by the
    // constraints. With dragMomentum=false this fires only in exotic cases
    // (e.g. viewport resize mid-drag) — and the envelope is ALWAYS brought
    // back into view instead of being lost off-screen.
    const rect = getBoundingClientRectSafe(event?.currentTarget)
    if (!rect) return
    const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : rect.right
    const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : rect.bottom
    const safeRight = viewportWidth - SAFE_RIGHT
    const safeBottom = viewportHeight - SAFE_BOTTOM
    const outOfBounds =
      rect.left < SAFE_LEFT ||
      rect.top < SAFE_TOP ||
      rect.right > safeRight ||
      rect.bottom > safeBottom
    if (outOfBounds) {
      snapControls.start({
        x: 0,
        y: 0,
        transition: { type: 'spring', stiffness: 260, damping: 22 },
      })
    }
  }

  return (
    <motion.button
      type="button"
      drag
      dragConstraints={constraints ?? undefined}
      dragElastic={0.08}
      dragMomentum={false}
      dragSnapToOrigin={false}
      dragTransition={{ bounceStiffness: 260, bounceDamping: 20 }}
      onDragStart={() => {
        isDraggingRef.current = true
      }}
      onDragEnd={handleDragEnd}
      onClick={handleClick}
      initial={{ scale: 0, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={{ scale: 0, opacity: 0 }}
      whileHover={{ scale: 1.06 }}
      whileDrag={{ scale: 1.15, zIndex: 40, cursor: 'grabbing' }}
      aria-label={`Mở thư của ${wish.sender_name}`}
      className="pointer-events-auto absolute z-30 flex h-20 w-20 cursor-grab touch-none select-none flex-col items-center justify-center focus:outline-none focus-visible:ring-4 focus-visible:ring-amber-300 active:cursor-grabbing sm:h-24 sm:w-24"
      style={{
        left,
        top,
        touchAction: 'none',
        willChange: 'transform',
        transform: 'translate3d(0, 0, 0)',
      }}
    >
      <motion.div
        animate={
          paused
            ? { y: 0, x: 0, rotate: tilt }
            : {
                y: [0, -26, 14, -16, 0],
                x: [0, 16, -12, 10, 0],
                rotate: [tilt - 5, tilt + 6, tilt - 4, tilt + 4, tilt],
              }
        }
        transition={{
          duration,
          delay: paused ? 0 : delay,
          repeat: paused ? 0 : Infinity,
          ease: 'easeInOut',
        }}
        className={`relative grid h-14 w-14 place-items-center rounded-2xl border-2 ${palette.border} bg-gradient-to-br ${palette.bg} shadow-lg sm:h-16 sm:w-16`}
        style={{ willChange: 'transform', transform: 'translate3d(0, 0, 0)' }}
      >
        <Mail className="h-7 w-7 text-slate-800 sm:h-8 sm:w-8" />
        <span className="absolute -right-2 -top-2 text-base">💌</span>
      </motion.div>
      <span className={`mt-1 max-w-[5rem] truncate rounded-full ${palette.badge} px-2 py-0.5 text-[10px] font-bold shadow`}>
        {wish.sender_name}
      </span>
    </motion.button>
  )
}

export default function WishesBoard({
  wishes,
  loading,
  error,
  onOpenWish,
  pausedId,
}) {
  const boardRef = useRef(null)
  const mobile = useMemo(() => isMobileViewport(), [])
  const items = useMemo(() => buildLayout(wishes), [wishes])

  return (
    <div ref={boardRef} className="pointer-events-none fixed inset-0 z-30 overflow-hidden">
      {loading && (
        <FloatingStatus mobile={mobile}>
          <Loader2 className="h-4 w-4 animate-spin text-amber-500" />
          <p className="text-xs font-semibold text-slate-500">
            Đang mở hộp thư chúc mừng...
          </p>
        </FloatingStatus>
      )}

      {!loading && error && (
        <FloatingStatus mobile={mobile}>
          <MailOpen className="h-4 w-4 text-rose-400" />
          <p className="text-xs font-semibold text-slate-500">
            Hộp thư đang bận, chưa mở được rồi 🥲
          </p>
        </FloatingStatus>
      )}

      {!loading && !error && items.length === 0 && (
        <FloatingStatus mobile={mobile}>
          <Mail className="h-4 w-4 text-amber-500" />
          <p className="text-xs font-semibold text-slate-500">
            Chưa có lá thư nào. Gửi lời chúc đầu tiên nha!
          </p>
        </FloatingStatus>
      )}

      {!loading &&
        !error &&
        items.map(({ wish, left, top, duration, delay, tilt, palette }) => (
          <FloatingEnvelope
            key={wish.id}
            boardRef={boardRef}
            wish={wish}
            left={left}
            top={top}
            duration={duration}
            delay={delay}
            tilt={tilt}
            palette={palette}
            paused={pausedId === wish.id}
            onOpenWish={onOpenWish}
          />
        ))}
    </div>
  )
}