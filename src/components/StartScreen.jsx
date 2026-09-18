import { motion } from 'framer-motion'
import { PartyPopper, Sparkles } from 'lucide-react'

const floatingItems = [
  { emoji: '🌼', className: 'left-6 top-16 text-4xl', delay: 0 },
  { emoji: '🌻', className: 'right-8 top-24 text-5xl', delay: 0.6 },
  { emoji: '☁️', className: 'left-10 top-40 text-4xl', delay: 1.1 },
  { emoji: '🦘', className: 'right-10 bottom-32 text-4xl', delay: 0.9 },
  { emoji: '🐨', className: 'left-8 bottom-40 text-3xl', delay: 1.5 },
]

export default function StartScreen({ onStart }) {
  return (
    <motion.div
      key="start"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.45, ease: 'easeOut' }}
      className="relative z-30 flex min-h-[100dvh] flex-col items-center justify-center overflow-hidden bg-gradient-to-b from-sky-200 via-sky-50 to-amber-50 px-6 py-10 text-center"
    >
      <div className="pointer-events-none absolute -left-16 top-24 h-56 w-56 rounded-full bg-amber-200/50 blur-3xl" />
      <div className="pointer-events-none absolute -right-14 bottom-24 h-64 w-64 rounded-full bg-sky-200/60 blur-3xl" />

      {floatingItems.map((item) => (
        <motion.span
          key={item.emoji + item.className}
          aria-hidden="true"
          className={`pointer-events-none absolute select-none drop-shadow-sm ${item.className}`}
          animate={{ y: [0, -14, 0], rotate: [0, 6, 0] }}
          transition={{
            duration: 6,
            delay: item.delay,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        >
          {item.emoji}
        </motion.span>
      ))}

      <motion.div
        initial={{ y: 24, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.1, type: 'spring', stiffness: 120, damping: 16 }}
        className="relative z-10 w-full max-w-md"
      >
        <h1 className="text-4xl font-black leading-tight text-slate-800 drop-shadow-sm sm:text-5xl">
          Trà trộn vào giới Idol
        </h1>


        <motion.div
          initial={{ rotate: -6, scale: 0.9 }}
          animate={{ rotate: [-6, -3, -6], scale: 1 }}
          transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
          className="relative mx-auto mt-8 w-40"
        >
          <div className="absolute inset-0 translate-x-3 translate-y-2 rotate-6 rounded-2xl bg-white shadow-xl" />
          <div className="absolute inset-0 -translate-x-2 translate-y-1 -rotate-3 rounded-2xl bg-white shadow-xl" />
          <div className="relative grid aspect-[3/4] place-items-center rounded-2xl border-8 border-white bg-gradient-to-br from-amber-100 to-sky-100 shadow-2xl">
            <span className="text-4xl font-black text-amber-500/80">?</span>
          </div>
        </motion.div>

        <motion.button
          type="button"
          onClick={onStart}
          whileHover={{ scale: 1.04, y: -2 }}
          whileTap={{ scale: 0.96 }}
          className="group mt-10 inline-flex items-center gap-3 rounded-full bg-gradient-to-r from-amber-300 via-yellow-400 to-amber-500 px-9 py-4 text-lg font-extrabold text-slate-900 shadow-[0_12px_30px_-8px_rgba(234,179,8,0.9)] ring-1 ring-amber-200 transition focus:outline-none focus-visible:ring-4 focus-visible:ring-amber-300"
        >
          <PartyPopper className="h-6 w-6 transition-transform group-hover:-rotate-12" />
          Bắt đầu chơi
          <Sparkles className="h-5 w-5 opacity-80" />
        </motion.button>
      </motion.div>
    </motion.div>
  )
}
