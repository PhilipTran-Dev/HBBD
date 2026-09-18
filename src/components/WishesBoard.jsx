import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { motion, useAnimationControls } from 'framer-motion'
import { Loader2, Mail, MailOpen } from 'lucide-react'
import { buildFrameConstraints, getBoundingClientRectSafe, isMobileViewport } from '../lib/dom'

const MAX_ENVELOPES = 12

// Full-viewport drag padding (px) kept free on every side so a letter can
// roam the whole screen organically but can never be dragged under the home
// indicator, the browser chrome, or into a gesture zone.
const DRAG_PADDING = 16

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
 * Deterministic full-viewport layout.
 *
 * Spawn bands avoid the unsafe zones on a phone: nothing starts inside the
 * notch/status-bar strip (< ~14% height) and nothing below the action buttons
 * (> ~75% height). A lone letter gets a centered, comfortable seat near the
 * upper-middle instead of being parked in a corner under the camera.
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
    // top: 14% -> 72%, always clear of the notch strip and bottom controls.
    // left: 6% -> 78%, avoids the screen edges and inside-buttons.
    return {
      wish,
      left: `${6 + seededUnit(`${key}-x`) * 72}%`,
      top: `${14 + seededUnit(`${key}-y`) * 58}%`,
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
  mobile,
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

  // Boundary snapback: if a fling ends up out of the visible safe area, ease
  // the envelope smoothly back to its slot instead of losing it forever.
  const snapControls = useAnimationControls()

  // Numeric drag constraints bound to the full viewport with a DRAG_PADDING
  // bumper on every side. Computed as pure math (no live ref measurement —
  // framer-motion throws `e.getBoundingClientRect is not a function` when a
  // constraint ref detaches), so signing a drag can never crash.
  //
  // The envelope is square in both breakpoints (w-20/h-20 = 80px,
  // sm:w-24/sm:h-24 = 96px), so width and height always match.
  const [constraints, setConstraints] = useState(null)
  useLayoutEffect(() => {
    const isSm = typeof window !== 'undefined' && window.matchMedia('(min-width: 640px)').matches
    const size = isSm ? 96 : 80

    const compute = () => {
      if (typeof window === 'undefined') return null
      const width = window.innerWidth
      const height = window.innerHeight
      // Shrink the frame by DRAG_PADDING on each side; buildFrameConstraints
      // then keeps the envelope's full box inside that region.
      const paddedFrame = {
        left: DRAG_PADDING,
        top: DRAG_PADDING,
        width: width - DRAG_PADDING * 2,
        height: height - DRAG_PADDING * 2,
        right: width - DRAG_PADDING,
        bottom: height - DRAG_PADDING,
      }
      return buildFrameConstraints(paddedFrame, { left, top, width: size, height: size })
    }

    let alive = true
    const frameId = requestAnimationFrame(() => {
      if (alive) setConstraints(compute())
    })

    // Recompute when the viewport changes so a rotation / resize can never
    // leave stale boundaries that send envelopes off-screen.
    const onResize = () => {
      setConstraints(compute())
    }
    window.addEventListener('resize', onResize)

    return () => {
      alive = false
      cancelAnimationFrame(frameId)
      window.removeEventListener('resize', onResize)
    }
  }, [left, top])

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

    // Boundary recovery: if the envelope was flung past the padded viewport
    // region (a hard fling can overshoot the elastic on desktop momentum),
    // tween it smoothly back to its slot (x/y -> 0 returns to the CSS
    // left/top position).
    const rect = getBoundingClientRectSafe(event?.currentTarget)
    if (!rect) return
    if (typeof window === 'undefined') return
    const safeRight = window.innerWidth - DRAG_PADDING
    const safeBottom = window.innerHeight - DRAG_PADDING
    const outOfBounds =
      rect.left < DRAG_PADDING ||
      rect.top < DRAG_PADDING ||
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
      dragElastic={0.2}
      dragMomentum={!mobile}
      dragTransition={{ power: 0.4, bounceStiffness: 260, bounceDamping: 20 }}
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
      style={{ left, top, willChange: 'transform', transform: 'translate3d(0, 0, 0)' }}
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
  const mobile = useMemo(() => isMobileViewport(), [])
  const items = useMemo(() => buildLayout(wishes), [wishes])

  return (
    <div className="pointer-events-none fixed inset-0 z-30 overflow-hidden">
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
            mobile={mobile}
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