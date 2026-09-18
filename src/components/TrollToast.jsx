import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'

export default function TrollToast({ visible, onDismiss }) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center px-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            role="alert"
            onClick={onDismiss}
            initial={{ scale: 0.6, y: 30, rotate: -4 }}
            animate={{
              scale: 1,
              y: 0,
              rotate: [0, -2, 2, -1, 0],
            }}
            exit={{ scale: 0.8, y: 20, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 18 }}
            className="pointer-events-auto relative flex max-w-xs cursor-pointer items-center gap-3 rounded-3xl border-4 border-amber-300 bg-white px-5 py-4 text-left shadow-2xl"
          >

            <div>
              <p className="text-xs font-black uppercase tracking-widest text-amber-600">
                Ẹc Ẹc sai rồi bà nội!
              </p>
              <p className="mt-1 text-base font-bold leading-snug text-slate-800">
                Sai rồi bà nội! Đoán lại dùm cái đi má!
              </p>
            </div>
            <button
              type="button"
              aria-label="Đóng"
              onClick={onDismiss}
              className="absolute -right-2 -top-2 grid h-7 w-7 place-items-center rounded-full bg-slate-800 text-white shadow-md transition hover:bg-slate-700"
            >
              <X className="h-4 w-4" />
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
