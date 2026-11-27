// Notes and uploads live in one libSQL (SQLite) database:
// a local file on your computer, or a hosted Turso database when TURSO_DATABASE_URL is set.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createClient } from '@libsql/client'
import { Database } from '@hocuspocus/extension-database'

export async function openStorage(folder) {
  const remote = process.env.TURSO_DATABASE_URL
  // Render's free disk is wiped on every restart, so refuse to run without a real database.
  if (!remote && process.env.RENDER) throw new Error('Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN')
  if (!remote) mkdirSync(folder, { recursive: true })
  const db = createClient(remote
    ? { url: remote, authToken: process.env.TURSO_AUTH_TOKEN }
    : { url: `file:${join(folder, 'notes.sqlite')}` })

  await db.batch([
    'CREATE TABLE IF NOT EXISTS documents (name varchar(255) NOT NULL UNIQUE, data blob NOT NULL)',
    'CREATE TABLE IF NOT EXISTS uploads (name text PRIMARY KEY, size integer NOT NULL, data blob NOT NULL)',
  ], 'write')

  return {
    notes: new Database({
      fetch: async ({ documentName }) => {
        const { rows } = await db.execute({ sql: 'SELECT data FROM documents WHERE name = ?', args: [documentName] })
        return rows.length ? new Uint8Array(rows[0].data) : null
      },
      store: async ({ documentName, state }) => {
        await db.execute({
          sql: 'INSERT INTO documents (name, data) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET data = excluded.data',
          args: [documentName, state],
        })
      },
    }),
    // Saves only if it fits under the cap. Checking and inserting in one statement avoids races.
    async saveUpload(name, bytes, maxTotal) {
      const result = await db.execute({
        sql: `INSERT INTO uploads (name, size, data)
              SELECT ?, ?, ? WHERE (SELECT COALESCE(SUM(size), 0) FROM uploads) + ? <= ?`,
        args: [name, bytes.length, bytes, bytes.length, maxTotal],
      })
      return result.rowsAffected === 1
    },
    async readUpload(name) {
      const { rows } = await db.execute({ sql: 'SELECT data FROM uploads WHERE name = ?', args: [name] })
      return rows.length ? Buffer.from(rows[0].data) : null
    },
  }
}
