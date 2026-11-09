import Database from 'better-sqlite3'
import bcrypt from 'bcryptjs'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const dataDir = path.join(here, 'data')
fs.mkdirSync(dataDir, { recursive: true })
export const db = new Database(path.join(dataDir, 'gizmonest.sqlite'))
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('customer','admin')) DEFAULT 'customer',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    brand TEXT NOT NULL,
    category TEXT NOT NULL,
    price_bdt INTEGER NOT NULL CHECK(price_bdt >= 0),
    compare_at_bdt INTEGER,
    description TEXT NOT NULL DEFAULT '',
    image_url TEXT NOT NULL DEFAULT '',
    stock INTEGER NOT NULL DEFAULT 0 CHECK(stock >= 0),
    is_demo INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_code TEXT NOT NULL UNIQUE,
    user_id INTEGER NOT NULL REFERENCES users(id),
    customer_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    address TEXT NOT NULL,
    delivery_area TEXT NOT NULL CHECK(delivery_area IN ('inside_dhaka','outside_dhaka')),
    delivery_fee_bdt INTEGER NOT NULL,
    total_bdt INTEGER NOT NULL,
    payment_method TEXT NOT NULL DEFAULT 'cod',
    status TEXT NOT NULL DEFAULT 'Pending',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id),
    product_name TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    unit_price_bdt INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    image_url TEXT NOT NULL DEFAULT '', parent_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS product_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    image_url TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS customer_addresses (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label TEXT NOT NULL DEFAULT 'Address', recipient TEXT NOT NULL, phone TEXT NOT NULL,
    address TEXT NOT NULL, delivery_area TEXT NOT NULL DEFAULT 'outside_dhaka', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS coupons (
    id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL UNIQUE COLLATE NOCASE,
    discount_type TEXT NOT NULL CHECK(discount_type IN ('percent','fixed')), discount_value INTEGER NOT NULL,
    expires_at TEXT, min_order_bdt INTEGER NOT NULL DEFAULT 0, usage_limit INTEGER, usage_count INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL, customer_name TEXT NOT NULL,
    rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5), body TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending', response TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS return_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'Requested', admin_note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(order_id,user_id)
  );
  CREATE TABLE IF NOT EXISTS store_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '');
  CREATE TABLE IF NOT EXISTS admin_activity (id INTEGER PRIMARY KEY AUTOINCREMENT, admin_id INTEGER REFERENCES users(id) ON DELETE SET NULL, action TEXT NOT NULL, details TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE IF NOT EXISTS admin_roles (user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, role TEXT NOT NULL CHECK(role IN ('owner','catalog','orders','support','marketing')) DEFAULT 'catalog');
`)

// Additive migrations keep existing standalone SQLite databases usable.
const ensureColumn = (table, column, definition) => {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all()
  if (!columns.some((entry) => entry.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
}
ensureColumn('users', 'is_active', 'INTEGER NOT NULL DEFAULT 1')
ensureColumn('orders', 'tracking_info', "TEXT NOT NULL DEFAULT ''")
ensureColumn('orders', 'payment_status', "TEXT NOT NULL DEFAULT 'Pending'")
ensureColumn('orders', 'refund_status', "TEXT NOT NULL DEFAULT 'None'")
ensureColumn('orders', 'discount_bdt', 'INTEGER NOT NULL DEFAULT 0')
ensureColumn('orders', 'coupon_code', "TEXT NOT NULL DEFAULT ''")
ensureColumn('products', 'is_featured', 'INTEGER NOT NULL DEFAULT 0')
db.exec(`
  INSERT OR IGNORE INTO categories(name) SELECT DISTINCT category FROM products WHERE trim(category) <> '' AND category <> 'Archived';
  INSERT OR IGNORE INTO store_settings(key,value) VALUES ('store_name','GizmoNest'),('contact_email','hello@gizmonest.example'),('contact_phone',''),('about','Thoughtful tech, chosen with care.'),('return_policy','Contact GizmoNest within 7 days of delivery to request a return. Eligibility and item condition requirements apply.'),('shipping_inside_dhaka','80'),('shipping_outside_dhaka','150'),('homepage_banner','');
  INSERT OR IGNORE INTO product_images(product_id,image_url,sort_order) SELECT id,image_url,0 FROM products WHERE image_url <> '';
`)

const count = db.prepare('SELECT COUNT(*) AS n FROM products').get().n
if (!count) {
  const items = [
    ['Soundcore','Soundcore Space One Headphones','Audio',12990,15990,'40mm over-ear Bluetooth headphones with adaptive noise cancelling and LDAC audio.','https://cdn.shopify.com/s/files/1/0917/4807/3750/files/A3035021_Product_Image.png?v=1766027943'],
    ['Samsung','Galaxy Watch6','Wearables',24990,29990,'Galaxy Watch6 40mm Bluetooth smartwatch. See the catalog updater for detailed model specifications.','https://samsung-akinon.a-cdn.akinoncdn.com/products/2023/07/21/18230/f0519b3e-da2f-49bd-9de7-c202ee000287.jpg'],
    ['JBL','Flip 6 Portable Speaker','Audio',11900,13900,'Portable two-way JBL Bluetooth speaker with a dedicated woofer and tweeter.','https://cdn.shopware.store/N/R/R/AlrFq/media/28/4a/02/1772707448/e00116fd8aea4c83b7e16a629cb670ec.jpeg?ts=1772707448'],
    ['Logitech','G502 X Gaming Mouse','Gaming',8990,9990,'Wired G502 X gaming mouse with LIGHTFORCE switches and HERO 25K sensor.','https://cdn11.bigcommerce.com/s-9nntib/images/stencil/1500x1500/products/96431/409253/logitech_g502_x_wired_gaming_mouse_black__92830.1755732585.jpg?c=2'],
    ['Canon','EOS R50 Creator Kit','Cameras',89900,94900,'24.2MP APS-C mirrorless camera creator bundle. Bundle contents vary by seller.','https://www.bhphotovideo.com/images/fb/canon_5811c059_eos_r50_content_creator_1766852.jpg'],
    ['Keychron','K2 Wireless Keyboard','Desk setup',11900,13900,'Compact mechanical keyboard for work and play.','https://images.unsplash.com/photo-1587829741301-dc798b83add3?auto=format&fit=crop&w=900&q=85'],
    ['Anker','Soundcore Liberty 4 NC','Audio',8990,10990,'Pocket earbuds with adaptive noise cancelling.','https://images.unsplash.com/photo-1606220945770-b5b6c2c55bf1?auto=format&fit=crop&w=900&q=85'],
    ['Xiaomi','Mi Smart Projector 2','Smart home',59900,64900,'A compact projector for a relaxed home cinema setup.','https://images.unsplash.com/photo-1535016120720-40c646be5580?auto=format&fit=crop&w=900&q=85'],
    ['Sony','PlayStation DualSense','Gaming',8990,9990,'PS5 wireless controller with haptic feedback and adaptive triggers.','https://m.media-amazon.com/images/I/71RV4eBioQL.jpg'],
    ['Baseus','Blade Laptop Power Bank','Power',10900,12900,'Slim 20,000mAh laptop power bank with up to 100W USB-C output.','https://ecommerce.datablitz.com.ph/cdn/shop/files/Baseus_Blade_Laptop_Power_Bank_100W_20000mAh_3_side_3000x_775bc2bd-5b76-4638-9769-3489b5b21593_800x.jpg?v=1743321194'],
    ['Apple','AirPods Pro (2nd generation)','Audio',27900,29900,'AirPods Pro 2 with active noise cancellation and USB-C charging case.','https://s3-ap-southeast-2.amazonaws.com/wc-prod-pim/JPEG_1000x1000/APAIRPRO2C_B_airpods_pro_2nd_generation_with_magsafe_case_usb_c_.jpg'],
    ['Nothing','Phone (2a)','Phones',34990,37990,'A clean Android experience with a distinctive design.','https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?auto=format&fit=crop&w=900&q=85'],
  ]
  const insert = db.prepare(`INSERT INTO products (brand,name,category,price_bdt,compare_at_bdt,description,image_url,stock,is_demo)
    VALUES (?,?,?,?,?,?,?,0,1)`)
  const seed = db.transaction(() => items.forEach((p) => insert.run(...p)))
  seed()
}
db.exec(`INSERT OR IGNORE INTO categories(name) SELECT DISTINCT category FROM products WHERE trim(category) <> '' AND category <> 'Archived'`)

export async function seedAdmin() {
  const email = process.env.ADMIN_EMAIL || 'admin@gizmonest.local'
  const password = process.env.ADMIN_PASSWORD || 'ChangeMe-Admin-2026!'
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email)
  if (!existing) {
    const hash = await bcrypt.hash(password, 12)
    db.prepare('INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,?)')
      .run('GizmoNest Admin', email, hash, 'admin')
  }
}
