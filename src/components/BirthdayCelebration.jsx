import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion, useAnimationControls } from 'framer-motion'
import { Clock, Loader2, Send } from 'lucide-react'
import Toast from './Toast'
import WishModal from './WishModal'
import WishesBoard from './WishesBoard'
import { fetchSubmissionStatus, fetchWishes, saveWish } from '../lib/db'
import { fireSubmissionBurst } from '../lib/confetti'
import { isMobileViewport } from '../lib/dom'

const TOAST_DURATION = 3200
const LOCK_MS = 30 * 60 * 1000
const POLL_INTERVAL_MS = 10 * 1000
const COOLDOWN_KEY = 'wish_cooldown_until'
const CELEBRATION_EMOJIS = ['💛', '🌸', '🌼', '💖', '🌻', '✨']

function formatCountdown(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds))
  const mm = String(Math.floor(seconds / 60)).padStart(2, '0')
  const ss = String(seconds % 60).padStart(2, '0')
  return `${mm}:${ss}`
}

export default function BirthdayCelebration({ photoSrc }) {
  const [wishes, setWishes] = useState([])
  const [boardLoading, setBoardLoading] = useState(true)
  const [boardError, setBoardError] = useState(null)

  const [senderName, setSenderName] = useState('')
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const [toast, setToast] = useState(null)
  const [openWish, setOpenWish] = useState(null)
  const [lock, setLock] = useState(null)
  const isLocked = lock !== null

  const formShake = useAnimationControls()
  const toastTimer = useRef(null)
  // Screens are either mobile or desktop for a session; resolve once.
  const mobile = useMemo(() => isMobileViewport(), [])

  const showToast = useCallback(
    (variant, title, text, duration = TOAST_DURATION) => {
      setToast({ id: `${Date.now()}-${Math.random()}`, variant, title, message: text })
      if (toastTimer.current) clearTimeout(toastTimer.current)
      toastTimer.current = setTimeout(() => setToast(null), duration)
    },
    [],
  )

  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current)
    },
    [],
  )

  const loadWishes = useCallback(async () => {
    const rows = await fetchWishes()
    setWishes(rows)
  }, [])

  useEffect(() => {
    let alive = true
      ; (async () => {
        try {
          const rows = await fetchWishes()
          if (!alive) return
          setWishes(rows)
          setBoardError(null)
        } catch {
          if (alive) setBoardError('Không kết nối được server lời chúc.')
        } finally {
          if (alive) setBoardLoading(false)
        }
      })()
    return () => {
      alive = false
    }
  }, [])

  const refreshLock = useCallback(async () => {
    try {
      const status = await fetchSubmissionStatus()
      if (status.blocked && status.remainingSeconds > 0) {
        setLock({ reason: status.reason, remainingSeconds: status.remainingSeconds })
      } else {
        localStorage.removeItem(COOLDOWN_KEY)
        setLock(null)
      }
    } catch {
      // Server unreachable: keep the current lock, local countdown still drives the UI.
    }
  }, [])

  // Sync the lock state with the backend on mount, merging the local success-
  // cooldown cache so the form freezes even before the first server round-trip.
  useEffect(() => {
    let alive = true
      ; (async () => {
        const localUntil = Number(localStorage.getItem(COOLDOWN_KEY) || 0)
        const localRemaining = Math.round((localUntil - Date.now()) / 1000)

        if (!alive) return
        try {
          const status = await fetchSubmissionStatus()
          if (!alive) return
          if (status.blocked && status.remainingSeconds > 0) {
            setLock({ reason: status.reason, remainingSeconds: status.remainingSeconds })
            return
          }
          if (localRemaining > 0) {
            setLock({ reason: 'SUCCESS_COOLDOWN', remainingSeconds: localRemaining })
          } else {
            localStorage.removeItem(COOLDOWN_KEY)
            setLock(null)
          }
        } catch {
          if (localRemaining > 0) {
            setLock({ reason: 'SUCCESS_COOLDOWN', remainingSeconds: localRemaining })
          }
        }
      })()
    return () => {
      alive = false
    }
  }, [])

  // One-second countdown while the form is locked.
  useEffect(() => {
    if (!isLocked) return undefined
    const id = setInterval(() => {
      setLock((prev) =>
        prev && prev.remainingSeconds > 0
          ? { ...prev, remainingSeconds: prev.remainingSeconds - 1 }
          : prev,
      )
    }, 1000)
    return () => clearInterval(id)
  }, [isLocked])

  // Reconcile with the backend while locked so a server-side unlock (or an
  // updated lockout) is picked up automatically.
  useEffect(() => {
    if (!isLocked) return undefined
    const id = setInterval(refreshLock, POLL_INTERVAL_MS)
    return () => clearInterval(id)
  }, [isLocked, refreshLock])

  // When the countdown hits zero, confirm with the server before unlocking.
  useEffect(() => {
    if (!(lock && lock.remainingSeconds <= 0)) return undefined
    const id = setTimeout(refreshLock, 0)
    return () => clearTimeout(id)
  }, [lock, refreshLock])

  const handleSubmit = useCallback(
    async (event) => {
      event.preventDefault()
      if (submitting || isLocked) return

      const name = senderName.trim()
      const body = message.trim()

      if (!name || !body) {
        showToast('error', 'Thiếu thông tin rồi!', 'Điền tên với lời chúc đầy đủ nha!')
        return
      }

      setSubmitting(true)
      try {
        const result = await saveWish(name, body)

        if (!result.ok) {
          const data = result.data ?? {}

          if (result.status === 429) {
            setSenderName('')
            setMessage('')
            const remaining = Math.max(1, Number(data.remainingSeconds) || 1800)

            if (data.reason !== 'PENALTY_LOCKED') {
              setLock({ reason: 'SUCCESS_COOLDOWN', remainingSeconds: remaining })
              showToast(
                'troll',
                'TỪ TỪ THÔI!',
                'Đã gửi lời chúc gần đây rồi đó, đợi hết 30 phút mới được gửi tiếp nha ⏳',
              )
              return
            }

            setLock({ reason: 'PENALTY_LOCKED', remainingSeconds: remaining })
            showToast(
              'troll',
              'BỊ KHÓA 30 PHÚT!',
              'Nói hoài không nghe! Bị ban 30 phút rồi đó, hết giờ mới được quay lại chúc 🤡⛔',
              6000,
            )
            return
          }

          if (result.status === 400 && data.isAppropriate === false) {
            const strikesRemaining = Math.max(1, Number(data.strikesRemaining) || 1)
            setSenderName('')
            setMessage('')
            formShake.start({
              x: [-12, 12, -8, 8, -4, 4, 0],
              transition: { duration: 0.45, ease: 'easeInOut' },
            })
            showToast(
              'troll',
              'BẮT ĐƯỢC RỒI!',
              `Ủa alo? Nói năng tử tế lại nha má! Còn ${strikesRemaining} lần giỡn nữa là bị khóa 30 phút đó ⚠️`,
              6000,
            )
            return
          }

          throw new Error(`saveWish failed (${result.status})`)
        }

        localStorage.setItem(COOLDOWN_KEY, String(Date.now() + LOCK_MS))
        setLock({ reason: 'SUCCESS_COOLDOWN', remainingSeconds: LOCK_MS / 1000 })
        setSenderName('')
        setMessage('')
        fireSubmissionBurst()

        try {
          await loadWishes()
        } catch {
          showToast(
            'error',
            'Đã lưu nhưng...',
            'Không tải lại được hộp thư, thử tải lại trang nha!',
          )
        }

        showToast(
          'success',
          'Đã gửi! 💌',
          'Lời chúc của bạn đã bay tới nước Úc rồi nha!',
        )
      } catch {
        showToast('error', 'Có lỗi rồi 😵', 'AI hoặc máy chủ đang bận, thử lại xíu nha!')
      } finally {
        setSubmitting(false)
      }
    },
    [submitting, isLocked, senderName, message, showToast, formShake, loadWishes],
  )

  return (
    <motion.div
      key="celebration"
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.6, ease: 'easeOut' }}
      className="relative z-30 min-h-[100dvh] w-full bg-gradient-to-b from-sky-200 via-sky-50 to-amber-50 px-4 py-8"
    >
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className={`absolute -left-20 top-10 h-64 w-64 rounded-full bg-amber-200/50 ${mobile ? 'blur-xl' : 'blur-2xl'}`} />
        <div className={`absolute -right-16 bottom-24 h-72 w-72 rounded-full bg-sky-200/50 ${mobile ? 'blur-xl' : 'blur-2xl'}`} />
        {CELEBRATION_EMOJIS.map((emoji, index) =>
          mobile ? (
            // Mobile: keep the decorative emojis STATIC — six infinite
            // translate/rotate loops on a 60Hz phone are not worth it.
            <span
              key={`${emoji}-${index}`}
              aria-hidden="true"
              className="absolute select-none text-3xl"
              style={{ left: `${6 + index * 15}%`, top: '4%', transform: 'translate3d(0, 0, 0)' }}
            >
              {emoji}
            </span>
          ) : (
            <motion.span
              key={`${emoji}-${index}`}
              aria-hidden="true"
              className="absolute select-none text-3xl"
              style={{ left: `${6 + index * 15}%`, top: '4%', willChange: 'transform' }}
              animate={{ y: [0, -380], opacity: [0, 1, 0], rotate: [0, 40] }}
              transition={{
                duration: 8 + index,
                delay: index * 1.1,
                repeat: Infinity,
                ease: 'easeInOut',
              }}
            >
              {emoji}
            </motion.span>
          ),
        )}
      </div>

      <div className="relative mx-auto flex w-full max-w-md flex-col gap-6">
        {/* Celebration hero */}
        <section className={`relative overflow-hidden rounded-[2rem] border border-white/70 px-5 pb-8 pt-7 text-center shadow-xl ${
          mobile ? 'bg-white/95' : 'bg-white/60 backdrop-blur'
        }`}>
<motion.div
            initial={{ y: -14, opacity: 0, scale: 0.6 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            transition={{ type: 'spring', stiffness: 200, damping: 15 }}
            className="flex items-center justify-center"
          >
            <span
              role="img"
              aria-label="Đính lên bảng"
              className="inline-block -rotate-6 text-3xl drop-shadow-sm"
            >
              📌
            </span>
          </motion.div>

          <h1 className="mt-4 text-4xl font-black leading-tight text-slate-800 sm:text-[2.6rem]">
            Happy Birthday!
            <span className="mt-1 block text-2xl text-amber-600 sm:text-3xl">
              Happy Birthday
            </span>
          </h1>

          <motion.div
            initial={{ scale: 0.85, rotate: -6, opacity: 0 }}
            animate={{ scale: 1, rotate: -3, opacity: 1 }}
            transition={{ delay: 0.15, type: 'spring', stiffness: 130, damping: 14 }}
            className="relative mx-auto mt-7 w-48"
          >
            <div className="rounded-2xl bg-white p-3 pb-10 shadow-2xl ring-1 ring-slate-900/5">
              <div className="aspect-[3/4] overflow-hidden rounded-xl bg-slate-100">
                <img
                  src={photoSrc}
                  alt="Em gái - nhân vật chính"
                  className="h-full w-full object-cover"
                />
              </div>
            </div>
            <span className="absolute -right-4 -top-5 rotate-12 select-none text-4xl drop-shadow">
              🎀
            </span>
          </motion.div>
        </section>

        {/* Wish submission */}
        <section className="flex flex-col gap-3">
          <header className="flex items-center justify-between px-1">
            <h2 className="text-lg font-black text-slate-800">
              Gửi lời chúc của bạn 💌
            </h2>
            <span className="rounded-full bg-white/70 px-3 py-1 text-xs font-bold text-slate-500 shadow-sm">
              {wishes.length} lời chúc
            </span>
          </header>

          <motion.form
            animate={formShake}
            onSubmit={handleSubmit}
            className={`flex flex-col gap-3 rounded-3xl border border-white/80 p-5 shadow-lg ${
              mobile ? 'bg-white/95' : 'bg-white/80 backdrop-blur-md'
            }`}
          >
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-bold uppercase tracking-wide text-slate-500">
                Tên của bạn
              </span>
              <input
                type="text"
                value={senderName}
                onChange={(event) => setSenderName(event.target.value)}
                maxLength={100}
                disabled={submitting || isLocked}
                placeholder="Tên của bạn"
                className="rounded-2xl border-2 border-amber-100 bg-white px-4 py-3 text-sm font-medium text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-amber-300 focus:ring-4 focus:ring-amber-100 disabled:opacity-60"
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-bold uppercase tracking-wide text-slate-500">
                Lời chúc
              </span>
              <textarea
                rows={3}
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                maxLength={1000}
                disabled={submitting || isLocked}
                placeholder="Gửi lời chúc ấm áp nhất đến sinh nhật..."
                className="resize-none rounded-2xl border-2 border-amber-100 bg-white px-4 py-3 text-sm font-medium text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-amber-300 focus:ring-4 focus:ring-amber-100 disabled:opacity-60"
              />
            </label>

            {isLocked ? (
              <div className={`mt-1 inline-flex items-center justify-center gap-2 rounded-2xl border-2 border-amber-200 px-5 py-3.5 text-sm font-extrabold text-amber-700 shadow-md ${
                mobile ? 'bg-white/95' : 'bg-white/90 backdrop-blur'
              }`}>
                <Clock className="h-5 w-5 animate-pulse" />
                <span>
                  Đang tạm khóa: {formatCountdown(lock?.remainingSeconds)} nữa mới
                  được nhập tiếp ⏳
                </span>
              </div>
            ) : (
              <motion.button
                type="submit"
                disabled={submitting}
                whileHover={submitting ? undefined : { scale: 1.03, y: -2 }}
                whileTap={submitting ? undefined : { scale: 0.97 }}
                className="mt-1 inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-amber-300 via-yellow-400 to-amber-500 px-6 py-3.5 text-base font-extrabold text-slate-900 shadow-[0_14px_30px_-12px_rgba(234,179,8,0.95)] ring-1 ring-amber-200 transition focus:outline-none focus-visible:ring-4 focus-visible:ring-amber-300 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin" />
                    Đang gửi...
                  </>
                ) : (
                  <>
                    <Send className="h-5 w-5" />
                    Gửi Lời Chúc 💌
                  </>
                )}
              </motion.button>
            )}
          </motion.form>
        </section>

      </div>

      <WishesBoard
        wishes={wishes}
        loading={boardLoading}
        error={boardError}
        onOpenWish={setOpenWish}
        pausedId={openWish?.id}
      />

      <Toast toast={toast} onDismiss={() => setToast(null)} />
      <WishModal wish={openWish} onClose={() => setOpenWish(null)} />
    </motion.div>
  )
}