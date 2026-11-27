import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import { extname, join } from 'node:path'
import { networkInterfaces } from 'node:os'
import express from 'express'
import multer from 'multer'
import QRCode from 'qrcode'
import { WebSocketServer } from 'ws'
import { Hocuspocus } from '@hocuspocus/server'
import { openStorage } from './storage.js'
import { isAllowed, passwordGate, rateLimit } from './protect.js'

const PORT = Number(process.env.PORT) || 3000
const root = import.meta.dirname
const data = process.env.DATA_DIR || join(root, 'data')
const MAX_FILE_MB = Number(process.env.MAX_FILE_MB) || 5
const MAX_STORAGE = (Number(process.env.MAX_STORAGE_MB) || 500) * 1024 * 1024
const storage = await openStorage(data)

// Real-time sync: merges edits (CRDT), relays them, and saves each note to the database.
const sync = new Hocuspocus({
  debounce: 1000,
  maxDebounce: 5000,
  extensions: [storage.notes],
})

const app = express()
app.set('trust proxy', 1) // hosts terminate HTTPS in front of the app
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff')
  res.set('Referrer-Policy', 'no-referrer') // note links are secrets
  next()
})

app.get('/health', (req, res) => res.send('ok'))
passwordGate(app)

// Only these types may open inside the page; everything else downloads.
const INLINE = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp'])

const upload = multer({
  limits: { fileSize: MAX_FILE_MB * 1024 * 1024, files: 1 },
  storage: multer.memoryStorage(),
})

app.post('/api/upload', rateLimit(30, 10 * 60_000), upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file received' })
  const ext = extname(req.file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 10)
  const name = randomBytes(16).toString('hex') + ext
  if (!(await storage.saveUpload(name, req.file.buffer, MAX_STORAGE))) {
    return res.status(507).json({ error: 'The server upload storage is full' })
  }
  res.json({ url: `/uploads/${name}`, isImage: INLINE.has(ext) })
})

app.get('/uploads/:name', async (req, res, next) => {
  const bytes = await storage.readUpload(req.params.name)
  if (!bytes) return next() // older uploads are still files on disk
  const ext = extname(req.params.name)
  if (!INLINE.has(ext)) res.set('Content-Disposition', 'attachment')
  res.type(INLINE.has(ext) ? ext : 'application/octet-stream')
  res.set('Cache-Control', 'private, max-age=31536000, immutable') // saves bandwidth
  res.send(bytes)
})

app.use('/uploads', express.static(join(data, 'uploads'), {
  setHeaders: (res, path) => {
    if (!INLINE.has(extname(path))) res.set('Content-Disposition', 'attachment')
  },
}))

app.get('/api/qr', async (req, res) => {
  const text = String(req.query.text || '')
  if (!text || text.length > 500) return res.sendStatus(400)
  res.type('svg').send(await QRCode.toString(text, { type: 'svg', margin: 1 }))
})

const lan = Object.values(networkInterfaces()).flat()
  .find((i) => i.family === 'IPv4' && !i.internal)?.address
// Lets the share dialog offer a link phones can open when you browse via localhost.
app.get('/api/info', (req, res) => res.json({ lanUrl: lan ? `http://${lan}:${PORT}` : null }))

app.use(express.static(join(root, 'dist')))

app.use((err, req, res, next) => {
  const tooBig = err.code === 'LIMIT_FILE_SIZE'
  if (!tooBig) console.error(err)
  res.status(tooBig ? 413 : 500).json({ error: tooBig ? `File is larger than ${MAX_FILE_MB} MB` : 'Server error' })
})

const server = createServer(app)
const wss = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 * 1024 })

server.on('upgrade', (req, socket, head) => {
  if (!req.url.startsWith('/sync') || !isAllowed(req)) return socket.destroy()
  wss.handleUpgrade(req, socket, head, (ws) => {
    const request = new Request(`http://${req.headers.host}${req.url}`, { headers: req.headers })
    const client = sync.handleConnection(ws, request)
    ws.on('message', (data) => client.handleMessage(new Uint8Array(data)))
    ws.on('close', (code, reason) => client.handleClose({ code, reason: reason.toString() }))
    ws.on('error', (e) => console.error(e.message))
  })
})

server.listen(PORT, () => {
  console.log(`Notepad:        http://localhost:${PORT}`)
  if (lan) console.log(`On your Wi-Fi:  http://${lan}:${PORT}`)
})

// Save pending edits before exiting.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => {
    sync.flushPendingStores()
    setTimeout(() => process.exit(0), 3000) // time to reach a remote database
  })
}
