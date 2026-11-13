import { useEffect, useMemo, useState } from 'react'
import AdminLayout from '../../components/admin/AdminLayout'
import {
  fetchCategories, fetchAdminProducts, createProduct, updateProduct,
  setProductActive, uploadProductImage, slugify, autoSku,
} from '../../lib/adminCatalog'
import { FiPlus, FiEdit2, FiSearch, FiX, FiEye, FiEyeOff, FiImage, FiUpload, FiLock } from 'react-icons/fi'

const inr = (n) => '₹' + Number(n).toLocaleString('en-IN')

const blank = {
  name: '', brand: '', category_id: '', price: '', original_price: '',
  cost_price: '', stock_qty: '', badge: '', description: '', sku: '', specs: [],
}

// margin % from selling price + cost; null when cost is unknown
const marginPct = (price, cost) => {
  const p = Number(price), c = Number(cost)
  if (!p || !c || c <= 0) return null
  return Math.round(((p - c) / p) * 100)
}

export default function AdminProducts() {
  const [list, setList] = useState([])
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [query, setQuery] = useState('')
  const [cat, setCat] = useState('all')

  // modal state
  const [editing, setEditing] = useState(null) // 'new' | product id
  const [form, setForm] = useState(blank)
  const [gallery, setGallery] = useState([]) // [{url} | {file, preview}] — [0] is primary
  const [saving, setSaving] = useState(false)

  const load = () =>
    fetchAdminProducts().then(({ products, error: err }) => {
      if (err) setError(err)
      else setList(products)
      setLoading(false)
    })

  useEffect(() => {
    load()
    fetchCategories().then(({ categories: cats }) => setCategories(cats))
  }, [])

  const filtered = useMemo(
    () =>
      list.filter(
        (p) =>
          (cat === 'all' || String(p.category_id) === cat) &&
          (!query ||
            p.name.toLowerCase().includes(query.toLowerCase()) ||
            (p.brand || '').toLowerCase().includes(query.toLowerCase()) ||
            (p.sku || '').toLowerCase().includes(query.toLowerCase()))
      ),
    [list, query, cat]
  )

  const openAdd = () => {
    setForm({ ...blank, category_id: categories[0]?.id || '' })
    setGallery([])
    setEditing('new')
  }

  const openEdit = (p) => {
    setForm({
      name: p.name, brand: p.brand || '', category_id: p.category_id || '',
      price: p.price, original_price: p.original_price || '', cost_price: p.cost_price ?? '',
      stock_qty: p.stock_qty,
      badge: p.badge || '', description: p.description || '', sku: p.sku,
      specs: Array.isArray(p.specs) ? p.specs : [],
    })
    setGallery(
      (Array.isArray(p.images) && p.images.length
        ? p.images
        : [p.image_url].filter(Boolean)
      ).map((url) => ({ url }))
    )
    setEditing(p.id)
  }

  /* Gallery editing. `gallery` holds a mix of:
       { url }            — already uploaded (existing product image)
       { file, preview }  — newly picked, uploaded on save
     The FIRST entry is the primary image used on cards/cart. */
  const MAX_IMAGES = 5

  const pickImage = (e) => {
    const files = Array.from(e.target.files || [])
    if (!files.length) return
    setGallery((g) => [
      ...g,
      ...files.slice(0, MAX_IMAGES - g.length).map((file) => ({ file, preview: URL.createObjectURL(file) })),
    ])
    e.target.value = '' // let the same file be picked again after removing
  }

  const removeImage = (i) => setGallery((g) => g.filter((_, j) => j !== i))
  const makePrimary = (i) =>
    setGallery((g) => (i === 0 ? g : [g[i], ...g.filter((_, j) => j !== i)]))

  const save = async (e) => {
    e.preventDefault()
    setSaving(true)
    setError(null)

    // upload any newly picked files, keeping the gallery order intact
    const urls = []
    for (const item of gallery) {
      if (item.url) { urls.push(item.url); continue }
      const { url, error: upErr } = await uploadProductImage(item.file)
      if (upErr) {
        setError(`Image upload failed: ${upErr}`)
        setSaving(false)
        return
      }
      urls.push(url)
    }
    const imageUrl = urls[0] // primary — keeps image_url in sync with images[0]

    const fields = {
      name: form.name.trim(),
      brand: form.brand.trim() || null,
      category_id: form.category_id || null,
      price: Number(form.price),
      original_price: Number(form.original_price || form.price),
      cost_price: form.cost_price === '' ? null : Number(form.cost_price),
      stock_qty: Number(form.stock_qty),
      badge: form.badge.trim() || null,
      description: form.description.trim() || null,
      specs: (() => {
        const rows = form.specs
          .map((s) => ({ k: s.k.trim(), v: s.v.trim() }))
          .filter((s) => s.k && s.v)
        return rows.length ? rows : null
      })(),
      images: urls.length ? urls : null,
      // keep the legacy single column pointing at the primary image
      ...(urls.length ? { image_url: imageUrl } : {}),
    }

    let err
    if (editing === 'new') {
      fields.sku = form.sku.trim() || autoSku()
      fields.slug = slugify(form.name)
      const res = await createProduct(fields)
      // slug collision → make it unique and retry once
      if (res.error?.includes('products_slug_key')) {
        fields.slug = `${fields.slug}-${Date.now().toString(36).slice(-4)}`
        err = (await createProduct(fields)).error
      } else {
        err = res.error
      }
    } else {
      err = (await updateProduct(editing, fields)).error
    }

    setSaving(false)
    if (err) {
      setError(err)
      return
    }
    setEditing(null)
    load()
  }

  const toggleActive = async (p) => {
    const { error: err } = await setProductActive(p.id, !p.is_active)
    if (err) setError(err)
    load()
  }

  const actions = (
    <button onClick={openAdd} className="inline-flex items-center gap-1.5 bg-primary-700 text-white rounded-lg px-3 py-2 text-sm font-semibold hover:bg-primary-800">
      <FiPlus size={15} /> Add Product
    </button>
  )

  return (
    <AdminLayout title="Products" subtitle={`${list.length} products in catalog`} actions={actions}>
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex items-center border border-gray-200 rounded-lg px-3 py-2 bg-white">
          <FiSearch size={15} className="text-gray-400" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, brand, SKU…" className="outline-none text-sm px-2 w-56" />
        </div>
        <select value={cat} onChange={(e) => setCat(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white text-gray-700">
          <option value="all">All categories</option>
          {categories.map((c) => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
        </select>
        <span className="text-sm text-gray-400 ml-auto">{filtered.length} shown</span>
      </div>

      {error && (
        <p className="mb-4 text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2.5" role="alert">{error}</p>
      )}

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-14 bg-white rounded-xl border border-gray-100 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[820px]">
              <thead>
                <tr className="text-left text-xs text-gray-400 border-b border-gray-100 bg-gray-50/60">
                  <th className="py-3 px-4 font-medium">Product</th>
                  <th className="py-3 px-4 font-medium">SKU</th>
                  <th className="py-3 px-4 font-medium">Category</th>
                  <th className="py-3 px-4 font-medium text-right">Price</th>
                  <th className="py-3 px-4 font-medium text-right">Stock</th>
                  <th className="py-3 px-4 font-medium">Visible</th>
                  <th className="py-3 px-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => {
                  const low = p.stock_qty > 0 && p.stock_qty <= 5
                  return (
                    <tr key={p.id} className={`border-b border-gray-50 last:border-0 hover:bg-gray-50/50 ${p.is_active ? '' : 'opacity-50'}`}>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          <span className="w-10 h-10 rounded-lg bg-secondary-50 flex items-center justify-center shrink-0 overflow-hidden">
                            {p.image_url
                              ? <img src={p.image_url} alt="" className="w-full h-full object-cover" />
                              : <FiImage size={16} className="text-secondary-300" />}
                          </span>
                          <div className="min-w-0">
                            <div className="font-medium text-ink-900 truncate max-w-[220px]">{p.name}</div>
                            <div className="text-xs text-gray-400">{p.brand}</div>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-xs text-gray-400 font-mono">{p.sku}</td>
                      <td className="py-3 px-4 text-gray-600">{p.categories?.name || '—'}</td>
                      <td className="py-3 px-4 text-right">
                        <div className="font-semibold text-ink-900">{inr(p.price)}</div>
                        {p.original_price && Number(p.original_price) > Number(p.price) && (
                          <div className="text-xs text-gray-400 line-through">{inr(p.original_price)}</div>
                        )}
                        {marginPct(p.price, p.cost_price) !== null && (
                          <div className="text-[11px] text-emerald-600 font-medium">{marginPct(p.price, p.cost_price)}% margin</div>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <span className={p.stock_qty === 0 ? 'text-red-500 font-medium' : low ? 'text-amber-600 font-medium' : 'text-gray-600'}>
                          {p.stock_qty === 0 ? 'Out' : p.stock_qty}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <button
                          onClick={() => toggleActive(p)}
                          title={p.is_active ? 'Visible on store — click to hide' : 'Hidden from store — click to show'}
                          className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-full ${
                            p.is_active ? 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                          }`}
                        >
                          {p.is_active ? <><FiEye size={12} /> Live</> : <><FiEyeOff size={12} /> Hidden</>}
                        </button>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center justify-end">
                          <button onClick={() => openEdit(p)} className="p-2 text-gray-400 hover:text-primary-700 hover:bg-primary-50 rounded-lg" aria-label={`Edit ${p.name}`}>
                            <FiEdit2 size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* add/edit modal */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setEditing(null)} />
          <form onSubmit={save} className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-display text-xl font-semibold text-ink-900">{editing === 'new' ? 'Add Product' : 'Edit Product'}</h2>
              <button type="button" onClick={() => setEditing(null)} className="text-gray-400 hover:text-gray-600"><FiX size={20} /></button>
            </div>

            {/* image gallery — first tile is the primary image */}
            <div className="mb-5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-600">Photos</span>
                <span className="text-xs text-gray-400">{gallery.length}/{MAX_IMAGES} · first one is the main photo</span>
              </div>

              <div className="flex flex-wrap gap-3">
                {gallery.map((img, i) => (
                  <div key={i} className="relative group">
                    <span className={`block w-20 h-20 rounded-xl overflow-hidden border-2 ${i === 0 ? 'border-secondary-500' : 'border-gray-200'}`}>
                      <img src={img.url || img.preview} alt="" className="w-full h-full object-cover" />
                    </span>
                    {i === 0 && (
                      <span className="absolute -top-1.5 left-1/2 -translate-x-1/2 text-[9px] font-bold uppercase tracking-wide bg-secondary-500 text-white px-1.5 py-0.5 rounded-full">Main</span>
                    )}
                    <button
                      type="button" onClick={() => removeImage(i)} aria-label="Remove photo"
                      className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-white border border-gray-200 shadow text-gray-500 hover:text-red-600 flex items-center justify-center"
                    >
                      <FiX size={12} />
                    </button>
                    {i !== 0 && (
                      <button
                        type="button" onClick={() => makePrimary(i)}
                        className="absolute inset-x-0 bottom-0 text-[10px] font-semibold bg-black/60 text-white py-0.5 opacity-0 group-hover:opacity-100 transition-opacity rounded-b-lg"
                      >
                        Make main
                      </button>
                    )}
                  </div>
                ))}

                {gallery.length < MAX_IMAGES && (
                  <label className="w-20 h-20 rounded-xl bg-secondary-50 border border-dashed border-secondary-200 flex flex-col items-center justify-center cursor-pointer hover:border-secondary-400 transition-colors shrink-0">
                    <FiUpload size={18} className="text-secondary-400" />
                    <span className="text-[10px] text-secondary-600 font-semibold mt-1">Add</span>
                    <input type="file" accept="image/*" multiple onChange={pickImage} className="hidden" />
                  </label>
                )}
              </div>
              <p className="text-xs text-gray-400 mt-2">
                JPG or PNG. Pick several at once — customers can swipe through them on the product page.
              </p>
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <label className="block sm:col-span-2">
                <span className="text-sm font-medium text-gray-600">Product name</span>
                <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="mt-1 w-full border border-primary-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary-300" />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-600">Brand</span>
                <input value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })}
                  className="mt-1 w-full border border-primary-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary-300" />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-600">Category</span>
                <select required value={form.category_id} onChange={(e) => setForm({ ...form, category_id: Number(e.target.value) })}
                  className="mt-1 w-full border border-primary-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary-300 bg-white">
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-600">Selling price (₹)</span>
                <input required type="number" min="0" step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })}
                  className="mt-1 w-full border border-primary-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary-300" />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-600">MRP / original price (₹)</span>
                <input type="number" min="0" step="0.01" value={form.original_price} onChange={(e) => setForm({ ...form, original_price: e.target.value })}
                  className="mt-1 w-full border border-primary-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary-300" placeholder="Same as price" />
              </label>
              <label className="block sm:col-span-2">
                <span className="flex items-center gap-1.5 text-sm font-medium text-gray-600">
                  Cost price (₹)
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">
                    <FiLock size={9} /> Private
                  </span>
                </span>
                <input type="number" min="0" step="0.01" value={form.cost_price} onChange={(e) => setForm({ ...form, cost_price: e.target.value })}
                  className="mt-1 w-full border border-primary-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary-300" placeholder="What the shop pays for this item" />
                <span className="block text-xs text-gray-400 mt-1">
                  Never shown to customers — used only for profit &amp; margin reports.
                  {marginPct(form.price, form.cost_price) !== null && (
                    <span className="ml-1 font-semibold text-emerald-600">
                      Margin: {marginPct(form.price, form.cost_price)}% ({inr(Number(form.price) - Number(form.cost_price))}/unit)
                    </span>
                  )}
                </span>
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-600">Stock quantity</span>
                <input required type="number" min="0" value={form.stock_qty} onChange={(e) => setForm({ ...form, stock_qty: e.target.value })}
                  className="mt-1 w-full border border-primary-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary-300" />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-600">Badge (optional)</span>
                <input value={form.badge} onChange={(e) => setForm({ ...form, badge: e.target.value })}
                  className="mt-1 w-full border border-primary-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary-300" placeholder="Best Seller" />
              </label>
              {editing === 'new' && (
                <label className="block">
                  <span className="text-sm font-medium text-gray-600">SKU (optional)</span>
                  <input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })}
                    className="mt-1 w-full border border-primary-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary-300 font-mono" placeholder="Auto-generated" />
                </label>
              )}
              <label className="block sm:col-span-2">
                <span className="text-sm font-medium text-gray-600">Description (optional)</span>
                <textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className="mt-1 w-full border border-primary-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary-300" />
              </label>

              {/* per-product specifications — shown as the Specifications table
                  on the product page (blank = auto-generated table) */}
              <div className="sm:col-span-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-600">Specifications (optional)</span>
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, specs: [...form.specs, { k: '', v: '' }] })}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-primary-700 hover:underline"
                  >
                    <FiPlus size={13} /> Add row
                  </button>
                </div>
                {form.specs.length === 0 ? (
                  <p className="text-xs text-gray-400 mt-1.5">
                    No rows — the product page shows an auto-generated table (brand, model, category, standard warranty).
                    Add rows to replace it with real specs, e.g. <span className="font-medium">Warranty → 2 Years</span>.
                  </p>
                ) : (
                  <div className="mt-2 space-y-2">
                    {form.specs.map((s, i) => (
                      <div key={i} className="flex gap-2">
                        <input
                          value={s.k}
                          onChange={(e) => setForm({ ...form, specs: form.specs.map((x, j) => j === i ? { ...x, k: e.target.value } : x) })}
                          placeholder="Label (e.g. Warranty)"
                          className="w-2/5 border border-primary-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary-300"
                        />
                        <input
                          value={s.v}
                          onChange={(e) => setForm({ ...form, specs: form.specs.map((x, j) => j === i ? { ...x, v: e.target.value } : x) })}
                          placeholder="Value (e.g. 2 Years)"
                          className="flex-1 border border-primary-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary-300"
                        />
                        <button
                          type="button"
                          onClick={() => setForm({ ...form, specs: form.specs.filter((_, j) => j !== i) })}
                          aria-label="Remove row"
                          className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg"
                        >
                          <FiX size={15} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button type="button" onClick={() => setEditing(null)} className="px-4 py-2 rounded-lg text-sm font-semibold text-gray-600 hover:bg-gray-100">Cancel</button>
              <button type="submit" disabled={saving} className="px-5 py-2 rounded-lg text-sm font-semibold bg-primary-700 text-white hover:bg-primary-800 disabled:opacity-60">
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        </div>
      )}
    </AdminLayout>
  )
}
