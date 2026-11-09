import 'dotenv/config'
import bcrypt from 'bcryptjs'
import Database from 'better-sqlite3'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const email = process.env.ADMIN_EMAIL?.trim()
const password = process.env.ADMIN_PASSWORD
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  throw new Error('Set ADMIN_EMAIL to a valid email address in the project .env file.')
}
if (!password || password.length < 12) {
  throw new Error('Set ADMIN_PASSWORD to at least 12 characters in the project .env file.')
}

const here = path.dirname(fileURLToPath(import.meta.url))
const db = new Database(path.resolve(here, '../server/data/gizmonest.sqlite'))
try {
  const existingWithEmail = db.prepare('SELECT id, role FROM users WHERE email = ?').get(email)
  if (existingWithEmail?.role !== undefined && existingWithEmail.role !== 'admin') {
    throw new Error('That email already belongs to a customer account. Choose a different ADMIN_EMAIL.')
  }

  const admin = db.prepare("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1").get()
  const passwordHash = await bcrypt.hash(password, 12)
  if (admin) {
    db.prepare('UPDATE users SET email = ?, password_hash = ? WHERE id = ?').run(email, passwordHash, admin.id)
  } else {
    db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)')
      .run('GizmoNest Admin', email, passwordHash, 'admin')
  }
  console.log(`Admin login updated for ${email}. Sign in at http://localhost:5173/admin/login.`)
} finally {
  db.close()
}
