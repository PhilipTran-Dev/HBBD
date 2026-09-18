// Client-side API for the birthday wishes flow.
//
// All TiDB queries, Groq AI moderation, and rate-limit/strike bookkeeping run
// server-side inside the Vite dev/preview middleware (see vite.config.js). The
// browser only talks to the same-origin /api/* endpoints, so there are no CORS
// restrictions and no database/Groq credentials leak into the client bundle.

const WISHES_ENDPOINT = '/api/wishes'

export async function fetchWishes() {
  const response = await fetch(WISHES_ENDPOINT)
  if (!response.ok) {
    throw new Error(`Không tải được lời chúc (${response.status})`)
  }
  return response.json()
}

export async function fetchSubmissionStatus() {
  const response = await fetch('/api/wishes/status')
  if (!response.ok) {
    throw new Error(`Không kiểm tra được trạng thái (${response.status})`)
  }
  return response.json()
}

export async function saveWish(senderName, message) {
  const response = await fetch(WISHES_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sender_name: senderName, message }),
  })

  let data
  try {
    data = await response.json()
  } catch {
    // Non-JSON error body: keep data undefined.
  }

  return { ok: response.ok, status: response.status, data }
}

export function formatTimestamp(value) {
  if (!value) return ''
  const raw = typeof value === 'string' ? value.replace(' ', 'T') : value
  const date = value instanceof Date ? value : new Date(raw)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}