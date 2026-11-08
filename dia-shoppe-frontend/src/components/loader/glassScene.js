/*
  Three.js scene for the "Crystal Formation × Aurora Reveal" loader.

  The D and S are the approved glass photographs. They are never redrawn or
  re-modelled: each letter is a plane carrying two derived maps
    mul — how much each pixel darkens what is behind it  (glass body, edges)
    add — additive highlight / prismatic light (stored ×4, see
          source-assets/build_glass_maps.py)
  and is composited as  out = backdrop × mul + add, which keeps the glass
  clear and the reflections intact over the aurora background.

  The "crystal formation" is the letter plane split into ~70–160 triangular
  shards (real regions of the letter image) that tumble in from the camera and
  assemble. Rendering is on demand: the caller (GSAP timeline) calls draw()
  only while the animation runs; nothing renders continuously.

  This module is imported dynamically so Three.js stays out of the main bundle.
*/
import {
  WebGLRenderer, Scene, PerspectiveCamera, Mesh, Group, PlaneGeometry, BufferGeometry,
  BufferAttribute, ShaderMaterial, CustomBlending, AddEquation, DstColorFactor, ZeroFactor,
  OneFactor, TextureLoader, NoColorSpace,
} from 'three'

import dMul from '../../assets/dia/d-mul.webp'
import dAdd from '../../assets/dia/d-add.webp'
import sMul from '../../assets/dia/s-mul.webp'
import sAdd from '../../assets/dia/s-add.webp'
import dMulM from '../../assets/dia/d-mul-m.webp'
import dAddM from '../../assets/dia/d-add-m.webp'
import sMulM from '../../assets/dia/s-mul-m.webp'
import sAddM from '../../assets/dia/s-add-m.webp'

const ASPECT = 1448 / 1086          // letter images are 4:3
const PW = 1.7                      // plane width in world units
const PH = PW / ASPECT
const FOV = 32

/* ── shaders ───────────────────────────────────────────────────────── */

const SHARD_VERT = /* glsl */ `
  uniform float uForm;
  attribute vec3 aCenter;
  attribute vec4 aRand;
  varying vec2 vUv;
  varying float vP;
  mat3 rotAxis(vec3 a, float ang){
    float c = cos(ang), s = sin(ang), t = 1.0 - c;
    return mat3(
      t*a.x*a.x + c,     t*a.x*a.y + s*a.z, t*a.x*a.z - s*a.y,
      t*a.x*a.y - s*a.z, t*a.y*a.y + c,     t*a.y*a.z + s*a.x,
      t*a.x*a.z + s*a.y, t*a.y*a.z - s*a.x, t*a.z*a.z + c);
  }
  void main(){
    float p = clamp((uForm - aRand.x * 0.55) / 0.45, 0.0, 1.0);
    float e = 1.0 - pow(1.0 - p, 3.0);
    vec3 axis = normalize(vec3(aRand.y - 0.5, aRand.z - 0.5, 0.35 + aRand.w * 0.4));
    float ang = (1.0 - e) * (2.0 + aRand.w * 2.2) * (aRand.y > 0.5 ? 1.0 : -1.0);
    vec3 local = rotAxis(axis, ang) * (position - aCenter);
    vec3 off = vec3((aRand.y - 0.5) * 2.2, (aRand.z - 0.5) * 1.6, 0.9 + aRand.w * 1.8) * (1.0 - e);
    vUv = uv;
    vP = e;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(aCenter + local + off, 1.0);
  }
`

const MUL_FRAG = /* glsl */ `
  uniform sampler2D uMul;
  uniform float uOpacity;
  varying vec2 vUv;
  varying float vP;
  void main(){
    vec3 m = texture2D(uMul, vUv).rgb;
    float a = uOpacity * smoothstep(0.0, 0.35, vP) * (0.5 + 0.5 * vP);
    gl_FragColor = vec4(mix(vec3(1.0), m, a), 1.0);
  }
`

const ADD_FRAG = /* glsl */ `
  uniform sampler2D uAdd;
  uniform sampler2D uMul;
  uniform float uOpacity;
  uniform float uSweep;
  uniform float uDisp;
  uniform float uGlow;
  varying vec2 vUv;
  varying float vP;
  vec3 hsv(vec3 c){
    vec3 p = abs(fract(c.xxx + vec3(0.0, 2.0/3.0, 1.0/3.0)) * 6.0 - 3.0);
    return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
  }
  void main(){
    vec2 d = vec2(0.6, 0.8) * uDisp;
    vec3 a = vec3(texture2D(uAdd, vUv + d).r, texture2D(uAdd, vUv).g, texture2D(uAdd, vUv - d).b) * 0.17;
    float lum = dot(texture2D(uMul, vUv).rgb, vec3(0.3333));
    float glass = smoothstep(0.03, 0.4, 1.0 - lum);
    float band = exp(-pow((vUv.x * 0.85 + vUv.y * 0.35 - uSweep) * 5.0, 2.0));
    vec3 prism = hsv(vec3(fract(vUv.x * 1.4 + vUv.y * 0.5 + uSweep * 0.7), 0.38, 1.0));
    vec3 col = a * (1.0 + band * 1.9 + uGlow * 1.3) + prism * band * glass * 0.2 + vec3(0.30, 0.82, 1.0) * glass * uGlow * 0.11;
    float k = uOpacity * smoothstep(0.0, 0.35, vP) * (1.0 + 0.9 * (1.0 - vP));
    gl_FragColor = vec4(col * k, 1.0);
  }
`

const AURORA_VERT = /* glsl */ `
  void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }
`

const AURORA_FRAG = /* glsl */ `
  uniform vec2 uRes;
  uniform float uTime;
  uniform float uAurora;
  float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float noise(vec2 p){
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++){ v += a * noise(p); p *= 2.02; a *= 0.5; } return v; }
  void main(){
    vec2 uv = gl_FragCoord.xy / uRes;
    vec2 p = (uv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
    vec3 mint = vec3(0.949, 1.0, 0.965);
    vec3 tea  = vec3(0.792, 1.0, 0.871);
    vec3 aqua = vec3(0.145, 0.773, 0.914);
    vec3 turq = vec3(0.173, 0.827, 0.761);
    vec3 vio  = vec3(0.42, 0.357, 0.839);
    float t = uTime * 0.18;
    float travel = mix(-1.5, 1.5, uAurora);
    float diag = p.x * 0.8 + p.y * 0.35;
    float win = exp(-pow((diag - travel) * 0.85, 2.0)) * 0.95 + 0.22 * smoothstep(0.0, 1.0, uAurora);
    vec2 q = vec2(p.x + 0.35 * p.y, p.y - 0.18 * p.x);
    float y1 = q.y - 0.22 * sin(q.x * 1.5 + t * 1.3) - 0.32 * (fbm(vec2(q.x * 1.1 + t, 1.7)) - 0.4);
    float y2 = q.y + 0.2 - 0.18 * sin(q.x * 1.1 - t * 1.1 + 2.0) - 0.34 * (fbm(vec2(q.x * 0.9 - t, 5.3)) - 0.4);
    float r1 = exp(-pow(y1 / 0.2, 2.0));
    float r2 = exp(-pow(y2 / 0.26, 2.0));
    vec3 col = mint;
    col = mix(col, tea, clamp(r1 * win * 1.1, 0.0, 1.0) * 0.8);
    col = mix(col, mix(aqua, turq, 0.5 + 0.5 * sin(p.x * 2.0 + t)), clamp(r2 * win, 0.0, 1.0) * 0.15);
    col = mix(col, vio, clamp(r1 * r2 * win, 0.0, 1.0) * 0.08);
    col += vec3(0.05, 0.06, 0.05) * exp(-dot(p, p) * 1.6) * uAurora;
    col = min(col, vec3(1.0));
    col += (hash(gl_FragCoord.xy + fract(uTime) * 91.7) - 0.5) * 0.022;
    gl_FragColor = vec4(col, 1.0);
  }
`

/* ── geometry: a letter plane split into jittered triangular shards ── */

function seeded(seed) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function buildShards(cols, rows, seed) {
  const rnd = seeded(seed)
  const pts = []
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= cols; i++) {
      const edge = i === 0 || j === 0 || i === cols || j === rows
      const jx = edge ? 0 : (rnd() - 0.5) * 0.7
      const jy = edge ? 0 : (rnd() - 0.5) * 0.7
      pts.push([((i + jx) / cols - 0.5) * PW, ((j + jy) / rows - 0.5) * PH])
    }
  }
  const at = (i, j) => pts[j * (cols + 1) + i]
  const tris = []
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = at(i, j), b = at(i + 1, j), c = at(i, j + 1), d = at(i + 1, j + 1)
      if ((i + j) % 2) { tris.push([a, b, d], [a, d, c]) } else { tris.push([a, b, c], [b, d, c]) }
    }
  }
  const n = tris.length * 3
  const pos = new Float32Array(n * 3), uv = new Float32Array(n * 2)
  const ctr = new Float32Array(n * 3), rand = new Float32Array(n * 4)
  const maxR = Math.hypot(PW / 2, PH / 2)
  tris.forEach((t, k) => {
    const cx = (t[0][0] + t[1][0] + t[2][0]) / 3
    const cy = (t[0][1] + t[1][1] + t[2][1]) / 3
    // assemble from the centre outward, with a little randomness
    const delay = Math.min(1, 0.65 * (Math.hypot(cx, cy) / maxR) + 0.35 * rnd())
    const r = [delay, rnd(), rnd(), rnd()]
    t.forEach((v, m) => {
      const o = k * 3 + m
      pos.set([v[0], v[1], 0], o * 3)
      uv.set([v[0] / PW + 0.5, v[1] / PH + 0.5], o * 2)
      ctr.set([cx, cy, 0], o * 3)
      rand.set(r, o * 4)
    })
  })
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(pos, 3))
  g.setAttribute('uv', new BufferAttribute(uv, 2))
  g.setAttribute('aCenter', new BufferAttribute(ctr, 3))
  g.setAttribute('aRand', new BufferAttribute(rand, 4))
  return g
}

/* ── scene ─────────────────────────────────────────────────────────── */

export async function createGlassScene({ canvas, mobile = false, forceGL = false }) {
  // failIfMajorPerformanceCaveat: software-rendered WebGL would stutter, so we
  // prefer the lightweight CSS fallback in that case.
  const renderer = new WebGLRenderer({
    canvas, antialias: !mobile, alpha: false, powerPreference: 'high-performance',
    failIfMajorPerformanceCaveat: !forceGL,
  })
  const dpr = Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 2)
  renderer.setPixelRatio(dpr)

  const loader = new TextureLoader()
  const urls = mobile ? [dMulM, dAddM, sMulM, sAddM] : [dMul, dAdd, sMul, sAdd]
  let textures
  try {
    textures = await Promise.all(urls.map((u) => loader.loadAsync(u)))
  } catch (e) {
    renderer.dispose()
    throw e
  }
  const maxAniso = renderer.capabilities.getMaxAnisotropy()
  textures.forEach((t) => { t.colorSpace = NoColorSpace; t.anisotropy = Math.min(4, maxAniso) })
  const [tdMul, tdAdd, tsMul, tsAdd] = textures

  const scene = new Scene()
  const camera = new PerspectiveCamera(FOV, 1, 0.1, 50)

  // aurora background (fullscreen, drawn first)
  const auroraMat = new ShaderMaterial({
    vertexShader: AURORA_VERT, fragmentShader: AURORA_FRAG, depthTest: false, depthWrite: false,
    uniforms: { uRes: { value: [1, 1] }, uTime: { value: 0 }, uAurora: { value: 0 } },
  })
  const aurora = new Mesh(new PlaneGeometry(2, 2), auroraMat)
  aurora.frustumCulled = false
  aurora.renderOrder = -10
  scene.add(aurora)

  // letters
  const cols = mobile ? 7 : 10, rows = mobile ? 5 : 8
  const layers = mobile ? [{ z: 0, s: 1, o: 1 }] : [{ z: -0.11, s: 1.02, o: 0.28 }, { z: 0, s: 1, o: 1 }]
  const uForm = { D: { value: 0 }, S: { value: 0 } }
  const sweep = { value: -0.5 }
  const disp = { value: 0.0035 }
  const glow = { value: 0 }
  const geoms = []
  const mats = []
  const letters = {}

  const makeLetter = (key, mulTex, addTex, seed, order) => {
    const group = new Group()
    const geom = buildShards(cols, rows, seed)
    geoms.push(geom)
    layers.forEach((L, li) => {
      const common = { transparent: true, depthTest: false, depthWrite: false, vertexShader: SHARD_VERT }
      const mulMat = new ShaderMaterial({
        ...common, fragmentShader: MUL_FRAG,
        blending: CustomBlending, blendEquation: AddEquation, blendSrc: DstColorFactor, blendDst: ZeroFactor,
        uniforms: { uForm: uForm[key], uMul: { value: mulTex }, uOpacity: { value: L.o } },
      })
      const addMat = new ShaderMaterial({
        ...common, fragmentShader: ADD_FRAG,
        blending: CustomBlending, blendEquation: AddEquation, blendSrc: OneFactor, blendDst: OneFactor,
        uniforms: {
          uForm: uForm[key], uAdd: { value: addTex }, uMul: { value: mulTex }, uOpacity: { value: L.o },
          uSweep: sweep, uDisp: disp, uGlow: glow,
        },
      })
      mats.push(mulMat, addMat)
      const m1 = new Mesh(geom, mulMat), m2 = new Mesh(geom, addMat)
      ;[m1, m2].forEach((m, k) => {
        m.frustumCulled = false
        m.renderOrder = order + li * 2 + k
        m.position.z = L.z
        m.scale.setScalar(L.s)
        group.add(m)
      })
    })
    scene.add(group)
    letters[key] = group
  }
  makeLetter('D', tdMul, tdAdd, 7, 0)
  makeLetter('S', tsMul, tsAdd, 19, 10)

  let aspect = 1
  let fitDist = 5.6
  let baseDx = 0.46
  let baseDy = 0.4
  const place = (join) => {
    // The pair starts slightly apart and converges as `join` goes 0 → 1.
    const k = 1 + 0.6 * (1 - join)
    letters.D.position.set(-baseDx * k, baseDy * (1 + 0.4 * (1 - join)), 0)
    letters.S.position.set(baseDx * k, -baseDy * (1 + 0.4 * (1 - join)), 0)
  }
  const layout = () => {
    // D above & slightly left, S below & slightly right, close enough that
    // their glass overlaps and they read as one monogram. Narrow screens pull
    // the pair tighter horizontally so it stays inside the viewport.
    baseDx = aspect < 0.8 ? 0.27 : 0.46
    baseDy = aspect < 0.8 ? 0.44 : 0.4
    place(1)
    const needW = (baseDx + PW / 2) * 2 * 1.2
    const needH = (baseDy + PH / 2) * 2 * 1.45
    const tanH = Math.tan((FOV * Math.PI) / 360)
    fitDist = Math.max(needH / (2 * tanH), needW / (2 * tanH * aspect))
  }

  const resize = () => {
    const w = canvas.clientWidth || window.innerWidth
    const h = canvas.clientHeight || window.innerHeight
    renderer.setSize(w, h, false)
    aspect = w / h
    camera.aspect = aspect
    camera.updateProjectionMatrix()
    auroraMat.uniforms.uRes.value = [w * dpr, h * dpr]
    layout()
  }
  resize()
  window.addEventListener('resize', resize)

  const onLost = (e) => { e.preventDefault(); canvas.dispatchEvent(new Event('dia-gl-lost')) }
  canvas.addEventListener('webglcontextlost', onLost)

  /*
    st: { time, aurora, formD, formS, cam (0..1), sweep, join (0..1) }
    Camera dollies in on a slow arc and settles on the final composition.
  */
  const draw = (st) => {
    auroraMat.uniforms.uTime.value = st.time
    auroraMat.uniforms.uAurora.value = st.aurora
    uForm.D.value = st.formD
    uForm.S.value = st.formS
    sweep.value = st.sweep
    glow.value = st.glow || 0
    place(st.join)
    const e = st.cam
    const dist = fitDist * (1 + 0.55 * (1 - e))
    camera.position.set(-1.1 * (1 - e), 0.18 - 0.38 * (1 - e), dist)
    camera.lookAt(0, (aspect < 0.8 ? -0.14 : -0.34) + 0.2 * (1 - e), 0)
    camera.rotation.z += 0.035 * (1 - e)
    renderer.render(scene, camera)
  }

  const dispose = () => {
    window.removeEventListener('resize', resize)
    canvas.removeEventListener('webglcontextlost', onLost)
    geoms.forEach((g) => g.dispose())
    mats.forEach((m) => m.dispose())
    aurora.geometry.dispose()
    auroraMat.dispose()
    textures.forEach((t) => t.dispose())
    renderer.dispose()
    renderer.forceContextLoss()
  }

  return { draw, resize, dispose }
}
