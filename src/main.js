import './style.css'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCaret from '@tiptap/extension-collaboration-caret'
import { Placeholder, CharacterCount } from '@tiptap/extensions'
import { TaskList, TaskItem } from '@tiptap/extension-list'
import Image from '@tiptap/extension-image'
import { TableKit } from '@tiptap/extension-table'
import { TextStyle, Color } from '@tiptap/extension-text-style'
import Highlight from '@tiptap/extension-highlight'
import TextAlign from '@tiptap/extension-text-align'
import * as Y from 'yjs'
import { HocuspocusProvider } from '@hocuspocus/provider'
import { IndexeddbPersistence } from 'y-indexeddb'
import { buildToolbar } from './toolbar.js'
import { ask } from './ask.js'

const $ = (id) => document.getElementById(id)

// ---------- Which note? The id lives in the URL hash and is the invite secret. ----------
const newId = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('')
let noteId = location.hash.slice(1)
if (!/^[a-zA-Z0-9_-]{8,64}$/.test(noteId)) {
  noteId = newId()
  history.replaceState(null, '', `#${noteId}`)
}
addEventListener('hashchange', () => location.reload())

// ---------- Identity ----------
const COLORS = ['#e8590c', '#2f9e44', '#1971c2', '#9c36b5', '#c92a2a', '#0b7285']
const store = {
  get: (k, fallback) => { try { return JSON.parse(localStorage.getItem(k)) ?? fallback } catch { return fallback } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch {} },
}
const user = store.get('user', null) ?? {
  name: `Guest ${Math.floor(100 + Math.random() * 900)}`,
  color: COLORS[Math.floor(Math.random() * COLORS.length)],
}
store.set('user', user)

// ---------- Shared document: offline copy + live server connection ----------
const doc = new Y.Doc()
new IndexeddbPersistence(`note-${noteId}`, doc)
let online = false
const provider = new HocuspocusProvider({
  url: `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/sync`,
  name: noteId,
  document: doc,
  onStatus: ({ status }) => { online = status === 'connected'; showStatus() },
  onSynced: () => showStatus(),
  onUnsyncedChanges: () => showStatus(),
  onAwarenessUpdate: ({ states }) => showPeople(states),
})

// Every keystroke is "unsynced" for a few milliseconds. Only say "Syncing…" when
// the server is actually slow to confirm, so the label doesn't blink while typing.
const SLOW_SYNC_MS = 1500
let slowTimer
let slow = false

function showStatus() {
  const el = $('status')
  if (!el || typeof provider === 'undefined') return
  if (!online || !provider.hasUnsyncedChanges) {
    clearTimeout(slowTimer)
    slowTimer = undefined
    slow = false
  } else if (!slowTimer) {
    slowTimer = setTimeout(() => { slow = true; showStatus() }, SLOW_SYNC_MS)
  }
  const state = !online ? 'offline' : slow ? 'saving' : 'live'
  if (el.dataset.state === state) return
  el.textContent = { offline: 'Offline · edits kept on this device', saving: 'Syncing…', live: 'Live · synced' }[state]
  el.dataset.state = state
}

function showPeople(states) {
  $('people').replaceChildren(...states.filter((s) => s.user).map((s) => {
    const dot = document.createElement('span')
    dot.className = 'avatar'
    dot.style.background = /^#[0-9a-f]{6}$/i.test(s.user.color) ? s.user.color : '#666'
    dot.textContent = String(s.user.name || '?').slice(0, 1).toUpperCase()
    dot.title = String(s.user.name || '')
    return dot
  }))
}

// ---------- Editor ----------
const editor = new Editor({
  element: $('editor'),
  extensions: [
    StarterKit.configure({ undoRedo: false, link: { openOnClick: false } }), // Yjs handles undo
    Collaboration.configure({ document: doc }),
    CollaborationCaret.configure({ provider, user }),
    Placeholder.configure({ placeholder: 'Start typing, then tap Share to invite others…' }),
    CharacterCount,
    TaskList,
    TaskItem.configure({ nested: true }),
    Image,
    TableKit.configure({ table: { resizable: false } }),
    TextStyle,
    Color,
    Highlight,
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
  ],
  onTransaction: () => {
    if (!editor) return
    refreshToolbar()
    $('count').textContent =
      `${editor.storage.characterCount.words()} words · ${editor.storage.characterCount.characters()} characters`
  },
})
const refreshToolbar = buildToolbar($('toolbar'), editor, {
  image: () => $('image-input').click(),
  file: () => $('file-input').click(),
})
refreshToolbar()

// ---------- Title (synced too) ----------
const meta = doc.getMap('meta')
const title = $('title')
function remember() {
  const others = store.get('recent', []).filter((n) => n.id !== noteId)
  store.set('recent', [{ id: noteId, title: title.value || 'Untitled note' }, ...others].slice(0, 30))
}
meta.observe(() => {
  const value = String(meta.get('title') ?? '')
  if (title.value !== value) title.value = value
  document.title = value || 'Collab Notepad'
  remember()
})
title.addEventListener('input', () => meta.set('title', title.value))
remember()

// ---------- Name ----------
$('me').textContent = user.name
$('me').onclick = async () => {
  const name = (await ask('Your name (others see it next to your cursor)', user.name))?.trim()
  if (!name) return
  user.name = name.slice(0, 30)
  store.set('user', user)
  $('me').textContent = user.name
  editor.commands.updateUser({ ...user })
}

// ---------- Uploads from the device ----------
let toastTimer
function toast(message) {
  $('toast').textContent = message
  $('toast').hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => ($('toast').hidden = true), 3500)
}

async function addFile(file) {
  toast(`Uploading ${file.name}…`)
  try {
    const body = new FormData()
    body.append('file', file)
    const res = await fetch('/api/upload', { method: 'POST', body })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error)
    if (data.isImage) {
      editor.chain().focus().setImage({ src: data.url, alt: file.name }).run()
    } else {
      editor.chain().focus().insertContent({
        type: 'paragraph',
        content: [{ type: 'text', text: `📎 ${file.name}`, marks: [{ type: 'link', attrs: { href: data.url } }] }],
      }).run()
    }
    toast('Added to the note')
  } catch (e) {
    toast(`Upload failed: ${e.message}`)
  }
}

for (const id of ['image-input', 'file-input']) {
  $(id).onchange = async (e) => {
    const [file] = e.target.files
    e.target.value = ''
    if (file) await addFile(file)
  }
}
// Paste or drag-and-drop files straight into the note.
for (const [event, key] of [['paste', 'clipboardData'], ['drop', 'dataTransfer']]) {
  $('editor').addEventListener(event, (e) => {
    const files = [...(e[key]?.files ?? [])]
    if (!files.length) return
    e.preventDefault()
    e.stopPropagation()
    files.reduce((queue, f) => queue.then(() => addFile(f)), Promise.resolve())
  }, true)
}
// Tapping an attachment or link opens it (Ctrl/Cmd-click on desktop).
$('editor').addEventListener('click', (e) => {
  const a = e.target.closest('a[href]')
  if (a && (e.metaKey || e.ctrlKey || a.getAttribute('href').startsWith('/uploads/'))) {
    e.preventDefault()
    window.open(a.href, '_blank', 'noopener')
  }
})

// ---------- Import / export ----------
$('import-input').onchange = async (e) => {
  const [file] = e.target.files
  e.target.value = ''
  if (!file) return
  if (file.size > 1024 * 1024) return toast('Import is limited to 1 MB')
  const text = await file.text()
  const content = /\.html?$/i.test(file.name)
    ? text
    : text.split(/\r?\n/).map((line) => ({ type: 'paragraph', content: line ? [{ type: 'text', text: line }] : [] }))
  // Add at the end so nobody's existing writing is replaced.
  editor.chain().focus('end').insertContent(content).run()
  toast(`Imported ${file.name}`)
}

function download(name, text, type) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([text], { type }))
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const fileName = () => (title.value || 'note').replace(/[^\p{L}\p{N} _-]/gu, '').trim() || 'note'

const actions = {
  new: () => (location.hash = newId()),
  import: () => $('import-input').click(),
  txt: () => download(`${fileName()}.txt`, editor.getText({ blockSeparator: '\n' }), 'text/plain'),
  html: () => download(`${fileName()}.html`,
    `<!doctype html><meta charset="utf-8"><base href="${location.origin}/"><title>${escapeHtml(fileName())}</title>${editor.getHTML()}`,
    'text/html'),
  print: () => print(),
  recent: () => {
    $('recent').replaceChildren(...store.get('recent', []).map((n) => {
      const li = document.createElement('li')
      const a = document.createElement('a')
      a.href = `#${n.id}`
      a.textContent = n.id === noteId ? `${n.title} (open now)` : n.title
      a.onclick = () => $('recent-dialog').close()
      li.append(a)
      return li
    }))
    $('recent-dialog').showModal()
  },
}
$('menu').onchange = (e) => {
  const action = actions[e.target.value]
  e.target.value = ''
  action?.()
}
$('close-recent').onclick = () => $('recent-dialog').close()

// ---------- Sharing ----------
$('share').onclick = async () => {
  let base = location.origin
  let hint = ''
  if (['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) {
    const info = await fetch('/api/info').then((r) => r.json()).catch(() => ({}))
    if (info.lanUrl) base = info.lanUrl
    hint = info.lanUrl
      ? 'Phones on the same Wi-Fi can scan this. To invite people elsewhere, put the app online.'
      : 'This link only works on this computer.'
  }
  const url = `${base}/#${noteId}`
  $('link').value = url
  $('qr').src = `/api/qr?text=${encodeURIComponent(url)}`
  $('share-hint').textContent = hint
  $('native').hidden = !navigator.share
  $('native').onclick = () => navigator.share({ title: title.value || 'Shared note', url }).catch(() => {})
  $('share-dialog').showModal()
}
$('copy').onclick = async () => {
  try {
    await navigator.clipboard.writeText($('link').value)
    $('copy').textContent = 'Copied'
  } catch {
    $('link').select()
    $('copy').textContent = document.execCommand('copy') ? 'Copied' : 'Press and hold to copy'
  }
  setTimeout(() => ($('copy').textContent = 'Copy link'), 2000)
}
$('close-share').onclick = () => $('share-dialog').close()
showStatus()
