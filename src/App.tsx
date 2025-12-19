// src/App.tsx
import React, { useEffect, useRef, useState, useCallback } from "react";
import type { RefObject } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import "./app.css";

const PUBLIC_URL =
  (typeof process !== "undefined" &&
    (process as any).env &&
    (process as any).env.PUBLIC_URL) ||
  "";

const base = (PUBLIC_URL || "").replace(/\/+$/, "");
const asset = (p: string) => {
  const path = p.startsWith("/") ? p : `/${p}`;
  return `${base}${path}`;
};

const swirlVertexShader = `
  varying vec3 vWorldPos;
  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const swirlFragmentShader = `
  precision mediump float;
  precision mediump int;

  varying vec3 vWorldPos;

  uniform float uTime;
  uniform float uScale;
  uniform float uBrightness;
  uniform float uOpacity;
  uniform float uDepth;
  uniform float uDistortion;
  uniform float uSpeed;
  uniform vec3  uCameraPos;

  const float PI = 3.14159265;

  vec3 hsb2rgb(in vec3 c){
    vec3 rgb = clamp(
      abs(mod(c.x * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0,
      0.0,
      1.0
    );
    rgb = rgb * rgb * (3.0 - 2.0 * rgb);
    return c.z * mix(vec3(.5), rgb, c.y);
  }

  float hash(vec3 p) {
    p = vec3(
      dot(p, vec3(127.1, 311.7,  74.7)),
      dot(p, vec3(269.5, 183.3, 246.1)),
      dot(p, vec3(113.5, 271.9, 124.6))
    );
    return fract(sin(p.x + p.y + p.z) * 43758.5453123);
  }

  float noise3D(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);

    float n000 = hash(i + vec3(0.0, 0.0, 0.0));
    float n100 = hash(i + vec3(1.0, 0.0, 0.0));
    float n010 = hash(i + vec3(0.0, 1.0, 0.0));
    float n110 = hash(i + vec3(1.0, 1.0, 0.0));
    float n001 = hash(i + vec3(0.0, 0.0, 1.0));
    float n101 = hash(i + vec3(1.0, 0.0, 1.0));
    float n011 = hash(i + vec3(0.0, 1.0, 1.0));
    float n111 = hash(i + vec3(1.0, 1.0, 1.0));

    float nx00 = mix(n000, n100, f.x);
    float nx10 = mix(n010, n110, f.x);
    float nx01 = mix(n001, n101, f.x);
    float nx11 = mix(n011, n111, f.x);

    float nxy0 = mix(nx00, nx10, f.y);
    float nxy1 = mix(nx01, nx11, f.y);

    return mix(nxy0, nxy1, f.z);
  }

  vec3 sampleRainbow(vec3 pos) {
    vec3 p = pos * uScale;
    float angle = atan(p.z, p.x);
    float radius = length(p.xy);
    float base = radius * .01 - uTime * uSpeed;
    float n = noise3D(p * 0.2 + uTime * 0.1) * uDistortion;
    float swirl = sin(base + n) * 0.1 + 0.5;

    float hue = fract(angle / (2.0 * PI) + p.y * 0.5 + n * 0.1 + uTime * 0.2);
    float sat = 0.5 + 0.1* swirl;
    float val = mix(0.25, uBrightness, swirl);

    return hsb2rgb(vec3(hue, sat, val));
  }

  void main() {
    vec3 viewDir = normalize(vWorldPos - uCameraPos);
    vec3 accum = vec3(0.0);
    float accumW = 0.0;

    const int STEPS = 3;
    for (int i = 0; i < STEPS; i++) {
      float tIn = float(i) / float(STEPS - 1);
      float offset = (tIn - 0.5) * uDepth;
      vec3 samplePos = vWorldPos - viewDir * offset;
      vec3 c = sampleRainbow(samplePos);
      float w = mix(2.0, 0.35, tIn);
      accum += c * w;
      accumW += w;
    }

    vec3 color = accum / max(accumW, 0.0001);
    gl_FragColor = vec4(color, uOpacity);
  }
`;

const swirlFragmentShaderIOS = `
  precision mediump float;
  precision mediump int;

  varying vec3 vWorldPos;

  uniform float uTime;
  uniform float uScale;
  uniform float uBrightness;
  uniform float uOpacity;
  uniform vec3  uCameraPos;

  const float PI = 3.14159265;

  vec3 hsb2rgb(in vec3 c){
    vec3 rgb = clamp(
      abs(mod(c.x * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0,
      0.0,
      1.0
    );
    rgb = rgb * rgb * (3.0 - 2.0 * rgb);
    return c.z * mix(vec3(1.0), rgb, c.y);
  }

  void main() {
    vec3 p = vWorldPos * uScale;
    float angle = atan(p.z, p.x);
    float radius = length(p.xy);

    float hue = fract(angle / (2.0 * PI) + uTime * 0.12);
    float sat = 0.8;
    float ring = smoothstep(0.0, 1.6, radius);
    float val = mix(0.6, uBrightness, ring);

    vec3 color = hsb2rgb(vec3(hue, sat, val));
    gl_FragColor = vec4(color, uOpacity);
  }
`;

const bgVertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const bgFragmentShader = `
  precision mediump float;
  precision mediump int;

  varying vec2 vUv;

  uniform sampler2D uTexCurrent;
  uniform sampler2D uTexNext;
  uniform float uMix;
  uniform float uTime;

  float hash(vec3 p) {
    p = vec3(
      dot(p, vec3(127.1, 311.7,  74.7)),
      dot(p, vec3(269.5, 183.3, 246.1)),
      dot(p, vec3(113.5, 271.9, 124.6))
    );
    return fract(sin(p.x + p.y + p.z) * 43758.5453123);
  }

  float noise3D(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);

    float n000 = hash(i + vec3(0.0, 0.0, 0.0));
    float n100 = hash(i + vec3(1.0, 0.0, 0.0));
    float n010 = hash(i + vec3(0.0, 1.0, 0.0));
    float n110 = hash(i + vec3(1.0, 1.0, 0.0));
    float n001 = hash(i + vec3(0.0, 0.0, 1.0));
    float n101 = hash(i + vec3(1.0, 0.0, 1.0));
    float n011 = hash(i + vec3(0.0, 1.0, 1.0));
    float n111 = hash(i + vec3(1.0, 1.0, 1.0));

    float nx00 = mix(n000, n100, f.x);
    float nx10 = mix(n010, n110, f.x);
    float nx01 = mix(n001, n101, f.x);
    float nx11 = mix(n011, n111, f.x);

    float nxy0 = mix(nx00, nx10, f.y);
    float nxy1 = mix(nx01, nx11, f.y);

    return mix(nxy0, nxy1, f.z);
  }

  float fbm(vec3 p) {
    float sum = 0.0;
    float amp = 0.5;
    float freq = 1.0;
    for (int i = 0; i < 2; i++) {
      sum += amp * noise3D(p * freq);
      freq *= 2.0;
      amp *= 0.5;
    }
    return sum;
  }

  void main() {
    vec4 c1 = texture2D(uTexCurrent, vUv);
    vec4 c2 = texture2D(uTexNext, vUv);
    vec4 baseTex = mix(c1, c2, uMix);

    vec2 centered = vUv - 0.5;
    float r = length(centered);

    float centerRadius = 0.1;
    float outerRadius  = 0.48;

    vec3 p = vec3(vUv * 5.0, uTime * 0.2);
    float n = fbm(p);
    float clouds = smoothstep(0.1, .6, n);

    float radial = 1.0 - smoothstep(centerRadius, outerRadius, r);
    float center = .1 - smoothstep(centerRadius * .000075, centerRadius, r);

    float mask = max(clouds * radial, center);
    mask = clamp(mask, 0.0, 2.0);

    float shaped = pow(mask, 1.1);
    float minDark = 0.007;
    float brightness = mix(minDark, 1.0, shaped);

    vec3 color = baseTex.rgb * brightness * .9;
    gl_FragColor = vec4(color, baseTex.a);
  }
`;

const NAV_ITEMS = [
  { key: "mission", label: "Home", image: "1-min.jpg" },
  { key: "contact", label: "Mission", image: "2-min.jpg" },
  { key: "donations", label: "Donate", image: "3-min.jpg" },
  { key: "shop", label: "Shop", image: "4-min.jpg" },
  { key: "events", label: "Contact", image: "5-min.jpg" },
] as const;

type NavItem = (typeof NAV_ITEMS)[number];

const MODEL_STATES = [
  { zoom: 1.0, yShift: 0.0, rotX: 0.0, rotY: 0.0 },
  { zoom: 4.0, yShift: 2.5, rotX: 0.0, rotY: 1.0 },
  { zoom: 7.0, yShift: 2.0, rotX: 0.0, rotY: 0.0 },
  { zoom: 5.2, yShift: 1.5, rotX: -1.15, rotY: -3.0 },
  { zoom: 1.0, yShift: 0.0, rotX: 0.0, rotY: -3.0 },
];

function usePointerLightControls() {
  const targetRotationRef = useRef({ x: 0, y: 0 });
  const lightIntensityRef = useRef(0.7);
  const lightSpeedRef = useRef(0);

  useEffect(() => {
    let lastX = window.innerWidth / 2;
    let lastY = window.innerHeight / 2;
    let lastTime = performance.now();

    const handleMove = (e: PointerEvent) => {
      const x = e.clientX;
      const y = e.clientY;
      const now = performance.now();
      const dt = Math.max((now - lastTime) / 1000, 0.001);

      const dx = x - lastX;
      const dy = y - lastY;
      const speed = Math.sqrt(dx * dx + dy * dy) / dt;

      lastX = x;
      lastY = y;
      lastTime = now;

      const nx = x / window.innerWidth - 0.5;
      const ny = y / window.innerHeight - 0.5;
      const maxAngle = Math.PI / 3;

      targetRotationRef.current = { x: -ny * maxAngle, y: nx * maxAngle };

      const vNorm = Math.min(speed / 1000, 1);
      const minIntensity = 0.4;
      const maxIntensityVal = 2.5;
      lightIntensityRef.current =
        minIntensity + (maxIntensityVal - minIntensity) * vNorm;

      lightSpeedRef.current = vNorm;
    };

    window.addEventListener("pointermove", handleMove);
    return () => window.removeEventListener("pointermove", handleMove);
  }, []);

  return { targetRotationRef, lightIntensityRef, lightSpeedRef };
}

function useSections(
  navItems: NavItem[],
  _sectionRefs: Record<string, RefObject<HTMLElement>>
) {
  const [activeKey, setActiveKey] = useState<string>(
    navItems[0]?.key ?? "mission"
  );
  const [heroProgress, setHeroProgress] = useState(0);
  const scrollTargetRef = useRef(0);

  useEffect(() => {
    const handleScroll = () => {
      const viewportH = window.innerHeight || 1;
      const totalSections = navItems.length;
      const totalScrollable = viewportH * (totalSections - 1);

      const rawT = totalScrollable > 0 ? window.scrollY / totalScrollable : 0;
      const t = Math.max(0, Math.min(1, rawT));
      scrollTargetRef.current = t;

      const heroRaw = Math.max(
        0,
        Math.min(1, window.scrollY / Math.max(viewportH, 1))
      );
      setHeroProgress(heroRaw);

      const indexFloat = (window.scrollY + viewportH * 0.5) / viewportH;
      let idx = Math.floor(indexFloat);
      idx = Math.max(0, Math.min(totalSections - 1, idx));

      const item = navItems[idx];
      const newKey = item.key;
      setActiveKey((prev) => (prev === newKey ? prev : newKey));
    };

    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true } as any);
    return () => window.removeEventListener("scroll", handleScroll);
  }, [navItems]);

  const handleNavClick = (key: string) => {
    const idx = navItems.findIndex((i) => i.key === key);
    if (idx >= 0) {
      const viewportH = window.innerHeight || 1;
      const targetY = idx * viewportH;
      window.scrollTo({ top: targetY, behavior: "smooth" });
    }
    setActiveKey(key);
  };

  return { activeKey, scrollTargetRef, handleNavClick, heroProgress };
}

function useThreeScene(params: {
  mountRef: RefObject<HTMLDivElement>;
  scrollTargetRef: React.MutableRefObject<number>;
  targetRotationRef: React.MutableRefObject<{ x: number; y: number }>;
  lightIntensityRef: React.MutableRefObject<number>;
  lightSpeedRef: React.MutableRefObject<number>;
}) {
  const startCrossfadeToRef = useRef<(fileName: string) => void>(() => {});

  useEffect(() => {
    const container = params.mountRef.current;
    if (!container) return;

    const ua = navigator.userAgent || "";
    const isIOS =
      /iPad|iPhone|iPod/.test(ua) ||
      (ua.includes("Mac") && "ontouchend" in document);
    const isMobile =
      /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
        ua
      ) ||
      ("ontouchstart" in window && ua.includes("Mobile"));

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);

    const camera = new THREE.PerspectiveCamera(
      45,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    camera.position.set(0, 0, 5);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
      alpha: false,
    });

    renderer.setPixelRatio(1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x000000, 1);

    renderer.domElement.className = "three-canvas";
    container.appendChild(renderer.domElement);

    const gl = renderer.getContext();
    if (!gl) {
      console.warn("WebGL context not available");
      return () => {
        if (container.contains(renderer.domElement)) {
          container.removeChild(renderer.domElement);
        }
        renderer.dispose();
      };
    }

    const MAX_RENDER_PIXELS = 1000 * 1000;

    const updateRendererSize = () => {
      const w = window.innerWidth || 1;
      const h = window.innerHeight || 1;
      const area = w * h;

      let scale = 1;
      if (area > MAX_RENDER_PIXELS) scale = Math.sqrt(MAX_RENDER_PIXELS / area);

      const rw = Math.max(1, Math.round(w * scale));
      const rh = Math.max(1, Math.round(h * scale));

      renderer.setSize(rw, rh, false);

      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };

    updateRendererSize();

    const texLoader = new THREE.TextureLoader();
    const textureCache: Record<string, THREE.Texture> = {};
    const planeGeom = new THREE.PlaneGeometry(10, 10);

    let bgMesh: THREE.Mesh<
      THREE.PlaneGeometry,
      THREE.ShaderMaterial | THREE.MeshBasicMaterial
    > | null = null;

    const amb = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(amb);

    const dir = new THREE.DirectionalLight(0xffffff, 1);
    dir.position.set(5, 10, 7.5);
    scene.add(dir);

    const slowColor = new THREE.Color(0x8fd9ff);
    const fastColor = new THREE.Color(0xffffff);
    const targetColor = new THREE.Color();

    const swirlFS = isMobile ? swirlFragmentShaderIOS : swirlFragmentShader;

    let swirlMat: THREE.ShaderMaterial | null = null;
    let model: THREE.Object3D | null = null;

    let baseScale = 1;
    const basePosition = new THREE.Vector3();
    let bottomShift = 0;
    let scrollProgress = 0;

    texLoader.load(
      asset("images/1-min.jpg"),
      (baseTex) => {
        baseTex.colorSpace = THREE.SRGBColorSpace;
        baseTex.mapping = THREE.EquirectangularReflectionMapping;
        baseTex.minFilter = THREE.LinearFilter;
        baseTex.magFilter = THREE.LinearFilter;
        baseTex.generateMipmaps = false;
        baseTex.needsUpdate = true;

        scene.environment = baseTex;
        textureCache["1-min.jpg"] = baseTex;

        if (isMobile) {
          const bgMaterial = new THREE.MeshBasicMaterial({
            map: baseTex,
            color: new THREE.Color(0.18, 0.18, 0.18),
            depthWrite: false,
          });
          bgMesh = new THREE.Mesh(planeGeom, bgMaterial);
          bgMesh.position.set(0, 0, -3);
          scene.add(bgMesh);
        } else {
          const bgMaterial = new THREE.ShaderMaterial({
            uniforms: {
              uTexCurrent: { value: baseTex },
              uTexNext: { value: baseTex },
              uMix: { value: 0 },
              uTime: { value: 0 },
            },
            vertexShader: bgVertexShader,
            fragmentShader: bgFragmentShader,
            transparent: false,
            depthWrite: false,
          });

          bgMesh = new THREE.Mesh(planeGeom, bgMaterial);
          bgMesh.position.set(0, 0, -3);
          scene.add(bgMesh);
        }
      },
      undefined,
      (err) =>
        console.warn("Texture load failed:", asset("images/1-min.jpg"), err)
    );

    const loader = new GLTFLoader();
    loader.load(
      asset("models/ohm4.glb"),
      (gltf) => {
        model = gltf.scene;

        const glassMat = isIOS
          ? new THREE.MeshStandardMaterial({
              color: 0xffffff,
              roughness: 0.25,
              metalness: 0.0,
              transparent: true,
              opacity: 0.35,
            })
          : new THREE.MeshPhysicalMaterial({
              color: 0xffffff,
              roughness: 0.2,
              metalness: 0.0,
              transmission: 1.0,
              ior: 1.5,
              thickness: 1.0,
              envMapIntensity: 1.6,
              transparent: true,
              opacity: 1.0,
            });

        swirlMat = new THREE.ShaderMaterial({
          uniforms: {
            uTime: { value: 0 },
            uScale: { value: 3 },
            uBrightness: { value: 2 },
            uOpacity: { value: 0.5 },
            uDepth: { value: isIOS ? 0.7 : 1.0 },
            uDistortion: { value: isIOS ? 16.0 : 25.0 },
            uSpeed: { value: 1 },
            uCameraPos: { value: camera.position.clone() },
          },
          vertexShader: swirlVertexShader,
          fragmentShader: swirlFS,
          transparent: true,
          depthWrite: true,
          depthTest: true,
          blending: THREE.NormalBlending,
          side: THREE.FrontSide,
        });

        model.traverse((child: any) => {
          if (!child.isMesh) return;
          const mat = child.material;

          if (Array.isArray(mat)) {
            child.material = mat.map((m) => {
              if (!m) return m;
              const name = (m.name || "").toLowerCase();
              if (name.includes("glass")) return glassMat;
              if (name.includes("swirl") && swirlMat) {
                child.renderOrder = 2;
                swirlMat.depthTest = false;
                return swirlMat;
              }
              return m;
            });
          } else if (mat) {
            const name = (mat.name || "").toLowerCase();
            if (name.includes("glass")) {
              child.material = glassMat;
              child.renderOrder = 1;
            }
            if (name.includes("swirl") && swirlMat) {
              child.material = swirlMat;
              child.renderOrder = 2;
              swirlMat.depthTest = false;
            }
          }
        });

        const box = new THREE.Box3().setFromObject(model);
        const size = new THREE.Vector3();
        const center = new THREE.Vector3();
        box.getSize(size);
        box.getCenter(center);

        model.position.sub(center);

        const maxSide = Math.max(size.x, size.y, size.z) || 1;
        const scale = 2 / maxSide;
        model.scale.setScalar(scale);

        baseScale = scale;
        basePosition.copy(model.position);
        bottomShift = (size.y / 2) * scale;

        scene.add(model);
      },
      undefined,
      (err) => console.warn("GLB load failed:", asset("models/ohm4.glb"), err)
    );

    let isFading = false;
    let fadeProgress = 0;
    const fadeDuration = 0.2;
    let lastTime: number | null = null;

    const startCrossfadeTo = (fileName: string) => {
      if (!bgMesh) return;

      const applyTex = (tex: THREE.Texture) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.mapping = THREE.EquirectangularReflectionMapping;
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.generateMipmaps = false;
        tex.needsUpdate = true;

        scene.environment = tex;

        const mat = bgMesh!.material;

        if (mat instanceof THREE.ShaderMaterial) {
          mat.uniforms.uTexNext.value = tex;
          fadeProgress = 0;
          isFading = true;
        } else if (mat instanceof THREE.MeshBasicMaterial) {
          mat.map = tex;
          mat.needsUpdate = true;
          isFading = false;
        }
      };

      if (textureCache[fileName]) {
        applyTex(textureCache[fileName]);
      } else {
        texLoader.load(
          asset(`images/${fileName}`),
          (tex) => {
            textureCache[fileName] = tex;
            applyTex(tex);
          },
          undefined,
          (err) =>
            console.warn(
              "Texture load failed:",
              asset(`images/${fileName}`),
              err
            )
        );
      }
    };

    startCrossfadeToRef.current = startCrossfadeTo;

    let frameId: number;

    const animate = () => {
      frameId = requestAnimationFrame(animate);

      const now = performance.now() * 0.001;
      if (lastTime == null) lastTime = now;
      const dt = now - lastTime;
      lastTime = now;

      if (swirlMat) {
        const u = swirlMat.uniforms as any;
        u.uTime.value = now;
        u.uCameraPos.value.copy(camera.position);
      }

      if (bgMesh) {
        const mat = bgMesh.material;
        if (mat instanceof THREE.ShaderMaterial) {
          if (mat.uniforms.uTime) mat.uniforms.uTime.value = now;
          if (isFading) {
            fadeProgress = Math.min(1, fadeProgress + dt / fadeDuration);
            mat.uniforms.uMix.value = fadeProgress;
            if (fadeProgress >= 1) {
              mat.uniforms.uTexCurrent.value = mat.uniforms.uTexNext.value;
              mat.uniforms.uMix.value = 0.0;
              isFading = false;
            }
          }
        }
      }

      const targetIntensity = params.lightIntensityRef.current;
      const liLerp = 0.1;
      amb.intensity += (targetIntensity - amb.intensity) * liLerp;
      dir.intensity += (targetIntensity - dir.intensity) * liLerp;

      const speedT = THREE.MathUtils.clamp(params.lightSpeedRef.current, 0, 1);
      targetColor.lerpColors(slowColor, fastColor, speedT);
      amb.color.lerp(targetColor, 0.15);
      dir.color.lerp(targetColor, 0.15);

      if (model) {
        const target = params.scrollTargetRef.current;
        const smoothing = 0.12;
        const tRaw = scrollProgress + (target - scrollProgress) * smoothing;
        scrollProgress = tRaw;
        const t = tRaw * tRaw * (3 - 2 * tRaw);

        const states = MODEL_STATES;
        const lastIndex = states.length - 1;
        const scaled = t * lastIndex;
        const idx0 = Math.floor(scaled);
        const idx1 = Math.min(lastIndex, idx0 + 1);
        const f = THREE.MathUtils.clamp(scaled - idx0, 0, 1);

        const s0 = states[idx0];
        const s1 = states[idx1];

        const zoom = THREE.MathUtils.lerp(s0.zoom, s1.zoom, f);
        const yShiftFactor = THREE.MathUtils.lerp(s0.yShift, s1.yShift, f);
        const baseRotX = THREE.MathUtils.lerp(s0.rotX, s1.rotX, f);
        const baseRotY = THREE.MathUtils.lerp(s0.rotY, s1.rotY, f);

        model.scale.setScalar(baseScale * zoom);

        const shiftY = bottomShift * yShiftFactor;
        model.position.x = basePosition.x;
        model.position.z = basePosition.z;
        model.position.y = basePosition.y + shiftY;

        const { x: pointerX, y: pointerY } = params.targetRotationRef.current;
        const rotLerp = 0.08;
        const pointerStrength = 0.4;

        const targetRotX = baseRotX + pointerX * pointerStrength;
        const targetRotY = baseRotY + pointerStrength * pointerY;

        model.rotation.x += (targetRotX - model.rotation.x) * rotLerp;
        model.rotation.y += (targetRotY - model.rotation.y) * rotLerp;
      }

      renderer.render(scene, camera);
    };

    animate();

    const onResize = () => updateRendererSize();
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener("resize", onResize);
      if (container.contains(renderer.domElement))
        container.removeChild(renderer.domElement);
      renderer.dispose();
    };
  }, [
    params.mountRef,
    params.scrollTargetRef,
    params.targetRotationRef,
    params.lightIntensityRef,
    params.lightSpeedRef,
  ]);

  const startCrossfadeTo = useCallback((fileName: string) => {
    startCrossfadeToRef.current(fileName);
  }, []);

  return { startCrossfadeTo };
}

type FooterNavProps = {
  items: NavItem[];
  activeKey: string;
  onItemHover: (item: NavItem) => void;
  onItemLeave: () => void;
  onItemClick: (key: string) => void;
  opacity: number;
};

function FooterNav({
  items,
  activeKey,
  onItemHover,
  onItemLeave,
  onItemClick,
  opacity,
}: FooterNavProps) {
  const [hoverKey, setHoverKey] = useState<string | null>(null);

  return (
    <div
      className="footer-nav"
      style={{
        opacity,
        pointerEvents: opacity > 0.05 ? "auto" : "none",
      }}
    >
      {items.map((item) => {
        const isHover = hoverKey === item.key;
        const isActive = activeKey === item.key;
        const className =
          "footer-button" +
          (isActive ? " is-active" : "") +
          (isHover ? " is-hover" : "");
        return (
          <button
            key={item.key}
            className={className}
            onMouseEnter={() => {
              setHoverKey(item.key);
              onItemHover(item);
            }}
            onMouseLeave={() => {
              setHoverKey(null);
              onItemLeave();
            }}
            onClick={() => onItemClick(item.key)}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

export default function App() {
  const threeRef = useRef<HTMLDivElement | null>(null);

  const missionRef = useRef<HTMLElement | null>(null);
  const contactRef = useRef<HTMLElement | null>(null);
  const donationsRef = useRef<HTMLElement | null>(null);
  const shopRef = useRef<HTMLElement | null>(null);
  const eventsRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const setVh = () => {
      const vh = window.innerHeight * 0.01;
      document.documentElement.style.setProperty("--app-vh", `${vh}px`);
    };

    setVh();
    window.addEventListener("resize", setVh);
    window.addEventListener("orientationchange", setVh);

    return () => {
      window.removeEventListener("resize", setVh);
      window.removeEventListener("orientationchange", setVh);
    };
  }, []);

  const sectionRefs: Record<string, RefObject<HTMLElement>> = {
    mission: missionRef,
    contact: contactRef,
    donations: donationsRef,
    shop: shopRef,
    events: eventsRef,
  };

  const { targetRotationRef, lightIntensityRef, lightSpeedRef } =
    usePointerLightControls();

  const { activeKey, scrollTargetRef, handleNavClick, heroProgress } =
    useSections(NAV_ITEMS, sectionRefs);

  const { startCrossfadeTo } = useThreeScene({
    mountRef: threeRef,
    scrollTargetRef,
    targetRotationRef,
    lightIntensityRef,
    lightSpeedRef,
  });

  const activeItem = NAV_ITEMS.find((i) => i.key === activeKey) ?? NAV_ITEMS[0];
  const activeImage = activeItem.image;

  const easedHero = heroProgress * heroProgress * (3 - 2 * heroProgress);
  const uiOpacity = easedHero;

  useEffect(() => {
    startCrossfadeTo(activeImage);
  }, [activeImage, startCrossfadeTo]);

  return (
    <div className="app-root">
      <div ref={threeRef} className="three-container" />

      <div className="top-shell" style={{ opacity: uiOpacity }}>
        <div className="top-inner">
          <div className="marquee-window">
            <div className="marquee-track">
              <span>Music / Art / Tech / Community /&nbsp;&nbsp;</span>
              <span>Music / Art / Tech / Community /&nbsp;&nbsp;</span>
            </div>
          </div>

          <div className="top-email">
            <a href="mailto:ohmalbany@gmail.com" aria-label="Email OHM">
              <img
                className="top-logo"
                src={asset("images/logo-sphere.svg")}
                alt="OHM"
                draggable={false}
              />
            </a>
          </div>
        </div>
      </div>

      <main className="app-main">
        <div className="main-inner">
          <section
            ref={missionRef}
            className={
              "section section-hero" +
              (activeKey === "mission" ? " is-active" : "")
            }
          >
            <div className="hero-inner">
              <div>
                <h1 className="hero-title">Ohm</h1>
              </div>

              <div className="hero-bottom">
                <p className="hero-copy">
                  OHM envisions a thriving Capital Region of New York where
                  electronic music and arts serve as a vibrant cultural
                  cornerstone, uniting local creatives with global talent and
                  inspiring future generations of artists.
                </p>
                <button
                  className="hero-enter"
                  onClick={() => handleNavClick("contact")}
                >
                  Enter
                </button>
              </div>
            </div>
          </section>

          <section
            ref={contactRef}
            className={
              "section" + (activeKey === "contact" ? " is-active" : "")
            }
          >
            <div className="section-inner">
              <h2 className="section-title">Mission</h2>
              <p className="section-body">
                OHM is dedicated to advancing electronic art &amp; music culture
                in Albany by providing a cutting-edge, multi-disciplinary venue
                that acts as a creative hub and community space for residents
                and visitors.
                <br />
                <br />
                Through fair artist compensation, innovative programming, and
                active community engagement, our goal is to nurture a creative
                environment that uplifts local talent, promotes skills-sharing,
                enriches the cultural landscape, and sparks a new era of
                creativity in the Capital Region.
              </p>
            </div>
          </section>

          <section
            ref={donationsRef}
            className={
              "section" + (activeKey === "donations" ? " is-active" : "")
            }
          >
            <div className="section-inner">
              <h2 className="section-title">Donations</h2>
              <p className="section-body">
                The OHM Organization is a grassroots nonprofit dedicated to
                advancing electronic art and music culture in the NY Capital
                Region.
                <br />
                <br />
                Our mission is to nurture a creative environment that uplifts
                local talent, encourages skill-sharing, and enriches the
                cultural landscape through collaboration across all styles and
                art forms. We believe in building more than just events, we’re
                cultivating a lasting community supported by positive values,
                shared resources, and meaningful connections.
              </p>
              <button
                className="section-cta"
                onClick={() =>
                  (window.location.href =
                    "https://www.gofundme.com/f/build-a-long-lasting-infrastructure-for-the-electronic-arts?lang=en_US")
                }
              >
                Support OHM
              </button>
            </div>
          </section>

          <section
            ref={shopRef}
            className={"section" + (activeKey === "shop" ? " is-active" : "")}
          >
            <div className="section-inner">
              <h2 className="section-title">Shop</h2>
              <p className="section-body">
                OHM is dedicated to advancing electronic art &amp; music culture
                in Albany by providing a cutting-edge, multi-disciplinary venue
                that acts as a creative hub and community space for residents
                and visitors.
              </p>
              <button
                className="section-cta"
                onClick={() =>
                  (window.location.href = "https://www.shopify.com/")
                }
              >
                Buy Merch
              </button>
            </div>
          </section>

          <section
            ref={eventsRef}
            className={"section" + (activeKey === "events" ? " is-active" : "")}
          >
            <div className="section-inner">
              <h2 className="section-title">Contact</h2>
              <p className="section-body">
                Reach out to connect with the team, share an idea, or learn more
                about how you can get involved in building a vibrant, inclusive
                future for electronic arts in the Capital Region.
              </p>
              <button
                className="section-cta"
                onClick={() =>
                  (window.location.href =
                    "mailto:ohmalbany@gmail.com?subject=Hello!")
                }
              >
                Email Us
              </button>
            </div>
          </section>
        </div>
      </main>

      <FooterNav
        items={NAV_ITEMS as NavItem[]}
        activeKey={activeKey}
        onItemHover={(item) => startCrossfadeTo(item.image)}
        onItemLeave={() => startCrossfadeTo(activeImage)}
        onItemClick={(key) => handleNavClick(key)}
        opacity={uiOpacity}
      />
    </div>
  );
}
