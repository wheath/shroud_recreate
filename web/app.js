// shroud_recreate — MVP web app  ·  v0.1.1
// Serverless: pure static files + Three.js from CDN. No backend.
//
// Capture box (the 2D viewing frame shown in the bottom 3D view):
//   STATIC        — fixed in world; the model moves/rotates relative to it.
//   MOVE-WITH-MODEL — rides the model's full transform (translation + rotation).
// It's a real transformable wireframe (not an axis-aligned Box3Helper, which
// can't rotate).
//
// Two poses: pose = AUTHORITATIVE (top 2D + projection); poseB = bottom inspection
// pose (independent mode). Cloth plane owns the projection: Faithful (distance) vs
// Shortcut (Phong light). Model shading phong/flat/bare + mesh-detail picker.
//
// LIMITATION: distance is world-Y (assumes a horizontal plane). When the plane can
// tilt, measure along the plane normal instead.

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";

const APP_VERSION = "v0.1.1";
console.log("shroud_recreate " + APP_VERSION);
{ const vEl = document.getElementById("version"); if (vEl) vEl.textContent = APP_VERSION; }

const MODEL_URL = "../third_party/moraes/body_3d_dec10000.obj";

const SAMPLED_FAR = 0.12;
const SAMPLED_NEAR = 0.28;

let HEAD = {
  x: [-0.2177, 0.2649], y: [-0.2661, 0.2412], z: [-1.3547, -0.7841],
};
let hcx, hcz, hw, hd;
function recomputeHeadDerived() {
  hcx = (HEAD.x[0] + HEAD.x[1]) / 2;
  hcz = (HEAD.z[0] + HEAD.z[1]) / 2;
  hw = HEAD.x[1] - HEAD.x[0];
  hd = HEAD.z[1] - HEAD.z[0];
}
recomputeHeadDerived();

const planeSlider = document.getElementById("planeHeight");

const state = {
  mesh3: null,
  planeY: 1.4,
  clothOn: true,
  shading: "phong",
  activeView: "cloth",
  near: 1.0,
  far: 0.0,
  useSampled: false,
  projMode: "faithful",
  frameStatic: true,
  clipY: -1,
  linked: true,
};

const MODEL = { size: new THREE.Vector3(1,1,1), center: new THREE.Vector3(0,0,0) };

// ---------------------------------------------------------------- viewports
function makeViewport(canvas, { perspective }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const w = canvas.clientWidth || 400, h = canvas.clientHeight || 400;
  renderer.setSize(w, h, false);
  const camera = perspective
    ? new THREE.PerspectiveCamera(45, w / h, 0.001, 1000)
    : new THREE.OrthographicCamera(-1, 1, 1, -1, -1000, 1000);
  return { renderer, camera };
}
const view3d = makeViewport(document.getElementById("view3d"), { perspective: true });
const controls3d = new OrbitControls(view3d.camera, view3d.renderer.domElement);
controls3d.enableDamping = true;
const view2d = makeViewport(document.getElementById("view2d"), { perspective: false });

// ---------------------------------------------------------------- scene
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x14161a);
scene.add(new THREE.HemisphereLight(0xbfc7d2, 0x1a1a1f, 0.9));
const keyLight = new THREE.DirectionalLight(0xffffff, 0.9); keyLight.position.set(3, 6, 5); scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(0x88a0c0, 0.35); fillLight.position.set(-4, 2, -5); scene.add(fillLight);

const planeMesh = new THREE.Mesh(
  new THREE.PlaneGeometry(1, 1),
  new THREE.MeshBasicMaterial({ color: 0x3d7bd4, transparent: true, opacity: 0.15,
    side: THREE.DoubleSide, depthWrite: false })
);
planeMesh.rotation.x = -Math.PI / 2; scene.add(planeMesh);
const planeEdge = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1)),
  new THREE.LineBasicMaterial({ color: 0x3d7bd4, transparent: true, opacity: 0.6 })
);
planeEdge.rotation.x = -Math.PI / 2; scene.add(planeEdge);

const clipMesh = new THREE.Mesh(
  new THREE.PlaneGeometry(1, 1),
  new THREE.MeshBasicMaterial({ color: 0x8a6d3b, transparent: true, opacity: 0.12,
    side: THREE.DoubleSide, depthWrite: false })
);
clipMesh.rotation.x = -Math.PI / 2; scene.add(clipMesh);
const clipEdge = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1)),
  new THREE.LineBasicMaterial({ color: 0xb08a4a, transparent: true, opacity: 0.5 })
);
clipEdge.rotation.x = -Math.PI / 2; scene.add(clipEdge);

// capture box — a real transformable wireframe (Box3Helper can't rotate).
const captureBox = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
  new THREE.LineBasicMaterial({ color: 0x5a8fb0 })
);
scene.add(captureBox);
const capCenter = new THREE.Vector3();
const capSize = new THREE.Vector3(1, 1, 1);

function rebuildSceneHelpers() {
  const bodyW = MODEL.size.x * 1.05, bodyD = MODEL.size.z * 1.05;
  const bcx = MODEL.center.x, bcz = MODEL.center.z;
  planeMesh.geometry.dispose(); planeMesh.geometry = new THREE.PlaneGeometry(bodyW, bodyD);
  planeMesh.position.set(bcx, state.planeY, bcz);
  planeEdge.geometry.dispose(); planeEdge.geometry = new THREE.EdgesGeometry(new THREE.PlaneGeometry(bodyW, bodyD));
  planeEdge.position.set(bcx, state.planeY, bcz);
  const clipY = MODEL.center.y - MODEL.size.y / 2 - (hw + hd) * 0.05;
  state.clipY = clipY;
  clipMesh.geometry.dispose(); clipMesh.geometry = new THREE.PlaneGeometry(bodyW, bodyD);
  clipMesh.position.set(bcx, clipY, bcz);
  clipEdge.geometry.dispose(); clipEdge.geometry = new THREE.EdgesGeometry(new THREE.PlaneGeometry(bodyW, bodyD));
  clipEdge.position.set(bcx, clipY, bcz);
  // capture region (head/neck) — world-space center + size; box geometry sized to it
  const cxMin = HEAD.x[0], cxMax = HEAD.x[1];
  const cyMin = HEAD.y[0] - (hw + hd) * 0.05, cyMax = state.planeY;
  const czMin = HEAD.z[0], czMax = HEAD.z[1];
  capCenter.set((cxMin+cxMax)/2, (cyMin+cyMax)/2, (czMin+czMax)/2);
  capSize.set(cxMax-cxMin, cyMax-cyMin, czMax-czMin);
  captureBox.geometry.dispose();
  captureBox.geometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(capSize.x, capSize.y, capSize.z));
  planeSlider.min = (HEAD.y[1]).toFixed(3);
  planeSlider.max = (HEAD.y[1] + (hw + hd) * 0.8).toFixed(3);
  planeSlider.step = ((hw + hd) * 0.01).toFixed(4);
  planeSlider.value = String(state.planeY);
}

// ---------------------------------------------------------------- projection shaders
const distMatFaithful = new THREE.ShaderMaterial({
  uniforms: {
    planeY: { value: 1.4 }, yMin: { value: 0 }, yMax: { value: 1 },
    nearTone: { value: 1.0 }, farTone: { value: 0.0 },
  },
  vertexShader: `
    uniform float planeY, yMin, yMax;
    varying float vT;
    void main(){
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vT = clamp((wp.y - yMin) / max(yMax - yMin, 1e-5), 0.0, 1.0);
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `,
  fragmentShader: `
    uniform float nearTone, farTone;
    varying float vT;
    void main(){
      float g = mix(farTone, nearTone, vT);
      gl_FragColor = vec4(vec3(g), 1.0);
    }
  `,
  side: THREE.DoubleSide,
});

const distMatShortcut = new THREE.ShaderMaterial({
  uniforms: {
    planeY: { value: 1.4 }, nearTone: { value: 1.0 }, farTone: { value: 0.0 },
  },
  vertexShader: `
    varying vec3 vN;
    void main(){
      vN = normalize(mat3(modelMatrix) * normal);
      gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform float nearTone, farTone;
    varying vec3 vN;
    void main(){
      float ndl = clamp(dot(normalize(vN), vec3(0.0, 1.0, 0.0)), 0.0, 1.0);
      float g = mix(farTone, nearTone, ndl);
      gl_FragColor = vec4(vec3(g), 1.0);
    }
  `,
  side: THREE.DoubleSide,
});

function projMat() { return state.projMode === "shortcut" ? distMatShortcut : distMatFaithful; }
function syncProjUniforms() {
  const near = state.useSampled ? SAMPLED_NEAR : state.near;
  const far  = state.useSampled ? SAMPLED_FAR  : state.far;
  for (const m of [distMatFaithful, distMatShortcut]) {
    m.uniforms.nearTone.value = near; m.uniforms.farTone.value = far;
    m.uniforms.planeY.value = state.planeY;
  }
  distMatFaithful.uniforms.yMin.value = projYMin;
  distMatFaithful.uniforms.yMax.value = projYMax;
  const nEl = document.getElementById("nearVal"), fEl = document.getElementById("farVal");
  if (nEl) nEl.value = near.toFixed(2);
  if (fEl) fEl.value = far.toFixed(2);
}
let projYMin = 0, projYMax = 1;

// model display materials by shading type
const matPhong = new THREE.MeshStandardMaterial({ color: 0xcfcabb, roughness: 0.75, metalness: 0.0, flatShading: false });
const matFlat  = new THREE.MeshStandardMaterial({ color: 0xcfcabb, roughness: 0.5, metalness: 0.0, flatShading: true });
const matBare  = new THREE.MeshBasicMaterial({ color: 0x8aa0b8, wireframe: true });
function shadingMaterial() {
  return state.shading === "flat" ? matFlat
       : state.shading === "bare" ? matBare
       : matPhong;
}

const MESH_URLS = {
  "1000": "../third_party/moraes/body_3d_dec1000.obj",
  "2000": "../third_party/moraes/body_3d_dec2000.obj",
  "5000": "../third_party/moraes/body_3d_dec5000.obj",
  "10000": "../third_party/moraes/body_3d_dec10000.obj",
  "full": "../third_party/moraes/body_3d_ORIGINAL_full.obj",
};

let headLocal = null;

function loadModel(url) {
  setStatus("Loading model…");
  new OBJLoader().load(
    url,
    (obj) => {
      let geo = null;
      obj.traverse((c) => { if (c.isMesh && !geo) geo = c.geometry; });
      if (!geo) { setStatus("No mesh found in model file.", true); return; }
      try { geo = mergeVertices(geo); } catch (e) { console.warn("mergeVertices failed", e); }
      geo.computeVertexNormals();
      if (state.mesh3) { scene.remove(state.mesh3); }
      state.mesh3 = new THREE.Mesh(geo, shadingMaterial());
      scene.add(state.mesh3);

      HEAD = deriveHeadRegion(geo);
      recomputeHeadDerived();
      const fbb = new THREE.Box3().setFromObject(state.mesh3);
      fbb.getSize(MODEL.size); fbb.getCenter(MODEL.center);
      state.planeY = HEAD.y[1] + (hw + hd) * 0.25;
      rebuildSceneHelpers();
      headLocal = collectHeadVerts(geo);

      frame3dCamera();
      positionTopDownCamera();
      syncProjUniforms();
      render();
      setStatus(`Ready · ${APP_VERSION} · ${geo.getAttribute("position").count.toLocaleString()} verts`);
    },
    (xhr) => setStatus(`Loading model… ${((xhr.loaded / (xhr.total || xhr.loaded)) * 100) | 0}%`),
    (err) => { console.error(err); setStatus("Model failed to load — is third_party/moraes/ served?", true); }
  );
}
loadModel(MODEL_URL);

const meshResSel = document.getElementById("meshRes");
if (meshResSel) meshResSel.addEventListener("change", () => { loadModel(MESH_URLS[meshResSel.value] || MODEL_URL); });

function collectHeadVerts(geo) {
  const p = geo.getAttribute("position"); const out = [];
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    if (x >= HEAD.x[0] && x <= HEAD.x[1] && z >= HEAD.z[0] && z <= HEAD.z[1]) out.push(x, y, z);
  }
  return new Float32Array(out);
}

function deriveHeadRegion(geo) {
  const bb = new THREE.Box3().setFromBufferAttribute(geo.getAttribute("position"));
  const size = bb.getSize(new THREE.Vector3());
  const axis = size.z >= size.x ? "z" : "x";
  const p = geo.getAttribute("position");
  const along = (i) => axis === "z" ? p.getZ(i) : p.getX(i);
  const lo = axis === "z" ? bb.min.z : bb.min.x;
  const hi = axis === "z" ? bb.max.z : bb.max.x;
  const chunk = (hi - lo) / 6;
  let loMinY = 1e9, loMaxY = -1e9, hiMinY = 1e9, hiMaxY = -1e9;
  for (let i = 0; i < p.count; i++) {
    const a = along(i), y = p.getY(i);
    if (a <= lo + chunk) { if (y < loMinY) loMinY = y; if (y > loMaxY) loMaxY = y; }
    if (a >= hi - chunk) { if (y < hiMinY) hiMinY = y; if (y > hiMaxY) hiMaxY = y; }
  }
  const headAtLo = (loMaxY - loMinY) >= (hiMaxY - hiMinY);
  const aMin = headAtLo ? lo : hi - chunk, aMax = headAtLo ? lo + chunk : hi;
  let xmin=1e9,xmax=-1e9,zmin=1e9,zmax=-1e9,ymin=1e9,ymax=-1e9;
  for (let i = 0; i < p.count; i++) {
    const a = along(i); if (a < aMin || a > aMax) continue;
    const x=p.getX(i),y=p.getY(i),z=p.getZ(i);
    if(x<xmin)xmin=x; if(x>xmax)xmax=x; if(z<zmin)zmin=z; if(z>zmax)zmax=z; if(y<ymin)ymin=y; if(y>ymax)ymax=y;
  }
  return { x:[xmin,xmax], y:[ymin,ymax], z:[zmin,zmax] };
}

// ---------------------------------------------------------------- poses
const pose  = { rx: 0, ry: 0, rz: 0, tx: 0, tz: 0, scale: 1 };
const poseB = { rx: 0, ry: 0, rz: 0, tx: 0, tz: 0, scale: 1 };
function bottomPose() { return state.linked ? pose : poseB; }

function applyPoseObj(p) {
  if (!state.mesh3) return;
  state.mesh3.rotation.set(p.rx, p.ry, p.rz);
  state.mesh3.position.set(p.tx, 0, p.tz);
  state.mesh3.scale.setScalar(p.scale);
  state.mesh3.updateMatrixWorld();
}
// Apply the AUTHORITATIVE pose and transform the capture box.
function applyPose() {
  applyPoseObj(pose);
  if (state.frameStatic) {
    // Fixed in world — model moves/rotates relative to it.
    captureBox.position.copy(capCenter);
    captureBox.quaternion.identity();
  } else {
    // Ride the model: rotation about the model origin, then translation.
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(pose.rx, pose.ry, pose.rz));
    const c = capCenter.clone().applyQuaternion(q);
    c.x += pose.tx; c.z += pose.tz;
    captureBox.position.copy(c);
    captureBox.quaternion.copy(q);
  }
}
function updateProjNormalization() {
  if (!state.mesh3) return;
  if (state.frameStatic) {
    projYMin = capCenter.y - capSize.y / 2;
    projYMax = capCenter.y + capSize.y / 2;
  } else {
    if (!headLocal) return;
    const m = state.mesh3.matrixWorld; const v = new THREE.Vector3();
    let mn=1e9, mx=-1e9;
    for (let i=0;i<headLocal.length;i+=3){ v.set(headLocal[i],headLocal[i+1],headLocal[i+2]).applyMatrix4(m); if(v.y<mn)mn=v.y; if(v.y>mx)mx=v.y; }
    projYMin = mn; projYMax = mx;
  }
  syncProjUniforms();
}

// drag in 2D view (top) — poses the AUTHORITATIVE model
let drag = null;
const el2d = view2d.renderer.domElement;
el2d.addEventListener("pointerdown", (e) => {
  let mode;
  if (state.frameStatic) mode = e.shiftKey ? "rotate" : "move";
  else                   mode = e.shiftKey ? "move" : "rotate";
  drag = { x: e.clientX, y: e.clientY, mode };
  el2d.setPointerCapture(e.pointerId);
});
el2d.addEventListener("pointermove", (e) => {
  if (!drag || !state.mesh3) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  drag.x = e.clientX; drag.y = e.clientY;
  if (drag.mode === "rotate") {
    pose.ry += dx * 0.01; pose.rx += dy * 0.01;
  } else {
    const cam = view2d.camera;
    const sx = (cam.right - cam.left) / (el2d.clientWidth || 1);
    const sz = (cam.top - cam.bottom) / (el2d.clientHeight || 1);
    pose.tx += dx * sx;
    pose.tz += dy * sz;
  }
  render();
});
el2d.addEventListener("pointerup", (e) => { drag = null; try { el2d.releasePointerCapture(e.pointerId); } catch {} });
el2d.addEventListener("wheel", (e) => {
  e.preventDefault();
  const factor = Math.exp(-e.deltaY * 0.0012);
  pose.scale = Math.min(8, Math.max(0.15, pose.scale * factor));
  render();
}, { passive: false });

// ---- bottom 3D view: pose ONLY when independent; linked = inspect-only (orbit) ----
let drag3 = null;
const el3d = view3d.renderer.domElement;
el3d.addEventListener("pointerdown", (e) => {
  if (state.linked || !e.shiftKey || !state.mesh3) return;  // plain drag → orbit
  controls3d.enabled = false;
  drag3 = { x: e.clientX, y: e.clientY, mode: e.altKey ? "move" : "rotate" };
  el3d.setPointerCapture(e.pointerId);
});
el3d.addEventListener("pointermove", (e) => {
  if (!drag3) return;
  const p = bottomPose();
  const dx = e.clientX - drag3.x, dy = e.clientY - drag3.y;
  drag3.x = e.clientX; drag3.y = e.clientY;
  if (drag3.mode === "rotate") { p.ry += dx * 0.01; p.rx += dy * 0.01; }
  else { const s = Math.max(hw, hd) * 0.01; p.tx += dx * s; p.tz += dy * s; }
  render();
});
el3d.addEventListener("pointerup", (e) => {
  if (!drag3) return;
  drag3 = null; controls3d.enabled = true;
  try { el3d.releasePointerCapture(e.pointerId); } catch {}
});

// ---------------------------------------------------------------- reference image
const REFERENCE_URL = "../reference/shroud_of_turin_pos_neg_face.jpg";
const refImg = document.getElementById("refImg");
const refEmpty = document.getElementById("refEmpty");
const refWrap = document.getElementById("refWrap");
const refFile = document.getElementById("refFile");
function showRef(src){ refImg.src=src; refImg.style.display="block"; refEmpty.style.display="none"; }
function refFallback(){ refEmpty.textContent="click to load a reference image (stays in your browser)"; refEmpty.style.display="block"; refImg.style.display="none"; }
refImg.addEventListener("error", refFallback);
(function(){ const p=new Image(); p.onload=()=>showRef(REFERENCE_URL); p.onerror=refFallback; p.src=REFERENCE_URL; })();
refWrap.addEventListener("click", ()=>refFile.click());
refFile.addEventListener("change",(e)=>{ const f=e.target.files&&e.target.files[0]; if(!f)return; showRef(URL.createObjectURL(f)); });

// ---------------------------------------------------------------- controls
planeSlider.addEventListener("input", () => {
  state.planeY = parseFloat(planeSlider.value);
  planeMesh.position.y = state.planeY; planeEdge.position.y = state.planeY;
  const cyMin = HEAD.y[0] - (hw + hd) * 0.05, cyMax = state.planeY;
  capCenter.y = (cyMin + cyMax) / 2; capSize.y = cyMax - cyMin;
  captureBox.geometry.dispose();
  captureBox.geometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(capSize.x, capSize.y, capSize.z));
  render();
});

const nearInput = document.getElementById("nearVal");
const farInput = document.getElementById("farVal");
const sampledToggle = document.getElementById("useSampled");
const normalizeBtn = document.getElementById("normalizeBtn");
if (nearInput) nearInput.addEventListener("input", () => { state.near = clamp01(parseFloat(nearInput.value)); if(!state.useSampled){syncProjUniforms(); render();} });
if (farInput) farInput.addEventListener("input", () => { state.far = clamp01(parseFloat(farInput.value)); if(!state.useSampled){syncProjUniforms(); render();} });
if (sampledToggle) sampledToggle.addEventListener("change", () => { state.useSampled = sampledToggle.checked; syncProjUniforms(); render(); });
if (normalizeBtn) normalizeBtn.addEventListener("click", () => { state.useSampled=false; if(sampledToggle)sampledToggle.checked=false; state.near=1; state.far=0; syncProjUniforms(); render(); });

for (const el of document.querySelectorAll("input[name=projmode]")) {
  el.addEventListener("change", () => { if (el.checked) { state.projMode = el.value; render(); } });
}
for (const el of document.querySelectorAll("input[name=framemode]")) {
  el.addEventListener("change", () => { if (el.checked) { state.frameStatic = (el.value === "static"); updateDragHint(); render(); } });
}
for (const el of document.querySelectorAll("input[name=linkmode]")) {
  el.addEventListener("change", () => {
    if (!el.checked) return;
    const wasLinked = state.linked;
    state.linked = (el.value === "linked");
    if (wasLinked && !state.linked) Object.assign(poseB, pose);
    const btn = document.getElementById("makeRealBtn");
    if (btn) btn.style.display = state.linked ? "none" : "inline-block";
    const h3 = document.getElementById("hint3d");
    if (h3) h3.textContent = state.linked ? "· orbit to inspect (mirrors the top)" : "· orbit · shift-drag to pose";
    render();
  });
}
const makeRealBtn = document.getElementById("makeRealBtn");
if (makeRealBtn) makeRealBtn.addEventListener("click", () => {
  if (!confirm("Make the bottom view's orientation the real pose? This replaces the top 2D orientation that drives the projection.")) return;
  Object.assign(pose, poseB);
  render();
});
function updateDragHint() {
  const h = document.getElementById("drag2dHint");
  if (h) h.textContent = state.frameStatic
    ? "drag move · shift rotate · scroll zoom"
    : "drag rotate · shift move · scroll zoom";
}
updateDragHint();
function clamp01(x){ return Math.max(0, Math.min(1, isNaN(x)?0:x)); }

for (const el of document.querySelectorAll("input[name=shading]")) {
  el.addEventListener("change", () => { if (el.checked) { state.shading = el.value; if (state.mesh3) state.mesh3.material = shadingMaterial(); render(); } });
}

// ---------------------------------------------------------------- layers <-> control sections
function sectionFor(key) { return document.querySelector(`.group[data-section="${key}"]`); }

function highlightActiveSection(key) {
  for (const g of document.querySelectorAll(".group[data-section]")) {
    g.classList.toggle("active-section", g.dataset.section === key);
  }
  const sec = sectionFor(key);
  if (sec) {
    sec.scrollIntoView({ behavior: "smooth", block: "nearest" });
    sec.classList.remove("flash"); void sec.offsetWidth; sec.classList.add("flash");
  }
}

function setSectionEnabled(key, enabled) {
  const sec = sectionFor(key);
  if (!sec) return;
  sec.classList.toggle("section-disabled", !enabled);
  for (const inp of sec.querySelectorAll("input,button,select")) inp.disabled = !enabled;
}

function setActiveView(which) {
  state.activeView = which;
  for (const el of document.querySelectorAll(".layer[data-view]")) el.classList.toggle("active", el.dataset.view === which);
  const label = document.getElementById("activeLabel");
  if (label) label.textContent = which === "cloth" ? "Cloth · distance projection" : "3D model";
  highlightActiveSection(which === "cloth" ? "cloth" : "model");
  render();
}
for (const el of document.querySelectorAll(".layer[data-view]")) {
  el.addEventListener("click", (e) => {
    if (e.target.classList.contains("eye")) return;
    setActiveView(el.dataset.view);
  });
}
for (const eye of document.querySelectorAll(".layer .eye[data-toggle]")) {
  eye.addEventListener("click", (e) => {
    e.stopPropagation();
    const which = eye.dataset.toggle;
    if (which === "cloth") {
      state.clothOn = !state.clothOn;
      eye.textContent = state.clothOn ? "\u25C9" : "\u25CE";
      eye.classList.toggle("off", !state.clothOn);
      setSectionEnabled("cloth", state.clothOn);
      render();
    }
  });
}
setSectionEnabled("cloth", state.clothOn);
highlightActiveSection("cloth");

// ---------------------------------------------------------------- cameras / render
function frame3dCamera() {
  if (!state.mesh3) return;
  const bb = new THREE.Box3().setFromObject(state.mesh3);
  const pw = planeMesh.geometry.parameters.width, pd = planeMesh.geometry.parameters.height;
  bb.expandByPoint(new THREE.Vector3(planeMesh.position.x - pw/2, state.planeY, planeMesh.position.z - pd/2));
  bb.expandByPoint(new THREE.Vector3(planeMesh.position.x + pw/2, state.planeY, planeMesh.position.z + pd/2));
  bb.expandByPoint(new THREE.Vector3(clipMesh.position.x - pw/2, state.clipY, clipMesh.position.z - pd/2));
  bb.expandByPoint(new THREE.Vector3(clipMesh.position.x + pw/2, state.clipY, clipMesh.position.z + pd/2));
  bb.expandByPoint(new THREE.Vector3(capCenter.x - capSize.x/2, capCenter.y - capSize.y/2, capCenter.z - capSize.z/2));
  bb.expandByPoint(new THREE.Vector3(capCenter.x + capSize.x/2, capCenter.y + capSize.y/2, capCenter.z + capSize.z/2));
  const size = bb.getSize(new THREE.Vector3());
  const center = bb.getCenter(new THREE.Vector3());
  const c = view3d.renderer.domElement;
  const aspect = (c.clientWidth || 16) / (c.clientHeight || 9);
  const cam = view3d.camera;
  cam.aspect = aspect;
  const vFov = 45 * Math.PI / 180;
  const lengthAlongX = size.x >= size.z;
  const lengthSpan = lengthAlongX ? size.x : size.z;
  const heightSpan = size.y;
  const fit = Math.max(lengthSpan / aspect, heightSpan);
  const dist = (fit * 0.5) / Math.tan(vFov / 2) * 1.15;
  if (lengthAlongX) {
    cam.position.set(center.x, center.y + dist * 0.22, center.z + dist);
  } else {
    cam.position.set(center.x + dist, center.y + dist * 0.22, center.z);
  }
  cam.up.set(0, 1, 0);
  cam.near = dist * 0.01; cam.far = dist * 10;
  cam.updateProjectionMatrix();
  controls3d.target.copy(center);
  controls3d.update();
}
function positionTopDownCamera() {
  const half = Math.max(hw, hd) * 0.65;
  const cam = view2d.camera;
  const c = view2d.renderer.domElement;
  const aspect = (c.clientWidth || 1) / (c.clientHeight || 1);
  cam.left = -half * aspect; cam.right = half * aspect;
  cam.top = half; cam.bottom = -half;
  const ox = state.frameStatic ? 0 : pose.tx;
  const oz = state.frameStatic ? 0 : pose.tz;
  cam.position.set(hcx + ox, HEAD.y[1] + Math.max(hw, hd) * 4, hcz + oz);
  cam.up.set(0, 0, -1);
  cam.lookAt(hcx + ox, HEAD.y[0], hcz + oz);
  cam.updateProjectionMatrix();
}
positionTopDownCamera();

function render() {
  if (!state.mesh3) return;

  // --- TOP 2D + projection: authoritative pose ---
  applyPose();
  positionTopDownCamera();
  const showProjection = state.clothOn && state.activeView === "cloth";
  const helpers = [planeMesh, planeEdge, clipMesh, clipEdge, captureBox];
  const vis = helpers.map(h => h.visible);
  helpers.forEach(h => h.visible = false);
  if (showProjection) {
    updateProjNormalization();
    const savedMat = state.mesh3.material;
    state.mesh3.material = projMat();
    view2d.renderer.setClearColor(0x000000, 1);
    view2d.renderer.render(scene, view2d.camera);
    state.mesh3.material = savedMat;
  } else {
    view2d.renderer.setClearColor(0x14161a, 1);
    view2d.renderer.render(scene, view2d.camera);
  }
  helpers.forEach((h, i) => h.visible = vis[i]);

  // --- BOTTOM 3D inspect view: bottom pose (independent when unlinked) ---
  applyPoseObj(bottomPose());
  view3d.renderer.render(scene, view3d.camera);
  applyPoseObj(pose);   // leave mesh on authoritative pose for next frame's projection
}

function animate() {
  requestAnimationFrame(animate);
  controls3d.update();
  if (state.mesh3) applyPoseObj(bottomPose());
  view3d.renderer.render(scene, view3d.camera);
  if (state.mesh3) applyPoseObj(pose);   // restore authoritative for projection reads
}
animate();

function setStatus(msg, isError=false){ const el=document.getElementById("status"); el.textContent=msg; el.style.color=isError?"#e0736f":"#8a8f99"; }

addEventListener("resize", () => {
  for (const v of [view3d, view2d]) {
    const c = v.renderer.domElement; const w=c.clientWidth, h=c.clientHeight;
    v.renderer.setSize(w, h, false);
    if (v.camera.isPerspectiveCamera) { v.camera.aspect=w/h; v.camera.updateProjectionMatrix(); }
  }
  positionTopDownCamera(); render();
});
