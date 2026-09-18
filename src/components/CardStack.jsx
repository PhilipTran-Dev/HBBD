import { AnimatePresence, motion } from 'framer-motion'

const VISIBLE_COUNT = 3

const STACK_POSITIONS = [
  { y: 0, scale: 1, rotate: -2, z: 0 },
  { y: 18, scale: 0.95, rotate: 2, z: -40 },
  { y: 36, scale: 0.9, rotate: -3, z: -80 },
]

const ENTER_FROM_BACK = { y: 96, scale: 0.78, rotate: 0, opacity: 0, z: -120 }

const POSITION_SPRING = {
  type: 'spring',
  stiffness: 260,
  damping: 26,
  mass: 0.9,
}

const DISMISS_THRESHOLD = -100
const DISMISS_VELOCITY = -600

function PolaroidCard({ card, isFront }) {
  return (
    <div className="relative h-full w-full rounded-[1.35rem] bg-white p-3 pb-9 shadow-[0_22px_45px_-14px_rgba(30,41,59,0.5)] ring-1 ring-slate-900/5">
      <div className="relative h-full w-full overflow-hidden rounded-xl bg-gradient-to-br from-slate-100 to-slate-200">
        <img
          src={card.src}
          alt={card.name}
          draggable={false}
          loading={isFront ? 'eager' : 'lazy'}
          className="h-full w-full select-none object-cover"
        />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/10 via-transparent to-white/10" />
      </div>
    </div>
  )
}

export default function CardStack({ cards, onDismiss, disabled = false }) {
  const visibleCards = cards.slice(0, VISIBLE_COUNT)
  // Render back-to-front so the active card is last in the DOM: it paints on
  // top naturally, and AnimatePresence keeps the exiting card above the rest
  // without any z-index juggling (which causes flicker).
  const stack = visibleCards
    .map((card, index) => ({ card, index }))
    .reverse()

  const handleDragEnd = (_, info) => {
    if (disabled) return
    const swipedUp =
      info.offset.y < DISMISS_THRESHOLD || info.velocity.y < DISMISS_VELOCITY
    if (swipedUp) onDismiss()
  }

  return (
    <div className="pointer-events-none relative w-full">
      <div
        className="pointer-events-auto relative mx-auto aspect-[3/4] w-full max-w-[19rem]"
        style={{ perspective: '1200px', transformStyle: 'preserve-3d' }}
      >
        <AnimatePresence>
          {stack.map(({ card, index }) => {
            const position = STACK_POSITIONS[index] ?? STACK_POSITIONS[2]
            const isFront = index === 0

            return (
              <motion.div
                key={card.id}
                initial={ENTER_FROM_BACK}
                animate={{
                  y: position.y,
                  scale: position.scale,
                  rotate: position.rotate,
                  z: position.z,
                  opacity: 1,
                }}
                exit={{
                  y: -620,
                  scale: 1.06,
                  rotate: 10,
                  z: 80,
                  opacity: 0,
                  transition: { duration: 0.42, ease: 'easeIn' },
                }}
                transition={{
                  ...POSITION_SPRING,
                  delay: isFront ? 0 : index * 0.04,
                }}
                drag={isFront && !disabled ? 'y' : false}
                dragConstraints={{ top: 0, bottom: 0 }}
                dragElastic={0.65}
                dragSnapToOrigin
                onDragEnd={handleDragEnd}
                whileDrag={{ cursor: 'grabbing' }}
                className={`absolute inset-0 ${
                  isFront ? 'cursor-grab touch-none' : 'pointer-events-none'
                }`}
              >
                <PolaroidCard card={card} isFront={isFront} />
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>
    </div>
  )
}
