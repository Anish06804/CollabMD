import crypto from 'crypto'

// Unambiguous alphabet: no 0/O, 1/I/L to keep codes readable when spoken aloud.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

export function generateRoomCode(length = 6): string {
  const bytes = crypto.randomBytes(length)
  let out = ''
  for (let i = 0; i < length; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length]
  }
  return out
}

const USER_COLORS = [
  '#f87171', // red
  '#fb923c', // orange
  '#facc15', // yellow
  '#4ade80', // green
  '#2dd4bf', // teal
  '#38bdf8', // sky
  '#818cf8', // indigo
  '#c084fc', // purple
  '#f472b6', // pink
  '#a3e635', // lime
]

export function randomUserColor(): string {
  return USER_COLORS[crypto.randomInt(USER_COLORS.length)]
}
