/**
 * Shared wishes API core — safe to import from BOTH the Vite middleware
 * (vite.config.js) and the Vercel serverless functions (api/wishes.js).
 *
 * Boot-safety contract (the reason this module is structured the way it is):
 *
 * 1. NO external client is created at module top level. `connect()` and the
 *    Groq client are loaded lazily inside guarded getters (`getConnect`,
 *    `getGroqModule`), and only when a request actually needs them. If
 *    environment variables are missing or the vendor modules fail to resolve,
 *    the function container still boots a valid handler instead of crashing on
 *    import.
 * 2. Database configuration failures throw a typed `ConfigError` carrying a
 *    stable `statusCode`, so handlers can answer 503 "I'm up, backend isn't
 *    configured" instead of a misleading 500.
 * 3. Groq AI configuration is DECOUPLED from bootstrapping entirely:
 *    `resolveGroqConfig` never throws and never requires an API key, so
 *    read-only operations (`getWishes`, `getStatus`) can never fail because
 *    the AI key is unconfigured. Moderation is a best-effort layer: if the key
 *    is missing, or Groq errors (rate limit, quota, invalid credentials,
 *    network timeout), the wish simply bypasses moderation and saves directly.
 * 4. `check-status.js` deliberately does NOT import this module: a health
 *    check must stay zero-dependency so it can never be brought down by a
 *    database/driver failure.
 *
 * Database credentials are resolved the same way on Vercel and locally:
 *   - `DATABASE_URL` if set (a full `mysql://` connection string), otherwise
 *   - composed from `TIDB_HOST`, `TIDB_USER`, `TIDB_PASSWORD`, and
 *     `TIDB_DATABASE` (defaulting to `test` — the schema-creation fallback
 *     that avoids MySQL Error 1142 "CREATE command denied on sys").
 */

export class ConfigError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ConfigError'
    this.statusCode = 503
  }
}

const COOLDOWN_SECONDS = 30 * 60
const LOCKOUT_SECONDS = 30 * 60
const MAX_STRIKES = 3
// The schema must never be created against the TiDB `sys` metadata database
// (CREATE is denied there -> Error 1142), so any missing TIDB_DATABASE value
// always falls back to `test`.
const DEFAULT_DATABASE = 'test'

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

const SELECT_WISH_BY_ID_SQL = `
  SELECT id, sender_name, message, created_at
    FROM birthday_wishes
   WHERE id = ?
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

function requireEnv(value, name) {
  if (!value) {
    throw new ConfigError(
      `Missing required environment variable "${name}". Copy .env.example to .env and fill it in, then add it to the Vercel project settings.`,
    )
  }
  return value
}

/**
 * Resolve the TiDB connection string.
 * Precedence: DATABASE_URL (full mysql:// URL) > TIDB_HOST/TIDB_USER/
 * TIDB_PASSWORD (+ TIDB_DATABASE, default `test`).
 */
export function resolveDbConfig(env) {
  const url = env.DATABASE_URL ?? env.TIDB_URL
  if (url) return { url }

  const host = requireEnv(env.TIDB_HOST, 'TIDB_HOST')
  const username = requireEnv(env.TIDB_USER, 'TIDB_USER')
  const password = requireEnv(env.TIDB_PASSWORD, 'TIDB_PASSWORD')
  const database = env.TIDB_DATABASE ?? DEFAULT_DATABASE

  return {
    url: `mysql://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}/${database}?sslaccept=strict`,
  }
}

/**
 * Resolve the Groq configuration WITHOUT touching the boot path.
 *
 * Groq is deliberately optional: the API key defaults to an empty string and
 * is never validated here, so `getWishes` / `getStatus` keep working even when
 * the AI key is missing, unset, or still being initialized. Moderation becomes
 * a best-effort layer (see `moderateWish`) that degrades to "allow" rather
 * than failing read operations or the wish-write path.
 */
export function resolveGroqConfig(env) {
  return {
    apiKey: env.GROQ_API_KEY || '',
    model: env.GROQ_MODEL ?? 'llama-3.3-70b-versatile',
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

// ---------------------------------------------------------------------------
// Lazy, guarded external-client getters. Nothing below instantiates a vendor
// client until a request needs it, so a missing package or env var can never
// crash the function at module-load time.
// ---------------------------------------------------------------------------

let connectPromise = null

function getConnect() {
  if (!connectPromise) {
    connectPromise = import('@tidbcloud/serverless').then((mod) => mod.connect)
    // A resolution failure must not stick forever: allow a later request to
    // retry instead of caching the rejection.
    connectPromise.catch(() => {
      connectPromise = null
    })
  }
  return connectPromise
}

let groqModulePromise = null

function getGroqModule() {
  if (!groqModulePromise) {
    groqModulePromise = import('groq-sdk')
    groqModulePromise.catch(() => {
      groqModulePromise = null
    })
  }
  return groqModulePromise
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
  const rows = await db.execute(GET_RATE_LIMITS_SQL, [ip])
  return rows?.[0] ?? null
}

/**
 * Raw Groq moderation call. THROWS on any runtime failure (rate limit, quota
 * exceeded, invalid credentials, network timeout) or an unreadable verdict.
 * `moderateWish` is the only caller and owns the error handling.
 */
async function moderateContent({ senderName, message }, groqConfig) {
  const { default: Groq } = await getGroqModule()
  const client = new Groq({ apiKey: groqConfig.apiKey })

  const response = await client.chat.completions.create({
    model: groqConfig.model,
    temperature: 0,
    max_completion_tokens: 400,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: MODERATION_SYSTEM_PROMPT },
      { role: 'user', content: JSON.stringify({ senderName, message }) },
    ],
  })

  const verdict = extractJson(response?.choices?.[0]?.message?.content)

  if (!verdict || typeof verdict.isAppropriate !== 'boolean') {
    throw new Error('Groq returned an unreadable moderation verdict')
  }

  return {
    isAppropriate: verdict.isAppropriate,
    reason: typeof verdict.reason === 'string' ? verdict.reason : '',
  }
}

/**
 * Resilient moderation wrapper — the ONLY entry point used by `createWish`.
 *
 * Guarantees a well-formed `{ isAppropriate, reason, bypassed }` result on
 * EVERY exit so the wish-write path can never crash on AI trouble:
 *   - No API key configured  -> bypass: allow the wish without moderation.
 *   - Groq runtime error     -> log `console.warn('Groq AI bypass ...')` then
 *                               allow the wish to proceed to the database.
 *   - Clean verdict          -> surfaced unchanged; the caller keeps the
 *                               existing strike / penalty logic for content
 *                               the model marks inappropriate.
 */
async function moderateWish({ senderName, message }, groqConfig) {
  if (!groqConfig.apiKey) {
    console.warn('Groq AI bypass due to missing GROQ_API_KEY:', 'moderation skipped for a new wish')
    return { isAppropriate: true, reason: '', bypassed: true }
  }

  try {
    const verdict = await moderateContent({ senderName, message }, groqConfig)
    return { isAppropriate: verdict.isAppropriate, reason: verdict.reason, bypassed: false }
  } catch (error) {
    console.warn('Groq AI bypass due to error:', error.message)
    return { isAppropriate: true, reason: '', bypassed: true }
  }
}

/**
 * A single, framework-agnostic wishes API used by the Vite dev/preview
 * middleware (vite.config.js) AND the Vercel serverless functions
 * (api/wishes.js).
 *
 * Reads its configuration from the passed `env` object, defaulting to
 * `process.env` (the Vercel runtime's environment variables). No external
 * client is created until the first request.
 */
export function createWishesApi({ env = process.env } = {}) {
  const dbConfig = resolveDbConfig(env)
  const groqConfig = resolveGroqConfig(env)

  let dbPromise = null
  let schemaReady = null

  const getDb = () => {
    if (!dbPromise) {
      dbPromise = getConnect()
        .then((connect) => connect(dbConfig))
        .catch((error) => {
          dbPromise = null
          throw error
        })
    }
    return dbPromise
  }

  const ensureSchema = () => {
    if (!schemaReady) {
      schemaReady = (async () => {
        const db = await getDb()
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
    const rows = await (await getDb()).execute(SELECT_WISHES_SQL)
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
    return buildBlockStatus(await readLimits(await getDb(), ip))
  }

  const createWish = async ({ ip, senderName, message }) => {
    await ensureSchema()
    const db = await getDb()
    const status = buildBlockStatus(await readLimits(db, ip))

    if (status.blocked) {
      return {
        kind: 'blocked',
        reason: status.reason,
        remainingSeconds: status.remainingSeconds,
        strikes: status.strikes,
      }
    }

    // Best-effort moderation. On a clean rejection the strike/penalty hooks
    // below run exactly as before; on absence or failure of the AI layer the
    // wish is allowed through so the feature never goes down with Groq.
    const verdict = await moderateWish({ senderName, message }, groqConfig)

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

    const inserted = await db.execute(INSERT_WISH_SQL, [senderName, message, ip], {
      fullResult: true,
    })
    const wishId = inserted?.lastInsertId ?? inserted?.rows?.[0]?.id
    await db.execute(UPSERT_SUCCESS_SQL, [ip])

    // Return the freshly inserted record to the caller.
    const record =
      wishId == null
        ? { sender_name: senderName, message }
        : (await db.execute(SELECT_WISH_BY_ID_SQL, [wishId]))?.[0] ?? null

    return {
      kind: 'ok',
      wish: record
        ? {
            id: record.id,
            sender_name: record.sender_name ?? '',
            message: record.message ?? '',
            created_at: record.created_at ?? null,
          }
        : { sender_name: senderName, message },
    }
  }

  return { getWishes, getStatus, createWish }
}