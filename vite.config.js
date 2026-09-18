import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, loadEnv } from 'vite'
import { createWishesApi, resolveIp } from './api/_lib/wishes-core.js'

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
    if (path !== '/api/wishes' && path !== '/api/check-status') {
      next()
      return
    }

    try {
      api ??= createWishesApi({ env })

      if (path === '/api/check-status') {
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