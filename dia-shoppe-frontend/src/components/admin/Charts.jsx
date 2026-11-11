import { useState } from 'react'
import { motion } from '../motion'

/*
  Lightweight, dependency-free charts (plain divs / inline SVG) for the admin
  dashboard. Swap for a charting lib later if needed — data shapes stay the same.
*/

/* ── Stacked, rounded-top, gradient bars with hover tooltip + gridlines ──
   (styled after the reference dashboards). series are stacked bottom→top;
   each { key, name, gradient, color }. */
export function StackedBars({ data, series, height = 200, valueFmt = (v) => v }) {
  const [hover, setHover] = useState(null)
  const totals = data.map((d) => series.reduce((s, x) => s + (d[x.key] || 0), 0))
  const max = Math.max(1, ...totals)

  return (
    <div>
      <div className="relative" style={{ height }}>
        {/* faint gridlines */}
        {[0, 0.25, 0.5, 0.75, 1].map((g) => (
          <div key={g} className="absolute left-0 right-0 border-t border-gray-100" style={{ top: `${g * 100}%` }} />
        ))}

        <div className="relative flex items-end gap-1.5 sm:gap-3 h-full">
          {data.map((d, i) => {
            const total = totals[i]
            return (
              <div
                key={d.label}
                className="flex-1 flex flex-col items-center justify-end h-full"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              >
                <div className="relative w-full flex justify-center">
                  {/* tooltip */}
                  {hover === i && (
                    <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 z-10 w-max max-w-[160px] bg-ink-950 text-white rounded-lg shadow-lg px-3 py-2 text-xs pointer-events-none">
                      <div className="font-semibold mb-1">{d.label}</div>
                      {series.map((s) => (
                        <div key={s.key} className="flex items-center gap-1.5 whitespace-nowrap">
                          <span className="w-2 h-2 rounded-sm" style={{ background: s.color || s.gradient }} />
                          {s.name}: <span className="font-semibold">{valueFmt(d[s.key] || 0)}</span>
                        </div>
                      ))}
                      <div className="border-t border-white/15 mt-1 pt-1 text-dia-mint/80">Total: {valueFmt(total)}</div>
                    </div>
                  )}
                  {/* bar */}
                  <motion.div
                    initial={{ height: 0 }}
                    whileInView={{ height: `${(total / max) * height}px` }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                    className={`w-[62%] max-w-[30px] rounded-t-lg overflow-hidden flex flex-col-reverse transition-[filter] ${hover === i ? 'brightness-110' : ''}`}
                  >
                    {series.map((s) => (
                      <div key={s.key} style={{ height: `${((d[s.key] || 0) / (total || 1)) * 100}%`, background: s.gradient }} />
                    ))}
                  </motion.div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* labels */}
      <div className="flex gap-1.5 sm:gap-3 mt-1.5">
        {data.map((d) => (
          <span key={d.label} className="flex-1 text-center text-[10px] text-gray-400">{d.label}</span>
        ))}
      </div>

      {/* legend */}
      <div className="flex items-center gap-4 mt-3">
        {series.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5 text-xs text-gray-500">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: s.color || s.gradient }} /> {s.name}
          </span>
        ))}
      </div>
    </div>
  )
}

/* ── Smooth gradient area chart (funnel / trend) ── */
export function AreaChart({ values, height = 170, stroke = '#238689', gradientId = 'areaGrad', labels }) {
  const W = 100
  const max = Math.max(1, ...values)
  const n = values.length
  const pad = 8
  const x = (i) => (n === 1 ? W / 2 : (i / (n - 1)) * W)
  const y = (v) => pad + (1 - v / max) * (height - pad * 2)
  const pts = values.map((v, i) => ({ x: x(i), y: y(v) }))

  // smooth cubic path
  const line = pts.reduce((acc, p, i) => {
    if (i === 0) return `M ${p.x},${p.y}`
    const prev = pts[i - 1]
    const cx = (prev.x + p.x) / 2
    return `${acc} C ${cx},${prev.y} ${cx},${p.y} ${p.x},${p.y}`
  }, '')
  const area = `${line} L ${W},${height} L 0,${height} Z`

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" className="w-full" style={{ height }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.35" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {/* stage dividers */}
        {labels && pts.map((p, i) => (
          <line key={i} x1={p.x} y1="0" x2={p.x} y2={height} stroke="#eef2f7" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        ))}
        <path d={area} fill={`url(#${gradientId})`} />
        <path d={line} fill="none" stroke={stroke} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
        {pts.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r="1.6" fill="#fff" stroke={stroke} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
    </div>
  )
}

// Grouped vertical bars: data = [{ label, [k]: value }], series = [{ key, color, name }]
export function GroupedBars({ data, series, height = 180, valueFmt = (v) => v }) {
  const max = Math.max(1, ...data.flatMap((d) => series.map((s) => d[s.key] || 0)))
  return (
    <div>
      <div className="flex items-end gap-2 sm:gap-3" style={{ height }}>
        {data.map((d) => (
          <div key={d.label} className="flex-1 flex flex-col items-center justify-end gap-1 group">
            <div className="w-full flex items-end justify-center gap-0.5" style={{ height }}>
              {series.map((s) => (
                <motion.div
                  key={s.key}
                  initial={{ height: 0 }}
                  whileInView={{ height: `${((d[s.key] || 0) / max) * 100}%` }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                  title={`${d.label} · ${s.name}: ${valueFmt(d[s.key] || 0)}`}
                  className="w-2.5 sm:w-3 rounded-t-md"
                  style={{ backgroundColor: s.color }}
                />
              ))}
            </div>
            <span className="text-[10px] text-gray-400">{d.label}</span>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-4 mt-3">
        {series.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5 text-xs text-gray-500">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: s.color }} /> {s.name}
          </span>
        ))}
      </div>
    </div>
  )
}

// Horizontal progress bar row (for demand / geography lists)
export function BarRow({ label, sub, value, max, color = '#10b981', valueLabel }) {
  return (
    <div>
      <div className="flex justify-between items-baseline mb-1">
        <span className="text-sm text-ink-900 font-medium truncate">{label}</span>
        <span className="text-xs text-gray-500 whitespace-nowrap ml-2">{valueLabel}</span>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          whileInView={{ width: `${(value / max) * 100}%` }}
          viewport={{ once: true }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          className="h-full rounded-full"
          style={{ backgroundColor: color }}
        />
      </div>
      {sub && <div className="text-[11px] text-gray-400 mt-0.5">{sub}</div>}
    </div>
  )
}

// Simple line/area sparkline via SVG polyline
export function Sparkline({ data, color = '#10b981', height = 60 }) {
  const max = Math.max(...data)
  const min = Math.min(...data)
  const pts = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * 100
      const y = height - ((v - min) / Math.max(1, max - min)) * height
      return `${x},${y}`
    })
    .join(' ')
  return (
    <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" className="w-full" style={{ height }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}
