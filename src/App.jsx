import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useAnimationControls } from 'framer-motion'
import BirthdayCelebration from './components/BirthdayCelebration'
import BlowCandle from './components/BlowCandle'
import CardStack from './components/CardStack'
import FloatingStickers from './components/FloatingStickers'
import MuteButton from './components/MuteButton'
import StartScreen from './components/StartScreen'
import TrollToast from './components/TrollToast'
import { createShuffledDeck } from './data/cards'
import { useBackgroundMusic } from './hooks/useBackgroundMusic'
import { fireWelcomeBurst, startCelebration } from './lib/confetti'

const TROLL_DURATION = 2500

export default function App() {
  const [gameState, setGameState] = useState('START')
  const [cards, setCards] = useState(() => createShuffledDeck())
  const [trollVisible, setTrollVisible] = useState(false)
  const [isShaking, setIsShaking] = useState(false)

  const { isMuted, pauseAll, playTrack, toggleMute } = useBackgroundMusic()
  const shakeControls = useAnimationControls()
  const trollTimer = useRef(null)
  const stageRef = useRef(null)

  const clearTrollTimer = useCallback(() => {
    if (trollTimer.current) {
      clearTimeout(trollTimer.current)
      trollTimer.current = null
    }
  }, [])

  useEffect(() => clearTrollTimer, [clearTrollTimer])

  const handleStart = useCallback(() => {
    playTrack('game')
    setTrollVisible(false)
    setGameState('PLAYING')
    fireWelcomeBurst()
  }, [playTrack])

  const handleNextCard = useCallback(() => {
    setTrollVisible(false)
    setCards((prev) => (prev.length > 1 ? [...prev.slice(1), prev[0]] : prev))
  }, [])

  const showTroll = useCallback(() => {
    setTrollVisible(true)
    clearTrollTimer()
    trollTimer.current = setTimeout(() => setTrollVisible(false), TROLL_DURATION)
  }, [clearTrollTimer])

  const handleGuess = useCallback(async () => {
    if (gameState !== 'PLAYING' || cards.length === 0) return
    if (cards[0].isMain) {
      clearTrollTimer()
      setTrollVisible(false)
      // The candle-blowing stage pauses the game music; the celebration track
      // starts once the candle is extinguished.
      pauseAll()
      setGameState('BLOW_CANDLE')
      return
    }

    setIsShaking(true)
    showTroll()
    await shakeControls.start({
      x: [-12, 12, -8, 8, -4, 4, 0],
      transition: { duration: 0.4, ease: 'easeInOut' },
    })
    setIsShaking(false)
  }, [gameState, cards, clearTrollTimer, showTroll, shakeControls, pauseAll])

  useEffect(() => {
    if (gameState !== 'PLAYING') return undefined
    const onKeyDown = (event) => {
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault()
        handleNextCard()
      } else if (event.key === 'Enter') {
        event.preventDefault()
        handleGuess()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [gameState, handleNextCard, handleGuess])

  useEffect(() => {
    if (gameState !== 'SUCCESS') return undefined
    playTrack('celebration')
    const stopCelebration = startCelebration()
    return stopCelebration
  }, [gameState, playTrack])

  return (
    <div
      ref={stageRef}
      className="relative mx-auto min-h-[100dvh] w-full overflow-x-hidden bg-gradient-to-b from-sky-200 via-sky-50 to-amber-50"
    >
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -left-24 top-24 h-64 w-64 rounded-full bg-white/60 blur-3xl" />
        <div className="absolute -right-20 top-1/3 h-72 w-72 rounded-full bg-amber-200/40 blur-3xl" />
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-amber-200/70 to-transparent" />
        <span className="absolute left-4 top-1/4 animate-float-slow text-3xl opacity-70">
          ☁️
        </span>
        <span className="absolute right-6 top-16 animate-float-slow text-2xl opacity-70">
          🌼
        </span>
      </div>

      <FloatingStickers containerRef={stageRef} />

      <div className="fixed right-4 top-4 z-50">
        <MuteButton isMuted={isMuted} onToggle={toggleMute} />
      </div>

      <AnimatePresence mode="wait">
        {gameState === 'START' && (
          <StartScreen key="start" onStart={handleStart} />
        )}

        {gameState === 'PLAYING' && (
          <motion.main
            key="playing"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.4, ease: 'easeOut' }}
            className="pointer-events-none relative z-10 mx-auto flex min-h-[100dvh] w-full max-w-md flex-col justify-between overflow-hidden p-4 pt-14"
          >
            <motion.div
              animate={shakeControls}
              className="pointer-events-none flex flex-1 flex-col justify-between"
            >
              <header className="text-center">
                <h1 className="text-2xl font-black leading-tight text-slate-800 sm:text-3xl">
                  Trà trộn vào giới Idol
                </h1>

              </header>

              <div className="pointer-events-none my-4 flex flex-1 items-center justify-center">
                <CardStack
                  cards={cards}
                  onDismiss={handleNextCard}
                  disabled={isShaking}
                />
              </div>

              <div className="pointer-events-auto flex flex-col gap-3 pb-2">


                <motion.button
                  type="button"
                  onClick={handleGuess}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  animate={{ y: [0, -3, 0] }}
                  transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-amber-300 via-yellow-400 to-amber-500 px-6 py-4 text-base font-extrabold text-slate-900 shadow-[0_14px_30px_-10px_rgba(234,179,8,0.95)] ring-1 ring-amber-200 transition focus:outline-none focus-visible:ring-4 focus-visible:ring-amber-300"
                >
                  Chính là tui!
                </motion.button>
              </div>
            </motion.div>
          </motion.main>
        )}

        {gameState === 'BLOW_CANDLE' && (
          <BlowCandle
            key="blow-candle"
            onCelebrate={() => playTrack('celebration')}
            onComplete={() => setGameState('SUCCESS')}
          />
        )}

        {gameState === 'SUCCESS' && (
          <BirthdayCelebration
            key="success"
            photoSrc="/images/main character.png"
          />
        )}
      </AnimatePresence>

      <TrollToast
        visible={trollVisible}
        onDismiss={() => setTrollVisible(false)}
      />
    </div>
  )
}
