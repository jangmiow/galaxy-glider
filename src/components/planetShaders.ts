// Cinematic planet shaders. All materials share the same uniform shape so the
// scene update loop can drive `time` and `sunDir` uniformly across body types.
//
// Phase 1 upgrade: each material now implements:
//   - 6-octave domain-warped fbm for richer, less repetitive surfaces
//   - Wrap-around Lambert + soft terminator with a warm sunset tint
//   - Henyey-Greenstein-ish atmospheric scattering rim (forward & back scatter)
//   - Specular sun-glint on ocean worlds (Blinn-Phong)
//   - Separated cloud layer with self-cast shadows on the terrain below
//   - Sun-aware crater rim shading on barren worlds
//   - HDR emissive lava that plays nicely with bloom
//   - Gamma-ish output shaping for a filmic feel
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
  /**
   * 0 (far) → 1 (right at the surface). Drives cinematic detail boost when
   * the camera closes in: brighter atmospheric rim, sharper cloud contrast,
   * extra micro-detail octave on terrain. Updated every frame by
   * `tickPlanetUniforms`.
   */
  uProximity: { value: number };
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
// Higher-octave fbm for sharp surface micro-detail (use sparingly).
float fbm6(vec3 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 6; i++) {
    v += a * vnoise(p);
    p = p * 2.03 + vec3(11.7, 13.1, 17.3);
    a *= 0.5;
  }
  return v;
}
// Domain-warped fbm — adds turbulent, organic large-scale flow (continents,
// gas-giant turbulence, lava cracks). Two warp passes for richer motion.
float warpedFbm(vec3 p) {
  vec3 q = vec3(fbm(p + vec3(0.0)), fbm(p + vec3(5.2, 1.3, 9.4)), fbm(p + vec3(2.1, 7.7, 3.3)));
  vec3 r = vec3(
    fbm(p + 4.0 * q + vec3(1.7, 9.2, 1.1)),
    fbm(p + 4.0 * q + vec3(8.3, 2.8, 6.1)),
    fbm(p + 4.0 * q + vec3(4.5, 5.5, 7.7))
  );
  return fbm6(p + 4.0 * r);
}
`;

const VERT = /* glsl */ `
varying vec3 vNormalW;
varying vec3 vPosW;
varying vec3 vViewDir;
varying vec3 vLocalPos;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vPosW = wp.xyz;
  vLocalPos = position;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vViewDir = normalize(cameraPosition - wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAG_HEADER = /* glsl */ `
varying vec3 vNormalW;
varying vec3 vPosW;
varying vec3 vViewDir;
varying vec3 vLocalPos;
uniform float uTime;
uniform vec3  uSunDir;
uniform vec3  uBaseColor;
uniform vec3  uAccentColor;
uniform vec3  uAtmoColor;
uniform float uSeed;
uniform float uAtmoStrength;
uniform float uCloudiness;
uniform float uProximity;
${COMMON_NOISE_GLSL}

// Cinematic lighting model:
//  - Wrap-around diffuse for soft terminators
//  - Warm sunset tint near grazing angles
//  - Henyey-Greenstein-ish atmospheric rim with forward+back scatter
//  - Subtle ambient using the atmo color (bounce light)
vec3 applyLighting(vec3 albedo, vec3 N) {
  vec3 L = normalize(uSunDir);
  vec3 V = normalize(vViewDir);
  float ndl = dot(N, L);
  // Wrap diffuse softens the terminator (Valve half-Lambert, w=0.3)
  float wrap = 0.3;
  float lit = clamp((ndl + wrap) / (1.0 + wrap), 0.0, 1.0);
  lit = smoothstep(0.0, 1.0, lit);

  // Sunset/dawn warm band right around the terminator
  float term = 1.0 - abs(ndl);
  float sunset = pow(clamp(term, 0.0, 1.0), 6.0) * smoothstep(-0.15, 0.25, ndl);
  vec3 sunsetTint = vec3(1.0, 0.55, 0.28) * sunset * 0.55;

  // Soft ambient — atmosphere bounce on the dark side
  vec3 ambient = mix(uAtmoColor * 0.04, vec3(0.012, 0.014, 0.022), 0.5);

  vec3 dayNight = albedo * (lit + 0.05) + albedo * sunsetTint + albedo * ambient;

  // Atmospheric rim (Fresnel * forward-scatter on lit side). Boosted by
  // proximity so close approaches feel atmospherically dense. The exponent
  // also softens at close range, widening the rim halo on planet limbs.
  float fresExp = mix(3.0, 2.2, uProximity);
  float fres = pow(1.0 - max(dot(vNormalW, V), 0.0), fresExp);
  float vdl = max(dot(V, -L), 0.0);
  float forwardScatter = pow(vdl, 8.0); // bright halo when sun is behind planet
  float rimLit = 0.35 + 0.65 * lit;
  float atmoBoost = mix(1.0, 2.2, uProximity);
  float scatterBoost = mix(0.6, 1.1, uProximity);
  vec3 atmo = uAtmoColor * uAtmoStrength * atmoBoost * (fres * rimLit + forwardScatter * scatterBoost * fres);

  vec3 col = dayNight + atmo;
  // Mild filmic shaping
  col = col / (col + vec3(0.55));
  col = pow(col, vec3(0.95));
  return col;
}

// Specular highlight (Blinn-Phong) — used on oceans for sun glint.
float specGlint(vec3 N, float power, float strength) {
  vec3 L = normalize(uSunDir);
  vec3 V = normalize(vViewDir);
  vec3 H = normalize(L + V);
  float ndh = max(dot(N, H), 0.0);
  float ndl = max(dot(N, L), 0.0);
  return pow(ndh, power) * ndl * strength;
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
    uProximity: { value: 0 },
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
      opts.atmoStrength ?? 0.7,
      opts.cloudiness ?? 0,
    ),
    vertexShader: VERT,
    fragmentShader: FRAG_HEADER + /* glsl */ `
      void main() {
        vec3 n = normalize(vPosW);
        vec3 p = n * 4.0 + vec3(uSeed);
        // Continents via warped fbm — feels eroded and organic
        float continents = warpedFbm(p * 0.9);
        float midDetail  = fbm6(p * 3.5);
        float craters    = smoothstep(0.55, 0.62, fbm(p * 8.0 + 13.0));
        float dust       = fbm(p * 22.0) * 0.12;
        // Extra micro-detail octave that fades in with proximity — keeps
        // far-away silhouettes clean but rewards close approaches.
        float micro      = fbm6(p * 14.0) * 0.32 * uProximity;
        // Even-finer grain that only blooms in the last stretch of approach.
        float ultraMicro = fbm6(p * 38.0) * 0.18 * smoothstep(0.4, 1.0, uProximity);
        float h = continents * 0.85 + midDetail * 0.18 + dust + micro + ultraMicro - craters * 0.22;

        // Three-tone surface: lowland / midland / highland
        vec3 lowland  = uBaseColor * 0.78;
        vec3 midland  = uBaseColor;
        vec3 highland = mix(uAccentColor, vec3(1.0), 0.15);
        vec3 col = mix(lowland, midland, smoothstep(-0.1, 0.15, h));
        col = mix(col, highland, smoothstep(0.25, 0.55, h));

        // Valley shadows (darker in low spots) for depth — deepens with proximity.
        float valleyDepth = mix(0.1, 0.22, uProximity);
        col *= (1.0 - valleyDepth) + valleyDepth * smoothstep(-0.2, 0.4, h);

        // Polar ice caps with noisy edge
        float lat = abs(n.y);
        float capEdge = lat + fbm(p * 6.0) * 0.04;
        col = mix(col, vec3(0.94, 0.96, 1.0), smoothstep(0.78, 0.92, capEdge));

        // Sparse high-altitude cloud patches with self-shadow on the surface
        if (uCloudiness > 0.001) {
          vec3 cp = p * 1.8 + vec3(uTime * 0.006, 0.0, uTime * 0.004);
          float patches = smoothstep(0.15, 0.45, fbm(p * 0.6 + 41.0));
          float cloudMask = fbm6(cp * 1.6);
          // Boost contrast on close approach so wisps read as crisp shapes.
          float cloudContrast = mix(1.0, 1.4, uProximity);
          float clouds = smoothstep(0.62, 0.78, cloudMask) * patches * cloudContrast;
          // Sample a tiny step toward the sun for fake shadow
          vec3 shadowSample = cp + normalize(uSunDir) * 0.08;
          float shadow = smoothstep(0.62, 0.78, fbm(shadowSample * 1.6)) * patches;
          col *= 1.0 - shadow * uCloudiness * 0.35;
          col = mix(col, vec3(0.95, 0.92, 0.86), clamp(clouds, 0.0, 1.0) * uCloudiness);
        }
        gl_FragColor = vec4(applyLighting(col, vNormalW), 1.0);
      }
    `,
  });
}

// ─── Ocean (Earth-like blue marble with continents + clouds + sun glint) ─────
export function makeOceanMaterial(opts: {
  oceanColor: string;
  landColor: string;
  atmo: string;
  seed: number;
  cloudiness?: number;
}): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: makeUniforms(opts.oceanColor, opts.landColor, opts.atmo, opts.seed, 1.4, opts.cloudiness ?? 0.55),
    vertexShader: VERT,
    fragmentShader: FRAG_HEADER + /* glsl */ `
      void main() {
        vec3 n = normalize(vPosW);
        vec3 p = n * 2.5 + vec3(uSeed);
        // Continent shape via domain-warped fbm — irregular coastlines
        float h = warpedFbm(p * 1.1);
        float coast = smoothstep(0.04, 0.10, h);     // shoreline
        float land  = smoothstep(0.05, 0.18, h);     // interior

        // Ocean shading — depth-based gradient + small wave detail
        float depth = smoothstep(-0.4, 0.05, h);
        vec3 deepOcean    = uBaseColor * 0.55;
        vec3 shallowOcean = mix(uBaseColor, vec3(0.45, 0.78, 0.86), 0.6);
        vec3 ocean = mix(deepOcean, shallowOcean, depth);

        // Land tones: forest → grass → desert → mountain
        float biome = fbm(p * 2.5 + 7.1);
        vec3 forest = uAccentColor * 0.7;
        vec3 grass  = uAccentColor;
        vec3 desert = mix(grass, vec3(0.82, 0.68, 0.42), 0.7);
        vec3 mountain = mix(grass, vec3(0.55, 0.5, 0.45), 0.8);
        vec3 landCol = mix(forest, grass, smoothstep(0.3, 0.6, biome));
        landCol = mix(landCol, desert, smoothstep(0.55, 0.85, biome));
        landCol = mix(landCol, mountain, smoothstep(0.4, 0.7, h));

        vec3 surface = mix(ocean, landCol, land);
        // Beach line — bright sand at coast
        surface = mix(surface, vec3(0.92, 0.85, 0.66), (coast - land) * 0.8);

        // Polar ice with noisy edge
        float lat = abs(n.y);
        float ice = smoothstep(0.78, 0.94, lat + fbm(p * 8.0) * 0.05);
        surface = mix(surface, vec3(0.96, 0.98, 1.0), ice);

        // Animated cloud layer (warped fbm) with self-shadow on surface
        vec3 cp = p * 2.2 + vec3(uTime * 0.012, 0.0, uTime * 0.008);
        float cloudRaw = warpedFbm(cp * 0.9);
        // Sharper, higher-contrast cloud edges fade in with proximity.
        float cloudLo = mix(0.48, 0.52, uProximity);
        float cloudHi = mix(0.72, 0.66, uProximity);
        float clouds = smoothstep(cloudLo, cloudHi, cloudRaw);
        // Shadow sample slightly toward sun
        vec3 shadowP = cp + normalize(uSunDir) * 0.12;
        float cloudShadow = smoothstep(0.48, 0.72, warpedFbm(shadowP * 0.9));
        surface *= 1.0 - cloudShadow * uCloudiness * 0.45;
        surface = mix(surface, vec3(1.0), clouds * uCloudiness);

        vec3 lit = applyLighting(surface, vNormalW);

        // Sun glint — only on water (mask by 1 - land)
        float glint = specGlint(vNormalW, 90.0, 1.2) * (1.0 - land) * (1.0 - clouds * 0.7);
        lit += vec3(1.0, 0.95, 0.85) * glint;

        gl_FragColor = vec4(lit, 1.0);
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
      ...makeUniforms(opts.base, opts.accent, opts.atmo, opts.seed, 1.0, 0.7),
      uBandStrength: { value: opts.bandStrength ?? 0.7 },
    },
    vertexShader: VERT,
    fragmentShader: FRAG_HEADER + /* glsl */ `
      uniform float uBandStrength;
      void main() {
        vec3 n = normalize(vPosW);
        float lat = n.y;
        // Heavy domain warp creates sweeping turbulent bands
        vec3 wp = n * 3.0 + vec3(uTime * 0.02, 0.0, uSeed);
        float warp1 = warpedFbm(wp);
        float warp2 = fbm(wp * 2.0 + warp1);
        float bandCoord = lat * 7.0 + warp1 * 1.2 * uBandStrength + uSeed;
        float bands = sin(bandCoord) * 0.5 + 0.5;
        bands = pow(bands, 1.6);
        vec3 col = mix(uBaseColor, uAccentColor, bands);

        // Vortex / storm cells — bigger + more dramatic
        float vortex = smoothstep(0.72, 0.85, fbm6(n * 6.0 + warp2 * 1.5));
        vec3 stormCol = mix(uAccentColor * 1.5, vec3(1.0, 0.55, 0.4), 0.4);
        col = mix(col, stormCol, vortex * 0.5);

        // Polar hood (darker, smoother caps like Jupiter's poles)
        float polar = smoothstep(0.65, 0.95, abs(lat));
        col = mix(col, uBaseColor * 0.7, polar * 0.6);

        // Subtle equatorial brightening
        col *= 1.0 + 0.08 * (1.0 - smoothstep(0.0, 0.4, abs(lat)));

        // Zonal cloud streaks — fast-flowing wisps that brighten the lit side
        vec3 cloudP = n * 4.5 + vec3(uTime * 0.06, 0.0, 0.0);
        float zonalBands = sin(lat * 16.0 + warpedFbm(cloudP) * 2.0 + uTime * 0.08) * 0.5 + 0.5;
        zonalBands = pow(zonalBands, 2.2);
        float wisps = smoothstep(0.42, 0.85, fbm6(n * 9.0 + warp1 * 1.4 + uTime * 0.03));
        float clouds = zonalBands * wisps * uCloudiness;
        col = mix(col, mix(uBaseColor, vec3(1.0), 0.85), clouds * 0.55);

        // Close-approach band detail — extra high-frequency turbulence that
        // only appears when uProximity ramps up. Reveals filaments / curls.
        float bandDetail = fbm6(n * 18.0 + warp2 * 2.5 + uTime * 0.04);
        col = mix(col, uAccentColor, bandDetail * 0.18 * uProximity);

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
    uniforms: makeUniforms(opts.base, opts.accent, opts.atmo, opts.seed, 1.6, 0),
    vertexShader: VERT,
    fragmentShader: FRAG_HEADER + /* glsl */ `
      void main() {
        vec3 n = normalize(vPosW);
        vec3 p = n * 3.0 + vec3(uSeed);
        // Subtle banded structure for ice giants — softer than gas giants
        float lat = n.y;
        float bands = sin(lat * 4.0 + warpedFbm(p * 1.2) * 0.6) * 0.5 + 0.5;
        float h = fbm6(p * 2.5);
        vec3 col = mix(uBaseColor, uAccentColor, bands * 0.35 + h * 0.3);

        // Crack/fracture network (Europa-style) — shows on ~half the worlds
        float crackField = abs(fbm6(p * 12.0));
        float cracks = 1.0 - smoothstep(0.02, 0.08, crackField);
        col = mix(col, vec3(0.08, 0.18, 0.32), cracks * 0.35 * step(0.5, fract(uSeed * 7.3)));

        // Frosty highlights on the lit side — anisotropic-ish
        float frost = pow(max(dot(vNormalW, normalize(uSunDir)), 0.0), 2.5);
        col += vec3(0.18, 0.22, 0.28) * frost * 0.25;

        // Specular sheen on smooth ice
        float sheen = specGlint(vNormalW, 30.0, 0.4);
        col += vec3(0.7, 0.85, 1.0) * sheen;

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
    uniforms: makeUniforms(opts.base, opts.accent, opts.atmo, opts.seed, 1.2, 0),
    vertexShader: VERT,
    fragmentShader: FRAG_HEADER + /* glsl */ `
      void main() {
        vec3 n = normalize(vPosW);
        vec3 p = n * 5.0 + vec3(uSeed);
        // Cracked crust via warped fbm
        float h = warpedFbm(p * 1.2);
        float cracks = smoothstep(0.40, 0.50, fbm6(p * 6.0 + uTime * 0.05));
        // Crust gets darker where it's "cooler" (high h), brighter in cracks
        vec3 crust = mix(uBaseColor * 0.6, uBaseColor, smoothstep(-0.1, 0.4, h));
        vec3 col = mix(crust, uAccentColor, cracks);

        // Pulsing lava glow in low spots — HDR for bloom pickup
        float pulse = 0.7 + 0.3 * sin(uTime * 1.5 + uSeed);
        float glowMask = smoothstep(0.50, 0.72, fbm6(p * 4.0 - uTime * 0.03));
        glowMask *= 1.0 - smoothstep(-0.2, 0.3, h); // glow concentrates in valleys
        vec3 emissive = vec3(2.5, 1.1, 0.25) * glowMask * pulse;

        // Heat shimmer on fresh cracks
        emissive += vec3(3.0, 0.6, 0.15) * cracks * (0.4 + 0.3 * pulse);

        vec3 lit = applyLighting(col, vNormalW);
        // Add emissive on top (unaffected by sun)
        lit += emissive;
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
        vec3 n = normalize(vPosW);
        vec3 p = n * 6.0 + vec3(uSeed);
        float regolith = fbm6(p * 2.0);

        // Multi-scale crater rings
        float c1 = smoothstep(0.55, 0.6, fbm(p * 5.0));
        float c2 = smoothstep(0.5, 0.55, fbm(p * 12.0 + 19.0));
        float c3 = smoothstep(0.52, 0.57, fbm(p * 24.0 + 41.0));
        float craters = max(max(c1, c2 * 0.7), c3 * 0.45);

        // Sun-aware crater rim — bright lit edge, dark shadow edge
        // Approximate crater normal by gradient of crater field
        float eps = 0.02;
        vec3 px = p + vec3(eps, 0.0, 0.0);
        vec3 py = p + vec3(0.0, eps, 0.0);
        float cx = max(smoothstep(0.55, 0.6, fbm(px * 5.0)), smoothstep(0.5, 0.55, fbm(px * 12.0 + 19.0)) * 0.7);
        float cy = max(smoothstep(0.55, 0.6, fbm(py * 5.0)), smoothstep(0.5, 0.55, fbm(py * 12.0 + 19.0)) * 0.7);
        vec2 craterGrad = vec2(cx - craters, cy - craters) / eps;
        vec3 sunProj = normalize(uSunDir - n * dot(uSunDir, n)); // sun in tangent plane
        float rimLight = clamp(dot(normalize(vec3(craterGrad.x, 0.0, craterGrad.y)), sunProj), -1.0, 1.0);

        vec3 col = mix(uBaseColor, uAccentColor, regolith * 0.5 + craters * 0.3);
        col *= 1.0 + rimLight * 0.35;        // rim brighten/darken
        col *= 0.85 + 0.15 * regolith;       // micro-detail

        gl_FragColor = vec4(applyLighting(col, vNormalW), 1.0);
      }
    `,
  });
}

/**
 * Update time + sun direction + proximity on a planet ShaderMaterial.
 * `proximity` is 0 (far) to 1 (right at the surface) and drives cinematic
 * close-up detail (rim brightness, cloud contrast) inside the shader.
 */
export function tickPlanetUniforms(
  mat: THREE.ShaderMaterial,
  time: number,
  sunDir: THREE.Vector3,
  proximity = 0,
) {
  const u = mat.uniforms as PlanetUniforms;
  u.uTime.value = time;
  u.uSunDir.value.copy(sunDir);
  if (u.uProximity) u.uProximity.value = proximity;
}

// ─── Sun (active star surface — granulation, limb darkening, chromosphere) ───
// Self-illuminated; ignores `uSunDir`. HDR-bright so bloom blows it out into a
// proper corona without needing extra sprite tricks.
export function makeSunMaterial(opts: {
  /** Core surface color, e.g. "#ffd070" for G-type, "#bce0ff" for blue-giant. */
  color: string;
  /** Hot spot / chromosphere accent, brighter than `color`. */
  accent?: string;
  seed?: number;
}): THREE.ShaderMaterial {
  const accent = opts.accent ?? "#fff2c0";
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSunDir: { value: new THREE.Vector3(1, 0, 0) }, // unused but keeps tick API happy
      uBaseColor: { value: new THREE.Color(opts.color) },
      uAccentColor: { value: new THREE.Color(accent) },
      uAtmoColor: { value: new THREE.Color(opts.color) },
      uSeed: { value: opts.seed ?? Math.random() * 100 },
      uAtmoStrength: { value: 0 },
      uCloudiness: { value: 0 },
    },
    vertexShader: VERT,
    fragmentShader: /* glsl */ `
      varying vec3 vNormalW;
      varying vec3 vPosW;
      varying vec3 vViewDir;
      uniform float uTime;
      uniform vec3  uBaseColor;
      uniform vec3  uAccentColor;
      uniform float uSeed;
      ${COMMON_NOISE_GLSL}
      void main() {
        vec3 n = normalize(vPosW);
        vec3 p = n * 4.0 + vec3(uSeed);

        // Granulation cells — convective surface texture, slowly drifting
        vec3 gp = p + vec3(uTime * 0.05, uTime * 0.03, -uTime * 0.04);
        float granules = warpedFbm(gp * 1.4);
        float fineGran = fbm6(gp * 6.0) * 0.4;
        float surface = granules + fineGran;

        // Hot spots / faculae — bright patches that pulse
        float hot = smoothstep(0.45, 0.7, fbm6(p * 3.0 + uTime * 0.02));
        float pulse = 0.85 + 0.15 * sin(uTime * 0.8 + uSeed);

        // Color: base + bright accent in hot regions
        vec3 col = mix(uBaseColor, uAccentColor, hot * 0.85);
        col *= 0.85 + 0.4 * surface;
        // HDR boost so bloom catches it dramatically
        col *= 2.2 * pulse;

        // Limb darkening — physically real edge falloff
        float mu = max(dot(vNormalW, normalize(vViewDir)), 0.0);
        float limb = 0.45 + 0.55 * pow(mu, 0.6);
        col *= limb;

        // Chromospheric edge glow — thin red rim at the limb
        float rim = pow(1.0 - mu, 2.5);
        col += vec3(2.5, 0.8, 0.3) * rim * 0.6;

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}
