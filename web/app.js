// shroud_recreate — MVP web app
// Serverless: pure static files + Three.js from CDN. No backend.
// Sprint 1 core:
//   #53 load + maneuver the working model (2D view = authority, 3D view = inspect)
//   #54 the cutting (shroud) plane
//   #55 distance-to-grayscale projection
//   #56 default public-domain reference image, loaded on init
//
// Projection method (adopted from an earlier prototype, cleaner than reading the
// depth buffer): render the mesh with a shader that outputs *world Y* as gray,
// normalized to the model's face-region Y span. Because the cutting plane is
// horizontal, world-Y IS the distance to the plane. Farthest = 0 (black),
// closest = 1 (white), linear, no tone curve.
//
// LIMITATION (documented on purpose): this world-Y shortcut assumes a HORIZONTAL
// plane. When the plane is allowed to tilt (later epic), switch to measuring
// distance along the plane normal (transform verts into plane space, or read a
// depth buffer rendered along the plane normal).

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";

const MODEL_URL = "../third_party/moraes/body_3d_dec5000.obj";

// Face+neck region bounds, measured from the Moraes mesh (original coords).
// Reused from prototype metadata so the projection frames the head, not the
// whole body. If the model file changes, recompute these from the mesh.
const HEAD = {
  x: [-0.21769897639751434, 0.26493290066719055],
  y: [-0.26608800888061523, 0.24115604162216187],
  z: [-1.3547191619873047, -0.7841088175773621],
};
const hcx = (HEAD.x[0] + HEAD.x[1]) / 2;
const hcz = (HEAD.z[0] + HEAD.z[1]) / 2;
const hw = HEAD.x[1] - HEAD.x[0];
const hd = HEAD.z[1] - HEAD.z[0];

const PROJ_W = 220, PROJ_H = 280;

const state = {
  mesh3: null,     // mesh in the 3D inspect scene
  meshP: null,     // same geometry in the projection scene (identical pose)
  planeY: 1.4,     // cutting plane height (original model coords)
};

// ---------------------------------------------------------------- viewports
function makeViewport(canvas, { perspective }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const w = canvas.clientWidth || 400, h = canvas.clientHeight || 400;
  renderer.setSize(w, h, false);
  const camera = perspective
    ? new THREE.PerspectiveCamera(45, w / h, 0.01, 100)
    : new THREE.OrthographicCamera(-1, 1, 1, -1, -100, 100);
  return { renderer, camera };
}

const view3d = makeViewport(document.getElementById("view3d"), { perspective: true });
const controls3d = new OrbitControls(view3d.camera, view3d.renderer.domElement);
controls3d.enableDamping = true;

const view2d = makeViewport(document.getElementById("view2d"), { perspective: false });

// ---------------------------------------------------------------- shared scene
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x14161a);
scene.add(new THREE.HemisphereLight(0xbfc7d2, 0x1a1a1f, 0.9));
const dl = new THREE.DirectionalLight(0xffffff, 0.85); dl.position.set(3, 6, 5); scene.add(dl);
const dl2 = new THREE.DirectionalLight(0x88a0c0, 0.3); dl2.position.set(-4, 2, -5); scene.add(dl2);

// cutting / shroud plane, framed over the head (#54)
const planeMesh = new THREE.Mesh(
  new THREE.PlaneGeometry(hw * 1.3, hd * 1.3),
  new THREE.MeshBasicMaterial({ color: 0x3d7bd4, transparent: true, opacity: 0.15,
    side: THREE.DoubleSide, depthWrite: false })
);
planeMesh.rotation.x = -Math.PI / 2;
planeMesh.position.set(hcx, state.planeY, hcz);
scene.add(planeMesh);
const planeEdge = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.PlaneGeometry(hw * 1.3, hd * 1.3)),
  new THREE.LineBasicMaterial({ color: 0x3d7bd4, transparent: true, opacity: 0.6 })
);
planeEdge.rotation.x = -Math.PI / 2;
planeEdge.position.copy(planeMesh.position);
scene.add(planeEdge);

// projection box over the head, showing what the 2D projection captures
const projBox = new THREE.Box3(
  new THREE.Vector3(HEAD.x[0], HEAD.y[0] - 0.05, HEAD.z[0]),
  new THREE.Vector3(HEAD.x[1], state.planeY, HEAD.z[1])
);
const boxHelper = new THREE.Box3Helper(projBox, 0x5a8fb0);
scene.add(boxHelper);

// ---------------------------------------------------------------- projection (#55)
// Separate scene: the SAME geometry with a world-Y -> gray shader.
const sceneP = new THREE.Scene();
const distMat = new THREE.ShaderMaterial({
  uniforms: { yMin: { value: 0 }, yMax: { value: 1 } },
  vertexShader: `
    varying float wY;
    void main(){
      vec4 wp = modelMatrix * vec4(position, 1.0);
      wY = wp.y;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `,
  // world-Y normalized to the head span; near the plane (high Y) -> white.
  fragmentShader: `
    uniform float yMin, yMax;
    varying float wY;
    void main(){
      float t = clamp((wY - yMin) / max(yMax - yMin, 1e-5), 0.0, 1.0);
      gl_FragColor = vec4(vec3(t), 1.0);   // high Y (near plane) = white
    }
  `,
  side: THREE.DoubleSide,
});

// orthographic camera aligned with the (horizontal) plane, framed on the head
const mx = hw * 0.12, mz = hd * 0.12;
const halfW = hw / 2 + mx, halfH = hd / 2 + mz;
const camP = new THREE.OrthographicCamera(-halfW, halfW, halfH, -halfH, 0.01, 40);
camP.up.set(0, 0, -1);                    // head (low z) toward top of image
camP.position.set(hcx, 20.0, hcz);
camP.lookAt(hcx, -2.0, hcz);

const projCanvas = document.getElementById("projCanvas");
projCanvas.width = PROJ_W; projCanvas.height = PROJ_H;
const projCtx = projCanvas.getContext("2d");
const rP = new THREE.WebGLRenderer({ antialias: true, canvas: document.createElement("canvas") });
rP.setPixelRatio(1); rP.setSize(PROJ_W, PROJ_H);
const projTarget = new THREE.WebGLRenderTarget(PROJ_W, PROJ_H);
const pix = new Uint8Array(PROJ_W * PROJ_H * 4);
let headLocal = null;   // face-region vertex positions, for computing yMin/yMax

// ---------------------------------------------------------------- load model (#53)
setStatus("Loading model…");
new OBJLoader().load(
  MODEL_URL,
  (obj) => {
    let geo = null;
    obj.traverse((c) => { if (c.isMesh && !geo) geo = c.geometry; });
    if (!geo) { setStatus("No mesh found in model file.", true); return; }
    geo.computeVertexNormals();

    const mat3 = new THREE.MeshStandardMaterial({ color: 0xcfcabb, roughness: 0.85, metalness: 0.0 });
    state.mesh3 = new THREE.Mesh(geo, mat3);
    scene.add(state.mesh3);
    state.meshP = new THREE.Mesh(geo, distMat);
    sceneP.add(state.meshP);

    headLocal = collectHeadVerts(geo);

    frame3dCamera();
    setStatus(`Ready · ${(geo.getAttribute("position").count).toLocaleString()} verts`);
    render();
  },
  (xhr) => setStatus(`Loading model… ${((xhr.loaded / (xhr.total || xhr.loaded)) * 100) | 0}%`),
  (err) => { console.error(err); setStatus("Model failed to load — is third_party/moraes/ served?", true); }
);

// keep only vertices inside the head X/Z box, for the yMin/yMax normalization
function collectHeadVerts(geo) {
  const p = geo.getAttribute("position");
  const out = [];
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    if (x >= HEAD.x[0] && x <= HEAD.x[1] && z >= HEAD.z[0] && z <= HEAD.z[1]) {
      out.push(x, y, z);
    }
  }
  return new Float32Array(out);
}

// ---------------------------------------------------------------- pose sync (2D authority, #53)
// One shared pose drives both the inspect mesh and the projection mesh.
// Dragging in the 2D view sets that pose; the 3D view reflects it.
const pose = { rx: 0, ry: 0, rz: 0, tx: 0, tz: 0 };

function applyPose() {
  if (!state.mesh3) return;
  for (const m of [state.mesh3, state.meshP]) {
    m.rotation.set(pose.rx, pose.ry, pose.rz);
    m.position.set(pose.tx, 0, pose.tz);
    m.updateMatrixWorld();
  }
}

function updateProjNormalization() {
  if (!headLocal || !state.meshP) return;
  const m = state.meshP.matrixWorld;
  const v = new THREE.Vector3();
  let mn = 1e9, mx2 = -1e9;
  for (let i = 0; i < headLocal.length; i += 3) {
    v.set(headLocal[i], headLocal[i + 1], headLocal[i + 2]).applyMatrix4(m);
    if (v.y < mn) mn = v.y;
    if (v.y > mx2) mx2 = v.y;
  }
  distMat.uniforms.yMin.value = mn;   // farthest from plane -> 0 (black)
  distMat.uniforms.yMax.value = mx2;  // nearest the plane   -> 1 (white)
}

// drag in 2D view = authority
let drag = null;
const el2d = view2d.renderer.domElement;
el2d.addEventListener("pointerdown", (e) => {
  drag = { x: e.clientX, y: e.clientY, mode: e.shiftKey ? "move" : "rotate" };
  el2d.setPointerCapture(e.pointerId);
});
el2d.addEventListener("pointermove", (e) => {
  if (!drag || !state.mesh3) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  drag.x = e.clientX; drag.y = e.clientY;
  if (drag.mode === "rotate") { pose.ry += dx * 0.01; pose.rx += dy * 0.01; }
  else { pose.tx += dx * 0.003; pose.tz += dy * 0.003; }
  render();
});
el2d.addEventListener("pointerup", (e) => {
  drag = null;
  try { el2d.releasePointerCapture(e.pointerId); } catch {}
});

// ---------------------------------------------------------------- reference image (#56)
// Load the committed public-domain reference on init; fall back to load-your-own
// if the file isn't present. User-loaded images stay in the browser.
const REFERENCE_URL = "../reference/shroud_of_turin_pos_neg_face.jpg";
const refImg = document.getElementById("refImg");
const refEmpty = document.getElementById("refEmpty");
const refWrap = document.getElementById("refWrap");
const refFile = document.getElementById("refFile");

function showRef(src) {
  refImg.src = src;
  refImg.style.display = "block";
  refEmpty.style.display = "none";
}
function refFallbackMessage() {
  refEmpty.textContent = "click to load a reference image (stays in your browser)";
  refEmpty.style.display = "block";
  refImg.style.display = "none";
}
// try the default; if it 404s or errors, drop to load-your-own
refImg.addEventListener("error", refFallbackMessage);
(function loadDefaultReference() {
  const probe = new Image();
  probe.onload = () => showRef(REFERENCE_URL);
  probe.onerror = refFallbackMessage;
  probe.src = REFERENCE_URL;
})();
// load-your-own override
refWrap.addEventListener("click", () => refFile.click());
refFile.addEventListener("change", (e) => {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  showRef(URL.createObjectURL(f));   // object URL — never leaves the browser
});

// ---------------------------------------------------------------- plane control (#54)
const planeSlider = document.getElementById("planeHeight");
planeSlider.addEventListener("input", () => {
  state.planeY = parseFloat(planeSlider.value);
  planeMesh.position.y = state.planeY;
  planeEdge.position.y = state.planeY;
  projBox.max.y = state.planeY;
  boxHelper.box.copy(projBox);
  render();
});

// ---------------------------------------------------------------- cameras / render
function frame3dCamera() {
  view3d.camera.position.set(hcx + 1.4, 1.0, hcz + 1.4);
  controls3d.target.set(hcx, 0.0, hcz);
  controls3d.update();
}

function positionTopDownCamera() {
  const half = Math.max(hw, hd) * 1.4;
  const cam = view2d.camera;
  cam.left = -half; cam.right = half; cam.top = half; cam.bottom = -half;
  cam.position.set(hcx, 20, hcz);
  cam.up.set(0, 0, -1);
  cam.lookAt(hcx, 0, hcz);
  cam.updateProjectionMatrix();
}
positionTopDownCamera();

function renderProjection() {
  if (!state.meshP) return;
  updateProjNormalization();
  rP.setRenderTarget(projTarget);
  rP.setClearColor(0x000000, 1);
  rP.clear();
  rP.render(sceneP, camP);
  rP.setRenderTarget(null);
  rP.readRenderTargetPixels(projTarget, 0, 0, PROJ_W, PROJ_H, pix);
  const img = projCtx.createImageData(PROJ_W, PROJ_H);
  for (let y = 0; y < PROJ_H; y++) {            // flip Y: GL bottom-left -> canvas top-left
    const sy = PROJ_H - 1 - y;
    for (let x = 0; x < PROJ_W; x++) {
      const s = (sy * PROJ_W + x) * 4, d = (y * PROJ_W + x) * 4;
      img.data[d] = pix[s]; img.data[d + 1] = pix[s + 1];
      img.data[d + 2] = pix[s + 2]; img.data[d + 3] = 255;
    }
  }
  projCtx.putImageData(img, 0, 0);
}

function render() {
  applyPose();
  view3d.renderer.render(scene, view3d.camera);
  view2d.renderer.render(scene, view2d.camera);
  renderProjection();
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
  positionTopDownCamera();
  render();
});
