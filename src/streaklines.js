/**
 * Flow streaklines — an independent overlay that shows airflow direction
 * throughout the greenhouse, complementary to the particle / smoke layers.
 *
 * A 3-D grid of seed points fills the interior; each seed continuously "emits
 * dye" — every frame all points of its filament advect along the flow field
 * (thermalField.velocityAt) and a fresh point is injected at the seed, so each
 * connected polyline is a streakline. Rendered as thin pale lines that fade
 * downstream — the classic wind-tunnel / aerodynamic-test look, but seeded
 * everywhere so the whole flow field is legible. Density is adjustable.
 */
import * as THREE from 'three';
import { config } from './config.js';

const FILAMENT_POINTS = 18;   // points per streakline
const MAX_SEEDS = 600;        // pool cap (buffers are sized for this)

export class Streaklines {
    /**
     * @param {THREE.Scene} scene
     * @param {import('./thermalField.js').ThermalField} thermalField
     */
    constructor(scene, thermalField) {
        this.scene = scene;
        this.thermal = thermalField;
        this.seeds = [];
        this.filaments = [];

        const maxVerts = MAX_SEEDS * (FILAMENT_POINTS - 1) * 2;
        this.positions = new Float32Array(maxVerts * 3);
        this.colors = new Float32Array(maxVerts * 3);

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
        geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage));
        this.mesh = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
            vertexColors: true,
            transparent: true,
            opacity: 0.6,
            depthWrite: false,
            depthTest: false, // overlay on top of particles/smoke (glass shell writes depth)
        }));
        this.mesh.renderOrder = 1002;
        this.mesh.frustumCulled = false;
        this.mesh.visible = false;
        this.scene.add(this.mesh);

        this.init();
    }

    /** Build the seed grid (sized by streaklineDensity) and seed each filament. */
    init() {
        const W = config.greenhouseWidth, L = config.greenhouseLength, H = config.greenhouseHeight;
        const hw = W / 2, hl = L / 2;

        // Grid resolution from a target spacing, scaled by the density control, capped.
        const spacing = 1.3 / Math.max(0.3, config.streaklineDensity);
        let nx = THREE.MathUtils.clamp(Math.round(W / spacing), 2, 12);
        let ny = THREE.MathUtils.clamp(Math.round(H / spacing), 2, 7);
        let nz = THREE.MathUtils.clamp(Math.round(L / spacing), 2, 20);
        while (nx * ny * nz > MAX_SEEDS) { if (nz > 2) nz--; else if (nx > 2) nx--; else ny--; }

        this.seeds = [];
        for (let i = 0; i < nx; i++) {
            const x = ((i + 0.5) / nx - 0.5) * W * 0.9;
            for (let j = 0; j < ny; j++) {
                const y = 0.1 * H + ((j + 0.5) / ny) * 0.8 * H;
                for (let k = 0; k < nz; k++) {
                    const z = ((k + 0.5) / nz - 0.5) * L * 0.9;
                    this.seeds.push(new THREE.Vector3(x, y, z));
                }
            }
        }

        this.filaments = this.seeds.map((seed) => {
            const arr = new Float32Array(FILAMENT_POINTS * 3);
            const p = seed.clone();
            for (let n = 0; n < FILAMENT_POINTS; n++) {
                arr[n * 3] = p.x; arr[n * 3 + 1] = p.y; arr[n * 3 + 2] = p.z;
                const v = this.thermal.velocityAt(p.x, p.y, p.z);
                p.set(p.x + v[0] * 0.5, p.y + v[1] * 0.5, p.z + v[2] * 0.5);
                this._clamp(p, hw, hl, H);
            }
            return arr;
        });
    }

    reset() { this.init(); }

    setVisible(visible) { this.mesh.visible = visible; }

    get visible() { return this.mesh.visible; }

    _clamp(p, hw, hl, H) {
        p.x = p.x < -hw ? -hw : (p.x > hw ? hw : p.x);
        p.y = p.y < 0.02 ? 0.02 : (p.y > H ? H : p.y);
        p.z = p.z < -hl ? -hl : (p.z > hl + 1.0 ? hl + 1.0 : p.z);
    }

    /**
     * Advect every filament one step, inject a fresh head at each seed, and
     * rebuild the line geometry (head→tail brightness fade).
     * @param {number} dt - seconds (pre-scaled)
     */
    update(dt) {
        if (!this.mesh.visible) return;
        const stepDt = Math.min(dt, 0.5);
        const hw = config.greenhouseWidth / 2;
        const hl = config.greenhouseLength / 2;
        const H = config.greenhouseHeight;
        const pos = this.positions;
        const col = this.colors;
        let vi = 0;

        for (let s = 0; s < this.filaments.length; s++) {
            const arr = this.filaments[s];

            for (let k = 0; k < FILAMENT_POINTS; k++) {
                const x = arr[k * 3], y = arr[k * 3 + 1], z = arr[k * 3 + 2];
                const v = this.thermal.velocityAt(x, y, z);
                let nx = x + v[0] * stepDt, ny = y + v[1] * stepDt, nz = z + v[2] * stepDt;
                nx = nx < -hw ? -hw : (nx > hw ? hw : nx);
                ny = ny < 0.02 ? 0.02 : (ny > H ? H : ny);
                nz = nz < -hl ? -hl : (nz > hl + 1.0 ? hl + 1.0 : nz);
                arr[k * 3] = nx; arr[k * 3 + 1] = ny; arr[k * 3 + 2] = nz;
            }

            for (let k = FILAMENT_POINTS - 1; k >= 1; k--) {
                arr[k * 3] = arr[(k - 1) * 3];
                arr[k * 3 + 1] = arr[(k - 1) * 3 + 1];
                arr[k * 3 + 2] = arr[(k - 1) * 3 + 2];
            }
            const seed = this.seeds[s];
            arr[0] = seed.x; arr[1] = seed.y; arr[2] = seed.z;

            for (let k = 0; k < FILAMENT_POINTS - 1; k++) {
                const a = k * 3, b = (k + 1) * 3;
                const bA = 0.2 + 0.8 * (1 - k / (FILAMENT_POINTS - 1));
                const bB = 0.2 + 0.8 * (1 - (k + 1) / (FILAMENT_POINTS - 1));
                pos[vi * 3] = arr[a]; pos[vi * 3 + 1] = arr[a + 1]; pos[vi * 3 + 2] = arr[a + 2];
                col[vi * 3] = 0.72 * bA; col[vi * 3 + 1] = 0.85 * bA; col[vi * 3 + 2] = 1.0 * bA;
                vi++;
                pos[vi * 3] = arr[b]; pos[vi * 3 + 1] = arr[b + 1]; pos[vi * 3 + 2] = arr[b + 2];
                col[vi * 3] = 0.72 * bB; col[vi * 3 + 1] = 0.85 * bB; col[vi * 3 + 2] = 1.0 * bB;
                vi++;
            }
        }

        this.mesh.geometry.setDrawRange(0, vi);
        this.mesh.geometry.attributes.position.needsUpdate = true;
        this.mesh.geometry.attributes.color.needsUpdate = true;
    }
}
