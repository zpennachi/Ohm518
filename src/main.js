import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";
import { GLTFLoader } from "https://unpkg.com/three@0.160.0/examples/jsm/loaders/GLTFLoader.js";

/* ------------------ CONFIG ------------------ */

const NAV_ITEMS = [
  { key: "mission", label: "Home", image: "1-min.jpg" },
  { key: "contact", label: "Mission", image: "2-min.jpg" },
  { key: "donations", label: "Donate", image: "3-min.jpg" },
  { key: "shop", label: "Shop", image: "4-min.jpg" },
  { key: "events", label: "Contact", image: "5-min.jpg" },
];

const MODEL_STATES = [
  { zoom: 1.0, y: 0, rx: 0, ry: 0 },
  { zoom: 4.0, y: 2.5, rx: 0, ry: 1 },
  { zoom: 7.0, y: 2.0, rx: 0, ry: 0 },
  { zoom: 5.2, y: 1.5, rx: -1.15, ry: -3 },
  { zoom: 1.0, y: 0, rx: 0, ry: -3 },
];

/* ------------------ DOM ------------------ */

const threeContainer = document.getElementById("three-container");
const sections = [...document.querySelectorAll(".section")];
const footerNav = document.querySelector(".footer-nav");

/* ------------------ FOOTER NAV ------------------ */

NAV_ITEMS.forEach(item => {
  const btn = document.createElement("button");
  btn.textContent = item.label;
  btn.onclick = () => scrollToSection(item.key);
  btn.onmouseenter = () => crossfadeBG(item.image);
  btn.onmouseleave = () => crossfadeBG(activeImage);
  footerNav.appendChild(btn);
});

/* ------------------ SCROLL ------------------ */

let scrollTarget = 0;
let activeKey = "mission";
let activeImage = "1-min.jpg";

function scrollToSection(key) {
  const idx = NAV_ITEMS.findIndex(i => i.key === key);
  window.scrollTo({ top: idx * window.innerHeight, behavior: "smooth" });
}

window.addEventListener("scroll", () => {
  const total = (NAV_ITEMS.length - 1) * window.innerHeight;
  scrollTarget = Math.min(1, Math.max(0, window.scrollY / total));

  const idx = Math.round(window.scrollY / window.innerHeight);
  activeKey = NAV_ITEMS[idx]?.key || activeKey;
  activeImage = NAV_ITEMS[idx]?.image || activeImage;
});

/* ------------------ THREE ------------------ */

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);

const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 100);
camera.position.z = 5;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
threeContainer.appendChild(renderer.domElement);

const ambient = new THREE.AmbientLight(0xffffff, 0.7);
const dir = new THREE.DirectionalLight(0xffffff, 1);
dir.position.set(5, 10, 7);
scene.add(ambient, dir);

/* ------------------ MODEL ------------------ */

let model, baseScale = 1, baseY = 0;

new GLTFLoader().load("models/ohm4.glb", gltf => {
  model = gltf.scene;
  scene.add(model);

  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  baseScale = 2 / Math.max(size.x, size.y, size.z);
  model.scale.setScalar(baseScale);
});

/* ------------------ BG CROSSFADE (simplified) ------------------ */

const texLoader = new THREE.TextureLoader();
let bgTex;

function crossfadeBG(file) {
  texLoader.load(`images/${file}`, tex => {
    tex.colorSpace = THREE.SRGBColorSpace;
    scene.environment = tex;
    bgTex = tex;
  });
}

/* ------------------ ANIMATE ------------------ */

let scrollLerp = 0;

function animate() {
  requestAnimationFrame(animate);

  scrollLerp += (scrollTarget - scrollLerp) * 0.1;
  const t = scrollLerp * scrollLerp * (3 - 2 * scrollLerp);

  if (model) {
    const idx = Math.min(MODEL_STATES.length - 1, Math.floor(t * (MODEL_STATES.length - 1)));
    const next = Math.min(idx + 1, MODEL_STATES.length - 1);
    const f = t * (MODEL_STATES.length - 1) - idx;

    const a = MODEL_STATES[idx];
    const b = MODEL_STATES[next];

    model.scale.setScalar(baseScale * THREE.MathUtils.lerp(a.zoom, b.zoom, f));
    model.position.y = THREE.MathUtils.lerp(a.y, b.y, f);
    model.rotation.x = THREE.MathUtils.lerp(a.rx, b.rx, f);
    model.rotation.y = THREE.MathUtils.lerp(a.ry, b.ry, f);
  }

  renderer.render(scene, camera);
}

animate();

window.addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
