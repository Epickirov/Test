/**
 * Flow streamlines — an independent overlay that shows the airflow, complementary
 * to the particle / smoke layers (the classic CFD / ANSYS-style view).
 *
 * Each frame, a grid of seed points is integrated *forward through the live CFD
 * velocity field* (RK2) into long, continuous lines tangent to the flow, coloured
 * by velocity magnitude (blue = slow … red = fast). Because they are re-traced
 * every frame they always reflect the current flow — revealing the pad→fan jet,
 * recirculation and buoyant plumes as smooth continuous curves (not short
 * disconnected ribbons). Density is adjustable.
 */
import * as THREE from 'three';
import { config } from './config.js';

const MAX_STEPS = 110;        // integration steps per streamline
const MAX_SEEDS = 300;        // seed-grid cap (buffers sized for this)
const SPEED_MAX = 3.0;        // m/s mapped to the top of the colour ramp

export class Streaklines {
    /**
     * @param {THREE.Scene} scene
     * @param {import('./thermalField.js').ThermalField} thermalField - exposes velocityAt()
     */
    constructor(scene, thermalField) {
        this.scene = scene;
        this.thermal = thermalField;
        this.seeds = [];

        const maxVerts = MAX_SEEDS * MAX_STEPS * 2;
        this.positions = new Float32Array(maxVerts * 3);
        this.colors = new Float32Array(maxVerts * 3);

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
        geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage));
        this.mesh = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
            vertexColors: true,
            transparent: true,
            opacity: 0.85,
            depthWrite: false,
            depthTest: false, // overlay on top of particles/smoke (glass shell writes depth)
        }));
        this.mesh.renderOrder = 1002;
        this.mesh.frustumCulled = false;
        this.mesh.visible = false;
        this.scene.add(this.mesh);

        this.init();
    }

    /** Build the seed grid (sized by streaklineDensity). */
    init() {
        const W = config.greenhouseWidth, L = config.greenhouseLength, H = config.greenhouseHeight;
        const spacing = 1.8 / Math.max(0.3, config.streaklineDensity);
        let nx = THREE.MathUtils.clamp(Math.round(W / spacing), 2, 10);
        let ny = THREE.MathUtils.clamp(Math.round(H / spacing), 2, 6);
        let nz = THREE.MathUtils.clamp(Math.round(L / spacing), 2, 14);
        while (nx * ny * nz > MAX_SEEDS) { if (nz > 2) nz--; else if (nx > 2) nx--; else ny--; }

        this.seeds = [];
        for (let i = 0; i < nx; i++) {
            const x = ((i + 0.5) / nx - 0.5) * W * 0.9;
            for (let j = 0; j < ny; j++) {
                const y = 0.08 * H + ((j + 0.5) / ny) * 0.84 * H;
                for (let k = 0; k < nz; k++) {
                    const z = ((k + 0.5) / nz - 0.5) * L * 0.92;
                    this.seeds.push(new THREE.Vector3(x, y, z));
                }
            }
        }
    }

    reset() { /* streamlines are stateless (re-traced each frame) */ }

    setVisible(visible) { this.mesh.visible = visible; }

    get visible() { return this.mesh.visible; }

    /** Map speed (m/s) to a blue→red ramp (full saturation). */
    _speedColor(speed, out) {
        const h = (1 - THREE.MathUtils.clamp(speed / SPEED_MAX, 0, 1)) * 0.66;
        const r = Math.abs(h * 6 - 3) - 1;
        const g = 2 - Math.abs(h * 6 - 2);
        const b = 2 - Math.abs(h * 6 - 4);
        out[0] = THREE.MathUtils.clamp(r, 0, 1);
        out[1] = THREE.MathUtils.clamp(g, 0, 1);
        out[2] = THREE.MathUtils.clamp(b, 0, 1);
    }

    /** Re-trace all streamlines through the current velocity field. */
    update() {
        if (!this.mesh.visible) return;
        const W = config.greenhouseWidth, L = config.greenhouseLength, H = config.greenhouseHeight;
        const hw = W / 2, hl = L / 2;
        const stepLen = 0.5 * Math.min(W, H, L) / 24; // ~half a cell in world units
        const pos = this.positions, col = this.colors;
        const c0 = [0, 0, 0], c1 = [0, 0, 0];
        let vi = 0;
        const maxVerts = MAX_SEEDS * MAX_STEPS * 2;

        for (const seed of this.seeds) {
            let px = seed.x, py = seed.y, pz = seed.z;
            for (let s = 0; s < MAX_STEPS; s++) {
                if (vi + 2 > maxVerts) break;
                const v = this.thermal.velocityAt(px, py, pz);
                const speed = Math.hypot(v[0], v[1], v[2]);
                if (speed < 1e-3) break;
                // RK2 (midpoint) integration along the normalized flow direction.
                const inv = stepLen / speed;
                const mx = px + v[0] * inv * 0.5, my = py + v[1] * inv * 0.5, mz = pz + v[2] * inv * 0.5;
                const vm = this.thermal.velocityAt(mx, my, mz);
                const sm = Math.hypot(vm[0], vm[1], vm[2]) || 1;
                const nx = px + vm[0] / sm * stepLen, ny = py + vm[1] / sm * stepLen, nz = pz + vm[2] / sm * stepLen;
                if (nx < -hw || nx > hw || ny < 0 || ny > H || nz < -hl || nz > hl + 1) break;

                this._speedColor(speed, c0);
                this._speedColor(sm, c1);
                let o = vi * 3;
                pos[o] = px; pos[o + 1] = py; pos[o + 2] = pz; col[o] = c0[0]; col[o + 1] = c0[1]; col[o + 2] = c0[2];
                o += 3;
                pos[o] = nx; pos[o + 1] = ny; pos[o + 2] = nz; col[o] = c1[0]; col[o + 1] = c1[1]; col[o + 2] = c1[2];
                vi += 2;

                px = nx; py = ny; pz = nz;
            }
        }

        this.mesh.geometry.setDrawRange(0, vi);
        this.mesh.geometry.attributes.position.needsUpdate = true;
        this.mesh.geometry.attributes.color.needsUpdate = true;
    }
}
