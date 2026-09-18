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

/**
 * Vercel serverless function serving `/api/check-status`.
 *
 * Returns the current rate-limit / lock state for the caller's IP plus a
 * lightweight health signature so uptime monitors and the client can confirm
 * the API is alive.
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    res.end()
    return
  }

  if (req.method !== 'GET') {
    send(res, 405, { status: 'error', error: 'Method not allowed' })
    return
  }

  try {
    const status = await getApi().getStatus(resolveIp(req))
    const payload = {
      status: 'ok',
      timestamp: Date.now(),
      blocked: status.blocked,
      strikes: status.strikes,
    }
    if (status.blocked) {
      payload.reason = status.reason
      payload.remainingSeconds = status.remainingSeconds
    }
    send(res, 200, payload)
  } catch (error) {
    send(res, 500, { status: 'error', error: String(error?.message ?? error) })
  }
}