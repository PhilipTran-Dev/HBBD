export const INITIAL_CARDS = [
  { id: 'main', src: '/images/main character.png', isMain: true, name: 'Main Character' },
  { id: 'c1', src: '/images/character 1.png', isMain: false, name: 'Celebrity 1' },
  { id: 'c2', src: '/images/character 2.png', isMain: false, name: 'Celebrity 2' },
  { id: 'c3', src: '/images/character 3.png', isMain: false, name: 'Celebrity 3' },
  { id: 'c4', src: '/images/character 4.png', isMain: false, name: 'Celebrity 4' },
  { id: 'c5', src: '/images/character 5.png', isMain: false, name: 'Celebrity 5' },
  { id: 'c6', src: '/images/character  6.png', isMain: false, name: 'Celebrity 6' },
  { id: 'c7', src: '/images/character 7.png', isMain: false, name: 'Celebrity 7' },
  { id: 'c8', src: '/images/character 8.png', isMain: false, name: 'Celebrity 8' },
]

export function shuffleCards(cards) {
  const next = [...cards]
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[next[i], next[j]] = [next[j], next[i]]
  }
  return next
}

export function createShuffledDeck() {
  return shuffleCards(INITIAL_CARDS)
}
