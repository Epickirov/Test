/**
 * Volumetric smoke — a raymarched 3-D volume, the technique used by Houdini /
 * Unreal (adapted to real-time WebGL2).
 *
 * A smoke-density scalar field is advected by the physical flow (injected as
 * mist at the evaporative pad, dissipating downstream), uploaded each frame to
 * a 3-D texture (R = density, G = normalized temperature), and rendered by
 * marching a ray through the greenhouse-shaped box per pixel:
 *   - Beer–Lambert absorption builds opacity,
 *   - a short secondary march toward the sun gives volumetric self-shadowing,
 *   - temperature drives a heat-ramp tint and a hot-region emissive glow,
 *   - animated fbm noise adds sub-grid wispy detail.
 *
 * Density advection shares the thermal grid (same resolution / indexing).
 */
import * as THREE from 'three';
import { config } from './config.js';

const VERTEX_SHADER = /* glsl */`
in vec3 position;
uniform mat4 modelMatrix;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform vec3 uCameraPos;
out vec3 vOrigin;
out vec3 vDirection;
void main() {
    vOrigin = (inverse(modelMatrix) * vec4(uCameraPos, 1.0)).xyz; // camera in object (unit-box) space
    vDirection = position - vOrigin;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAGMENT_SHADER = /* glsl */`
precision highp float;
precision highp sampler3D;

in vec3 vOrigin;
in vec3 vDirection;
out vec4 color;

uniform sampler3D uVolume;
uniform vec3 uSunDir;       // object-space direction toward the sun
uniform float uTime;
uniform float uDensity;     // density multiplier
uniform float uAbsorption;  // extinction per unit density·distance
uniform float uEmission;    // hot-region glow strength
uniform float uOpacity;
uniform float uNoiseScale;
uniform int uSteps;

vec2 hitBox(vec3 orig, vec3 dir) {
    vec3 box = vec3(0.5);
    vec3 inv = 1.0 / dir;
    vec3 t0 = (-box - orig) * inv;
    vec3 t1 = (box - orig) * inv;
    vec3 tmin = min(t0, t1);
    vec3 tmax = max(t0, t1);
    return vec2(max(max(tmin.x, tmin.y), tmin.z), min(min(tmax.x, tmax.y), tmax.z));
}

float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float vnoise(vec3 x) {
    vec3 i = floor(x), f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
                   mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                   mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p) {
    float s = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) { s += a * vnoise(p); p *= 2.02; a *= 0.5; }
    return s;
}
vec3 hue2rgb(float h) {          // h in [0,1], full saturation
    float r = abs(h * 6.0 - 3.0) - 1.0;
    float g = 2.0 - abs(h * 6.0 - 2.0);
    float b = 2.0 - abs(h * 6.0 - 4.0);
    return clamp(vec3(r, g, b), 0.0, 1.0);
}
vec3 tempColor(float t) { return hue2rgb((1.0 - clamp(t, 0.0, 1.0)) * 0.66); } // cold blue → hot red

float densityAt(vec3 uv) {
    float d = texture(uVolume, uv).r * uDensity;
    float n = fbm(uv * uNoiseScale + vec3(0.0, -uTime * 0.6, uTime * 0.2));
    return d * clamp(n * 0.6 + 0.65, 0.0, 1.4); // wispy detail, but keep a solid floor
}

void main() {
    vec3 rayDir = normalize(vDirection);
    vec2 b = hitBox(vOrigin, rayDir);
    if (b.x > b.y) discard;
    b.x = max(b.x, 0.0);

    float dt = (b.y - b.x) / float(uSteps);
    vec3 p = vOrigin + rayDir * b.x;
    vec3 stepv = rayDir * dt;

    vec4 acc = vec4(0.0);
    for (int i = 0; i < 256; i++) {
        if (i >= uSteps || acc.a > 0.99) break;
        vec3 uv = p + 0.5;
        if (all(greaterThanEqual(uv, vec3(0.0))) && all(lessThanEqual(uv, vec3(1.0)))) {
            float dens = densityAt(uv);
            if (dens > 0.002) {
                float tNorm = texture(uVolume, uv).g;
                // Soft self-shadowing: optical depth of density toward the sun.
                float shadow = 0.0;
                vec3 lp = uv;
                for (int j = 0; j < 5; j++) { lp += uSunDir * 0.09; shadow += densityAt(clamp(lp, 0.0, 1.0)) * 0.09; }
                float light = exp(-shadow * 6.0);

                vec3 tint = mix(vec3(0.90, 0.93, 1.0), tempColor(tNorm), 0.5); // light smoke, tinted by temperature
                vec3 glow = tempColor(tNorm) * uEmission * smoothstep(0.5, 1.0, tNorm);
                vec3 col = tint * (0.5 + 0.6 * light) + glow;

                float a = clamp(dens * uAbsorption * dt, 0.0, 1.0);
                acc.rgb += (1.0 - acc.a) * col * a;
                acc.a += (1.0 - acc.a) * a;
            }
        }
        p += stepv;
    }

    acc.a *= uOpacity;
    if (acc.a <= 0.002) discard;
    color = acc;
}`;

export class SmokeVolume {
    /**
     * @param {THREE.Scene} scene
     * @param {import('./thermalField.js').ThermalField} thermalField
     */
    constructor(scene, thermalField) {
        this.scene = scene;
        this.thermal = thermalField;

        this.ok = false;
        this.mesh = null;
        this.material = null;
        this.texture = null;
        this.density = null;
        this.densityNext = null;
        this.texData = null;
        this.res = { x: 0, y: 0, z: 0 };

        try {
            this._build();
            this.ok = true;
        } catch (e) {
            console.warn('[smokeVolume] volumetric smoke unavailable, will fall back:', e);
            this.ok = false;
        }
    }

    _build() {
        this.material = new THREE.RawShaderMaterial({
            glslVersion: THREE.GLSL3,
            uniforms: {
                uVolume: { value: null },
                uCameraPos: { value: new THREE.Vector3() },
                uSunDir: { value: new THREE.Vector3(0, 1, 0) },
                uTime: { value: 0 },
                uDensity: { value: 1.5 },
                uAbsorption: { value: 7.0 },
                uEmission: { value: 0.9 },
                uOpacity: { value: config.smokeOpacity },
                uNoiseScale: { value: 6.0 },
                uSteps: { value: 72 },
            },
            vertexShader: VERTEX_SHADER,
            fragmentShader: FRAGMENT_SHADER,
            transparent: true,
            depthWrite: false,
            side: THREE.BackSide,
        });

        this.mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.material);
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = 998; // after opaque + glass, before the slice plane (999)
        this.mesh.visible = false;
        this.scene.add(this.mesh);

        this.init();
    }

    /** (Re)allocate the density field + 3-D texture to the thermal grid, and fit the box. */
    init() {
        if (!this.material) return;
        this.res = { ...this.thermal.res };
        const n = this.res.x * this.res.y * this.res.z;
        this.density = new Float32Array(n);
        this.densityNext = new Float32Array(n);
        this.texData = new Uint8Array(n * 4);

        if (this.texture) this.texture.dispose();
        this.texture = new THREE.Data3DTexture(this.texData, this.res.x, this.res.y, this.res.z);
        this.texture.format = THREE.RGBAFormat;
        this.texture.type = THREE.UnsignedByteType;
        this.texture.minFilter = THREE.LinearFilter;
        this.texture.magFilter = THREE.LinearFilter;
        this.texture.wrapS = this.texture.wrapT = this.texture.wrapR = THREE.ClampToEdgeWrapping;
        this.texture.unpackAlignment = 1;
        this.texture.needsUpdate = true;
        this.material.uniforms.uVolume.value = this.texture;

        const W = config.greenhouseWidth, H = config.greenhouseHeight, L = config.greenhouseLength;
        this.mesh.scale.set(W, H, L);
        this.mesh.position.set(0, H / 2, 0);
    }

    setVisible(visible) {
        if (this.mesh) this.mesh.visible = visible && this.ok;
    }

    get visible() {
        return this.mesh ? this.mesh.visible : false;
    }

    _idx(x, y, z) {
        return x + y * this.res.x + z * this.res.x * this.res.y;
    }

    /** Trilinear density sample at a world position (0 outside the grid). */
    _sampleDensity(wx, wy, wz) {
        const { x: rx, y: ry, z: rz } = this.res;
        const hw = config.greenhouseWidth / 2;
        const hl = config.greenhouseLength / 2;
        const fx = ((wx + hw) / config.greenhouseWidth) * (rx - 1);
        const fy = (wy / config.greenhouseHeight) * (ry - 1);
        const fz = ((wz + hl) / config.greenhouseLength) * (rz - 1);
        if (fx < 0 || fx >= rx - 1 || fy < 0 || fy >= ry - 1 || fz < 0 || fz >= rz - 1) return 0;
        const x0 = Math.floor(fx), y0 = Math.floor(fy), z0 = Math.floor(fz);
        const dx = fx - x0, dy = fy - y0, dz = fz - z0;
        const d = this.density;
        const c00 = d[this._idx(x0, y0, z0)] * (1 - dx) + d[this._idx(x0 + 1, y0, z0)] * dx;
        const c10 = d[this._idx(x0, y0 + 1, z0)] * (1 - dx) + d[this._idx(x0 + 1, y0 + 1, z0)] * dx;
        const c01 = d[this._idx(x0, y0, z0 + 1)] * (1 - dx) + d[this._idx(x0 + 1, y0, z0 + 1)] * dx;
        const c11 = d[this._idx(x0, y0 + 1, z0 + 1)] * (1 - dx) + d[this._idx(x0 + 1, y0 + 1, z0 + 1)] * dx;
        return (c00 * (1 - dy) + c10 * dy) * (1 - dz) + (c01 * (1 - dy) + c11 * dy) * dz;
    }

    /**
     * Step the volume: advect + inject + dissipate density, repack the texture,
     * and refresh the camera/sun/scale uniforms.
     * @param {number} dt - seconds (pre-scaled)
     * @param {THREE.Camera} camera
     * @param {THREE.Vector3} sunDir - world-space direction toward the sun
     */
    update(dt, camera, sunDir) {
        if (!this.ok || !this.mesh.visible) return;
        this._advect(dt);
        this._repackTexture();

        const u = this.material.uniforms;
        u.uCameraPos.value.copy(camera.position);
        u.uSunDir.value.copy(sunDir).normalize();
        u.uTime.value += dt;
        u.uOpacity.value = config.smokeOpacity;
        u.uDensity.value = THREE.MathUtils.clamp(config.smokeSize, 0.4, 3.0); // reuse size slider as density scale
    }

    _advect(dt) {
        const { x: rx, y: ry, z: rz } = this.res;
        const W = config.greenhouseWidth, H = config.greenhouseHeight, L = config.greenhouseLength;
        const hw = W / 2, hl = L / 2;
        const stepDt = Math.min(dt, 0.5);
        const padBottom = config.coolingPadElevation;
        const padTop = padBottom + config.coolingPadHeight;
        const src = this.density, dst = this.densityNext;

        for (let z = 0; z < rz; z++) {
            for (let y = 0; y < ry; y++) {
                for (let x = 0; x < rx; x++) {
                    const wx = (x + 0.5) / rx * W - hw;
                    const wy = (y + 0.5) / ry * H;
                    const wz = (z + 0.5) / rz * L - hl;

                    const v = this.thermal.velocityAt(wx, wy, wz);
                    let d = this._sampleDensity(wx - v[0] * stepDt, wy - v[1] * stepDt, wz - v[2] * stepDt);
                    d *= 0.997; // slow dissipation so the plume persists and builds up

                    // Inject mist where cooled, humid air enters at the pad.
                    if (z <= 1 && wy >= padBottom && wy <= padTop && Math.abs(wx) < hw * 0.9) {
                        d = Math.max(d, 1.0);
                    }
                    dst[this._idx(x, y, z)] = d > 1.5 ? 1.5 : d;
                }
            }
        }
        this.density = dst;
        this.densityNext = src;
    }

    _repackTexture() {
        const data = this.texData;
        const field = this.thermal.field;
        const sMin = config.scaleMin;
        const sMax = Math.max(config.scaleMax, config.scaleMin + 2);
        const inv = 255 / (sMax - sMin);
        const n = this.density.length;
        for (let i = 0; i < n; i++) {
            const d = this.density[i] * 230;
            data[i * 4] = d > 255 ? 255 : d;
            let t = (field[i] - sMin) * inv;
            t = t < 0 ? 0 : (t > 255 ? 255 : t);
            data[i * 4 + 1] = t;
        }
        this.texture.needsUpdate = true;
    }
}
