/**
 * Zero-dependency health / status endpoint.
 *
 * Deliberately imports NOTHING: no database driver, no shared API core, no
 * network calls. A health check must report function-runtime liveness and
 * environment presence flags even when every backend dependency is broken or
 * misconfigured — the very failure mode that previously turned this endpoint
 * into a 500 because it imported `_lib/wishes-core.js` (which statically
 * imported the TiDB driver at module top level).
 *
 * Returns 200 on both GET and OPTIONS (CORS preflight), so curl, browsers,
 * and uptime monitors all see a live function regardless of DB state.
 */
export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true)
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader(
    'Access-Control-Allow-Methods',
    'GET,OPTIONS',
  )
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version',
  )

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  if (req.method !== 'GET') {
    return res
      .status(405)
      .json({ status: 'error', error: 'Method not allowed' })
  }

  return res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    env: {
      hasTiDBHost: !!process.env.TIDB_HOST,
      hasTiDBUser: !!process.env.TIDB_USER,
      hasTiDBPass: !!process.env.TIDB_PASSWORD,
      hasTiDBDatabase: !!process.env.TIDB_DATABASE,
      hasDATABASE_URL: !!process.env.DATABASE_URL,
      hasGroqKey: !!process.env.GROQ_API_KEY,
    },
  })
}