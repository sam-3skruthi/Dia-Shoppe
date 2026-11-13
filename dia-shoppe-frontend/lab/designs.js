import * as THREE from 'three'

/*
  Round 3 — three D + S monogram DESIGNS (lab only).
  Units: y UP, each letter ≈ 120 wide × 140 tall. Every design returns a
  THREE.Group with the D and S already interlocked as a monogram.

    gothic  — blackletter cut with a broad-nib pen, pillowed chrome (ref: chrome L/E, purple S)
    script  — copperplate script, hairline-to-swell tubular strokes (ref: chrome A)
    liquid  — fat liquid-chrome swashes with ball terminals (ref: black K)
*/

const V = (x, y, z = 0) => new THREE.Vector3(x, y, z)

/* ── variable-radius tube along a smooth centre-line ───────────────────────
   radius(t, tangent) → [inPlane, depth]; ends taper / round off; caps closed. */
function tube(points, radius, { samples = 320, radial = 28, tension = 'centripetal' } = {}) {
  const curve = new THREE.CatmullRomCurve3(points, false, tension)
  const pts = curve.getSpacedPoints(samples)
  const pos = []
  const idx = []
  let prevN = new THREE.Vector3(0, 1, 0)
  pts.forEach((p, i) => {
    const a = pts[Math.max(0, i - 1)]
    const b = pts[Math.min(pts.length - 1, i + 1)]
    const T = new THREE.Vector3().subVectors(b, a).normalize()
    let N = new THREE.Vector3(-T.y, T.x, 0)
    if (N.lengthSq() < 1e-6) N = prevN.clone()
    N.normalize()
    prevN = N
    const B = new THREE.Vector3().crossVectors(T, N).normalize()
    const [rw, rd] = radius(i / (pts.length - 1), T)
    for (let k = 0; k < radial; k += 1) {
      const ang = (k / radial) * Math.PI * 2
      const q = p.clone().addScaledVector(N, Math.cos(ang) * rw).addScaledVector(B, Math.sin(ang) * rd)
      pos.push(q.x, q.y, q.z)
    }
  })
  for (let i = 0; i < pts.length - 1; i += 1) {
    for (let k = 0; k < radial; k += 1) {
      const a = i * radial + k
      const b = i * radial + ((k + 1) % radial)
      const c = (i + 1) * radial + k
      const d = (i + 1) * radial + ((k + 1) % radial)
      idx.push(a, c, b, b, c, d)
    }
  }
  // caps
  const capStart = pos.length / 3
  pos.push(pts[0].x, pts[0].y, pts[0].z)
  const capEnd = capStart + 1
  const last = pts[pts.length - 1]
  pos.push(last.x, last.y, last.z)
  const lastRing = (pts.length - 1) * radial
  for (let k = 0; k < radial; k += 1) {
    idx.push(capStart, (k + 1) % radial, k)
    idx.push(capEnd, lastRing + k, lastRing + ((k + 1) % radial))
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setIndex(idx)
  geo.computeVertexNormals()
  return geo
}

/* tapers both ends to a point (smooth) */
const taper = (t, len = 0.08) => Math.min(1, Math.sin(Math.min(1, t / len) * Math.PI / 2), Math.sin(Math.min(1, (1 - t) / len) * Math.PI / 2))
/* rounded "ball" ends: quick swell to full size */
const ball = (t, len = 0.035) => Math.min(1, Math.sqrt(Math.min(1, t / len)), Math.sqrt(Math.min(1, (1 - t) / len)))

/* ── broad-nib pen outline (for the gothic cut) ─────────────────────────────
   Polyline centre-line; width = hairline + nib × |sin(direction − nibAngle)|,
   which is exactly how a calligrapher's flat pen makes blackletter. */
function nibStroke(points, { nib = 18, hair = 2.4, angle = 38, steps = 18, taperEnds = 0 } = {}) {
  const na = THREE.MathUtils.degToRad(angle)
  const dense = []
  for (let i = 0; i < points.length - 1; i += 1) {
    for (let s = 0; s < steps; s += 1) {
      const t = s / steps
      dense.push([points[i][0] + (points[i + 1][0] - points[i][0]) * t, points[i][1] + (points[i + 1][1] - points[i][1]) * t])
    }
  }
  dense.push(points[points.length - 1])
  const left = []
  const right = []
  const dirs = dense.map((p, i) => {
    const a = dense[Math.max(0, i - 2)]
    const b = dense[Math.min(dense.length - 1, i + 2)]
    return Math.atan2(b[1] - a[1], b[0] - a[0])
  })
  // pen width from direction, then smoothed along the stroke so corners flow
  // instead of stepping (a real nib turns gradually through a corner)
  let widths = dirs.map((th, i) => {
    const end = taperEnds ? Math.min(1, i / taperEnds, (dense.length - 1 - i) / taperEnds) : 1
    return (hair + nib * Math.abs(Math.sin(th - na))) * (0.25 + 0.75 * end)
  })
  for (let pass = 0; pass < 4; pass += 1) {
    widths = widths.map((w, i) => {
      let sum = 0
      let n = 0
      for (let k = -3; k <= 3; k += 1) {
        const j = i + k
        if (j >= 0 && j < widths.length) { sum += widths[j]; n += 1 }
      }
      return sum / n
    })
  }
  dense.forEach((p, i) => {
    const th = dirs[i]
    const w = widths[i]
    const nx = -Math.sin(th)
    const ny = Math.cos(th)
    left.push(new THREE.Vector2(p[0] + nx * w / 2, p[1] + ny * w / 2))
    right.push(new THREE.Vector2(p[0] - nx * w / 2, p[1] - ny * w / 2))
  })
  return new THREE.Shape([...left, ...right.reverse()])
}

const diamond = (x, y, rx, ry = rx * 1.5) => new THREE.Shape([
  new THREE.Vector2(x, y + ry), new THREE.Vector2(x + rx, y), new THREE.Vector2(x, y - ry), new THREE.Vector2(x - rx, y),
])

function pillow(shapes, depth = 8) {
  const geo = new THREE.ExtrudeGeometry(shapes, {
    depth, bevelEnabled: true, bevelThickness: 11, bevelSize: 6.5, bevelSegments: 16, curveSegments: 6,
  })
  geo.translate(0, 0, -depth / 2)
  geo.computeVertexNormals()
  return geo
}

/* ───────────────────────── 1 · GOTHIC ───────────────────────── */
function gothic(material) {
  const g = new THREE.Group()
  const D = [
    nibStroke([[24, 126], [24, 14]], { nib: 19 }),                                   // stem
    nibStroke([[24, 134], [60, 142], [92, 130], [110, 100], [114, 70], [108, 38], [88, 12], [56, 2], [20, 8]], { nib: 18 }),
    nibStroke([[24, 14], [8, 0], [-4, -6]], { nib: 14, taperEnds: 10 }),             // foot spur
    diamond(24, 150, 8, 13),                                                          // finial
    diamond(6, 70, 7, 10),                                                            // side spur
    nibStroke([[44, 112], [70, 118], [86, 104]], { nib: 9, hair: 2 }),               // inner hairline
  ]
  const S = [
    nibStroke([[104, 122], [88, 140], [44, 138], [20, 116], [28, 92], [92, 60], [106, 32], [90, 6], [46, 0], [14, 16]], { nib: 19 }),
    nibStroke([[104, 122], [118, 132], [124, 146]], { nib: 10, taperEnds: 8 }),      // top hook
    nibStroke([[14, 16], [4, 28], [2, 40]], { nib: 10, taperEnds: 8 }),             // bottom hook
    nibStroke([[-6, -14], [126, 156]], { nib: 2.4, hair: 2.4, steps: 40 }),          // long hairline (ref S)
  ]
  const d = new THREE.Mesh(pillow(D), material)
  const s = new THREE.Mesh(pillow(S, 7), material)
  s.position.set(104, -22, 18)
  s.scale.setScalar(0.88)
  g.add(d, s)
  return g
}

/* ───────────────────────── 2 · SCRIPT ───────────────────────── */
function script(material) {
  const g = new THREE.Group()
  // copperplate shading: vertical motion swells, horizontal is a hairline
  const copper = (min, max) => (t, T) => {
    const r = (min + (max - min) * Math.pow(Math.abs(T.y), 2.2)) * taper(t, 0.06)
    return [r, r * 0.85]
  }
  const dPts = [
    V(50, 132), V(44, 96), V(37, 52), V(32, 18), V(20, 4), V(6, 10), V(8, 26), V(26, 26, 3),
    V(58, 10, 4), V(96, 12, 3), V(122, 44), V(124, 88), V(104, 126), V(66, 144), V(30, 136), V(14, 116), V(26, 100), V(40, 108),
  ]
  const sPts = [
    V(30, 92), V(58, 120, 4), V(96, 140, 5), V(118, 128, 4), V(104, 108), V(64, 92), V(40, 68), V(52, 40),
    V(88, 22, 4), V(98, 2), V(70, -14), V(30, -8), V(10, 12), V(20, 28), V(36, 20),
  ]
  const d = new THREE.Mesh(tube(dPts, copper(2.1, 10.5)), material)
  const s = new THREE.Mesh(tube(sPts, copper(2.1, 10)), material)
  // S hangs below: its top starts right where the D's base loop is
  s.position.set(70, -112, 12)
  g.add(d, s)
  return g
}

/* ───────────────────────── 3 · LIQUID ───────────────────────── */
function liquid(material) {
  const g = new THREE.Group()
  const fat = (min, max) => (t, T) => {
    const swell = min + (max - min) * (0.55 + 0.45 * Math.sin(Math.PI * t)) * (0.7 + 0.3 * Math.abs(T.y))
    const r = swell * ball(t, 0.04)
    return [r, r * 0.92]
  }
  const stem = [V(18, 118), V(26, 136, 4), V(44, 140, 6), V(54, 124, 4), V(52, 96), V(48, 60), V(42, 26), V(30, 6, 4), V(14, 2, 6), V(6, 16, 4), V(18, 22)]
  const bowl = [V(54, 128, -4), V(88, 138, -2), V(118, 112), V(126, 68), V(112, 26), V(84, 6, 2), V(52, 10, 4), V(40, 22, 6)]
  const sPts = [V(104, 108), V(112, 130, 4), V(94, 144, 6), V(60, 140, 4), V(36, 120), V(42, 94, -2), V(76, 76), V(104, 54, 2), V(106, 24), V(84, 4, 4), V(48, 0, 6), V(20, 12, 4), V(10, 34), V(24, 40, 4)]
  g.add(new THREE.Mesh(tube(stem, fat(6, 11.5)), material))
  g.add(new THREE.Mesh(tube(bowl, fat(5, 11)), material))
  const s = new THREE.Mesh(tube(sPts, fat(6, 12)), material)
  s.position.set(70, -16, 22)
  s.scale.setScalar(0.9)
  g.add(s)
  return g
}

export const DESIGNS = { gothic, script, liquid }

/* centre any monogram group on the origin and report its size */
export function centre(group) {
  const box = new THREE.Box3().setFromObject(group)
  const c = box.getCenter(new THREE.Vector3())
  const size = box.getSize(new THREE.Vector3())
  group.children.forEach((m) => m.position.sub(c))
  return size
}
