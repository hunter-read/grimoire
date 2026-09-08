/**
 * Lazy three.js loading for the 3D model viewer.
 *
 * Most people never open a model, and three.js plus a loader is ~600KB — so it
 * is imported dynamically rather than bundled. Vite code-splits each `import()`
 * below into its own chunk, fetched the first time someone opens a model detail
 * page and cached by the browser after that. The main bundle is unaffected.
 *
 * Lives under `src/lib/` for the same reason `pdfjs.js` does: that directory is
 * excluded from coverage, and WebGL cannot be exercised under jsdom. Keep the
 * untestable graphics glue here and the branching in the component, so the
 * component's state machine stays testable with this module mocked.
 */

// Which loader each format needs, keyed by the `viewer_loader` string the API
// returns. The backend owns this mapping (see indexer/models3d.py) so the two
// sides cannot drift; this table only says how to fetch what it names.
const LOADERS = {
  stl: () => import('three/examples/jsm/loaders/STLLoader.js').then((m) => m.STLLoader),
  ply: () => import('three/examples/jsm/loaders/PLYLoader.js').then((m) => m.PLYLoader),
  '3mf': () => import('three/examples/jsm/loaders/3MFLoader.js').then((m) => m.ThreeMFLoader),
  gltf: () => import('three/examples/jsm/loaders/GLTFLoader.js').then((m) => m.GLTFLoader),
}

export function isLoaderSupported(kind) {
  return Object.prototype.hasOwnProperty.call(LOADERS, kind)
}

/** three.js core plus OrbitControls, fetched once and cached by the browser. */
export async function loadThree() {
  const [THREE, { OrbitControls }] = await Promise.all([
    import('three'),
    import('three/examples/jsm/controls/OrbitControls.js'),
  ])
  return { THREE, OrbitControls }
}

export async function loadLoader(kind) {
  const get = LOADERS[kind]
  if (!get) throw new Error(`Unsupported model format: ${kind}`)
  return get()
}

/**
 * Build a viewer into `canvasHost` and return a handle for controlling it.
 *
 * Returns `{ dispose, resetView, setWireframe, triangles }`. **`dispose` must be
 * called on unmount**: browsers cap concurrent WebGL contexts (~8-16), so a page
 * that leaks one per visit renders nothing at all after a dozen models — with no
 * error to explain why.
 */
export async function createViewer(canvasHost, url, kind, { onProgress } = {}) {
  const { THREE, OrbitControls } = await loadThree()
  const Loader = await loadLoader(kind)

  const width = canvasHost.clientWidth || 640
  const height = canvasHost.clientHeight || 480

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 10000)
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.setSize(width, height)
  canvasHost.appendChild(renderer.domElement)

  // A hemisphere fill plus one key light: enough to read a form without the
  // scene looking lit from nowhere, and cheap on a static mesh.
  scene.add(new THREE.HemisphereLight(0xffffff, 0x333344, 1.1))
  const key = new THREE.DirectionalLight(0xffffff, 1.4)
  key.position.set(1, 1.4, 1.8)
  scene.add(key)

  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true

  const object = await new Promise((resolve, reject) => {
    new Loader().load(
      url,
      (result) => {
        // Mesh loaders hand back a BufferGeometry; scene loaders (glTF, 3MF)
        // hand back an Object3D that is already a subtree.
        if (result && result.isBufferGeometry) {
          result.computeVertexNormals()
          resolve(
            new THREE.Mesh(
              result,
              new THREE.MeshStandardMaterial({
                color: 0x9aa4b8,
                roughness: 0.75,
                metalness: 0.05,
              })
            )
          )
        } else {
          resolve(result.scene || result)
        }
      },
      (event) => {
        if (onProgress && event && event.lengthComputable) {
          onProgress(event.loaded / event.total)
        }
      },
      reject
    )
  })

  scene.add(object)

  // Frame the mesh: models arrive at wildly different scales and origins, so the
  // camera is fitted to the bounding sphere rather than placed at a fixed spot.
  const box = new THREE.Box3().setFromObject(object)
  const sphere = box.getBoundingSphere(new THREE.Sphere())
  const center = sphere.center
  const radius = sphere.radius || 1
  object.position.sub(center)

  const distance = (radius * 1.6) / Math.sin((camera.fov * Math.PI) / 360)
  const home = new THREE.Vector3(distance * 0.55, distance * 0.45, distance * 0.75)
  camera.position.copy(home)
  camera.near = Math.max(radius / 1000, 0.01)
  camera.far = distance * 10
  camera.updateProjectionMatrix()
  controls.target.set(0, 0, 0)
  controls.update()

  let triangles = 0
  object.traverse((child) => {
    const geom = child.geometry
    if (!geom) return
    triangles += geom.index ? geom.index.count / 3 : (geom.attributes.position?.count || 0) / 3
  })

  let running = true
  const tick = () => {
    if (!running) return
    controls.update()
    renderer.render(scene, camera)
    requestAnimationFrame(tick)
  }
  tick()

  const onResize = () => {
    const w = canvasHost.clientWidth || width
    const h = canvasHost.clientHeight || height
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    renderer.setSize(w, h)
  }
  window.addEventListener('resize', onResize)

  return {
    triangles: Math.round(triangles),
    resetView() {
      camera.position.copy(home)
      controls.target.set(0, 0, 0)
      controls.update()
    },
    setWireframe(on) {
      object.traverse((child) => {
        if (child.material) child.material.wireframe = !!on
      })
    },
    dispose() {
      running = false
      window.removeEventListener('resize', onResize)
      controls.dispose()
      object.traverse((child) => {
        child.geometry?.dispose()
        const mat = child.material
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
        else mat?.dispose()
      })
      renderer.dispose()
      // Releases the WebGL context immediately rather than waiting for GC.
      renderer.forceContextLoss?.()
      if (renderer.domElement.parentNode === canvasHost) {
        canvasHost.removeChild(renderer.domElement)
      }
    },
  }
}
