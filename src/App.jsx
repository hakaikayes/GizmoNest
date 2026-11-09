import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, AudioLines, BadgeCheck, Check, ChevronDown, Headphones, Heart, LogOut, Menu, Minus, PackageCheck, Plus, Search, ShieldCheck, ShoppingBag, Sparkles, Truck, UserRound, X } from 'lucide-react'
import AdminDashboard from './AdminDashboard.jsx'

const taka = (n) => `৳${Number(n || 0).toLocaleString('en-BD')}`
const exactProductPhotos = {
  'Soundcore R50i TWS Earbuds': 'https://www.startech.com.bd/image/cache/catalog/earbuds/anker/soundcore-r50i/soundcore-r50i-blue-01-500x500.webp',
  'Soundcore Select 4 Go Bluetooth Speaker': 'https://gadgetplusbangladesh.com/api/public/images/1785397726793-fl9uop.png',
  'Weofly Active 2 Smartwatch': 'https://gadgetplusbangladesh.com/api/public/images/1784961005178-e956sb.jpg',
  'Anker Zolo 30W PD 3.0 Charger with USB-C Cable': 'https://gadgetplusbangladesh.com/api/public/images/1784784780423-vhmbmf.jpg',
  'CMF by Nothing Neckband Pro 50dB ANC': 'https://gearpicker.com.bd/storage/product/cmf-pro-2025-01-25-6794a1401f2b2.jpg',
  'Soundcore Q11i Bluetooth Headphones': 'https://cdn.shopify.com/s/files/1/0668/2837/0083/files/A3005ZA1_ProductImage_01_3840x_7b84b8c3-4788-434f-95a4-df9a20bff818.png?v=1766268332',
  'Soundcore Boom Go 3i Portable Bluetooth Speaker': 'https://down-my.img.susercontent.com/file/cn-11134208-820l4-ml60dwi5wge812',
  'QCY PB20A 20000mAh 45W PD Power Bank': 'https://gadgetplusbangladesh.com/api/public/images/1792756701848-wcoe2g.jpg',
  'Soundcore Liberty 4 NC': 'https://cdn.shopify.com/s/files/1/0519/2355/0368/files/3947Z11-Photoroom.png?v=1756458234',
  'AULA F75 75% Mechanical Keyboard': 'https://www.sillicons.com/cdn/shop/files/1_c5eddd9a-c1fb-4b26-8548-d113e4d1c63a_1024x1024.jpg?v=1715922411',
}
const productPhoto = (product) => product.image_url || exactProductPhotos[product.name]
const fallbackProductPhoto = (product) => {
  const safe = (value) => String(value || '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char])
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 900"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#f7f8f5"/><stop offset="1" stop-color="#e5eadf"/></linearGradient></defs><rect width="900" height="900" rx="40" fill="url(#g)"/><circle cx="450" cy="350" r="155" fill="#d5ef74" opacity=".45"/><rect x="340" y="300" width="220" height="145" rx="24" fill="#294538" opacity=".92"/><text x="450" y="625" text-anchor="middle" font-family="Arial,sans-serif" font-size="34" font-weight="700" fill="#294538">${safe(product.brand)}</text><text x="450" y="675" text-anchor="middle" font-family="Arial,sans-serif" font-size="24" fill="#56645a">${safe(product.name).slice(0,48)}</text><text x="450" y="735" text-anchor="middle" font-family="Arial,sans-serif" font-size="18" fill="#7b867c">Product photo unavailable</text></svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}
function ProductImage({ product, alt = '', ...props }) {
  return <img {...props} src={productPhoto(product)} alt={alt || product.name} referrerPolicy="no-referrer" onError={(event) => {
    const image = event.currentTarget
    if (!image.dataset.proxyAttempted && /^https?:\/\//i.test(image.currentSrc || image.src)) {
      image.dataset.proxyAttempted = '1'
      image.src = `https://images.weserv.nl/?url=${encodeURIComponent(image.currentSrc || image.src)}&w=1000&h=1000&fit=contain`
      return
    }
    image.onerror = null
    image.src = fallbackProductPhoto(product)
  }}/>
}
const categories = ['All', 'Audio', 'Wearables', 'Gaming', 'Cameras', 'Keyboards', 'Power']
const api = async (url, options = {}) => {
  const res = await fetch(url, { credentials: 'include', ...options, headers: { 'Content-Type': 'application/json', ...options.headers } })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || 'Something went wrong')
  return body
}

function App() {
  const [route, setRoute] = useState(window.location.pathname)
  const [user, setUser] = useState(null)
  const [authReady, setAuthReady] = useState(false)
  const [products, setProducts] = useState([])
  const [availableCategories, setAvailableCategories] = useState(categories)
  const [storeSettings, setStoreSettings] = useState({})
  const [myOrders, setMyOrders] = useState([])
  const [myOrdersOpen, setMyOrdersOpen] = useState(false)
  const [cart, setCart] = useState(() => JSON.parse(localStorage.getItem('gn_cart') || '{}'))
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('All')
  const [brand, setBrand] = useState('All')
  const [sort, setSort] = useState('featured')
  const [cartOpen, setCartOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)

  const go = (to) => { history.pushState({}, '', to); setRoute(to); setMenuOpen(false); window.scrollTo(0, 0) }
  useEffect(() => {
    const pop = () => setRoute(window.location.pathname)
    window.addEventListener('popstate', pop)
    return () => window.removeEventListener('popstate', pop)
  }, [])
  useEffect(() => { api('/api/auth/me').then((x) => setUser(x.user)).catch(() => {}).finally(() => setAuthReady(true)) }, [])
  useEffect(() => { api('/api/products').then((x) => setProducts(x.products)).catch((e) => setNotice(e.message)) }, [])
  useEffect(() => { api('/api/categories').then((x) => setAvailableCategories(['All', ...x.categories])).catch(() => {}); api('/api/storefront/settings').then((x) => setStoreSettings(x.settings)).catch(() => {}) }, [])
  useEffect(() => { localStorage.setItem('gn_cart', JSON.stringify(cart)) }, [cart])

  const brands = useMemo(() => ['All', ...new Set(products.map((p) => p.brand).filter(Boolean).sort((a,b) => a.localeCompare(b)))], [products])
  const shown = useMemo(() => {
    const list = products.filter((p) => !['Phones', 'PC Power'].includes(p.category) && (category === 'All' || p.category === category) && (brand === 'All' || p.brand === brand) && `${p.name} ${p.brand} ${p.category}`.toLowerCase().includes(query.trim().toLowerCase()))
    return list.sort((a,b) => sort === 'price-low' ? a.price_bdt-b.price_bdt : sort === 'price-high' ? b.price_bdt-a.price_bdt : sort === 'name' ? a.name.localeCompare(b.name) : sort === 'brand' ? a.brand.localeCompare(b.brand) || a.name.localeCompare(b.name) : Number(Boolean(b.is_featured))-Number(Boolean(a.is_featured)) || b.id-a.id)
  }, [products, category, brand, query, sort])
  const cartProducts = products.filter((p) => cart[p.id])
  const count = Object.values(cart).reduce((a, b) => a + b, 0)
  const subtotal = cartProducts.reduce((sum, p) => sum + p.price_bdt * cart[p.id], 0)
  const updateCart = (id, delta) => setCart((old) => { const next = { ...old, [id]: (old[id] || 0) + delta }; if (next[id] <= 0) delete next[id]; return next })
  const flash = (message) => { setNotice(message); setTimeout(() => setNotice(''), 3500) }
  const openMyOrders = async () => { if(!user||user.role!=='customer'){flash('Sign in to view customer orders.');return}try{setMyOrders((await api('/api/orders/mine')).orders);setMyOrdersOpen(true)}catch(e){flash(e.message)} }
  const signOut = async () => { await api('/api/auth/logout', { method: 'POST' }).catch(() => {}); setUser(null); go('/') }
  const detailMatch = route.match(/^\/product\/(\d+)$/)
  const pageProduct = detailMatch ? products.find((p) => String(p.id) === detailMatch[1]) : null

  if (route === '/admin' || route.startsWith('/admin/')) {
    if (!authReady) return <div className="loading">Opening your workspace…</div>
    if (route === '/admin/login') return <AuthPage mode="admin" onSuccess={(u) => { setUser(u); go('/admin') }} go={go} />
    if (user?.role !== 'admin') return <AuthPage mode="admin" onSuccess={(u) => { setUser(u); go('/admin') }} go={go} />
    return <AdminPage user={user} signOut={signOut} flash={flash} />
  }
  if (route === '/login' || route === '/register') return <AuthPage mode={route === '/register' ? 'register' : 'customer'} onSuccess={(u) => { setUser(u); go('/') }} go={go} />

  return <div className="site-shell">
    <div className="announcement"><Sparkles size={14}/> {storeSettings.homepage_banner || 'Thoughtful tech. Music for every moment.'} <span>Free delivery on orders over ৳5,000</span></div>
    <header className="topbar">
      <button className="mobile-menu icon-button" onClick={() => setMenuOpen(!menuOpen)} aria-label="Toggle menu"><Menu size={21}/></button>
      <button className="wordmark" onClick={() => go('/')}><span className="logo-mark"><AudioLines size={22}/></span><span>gizmo<span className="wordmark-accent">nest</span><small>YOUR NEST FOR NEXT-GEN GADGETS</small></span></button>
      <nav className={menuOpen ? 'main-nav open' : 'main-nav'}><a href="#shop" onClick={() => go('/')}>Shop</a><a href="#shop" onClick={() => { setCategory('Audio'); go('/') }}>Audio & music</a><a href="#promise">Our promise</a></nav>
      <label className="searchbox"><Search size={17}/><input placeholder="Search gadgets, brands…" value={query} onChange={(e) => { setQuery(e.target.value); if (route !== '/') go('/') }}/><kbd>/</kbd></label>
      <div className="header-actions"><button className="icon-button" aria-label="Wishlist" onClick={() => flash('Sign in to keep your wishlist across devices.')}><Heart size={19}/></button><button className="cart-button" onClick={() => setCartOpen(true)}><ShoppingBag size={18}/><span>Bag</span><b>{count}</b></button>{user ? <button className="account-button" onClick={signOut}><UserRound size={17}/><span>{user.name.split(' ')[0]}</span><LogOut size={15}/></button> : <button className="sign-link" onClick={() => go('/login')}>Sign in</button>}</div>
    </header>
    <main>{route.startsWith('/product/') ? (pageProduct ? <ProductPage product={pageProduct} user={user} returnPolicy={storeSettings.return_policy} onBack={() => go('/')} onAdd={() => { updateCart(pageProduct.id, 1); setCartOpen(true) }}/> : <div className="product-page-loading">{products.length ? 'Product not found.' : 'Loading product details…'} <button className="text-button" onClick={() => go('/')}>Back to products</button></div>) : <>
      <section className="hero"><div className="hero-copy"><div className="eyebrow"><span/> THE EVERYDAY TECH EDIT</div><h1>Good things<br/>sound <em>better.</em></h1><p>Find the gear that fits your life: thoughtful audio, considered tech and little upgrades that make every day click.</p><button className="primary-button" onClick={() => document.getElementById('shop')?.scrollIntoView({ behavior: 'smooth' })}>Explore the collection <ArrowRight size={17}/></button><div className="hero-proof"><div className="proof-avatars"><i>R</i><i>M</i><i>S</i></div><span><strong>4.9/5</strong> loved by gadget people</span></div></div><div className="hero-art"><div className="hero-glow"/><img src="https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=1200&q=90" alt="Premium over-ear headphones"/><div className="floating-note"><span className="note-dot"/><div><b>Sound that stays with you</b><small>Meet your next everyday favorite</small></div><ArrowRight size={17}/></div><div className="hero-index">01 / 04 <span>—</span> THE SOUND EDIT</div></div></section>
      <section className="benefit-strip" id="promise"><div><Truck/><span><b>Delivery, made easy</b><small>Across Bangladesh</small></span></div><div><ShieldCheck/><span><b>Genuine, always</b><small>Carefully sourced gear</small></span></div><div><BadgeCheck/><span><b>Warranty you can trust</b><small>Support after checkout</small></span></div><div><Headphones/><span><b>Real humans, real help</b><small>Here when you need us</small></span></div><div><BadgeCheck/><span><b>7-day returns</b><small>Return requests within 7 days</small></span></div></section>
      <section className="shop-section" id="shop"><div className="section-heading"><div><div className="eyebrow">THE GIZMONEST COLLECTION</div><h2>Find your next <em>favorite.</em></h2></div><div className="collection-side">A good setup feels like you.<br/>Start with something you’ll use every day.</div></div>
        <div className="category-row">{availableCategories.map((c) => <button key={c} className={c === category ? 'category-chip active' : 'category-chip'} onClick={() => setCategory(c)}>{c}</button>)}</div>
        <div className="catalog-controls"><label>Brand<select value={brand} onChange={(e) => setBrand(e.target.value)}>{brands.map((b) => <option key={b}>{b}</option>)}</select></label><label>Sort by<select value={sort} onChange={(e) => setSort(e.target.value)}><option value="featured">Featured</option><option value="price-low">Price: low to high</option><option value="price-high">Price: high to low</option><option value="name">Name: A–Z</option><option value="brand">Brand</option></select></label><span>{shown.length} products</span></div>
        {shown.length > 0 ? (
          <div className="product-grid">
            {shown.map((p, i) => (
              <article className="product-card" key={p.id} role="button" tabIndex={0} aria-label={`View details for ${p.name}`} onClick={() => go(`/product/${p.id}`)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(`/product/${p.id}`) } }}>
                <div className="product-visual" style={{ '--delay': `${i * 45}ms` }}>
                  <ProductImage product={p} alt={p.name} loading="lazy"/>
                  <span className="product-tag">{p.is_demo ? 'SAMPLE' : p.stock > 0 ? 'IN STOCK' : 'SOLD OUT'}</span>
                  <button className="wish-button" aria-label="Add to wishlist" onClick={(e) => { e.stopPropagation(); flash('Sign in to save your favorite gear.') }}><Heart size={17}/></button>
                  <button className="quick-add" onClick={(e) => { e.stopPropagation(); updateCart(p.id, 1); setCartOpen(true) }}><Plus size={17}/><span>Add to bag</span></button>
                </div>
                <div className="product-meta"><span>{p.brand} <i>·</i> {p.category}</span><span className="rating">★ 4.8</span></div>
                <h3>{p.name}</h3>
                <div className="product-price"><b>{p.price_bdt ? taka(p.price_bdt) : 'Price TBA'}</b>{p.compare_at_bdt > p.price_bdt && <del>{taka(p.compare_at_bdt)}</del>}</div>
                {p.is_demo && <small className="demo-note">Demo listing · stock not verified</small>}
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-state"><Search/><h3>No gadgets found</h3><p>Try another search or choose a different category.</p><button className="text-button" onClick={() => { setQuery(''); setCategory('All'); setBrand('All'); setSort('featured') }}>Clear filters</button></div>
        )}
      </section>
      <section className="music-banner"><div className="music-symbol"><AudioLines size={38}/></div><div><div className="eyebrow">FOR THE SOUND-OBSESSED</div><h2>Make room for <em>great sound.</em></h2><p>Headphones, speakers and audio essentials for wherever the day takes you.</p></div><button className="dark-button" onClick={() => { setCategory('Audio'); document.getElementById('shop')?.scrollIntoView({ behavior: 'smooth' }) }}>Explore audio <ArrowRight size={16}/></button><div className="sound-wave">〰</div></section>
    </>}</main>
    <footer><button className="wordmark footer-mark" onClick={() => go('/')}><span className="logo-mark"><AudioLines size={20}/></span><span>{storeSettings.store_name||'gizmo'}<span className="wordmark-accent">{storeSettings.store_name?'':'nest'}</span><small>YOUR NEST FOR NEXT-GEN GADGETS</small></span></button><p>{storeSettings.about||'Good gear, chosen with care. Built for everyday life in Bangladesh.'} {storeSettings.contact_phone&&` · ${storeSettings.contact_phone}`}</p><div><a href={`mailto:${storeSettings.contact_email||'hello@gizmonest.example'}`}>Contact</a>{user?.role==='customer'&&<button onClick={openMyOrders}>My orders</button>}<button onClick={() => go('/admin/login')}>Admin portal</button><span>© 2026 GizmoNest</span></div></footer>
    {cartOpen && <><button className="drawer-scrim" aria-label="Close cart" onClick={() => setCartOpen(false)}/><aside className="cart-drawer"><div className="drawer-head"><div><div className="eyebrow">YOUR BAG</div><h2>Good choice.</h2></div><button className="icon-button" onClick={() => setCartOpen(false)}><X/></button></div>{cartProducts.length ? <><div className="cart-lines">{cartProducts.map((p) => <div className="cart-line" key={p.id}><ProductImage product={p} alt=""/><div className="cart-line-info"><b>{p.name}</b><small>{taka(p.price_bdt)}</small><div className="qty"><button onClick={() => updateCart(p.id, -1)}><Minus size={13}/></button><span>{cart[p.id]}</span><button onClick={() => updateCart(p.id, 1)}><Plus size={13}/></button></div></div><strong>{taka(p.price_bdt * cart[p.id])}</strong></div>)}</div><div className="checkout-box"><div><span>Subtotal</span><b>{taka(subtotal)}</b></div><small>Delivery calculated at checkout. Cash on delivery is available.</small>{!user ? <button className="primary-button full-button" onClick={() => { setCartOpen(false); go('/login') }}>Sign in to continue <ArrowRight size={16}/></button> : user.role === 'admin' ? <p className="inline-note">Admin accounts can’t place customer orders.</p> : <CheckoutForm cart={cart} user={user} subtotal={subtotal} shippingInside={storeSettings.shipping_inside_dhaka===undefined?80:Number(storeSettings.shipping_inside_dhaka)} shippingOutside={storeSettings.shipping_outside_dhaka===undefined?150:Number(storeSettings.shipping_outside_dhaka)} onDone={(message) => { setCart({}); setCartOpen(false); flash(message) }}/>}</div></> : <div className="cart-empty"><ShoppingBag size={32}/><h3>Your bag is taking a breather.</h3><p>Find something that makes your day a little better.</p><button className="primary-button" onClick={() => setCartOpen(false)}>Keep browsing <ArrowRight size={16}/></button></div>}</aside></>}
    {myOrdersOpen&&<CustomerOrdersPanel orders={myOrders} onClose={()=>setMyOrdersOpen(false)} onChanged={async()=>{setMyOrders((await api('/api/orders/mine')).orders);flash('Return request submitted.')}}/>}
    {notice && <div className="toast"><Check size={17}/>{notice}<button onClick={() => setNotice('')}><X size={15}/></button></div>}
  </div>
}

function ProductPage({ product, user, returnPolicy, onBack, onAdd }) {
  const [photos,setPhotos]=useState([product.image_url].filter(Boolean))
  const [activePhoto,setActivePhoto]=useState(product.image_url)
  const [reviews,setReviews]=useState([])
  const [review,setReview]=useState({rating:5,body:''})
  useEffect(()=>{api(`/api/products/${product.id}/images`).then(x=>{const list=x.images.length?x.images:[product.image_url].filter(Boolean);setPhotos(list);setActivePhoto(list[0]||'')}).catch(()=>{})},[product.id])
  useEffect(()=>{api(`/api/products/${product.id}/reviews`).then(x=>setReviews(x.reviews)).catch(()=>{})},[product.id])
  const description = product.description || 'More product details will be added soon.'
  const source = description.match(/Source:\s*(https?:\/\/\S+)/)?.[1]
  const withoutSource = source ? description.replace(/\s*Source:\s*https?:\/\/\S+/, '') : description
  const [about, specText] = withoutSource.split(/\n\s*Specifications:\s*\n/i)
  const specs = (specText || '').split('\n').map((line) => line.match(/^\s*([^:]+):\s*(.+?)\s*$/)).filter(Boolean)
  return <section className="product-page"><button className="product-back" onClick={onBack}>← Back to all products</button><div className="product-page-layout"><div><div className="product-page-photo"><img src={activePhoto||product.image_url} alt={product.name} referrerPolicy="no-referrer" onError={e=>{e.currentTarget.onerror=null;e.currentTarget.src=fallbackProductPhoto(product)}}/><span className="product-tag">{product.is_demo ? 'SAMPLE LISTING' : product.stock > 0 ? 'IN STOCK' : 'SOLD OUT'}</span></div>{photos.length>1&&<div className="product-gallery">{photos.map((url,i)=><button key={`${url}-${i}`} className={activePhoto===url?'active':''} onClick={()=>setActivePhoto(url)}><img src={url} alt={`${product.name} photo ${i+1}`} referrerPolicy="no-referrer"/></button>)}</div>}</div><div className="product-page-info"><div className="eyebrow">{product.brand} · {product.category}</div><h1>{product.name}</h1><div className="detail-price"><b>{product.price_bdt ? taka(product.price_bdt) : 'Price TBA'}</b>{product.compare_at_bdt > product.price_bdt && <del>{taka(product.compare_at_bdt)}</del>}</div><div className="detail-description"><h3>Product description</h3><p>{about}</p></div><div className="return-policy"><strong>7-day return policy</strong><span>{returnPolicy||'Contact GizmoNest within 7 days of delivery to request a return. Eligibility and item condition requirements apply.'}</span></div>{specs.length > 0 && <div className="detail-specs"><h3>Full specifications</h3><dl>{specs.map(([, key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl></div>}{product.is_demo ? <div className="detail-stock"><ShieldCheck size={17}/><span><b>Sample listing</b><small>Price and stock have not been verified. This item cannot be ordered yet.</small></span></div> : <div className="detail-stock"><PackageCheck size={17}/><span><b>{product.stock > 0 ? `${product.stock} in stock` : 'Currently unavailable'}</b><small>Contact us to confirm delivery and warranty details.</small></span></div>}{source && <a className="source-link" href={source} target="_blank" rel="noreferrer">Product information source <ArrowRight size={14}/></a>}<button className="primary-button full-button" onClick={onAdd} disabled={product.is_demo || product.stock < 1}>{product.is_demo || product.stock < 1 ? 'Not available to order' : 'Add to bag'} <ShoppingBag size={16}/></button></div></div><section className="product-reviews"><h2>Customer reviews</h2>{reviews.length?reviews.map((r,i)=><article key={i}><b>{r.customer_name} · {'★'.repeat(r.rating)}</b><p>{r.body}</p>{r.response&&<small>GizmoNest: {r.response}</small>}</article>):<p>No approved reviews yet.</p>}{user?.role==='customer'&&<form onSubmit={async e=>{e.preventDefault();try{const x=await api(`/api/products/${product.id}/reviews`,{method:'POST',body:JSON.stringify(review)});setReview({rating:5,body:''});alert(x.message)}catch(err){alert(err.message)}}}><label>Rating<select value={review.rating} onChange={e=>setReview({...review,rating:Number(e.target.value)})}><option value={5}>5 stars</option><option value={4}>4 stars</option><option value={3}>3 stars</option><option value={2}>2 stars</option><option value={1}>1 star</option></select></label><label>Your review<textarea required minLength="5" value={review.body} onChange={e=>setReview({...review,body:e.target.value})}/></label><button className="primary-button">Submit review</button></form>}</section></section>
}
function AuthPage({ mode, onSuccess, go }) {
  const admin = mode === 'admin'
  const register = mode === 'register'
  const [form, setForm] = useState({ name: '', email: '', password: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError('')
    try {
      const data = await api(register ? '/api/auth/register' : '/api/auth/login', { method: 'POST', body: JSON.stringify(form) })
      if (admin && data.user.role !== 'admin') { await api('/api/auth/logout', { method: 'POST' }); throw new Error('This account does not have admin access.') }
      if (!admin && data.user.role !== 'customer') { await api('/api/auth/logout', { method: 'POST' }); throw new Error('Please use the admin portal for this account.') }
      onSuccess(data.user)
    } catch (e2) { setError(e2.message) } finally { setBusy(false) }
  }
  return <div className="auth-layout"><div className="auth-image"><button className="wordmark auth-wordmark" onClick={() => go('/')}><span className="logo-mark"><AudioLines size={22}/></span><span>gizmo<span className="wordmark-accent">nest</span><small>YOUR NEST FOR NEXT-GEN GADGETS</small></span></button><div className="auth-image-copy"><div className="eyebrow">A LITTLE MORE YOU</div><h1>Your next<br/>favorite thing<br/>is <em>closer.</em></h1><p>Come on in. The good stuff is right this way.</p></div><div className="auth-image-foot">GizmoNest · Thoughtful tech for everyday life</div></div><div className="auth-panel"><button className="back-home" onClick={() => go('/')}>← Back to the store</button><div className="auth-form-wrap"><span className="auth-icon">{admin ? <ShieldCheck/> : <UserRound/>}</span><div className="eyebrow">{admin ? 'STORE MANAGEMENT' : 'YOUR GIZMONEST ACCOUNT'}</div><h2>{admin ? 'Admin sign in' : register ? 'Make yourself at home.' : 'Welcome back.'}</h2><p>{admin ? 'Sign in to manage products, orders and store settings.' : register ? 'Create an account to keep your favorite gear close.' : 'Sign in to pick up right where you left off.'}</p><form onSubmit={submit}>{register && <label>Your name<input required minLength="2" autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Samira Rahman"/></label>}<label>Email address<input required type="email" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="you@example.com"/></label><label>Password<input required minLength="8" type="password" autoComplete={register ? 'new-password' : 'current-password'} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="At least 8 characters"/></label>{error && <div className="form-error">{error}</div>}<button className="primary-button full-button" disabled={busy}>{busy ? 'One moment…' : admin ? 'Enter admin dashboard' : register ? 'Create account' : 'Sign in'}<ArrowRight size={17}/></button></form>{!admin && <p className="auth-switch">{register ? 'Already have an account?' : 'New to GizmoNest?'} <button onClick={() => go(register ? '/login' : '/register')}>{register ? 'Sign in' : 'Create an account'}</button></p>}<small className="secure-caption"><ShieldCheck size={14}/> Your account is protected with encrypted credentials.</small></div><button className="admin-shortcut" onClick={() => go(admin ? '/login' : '/admin/login')}>{admin ? '← Customer store' : 'Store team? Admin sign in'}</button></div></div>
}

function CheckoutForm({ cart, user, subtotal, shippingInside, shippingOutside, onDone }) {
  const [details, setDetails] = useState({ customerName: user.name, phone: '', address: '', deliveryArea: 'inside_dhaka' })
  const [couponCode,setCouponCode]=useState('')
  const [coupon,setCoupon]=useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e) => {
    e.preventDefault(); setError(''); setBusy(true)
    try {
      const result = await api('/api/orders', { method: 'POST', body: JSON.stringify({ ...details, coupon_code:coupon?.code||'', items: Object.entries(cart).map(([productId, quantity]) => ({ productId: Number(productId), quantity })) }) })
      onDone(`Order ${result.order.order_code} placed. We’ll confirm it soon.`)
    } catch (e2) { setError(e2.message) } finally { setBusy(false) }
  }
  return <form className="checkout-form" onSubmit={submit}><label>Full name<input required value={details.customerName} onChange={(e) => setDetails({ ...details, customerName: e.target.value })}/></label><label>Phone number<input required value={details.phone} onChange={(e) => setDetails({ ...details, phone: e.target.value })} placeholder="01XXXXXXXXX"/></label><label>Delivery address<textarea required value={details.address} onChange={(e) => setDetails({ ...details, address: e.target.value })} placeholder="House, road, area, district"/></label><label>Delivery area<select value={details.deliveryArea} onChange={(e) => setDetails({ ...details, deliveryArea: e.target.value })}><option value="inside_dhaka">Inside Dhaka · ৳{shippingInside}</option><option value="outside_dhaka">Outside Dhaka · ৳{shippingOutside}</option></select></label><div className="coupon-entry"><label>Discount code<input value={couponCode} onChange={e=>{setCouponCode(e.target.value);setCoupon(null)}} placeholder="Enter coupon"/></label><button type="button" className="small-action" onClick={async()=>{try{const x=await api('/api/coupons/validate',{method:'POST',body:JSON.stringify({code:couponCode,subtotal})});setCoupon(x);setError('')}catch(e){setError(e.message)}}}>Apply</button></div>{coupon&&<div className="coupon-success">{coupon.code} applied · save {taka(coupon.discount_bdt)}</div>}<div className="cod-label"><PackageCheck size={16}/> Cash on delivery</div><div className="checkout-totals"><span>Items</span><b>{taka(subtotal)}</b>{coupon&&<><span>Discount</span><b>−{taka(coupon.discount_bdt)}</b></>}<span>Delivery</span><b>{taka(details.deliveryArea==='inside_dhaka'?shippingInside:shippingOutside)}</b><strong>Total</strong><strong>{taka(subtotal-(coupon?.discount_bdt||0)+(details.deliveryArea==='inside_dhaka'?shippingInside:shippingOutside))}</strong></div>{error && <div className="form-error">{error}</div>}<button className="primary-button full-button" disabled={busy}>{busy ? 'Placing order…' : 'Place order'} <ArrowRight size={16}/></button></form>
}

function AdminPage({ user, signOut, flash }) { return <AdminDashboard user={user} signOut={signOut} flash={flash} api={api} taka={taka} ProductImage={ProductImage}/> }

function OrderTable({ orders, onStatus }) {
  if (!orders.length) return <div className="table-empty">No orders yet. Customer orders will show up here.</div>
  return <div className="table-scroll"><table><thead><tr><th>ORDER</th><th>CUSTOMER</th><th>ITEMS</th><th>TOTAL</th><th>STATUS</th><th>UPDATE</th></tr></thead><tbody>{orders.map((o) => <tr key={o.order_code}><td><b>{o.order_code}</b><small>{new Date(o.created_at + 'Z').toLocaleDateString()}</small></td><td>{o.customer_name}</td><td className="order-items">{o.items || '—'}</td><td>{taka(o.total_bdt)}</td><td><span className={`status-pill ${o.status.toLowerCase().replaceAll(' ','-')}`}>{o.status}</span></td><td><select value={o.status} onChange={(e) => onStatus(o, e.target.value)}>{['Pending','Confirmed','Processing','Shipped','Out for Delivery','Delivered','Cancelled'].map((s) => <option key={s}>{s}</option>)}</select></td></tr>)}</tbody></table></div>
}

function CustomerOrdersPanel({orders,onClose,onChanged}) {
  const [reasons,setReasons]=useState({})
  const [notice,setNotice]=useState('')
  const [busy,setBusy]=useState('')
  return <div className="orders-modal-backdrop" onClick={onClose}><section className="orders-modal" onClick={e=>e.stopPropagation()}><div className="drawer-head"><div><div className="eyebrow">YOUR ACCOUNT</div><h2>My orders</h2></div><button className="icon-button" onClick={onClose}><X/></button></div>{orders.length?orders.map(o=><article className="customer-order" key={o.order_code}><div><b>{o.order_code}</b><span>{o.status} · {taka(o.total_bdt)} · {new Date(o.created_at+'Z').toLocaleDateString()}</span></div>{o.status==='Delivered'&&<form onSubmit={async e=>{e.preventDefault();setBusy(o.order_code);setNotice('');try{await api(`/api/orders/${encodeURIComponent(o.order_code)}/returns`,{method:'POST',body:JSON.stringify({reason:reasons[o.order_code]||''})});setNotice(`Return request sent for ${o.order_code}.`);await onChanged()}catch(err){setNotice(err.message)}finally{setBusy('')}}}><textarea required minLength="8" placeholder="Describe why you want to return this item" value={reasons[o.order_code]||''} onChange={e=>setReasons({...reasons,[o.order_code]:e.target.value})}/><button className="small-action" disabled={busy===o.order_code}>{busy===o.order_code?'Sending…':'Request return'}</button></form>}</article>):<p>You have not placed any orders yet.</p>}{notice&&<p className="inline-note">{notice}</p>}<small>Return requests can be submitted within 7 days after delivery. Eligibility and item condition requirements apply.</small></section></div>
}

export default App
