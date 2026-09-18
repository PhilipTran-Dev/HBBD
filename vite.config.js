import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { connect } from '@tidbcloud/serverless'
import process from 'node:process'
import { defineConfig, loadEnv } from 'vite'

const COOLDOWN_SECONDS = 30 * 60
const LOCKOUT_SECONDS = 30 * 60
const MAX_STRIKES = 3

const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions'

const MODERATION_SYSTEM_PROMPT = `You are an uncompromising content safety auditor for a family birthday website.
Your mission: Detect offensive language, vulgarity, profanity, toxicity, insults, sexual harassment, or trolling in both Vietnamese and English.

Be extremely vigilant against circumvention techniques:
1. Spaced words: "d i t", "f u c k", "c a c", "l o n".
2. Symbol/number leetspeak: "d!t", "d1t", "f*ck", "fvck", "l0z", "b**i".
3. Phonetic spelling & teencode: "đm", "dcm", "clmm", "vcl", "vkl", "đmm", "cc", "loz", "cac", "buoi", "ditconbamay", "dit me", "đụ", "l**n".
4. Implicit insults or sexually suggestive pranks disguised as jokes.

Analyze both the sender name and the wish message.
Respond ONLY with raw, valid JSON:
{
  "isAppropriate": boolean,
  "reason": "Brief English explanation of the flagged issue"
}`

const CREATE_WISHES_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS birthday_wishes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    sender_name VARCHAR(100) NOT NULL,
    message TEXT NOT NULL,
    ip_address VARCHAR(45) NOT NULL DEFAULT '',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )
`

const ALTER_WISHES_IP_SQL = `
  ALTER TABLE birthday_wishes ADD COLUMN IF NOT EXISTS ip_address VARCHAR(45) NOT NULL DEFAULT ''
`

const CREATE_RATE_LIMITS_SQL = `
  CREATE TABLE IF NOT EXISTS ip_rate_limits (
    ip_address VARCHAR(45) PRIMARY KEY,
    strike_count INT DEFAULT 0,
    blocked_until TIMESTAMP NULL,
    last_success_at TIMESTAMP NULL
  )
`

const SELECT_WISHES_SQL = `
  SELECT id, sender_name, message, created_at
    FROM birthday_wishes
   ORDER BY created_at DESC
`

const INSERT_WISH_SQL = `
  INSERT INTO birthday_wishes (sender_name, message, ip_address) VALUES (?, ?, ?)
`

const GET_RATE_LIMITS_SQL = `
  SELECT strike_count,
         TIMESTAMPDIFF(SECOND, NOW(), blocked_until) AS block_remaining,
         TIMESTAMPDIFF(SECOND, last_success_at, NOW()) AS success_elapsed
    FROM ip_rate_limits
   WHERE ip_address = ?
`

const UPSERT_SUCCESS_SQL = `
  INSERT INTO ip_rate_limits (ip_address, strike_count, blocked_until, last_success_at)
  VALUES (?, 0, NULL, NOW())
  ON DUPLICATE KEY UPDATE strike_count = 0, blocked_until = NULL, last_success_at = NOW()
`

const UPSERT_BLOCK_SQL = `
  INSERT INTO ip_rate_limits (ip_address, strike_count, blocked_until, last_success_at)
  VALUES (?, 0, NOW() + INTERVAL ${LOCKOUT_SECONDS} SECOND, NULL)
  ON DUPLICATE KEY UPDATE strike_count = 0, blocked_until = NOW() + INTERVAL ${LOCKOUT_SECONDS} SECOND
`

const UPDATE_STRIKE_SQL = `UPDATE ip_rate_limits SET strike_count = ? WHERE ip_address = ?`
const INSERT_STRIKE_SQL = `INSERT INTO ip_rate_limits (ip_address, strike_count) VALUES (?, ?)`

function extractJson(text) {
  if (!text) return null

  const cleaned = text
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim()

  try {
    return JSON.parse(cleaned)
  } catch {
    const start = cleaned.indexOf('{')
    const end = cleaned.lastIndexOf('}')
    if (start === -1 || end === -1 || end <= start) return null
    try {
      return JSON.parse(cleaned.slice(start, end + 1))
    } catch {
      return null
    }
  }
}

function resolveIp(req) {
  const forwarded = req.headers['x-forwarded-for']
  if (forwarded) {
    const first = String(forwarded).split(',')[0].trim()
    if (first) return first
  }
  return req.socket?.remoteAddress || '127.0.0.1'
}

function readLimits(db, ip) {
  return db.execute(GET_RATE_LIMITS_SQL, [ip]).then((rows) => rows?.[0] ?? null)
}

function buildBlockStatus(row) {
  const strikes = Number(row?.strike_count ?? 0)
  if (!row) return { blocked: false, strikes }

  const blockRemaining = row.block_remaining == null ? 0 : Number(row.block_remaining)
  if (blockRemaining > 0) {
    return { blocked: true, reason: 'PENALTY_LOCKED', remainingSeconds: blockRemaining, strikes }
  }

  if (row.success_elapsed != null && Number(row.success_elapsed) < COOLDOWN_SECONDS) {
    return {
      blocked: true,
      reason: 'SUCCESS_COOLDOWN',
      remainingSeconds: COOLDOWN_SECONDS - Number(row.success_elapsed),
      strikes,
    }
  }

  return { blocked: false, strikes }
}

async function moderateContent({ senderName, message }, groqConfig) {
  const response = await fetch(GROQ_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${groqConfig.apiKey}`,
    },
    body: JSON.stringify({
      model: groqConfig.model,
      temperature: 0,
      max_completion_tokens: 400,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: MODERATION_SYSTEM_PROMPT },
        { role: 'user', content: JSON.stringify({ senderName, message }) },
      ],
    }),
  })

  if (!response.ok) {
    throw new Error(`Groq moderation failed (${response.status})`)
  }

  const data = await response.json()
  const verdict = extractJson(data?.choices?.[0]?.message?.content)

  if (!verdict || typeof verdict.isAppropriate !== 'boolean') {
    throw new Error('Groq returned an unreadable verdict')
  }

  return {
    isAppropriate: verdict.isAppropriate,
    reason: typeof verdict.reason === 'string' ? verdict.reason : '',
  }
}

function requireEnv(value, name) {
  if (!value) {
    throw new Error(
      `Missing required environment variable "${name}". Copy .env.example to .env and fill it in.`,
    )
  }
  return value
}

function resolveDbConfig(env) {
  return {
    host: requireEnv(env.TIDB_HOST, 'TIDB_HOST'),
    username: requireEnv(env.TIDB_USER, 'TIDB_USER'),
    password: requireEnv(env.TIDB_PASSWORD, 'TIDB_PASSWORD'),
    database: requireEnv(env.TIDB_DATABASE, 'TIDB_DATABASE'),
  }
}

function resolveGroqConfig(env) {
  return {
    apiKey: requireEnv(env.GROQ_API_KEY, 'GROQ_API_KEY'),
    model: env.GROQ_MODEL ?? 'openai/gpt-oss-20b',
  }
}

/**
 * Serves the TiDB-backed wishes API entirely on the Node.js side of the Vite
 * server. The browser only talks to the same-origin /api/* endpoints, so the
 * `@tidbcloud/serverless` driver, the database credentials, and the Groq API
 * key never reach the client bundle and no CORS restrictions are triggered.
 *
 * All rate limiting, strike bookkeeping, and AI moderation run here, server
 * side, so they cannot be bypassed by editing the client bundle or opening the
 * app in incognito windows.
 */
function tidbWishesApi({ env }) {
  let db = null
  let groqConfig = null
  let schemaReady = null

  const ensureSchema = () => {
    if (!schemaReady) {
      schemaReady = (async () => {
        await db.execute(CREATE_WISHES_TABLE_SQL)
        await db.execute(ALTER_WISHES_IP_SQL)
        await db.execute(CREATE_RATE_LIMITS_SQL)
      })().catch((error) => {
        schemaReady = null
        throw error
      })
    }
    return schemaReady
  }

  const send = (res, status, payload) => {
    res.statusCode = status
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(payload === undefined ? '' : JSON.stringify(payload))
  }

  const readBody = async (req) => {
    let raw = ''
    for await (const chunk of req) raw += chunk
    try {
      return raw ? JSON.parse(raw) : {}
    } catch {
      return null
    }
  }

  const handleCheckStatus = async (req, res) => {
    const ip = resolveIp(req)
    const status = buildBlockStatus(await readLimits(db, ip))
    if (status.blocked) {
      send(res, 200, {
        blocked: true,
        reason: status.reason,
        remainingSeconds: status.remainingSeconds,
        strikes: status.strikes,
      })
      return
    }
    send(res, 200, { blocked: false, strikes: status.strikes })
  }

  const handleWishes = async (req, res) => {
    if (req.method === 'GET') {
      const rows = await db.execute(SELECT_WISHES_SQL)
      // Intentionally never expose ip_address to the client.
      const wishes = (rows ?? []).map((row) => ({
        id: row.id,
        sender_name: row.sender_name ?? '',
        message: row.message ?? '',
        created_at: row.created_at ?? null,
      }))
      send(res, 200, wishes)
      return
    }

    if (req.method !== 'POST') {
      send(res, 405, { ok: false, error: 'Method not allowed' })
      return
    }

    const ip = resolveIp(req)

    const status = buildBlockStatus(await readLimits(db, ip))
    if (status.blocked) {
      send(res, 429, {
        ok: false,
        blocked: true,
        reason: status.reason,
        remainingSeconds: status.remainingSeconds,
      })
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

    const verdict = await moderateContent({ senderName, message }, groqConfig)

    if (!verdict.isAppropriate) {
      const newStrikes = status.strikes + 1

      if (newStrikes >= MAX_STRIKES) {
        await db.execute(UPSERT_BLOCK_SQL, [ip])
        send(res, 429, {
          ok: false,
          blocked: true,
          reason: 'PENALTY_LOCKED',
          isAppropriate: false,
          remainingSeconds: LOCKOUT_SECONDS,
        })
        return
      }

      if (status.strikes > 0) {
        await db.execute(UPDATE_STRIKE_SQL, [newStrikes, ip])
      } else {
        await db.execute(INSERT_STRIKE_SQL, [ip, newStrikes])
      }

      send(res, 400, {
        ok: false,
        isAppropriate: false,
        reason: verdict.reason,
        strikes: newStrikes,
        strikesRemaining: MAX_STRIKES - newStrikes,
      })
      return
    }

    await db.execute(INSERT_WISH_SQL, [senderName, message, ip])
    await db.execute(UPSERT_SUCCESS_SQL, [ip])
    send(res, 200, { ok: true })
  }

  const middleware = async (req, res, next) => {
    const path = req.url?.split('?')[0]
    if (path !== '/api/wishes' && path !== '/api/check-status') {
      next()
      return
    }

    try {
      await ensureSchema()
      if (path === '/api/check-status') await handleCheckStatus(req, res)
      else await handleWishes(req, res)
    } catch (error) {
      send(res, 500, { ok: false, error: String(error?.message ?? error) })
    }
  }

  return {
    name: 'tidb-wishes-api',
    apply: 'serve',
    configureServer(server) {
      db = connect(resolveDbConfig(env))
      groqConfig = resolveGroqConfig(env)
      ensureSchema().catch((error) =>
        server.config.logger.error(`[tidb-wishes-api] schema init failed: ${error.message}`),
      )
      server.middlewares.use(middleware)
    },
    configurePreviewServer(server) {
      db = connect(resolveDbConfig(env))
      groqConfig = resolveGroqConfig(env)
      ensureSchema().catch((error) =>
        server.config.logger.error(`[tidb-wishes-api] schema init failed: ${error.message}`),
      )
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