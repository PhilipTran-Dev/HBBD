import { createWishesApi, resolveIp } from './_lib/wishes-core.js'

let api = null

function getApi() {
  if (!api) api = createWishesApi()
  return api
}

function send(res, status, payload) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(payload === undefined ? '' : JSON.stringify(payload))
}

async function readBody(req) {
  let raw = ''
  for await (const chunk of req) raw += chunk
  try {
    return raw ? JSON.parse(raw) : {}
  } catch {
    return null
  }
}

function mapCreateResult(result) {
  switch (result.kind) {
    case 'blocked':
      return {
        status: 429,
        payload: {
          ok: false,
          blocked: true,
          reason: result.reason,
          remainingSeconds: result.remainingSeconds,
        },
      }
    case 'penalty_locked':
      return {
        status: 429,
        payload: {
          ok: false,
          blocked: true,
          reason: 'PENALTY_LOCKED',
          isAppropriate: false,
          remainingSeconds: result.remainingSeconds,
        },
      }
    case 'rejected':
      return {
        status: 400,
        payload: {
          ok: false,
          isAppropriate: false,
          reason: result.reason,
          strikes: result.strikes,
          strikesRemaining: result.strikesRemaining,
        },
      }
    default:
      return { status: 200, payload: { ok: true } }
  }
}

/**
 * Vercel serverless function serving `/api/wishes`.
 *
 * GET  — fetch all wishes from TiDB Cloud Serverless.
 * POST — validate the payload, run Groq AI moderation, insert into TiDB
 *        Cloud, and return the outcome. Rate-limit / strike bookkeeping is
 *        enforced server-side.
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    res.end()
    return
  }

  try {
    if (req.method === 'GET') {
      const wishes = await getApi().getWishes()
      send(res, 200, wishes)
      return
    }

    if (req.method !== 'POST') {
      send(res, 405, { ok: false, error: 'Method not allowed' })
      return
    }

    const body = await readBody(req)
    if (!body) {
      send(res, 400, { ok: false, error: 'Invalid JSON body' })
      return
    }

    const senderName = String(body.sender_name ?? '').trim()
    const message = String(body.message ?? '').trim()
    if (!senderName || !message) {
      send(res, 400, { ok: false, error: 'sender_name and message are required' })
      return
    }

    const { status, payload } = mapCreateResult(
      await getApi().createWish({ ip: resolveIp(req), senderName, message }),
    )
    send(res, status, payload)
  } catch (error) {
    send(res, 500, { ok: false, error: String(error?.message ?? error) })
  }
}