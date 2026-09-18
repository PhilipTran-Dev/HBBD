import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, CheckCircle2, X } from 'lucide-react'

const VARIANTS = {
  success: {
    border: 'border-emerald-300',
    iconBg: 'from-emerald-200 to-emerald-400',
    title: 'text-emerald-700',
    Icon: CheckCircle2,
    emoji: '✅',
  },
  error: {
    border: 'border-rose-300',
    iconBg: 'from-rose-200 to-rose-400',
    title: 'text-rose-700',
    Icon: AlertTriangle,
    emoji: '⚠️',
  },
  troll: {
    border: 'border-amber-300',
    iconBg: 'from-amber-200 to-yellow-400',
    title: 'text-amber-600',
    Icon: null,

  },
}

export default function Toast({ toast, onDismiss }) {
  const variant = toast ? VARIANTS[toast.variant] ?? VARIANTS.success : null

  return (
    <AnimatePresence>
      {toast && variant && (
        <motion.div
          key={toast.id}
          className="pointer-events-none fixed inset-x-0 top-20 z-[60] flex justify-center px-4"
          initial={{ opacity: 0, y: -24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -16 }}
          transition={{ type: 'spring', stiffness: 320, damping: 24 }}
        >
          <div
            role="alert"
            className={`pointer-events-auto relative flex max-w-sm items-center gap-3 rounded-3xl border-4 ${variant.border} bg-white/95 px-5 py-4 text-left shadow-2xl backdrop-blur`}
          >
            <div
              className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br ${variant.iconBg} shadow-inner`}
            >
              {variant.Icon ? (
                <variant.Icon className="h-5 w-5 text-slate-800" />
              ) : (
                <span className="text-2xl">{variant.emoji}</span>
              )}
            </div>
            <div className="pr-2">
              <p
                className={`text-xs font-black uppercase tracking-widest ${variant.title}`}
              >
                {toast.title}
              </p>
              <p className="mt-0.5 text-sm font-bold leading-snug text-slate-800">
                {toast.message}
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
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
