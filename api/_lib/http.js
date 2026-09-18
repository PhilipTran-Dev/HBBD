/**
 * Tiny request/response helpers shared by the wishes function and the Vite
 * middleware. Local-only module: no external imports, so it can never bring a
 * function's module graph down.
 */

export function send(res, status, payload) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(payload === undefined ? '' : JSON.stringify(payload))
}

export function isPreflight(req) {
  return req.method === 'OPTIONS'
}

export async function readBody(req) {
  let raw = ''
  for await (const chunk of req) raw += chunk
  try {
    return raw ? JSON.parse(raw) : {}
  } catch {
    return null
  }
}