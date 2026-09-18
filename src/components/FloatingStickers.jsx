import { useMemo } from 'react'
import { motion } from 'framer-motion'

const STICKER_EMOJIS = ['🌼', '🌻', '🐨', '🦘', '🎂', '✨', '🕶️', '🎵']

const EDGE_MARGIN = 6

function randomBetween(min, max) {
  return min + Math.random() * (max - min)
}

function createStickers() {
  return STICKER_EMOJIS.map((emoji, index) => ({
    id: `${emoji}-${index}`,
    emoji,
    left: `${randomBetween(EDGE_MARGIN, 100 - EDGE_MARGIN)}%`,
    top: `${randomBetween(EDGE_MARGIN + 4, 100 - EDGE_MARGIN - 4)}%`,
    size: randomBetween(1.5, 3),
    duration: randomBetween(3, 5.5),
    delay: randomBetween(0, 2.5),
    tilt: randomBetween(-18, 18),
    drift: randomBetween(6, 16),
  }))
}

export default function FloatingStickers({ containerRef }) {
  const stickers = useMemo(() => createStickers(), [])

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-[5] overflow-hidden"
    >
      {stickers.map((sticker) => (
        <motion.div
          key={sticker.id}
          drag
          dragConstraints={containerRef}
          dragElastic={0.15}
          dragMomentum
          dragTransition={{ bounceStiffness: 180, bounceDamping: 16 }}
          whileHover={{ scale: 1.1 }}
          whileDrag={{ scale: 1.25, cursor: 'grabbing' }}
          className="pointer-events-auto absolute cursor-grab touch-none select-none"
          style={{ left: sticker.left, top: sticker.top }}
        >
          <motion.span
            className="block"
            style={{
              fontSize: `${sticker.size}rem`,
              filter: 'drop-shadow(0 6px 10px rgba(30, 41, 59, 0.18))',
            }}
            animate={{
              y: [0, -sticker.drift, 0],
              rotate: [sticker.tilt, sticker.tilt + 10, sticker.tilt],
            }}
            transition={{
              duration: sticker.duration,
              delay: sticker.delay,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
          >
            {sticker.emoji}
          </motion.span>
        </motion.div>
      ))}
    </div>
  )
}
