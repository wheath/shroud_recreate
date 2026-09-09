// shroud_recreate — MVP web app
// Serverless: pure static files + Three.js from CDN. No backend.
// Implements the core of sprint 1:
//   #53 load + maneuver the working model (2D authority, 3D inspect)
//   #54 the cutting (shroud) plane
//   #55 distance-to-grayscale projection via the WebGL depth buffer
//
// The projection is done by rendering the model with an orthographic camera
// looking along the plane normal, into a depth texture, then mapping depth to
// grayscale (farthest = 0, closest = 1) with no tone adjustment of any kind.

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";

const MODEL_URL = "../third_party/moraes/body_3d_dec5000.obj";

// ---------------------------------------------------------------- state
const state = {
  model: null,          // THREE.Object3D (the working model)
  modelSize: 1,         // bounding size, for framing
  planeY: 0,            // cutting/shroud plane height (world Y)
  projReso: 256,        // projection render-target resolution
};

// ---------------------------------------------------------------- 3D inspect view
const view3d = makeViewport(document.getElementById("view3d"), { perspective: true });
view3d.camera.position.set(2.4, 1.6, 2.4);
const controls3d = new OrbitControls(view3d.camera, view3d.renderer.domElement);
controls3d.enableDamping = true;

// ---------------------------------------------------------------- 2D authority view
// Orthographic camera looking straight down the plane normal (world -Y).
const view2d = makeViewport(document.getElementById("view2d"), { perspective: false });
positionTopDownCamera(view2d.camera, 4);

// ---------------------------------------------------------------- shared scene content
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x14161a);

const hemi = new THREE.HemisphereLight(0xffffff, 0x202024, 1.1);
scene.add(hemi);
const key = new THREE.DirectionalLight(0xffffff, 0.6);
key.position.set(2, 4, 3);
scene.add(key);

// cutting / shroud plane (issue #54)
const planeGeo = new THREE.PlaneGeometry(3, 3);
const planeMat = new THREE.MeshBasicMaterial({
  color: 0x3d7bd4, transparent: true, opacity: 0.16, side: THREE.DoubleSide,
  depthWrite: false,
});
const planeMesh = new THREE.Mesh(planeGeo, planeMat);
planeMesh.rotation.x = -Math.PI / 2;            // horizontal, normal = +Y
scene.add(planeMesh);
const planeGrid = new THREE.GridHelper(3, 12, 0x3d7bd4, 0x2a3550);
planeGrid.material.transparent = true;
planeGrid.material.opacity = 0.35;
scene.add(planeGrid);

// a faint ground reference
const axes = new THREE.AxesHelper(0.6);
scene.add(axes);

// ---------------------------------------------------------------- projection setup (#55)
// Orthographic camera looking DOWN onto the model from the plane.
const projCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 10);
const depthTarget = new THREE.WebGLRenderTarget(state.projReso, state.projReso, {
  minFilter: THREE.NearestFilter,
  magFilter: THREE.NearestFilter,
  depthTexture: new THREE.DepthTexture(state.projReso, state.projReso),
  depthBuffer: true,
});
// Separate color target: we sample depthTarget's depth texture while writing
// color HERE, so we never read and write the same target in one pass.
const grayTarget = new THREE.WebGLRenderTarget(state.projReso, state.projReso, {
  minFilter: THREE.NearestFilter,
  magFilter: THREE.NearestFilter,
});
// Read depth by rendering a fullscreen pass that samples the depth texture.
const depthReadScene = new THREE.Scene();
const depthReadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const depthReadMat = new THREE.ShaderMaterial({
  uniforms: {
    tDepth: { value: depthTarget.depthTexture },
    spanNear: { value: 0.0 },
    spanFar: { value: 1.0 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
  `,
  // Orthographic depth is already LINEAR in [0,1] across [near, far].
  // We normalize to the model's actual distance span [spanNear, spanFar]
  // (set each frame) so the full grayscale range is used. Nearest-to-plane = 1
  // (white), farthest = 0 (black). No tone curve — pure linear (#55).
  fragmentShader: `
    varying vec2 vUv;
    uniform sampler2D tDepth;
    uniform float spanNear;   // smallest depth occupied by the model (0..1)
    uniform float spanFar;    // largest depth occupied by the model (0..1)
    void main(){
      float d = texture2D(tDepth, vUv).r;
      if (d >= 0.99999) { gl_FragColor = vec4(0.0,0.0,0.0,1.0); return; } // background
      float t = (d - spanNear) / max(spanFar - spanNear, 1e-5);  // 0 near .. 1 far
      float g = clamp(1.0 - t, 0.0, 1.0);                        // near -> white
      gl_FragColor = vec4(g, g, g, 1.0);
    }
  `,
});
depthReadScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), depthReadMat));

const projCanvas = document.getElementById("projCanvas");
const projCtx = projCanvas.getContext("2d");
projCanvas.width = state.projReso;
projCanvas.height = state.projReso;
const projPixels = new Uint8Array(state.projReso * state.projReso * 4);

// ---------------------------------------------------------------- load model (#53, #56 default)
const loader = new OBJLoader();
setStatus("Loading model…");
loader.load(
  MODEL_URL,
  (obj) => {
    const mat = new THREE.MeshStandardMaterial({ color: 0xb9b7ad, roughness: 0.95, metalness: 0.0 });
    obj.traverse((c) => { if (c.isMesh) c.material = mat; });
    // center + scale to unit-ish size
    const box = new THREE.Box3().setFromObject(obj);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    state.modelSize = Math.max(size.x, size.y, size.z);
    const s = 2.0 / state.modelSize;
    obj.scale.setScalar(s);
    obj.position.sub(center.multiplyScalar(s));
    obj.position.y += 0.0;
    scene.add(obj);
    state.model = obj;
    // seat the plane just above the model's top
    const nb = new THREE.Box3().setFromObject(obj);
    state.planeY = nb.max.y + 0.25;
    syncPlane();
    setStatus("Ready");
    render();
  },
  (xhr) => setStatus(`Loading model… ${((xhr.loaded / (xhr.total || xhr.loaded)) * 100) | 0}%`),
  (err) => { console.error(err); setStatus("Model failed to load — check that third_party/moraes/ is present.", true); }
);

// ---------------------------------------------------------------- transform: 2D is authority (#53)
// Dragging in the 2D view rotates/moves the model; the 3D view reflects it.
let drag = null;
view2d.renderer.domElement.addEventListener("pointerdown", (e) => {
  drag = { x: e.clientX, y: e.clientY, mode: e.shiftKey ? "move" : "rotate" };
  view2d.renderer.domElement.setPointerCapture(e.pointerId);
});
view2d.renderer.domElement.addEventListener("pointermove", (e) => {
  if (!drag || !state.model) return;
  const dx = (e.clientX - drag.x), dy = (e.clientY - drag.y);
  drag.x = e.clientX; drag.y = e.clientY;
  if (drag.mode === "rotate") {
    state.model.rotation.y += dx * 0.01;
    state.model.rotation.x += dy * 0.01;
  } else {
    state.model.position.x += dx * 0.004;
    state.model.position.z += dy * 0.004;
  }
  render();
});
view2d.renderer.domElement.addEventListener("pointerup", (e) => {
  drag = null;
  try { view2d.renderer.domElement.releasePointerCapture(e.pointerId); } catch {}
});

// ---------------------------------------------------------------- plane height control (#54)
const planeSlider = document.getElementById("planeHeight");
planeSlider.addEventListener("input", () => {
  state.planeY = parseFloat(planeSlider.value);
  syncPlane();
  render();
});

function syncPlane() {
  planeMesh.position.y = state.planeY;
  planeGrid.position.y = state.planeY;
  planeSlider.value = String(state.planeY);
}

// ---------------------------------------------------------------- render loop
function positionTopDownCamera(cam, half) {
  cam.left = -half; cam.right = half; cam.top = half; cam.bottom = -half;
  cam.near = -10; cam.far = 10;
  cam.position.set(0, 5, 0);
  cam.up.set(0, 0, -1);
  cam.lookAt(0, 0, 0);
  cam.updateProjectionMatrix();
}

function makeViewport(canvas, { perspective }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const w = canvas.clientWidth || 400, h = canvas.clientHeight || 400;
  renderer.setSize(w, h, false);
  let camera;
  if (perspective) {
    camera = new THREE.PerspectiveCamera(45, w / h, 0.01, 100);
  } else {
    camera = new THREE.OrthographicCamera(-2, 2, 2, -2, -10, 10);
  }
  return { renderer, camera };
}

function runProjection() {
  if (!state.model) return;
  // Frame the ortho projection camera to the model footprint.
  const half = 1.4;
  projCam.left = -half; projCam.right = half; projCam.top = half; projCam.bottom = -half;
  // Camera sits on the plane looking straight down (-Y). near/far bracket the
  // model's actual vertical extent so orthographic depth spans the model.
  const box = new THREE.Box3().setFromObject(state.model);
  const gapTop = Math.max(state.planeY - box.max.y, 0.001);      // plane to nearest point
  const gapBot = Math.max(state.planeY - box.min.y, gapTop + 0.001); // plane to farthest
  projCam.near = gapTop;
  projCam.far = gapBot;
  projCam.position.set(0, state.planeY, 0);
  projCam.up.set(0, 0, -1);
  projCam.lookAt(0, state.planeY - 1, 0);
  projCam.updateProjectionMatrix();
  // Model fully spans [near, far] now, so use the whole normalized range.
  depthReadMat.uniforms.spanNear.value = 0.0;
  depthReadMat.uniforms.spanFar.value = 1.0;

  // Hide plane + helpers so only the model contributes to depth.
  planeMesh.visible = false; planeGrid.visible = false; axes.visible = false;
  view3d.renderer.setRenderTarget(depthTarget);
  view3d.renderer.clear();
  view3d.renderer.render(scene, projCam);
  // Grayscale pass: sample depthTarget's depth, write into grayTarget, read it.
  view3d.renderer.setRenderTarget(grayTarget);
  view3d.renderer.clear();
  view3d.renderer.render(depthReadScene, depthReadCam);
  view3d.renderer.readRenderTargetPixels(grayTarget, 0, 0, state.projReso, state.projReso, projPixels);
  view3d.renderer.setRenderTarget(null);
  planeMesh.visible = true; planeGrid.visible = true; axes.visible = true;

  // Blit to the 2D projection canvas (flip Y — GL origin is bottom-left).
  const img = projCtx.createImageData(state.projReso, state.projReso);
  const N = state.projReso;
  for (let y = 0; y < N; y++) {
    const src = (N - 1 - y) * N * 4;
    const dst = y * N * 4;
    img.data.set(projPixels.subarray(src, src + N * 4), dst);
  }
  projCtx.putImageData(img, 0, 0);
}

function render() {
  view3d.renderer.render(scene, view3d.camera);
  view2d.renderer.render(scene, view2d.camera);
  runProjection();
}

function animate() {
  requestAnimationFrame(animate);
  controls3d.update();
  view3d.renderer.render(scene, view3d.camera);
}
animate();

function setStatus(msg, isError = false) {
  const el = document.getElementById("status");
  el.textContent = msg;
  el.style.color = isError ? "#e0736f" : "#8a8f99";
}

addEventListener("resize", () => {
  for (const v of [view3d, view2d]) {
    const c = v.renderer.domElement;
    const w = c.clientWidth, h = c.clientHeight;
    v.renderer.setSize(w, h, false);
    if (v.camera.isPerspectiveCamera) { v.camera.aspect = w / h; v.camera.updateProjectionMatrix(); }
  }
  render();
});
