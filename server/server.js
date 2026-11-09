import 'dotenv/config'
import express from 'express'
import helmet from 'helmet'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import rateLimit from 'express-rate-limit'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { db, seedAdmin } from './db.js'

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  if (process.env.NODE_ENV === 'production') throw new Error('Set a 32+ character JWT_SECRET in the environment.')
  process.env.JWT_SECRET = 'local-development-only-secret-change-before-deploying'
}

await seedAdmin()
db.prepare("INSERT OR IGNORE INTO admin_roles(user_id,role) SELECT id,'owner' FROM users WHERE role='admin'").run()
const app = express()
const port = Number(process.env.PORT || 4000)
const cookieOptions = { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/' }
app.use(helmet())
app.use(cors({ origin: process.env.WEB_ORIGIN || 'http://localhost:5173', credentials: true }))
app.use('/api/admin/uploads', express.raw({ type: ['image/jpeg','image/png','image/webp','image/gif'], limit: '8mb' }))
app.use(express.json({ limit: '32kb' }))
app.use(cookieParser())
const here = path.dirname(fileURLToPath(import.meta.url))
const uploadsDir = path.join(here, 'data', 'uploads')
fs.mkdirSync(uploadsDir, { recursive: true })
app.use('/uploads', express.static(uploadsDir, { maxAge: '7d', immutable: true }))
app.get('/api/uploads/:filename', (req,res)=>{if(!/^[0-9]+-[a-f0-9]+\.(jpg|png|webp|gif)$/.test(req.params.filename))return res.sendStatus(404);res.sendFile(path.join(uploadsDir,req.params.filename))})

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 12, standardHeaders: 'draft-8', legacyHeaders: false })
const loginSchema = z.object({ email: z.string().email().max(200), password: z.string().min(8).max(100) })
const registerSchema = loginSchema.extend({ name: z.string().trim().min(2).max(80) })
const safeUser = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, ...(u.role==='admin'?{admin_role:db.prepare('SELECT role FROM admin_roles WHERE user_id=?').get(u.id)?.role||'owner'}:{}) })
const userById = db.prepare('SELECT id,name,email,role FROM users WHERE id = ?')
function requireAuth(req, res, next) {
  try {
    const token = req.cookies.gn_session
    if (!token) return res.status(401).json({ error: 'Please sign in to continue.' })
    req.user = jwt.verify(token, process.env.JWT_SECRET)
    const active = db.prepare('SELECT is_active FROM users WHERE id=?').get(Number(req.user.sub))
    if (!active || !active.is_active) return res.clearCookie('gn_session', cookieOptions).status(403).json({ error: 'This account is inactive. Contact the store administrator.' })
    next()
  } catch { res.clearCookie('gn_session', cookieOptions).status(401).json({ error: 'Your session expired. Please sign in again.' }) }
}
function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin access required.' })
  const adminRole=db.prepare('SELECT role FROM admin_roles WHERE user_id=?').get(Number(req.user.sub))?.role||'owner'
  const path=req.path
  const section=path.includes('/accounts')||path.includes('/password')||path.includes('/activity')?'owner':path.includes('/products')||path.includes('/categories')||path.includes('/uploads')?'catalog':path.includes('/orders')||path.includes('/payments')||path.includes('/returns')?'orders':path.includes('/customers')||path.includes('/reviews')?'support':path.includes('/coupons')||path.includes('/settings')?'marketing':'overview'
  if(adminRole!=='owner'&&section!=='overview'&&adminRole!==section)return res.status(403).json({error:`This admin account does not have ${section} access.`})
  req.adminRole=adminRole
  next()
}
function logAdmin(req, action, details = '') {
  db.prepare('INSERT INTO admin_activity(admin_id,action,details) VALUES(?,?,?)').run(Number(req.user.sub), action, String(details).slice(0, 500))
}
function issueSession(res, user) {
  const token = jwt.sign({ sub: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '8h' })
  res.cookie('gn_session', token, { ...cookieOptions, maxAge: 8 * 60 * 60 * 1000 })
}

app.get('/api/health', (_req, res) => res.json({ ok: true, app: 'GizmoNest API' }))
app.post('/api/auth/register', authLimiter, async (req, res) => {
  const parsed = registerSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Enter a name, valid email, and password of at least 8 characters.' })
  const { name, email, password } = parsed.data
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) return res.status(409).json({ error: 'An account with that email already exists.' })
  const hash = await bcrypt.hash(password, 12)
  const created = db.prepare('INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,?)').run(name, email, hash, 'customer')
  const user = userById.get(created.lastInsertRowid)
  issueSession(res, user)
  res.status(201).json({ user: safeUser(user) })
})
app.post('/api/auth/login', authLimiter, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Enter a valid email and password.' })
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(parsed.data.email)
  if (!user || !user.is_active || !(await bcrypt.compare(parsed.data.password, user.password_hash))) return res.status(401).json({ error: 'Email or password is incorrect.' })
  issueSession(res, user)
  res.json({ user: safeUser(user) })
})
app.get('/api/auth/me', requireAuth, (req, res) => {
  const user = userById.get(Number(req.user.sub))
  if (!user) return res.status(401).json({ error: 'Please sign in again.' })
  res.json({ user: safeUser(user) })
})
app.post('/api/auth/logout', (_req, res) => res.clearCookie('gn_session', cookieOptions).json({ ok: true }))

app.get('/api/products', (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 80)
  const category = String(req.query.category || '').trim().slice(0, 40)
  const query = `%${q}%`
  const products = db.prepare(`SELECT * FROM products
    WHERE category <> 'Archived'
      AND (? = '%%' OR name LIKE ? OR brand LIKE ? OR category LIKE ?)
      AND (? = '' OR category = ?)
    ORDER BY is_featured DESC, id DESC`).all(query, query, query, query, category, category)
  res.json({ products: products.map((p) => ({ ...p, is_demo: Boolean(p.is_demo) })) })
})
app.get('/api/categories', (_req,res)=>res.json({categories:db.prepare("SELECT name FROM categories WHERE name NOT IN ('Archived','Phones','PC Power') ORDER BY name").all().map(x=>x.name)}))
app.get('/api/storefront/settings', (_req,res)=>{const settings=Object.fromEntries(db.prepare('SELECT key,value FROM store_settings').all().map(x=>[x.key,x.value]));res.json({settings:{store_name:settings.store_name,contact_email:settings.contact_email,contact_phone:settings.contact_phone,about:settings.about,return_policy:settings.return_policy,homepage_banner:settings.homepage_banner,shipping_inside_dhaka:settings.shipping_inside_dhaka,shipping_outside_dhaka:settings.shipping_outside_dhaka}})})
app.get('/api/products/:id/images', (req,res)=>{const product=db.prepare('SELECT id,image_url FROM products WHERE id=? AND category<>\'Archived\'').get(Number(req.params.id));if(!product)return res.status(404).json({error:'Product not found.'});const images=db.prepare('SELECT image_url FROM product_images WHERE product_id=? ORDER BY sort_order,id').all(product.id).map(x=>x.image_url);res.json({images:images.length?images:[product.image_url].filter(Boolean)})})
app.get('/api/products/:id/reviews',(req,res)=>res.json({reviews:db.prepare("SELECT customer_name,rating,body,response,created_at FROM reviews WHERE product_id=? AND status='approved' ORDER BY id DESC").all(Number(req.params.id))}))
app.post('/api/products/:id/reviews',requireAuth,(req,res)=>{if(req.user.role!=='customer')return res.status(403).json({error:'Customer account required.'});const p=z.object({rating:z.number().int().min(1).max(5),body:z.string().trim().min(5).max(2000)}).safeParse(req.body);if(!p.success)return res.status(400).json({error:'Choose a rating and write at least five characters.'});const u=db.prepare('SELECT name FROM users WHERE id=?').get(Number(req.user.sub));if(!u)return res.status(401).json({error:'Sign in again to submit a review.'});try{db.prepare("INSERT INTO reviews(product_id,user_id,customer_name,rating,body,status) SELECT id,?,?,?,?, 'pending' FROM products WHERE id=?").run(Number(req.user.sub),u.name,p.data.rating,p.data.body,Number(req.params.id));res.status(201).json({ok:true,message:'Review submitted for admin approval.'})}catch(e){res.status(404).json({error:'Product not found.'})}})

app.post('/api/coupons/validate', requireAuth, (req,res)=>{const p=z.object({code:z.string().trim().min(3).max(32),subtotal:z.number().int().min(0)}).safeParse(req.body);if(!p.success)return res.status(400).json({error:'Enter a valid coupon code.'});const c=db.prepare("SELECT * FROM coupons WHERE code=? COLLATE NOCASE AND active=1 AND (expires_at IS NULL OR date(expires_at)>=date('now')) AND (usage_limit IS NULL OR usage_count<usage_limit)").get(p.data.code);if(!c)return res.status(404).json({error:'Coupon is invalid, expired, or has reached its usage limit.'});if(p.data.subtotal<c.min_order_bdt)return res.status(400).json({error:`This coupon requires a minimum order of ${c.min_order_bdt} BDT.`});const discount=Math.min(p.data.subtotal,c.discount_type==='percent'?Math.floor(p.data.subtotal*c.discount_value/100):c.discount_value);res.json({code:c.code,discount_bdt:discount})})

const orderSchema = z.object({
  items: z.array(z.object({ productId: z.number().int().positive(), quantity: z.number().int().min(1).max(10) })).min(1).max(30),
  customerName: z.string().trim().min(2).max(100), phone: z.string().trim().min(7).max(20),
  address: z.string().trim().min(8).max(400), deliveryArea: z.enum(['inside_dhaka','outside_dhaka']), coupon_code:z.string().trim().max(32).optional().default(''),
})
app.post('/api/orders', requireAuth, (req, res) => {
  if (req.user.role !== 'customer') return res.status(403).json({ error: 'Use a customer account to place an order.' })
  const parsed = orderSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Please complete all delivery details.' })
  const byId = db.prepare('SELECT * FROM products WHERE id = ?')
  const items = parsed.data.items.map(({ productId, quantity }) => ({ product: byId.get(productId), quantity }))
  if (items.some(({ product }) => !product)) return res.status(400).json({ error: 'A product in your cart is no longer available.' })
  if (items.some(({ product }) => product.is_demo || product.stock < 1)) return res.status(409).json({ error: 'This sample catalog has unverified stock. An admin must verify stock before orders can be placed.' })
  if (items.some(({ product, quantity }) => product.stock < quantity)) return res.status(409).json({ error: 'The requested quantity is not in stock.' })
  const subtotal = items.reduce((sum, x) => sum + x.product.price_bdt * x.quantity, 0)
  let coupon=null;let discount=0
  if(parsed.data.coupon_code){coupon=db.prepare("SELECT * FROM coupons WHERE code=? COLLATE NOCASE AND active=1 AND (expires_at IS NULL OR date(expires_at)>=date('now')) AND (usage_limit IS NULL OR usage_count<usage_limit)").get(parsed.data.coupon_code);if(!coupon)return res.status(400).json({error:'Coupon is invalid, expired, or has reached its usage limit.'});if(subtotal<coupon.min_order_bdt)return res.status(400).json({error:`This coupon requires a minimum order of ${coupon.min_order_bdt} BDT.`});discount=Math.min(subtotal,coupon.discount_type==='percent'?Math.floor(subtotal*coupon.discount_value/100):coupon.discount_value)}
  const deliveryKey=parsed.data.deliveryArea==='inside_dhaka'?'shipping_inside_dhaka':'shipping_outside_dhaka'
  const configuredDelivery=Number(db.prepare('SELECT value FROM store_settings WHERE key=?').get(deliveryKey)?.value)
  const delivery=Number.isFinite(configuredDelivery)?configuredDelivery:(parsed.data.deliveryArea==='inside_dhaka'?80:150)
  const code = `GN-${Date.now().toString(36).toUpperCase()}-${randomBytes(2).toString('hex').toUpperCase()}`
  const createOrder = db.transaction(() => {
    const inserted = db.prepare(`INSERT INTO orders(order_code,user_id,customer_name,phone,address,delivery_area,delivery_fee_bdt,total_bdt,coupon_code,discount_bdt)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).run(code, Number(req.user.sub), parsed.data.customerName, parsed.data.phone, parsed.data.address, parsed.data.deliveryArea, delivery, subtotal - discount + delivery,coupon?.code||'',discount)
    const addLine = db.prepare('INSERT INTO order_items(order_id,product_id,product_name,quantity,unit_price_bdt) VALUES(?,?,?,?,?)')
    const reduce = db.prepare('UPDATE products SET stock=stock-? WHERE id=?')
    items.forEach(({ product, quantity }) => { addLine.run(inserted.lastInsertRowid, product.id, product.name, quantity, product.price_bdt); reduce.run(quantity, product.id) })
    db.prepare(`INSERT INTO customer_addresses(user_id,label,recipient,phone,address,delivery_area) VALUES(?,?,?,?,?,?)`).run(Number(req.user.sub),'Checkout',parsed.data.customerName,parsed.data.phone,parsed.data.address,parsed.data.deliveryArea)
    if(coupon)db.prepare('UPDATE coupons SET usage_count=usage_count+1 WHERE id=?').run(coupon.id)
    return inserted.lastInsertRowid
  })
  const orderId = createOrder()
  res.status(201).json({ order: db.prepare('SELECT order_code,status,total_bdt,discount_bdt,coupon_code FROM orders WHERE id=?').get(orderId) })
})
app.get('/api/orders/mine', requireAuth, (req, res) => {
  const orders = db.prepare('SELECT order_code,status,total_bdt,created_at FROM orders WHERE user_id=? ORDER BY id DESC').all(Number(req.user.sub))
  res.json({ orders })
})
app.post('/api/orders/:code/returns', requireAuth, (req,res)=>{if(req.user.role!=='customer')return res.status(403).json({error:'Customer account required.'});const p=z.object({reason:z.string().trim().min(8).max(1000)}).safeParse(req.body);if(!p.success)return res.status(400).json({error:'Please describe the return reason.'});const order=db.prepare("SELECT id,status FROM orders WHERE order_code=? AND user_id=?").get(req.params.code,Number(req.user.sub));if(!order)return res.status(404).json({error:'Order not found.'});if(order.status!=='Delivered')return res.status(400).json({error:'A return can be requested after delivery.'});if(!db.prepare("SELECT date(created_at,'+7 days')>=date('now') ok FROM orders WHERE id=?").get(order.id).ok)return res.status(400).json({error:'The 7-day return request window has passed.'});try{db.prepare('INSERT INTO return_requests(order_id,user_id,reason) VALUES(?,?,?)').run(order.id,Number(req.user.sub),p.data.reason);db.prepare("UPDATE orders SET refund_status='Requested' WHERE id=?").run(order.id);res.status(201).json({ok:true})}catch{res.status(409).json({error:'A return request already exists for this order.'})}})

app.get('/api/admin/summary', requireAuth, requireAdmin, (req, res) => {
  const now = new Date()
  const day = new Date(now); day.setHours(0,0,0,0)
  const week = new Date(day); week.setDate(week.getDate() - 6)
  const month = new Date(now.getFullYear(), now.getMonth(), 1)
  const summary = {
    products: db.prepare('SELECT COUNT(*) n FROM products').get().n,
    orders: db.prepare('SELECT COUNT(*) n FROM orders').get().n,
    customers: db.prepare("SELECT COUNT(*) n FROM users WHERE role='customer'").get().n,
    revenue: db.prepare("SELECT COALESCE(SUM(total_bdt),0) n FROM orders WHERE status='Delivered'").get().n,
    pending: db.prepare("SELECT COUNT(*) n FROM orders WHERE status='Pending'").get().n,
    completed: db.prepare("SELECT COUNT(*) n FROM orders WHERE status='Delivered'").get().n,
    revenueDaily: db.prepare("SELECT COALESCE(SUM(total_bdt),0) n FROM orders WHERE status<>'Cancelled' AND datetime(created_at)>=datetime(?)").get(day.toISOString()).n,
    revenueWeekly: db.prepare("SELECT COALESCE(SUM(total_bdt),0) n FROM orders WHERE status<>'Cancelled' AND datetime(created_at)>=datetime(?)").get(week.toISOString()).n,
    revenueMonthly: db.prepare("SELECT COALESCE(SUM(total_bdt),0) n FROM orders WHERE status<>'Cancelled' AND datetime(created_at)>=datetime(?)").get(month.toISOString()).n,
  }
  const orders = ['owner','orders'].includes(req.adminRole) ? db.prepare(`SELECT o.order_code,o.customer_name,o.total_bdt,o.status,o.created_at,o.payment_method,o.payment_status,o.tracking_info,
    (SELECT GROUP_CONCAT(product_name || ' × ' || quantity, ', ') FROM order_items WHERE order_id=o.id) items
    FROM orders o ORDER BY o.id DESC`).all() : []
  res.json({ summary, orders })
})
const photoUrlSchema=z.string().max(500).url().or(z.string().regex(/^\/api\/uploads\/[0-9]+-[a-f0-9]+\.(jpg|png|webp|gif)$/)).or(z.literal(''))
const productSchema = z.object({ name: z.string().trim().min(2).max(120), brand: z.string().trim().min(2).max(80), category: z.string().trim().min(2).max(60), price_bdt: z.number().int().min(0), compare_at_bdt: z.number().int().min(0).nullable().optional(), description: z.string().max(4000).default(''), image_url: photoUrlSchema.default(''), stock: z.number().int().min(0).max(100000), is_demo: z.boolean().default(false) })
const imageListSchema = z.array(photoUrlSchema).max(12)
function saveProductImages(productId, urls) {
  db.prepare('DELETE FROM product_images WHERE product_id=?').run(productId)
  const insertImage = db.prepare('INSERT INTO product_images(product_id,image_url,sort_order) VALUES(?,?,?)')
  urls.forEach((url, index) => insertImage.run(productId, url, index))
}
app.post('/api/admin/products', requireAuth, requireAdmin, (req, res) => {
  const parsed = productSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Check the product fields and try again.' })
  const p = parsed.data
  const result = db.prepare(`INSERT INTO products(name,brand,category,price_bdt,compare_at_bdt,description,image_url,stock,is_demo)
    VALUES(?,?,?,?,?,?,?,?,?)`).run(p.name,p.brand,p.category,p.price_bdt,p.compare_at_bdt ?? null,p.description,p.image_url,p.stock,p.is_demo ? 1 : 0)
  const images = imageListSchema.safeParse(req.body.image_urls || (p.image_url ? [p.image_url] : []))
  if (images.success) saveProductImages(Number(result.lastInsertRowid), images.data)
  db.prepare('UPDATE products SET is_featured=? WHERE id=?').run(req.body.is_featured ? 1 : 0, Number(result.lastInsertRowid))
  logAdmin(req, 'product.created', p.name)
  res.status(201).json({ product: db.prepare('SELECT * FROM products WHERE id=?').get(result.lastInsertRowid) })
})
app.put('/api/admin/products/:id', requireAuth, requireAdmin, (req, res) => {
  const parsed = productSchema.safeParse(req.body)
  const images = imageListSchema.safeParse(req.body.image_urls || (parsed.success && parsed.data.image_url ? [parsed.data.image_url] : []))
  if (!parsed.success || !images.success) return res.status(400).json({ error: 'Check the product fields and image links. Use up to 12 images.' })
  const p = parsed.data; const id = Number(req.params.id)
  const result = db.prepare(`UPDATE products SET name=?,brand=?,category=?,price_bdt=?,compare_at_bdt=?,description=?,image_url=?,stock=?,is_demo=?,is_featured=? WHERE id=?`)
    .run(p.name,p.brand,p.category,p.price_bdt,p.compare_at_bdt ?? null,p.description,images.data[0] || p.image_url,p.stock,p.is_demo ? 1 : 0,req.body.is_featured ? 1 : 0,id)
  if (!result.changes) return res.status(404).json({ error: 'Product not found.' })
  saveProductImages(id, images.data.length ? images.data : (p.image_url ? [p.image_url] : []))
  logAdmin(req, 'product.updated', `${id}: ${p.name}`)
  res.json({ product: db.prepare('SELECT * FROM products WHERE id=?').get(id) })
})
app.delete('/api/admin/products/:id', requireAuth, requireAdmin, (req, res) => {
  const id = Number(req.params.id)
  const exists = db.prepare('SELECT name FROM products WHERE id=?').get(id)
  if (!exists) return res.status(404).json({ error: 'Product not found.' })
  if (db.prepare('SELECT 1 FROM order_items WHERE product_id=? LIMIT 1').get(id)) return res.status(409).json({ error: 'This product is part of an order, so it cannot be deleted. Set stock to 0 and mark it out of stock instead.' })
  db.prepare('DELETE FROM products WHERE id=?').run(id); logAdmin(req, 'product.deleted', exists.name)
  res.json({ ok: true })
})
app.get('/api/admin/products/:id/images', requireAuth, requireAdmin, (req, res) => res.json({ images: db.prepare('SELECT id,image_url,sort_order FROM product_images WHERE product_id=? ORDER BY sort_order,id').all(Number(req.params.id)) }))
app.get('/api/admin/categories', requireAuth, requireAdmin, (_req, res) => res.json({ categories: db.prepare('SELECT c.*,p.name parent_name,(SELECT COUNT(*) FROM products x WHERE x.category=c.name) product_count FROM categories c LEFT JOIN categories p ON p.id=c.parent_id ORDER BY c.name').all() }))
app.post('/api/admin/categories', requireAuth, requireAdmin, (req, res) => {
  const p = z.object({name:z.string().trim().min(2).max(60),image_url:photoUrlSchema.default(''),parent_id:z.number().int().positive().nullable().optional()}).safeParse(req.body)
  if (!p.success) return res.status(400).json({error:'Enter a category name and a valid image link.'})
  try { const r=db.prepare('INSERT INTO categories(name,image_url,parent_id) VALUES(?,?,?)').run(p.data.name,p.data.image_url,p.data.parent_id||null); logAdmin(req,'category.created',p.data.name); return res.status(201).json({category:db.prepare('SELECT * FROM categories WHERE id=?').get(r.lastInsertRowid)}) } catch { return res.status(409).json({error:'That category already exists.'}) }
})
app.put('/api/admin/categories/:id', requireAuth, requireAdmin, (req, res) => {
  const p=z.object({name:z.string().trim().min(2).max(60),image_url:photoUrlSchema.default(''),parent_id:z.number().int().positive().nullable().optional()}).safeParse(req.body)
  if(!p.success)return res.status(400).json({error:'Enter a category name and valid image link.'})
  const old=db.prepare('SELECT name FROM categories WHERE id=?').get(Number(req.params.id)); if(!old)return res.status(404).json({error:'Category not found.'})
  try { db.transaction(()=>{db.prepare('UPDATE categories SET name=?,image_url=?,parent_id=? WHERE id=?').run(p.data.name,p.data.image_url,p.data.parent_id||null,Number(req.params.id)); if(old.name!==p.data.name)db.prepare('UPDATE products SET category=? WHERE category=?').run(p.data.name,old.name)})(); logAdmin(req,'category.updated',old.name+' → '+p.data.name); res.json({ok:true}) } catch { res.status(409).json({error:'Category name conflicts with an existing category.'}) }
})
app.delete('/api/admin/categories/:id', requireAuth, requireAdmin, (req,res)=>{const c=db.prepare('SELECT * FROM categories WHERE id=?').get(Number(req.params.id));if(!c)return res.status(404).json({error:'Category not found.'});if(db.prepare('SELECT 1 FROM products WHERE category=? LIMIT 1').get(c.name))return res.status(409).json({error:'Move or reassign this category’s products before deleting it.'});db.prepare('DELETE FROM categories WHERE id=?').run(c.id);logAdmin(req,'category.deleted',c.name);res.json({ok:true})})
app.post('/api/admin/uploads', requireAuth, requireAdmin, (req,res)=>{
  const types={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif'}
  const ext=types[req.headers['content-type']]; if(!ext||!Buffer.isBuffer(req.body)||!req.body.length)return res.status(400).json({error:'Choose a JPG, PNG, WebP, or GIF image smaller than 8 MB.'})
  const filename=`${Date.now()}-${randomBytes(8).toString('hex')}.${ext}`; fs.writeFileSync(path.join(uploadsDir,filename),req.body,{flag:'wx'}); const url=`/uploads/${filename}`;logAdmin(req,'image.uploaded',filename);res.status(201).json({url})
})
app.patch('/api/admin/products/:id/stock', requireAuth, requireAdmin, (req, res) => {
  const parsed = z.object({ stock: z.number().int().min(0).max(100000), verified: z.boolean() }).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Enter a valid stock count.' })
  const result = db.prepare('UPDATE products SET stock=?,is_demo=? WHERE id=?').run(parsed.data.stock, parsed.data.verified ? 0 : 1, Number(req.params.id))
  if (!result.changes) return res.status(404).json({ error: 'Product not found.' })
  res.json({ ok: true })
})
app.post('/api/admin/products/enable-ordering', requireAuth, requireAdmin, (req,res)=>{
  const parsed=z.object({stock:z.number().int().min(1).max(100000)}).safeParse(req.body)
  if(!parsed.success)return res.status(400).json({error:'Choose a starting stock quantity from 1 to 100,000.'})
  const result=db.prepare("UPDATE products SET stock=?,is_demo=0 WHERE is_demo=1 AND category<>'Archived'").run(parsed.data.stock)
  logAdmin(req,'products.demo-ordering-enabled',`enabled ${result.changes} listings with stock ${parsed.data.stock}`)
  res.json({ok:true,updated:result.changes,stock:parsed.data.stock})
})
app.patch('/api/admin/orders/:code', requireAuth, requireAdmin, (req, res) => {
  const status = z.enum(['Pending','Confirmed','Processing','Shipped','Delivered','Cancelled','Out for Delivery']).safeParse(req.body.status)
  if (!status.success) return res.status(400).json({ error: 'Choose a valid order status.' })
  const tracking = z.string().trim().max(160).optional().safeParse(req.body.tracking_info)
  const result = db.prepare('UPDATE orders SET status=?,tracking_info=? WHERE order_code=?').run(status.data, tracking.success ? (tracking.data ?? db.prepare('SELECT tracking_info FROM orders WHERE order_code=?').get(req.params.code)?.tracking_info ?? '') : '', req.params.code)
  if (!result.changes) return res.status(404).json({ error: 'Order not found.' })
  logAdmin(req,'order.updated',`${req.params.code}: ${status.data}`)
  res.json({ ok: true })
})

app.get('/api/admin/orders/:code', requireAuth, requireAdmin, (req,res)=>{
  const order=db.prepare(`SELECT o.*,u.email customer_email FROM orders o JOIN users u ON u.id=o.user_id WHERE o.order_code=?`).get(req.params.code)
  if(!order)return res.status(404).json({error:'Order not found.'})
  order.items=db.prepare('SELECT product_name,quantity,unit_price_bdt,quantity*unit_price_bdt line_total_bdt FROM order_items WHERE order_id=?').all(order.id)
  res.json({order})
})
app.patch('/api/admin/orders/:code/payment', requireAuth, requireAdmin, (req,res)=>{const s=z.enum(['Pending','Paid','Failed','Refunded']).safeParse(req.body.status);if(!s.success)return res.status(400).json({error:'Choose a valid payment status.'});const r=db.prepare('UPDATE orders SET payment_status=? WHERE order_code=?').run(s.data,req.params.code);if(!r.changes)return res.status(404).json({error:'Order not found.'});logAdmin(req,'payment.status',`${req.params.code}: ${s.data}`);res.json({ok:true})})
app.patch('/api/admin/orders/:code/refund', requireAuth, requireAdmin, (req,res)=>{const s=z.enum(['None','Requested','Approved','Rejected','Refunded']).safeParse(req.body.status);if(!s.success)return res.status(400).json({error:'Choose a valid refund status.'});const r=db.prepare('UPDATE orders SET refund_status=?,payment_status=CASE WHEN ?="Refunded" THEN "Refunded" ELSE payment_status END WHERE order_code=?').run(s.data,s.data,req.params.code);if(!r.changes)return res.status(404).json({error:'Order not found.'});logAdmin(req,'order.refund',`${req.params.code}: ${s.data}`);res.json({ok:true})})
app.get('/api/admin/payments', requireAuth, requireAdmin, (_req,res)=>res.json({payments:db.prepare('SELECT order_code,customer_name,total_bdt,payment_method,payment_status,refund_status,status,created_at FROM orders ORDER BY id DESC').all()}))
app.get('/api/admin/customers', requireAuth, requireAdmin, (req,res)=>{const q=`%${String(req.query.q||'').trim().slice(0,80)}%`;const customers=db.prepare(`SELECT u.id,u.name,u.email,u.is_active,u.created_at,COUNT(DISTINCT o.id) order_count,COALESCE(SUM(CASE WHEN o.status<>'Cancelled' THEN o.total_bdt ELSE 0 END),0) total_spent FROM users u LEFT JOIN orders o ON o.user_id=u.id WHERE u.role='customer' AND (?='%%' OR u.name LIKE ? OR u.email LIKE ?) GROUP BY u.id ORDER BY u.id DESC`).all(q,q,q);res.json({customers})})
app.get('/api/admin/customers/:id', requireAuth, requireAdmin, (req,res)=>{const user=db.prepare("SELECT id,name,email,is_active,created_at FROM users WHERE id=? AND role='customer'").get(Number(req.params.id));if(!user)return res.status(404).json({error:'Customer not found.'});user.orders=db.prepare('SELECT order_code,status,total_bdt,created_at FROM orders WHERE user_id=? ORDER BY id DESC').all(user.id);user.addresses=db.prepare('SELECT * FROM customer_addresses WHERE user_id=? ORDER BY id DESC').all(user.id);res.json({customer:user})})
app.post('/api/admin/customers/:id/addresses', requireAuth, requireAdmin, (req,res)=>{const p=z.object({label:z.string().trim().min(2).max(60),recipient:z.string().trim().min(2).max(100),phone:z.string().trim().min(7).max(20),address:z.string().trim().min(8).max(400),delivery_area:z.enum(['inside_dhaka','outside_dhaka'])}).safeParse(req.body);if(!p.success)return res.status(400).json({error:'Check the address information.'});const r=db.prepare("INSERT INTO customer_addresses(user_id,label,recipient,phone,address,delivery_area) SELECT id,?,?,?,?,? FROM users WHERE id=? AND role='customer'").run(p.data.label,p.data.recipient,p.data.phone,p.data.address,p.data.delivery_area,Number(req.params.id));if(!r.changes)return res.status(404).json({error:'Customer not found.'});logAdmin(req,'customer.address.added',req.params.id);res.status(201).json({id:r.lastInsertRowid})})
app.patch('/api/admin/customers/:id', requireAuth, requireAdmin, (req,res)=>{const p=z.object({is_active:z.boolean()}).safeParse(req.body);if(!p.success)return res.status(400).json({error:'Invalid customer status.'});const r=db.prepare("UPDATE users SET is_active=? WHERE id=? AND role='customer'").run(p.data.is_active?1:0,Number(req.params.id));if(!r.changes)return res.status(404).json({error:'Customer not found.'});logAdmin(req,'customer.status',`${req.params.id}: ${p.data.is_active?'active':'blocked'}`);res.json({ok:true})})
app.put('/api/admin/customers/:id/addresses/:addressId', requireAuth, requireAdmin, (req,res)=>{const p=z.object({label:z.string().trim().min(2).max(60),recipient:z.string().trim().min(2).max(100),phone:z.string().trim().min(7).max(20),address:z.string().trim().min(8).max(400),delivery_area:z.enum(['inside_dhaka','outside_dhaka'])}).safeParse(req.body);if(!p.success)return res.status(400).json({error:'Check the address information.'});const r=db.prepare('UPDATE customer_addresses SET label=?,recipient=?,phone=?,address=?,delivery_area=? WHERE id=? AND user_id=?').run(p.data.label,p.data.recipient,p.data.phone,p.data.address,p.data.delivery_area,Number(req.params.addressId),Number(req.params.id));if(!r.changes)return res.status(404).json({error:'Saved address not found.'});logAdmin(req,'customer.address.updated',req.params.id);res.json({ok:true})})
app.delete('/api/admin/customers/:id/addresses/:addressId', requireAuth, requireAdmin, (req,res)=>{const r=db.prepare('DELETE FROM customer_addresses WHERE id=? AND user_id=?').run(Number(req.params.addressId),Number(req.params.id));if(!r.changes)return res.status(404).json({error:'Saved address not found.'});logAdmin(req,'customer.address.deleted',req.params.id);res.json({ok:true})})
app.get('/api/admin/coupons', requireAuth, requireAdmin, (_req,res)=>res.json({coupons:db.prepare('SELECT * FROM coupons ORDER BY id DESC').all()}))
app.post('/api/admin/coupons', requireAuth, requireAdmin, (req,res)=>{const p=z.object({code:z.string().trim().min(3).max(32).regex(/^[A-Za-z0-9_-]+$/),discount_type:z.enum(['percent','fixed']),discount_value:z.number().int().positive().max(100000),expires_at:z.string().max(30).nullable().optional(),min_order_bdt:z.number().int().min(0),usage_limit:z.number().int().positive().nullable().optional(),active:z.boolean()}).safeParse(req.body);if(!p.success)return res.status(400).json({error:'Check the coupon fields.'});if(p.data.discount_type==='percent'&&p.data.discount_value>100)return res.status(400).json({error:'Percentage discount cannot exceed 100.'});try{const r=db.prepare('INSERT INTO coupons(code,discount_type,discount_value,expires_at,min_order_bdt,usage_limit,active) VALUES(?,?,?,?,?,?,?)').run(p.data.code.toUpperCase(),p.data.discount_type,p.data.discount_value,p.data.expires_at||null,p.data.min_order_bdt,p.data.usage_limit||null,p.data.active?1:0);logAdmin(req,'coupon.created',p.data.code);res.status(201).json({coupon:db.prepare('SELECT * FROM coupons WHERE id=?').get(r.lastInsertRowid)})}catch{res.status(409).json({error:'That coupon code already exists.'})}})
app.put('/api/admin/coupons/:id', requireAuth, requireAdmin, (req,res)=>{const p=z.object({code:z.string().trim().min(3).max(32).regex(/^[A-Za-z0-9_-]+$/),discount_type:z.enum(['percent','fixed']),discount_value:z.number().int().positive().max(100000),expires_at:z.string().max(30).nullable().optional(),min_order_bdt:z.number().int().min(0),usage_limit:z.number().int().positive().nullable().optional(),active:z.boolean()}).safeParse(req.body);if(!p.success)return res.status(400).json({error:'Check the coupon fields.'});if(p.data.discount_type==='percent'&&p.data.discount_value>100)return res.status(400).json({error:'Percentage discount cannot exceed 100.'});try{const r=db.prepare('UPDATE coupons SET code=?,discount_type=?,discount_value=?,expires_at=?,min_order_bdt=?,usage_limit=?,active=? WHERE id=?').run(p.data.code.toUpperCase(),p.data.discount_type,p.data.discount_value,p.data.expires_at||null,p.data.min_order_bdt,p.data.usage_limit||null,p.data.active?1:0,Number(req.params.id));if(!r.changes)return res.status(404).json({error:'Coupon not found.'});logAdmin(req,'coupon.updated',p.data.code);res.json({ok:true})}catch{res.status(409).json({error:'That coupon code already exists.'})}})
app.delete('/api/admin/coupons/:id', requireAuth, requireAdmin, (req,res)=>{const c=db.prepare('SELECT code FROM coupons WHERE id=?').get(Number(req.params.id));if(!c)return res.status(404).json({error:'Coupon not found.'});db.prepare('DELETE FROM coupons WHERE id=?').run(Number(req.params.id));logAdmin(req,'coupon.deleted',c.code);res.json({ok:true})})
app.get('/api/admin/reviews', requireAuth, requireAdmin, (_req,res)=>res.json({reviews:db.prepare('SELECT r.*,p.name product_name FROM reviews r LEFT JOIN products p ON p.id=r.product_id ORDER BY r.id DESC').all()}))
app.patch('/api/admin/reviews/:id', requireAuth, requireAdmin, (req,res)=>{const p=z.object({status:z.enum(['pending','approved','hidden']),response:z.string().max(2000).optional()}).safeParse(req.body);if(!p.success)return res.status(400).json({error:'Check the review response and status.'});const r=db.prepare('UPDATE reviews SET status=?,response=? WHERE id=?').run(p.data.status,p.data.response||'',Number(req.params.id));if(!r.changes)return res.status(404).json({error:'Review not found.'});logAdmin(req,'review.moderated',`${req.params.id}: ${p.data.status}`);res.json({ok:true})})
app.get('/api/admin/settings', requireAuth, requireAdmin, (_req,res)=>res.json({settings:Object.fromEntries(db.prepare('SELECT key,value FROM store_settings').all().map(x=>[x.key,x.value])),featured:db.prepare('SELECT id,name,is_featured FROM products ORDER BY is_featured DESC,name').all()}))
app.patch('/api/admin/settings', requireAuth, requireAdmin, (req,res)=>{const allowed=['store_name','contact_email','contact_phone','about','return_policy','shipping_inside_dhaka','shipping_outside_dhaka','homepage_banner'];const values=z.record(z.string().max(4000)).safeParse(req.body.settings);if(!values.success||Object.keys(values.data).some(k=>!allowed.includes(k)))return res.status(400).json({error:'Some store settings are invalid.'});for(const k of ['shipping_inside_dhaka','shipping_outside_dhaka'])if(values.data[k]!==undefined&&(!/^\d{1,6}$/.test(values.data[k])))return res.status(400).json({error:'Delivery charges must be whole numbers in BDT.'});if(values.data.contact_email!==undefined&&!z.string().email().safeParse(values.data.contact_email).success)return res.status(400).json({error:'Enter a valid store contact email.'});const save=db.prepare('INSERT INTO store_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');db.transaction(()=>Object.entries(values.data).forEach(([k,v])=>save.run(k,v)))();logAdmin(req,'settings.updated',Object.keys(values.data).join(', '));res.json({ok:true})})
app.patch('/api/admin/products/:id/featured', requireAuth, requireAdmin, (req,res)=>{const p=z.object({is_featured:z.boolean()}).safeParse(req.body);if(!p.success)return res.status(400).json({error:'Invalid featured status.'});const r=db.prepare('UPDATE products SET is_featured=? WHERE id=?').run(p.data.is_featured?1:0,Number(req.params.id));if(!r.changes)return res.status(404).json({error:'Product not found.'});logAdmin(req,'product.featured',`${req.params.id}: ${p.data.is_featured}`);res.json({ok:true})})
app.get('/api/admin/activity', requireAuth, requireAdmin, (_req,res)=>res.json({activity:db.prepare('SELECT a.*,u.name admin_name FROM admin_activity a LEFT JOIN users u ON u.id=a.admin_id ORDER BY a.id DESC LIMIT 200').all()}))
app.get('/api/admin/accounts', requireAuth, requireAdmin, (_req,res)=>res.json({accounts:db.prepare("SELECT u.id,u.name,u.email,u.is_active,u.created_at,COALESCE(a.role,'catalog') admin_role FROM users u LEFT JOIN admin_roles a ON a.user_id=u.id WHERE u.role='admin' ORDER BY u.id").all()}))
app.post('/api/admin/accounts', requireAuth, requireAdmin, async (req,res)=>{const p=z.object({name:z.string().trim().min(2).max(80),email:z.string().email().max(200),password:z.string().min(12).max(100),admin_role:z.enum(['owner','catalog','orders','support','marketing']).default('catalog')}).safeParse(req.body);if(!p.success)return res.status(400).json({error:'Enter name, email, password of at least 12 characters, and a valid role.'});try{const hash=await bcrypt.hash(p.data.password,12);const r=db.prepare("INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,'admin')").run(p.data.name,p.data.email,hash);db.prepare('INSERT INTO admin_roles(user_id,role) VALUES(?,?)').run(r.lastInsertRowid,p.data.admin_role);logAdmin(req,'admin.created',`${p.data.email}: ${p.data.admin_role}`);res.status(201).json({account:userById.get(r.lastInsertRowid)})}catch{res.status(409).json({error:'That email already has an account.'})}})
app.patch('/api/admin/accounts/:id', requireAuth, requireAdmin, (req,res)=>{if(Number(req.params.id)===Number(req.user.sub))return res.status(400).json({error:'Use account settings to change your own password; you cannot deactivate your current session.'});const p=z.object({is_active:z.boolean().optional(),admin_role:z.enum(['owner','catalog','orders','support','marketing']).optional()}).safeParse(req.body);if(!p.success||(!p.data.is_active&& !p.data.admin_role))return res.status(400).json({error:'Invalid admin account changes.'});const id=Number(req.params.id);const u=db.prepare("SELECT id FROM users WHERE id=? AND role='admin'").get(id);if(!u)return res.status(404).json({error:'Admin account not found.'});if(p.data.is_active!==undefined)db.prepare('UPDATE users SET is_active=? WHERE id=?').run(p.data.is_active?1:0,id);if(p.data.admin_role)db.prepare('INSERT INTO admin_roles(user_id,role) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET role=excluded.role').run(id,p.data.admin_role);logAdmin(req,'admin.account.updated',`${id}: ${JSON.stringify(p.data)}`);res.json({ok:true})})
app.post('/api/admin/password', requireAuth, requireAdmin, async (req,res)=>{const p=z.object({current_password:z.string().min(8).max(100),new_password:z.string().min(12).max(100)}).safeParse(req.body);if(!p.success)return res.status(400).json({error:'New admin passwords must be at least 12 characters.'});const u=db.prepare('SELECT password_hash FROM users WHERE id=?').get(Number(req.user.sub));if(!u||!(await bcrypt.compare(p.data.current_password,u.password_hash)))return res.status(400).json({error:'Current password is incorrect.'});db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(await bcrypt.hash(p.data.new_password,12),Number(req.user.sub));logAdmin(req,'admin.password.changed');res.json({ok:true})})

app.get('/api/admin/returns', requireAuth, requireAdmin, (_req,res)=>res.json({returns:db.prepare(`SELECT r.*,o.order_code,o.total_bdt,o.status order_status,u.name customer_name,u.email FROM return_requests r JOIN orders o ON o.id=r.order_id JOIN users u ON u.id=r.user_id ORDER BY r.id DESC`).all()}))
app.patch('/api/admin/returns/:id', requireAuth, requireAdmin, (req,res)=>{const p=z.object({status:z.enum(['Requested','Approved','Rejected','Received','Refunded']),admin_note:z.string().max(1000).optional().default('')}).safeParse(req.body);if(!p.success)return res.status(400).json({error:'Check return status and note.'});const r=db.prepare('UPDATE return_requests SET status=?,admin_note=? WHERE id=?').run(p.data.status,p.data.admin_note,Number(req.params.id));if(!r.changes)return res.status(404).json({error:'Return request not found.'});if(p.data.status==='Refunded')db.prepare("UPDATE orders SET refund_status='Refunded',payment_status='Refunded' WHERE id=(SELECT order_id FROM return_requests WHERE id=?)").run(Number(req.params.id));logAdmin(req,'return.updated',`${req.params.id}: ${p.data.status}`);res.json({ok:true})})

app.use((err, _req, res, _next) => {
  console.error(err)
  res.status(500).json({ error: 'Something went wrong. Please try again.' })
})
app.listen(port, () => console.log(`GizmoNest API ready at http://localhost:${port}`))
