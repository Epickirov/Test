/**
 * Real-time incompressible-flow solver (Jos Stam, "Stable Fluids", extended to
 * 3-D) — the airflow "physics engine".
 *
 * Each step: apply buoyancy (Boussinesq, from the thermal field) + the pad
 * inflow / fan outflow boundary jets, self-advect the velocity field
 * (semi-Lagrangian), then make it divergence-free with a pressure projection
 * (Gauss–Seidel Poisson solve). The result is genuine recirculating, swirling
 * airflow — vortices, the pad→fan jet, buoyant plumes — which the streamlines,
 * smoke and particles then reveal.
 *
 * It is NOT a finite-volume CFD package (no turbulence model, coarse grid), but
 * it is a correct real-time approximation of the Navier–Stokes momentum + mass
 * equations. Velocities are stored in cells/step internally and returned in m/s.
 *
 * Pure JS (no three.js) so the solver can be unit-tested directly.
 */
import { config } from './config.js';
import { computeGridResolution } from './utils.js';

const PRESSURE_ITERS = 28;     // Gauss–Seidel iterations for the pressure solve
const BASE_INFLOW = 11;        // pad jet speed (cells/s) at fanSpeed = 1
const BUOYANCY = 0.9;          // Boussinesq coupling (cells/s² per K, amplified for visible convection)
const VORTICITY = 0.18;        // vorticity-confinement strength (keeps swirls lively)
const MAX_DT = 0.4;            // sub-step cap (CFL)

export class CFDSolver {
    constructor() {
        this.res = computeGridResolution();
        this._alloc();
        this._computeBoundaryCells();
    }

    init() {
        this.res = computeGridResolution();
        this._alloc();
        this._computeBoundaryCells();
    }

    _alloc() {
        const n = this.res.x * this.res.y * this.res.z;
        this.u = new Float32Array(n);
        this.v = new Float32Array(n);
        this.w = new Float32Array(n);
        this.u0 = new Float32Array(n);
        this.v0 = new Float32Array(n);
        this.w0 = new Float32Array(n);
        this.p = new Float32Array(n);
        this.div = new Float32Array(n);
        this.curl = new Float32Array(n);
    }

    reset() {
        this.u.fill(0); this.v.fill(0); this.w.fill(0); this.p.fill(0);
    }

    _ix(i, j, k) { return i + j * this.res.x + k * this.res.x * this.res.y; }

    /** Precompute which boundary cells are the pad inlet and which are fan outlets. */
    _computeBoundaryCells() {
        const { x: nx, y: ny, z: nz } = this.res;
        const W = config.greenhouseWidth, H = config.greenhouseHeight;
        const padB = config.coolingPadElevation, padT = padB + config.coolingPadHeight;
        const hw = W / 2;
        const fanSpacing = W / (config.fanCount + 1);

        this.inlet = [];
        for (let j = 0; j < ny; j++) {
            const wy = (j + 0.5) / ny * H;
            for (let i = 0; i < nx; i++) {
                const wx = (i + 0.5) / nx * W - hw;
                if (wy >= padB && wy <= padT && Math.abs(wx) < hw * 0.9) this.inlet.push(this._ix(i, j, 0));
            }
        }

        this.outlet = [];
        for (let j = 0; j < ny; j++) {
            const wy = (j + 0.5) / ny * H;
            for (let i = 0; i < nx; i++) {
                const wx = (i + 0.5) / nx * W - hw;
                for (let f = 1; f <= config.fanCount; f++) {
                    const fanX = -hw + f * fanSpacing;
                    if (Math.hypot(wx - fanX, wy - config.fanHeight) < 0.7) { this.outlet.push(this._ix(i, j, nz - 1)); break; }
                }
            }
        }
    }

    /** Stamp the pad inflow and fan outflow jets (mass-balanced). */
    _setSources() {
        const inflow = BASE_INFLOW * config.fanSpeed;
        const outflow = this.outlet.length > 0 ? inflow * this.inlet.length / this.outlet.length : 0;
        for (const idx of this.inlet) { this.u[idx] = 0; this.v[idx] = 0; this.w[idx] = inflow; }
        for (const idx of this.outlet) { this.w[idx] = outflow; }
    }

    /** Free-slip box walls (normal component negated, tangential copied). */
    _setBnd(b, x) {
        const { x: nx, y: ny, z: nz } = this.res;
        const ix = (i, j, k) => i + j * nx + k * nx * ny;
        for (let k = 0; k < nz; k++) {
            for (let j = 0; j < ny; j++) {
                x[ix(0, j, k)] = b === 1 ? -x[ix(1, j, k)] : x[ix(1, j, k)];
                x[ix(nx - 1, j, k)] = b === 1 ? -x[ix(nx - 2, j, k)] : x[ix(nx - 2, j, k)];
            }
        }
        for (let k = 0; k < nz; k++) {
            for (let i = 0; i < nx; i++) {
                x[ix(i, 0, k)] = b === 2 ? -x[ix(i, 1, k)] : x[ix(i, 1, k)];
                x[ix(i, ny - 1, k)] = b === 2 ? -x[ix(i, ny - 2, k)] : x[ix(i, ny - 2, k)];
            }
        }
        for (let j = 0; j < ny; j++) {
            for (let i = 0; i < nx; i++) {
                x[ix(i, j, 0)] = b === 3 ? -x[ix(i, j, 1)] : x[ix(i, j, 1)];
                x[ix(i, j, nz - 1)] = b === 3 ? -x[ix(i, j, nz - 2)] : x[ix(i, j, nz - 2)];
            }
        }
    }

    _advect(b, d, d0, dt) {
        const { x: nx, y: ny, z: nz } = this.res;
        const u0 = this.u0, v0 = this.v0, w0 = this.w0;
        for (let k = 1; k < nz - 1; k++) {
            for (let j = 1; j < ny - 1; j++) {
                for (let i = 1; i < nx - 1; i++) {
                    const idx = this._ix(i, j, k);
                    let x = i - dt * u0[idx];
                    let y = j - dt * v0[idx];
                    let z = k - dt * w0[idx];
                    if (x < 0.5) x = 0.5; else if (x > nx - 1.5) x = nx - 1.5;
                    if (y < 0.5) y = 0.5; else if (y > ny - 1.5) y = ny - 1.5;
                    if (z < 0.5) z = 0.5; else if (z > nz - 1.5) z = nz - 1.5;
                    const i0 = Math.floor(x), j0 = Math.floor(y), k0 = Math.floor(z);
                    const sx = x - i0, sy = y - j0, sz = z - k0;
                    d[idx] = this._trilinear(d0, i0, j0, k0, sx, sy, sz);
                }
            }
        }
        this._setBnd(b, d);
    }

    _trilinear(a, i, j, k, sx, sy, sz) {
        const ix = this._ix.bind(this);
        const c000 = a[ix(i, j, k)], c100 = a[ix(i + 1, j, k)];
        const c010 = a[ix(i, j + 1, k)], c110 = a[ix(i + 1, j + 1, k)];
        const c001 = a[ix(i, j, k + 1)], c101 = a[ix(i + 1, j, k + 1)];
        const c011 = a[ix(i, j + 1, k + 1)], c111 = a[ix(i + 1, j + 1, k + 1)];
        const c00 = c000 * (1 - sx) + c100 * sx, c10 = c010 * (1 - sx) + c110 * sx;
        const c01 = c001 * (1 - sx) + c101 * sx, c11 = c011 * (1 - sx) + c111 * sx;
        const c0 = c00 * (1 - sy) + c10 * sy, c1 = c01 * (1 - sy) + c11 * sy;
        return c0 * (1 - sz) + c1 * sz;
    }

    _project() {
        const { x: nx, y: ny, z: nz } = this.res;
        const u = this.u, v = this.v, w = this.w, p = this.p, div = this.div;
        for (let k = 1; k < nz - 1; k++) {
            for (let j = 1; j < ny - 1; j++) {
                for (let i = 1; i < nx - 1; i++) {
                    const idx = this._ix(i, j, k);
                    div[idx] = -0.5 * (
                        u[this._ix(i + 1, j, k)] - u[this._ix(i - 1, j, k)] +
                        v[this._ix(i, j + 1, k)] - v[this._ix(i, j - 1, k)] +
                        w[this._ix(i, j, k + 1)] - w[this._ix(i, j, k - 1)]);
                    p[idx] = 0;
                }
            }
        }
        this._setBnd(0, div); this._setBnd(0, p);
        for (let iter = 0; iter < PRESSURE_ITERS; iter++) {
            for (let k = 1; k < nz - 1; k++) {
                for (let j = 1; j < ny - 1; j++) {
                    for (let i = 1; i < nx - 1; i++) {
                        const idx = this._ix(i, j, k);
                        p[idx] = (div[idx] +
                            p[this._ix(i - 1, j, k)] + p[this._ix(i + 1, j, k)] +
                            p[this._ix(i, j - 1, k)] + p[this._ix(i, j + 1, k)] +
                            p[this._ix(i, j, k - 1)] + p[this._ix(i, j, k + 1)]) / 6;
                    }
                }
            }
            this._setBnd(0, p);
        }
        for (let k = 1; k < nz - 1; k++) {
            for (let j = 1; j < ny - 1; j++) {
                for (let i = 1; i < nx - 1; i++) {
                    const idx = this._ix(i, j, k);
                    u[idx] -= 0.5 * (p[this._ix(i + 1, j, k)] - p[this._ix(i - 1, j, k)]);
                    v[idx] -= 0.5 * (p[this._ix(i, j + 1, k)] - p[this._ix(i, j - 1, k)]);
                    w[idx] -= 0.5 * (p[this._ix(i, j, k + 1)] - p[this._ix(i, j, k - 1)]);
                }
            }
        }
        this._setBnd(1, u); this._setBnd(2, v); this._setBnd(3, w);
    }

    _addForces(dt, thermal) {
        const { x: nx, y: ny, z: nz } = this.res;
        // Buoyancy relative to the field mean (warm rises, cool sinks).
        let mean = 0;
        if (thermal && thermal.field) {
            const f = thermal.field;
            for (let i = 0; i < f.length; i++) mean += f[i];
            mean /= f.length;
            for (let k = 1; k < nz - 1; k++) {
                for (let j = 1; j < ny - 1; j++) {
                    for (let i = 1; i < nx - 1; i++) {
                        const idx = this._ix(i, j, k);
                        this.v[idx] += BUOYANCY * (f[idx] - mean) * dt;
                    }
                }
            }
        }
        this._vorticityConfinement(dt);
    }

    /** Vorticity confinement — re-inject small-scale swirl lost to numerical diffusion. */
    _vorticityConfinement(dt) {
        const { x: nx, y: ny, z: nz } = this.res;
        const u = this.u, v = this.v, w = this.w, curl = this.curl;
        for (let k = 1; k < nz - 1; k++) {
            for (let j = 1; j < ny - 1; j++) {
                for (let i = 1; i < nx - 1; i++) {
                    const idx = this._ix(i, j, k);
                    const cx = (w[this._ix(i, j + 1, k)] - w[this._ix(i, j - 1, k)]) - (v[this._ix(i, j, k + 1)] - v[this._ix(i, j, k - 1)]);
                    const cy = (u[this._ix(i, j, k + 1)] - u[this._ix(i, j, k - 1)]) - (w[this._ix(i + 1, j, k)] - w[this._ix(i - 1, j, k)]);
                    const cz = (v[this._ix(i + 1, j, k)] - v[this._ix(i - 1, j, k)]) - (u[this._ix(i, j + 1, k)] - u[this._ix(i, j - 1, k)]);
                    curl[idx] = Math.sqrt(cx * cx + cy * cy + cz * cz);
                }
            }
        }
        for (let k = 1; k < nz - 1; k++) {
            for (let j = 1; j < ny - 1; j++) {
                for (let i = 1; i < nx - 1; i++) {
                    const idx = this._ix(i, j, k);
                    let gx = (curl[this._ix(i + 1, j, k)] - curl[this._ix(i - 1, j, k)]) * 0.5;
                    let gy = (curl[this._ix(i, j + 1, k)] - curl[this._ix(i, j - 1, k)]) * 0.5;
                    let gz = (curl[this._ix(i, j, k + 1)] - curl[this._ix(i, j, k - 1)]) * 0.5;
                    const len = Math.sqrt(gx * gx + gy * gy + gz * gz) + 1e-5;
                    gx /= len; gy /= len; gz /= len;
                    const cx = (w[this._ix(i, j + 1, k)] - w[this._ix(i, j - 1, k)]) - (v[this._ix(i, j, k + 1)] - v[this._ix(i, j, k - 1)]);
                    const cy = (u[this._ix(i, j, k + 1)] - u[this._ix(i, j, k - 1)]) - (w[this._ix(i + 1, j, k)] - w[this._ix(i - 1, j, k)]);
                    const cz = (v[this._ix(i + 1, j, k)] - v[this._ix(i - 1, j, k)]) - (u[this._ix(i, j + 1, k)] - u[this._ix(i, j - 1, k)]);
                    this.u[idx] += VORTICITY * (gy * cz - gz * cy) * dt;
                    this.v[idx] += VORTICITY * (gz * cx - gx * cz) * dt;
                    this.w[idx] += VORTICITY * (gx * cy - gy * cx) * dt;
                }
            }
        }
    }

    /**
     * Advance the flow one step.
     * @param {number} dt - seconds
     * @param {import('./thermalField.js').ThermalField} thermal - for buoyancy
     */
    step(dt, thermal) {
        const sdt = Math.min(dt, MAX_DT);
        this._addForces(sdt, thermal);
        this._setSources();

        this.u0.set(this.u); this.v0.set(this.v); this.w0.set(this.w);
        this._advect(1, this.u, this.u0, sdt);
        this._advect(2, this.v, this.v0, sdt);
        this._advect(3, this.w, this.w0, sdt);
        this._setSources();

        this._project();
        this._setSources();
    }

    /** Velocity (m/s) at a world position, trilinearly sampled. */
    velocityAt(wx, wy, wz) {
        const { x: nx, y: ny, z: nz } = this.res;
        const W = config.greenhouseWidth, H = config.greenhouseHeight, L = config.greenhouseLength;
        const hw = W / 2, hl = L / 2;
        let fx = ((wx + hw) / W) * nx - 0.5;
        let fy = (wy / H) * ny - 0.5;
        let fz = ((wz + hl) / L) * nz - 0.5;
        if (fx < 0) fx = 0; else if (fx > nx - 1.001) fx = nx - 1.001;
        if (fy < 0) fy = 0; else if (fy > ny - 1.001) fy = ny - 1.001;
        if (fz < 0) fz = 0; else if (fz > nz - 1.001) fz = nz - 1.001;
        const i = Math.floor(fx), j = Math.floor(fy), k = Math.floor(fz);
        const sx = fx - i, sy = fy - j, sz = fz - k;
        return [
            this._trilinear(this.u, i, j, k, sx, sy, sz) * (W / nx),
            this._trilinear(this.v, i, j, k, sx, sy, sz) * (H / ny),
            this._trilinear(this.w, i, j, k, sx, sy, sz) * (L / nz),
        ];
    }
}
