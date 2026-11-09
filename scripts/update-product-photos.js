import Database from 'better-sqlite3'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const databasePath = path.resolve(here, '../server/data/gizmonest.sqlite')
const db = new Database(databasePath)

const updates = [
  ['Soundcore R50i TWS Earbuds', 'https://www.startech.com.bd/image/cache/catalog/earbuds/anker/soundcore-r50i/soundcore-r50i-blue-01-500x500.webp'],
  ['Soundcore Select 4 Go Bluetooth Speaker', 'https://gadgetplusbangladesh.com/api/public/images/1785397726793-fl9uop.png'],
  ['Weofly Active 2 Smartwatch', 'https://gadgetplusbangladesh.com/api/public/images/1784961005178-e956sb.jpg'],
  ['Anker Zolo 30W PD 3.0 Charger with USB-C Cable', 'https://gadgetplusbangladesh.com/api/public/images/1784784780423-vhmbmf.jpg'],
  ['CMF by Nothing Neckband Pro 50dB ANC', 'https://gearpicker.com.bd/storage/product/cmf-pro-2025-01-25-6794a1401f2b2.jpg'],
  ['Soundcore Q11i Bluetooth Headphones', 'https://motionview.s3.amazonaws.com/images/products/profile/177228981563.webp'],
  ['Soundcore Boom Go 3i Portable Bluetooth Speaker', 'https://down-my.img.susercontent.com/file/cn-11134208-820l4-ml60dwi5wge812'],
  ['QCY PB20A 20000mAh 45W PD Power Bank', 'https://gadgetplusbangladesh.com/api/public/images/1792756701848-wcoe2g.jpg'],
]

const update = db.prepare('UPDATE products SET image_url = ? WHERE name = ?')
const runUpdates = db.transaction(() => updates.map(([name, imageUrl]) => {
  const result = update.run(imageUrl, name)
  if (result.changes !== 1) throw new Error(`Expected exactly one product named "${name}", found ${result.changes}. No further updates were applied.`)
  return name
}))

try {
  const updated = runUpdates()
  console.log(`Updated product photos for ${updated.length} products in ${databasePath}:`)
  updated.forEach((name) => console.log(`- ${name}`))
} finally {
  db.close()
}
