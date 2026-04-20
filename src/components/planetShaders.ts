// Custom GLSL planet shaders. All materials share the same uniform shape so the
// scene update loop can drive `time` and `sunDir` uniformly across body types.
//
// Each material implements:
//   - 3D simplex/value noise based surface pattern unique to its planet archetype
//   - Lambert-ish day/night terminator via dot(normal, sunDir)
//   - Fresnel atmospheric rim glow (color tunable per planet)
//   - Subtle gamma + tone shaping
//
// Note: we render with the standard WebGL renderer (not WebGPU) — TanStack
// Start's preview iframe doesn't expose `navigator.gpu`, and three.js's
// WebGLRenderer + ShaderMaterial works everywhere.

import * as THREE from "three";

export type PlanetKind = "rocky" | "gas" | "icy" | "ocean" | "ringed" | "lava" | "barren";

export type PlanetUniforms = {
  uTime: { value: number };
  uSunDir: { value: THREE.Vector3 };
  uBaseColor: { value: THREE.Color };
  uAccentColor: { value: THREE.Color };
  uAtmoColor: { value: THREE.Color };
  uSeed: { value: number };
  uAtmoStrength: { value: number };
  uCloudiness: { value: number };
};

const COMMON_NOISE_GLSL = /* glsl */ `
// Hash + 3D value noise (cheap, plenty for surface mottling).
vec3 hash3(vec3 p) {
  p = vec3(
    dot(p, vec3(127.1, 311.7, 74.7)),
    dot(p, vec3(269.5, 183.3, 246.1)),
    dot(p, vec3(113.5, 271.9, 124.6))
  );
  return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
}
float vnoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  float n000 = dot(hash3(i + vec3(0,0,0)), f - vec3(0,0,0));
  float n100 = dot(hash3(i + vec3(1,0,0)), f - vec3(1,0,0));
  float n010 = dot(hash3(i + vec3(0,1,0)), f - vec3(0,1,0));
  float n110 = dot(hash3(i + vec3(1,1,0)), f - vec3(1,1,0));
  float n001 = dot(hash3(i + vec3(0,0,1)), f - vec3(0,0,1));
  float n101 = dot(hash3(i + vec3(1,0,1)), f - vec3(1,0,1));
  float n011 = dot(hash3(i + vec3(0,1,1)), f - vec3(0,1,1));
  float n111 = dot(hash3(i + vec3(1,1,1)), f - vec3(1,1,1));
  return mix(
    mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
    mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y),
    u.z
  );
}
float fbm(vec3 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * vnoise(p);
    p *= 2.02;
    a *= 0.5;
  }
  return v;
}
`;

const VERT = /* glsl */ `
varying vec3 vNormalW;
varying vec3 vPosW;
varying vec3 vViewDir;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vPosW = wp.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vViewDir = normalize(cameraPosition - wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAG_HEADER = /* glsl */ `
varying vec3 vNormalW;
varying vec3 vPosW;
varying vec3 vViewDir;
uniform float uTime;
uniform vec3  uSunDir;
uniform vec3  uBaseColor;
uniform vec3  uAccentColor;
uniform vec3  uAtmoColor;
uniform float uSeed;
uniform float uAtmoStrength;
uniform float uCloudiness;
${COMMON_NOISE_GLSL}

vec3 applyLighting(vec3 albedo, vec3 N) {
  float ndl = dot(N, normalize(uSunDir));
  // Soft terminator + tiny ambient
  float lit = clamp(ndl * 0.5 + 0.5, 0.0, 1.0);
  lit = smoothstep(0.0, 0.85, lit);
  vec3 dayNight = mix(albedo * 0.06, albedo, lit);
  // Fresnel rim atmosphere
  float fres = pow(1.0 - max(dot(vNormalW, vViewDir), 0.0), 3.0);
  vec3 atmo = uAtmoColor * fres * uAtmoStrength * (0.4 + 0.6 * lit);
  return dayNight + atmo;
}
`;

function makeUniforms(
  base: string,
  accent: string,
  atmo: string,
  seed: number,
  atmoStrength: number,
  cloudiness: number,
): PlanetUniforms {
  return {
    uTime: { value: 0 },
    uSunDir: { value: new THREE.Vector3(1, 0.3, 0.5).normalize() },
    uBaseColor: { value: new THREE.Color(base) },
    uAccentColor: { value: new THREE.Color(accent) },
    uAtmoColor: { value: new THREE.Color(atmo) },
    uSeed: { value: seed },
    uAtmoStrength: { value: atmoStrength },
    uCloudiness: { value: cloudiness },
  };
}

// ─── Rocky (Mars / Mercury / generic terrestrial) ────────────────────────────
export function makeRockyMaterial(opts: {
  base: string;
  accent: string;
  atmo: string;
  seed: number;
  atmoStrength?: number;
  /** 0 = no clouds (Mercury), 0.2–0.4 = sparse wispy patches (Mars-like). */
  cloudiness?: number;
}): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: makeUniforms(
      opts.base,
      opts.accent,
      opts.atmo,
      opts.seed,
      opts.atmoStrength ?? 0.55,
      opts.cloudiness ?? 0,
    ),
    vertexShader: VERT,
    fragmentShader: FRAG_HEADER + /* glsl */ `
      void main() {
        vec3 p = normalize(vPosW) * 4.0 + vec3(uSeed);
        // Continents: large fbm, sharpened
        float continents = fbm(p * 1.2);
        float craters = smoothstep(0.55, 0.62, fbm(p * 8.0 + 13.0));
        float dust = fbm(p * 18.0) * 0.15;
        float h = continents + dust - craters * 0.25;
        vec3 col = mix(uBaseColor, uAccentColor, smoothstep(-0.1, 0.4, h));
        // Polar ice caps
        float lat = abs(normalize(vPosW).y);
        col = mix(col, vec3(0.92, 0.95, 1.0), smoothstep(0.78, 0.95, lat));
        // Sparse high-altitude cloud patches — slowly drift, only appear in
        // isolated tufts. Higher threshold than ocean clouds so coverage stays low.
        if (uCloudiness > 0.001) {
          vec3 cp = p * 1.8 + vec3(uTime * 0.006, 0.0, uTime * 0.004);
          float cloudMask = fbm(cp * 1.6);
          // Two-stage threshold: only the brightest fbm peaks become clouds,
          // and a wider noise field gates them into rare patches.
          float patches = smoothstep(0.15, 0.45, fbm(p * 0.6 + 41.0));
          float clouds = smoothstep(0.62, 0.78, cloudMask) * patches;
          col = mix(col, vec3(0.95, 0.92, 0.86), clouds * uCloudiness);
        }
        gl_FragColor = vec4(applyLighting(col, vNormalW), 1.0);
      }
    `,
  });
}

// ─── Ocean (Earth-like blue marble with continents + clouds) ─────────────────
export function makeOceanMaterial(opts: {
  oceanColor: string;
  landColor: string;
  atmo: string;
  seed: number;
  cloudiness?: number;
}): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: makeUniforms(opts.oceanColor, opts.landColor, opts.atmo, opts.seed, 1.1, opts.cloudiness ?? 0.55),
    vertexShader: VERT,
    fragmentShader: FRAG_HEADER + /* glsl */ `
      void main() {
        vec3 p = normalize(vPosW) * 2.5 + vec3(uSeed);
        float h = fbm(p * 1.4);
        // Continent threshold creates oceans + landmasses
        float land = smoothstep(0.05, 0.18, h);
        vec3 ocean = uBaseColor;
        vec3 grass = uAccentColor;
        vec3 desert = mix(grass, vec3(0.78, 0.66, 0.42), 0.6);
        vec3 surface = mix(ocean, mix(grass, desert, smoothstep(0.25, 0.55, h)), land);
        // Polar ice
        float lat = abs(normalize(vPosW).y);
        surface = mix(surface, vec3(0.95, 0.97, 1.0), smoothstep(0.82, 0.97, lat));
        // Animated clouds (fbm domain warped by time)
        vec3 cp = p * 2.2 + vec3(uTime * 0.012, 0.0, uTime * 0.008);
        float clouds = smoothstep(0.55, 0.75, fbm(cp));
        surface = mix(surface, vec3(1.0), clouds * uCloudiness);
        gl_FragColor = vec4(applyLighting(surface, vNormalW), 1.0);
      }
    `,
  });
}

// ─── Gas Giant (Jupiter / Saturn bands with turbulent flow) ──────────────────
export function makeGasGiantMaterial(opts: {
  base: string;
  accent: string;
  atmo: string;
  seed: number;
  bandStrength?: number;
}): THREE.ShaderMaterial {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      ...makeUniforms(opts.base, opts.accent, opts.atmo, opts.seed, 0.8, 0),
      uBandStrength: { value: opts.bandStrength ?? 0.7 },
    },
    vertexShader: VERT,
    fragmentShader: FRAG_HEADER + /* glsl */ `
      uniform float uBandStrength;
      void main() {
        vec3 n = normalize(vPosW);
        float lat = n.y;
        // Domain warp creates the swirl/turbulence in bands
        vec3 warp = vec3(fbm(n * 3.0 + uTime * 0.02), 0.0, fbm(n * 3.0 + 7.3));
        float bandCoord = lat * 6.0 + warp.x * 0.8 * uBandStrength + uSeed;
        float bands = sin(bandCoord) * 0.5 + 0.5;
        bands = pow(bands, 1.4);
        vec3 col = mix(uBaseColor, uAccentColor, bands);
        // Storm spots (rare bright/dark cells)
        float spots = smoothstep(0.78, 0.85, fbm(n * 12.0 + warp));
        col = mix(col, uAccentColor * 1.4, spots * 0.4);
        // Subtle equatorial darkening
        col *= 1.0 - 0.15 * smoothstep(0.6, 0.0, abs(lat));
        gl_FragColor = vec4(applyLighting(col, vNormalW), 1.0);
      }
    `,
  });
  return mat;
}

// ─── Icy (Uranus / Neptune / ice moons) ──────────────────────────────────────
export function makeIcyMaterial(opts: {
  base: string;
  accent: string;
  atmo: string;
  seed: number;
}): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: makeUniforms(opts.base, opts.accent, opts.atmo, opts.seed, 1.3, 0),
    vertexShader: VERT,
    fragmentShader: FRAG_HEADER + /* glsl */ `
      void main() {
        vec3 p = normalize(vPosW) * 3.0 + vec3(uSeed);
        // Subtle banded structure for ice giants
        float lat = normalize(vPosW).y;
        float bands = sin(lat * 4.0 + fbm(p * 2.0) * 0.6) * 0.5 + 0.5;
        float h = fbm(p * 2.5);
        vec3 col = mix(uBaseColor, uAccentColor, bands * 0.35 + h * 0.25);
        // Crack lines (Europa-style) when seed selects it
        float cracks = smoothstep(0.48, 0.5, abs(fbm(p * 10.0)));
        col = mix(col, vec3(0.1, 0.2, 0.35), (1.0 - cracks) * 0.18 * step(0.5, fract(uSeed * 7.3)));
        gl_FragColor = vec4(applyLighting(col, vNormalW), 1.0);
      }
    `,
  });
}

// ─── Lava (Volcanic / Venus-like / hot rocky) ────────────────────────────────
export function makeLavaMaterial(opts: {
  base: string;
  accent: string;
  atmo: string;
  seed: number;
}): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: makeUniforms(opts.base, opts.accent, opts.atmo, opts.seed, 1.0, 0),
    vertexShader: VERT,
    fragmentShader: FRAG_HEADER + /* glsl */ `
      void main() {
        vec3 p = normalize(vPosW) * 5.0 + vec3(uSeed);
        float h = fbm(p * 1.5);
        float cracks = smoothstep(0.42, 0.48, fbm(p * 6.0 + uTime * 0.05));
        vec3 col = mix(uBaseColor, uAccentColor, cracks);
        // Glowing lava lines (emissive-ish, additive on top of dark crust)
        float glow = smoothstep(0.55, 0.7, fbm(p * 4.0 - uTime * 0.03));
        vec3 lit = applyLighting(col, vNormalW);
        lit += vec3(1.0, 0.45, 0.1) * glow * 0.6;
        gl_FragColor = vec4(lit, 1.0);
      }
    `,
  });
}

// ─── Barren (Moon / Mercury — heavy cratering, no atmosphere) ────────────────
export function makeBarrenMaterial(opts: {
  base: string;
  accent: string;
  seed: number;
}): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: makeUniforms(opts.base, opts.accent, "#000000", opts.seed, 0.05, 0),
    vertexShader: VERT,
    fragmentShader: FRAG_HEADER + /* glsl */ `
      void main() {
        vec3 p = normalize(vPosW) * 6.0 + vec3(uSeed);
        float regolith = fbm(p * 2.0);
        // Layered crater rings
        float c1 = smoothstep(0.55, 0.6, fbm(p * 5.0));
        float c2 = smoothstep(0.5, 0.55, fbm(p * 12.0 + 19.0));
        float craters = max(c1, c2 * 0.7);
        vec3 col = mix(uBaseColor, uAccentColor, regolith * 0.5 + craters * 0.3);
        gl_FragColor = vec4(applyLighting(col, vNormalW), 1.0);
      }
    `,
  });
}

/** Update time + sun direction on a planet ShaderMaterial (cheap). */
export function tickPlanetUniforms(mat: THREE.ShaderMaterial, time: number, sunDir: THREE.Vector3) {
  const u = mat.uniforms as PlanetUniforms;
  u.uTime.value = time;
  u.uSunDir.value.copy(sunDir);
}
