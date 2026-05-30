/**
 * Wrapper around the external (CDN) `FluidSimulation` solver.
 *
 * Responsibilities:
 *  - construct / reset the solver and mark the greenhouse boundary + fan
 *    openings as obstacles,
 *  - inject inflow at the cooling pad and outflow at the fans each step,
 *  - expose velocity sampling for the thermal field and particles.
 *
 * The solver is loaded as a classic (non-module) script and lives on `window`.
 * If it failed to load, `available` stays false and every method degrades to a
 * no-op / zero velocity so the rest of the app keeps running.
 */
import { config } from './config.js';
import { computeGridResolution } from './utils.js';

const ZERO_VELOCITY = Object.freeze([0, 0, 0]);

export class FluidField {
    constructor() {
        this.sim = null;
        this.res = computeGridResolution();
        this.init();
    }

    /** True when a working solver instance exists. */
    get available() {
        return this.sim !== null;
    }

    /** (Re)create the solver at the current resolution. */
    init() {
        this.res = computeGridResolution();
        const FluidSimulation = window.FluidSimulation;

        if (!config.useFluidSimulation || typeof FluidSimulation === 'undefined') {
            if (typeof FluidSimulation === 'undefined') {
                console.warn('[fluidField] FluidSimulation library not found — ' +
                    'running with advection/buoyancy disabled.');
            }
            this.sim = null;
            return;
        }

        try {
            this.sim = new FluidSimulation({
                resolution: config.fluidResolution,
                iterations: config.fluidIterations,
                viscosity: 0.00001,
                density: 1.0,
                velocityDissipation: 0.99,
                densityDissipation: 0.99,
                pressureDissipation: 0.8,
                enableVorticity: true,
                vorticityStrength: 40,
            });
            this._setupObstacles();
        } catch (e) {
            console.error('Fluid sim init error:', e);
            config.useFluidSimulation = false;
            this.sim = null;
        }
    }

    reset() {
        if (this.sim) this.sim.reset();
    }

    /** Velocity at a grid cell, or zero if the solver is unavailable. */
    getCellVelocity(x, y, z) {
        return this.sim ? this.sim.getVelocity(x, y, z) : ZERO_VELOCITY;
    }

    setCellVelocity(x, y, z, v) {
        if (this.sim) this.sim.setVelocity(x, y, z, v);
    }

    /** Velocity at a world-space position (nearest cell), or zero if outside. */
    sampleVelocityAtWorld(wx, wy, wz) {
        if (!this.sim) return ZERO_VELOCITY;
        const { x: rx, y: ry, z: rz } = this.res;
        const hw = config.greenhouseWidth / 2;
        const hl = config.greenhouseLength / 2;
        const fx = Math.floor(((wx + hw) / config.greenhouseWidth) * rx);
        const fy = Math.floor((wy / config.greenhouseHeight) * ry);
        const fz = Math.floor(((wz + hl) / config.greenhouseLength) * rz);
        if (fx < 0 || fx >= rx || fy < 0 || fy >= ry || fz < 0 || fz >= rz) return ZERO_VELOCITY;
        return this.sim.getVelocity(fx, fy, fz);
    }

    _setupObstacles() {
        const { x: xRes, y: yRes, z: zRes } = this.res;
        const obstacles = new Uint8Array(xRes * yRes * zRes);
        const idx = (x, y, z) => x + y * xRes + z * xRes * yRes;

        const hw = config.greenhouseWidth / 2;
        const hl = config.greenhouseLength / 2;
        const fanSpacing = config.greenhouseWidth / (config.fanCount + 1);

        for (let x = 0; x < xRes; x++) {
            for (let y = 0; y < yRes; y++) {
                for (let z = 0; z < zRes; z++) {
                    const gx = (x / xRes) * config.greenhouseWidth - hw;
                    const gy = (y / yRes) * config.greenhouseHeight;
                    const gz = (z / zRes) * config.greenhouseLength - hl;

                    if (Math.abs(gx) >= hw || gy <= 0 || gy >= config.greenhouseHeight || Math.abs(gz) >= hl) {
                        obstacles[idx(x, y, z)] = 1; // solid boundary wall
                    } else if (gz <= -hl + 0.1
                        && gy >= config.coolingPadElevation
                        && gy <= config.coolingPadElevation + config.coolingPadHeight) {
                        obstacles[idx(x, y, z)] = 0; // open cooling-pad inlet
                    } else if (gz >= hl - 0.1) {
                        // Exhaust wall: open only where a fan sits.
                        let nearFan = false;
                        for (let i = 1; i <= config.fanCount; i++) {
                            const fanX = -hw + i * fanSpacing;
                            if (Math.hypot(gx - fanX, gy - config.fanHeight) < 0.7) {
                                nearFan = true;
                                break;
                            }
                        }
                        obstacles[idx(x, y, z)] = nearFan ? 0 : 1;
                    }
                }
            }
        }
        this.sim.setObstacles(obstacles);
    }

    /**
     * Inject the boundary flow (pad inflow, fan outflow) and advance the solver.
     * @param {number} deltaTime - seconds (pre-scaled by the caller)
     */
    update(deltaTime) {
        if (!this.sim) return;
        const { x: xRes, y: yRes, z: zRes } = this.res;

        const padArea = config.greenhouseWidth * config.coolingPadHeight;
        const fanArea = (Math.PI * 0.49) * config.fanCount;
        const targetFanVel = 1.0; // normalised solver units (display value is 8 m/s · fanSpeed)
        const padVel = (fanArea / padArea) * targetFanVel;

        const flowIn = padVel * config.fanSpeed;
        const flowOut = -targetFanVel * config.fanSpeed;

        // Inflow across the cooling-pad face (z = 0).
        for (let x = 0; x < xRes; x++) {
            for (let y = 0; y < yRes; y++) {
                const gy = (y / yRes) * config.greenhouseHeight;
                if (gy >= config.coolingPadElevation && gy <= config.coolingPadElevation + config.coolingPadHeight) {
                    this.sim.setVelocity(x, y, 0, [0, 0, flowIn]);
                }
            }
        }

        // Outflow drawn through each fan disc (z = zRes - 1).
        const fanSpacing = config.greenhouseWidth / (config.fanCount + 1);
        for (let i = 1; i <= config.fanCount; i++) {
            const fanX = -config.greenhouseWidth / 2 + i * fanSpacing;
            const gridX = Math.floor(((fanX + config.greenhouseWidth / 2) / config.greenhouseWidth) * xRes);
            const gridY = Math.floor((config.fanHeight / config.greenhouseHeight) * yRes);
            const rad = Math.ceil(0.7 / (config.greenhouseLength / zRes));

            for (let dx = -rad; dx <= rad; dx++) {
                for (let dy = -rad; dy <= rad; dy++) {
                    const x = gridX + dx;
                    const y = gridY + dy;
                    if (x >= 0 && x < xRes && y >= 0 && y < yRes) {
                        const dist = Math.sqrt(dx * dx + dy * dy);
                        if (dist <= rad) {
                            this.sim.setVelocity(x, y, zRes - 1, [0, 0, flowOut * (1 - dist / rad)]);
                        }
                    }
                }
            }
        }

        this.sim.step(deltaTime * 0.05);
    }
}
