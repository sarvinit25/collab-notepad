// Checks two collaborators converge, offline-style concurrent edits merge, and uploads behave.
import assert from 'node:assert/strict'
import * as Y from 'yjs'
import { HocuspocusProvider } from '@hocuspocus/provider'
const base = process.env.BASE || 'http://localhost:3000'
const name = 'test' + Date.now()
const join = () => new Promise((resolve) => {
  const doc = new Y.Doc()
  const provider = new HocuspocusProvider({ url: base.replace('http', 'ws') + '/sync', name, document: doc,
    onSynced: () => resolve({ doc, provider, text: doc.getText('t') }) })
})
const until = async (fn) => { const s = performance.now(); while (!fn()) { if (performance.now() - s > 5000) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 1)) } return performance.now() - s }
const a = await join(), b = await join()
const times = []
for (let i = 0; i < 50; i++) { a.text.insert(a.text.length, 'x'); times.push(await until(() => b.text.length === i + 1)) }
times.sort((x, y) => x - y)
console.log(`edit → other client: median ${times[25].toFixed(1)} ms, max ${times.at(-1).toFixed(1)} ms (same machine)`)
b.provider.configuration.websocketProvider.disconnect()
await new Promise((r) => setTimeout(r, 300))
a.text.insert(0, 'FROM-A '); b.text.insert(b.text.length, ' FROM-B')
b.provider.configuration.websocketProvider.connect()
await until(() => a.text.toString() === b.text.toString() && a.text.toString().includes('FROM-B') && b.text.toString().includes('FROM-A'))
console.log('offline edits merged on both sides')
await new Promise((r) => setTimeout(r, 1500))
a.provider.destroy(); b.provider.destroy()
await new Promise((r) => setTimeout(r, 1500))
const c = await join(); await until(() => c.text.toString().includes('FROM-B'))
console.log('note reloaded after everyone left')
const send = async (file, fname) => { const f = new FormData(); f.append('file', new Blob([file]), fname); return fetch(base + '/api/upload', { method: 'POST', body: f }) }
const ok = await (await send('<script>1</script>', 'x.html')).json()
assert.match((await fetch(base + ok.url)).headers.get('content-disposition'), /attachment/)
assert.equal((await send(new Uint8Array(16 * 1024 * 1024), 'big.bin')).status, 413)
console.log('uploads: HTML forced to download, oversize rejected')
process.exit(0)
