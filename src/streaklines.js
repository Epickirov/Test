/**
 * Wind-tunnel "smoke rake" streaklines — an independent overlay that traces the
 * flow path, complementary to the particle / volumetric-smoke layers.
 *
 * A rake of fixed seed points across the cooling-pad face each continuously
 * "emits dye": every frame all points of a filament advect along the flow field
 * and a fresh point is injected at the seed, so the connected polyline is a true
 * streakline (in steady flow, a streamline). Rendered as thin pale lines that
 * fade downstream — the classic aerodynamic-test look.
 */
import * as THREE from 'three';
import { config } from './config.js';

const FILAMENT_POINTS = 56;   // points per streakline
const RAKE_COLS = 3;          // seed columns across the width
const RAKE_ROWS = 5;          // seed rows up the pad

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

        const maxVerts = RAKE_COLS * RAKE_ROWS * (FILAMENT_POINTS - 1) * 2;
        this.positions = new Float32Array(maxVerts * 3);
        this.colors = new Float32Array(maxVerts * 3);

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
        geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage));
        this.mesh = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
            vertexColors: true,
            transparent: true,
            opacity: 0.9,
            depthWrite: false,
            depthTest: false, // overlay on top of particles/smoke (glass shell writes depth)
        }));
        this.mesh.renderOrder = 1002;
        this.mesh.frustumCulled = false;
        this.mesh.visible = false;
        this.scene.add(this.mesh);

        this.init();
    }

    /** (Re)build the rake of seeds and seed each filament as a streamline. */
    init() {
        const hl = config.greenhouseLength / 2;
        const padBottom = config.coolingPadElevation;
        const padTop = padBottom + config.coolingPadHeight;

        this.seeds = [];
        for (let c = 0; c < RAKE_COLS; c++) {
            const fx = RAKE_COLS === 1 ? 0 : (c / (RAKE_COLS - 1) - 0.5);
            const x = fx * config.greenhouseWidth * 0.7;
            for (let r = 0; r < RAKE_ROWS; r++) {
                const y = padBottom + ((r + 0.5) / RAKE_ROWS) * (padTop - padBottom);
                this.seeds.push(new THREE.Vector3(x, y, -hl + 0.15));
            }
        }

        this.filaments = this.seeds.map((seed) => {
            const arr = new Float32Array(FILAMENT_POINTS * 3);
            const p = seed.clone();
            for (let k = 0; k < FILAMENT_POINTS; k++) {
                arr[k * 3] = p.x; arr[k * 3 + 1] = p.y; arr[k * 3 + 2] = p.z;
                const v = this.thermal.velocityAt(p.x, p.y, p.z);
                p.set(p.x + v[0] * 0.5, p.y + v[1] * 0.5, p.z + v[2] * 0.5);
                this._clamp(p);
            }
            return arr;
        });
    }

    reset() { this.init(); }

    setVisible(visible) { this.mesh.visible = visible; }

    get visible() { return this.mesh.visible; }

    _clamp(p) {
        const hw = config.greenhouseWidth / 2;
        const hl = config.greenhouseLength / 2;
        const H = config.greenhouseHeight;
        p.x = p.x < -hw ? -hw : (p.x > hw ? hw : p.x);
        p.y = p.y < 0.02 ? 0.02 : (p.y > H ? H : p.y);
        p.z = p.z < -hl ? -hl : (p.z > hl + 1.0 ? hl + 1.0 : p.z);
    }

    /**
     * Advect every filament one step, inject a fresh head at each seed, and
     * rebuild the line geometry (with a head→tail brightness fade).
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

            // 1. Advect every point along the flow.
            for (let k = 0; k < FILAMENT_POINTS; k++) {
                const x = arr[k * 3], y = arr[k * 3 + 1], z = arr[k * 3 + 2];
                const v = this.thermal.velocityAt(x, y, z);
                let nx = x + v[0] * stepDt, ny = y + v[1] * stepDt, nz = z + v[2] * stepDt;
                nx = nx < -hw ? -hw : (nx > hw ? hw : nx);
                ny = ny < 0.02 ? 0.02 : (ny > H ? H : ny);
                nz = nz < -hl ? -hl : (nz > hl + 1.0 ? hl + 1.0 : nz);
                arr[k * 3] = nx; arr[k * 3 + 1] = ny; arr[k * 3 + 2] = nz;
            }

            // 2. Shift downstream and inject a fresh head at the seed.
            for (let k = FILAMENT_POINTS - 1; k >= 1; k--) {
                arr[k * 3] = arr[(k - 1) * 3];
                arr[k * 3 + 1] = arr[(k - 1) * 3 + 1];
                arr[k * 3 + 2] = arr[(k - 1) * 3 + 2];
            }
            const seed = this.seeds[s];
            arr[0] = seed.x; arr[1] = seed.y; arr[2] = seed.z;

            // 3. Emit line segments, fading from the head (bright) to the tail (dim).
            for (let k = 0; k < FILAMENT_POINTS - 1; k++) {
                const a = k * 3, b = (k + 1) * 3;
                const bA = 0.2 + 0.8 * (1 - k / (FILAMENT_POINTS - 1));
                const bB = 0.2 + 0.8 * (1 - (k + 1) / (FILAMENT_POINTS - 1));
                pos[vi * 3] = arr[a]; pos[vi * 3 + 1] = arr[a + 1]; pos[vi * 3 + 2] = arr[a + 2];
                col[vi * 3] = 0.80 * bA; col[vi * 3 + 1] = 0.92 * bA; col[vi * 3 + 2] = 1.0 * bA;
                vi++;
                pos[vi * 3] = arr[b]; pos[vi * 3 + 1] = arr[b + 1]; pos[vi * 3 + 2] = arr[b + 2];
                col[vi * 3] = 0.80 * bB; col[vi * 3 + 1] = 0.92 * bB; col[vi * 3 + 2] = 1.0 * bB;
                vi++;
            }
        }

        this.mesh.geometry.setDrawRange(0, vi);
        this.mesh.geometry.attributes.position.needsUpdate = true;
        this.mesh.geometry.attributes.color.needsUpdate = true;
    }
}
