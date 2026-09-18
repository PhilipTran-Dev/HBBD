import { ConfigError, createWishesApi, resolveIp } from '../_lib/wishes-core.js'
import { send, isPreflight } from '../_lib/http.js'

let api = null

const getApi = () => {
  if (!api) api = createWishesApi()
  return api
}

/**
 * Vercel serverless function serving `/api/wishes/status`.
 *
 * Returns the caller's server-side rate-limit / lock / strike state.
 *
 * This is intentional separation of concerns:
 *   - `/api/check-status`  — zero-dependency RUNTIME HEALTH probe (env flags),
 *     used to diagnose a broken deployment. It never touches the database, so
 *     it can never 500 because TiDB is down or misconfigured.
 *   - `/api/wishes/status` — the DATABASE-DEPENDENT lock state the birthday
 *     board actually polls (blocked / strikes / remainingSeconds). It renders
 *     as 503 (not 500) when config is missing, and 500 only on genuine errors.
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true)
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version',
  )

  if (isPreflight(req)) {
    res.statusCode = 204
    res.end()
    return
  }

  if (req.method !== 'GET') {
    send(res, 405, { ok: false, error: 'Method not allowed' })
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
    if (error instanceof ConfigError) {
      send(res, error.statusCode ?? 503, { ok: false, error: error.message })
      return
    }
    console.error('[api/wishes/status]', error)
    send(res, 500, { ok: false, error: String(error?.message ?? error) })
  }
}