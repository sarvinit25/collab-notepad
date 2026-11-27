# Collab Notepad

A shared notepad that runs in any modern browser, including iOS Safari and Android Chrome.

## Run it

```bash
npm install
npm start
```

Open http://localhost:3000, tap **Share**, and scan the QR code with a phone on the same Wi-Fi.
`npm test` (with the server running) checks sync, offline merge, reload and upload rules.

## Sync on / off

The **Sync** button turns live updates on or off for your device. While off, nothing is sent or
received and edits stay in the browser. Turning it on merges both sides. File uploads still go to
the server immediately, but the note linking to them is shared only once sync is on.

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| App | Web app with install manifest | One codebase for iOS, Android and desktop; joining is just a link |
| Editor | Tiptap (ProseMirror) | Rich text, lists, tables, images, live cursors |
| Sync | Yjs (CRDT) | Concurrent edits merge without overwriting each other |
| Transport | WebSocket via Hocuspocus | Pushes changes as they happen |
| Offline copy | IndexedDB (y-indexeddb) | Edits survive a dropped connection |
| Server | Node.js, Express, Multer | Serves the app and takes uploads |
| Storage | SQLite (libSQL) locally, Turso online | Same code in both places |
| Build | Vite | Small, fast builds |

## How collaboration stays fast

```
Phone A ── small binary update ──> Server ── relay ──> Phone B
   │ applies the edit locally first    │ saves to SQLite after a short pause
   └ keeps a copy in IndexedDB         └ never blocks typing
```

1. **Local first.** Your keystroke appears immediately; the network comes afterwards.
2. **Only changes travel.** A keystroke is a tiny binary update, not the whole note.
3. **No locks.** The CRDT guarantees everyone converges to the same text, in any arrival order.
4. **Catch-up on reconnect.** Each side sends only what the other is missing.
5. **Cursors are separate.** Presence is temporary and never saved.
6. **Delayed saving.** The server writes 1 to 5 seconds after edits.
7. **Files go over HTTP.** The note holds only a link, so large photos don't slow typing sync.

On one computer the test measured a median of about 2 ms between two clients. Over the internet,
delay is mostly network distance, so host close to your users.

## Putting it online for free (GitHub + Render + Turso)

Render runs the app from GitHub; Turso stores notes and uploads, because Render's free disk is wiped
on restarts. Check both providers' current free limits.

1. At https://turso.tech create a database, then copy its URL (`libsql://…`) and an auth token.
2. At https://render.com choose **New > Blueprint** and select this repository (`render.yaml`).
3. Enter `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` and `APP_PASSWORD` when asked.
4. Open the `onrender.com` address, enter the passcode, and tap **Share**.

Free services sleep after about 15 idle minutes; the next visit can take about a minute.

| Setting | Purpose |
|---|---|
| `APP_PASSWORD` | Passcode required to open the app. Without it, the app is open to anyone |
| `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` | Hosted database. Without them, a local file in `data/` is used |
| `MAX_FILE_MB` | Largest upload, default 5 |
| `MAX_STORAGE_MB` | Total upload storage, default 500 |

## Limits

- Everyone shares one passcode; there are no personal accounts or view-only links.
- Uploads are limited to 5 MB each (by default), 30 per visitor in 10 minutes, and the storage cap.
- The page itself needs the server to load (no service worker yet).
- Run a single instance: live edits are merged in one server process.

## Next steps at scale

Sign-in and permissions, object storage (S3 or R2) for files, a larger database, and
Redis (`@hocuspocus/extension-redis`) to run several sync servers. For app store builds, wrap the
same web app with Capacitor.
