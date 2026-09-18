import { useMemo, useRef } from 'react'
import { motion } from 'framer-motion'
import { Loader2, Mail, MailOpen } from 'lucide-react'

const MAX_ENVELOPES = 12

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

function buildLayout(wishes) {
  return wishes.slice(0, MAX_ENVELOPES).map((wish) => {
    const key = String(wish.id)
    return {
      wish,
      left: `${3 + seededUnit(`${key}-x`) * 82}%`,
      top: `${4 + seededUnit(`${key}-y`) * 84}%`,
      duration: 4 + seededUnit(`${key}-d`) * 2,
      delay: seededUnit(`${key}-t`) * 1.6,
      tilt: -8 + seededUnit(`${key}-r`) * 16,
      palette: ENVELOPE_PALETTES[Number(key) % ENVELOPE_PALETTES.length],
    }
  })
}

function FloatingStatus({ children }) {
  return (
    <div className="pointer-events-none absolute left-1/2 top-[12%] flex -translate-x-1/2 items-center gap-2 rounded-full bg-white/80 px-4 py-2 text-center shadow backdrop-blur">
      {children}
    </div>
  )
}

function FloatingEnvelope({
  dragConstraints,
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

  const handleClick = (event) => {
    // A drag / hold-and-move must never open the letter modal. Only a clean,
    // deliberate tap without any pointer displacement should.
    if (isDraggingRef.current) {
      event.stopPropagation()
      return
    }
    onOpenWish(wish)
  }

  return (
    <motion.button
      type="button"
      drag
      dragConstraints={dragConstraints}
      dragElastic={0.25}
      dragMomentum
      dragTransition={{ power: 0.4, bounceStiffness: 260, bounceDamping: 20 }}
      onDragStart={() => {
        isDraggingRef.current = true
      }}
      onDragEnd={() => {
        // Keep the flag true momentarily so the trailing click emitted on
        // touch release is swallowed and cannot open the modal.
        setTimeout(() => {
          isDraggingRef.current = false
        }, 100)
      }}
      onClick={handleClick}
      initial={{ scale: 0, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={{ scale: 0, opacity: 0 }}
      whileHover={{ scale: 1.06 }}
      whileDrag={{ scale: 1.15, zIndex: 40, cursor: 'grabbing' }}
      aria-label={`Mở thư của ${wish.sender_name}`}
      className="pointer-events-auto absolute z-30 flex h-20 w-20 cursor-grab touch-none select-none flex-col items-center justify-center focus:outline-none focus-visible:ring-4 focus-visible:ring-amber-300 active:cursor-grabbing sm:h-24 sm:w-24"
      style={{ left, top }}
    >
      <motion.div
        animate={
          paused
            ? { y: 0, x: 0, rotate: tilt }
            : {
                y: [-10, 10, -10],
                x: [-5, 5, -5],
                rotate: [tilt - 3, tilt + 3, tilt - 3],
              }
        }
        transition={{
          duration,
          delay: paused ? 0 : delay,
          repeat: paused ? 0 : Infinity,
          ease: 'easeInOut',
        }}
        className={`relative grid h-14 w-14 place-items-center rounded-2xl border-2 ${palette.border} bg-gradient-to-br ${palette.bg} shadow-lg sm:h-16 sm:w-16`}
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
  const canvasRef = useRef(null)
  const items = useMemo(() => buildLayout(wishes), [wishes])

  return (
    <div
      ref={canvasRef}
      className="pointer-events-none fixed inset-x-0 top-[2%] z-30 h-[55vh] overflow-hidden"
    >
      {loading && (
        <FloatingStatus>
          <Loader2 className="h-4 w-4 animate-spin text-amber-500" />
          <p className="text-xs font-semibold text-slate-500">
            Đang mở hộp thư chúc mừng...
          </p>
        </FloatingStatus>
      )}

      {!loading && error && (
        <FloatingStatus>
          <MailOpen className="h-4 w-4 text-rose-400" />
          <p className="text-xs font-semibold text-slate-500">
            Hộp thư đang bận, chưa mở được rồi 🥲
          </p>
        </FloatingStatus>
      )}

      {!loading && !error && items.length === 0 && (
        <FloatingStatus>
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
            dragConstraints={canvasRef}
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