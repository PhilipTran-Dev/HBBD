import { AnimatePresence, motion } from 'framer-motion'
import { Heart, X } from 'lucide-react'
import { formatTimestamp } from '../lib/db'

export default function WishModal({ wish, onClose }) {
  return (
    <AnimatePresence>
      {wish && (
        <motion.div
          className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.button
            type="button"
            aria-label="Đóng thư"
            onClick={onClose}
            className="absolute inset-0 cursor-default bg-black/40 backdrop-blur-md"
          />

          <motion.div
            role="dialog"
            aria-modal="true"
            initial={{ scale: 0.85, y: 40, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.9, y: 24, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 240, damping: 22 }}
            className="relative w-full max-w-sm overflow-hidden rounded-[1.75rem] border border-amber-200/70 bg-[#fffdf5] shadow-2xl"
          >
            <div className="h-2 w-full bg-gradient-to-r from-amber-300 via-yellow-400 to-amber-300" />

            <div className="relative px-6 pb-7 pt-6">
              <div className="pointer-events-none absolute right-4 top-5 select-none text-3xl opacity-80">
                💌
              </div>

              <p className="text-[10px] font-black uppercase tracking-[0.3em] text-amber-600/90">
                Thư gửi sinh nhật
              </p>
              <h2 className="mt-2 break-words pr-10 font-[family-name:Caveat,cursive] text-3xl font-bold leading-tight text-slate-800">
                {wish.sender_name}
              </h2>
              <p className="mt-1 text-xs font-medium text-slate-400">
                {formatTimestamp(wish.created_at)}
              </p>

              <div className="my-5 flex items-center gap-3">
                <span className="h-px flex-1 bg-gradient-to-r from-transparent via-amber-300 to-transparent" />
                <Heart className="h-4 w-4 fill-rose-300 text-rose-300" />
                <span className="h-px flex-1 bg-gradient-to-r from-transparent via-amber-300 to-transparent" />
              </div>

              <p className="max-h-[45vh] overflow-y-auto whitespace-pre-wrap break-words font-[family-name:Caveat,cursive] text-2xl leading-relaxed text-slate-700">
                {wish.message}
              </p>

              <button
                type="button"
                onClick={onClose}
                className="mt-7 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-amber-300 via-yellow-400 to-amber-500 px-5 py-3 text-sm font-extrabold text-slate-900 shadow-md ring-1 ring-amber-200 transition hover:brightness-105 focus:outline-none focus-visible:ring-4 focus-visible:ring-amber-300"
              >
                <Heart className="h-4 w-4" />
                Thương lắm, đóng thư nha
              </button>
            </div>

            <button
              type="button"
              aria-label="Đóng"
              onClick={onClose}
              className="absolute right-3 top-5 grid h-8 w-8 place-items-center rounded-full bg-slate-800 text-white shadow-md transition hover:bg-slate-700"
            >
              <X className="h-4 w-4" />
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
