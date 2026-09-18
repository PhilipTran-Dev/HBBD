import confetti from 'canvas-confetti'

const SPRING_COLORS = ['#FACC15', '#EAB308', '#FDE68A', '#FFFFFF', '#7DD3FC']

export function fireWelcomeBurst() {
  confetti({
    particleCount: 120,
    spread: 90,
    startVelocity: 45,
    origin: { y: 0.35 },
    colors: SPRING_COLORS,
    scalar: 1.05,
  })
}

export function fireSubmissionBurst() {
  confetti({
    particleCount: 70,
    angle: 90,
    spread: 100,
    startVelocity: 50,
    origin: { y: 0.3 },
    colors: SPRING_COLORS,
    scalar: 0.95,
  })
  confetti({
    particleCount: 40,
    spread: 360,
    startVelocity: 22,
    gravity: 0.6,
    ticks: 140,
    origin: { x: 0.85, y: 0.5 },
    colors: SPRING_COLORS,
  })
}

function burst() {
  confetti({
    particleCount: 3,
    angle: 60,
    spread: 65,
    startVelocity: 55,
    origin: { x: 0, y: 0.7 },
    colors: SPRING_COLORS,
  })
  confetti({
    particleCount: 3,
    angle: 120,
    spread: 65,
    startVelocity: 55,
    origin: { x: 1, y: 0.7 },
    colors: SPRING_COLORS,
  })

  if (Math.random() > 0.7) {
    confetti({
      particleCount: 8,
      spread: 360,
      startVelocity: 25,
      gravity: 0.6,
      ticks: 120,
      origin: { x: Math.random(), y: Math.random() * 0.5 },
      colors: SPRING_COLORS,
      scalar: 0.9,
    })
  }
}

/**
 * Starts a continuous confetti celebration and returns a cleanup function that
 * stops it. Safe to call from a React effect.
 */
export function startCelebration() {
  fireWelcomeBurst()
  const intervalId = setInterval(burst, 260)

  return () => {
    clearInterval(intervalId)
    confetti.reset()
  }
}
