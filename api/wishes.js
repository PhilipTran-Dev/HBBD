import { ConfigError, createWishesApi, resolveIp } from './_lib/wishes-core.js'
import { send, isPreflight, readBody } from './_lib/http.js'

let api = null

/**
 * Returns a shared, lazily-created API handle. `createWishesApi` itself only
 * resolves configuration and never instantiates an external client, so this
 * can run safely inside the handler (and therefore inside its try/catch).
 */
function getApi() {
  if (!api) api = createWishesApi()
  return api
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
      return { status: 200, payload: { ok: true, data: result.wish ?? null } }
  }
}

/**
 * Vercel serverless function serving `/api/wishes`.
 *
 * GET  — fetch all wishes from TiDB Cloud Serverless.
 * POST — validate the payload, run Groq AI moderation (a JSON-generation task:
 *        the model must return `{ isAppropriate, reason }` for the submitted
 *        wish), insert the approved wish into TiDB Cloud, and return the
 *        inserted record. Rate-limit / strike bookkeeping is enforced
 *        server-side.
 *
 * Every failure path is caught and answered with structured JSON — a thrown
 * error here can never bubble up as a bare 500 or crash the process.
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true)
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version',
  )

  if (isPreflight(req)) {
    res.statusCode = 204
    res.end()
    return
  }

  try {
    if (req.method === 'GET') {
      send(res, 200, await getApi().getWishes())
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
    if (error instanceof ConfigError) {
      // Backend is alive but misconfigured: report it as such (503) so
      // failures read as "missing env config" rather than "app crashed".
      send(res, error.statusCode ?? 503, { ok: false, error: error.message })
      return
    }
    console.error('[api/wishes]', error)
    send(res, 500, { ok: false, error: String(error?.message ?? error) })
  }
}