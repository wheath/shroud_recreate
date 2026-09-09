// shroud_recreate — MVP web app
// Serverless: pure static files + Three.js from CDN. No backend.
// Sprint 1 core:
//   #53 load + maneuver the working model (2D view = authority, 3D view = inspect)
//   #54 the cutting (shroud) plane
//   #55 distance-to-grayscale projection
//   #56 default public-domain reference image, loaded on init
//
// The 2D area is the single output surface. What it shows depends on the active
// layer (click a layer to switch): "3D model" = the raw shaded model looking
// down through the plane; "Distance projection" = the world-Y grayscale image
// (near the plane = white, far = black, linear, no tone curve). The 2D area is
// always the drag-to-pose authority; the 3D strip reflects the pose and can be
// orbited to inspect without changing it.
//
// Projection method: render the model with a shader that outputs world-Y as
// gray, normalized to the head's Y span. Because the cutting plane is
// horizontal, world-Y IS the distance to the plane.
//
// LIMITATION (documented on purpose): the world-Y shortcut assumes a HORIZONTAL
// plane. When the plane can tilt (later epic), measure distance along the plane
// normal instead.

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";

const MODEL_URL = "../third_party/moraes/body_3d_dec5000.obj";

// Head region — starts from prototype coords, but is REPLACED with values
// measured from the actual loaded mesh (see deriveHeadRegion). Mutable.
let HEAD = {
  x: [-0.21769897639751434, 0.26493290066719055],
  y: [-0.26608800888061523, 0.24115604162216187],
  z: [-1.3547191619873047, -0.7841088175773621],
};
let hcx = (HEAD.x[0] + HEAD.x[1]) / 2;
let hcz = (HEAD.z[0] + HEAD.z[1]) / 2;
let hw = HEAD.x[1] - HEAD.x[0];
let hd = HEAD.z[1] - HEAD.z[0];

function recomputeHeadDerived() {
  hcx = (HEAD.x[0] + HEAD.x[1]) / 2;
  hcz = (HEAD.z[0] + HEAD.z[1]) / 2;
  hw = HEAD.x[1] - HEAD.x[0];
  hd = HEAD.z[1] - HEAD.z[0];
}

// plane height slider (declared early — rebuildSceneHelpers configures it)
const planeSlider = document.getElementById("planeHeight");

const state = {
  mesh3: null,     // the working model mesh
  planeY: 1.4,     // cutting plane height (model coords)
  viewMode: "projection",  // what the 2D area shows: "projection" | "model"
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

// cutting / shroud plane + projection box — created empty, sized in rebuildSceneHelpers()
const planeMesh = new THREE.Mesh(
  new THREE.PlaneGeometry(1, 1),
  new THREE.MeshBasicMaterial({ color: 0x3d7bd4, transparent: true, opacity: 0.15,
    side: THREE.DoubleSide, depthWrite: false })
);
planeMesh.rotation.x = -Math.PI / 2;
scene.add(planeMesh);
const planeEdge = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1)),
  new THREE.LineBasicMaterial({ color: 0x3d7bd4, transparent: true, opacity: 0.6 })
);
planeEdge.rotation.x = -Math.PI / 2;
scene.add(planeEdge);

const projBox = new THREE.Box3(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1));
const boxHelper = new THREE.Box3Helper(projBox, 0x5a8fb0);
scene.add(boxHelper);

function rebuildSceneHelpers() {
  const pw = hw * 1.3, pd = hd * 1.3;
  planeMesh.geometry.dispose();
  planeMesh.geometry = new THREE.PlaneGeometry(pw, pd);
  planeMesh.position.set(hcx, state.planeY, hcz);
  planeEdge.geometry.dispose();
  planeEdge.geometry = new THREE.EdgesGeometry(new THREE.PlaneGeometry(pw, pd));
  planeEdge.position.set(hcx, state.planeY, hcz);
  projBox.min.set(HEAD.x[0], HEAD.y[0] - (hw + hd) * 0.05, HEAD.z[0]);
  projBox.max.set(HEAD.x[1], state.planeY, HEAD.z[1]);
  boxHelper.box.copy(projBox);
  planeSlider.min = (HEAD.y[1]).toFixed(3);
  planeSlider.max = (HEAD.y[1] + (hw + hd) * 0.8).toFixed(3);
  planeSlider.step = ((hw + hd) * 0.01).toFixed(4);
  planeSlider.value = String(state.planeY);
}

// ---------------------------------------------------------------- projection material (#55)
// world-Y -> gray shader, applied to the model when the 2D area shows the
// Distance projection layer. Normalized to the head's Y span each frame.
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

    // Measure the real mesh and rebuild everything that depended on the
    // hardcoded head coords (the OBJ may be centered/scaled differently).
    HEAD = deriveHeadRegion(geo);
    recomputeHeadDerived();
    state.planeY = HEAD.y[1] + (hw + hd) * 0.25;
    rebuildSceneHelpers();

    headLocal = collectHeadVerts(geo);

    frame3dCamera();
    positionTopDownCamera();
    setActiveLayer(state.viewMode);   // set initial active layer + render
    setStatus(`Ready · ${(geo.getAttribute("position").count).toLocaleString()} verts`);
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

// Derive the head region from the ACTUAL loaded mesh rather than trusting
// hardcoded prototype coords (a re-exported/decimated OBJ may be centered or
// scaled differently). The body is a reclining figure long in one axis; the
// head is the higher-relief end. Bound its cross-axis and Y extent.
function deriveHeadRegion(geo) {
  const bb = new THREE.Box3().setFromBufferAttribute(geo.getAttribute("position"));
  const size = bb.getSize(new THREE.Vector3());
  const bodyLongAxis = size.z >= size.x ? "z" : "x";
  const p = geo.getAttribute("position");
  const along = (i) => bodyLongAxis === "z" ? p.getZ(i) : p.getX(i);
  const lo = bodyLongAxis === "z" ? bb.min.z : bb.min.x;
  const hi = bodyLongAxis === "z" ? bb.max.z : bb.max.x;
  const chunk = (hi - lo) / 6;
  let loMinY = 1e9, loMaxY = -1e9, hiMinY = 1e9, hiMaxY = -1e9;
  for (let i = 0; i < p.count; i++) {
    const a = along(i), y = p.getY(i);
    if (a <= lo + chunk) { if (y < loMinY) loMinY = y; if (y > loMaxY) loMaxY = y; }
    if (a >= hi - chunk) { if (y < hiMinY) hiMinY = y; if (y > hiMaxY) hiMaxY = y; }
  }
  const headAtLo = (loMaxY - loMinY) >= (hiMaxY - hiMinY);
  const aMin = headAtLo ? lo : hi - chunk;
  const aMax = headAtLo ? lo + chunk : hi;
  let xmin = 1e9, xmax = -1e9, zmin = 1e9, zmax = -1e9, ymin = 1e9, ymax = -1e9;
  for (let i = 0; i < p.count; i++) {
    const a = along(i);
    if (a < aMin || a > aMax) continue;
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    if (x < xmin) xmin = x; if (x > xmax) xmax = x;
    if (z < zmin) zmin = z; if (z > zmax) zmax = z;
    if (y < ymin) ymin = y; if (y > ymax) ymax = y;
  }
  return { x: [xmin, xmax], y: [ymin, ymax], z: [zmin, zmax] };
}

// ---------------------------------------------------------------- pose (2D authority, #53)
const pose = { rx: 0, ry: 0, rz: 0, tx: 0, tz: 0 };

function applyPose() {
  if (!state.mesh3) return;
  state.mesh3.rotation.set(pose.rx, pose.ry, pose.rz);
  state.mesh3.position.set(pose.tx, 0, pose.tz);
  state.mesh3.updateMatrixWorld();
}

function updateProjNormalization() {
  if (!headLocal || !state.mesh3) return;
  const m = state.mesh3.matrixWorld;
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

// drag in 2D view = authority (always active, whichever layer is shown)
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
refImg.addEventListener("error", refFallbackMessage);
(function loadDefaultReference() {
  const probe = new Image();
  probe.onload = () => showRef(REFERENCE_URL);
  probe.onerror = refFallbackMessage;
  probe.src = REFERENCE_URL;
})();
refWrap.addEventListener("click", () => refFile.click());
refFile.addEventListener("change", (e) => {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  showRef(URL.createObjectURL(f));   // object URL — never leaves the browser
});

// ---------------------------------------------------------------- plane control (#54)
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
  const off = Math.max(hw, hd) * 2.2;
  view3d.camera.near = 0.001;
  view3d.camera.far = 1000;
  view3d.camera.position.set(hcx + off, HEAD.y[1] + off * 0.7, hcz + off);
  view3d.camera.updateProjectionMatrix();
  controls3d.target.set(hcx, (HEAD.y[0] + HEAD.y[1]) / 2, hcz);
  controls3d.update();
}

function positionTopDownCamera() {
  const half = Math.max(hw, hd) * 0.8;
  const cam = view2d.camera;
  const c = view2d.renderer.domElement;
  const aspect = (c.clientWidth || 1) / (c.clientHeight || 1);
  cam.left = -half * aspect; cam.right = half * aspect;
  cam.top = half; cam.bottom = -half;
  cam.near = 0.001; cam.far = 1000;
  cam.position.set(hcx, HEAD.y[1] + Math.max(hw, hd) * 4, hcz);  // above head, looking down
  cam.up.set(0, 0, -1);                  // head (low z) toward top of view
  cam.lookAt(hcx, HEAD.y[0], hcz);
  cam.updateProjectionMatrix();
}
positionTopDownCamera();

function render() {
  applyPose();
  // 3D inspect view: always the shaded model + plane + box
  view3d.renderer.render(scene, view3d.camera);

  // 2D area: raw shaded model OR grayscale distance projection, per active layer.
  if (state.viewMode === "projection" && state.mesh3) {
    updateProjNormalization();
    const savedMat = state.mesh3.material;
    const planeVis = planeMesh.visible, edgeVis = planeEdge.visible, boxVis = boxHelper.visible;
    state.mesh3.material = distMat;
    planeMesh.visible = planeEdge.visible = boxHelper.visible = false;
    view2d.renderer.setClearColor(0x000000, 1);
    view2d.renderer.render(scene, view2d.camera);
    state.mesh3.material = savedMat;
    planeMesh.visible = planeVis; planeEdge.visible = edgeVis; boxHelper.visible = boxVis;
  } else {
    view2d.renderer.setClearColor(0x14161a, 1);
    view2d.renderer.render(scene, view2d.camera);
  }
}

function setActiveLayer(mode) {
  state.viewMode = mode;
  for (const el of document.querySelectorAll(".layer[data-view]")) {
    el.classList.toggle("active", el.dataset.view === mode);
  }
  const label = document.getElementById("activeLabel");
  if (label) label.textContent = mode === "projection" ? "Distance projection" : "3D model";
  render();
}
for (const el of document.querySelectorAll(".layer[data-view]")) {
  el.addEventListener("click", () => setActiveLayer(el.dataset.view));
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
