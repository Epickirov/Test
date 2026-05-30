/**
 * The 3-D temperature field — the centrepiece of the simulation.
 *
 * A scalar grid of air temperatures co-located with the fluid solver. Each
 * step it is:
 *   1. advected backwards along the fluid velocity (semi-Lagrangian),
 *   2. nudged by source/sink terms (pad inlet, fan exhaust, solar gain,
 *      ground coupling, wall/roof conduction),
 *   3. smoothed by a single turbulent-diffusion sweep,
 *   4. fed back into the fluid solver as buoyancy.
 *
 * If the fluid solver is unavailable the advection and buoyancy steps become
 * no-ops, but the source/diffusion terms still evolve the field so the scene
 * remains meaningful.
 */
import * as THREE from 'three';
import { config } from './config.js';
import { computeGridResolution, calculateDayFactor } from './utils.js';

export class ThermalField {
    /**
     * @param {import('./fluidField.js').FluidField} fluidField
     * @param {import('./evaporativeCooling.js').EvaporativeCooling} evaporativeCooling
     * @param {import('./environment.js').Environment} environment
     */
    constructor(fluidField, evaporativeCooling, environment) {
        this.fluid = fluidField;
        this.evap = evaporativeCooling;
        this.env = environment;

        this.field = null;       // Float32Array of temperatures (°C)
        this.fieldNext = null;   // double buffer for advection
        this.res = { x: 0, y: 0, z: 0 };

        this.init();
    }

    /** (Re)allocate the grid and fill it with the current outside temperature. */
    init() {
        this.res = computeGridResolution();
        const n = this.res.x * this.res.y * this.res.z;
        this.field = new Float32Array(n);
        this.fieldNext = new Float32Array(n);
        this.reset();
    }

    reset() {
        if (!this.field) return;
        this.field.fill(this.env.outsideTemperature);
        this.fieldNext.fill(this.env.outsideTemperature);
    }

    /** Flat-array index for grid coordinates. */
    idx(x, y, z) {
        return x + y * this.res.x + z * this.res.x * this.res.y;
    }

    /**
     * Trilinearly interpolated temperature at a world position. Returns the
     * outside temperature for points outside the grid.
     */
    sampleTemperature(wx, wy, wz) {
        const { x: rx, y: ry, z: rz } = this.res;
        const hw = config.greenhouseWidth / 2;
        const hl = config.greenhouseLength / 2;
        const fx = ((wx + hw) / config.greenhouseWidth) * (rx - 1);
        const fy = (wy / config.greenhouseHeight) * (ry - 1);
        const fz = ((wz + hl) / config.greenhouseLength) * (rz - 1);

        if (fx < 0 || fx >= rx - 1 || fy < 0 || fy >= ry - 1 || fz < 0 || fz >= rz - 1) {
            return this.env.outsideTemperature;
        }

        const x0 = Math.floor(fx), y0 = Math.floor(fy), z0 = Math.floor(fz);
        const x1 = x0 + 1, y1 = y0 + 1, z1 = z0 + 1;
        const dx = fx - x0, dy = fy - y0, dz = fz - z0;
        const f = this.field;

        const c000 = f[this.idx(x0, y0, z0)];
        const c100 = f[this.idx(x1, y0, z0)];
        const c010 = f[this.idx(x0, y1, z0)];
        const c110 = f[this.idx(x1, y1, z0)];
        const c001 = f[this.idx(x0, y0, z1)];
        const c101 = f[this.idx(x1, y0, z1)];
        const c011 = f[this.idx(x0, y1, z1)];
        const c111 = f[this.idx(x1, y1, z1)];

        const c00 = c000 * (1 - dx) + c100 * dx;
        const c10 = c010 * (1 - dx) + c110 * dx;
        const c01 = c001 * (1 - dx) + c101 * dx;
        const c11 = c011 * (1 - dx) + c111 * dx;
        const c0 = c00 * (1 - dy) + c10 * dy;
        const c1 = c01 * (1 - dy) + c11 * dy;
        return c0 * (1 - dz) + c1 * dz;
    }

    /**
     * Advance the thermal field by one step.
     * @param {number} dt - seconds (pre-scaled by the caller)
     */
    update(dt) {
        if (!this.field) return;

        const { x: rx, y: ry, z: rz } = this.res;
        const hw = config.greenhouseWidth / 2;
        const hl = config.greenhouseLength / 2;
        const H = config.greenhouseHeight;
        const cellSizeY = H / ry;
        const cellSizeZ = config.greenhouseLength / rz;

        // Current driving values.
        const padOutlet = this.evap.update(this.env.outsideTemperature, config.airHumidity);
        const tOut = this.env.outsideTemperature;
        const solarFlux = calculateDayFactor(this.env.currentTime) * config.maxLux * 0.0079; // ~W/m² per LUX

        const stepDt = Math.min(dt, 0.5); // cap for advection stability (CFL-ish)

        const fanXs = [];
        const fanSpacing = config.greenhouseWidth / (config.fanCount + 1);
        for (let i = 1; i <= config.fanCount; i++) {
            fanXs.push(-config.greenhouseWidth / 2 + i * fanSpacing);
        }

        // Convert solver velocities to m/s (matches the particle scaling).
        const velScaleZ = config.greenhouseLength * 0.04;
        const velScaleX = config.greenhouseWidth * 0.04;
        const velScaleY = H * 0.04;

        // ---- Semi-Lagrangian advection + source/sink terms ----
        for (let z = 0; z < rz; z++) {
            for (let y = 0; y < ry; y++) {
                for (let x = 0; x < rx; x++) {
                    const idx = this.idx(x, y, z);

                    const wx = (x + 0.5) / rx * config.greenhouseWidth - hw;
                    const wy = (y + 0.5) / ry * H;
                    const wz = (z + 0.5) / rz * config.greenhouseLength - hl;

                    const v = this.fluid.getCellVelocity(x, y, z);
                    const bx = wx - v[0] * velScaleX * stepDt * config.fanSpeed;
                    const by = wy - v[1] * velScaleY * stepDt * config.fanSpeed;
                    const bz = wz - v[2] * velScaleZ * stepDt * config.fanSpeed;

                    let T = this.sampleTemperature(bx, by, bz);

                    // 1. Cooling-pad inlet.
                    if (z <= 1
                        && wy >= config.coolingPadElevation
                        && wy <= config.coolingPadElevation + config.coolingPadHeight
                        && Math.abs(wx) < hw * 0.9) {
                        const force = THREE.MathUtils.clamp(config.fanSpeed * 4 * stepDt, 0, 1);
                        T = T * (1 - force) + padOutlet * force;
                    }

                    // 2. Fan exhaust wall — non-fan area leaks outside air in.
                    if (z >= rz - 2) {
                        let nearFan = false;
                        for (const fx of fanXs) {
                            if (Math.hypot(wx - fx, wy - config.fanHeight) < 0.8) {
                                nearFan = true;
                                break;
                            }
                        }
                        const leakRate = nearFan ? 0 : 0.02 * stepDt;
                        T = T * (1 - leakRate) + tOut * leakRate;
                    }

                    // 3. Roof solar gain.
                    if (y >= ry - 2 && solarFlux > 0) {
                        const heatRate = solarFlux * config.solarGainCoefficient / (1200 * cellSizeY);
                        T += heatRate * stepDt;
                    }

                    // 4. Floor / ground thermal mass.
                    if (y <= 1) {
                        const tGround = config.outsideMinTemp + 0.5 * (tOut - config.outsideMinTemp);
                        const groundCoupling = 0.05 * stepDt;
                        T = T * (1 - groundCoupling) + tGround * groundCoupling;
                    }

                    // 5. Wall / roof conductive loss.
                    const isWall = (x <= 1 || x >= rx - 2);
                    const isRoof = (y >= ry - 2);
                    if (isWall || isRoof) {
                        const U = isRoof ? config.roofUValue : config.wallUValue;
                        const wallRate = U / (1200 * cellSizeY) * stepDt;
                        T = T + (tOut - T) * Math.min(wallRate, 0.3);
                    }

                    this.fieldNext[idx] = T;
                }
            }
        }

        // ---- Turbulent diffusion (single Jacobi-style sweep) ----
        const diffCoeff = THREE.MathUtils.clamp(
            config.thermalDiffusion * stepDt / (cellSizeZ * cellSizeZ),
            0, 0.18
        );
        if (diffCoeff > 0.001) {
            const fn = this.fieldNext;
            for (let z = 1; z < rz - 1; z++) {
                for (let y = 1; y < ry - 1; y++) {
                    for (let x = 1; x < rx - 1; x++) {
                        const idx = this.idx(x, y, z);
                        const neighbors =
                            fn[this.idx(x - 1, y, z)] + fn[this.idx(x + 1, y, z)] +
                            fn[this.idx(x, y - 1, z)] + fn[this.idx(x, y + 1, z)] +
                            fn[this.idx(x, y, z - 1)] + fn[this.idx(x, y, z + 1)];
                        fn[idx] += diffCoeff * (neighbors / 6 - fn[idx]);
                    }
                }
            }
        }

        // ---- Buoyancy feedback into the fluid solver ----
        if (this.fluid.available) {
            const avgT = (padOutlet + tOut) * 0.5;
            for (let z = 2; z < rz - 2; z += 2) {
                for (let y = 1; y < ry - 1; y += 2) {
                    for (let x = 1; x < rx - 1; x += 2) {
                        const T = this.fieldNext[this.idx(x, y, z)];
                        const buoy = (T - avgT) * 0.002 * stepDt;
                        const v = this.fluid.getCellVelocity(x, y, z);
                        this.fluid.setCellVelocity(x, y, z, [v[0], v[1] + buoy, v[2]]);
                    }
                }
            }
        }

        // Swap buffers.
        const tmp = this.field;
        this.field = this.fieldNext;
        this.fieldNext = tmp;
    }
}
