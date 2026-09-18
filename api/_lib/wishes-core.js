import { connect } from '@tidbcloud/serverless'

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

export function requireEnv(value, name) {
  if (!value) {
    throw new Error(
      `Missing required environment variable "${name}". Copy .env.example to .env and fill it in.`,
    )
  }
  return value
}

export function resolveDbConfig(env) {
  return {
    host: requireEnv(env.TIDB_HOST, 'TIDB_HOST'),
    username: requireEnv(env.TIDB_USER, 'TIDB_USER'),
    password: requireEnv(env.TIDB_PASSWORD, 'TIDB_PASSWORD'),
    database: requireEnv(env.TIDB_DATABASE, 'TIDB_DATABASE'),
  }
}

export function resolveGroqConfig(env) {
  return {
    apiKey: requireEnv(env.GROQ_API_KEY, 'GROQ_API_KEY'),
    model: env.GROQ_MODEL ?? 'openai/gpt-oss-20b',
  }
}

export function resolveIp(req) {
  const forwarded = req.headers['x-forwarded-for']
  if (forwarded) {
    const first = String(forwarded).split(',')[0].trim()
    if (first) return first
  }
  return req.socket?.remoteAddress || '127.0.0.1'
}

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

async function readLimits(db, ip) {
  return db.execute(GET_RATE_LIMITS_SQL, [ip]).then((rows) => rows?.[0] ?? null)
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

/**
 * A single, framework-agnostic wishes API used by the Vite dev/preview
 * middleware (vite.config.js) AND the Vercel serverless functions
 * (api/check-status.js, api/wishes.js).
 *
 * Reads its configuration from the passed `env` object, defaulting to
 * `process.env` (the Vercel runtime's environment variables).
 */
export function createWishesApi({ env = process.env } = {}) {
  const db = connect(resolveDbConfig(env))
  const groqConfig = resolveGroqConfig(env)
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

  const getWishes = async () => {
    await ensureSchema()
    const rows = await db.execute(SELECT_WISHES_SQL)
    // Intentionally never expose ip_address to the client.
    return (rows ?? []).map((row) => ({
      id: row.id,
      sender_name: row.sender_name ?? '',
      message: row.message ?? '',
      created_at: row.created_at ?? null,
    }))
  }

  const getStatus = async (ip) => {
    await ensureSchema()
    return buildBlockStatus(await readLimits(db, ip))
  }

  const createWish = async ({ ip, senderName, message }) => {
    await ensureSchema()
    const status = buildBlockStatus(await readLimits(db, ip))

    if (status.blocked) {
      return {
        kind: 'blocked',
        reason: status.reason,
        remainingSeconds: status.remainingSeconds,
        strikes: status.strikes,
      }
    }

    const verdict = await moderateContent({ senderName, message }, groqConfig)

    if (!verdict.isAppropriate) {
      const newStrikes = status.strikes + 1

      if (newStrikes >= MAX_STRIKES) {
        await db.execute(UPSERT_BLOCK_SQL, [ip])
        return {
          kind: 'penalty_locked',
          reason: verdict.reason,
          remainingSeconds: LOCKOUT_SECONDS,
          strikes: newStrikes,
        }
      }

      if (status.strikes > 0) {
        await db.execute(UPDATE_STRIKE_SQL, [newStrikes, ip])
      } else {
        await db.execute(INSERT_STRIKE_SQL, [ip, newStrikes])
      }

      return {
        kind: 'rejected',
        reason: verdict.reason,
        strikes: newStrikes,
        strikesRemaining: MAX_STRIKES - newStrikes,
      }
    }

    await db.execute(INSERT_WISH_SQL, [senderName, message, ip])
    await db.execute(UPSERT_SUCCESS_SQL, [ip])
    return { kind: 'ok' }
  }

  return { getWishes, getStatus, createWish }
}