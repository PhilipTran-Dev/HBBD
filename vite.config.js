import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, loadEnv } from 'vite'
import {
  ConfigError,
  createWishesApi,
  resolveIp,
} from './api/_lib/wishes-core.js'
import { send, isPreflight, readBody } from './api/_lib/http.js'

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
 * Serves the TiDB-backed wishes API entirely on the Node.js side of the Vite
 * dev/preview server. The browser only talks to the same-origin /api/*
 * endpoints, so database credentials and the Groq API key never reach the
 * client bundle. The same core logic (`./api/_lib/wishes-core.js`) is shared
 * with the Vercel serverless functions (`api/check-status.js`, `api/wishes.js`)
 * so production behaviour on Vercel matches local development.
 */
function tidbWishesApi({ env }) {
  let api = null

  const middleware = async (req, res, next) => {
    const path = req.url?.split('?')[0]
    if (path !== '/api/wishes' && path !== '/api/check-status' && path !== '/api/wishes/status') {
      next()
      return
    }

    try {
      api ??= createWishesApi({ env })

      // Dev parity with the PRODUCTION health probe: env flags only, no DB
      // access, so this route never 500s because the backend is misconfigured.
      if (path === '/api/check-status') {
        if (isPreflight(req)) {
          res.statusCode = 204
          res.end()
          return
        }
        if (req.method !== 'GET') {
          send(res, 405, { ok: false, error: 'Method not allowed' })
          return
        }
        send(res, 200, {
          status: 'healthy',
          timestamp: new Date().toISOString(),
          env: {
            hasTiDBHost: !!env.TIDB_HOST,
            hasTiDBUser: !!env.TIDB_USER,
            hasTiDBPass: !!env.TIDB_PASSWORD,
            hasTiDBDatabase: !!env.TIDB_DATABASE,
            hasDATABASE_URL: !!env.DATABASE_URL,
            hasGroqKey: !!env.GROQ_API_KEY,
          },
        })
        return
      }

      // Dev parity with api/wishes/status.js — database-backed lock state.
      if (path === '/api/wishes/status') {
        if (isPreflight(req)) {
          res.statusCode = 204
          res.end()
          return
        }
        if (req.method !== 'GET') {
          send(res, 405, { ok: false, error: 'Method not allowed' })
          return
        }
        const status = await api.getStatus(resolveIp(req))
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
        return
      }

      // /api/wishes
      if (isPreflight(req)) {
        res.statusCode = 204
        res.end()
        return
      }
      if (req.method === 'GET') {
        send(res, 200, await api.getWishes())
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
        await api.createWish({ ip: resolveIp(req), senderName, message }),
      )
      send(res, status, payload)
    } catch (error) {
      if (error instanceof ConfigError) {
        send(res, error.statusCode ?? 503, { ok: false, error: error.message })
        return
      }
      console.error('[tidb-wishes-api]', error)
      send(res, 500, { ok: false, error: String(error?.message ?? error) })
    }
  }

  return {
    name: 'tidb-wishes-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(middleware)
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware)
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [react(), tailwindcss(), tidbWishesApi({ env })],
  }
})