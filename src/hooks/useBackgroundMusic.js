import { useCallback, useEffect, useRef, useState } from 'react'

const TRACKS = {
  game: '/music/say so.mp3',
  celebration: '/music/happy birthday.mp3',
}

const MUSIC_VOLUME = 0.55

export function useBackgroundMusic() {
  const audiosRef = useRef(new Map())
  const isMutedRef = useRef(false)
  const activeKeyRef = useRef(null)
  const [isMuted, setIsMuted] = useState(false)

  const getAudio = useCallback((key) => {
    let audio = audiosRef.current.get(key)
    if (!audio) {
      audio = new Audio(TRACKS[key])
      audio.loop = true
      audio.preload = 'auto'
      audio.volume = MUSIC_VOLUME
      audio.muted = isMutedRef.current
      audiosRef.current.set(key, audio)
    }
    return audio
  }, [])

  const playTrack = useCallback(
    (key) => {
      if (!TRACKS[key]) return

      audiosRef.current.forEach((audio, trackKey) => {
        if (trackKey !== key) audio.pause()
      })

      const audio = getAudio(key)
      audio.muted = isMutedRef.current
      activeKeyRef.current = key

      const promise = audio.play()
      if (promise && typeof promise.catch === 'function') {
        promise.catch(() => {})
      }
    },
    [getAudio],
  )

  const pauseAll = useCallback(() => {
    audiosRef.current.forEach((audio) => audio.pause())
    activeKeyRef.current = null
  }, [])

  const toggleMute = useCallback(() => {
    const next = !isMutedRef.current
    isMutedRef.current = next
    setIsMuted(next)

    audiosRef.current.forEach((audio) => {
      audio.muted = next
    })

    const active = activeKeyRef.current
      ? audiosRef.current.get(activeKeyRef.current)
      : null
    if (!next && active) {
      const promise = active.play()
      if (promise && typeof promise.catch === 'function') {
        promise.catch(() => {})
      }
    }
  }, [])

  useEffect(
    () => () => {
      audiosRef.current.forEach((audio) => {
        audio.pause()
        audio.src = ''
      })
      audiosRef.current.clear()
    },
    [],
  )

  return { isMuted, playTrack, pauseAll, toggleMute }
}
