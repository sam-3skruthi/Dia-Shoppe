import * as THREE from 'three'
import { MeshSurfaceSampler } from 'three/examples/jsm/math/MeshSurfaceSampler.js'

/*
  The approved Dia Shoppe D + S monogram (script chrome, S hanging below the
  D), built as real 3D geometry, no images. Used by DiaBackdrop.

  createMonogramRenderer(canvas, { shards }) →
    { render(), setSize(w, h), setMask(canvas), setShards(p), dispose() }
  `shards` (optional, a count — used by the loader) adds faceted glass shards
  scattered over the real surface of the letters; setShards(p) flies them in
  from all around (p 0 → 1, top of the D first) and they melt into the
  surface as they land.
  The monogram is STATIC: it never rotates or moves. Every pixel's alpha is
  multiplied by a mask canvas (the ghost-fibre + cursor trail), so the letters
  are seen only where light passes.
*/

const V = (x, y, z = 0) => new THREE.Vector3(x, y, z)

/* variable-radius tube along a smooth centre-line, ends capped */
function tube(points, radius, { samples = 320, radial = 28 } = {}) {
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal')
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
  const capStart = pos.length / 3
  pos.push(pts[0].x, pts[0].y, pts[0].z)
  const last = pts[pts.length - 1]
  pos.push(last.x, last.y, last.z)
  const lastRing = (pts.length - 1) * radial
  for (let k = 0; k < radial; k += 1) {
    idx.push(capStart, (k + 1) % radial, k)
    idx.push(capStart + 1, lastRing + k, lastRing + ((k + 1) % radial))
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setIndex(idx)
  geo.computeVertexNormals()
  return geo
}

const taper = (t, len) => Math.min(1, Math.sin(Math.min(1, t / len) * Math.PI / 2), Math.sin(Math.min(1, (1 - t) / len) * Math.PI / 2))

/* copperplate shading: vertical motion swells, horizontal is a hairline */
const copper = (min, max) => (t, T) => {
  const r = (min + (max - min) * Math.pow(Math.abs(T.y), 2.2)) * taper(t, 0.06)
  return [r, r * 0.85]
}

function scriptMonogram(material) {
  const group = new THREE.Group()
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
  s.position.set(70, -112, 12)        // the S hangs below, starting at the D's base loop
  group.add(d, s)
  // centre on the origin
  const box = new THREE.Box3().setFromObject(group)
  const c = box.getCenter(new THREE.Vector3())
  group.children.forEach((m) => m.position.sub(c))
  return { group, size: box.getSize(new THREE.Vector3()) }
}

/* a studio in palette colours for the chrome to reflect */
function paletteEnvironment(renderer) {
  const env = new THREE.Scene()
  env.add(new THREE.Mesh(
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
  ))
  const strip = (w, h, x, y, z, rz, color, k) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), side: THREE.DoubleSide }))
    m.position.set(x, y, z)
    m.lookAt(0, 0, 0)
    m.rotateZ(rz)
    env.add(m)
  }
  strip(40, 4, 0, 22, 18, 0.2, 0xe0f7fa, 6)
  strip(4, 36, -26, 4, 16, 0, 0xe0f7fa, 6)
  strip(3, 30, 28, -2, 14, 0.15, 0xe0f7fa, 4)
  strip(30, 3, 4, -18, 22, -0.1, 0x90e0ef, 3)
  const pmrem = new THREE.PMREMGenerator(renderer)
  const tex = pmrem.fromScene(env, 0.02).texture
  pmrem.dispose()
  return tex
}

export function createMonogramRenderer(canvas, { shards = 0 } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
  renderer.setClearColor(0x000000, 0)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.1

  const maskTex = new THREE.CanvasTexture(document.createElement('canvas'))
  maskTex.colorSpace = THREE.NoColorSpace
  const uniforms = { uMask: { value: maskTex }, uBuf: { value: new THREE.Vector2(1, 1) } }

  const material = new THREE.MeshPhysicalMaterial({
    color: '#CAF0F8', metalness: 1, roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.02,
    envMap: paletteEnvironment(renderer), envMapIntensity: 1.4, transparent: true,
  })
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'uniform sampler2D uMask; uniform vec2 uBuf;\nvoid main() {')
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>
        // only the slice a fibre (or the cursor) is crossing shows
        float fm = smoothstep(0.22, 0.62, texture2D(uMask, gl_FragCoord.xy / uBuf).a);
        gl_FragColor.a *= fm;`)
  }

  const scene = new THREE.Scene()
  const { group, size } = scriptMonogram(material)
  scene.add(group)
  const key = new THREE.DirectionalLight('#E0F7FA', 1.4)
  key.position.set(-120, 200, 260)
  scene.add(key)
  const camera = new THREE.PerspectiveCamera(28, 1, 1, 4000)

  let maskSize = [0, 0]
  const shardLayer = shards > 0 ? buildShards(group, size, shards, material.envMap) : null
  if (shardLayer) scene.add(shardLayer.mesh)

  return {
    setSize(w, h) {
      renderer.setSize(w, h, false)
      uniforms.uBuf.value.copy(renderer.getDrawingBufferSize(new THREE.Vector2()))
      camera.aspect = w / h
      // the monogram fills ~78% of the viewport height (and never overflows the width)
      const fit = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
      camera.position.set(0, 0, Math.max(size.y / (0.78 * fit), size.x / (0.6 * fit * camera.aspect)))
      camera.updateProjectionMatrix()
    },
    setMask(maskCanvas) {
      if (maskTex.image !== maskCanvas || maskCanvas.width !== maskSize[0] || maskCanvas.height !== maskSize[1]) {
        // WebGL2 texture storage is fixed-size: re-allocate when the mask resizes
        maskTex.dispose()
        maskTex.image = maskCanvas
        maskSize = [maskCanvas.width, maskCanvas.height]
      }
      maskTex.needsUpdate = true
    },
    setShards(p) { shardLayer?.update(p) },
    render() { renderer.render(scene, camera) },
    dispose() {
      scene.traverse((o) => { if (o.geometry) o.geometry.dispose() })
      shardLayer?.mesh.material.dispose()
      material.envMap?.dispose()
      material.dispose()
      maskTex.dispose()
      renderer.dispose()
    },
  }
}

/* ── glass shards that assemble onto the monogram (loader) ─────────────── */
const easeOutCubic = (t) => 1 - (1 - t) ** 3

function buildShards(group, size, count, envMap) {
  group.updateMatrixWorld(true)
  const meshes = group.children
  // spread the shards over both letters in proportion to their surface
  const homes = []
  const normals = []
  const p = new THREE.Vector3()
  const n = new THREE.Vector3()
  meshes.forEach((mesh, mi) => {
    const sampler = new MeshSurfaceSampler(mesh).build()
    const share = mi === meshes.length - 1 ? count - homes.length : Math.round(count / meshes.length)
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld)
    for (let i = 0; i < share; i += 1) {
      sampler.sample(p, n)
      homes.push(p.clone().applyMatrix4(mesh.matrixWorld))
      normals.push(n.clone().applyMatrix3(normalMatrix).normalize())
    }
  })

  const geo = new THREE.OctahedronGeometry(1.7, 0)
  geo.scale(1, 1.9, 0.8)                                   // a slim crystal
  const mat = new THREE.MeshPhysicalMaterial({
    color: '#E0F7FA', metalness: 0.35, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.02,
    iridescence: 0.9, iridescenceIOR: 1.35, envMap, envMapIntensity: 1.6, flatShading: true,
  })
  const mesh = new THREE.InstancedMesh(geo, mat, homes.length)
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  const tint = ['#E0F7FA', '#90E0EF', '#00B4D8', '#CAF0F8'].map((c) => new THREE.Color(c))
  const top = size.y / 2
  const shardsData = homes.map((home, i) => {
    mesh.setColorAt(i, tint[(Math.random() * tint.length) | 0])
    // start far out, mostly around and in front of the letters
    // close enough to be on screen from the very first moment
    const from = new THREE.Vector3().randomDirection().multiplyScalar(size.y * (0.45 + Math.random() * 0.75))
    from.z = Math.abs(from.z) * 0.6 + size.y * 0.1
    return {
      home,
      from,
      // top of the D arrives first, then down through the S, with some scatter
      delay: ((top - home.y) / size.y) * 0.75 + Math.random() * 0.25,
      scale: 0.55 + Math.random() ** 2 * 1.2,
      spin: new THREE.Euler(Math.random() * 7, Math.random() * 7, Math.random() * 7),
      rest: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), normals[i]),
    }
  })
  mesh.instanceColor.needsUpdate = true

  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const qs = new THREE.Quaternion()
  const pos = new THREE.Vector3()
  const sc = new THREE.Vector3()
  const update = (progress) => {
    mesh.visible = progress < 1
    if (!mesh.visible) return
    shardsData.forEach((s, i) => {
      // each shard: 45% of the timeline to fly in, staggered by its delay
      const local = Math.min(1, Math.max(0, (progress - s.delay * 0.55) / 0.45))
      const k = easeOutCubic(local)
      pos.lerpVectors(s.from, s.home, k)
      qs.setFromEuler(new THREE.Euler(s.spin.x * (1 - k), s.spin.y * (1 - k), s.spin.z * (1 - k)))
      q.copy(s.rest).multiply(qs)
      // appears as it starts moving, then melts into the surface on landing
      const grow = Math.min(1, local * 6)
      const melt = local > 0.82 ? 1 - (local - 0.82) / 0.18 : 1
      sc.setScalar(s.scale * grow * melt)
      m.compose(pos, q, sc)
      mesh.setMatrixAt(i, m)
    })
    mesh.instanceMatrix.needsUpdate = true
  }
  update(0)
  return { mesh, update }
}
