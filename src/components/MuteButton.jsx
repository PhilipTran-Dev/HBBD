import { motion } from 'framer-motion'
import { Volume2, VolumeX } from 'lucide-react'

export default function MuteButton({ isMuted, onToggle }) {
  return (
    <motion.button
      type="button"
      onClick={onToggle}
      aria-label={isMuted ? 'Bật nhạc nền' : 'Tắt nhạc nền'}
      title={isMuted ? 'Bật nhạc nền' : 'Tắt nhạc nền'}
      whileHover={{ scale: 1.08 }}
      whileTap={{ scale: 0.92 }}
      className="relative grid h-11 w-11 place-items-center rounded-full border border-white/50 bg-white/40 text-slate-700 shadow-lg backdrop-blur-xl transition-colors hover:bg-white/60 hover:text-amber-600 focus:outline-none focus-visible:ring-4 focus-visible:ring-amber-300"
    >
      {isMuted ? (
        <VolumeX className="h-5 w-5" strokeWidth={2.2} />
      ) : (
        <Volume2 className="h-5 w-5" strokeWidth={2.2} />
      )}
      {!isMuted && (
        <motion.span
          className="absolute inset-0 rounded-full border-2 border-amber-400"
          initial={{ opacity: 0.6, scale: 1 }}
          animate={{ opacity: 0, scale: 1.5 }}
          transition={{ duration: 1.8, repeat: Infinity, ease: 'easeOut' }}
        />
      )}
    </motion.button>
  )
}
