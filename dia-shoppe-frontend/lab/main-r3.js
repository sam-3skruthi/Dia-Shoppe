import * as THREE from 'three'
import { DESIGNS, centre } from './designs.js'
import { mountFibers } from './fibers.jsx'

/*
  Round 3 renderer: ONE transparent full-screen WebGL layer draws the three
  monograms into their frames (scissor views). Material = chrome that
  reflects a palette studio (Icy / Sky / Electric / Deep). Each pixel's
  alpha is multiplied by the ghost-fibre trail mask, so the letters show only
  where fibres pass. "Show full letters" lifts the mask to judge the design.
*/
const fiberMask = mountFibers(document.getElementById('fibers'))
const maskTex = new THREE.CanvasTexture(fiberMask)
maskTex.colorSpace = THREE.NoColorSpace
const maskSize = { w: 0, h: 0 }

const canvas = document.getElementById('gl')
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.setClearColor(0x000000, 0)
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.1
renderer.setScissorTest(true)

/* palette studio for the chrome to reflect */
function paletteEnvironment() {
  const env = new THREE.Scene()
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(50, 48, 24),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `varying vec3 vP;
        void main(){
          float y = vP.y;
          vec3 icy = vec3(0.878,0.969,0.980), sky = vec3(0.565,0.878,0.937), elec = vec3(0.0,0.706,0.847), deep = vec3(0.008,0.467,0.741), ink = vec3(0.008,0.071,0.145);
          vec3 c = y > 0.0 ? mix(sky, icy, smoothstep(0.0, 0.7, y)) : mix(elec, deep, smoothstep(0.0, -0.45, y));
          c = mix(c, ink, smoothstep(-0.45, -0.95, y));
          gl_FragColor = vec4(c * 1.15, 1.0);
        }`,
    }),
  )
  env.add(sky)
  // bright softbox strips: the long white streaks you see in chrome
  const strip = (w, h, x, y, z, ry, c = 0xffffff, k = 6) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(k), side: THREE.DoubleSide }))
    m.position.set(x, y, z)
    m.lookAt(0, 0, 0)
    m.rotateZ(ry)
    env.add(m)
  }
  strip(40, 4, 0, 22, 18, 0.2)
  strip(4, 36, -26, 4, 16, 0)
  strip(3, 30, 28, -2, 14, 0.15, 0xe0f7fa, 4)
  strip(30, 3, 4, -18, 22, -0.1, 0x90e0ef, 3)
  const pmrem = new THREE.PMREMGenerator(renderer)
  return pmrem.fromScene(env, 0.02).texture
}
const envMap = paletteEnvironment()

/* chrome + fibre mask */
const maskUniforms = { uMask: { value: maskTex }, uBuf: { value: new THREE.Vector2(1, 1) }, uBase: { value: 0 } }
function chrome(params) {
  const mat = new THREE.MeshPhysicalMaterial({ metalness: 1, envMap, envMapIntensity: 1.25, transparent: true, ...params })
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, maskUniforms)
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'uniform sampler2D uMask; uniform vec2 uBuf; uniform float uBase;\nvoid main() {')
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>
        // only the slice a fibre is crossing: hard-ish threshold, no haze
        float fm = smoothstep(0.22, 0.62, texture2D(uMask, gl_FragCoord.xy / uBuf).a);
        gl_FragColor.a *= clamp(max(fm, uBase), 0.0, 1.0);`)
  }
  return mat
}

const VIEWS = [
  { id: 'gothic', mat: chrome({ color: '#CAF0F8', roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.45 }) },
  { id: 'script', mat: chrome({ color: '#CAF0F8', roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.4 }) },
  { id: 'liquid', mat: chrome({ color: '#3D9FD6', roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.5 }) },
].map((v) => {
  const scene = new THREE.Scene()
  const pivot = new THREE.Group()
  const mono = DESIGNS[v.id](v.mat)
  const size = centre(mono)
  pivot.add(mono)
  scene.add(pivot)
  const key = new THREE.DirectionalLight('#E0F7FA', 1.4)
  key.position.set(-120, 200, 260)
  scene.add(key)
  const camera = new THREE.PerspectiveCamera(28, 1, 1, 4000)
  return { ...v, scene, pivot, camera, size, el: document.querySelector(`[data-view="${v.id}"]`) }
})

/* The monograms are STATIC: fixed, facing the viewer, never rotating or
   floating. Only the ghost fibres move; they are what reveals the letters. */

/* "show full letters" switch */
const toggle = document.getElementById('full')
toggle.addEventListener('change', () => { maskUniforms.uBase.value = toggle.checked ? 1 : 0 })

function resize() {
  const w = window.innerWidth
  const h = window.innerHeight
  renderer.setSize(w, h, false)
  const buf = renderer.getDrawingBufferSize(new THREE.Vector2())
  maskUniforms.uBuf.value.copy(buf)
}
window.addEventListener('resize', resize)
resize()

function frame() {
  if (fiberMask.dirty) {
    // WebGL2 textures have fixed-size storage: when the mask canvas changes
    // size (first frame, window resize) the old texture must be re-allocated
    if (fiberMask.width !== maskSize.w || fiberMask.height !== maskSize.h) {
      maskTex.dispose()
      maskSize.w = fiberMask.width
      maskSize.h = fiberMask.height
    }
    maskTex.needsUpdate = true
    fiberMask.dirty = false
  }
  renderer.setScissor(0, 0, window.innerWidth, window.innerHeight)
  renderer.clear()
  VIEWS.forEach((v) => {
    const r = v.el.getBoundingClientRect()
    if (r.bottom < 0 || r.top > window.innerHeight) return
    const x = r.left
    const y = window.innerHeight - r.bottom
    renderer.setViewport(x, y, r.width, r.height)
    renderer.setScissor(x, y, r.width, r.height)
    const cam = v.camera
    cam.aspect = r.width / r.height
    const fit = 2 * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2))
    cam.position.set(0, 0, Math.max((v.size.y * 1.35) / fit, (v.size.x * 1.35) / (fit * cam.aspect)))
    cam.updateProjectionMatrix()
    renderer.render(v.scene, cam)
  })
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
