// Protection for a public server: optional passcode, and rate limits.
import { createHmac, timingSafeEqual } from 'node:crypto'
import express from 'express'

const PASSWORD = process.env.APP_PASSWORD || ''
const COOKIE = 'notepad_pass'
// Derived from the passcode, so changing the passcode signs everyone out.
const TOKEN = createHmac('sha256', PASSWORD || 'unused').update('notepad-session').digest('hex')

function same(a, b) {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

export function isAllowed(req) {
  if (!PASSWORD) return true
  const found = (req.headers.cookie || '').split(';').map((c) => c.trim()).find((c) => c.startsWith(`${COOKIE}=`))
  return Boolean(found) && same(found.slice(COOKIE.length + 1), TOKEN)
}

// At most `max` requests per visitor in each time window.
export function rateLimit(max, windowMs) {
  const hits = new Map()
  setInterval(() => hits.clear(), windowMs).unref()
  return (req, res, next) => {
    const count = (hits.get(req.ip) || 0) + 1
    hits.set(req.ip, count)
    if (count > max) return res.status(429).json({ error: 'Too many requests. Try again in a few minutes.' })
    next()
  }
}

const loginPage = (message = '') => `<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Collab Notepad</title>
<style>body{font:16px system-ui;display:grid;place-items:center;min-height:90vh;margin:0;color-scheme:light dark}
form{width:min(90vw,320px)}input,button{font:inherit;width:100%;box-sizing:border-box;padding:10px;margin-top:10px}</style>
<form method="post" action="/login"><label for="p">Enter the passcode to open this note</label>
<input id="p" name="password" type="password" required autofocus><input type="hidden" name="next" id="next">
<button>Open</button><p role="alert">${message}</p></form>
<script>document.getElementById('next').value = location.hash</script></html>`

// Must be registered before every route it protects.
export function passwordGate(app) {
  if (!PASSWORD) return
  app.post('/login', rateLimit(10, 10 * 60_000), express.urlencoded({ extended: false, limit: '2kb' }), (req, res) => {
    // Keep the note id so the invite link still lands on the right note.
    const next = /^#[a-zA-Z0-9_-]{8,64}$/.test(req.body?.next) ? req.body.next : ''
    if (!same(String(req.body?.password), PASSWORD)) {
      return res.status(401).send(loginPage('Wrong passcode').replace('location.hash', JSON.stringify(next)))
    }
    res.cookie(COOKIE, TOKEN, { httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge: 30 * 864e5 })
    res.redirect(303, `/${next}`)
  })
  app.use((req, res, next) => (isAllowed(req) ? next() : res.status(401).send(loginPage())))
}
