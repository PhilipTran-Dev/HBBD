import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Mic } from 'lucide-react'
import { fireCandleBlow } from '../lib/confetti'

const BLOW_THRESHOLD = 0.08
const BLOW_DURATION_MS = 300
const SAMPLE_SIZE = 2048
const EXIT_DELAY_MS = 1200

function Smoke({ particles }) {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute left-1/2 top-0 z-30"
      style={{ transform: 'translateX(-50%)' }}
    >
      {particles.map((particle) => (
        <motion.span
          key={particle.id}
          className="absolute rounded-full bg-slate-200/80"
          style={{
            width: particle.size,
            height: particle.size,
            left: particle.x,
            top: 0,
            filter: 'blur(2px)',
          }}
          initial={{ y: 0, opacity: 0.8, scale: 0.4 }}
          animate={{ y: -150, x: particle.drift, opacity: 0, scale: 2 }}
          transition={{ duration: particle.duration, delay: particle.delay, ease: 'easeOut' }}
        />
      ))}
    </div>
  )
}

function CandleScene({ extinguished, smoke, onExtinguish }) {
  return (
    <div className="relative my-9 flex w-full max-w-xs flex-col items-center">
      {/* Candle + flame */}
      <div className="relative z-20 flex flex-col items-center">
        <motion.button
          type="button"
          aria-label={extinguished ? 'Nến đã tắt' : 'Chạm để dập nến'}
          onClick={onExtinguish}
          disabled={extinguished}
          className="relative grid h-12 w-12 cursor-pointer place-items-center rounded-full focus:outline-none focus-visible:ring-4 focus-visible:ring-amber-300 disabled:cursor-default"
        >
          <AnimatePresence>
            {!extinguished && (
              <motion.div
                key="flame"
                className="relative flex h-9 w-7 items-start justify-center"
                initial={{ scale: 1, opacity: 1 }}
                exit={{
                  scale: 0,
                  opacity: 0,
                  y: -6,
                  transition: { duration: 0.5, ease: 'easeIn' },
                }}
              >
                <span
                  className="absolute -inset-3 rounded-full bg-amber-400/40 blur-2xl"
                  style={{ boxShadow: '0 0 42px 18px rgba(251, 191, 36, 0.5)' }}
                />
                <motion.span
                  className="block h-8 w-5"
                  style={{
                    background:
                      'radial-gradient(circle at 50% 78%, #fffacd 0%, #fde047 30%, #f59e0b 66%, #ea580c 100%)',
                    borderRadius: '50% 50% 50% 50% / 60% 60% 40% 40%',
                    transformOrigin: '50% 100%',
                  }}
                  animate={{
                    scaleX: [1, 0.88, 1.06, 0.94, 1],
                    scaleY: [1, 1.08, 0.92, 1.05, 1],
                    rotate: [-3, 2, -4, 3, 0],
                    opacity: [1, 0.9, 1, 0.85, 1],
                  }}
                  transition={{ duration: 0.5, repeat: Infinity, ease: 'easeInOut' }}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </motion.button>
        <div className="-mt-1 h-14 w-3 rounded-t-sm rounded-b-sm bg-gradient-to-b from-rose-100 via-rose-300 to-rose-400 ring-1 ring-rose-200">
          <div className="mx-auto mt-4 h-0.5 w-full bg-rose-500/40" />
          <div className="mt-1.5 h-0.5 w-full bg-rose-500/40" />
          <div className="mt-1.5 h-0.5 w-full bg-rose-500/40" />
        </div>
      </div>

      {extinguished && <Smoke particles={smoke} />}

      {/* Cake tiers */}
      <div className="z-10 -mt-px w-full">
        <div className="relative mx-auto w-40 rounded-t-2xl bg-gradient-to-b from-violet-100 to-violet-300 px-2 pb-2 pt-3 shadow-lg ring-1 ring-violet-300/60">
          <div className="flex items-start justify-between">
            {Array.from({ length: 5 }).map((_, index) => (
              <span key={index} className="h-2.5 w-3 rounded-b-full bg-violet-100" />
            ))}
          </div>
        </div>
        <div className="relative mx-auto -mt-1 w-60 rounded-t-[1.6rem] bg-gradient-to-b from-pink-100 to-pink-300 px-2 pb-2 pt-3 shadow-xl ring-1 ring-pink-300/60">
          <div className="flex items-start justify-between">
            {Array.from({ length: 7 }).map((_, index) => (
              <span key={index} className="h-3 w-3.5 rounded-b-full bg-pink-100" />
            ))}
          </div>
        </div>
        <div className="relative mx-auto -mt-1 w-80 max-w-full rounded-t-[2rem] bg-gradient-to-b from-amber-100 to-amber-200 px-2 pb-2 pt-3 shadow-xl ring-1 ring-amber-200/80">
          <div className="flex items-start justify-between">
            {Array.from({ length: 9 }).map((_, index) => (
              <span key={index} className="h-3.5 w-4 rounded-b-full bg-amber-50" />
            ))}
          </div>
        </div>
        <div className="mx-auto mt-1 h-4 w-full max-w-[20rem] rounded-full bg-white/80 shadow-sm" />
      </div>
    </div>
  )
}

export default function BlowCandle({ onCelebrate, onComplete }) {
  const [micState, setMicState] = useState('requesting')
  const [extinguished, setExtinguished] = useState(false)
  const [smoke, setSmoke] = useState([])

  const streamRef = useRef(null)
  const audioCtxRef = useRef(null)
  const rafRef = useRef(null)
  const extinguishLockRef = useRef(false)
  const completedRef = useRef(false)

  const stopMic = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
    if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
      audioCtxRef.current.close().catch(() => {})
      audioCtxRef.current = null
    }
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [])

  const handleExtinguishCandle = useCallback(() => {
    if (extinguishLockRef.current) return
    extinguishLockRef.current = true

    stopMic()
    setExtinguished(true)
    setSmoke(
      Array.from({ length: 7 }, (_, index) => ({
        id: index,
        x: (Math.random() - 0.5) * 34,
        drift: (Math.random() - 0.5) * 26,
        size: 10 + Math.random() * 9,
        delay: index * 0.06,
        duration: 0.9 + Math.random() * 0.8,
      })),
    )
    fireCandleBlow()
    onCelebrate?.()

    if (completedRef.current) return
    completedRef.current = true
    setTimeout(onComplete, EXIT_DELAY_MS)
  }, [stopMic, onCelebrate, onComplete])

  useEffect(() => {
    let cancelled = false
    let stream = null
    let context = null
    let analyser = null
    let raf = 0
    let blowStart = null
    const sample = new Uint8Array(SAMPLE_SIZE)

    async function listen() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('mic unavailable')

        stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        if (cancelled || extinguishLockRef.current) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }

        const Ctx = window.AudioContext || window.webkitAudioContext
        context = new Ctx()
        if (context.state === 'suspended') context.resume().catch(() => {})

        const source = context.createMediaStreamSource(stream)
        analyser = context.createAnalyser()
        analyser.fftSize = SAMPLE_SIZE
        analyser.smoothingTimeConstant = 0.3
        source.connect(analyser)

        streamRef.current = stream
        audioCtxRef.current = context
        setMicState('listening')

        const tick = () => {
          if (cancelled || extinguishLockRef.current) return
          if (context.state === 'suspended') context.resume().catch(() => {})

          analyser.getByteTimeDomainData(sample)
          let sum = 0
          for (let i = 0; i < sample.length; i += 1) {
            const value = (sample[i] - 128) / 128
            sum += value * value
          }
          const rms = Math.sqrt(sum / sample.length)

          const now = performance.now()
          if (rms > BLOW_THRESHOLD) {
            if (blowStart === null) blowStart = now
            else if (now - blowStart >= BLOW_DURATION_MS) {
              handleExtinguishCandle()
              return
            }
          } else {
            blowStart = null
          }
          raf = requestAnimationFrame(tick)
        }
        raf = requestAnimationFrame(tick)
      } catch {
        if (!cancelled) setMicState('denied')
      }
    }

    listen()

    return () => {
      cancelled = true
      if (raf) cancelAnimationFrame(raf)
      if (stream) stream.getTracks().forEach((track) => track.stop())
      if (context && context.state !== 'closed') context.close().catch(() => {})
    }
  }, [handleExtinguishCandle])

  return (
    <motion.main
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.45, ease: 'easeOut' }}
      className="relative z-30 flex min-h-[100dvh] w-full flex-col items-center justify-center overflow-hidden bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900 px-6 py-10 text-center"
    >
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute left-1/2 top-10 h-64 w-64 -translate-x-1/2 rounded-full bg-amber-400/10 blur-3xl" />
      </div>

      <motion.h1
        initial={{ y: 14, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 150, damping: 16 }}
        className="text-2xl font-black leading-tight text-white drop-shadow-sm sm:text-3xl"
      >
        Hãy ước một điều ước và thổi nến nào! 🎂✨
      </motion.h1>

      <motion.p
        initial={{ y: 10, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.1, duration: 0.4, ease: 'easeOut' }}
        className="mt-2 text-sm font-medium text-slate-300"
      >
        Thổi nhẹ vào mic điện thoại hoặc chạm vào ngọn nến
      </motion.p>

      <CandleScene extinguished={extinguished} smoke={smoke} onExtinguish={handleExtinguishCandle} />

      <div className="flex min-h-[56px] items-center justify-center">
        <AnimatePresence mode="wait">
          {!extinguished ? (
            micState === 'denied' ? (
              <motion.p
                key="denied"
                initial={{ y: 8, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ opacity: 0 }}
                className="rounded-full bg-rose-500/15 px-4 py-2 text-sm font-bold text-rose-200 ring-1 ring-rose-400/30"
              >
                Chạm trực tiếp vào ngọn lửa để dập nến nha! 👆
              </motion.p>
            ) : (
              <motion.div
                key="listening"
                initial={{ y: 8, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-sm font-bold text-white ring-1 ring-white/20 backdrop-blur"
              >
                <motion.span
                  animate={{ scale: [1, 1.06, 1] }}
                  transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
                  className="flex items-center gap-2"
                >
                  <Mic className="h-4 w-4 animate-pulse text-amber-300" />
                  {micState === 'requesting'
                    ? 'Đang xin quyền micro... 🎙️'
                    : 'Đang lắng nghe tiếng thổi... 🎙️'}
                </motion.span>
              </motion.div>
            )
          ) : (
            <motion.p
              key="done"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-sm font-bold text-amber-200"
            >
              🕯️ Nến đã tắt — chúc mừng sinh nhật!
            </motion.p>
          )}
        </AnimatePresence>
      </div>
    </motion.main>
  )
}