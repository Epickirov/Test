/**
 * The 3-D air-temperature field — the centrepiece of the simulation.
 *
 * A scalar grid of air temperatures co-located with the flow. Each step it is:
 *   1. advected backwards along the flow velocity (semi-Lagrangian),
 *   2. driven by a per-cell SI energy balance:
 *        - shortwave solar transmitted through the glazing and absorbed at the floor,
 *        - longwave thermal radiation from the cover to a clear-sky temperature
 *          (Stefan–Boltzmann), which produces real night-time radiative cooling,
 *        - conduction through the cover (U-value),
 *        - ground thermal-mass coupling at the floor,
 *        - cooled-air inflow at the evaporative pad,
 *   3. smoothed by a turbulent-diffusion sweep.
 *
 * The flow velocity (`velocityAt`) is either taken from the external fluid
 * solver when present, or modelled analytically as fan-driven ventilation plus
 * Boussinesq buoyancy — so warm air rises, the cool pad plume drifts toward the
 * fans, and stratification emerges. Energy is tracked in watts; temperatures in
 * degrees Celsius (converted to kelvin for radiation).
 */
import * as THREE from 'three';
import { config } from './config.js';
import { computeGridResolution, calculateDayFactor } from './utils.js';

// Physical constants (SI).
const RHO_C_AIR = 1206;            // volumetric heat capacity of air, J/(m³·K)  (ρ≈1.2, cp≈1005)
const SIGMA = 5.670374419e-8;      // Stefan–Boltzmann constant, W/(m²·K⁴)
const G = 9.81;                    // gravitational acceleration, m/s²
const DAYLIGHT_EFFICACY = 110;     // luminous efficacy of daylight, lm/W  (LUX → W/m²)
const KELVIN = 273.15;

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
        this.skyTemperature = 0;  // clear-sky radiant temperature (°C), updated each step
        this.solarIrradiance = 0; // incident solar on the cover (W/m²), updated each step

        this.init();
    }

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

    idx(x, y, z) {
        return x + y * this.res.x + z * this.res.x * this.res.y;
    }

    /** Trilinearly interpolated temperature at a world position (°C). */
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

        const c00 = f[this.idx(x0, y0, z0)] * (1 - dx) + f[this.idx(x1, y0, z0)] * dx;
        const c10 = f[this.idx(x0, y1, z0)] * (1 - dx) + f[this.idx(x1, y1, z0)] * dx;
        const c01 = f[this.idx(x0, y0, z1)] * (1 - dx) + f[this.idx(x1, y0, z1)] * dx;
        const c11 = f[this.idx(x0, y1, z1)] * (1 - dx) + f[this.idx(x1, y1, z1)] * dx;
        const c0 = c00 * (1 - dy) + c10 * dy;
        const c1 = c01 * (1 - dy) + c11 * dy;
        return c0 * (1 - dz) + c1 * dz;
    }

    /** Mean ventilation velocity (m/s) from fan volumetric flow over the cross-section. */
    _meanVentilation() {
        const fanArea = Math.PI * 0.49 * config.fanCount;     // m², fan disc area
        const fanExitVel = 8.0 * config.fanSpeed;             // m/s at the fan
        return (fanArea * fanExitVel) / (config.greenhouseWidth * config.greenhouseHeight);
    }

    /**
     * Flow velocity at a world position (m/s). Uses the external solver if
     * available; otherwise models fan-driven ventilation funnelling toward the
     * fans plus a Boussinesq buoyancy term (warm air rises).
     *
     * @param {number} [tHint] - local temperature (°C) to avoid a re-sample
     * @returns {[number, number, number]}
     */
    velocityAt(wx, wy, wz, tHint) {
        if (this.fluid.available) {
            const v = this.fluid.sampleVelocityAtWorld(wx, wy, wz);
            const s = config.greenhouseLength * 0.04;          // normalised solver units → ~m/s
            return [v[0] * s, v[1] * s, v[2] * s];
        }

        const W = config.greenhouseWidth, L = config.greenhouseLength, H = config.greenhouseHeight;
        const hl = L / 2;
        let vx = 0, vy = 0, vz = this._meanVentilation();

        // Funnel toward the nearest fan as the air approaches the exhaust wall.
        const zf = THREE.MathUtils.clamp((wz + hl) / L, 0, 1);
        const spacing = W / (config.fanCount + 1);
        let fanX = 0, best = Infinity;
        for (let i = 1; i <= config.fanCount; i++) {
            const fx = -W / 2 + i * spacing;
            const d = Math.abs(wx - fx);
            if (d < best) { best = d; fanX = fx; }
        }
        vx += (fanX - wx) * 0.4 * zf * config.fanSpeed;
        vy += (config.fanHeight - wy) * 0.2 * zf * config.fanSpeed;

        // Boussinesq buoyancy: free-convection plume velocity scale √(g·β·ΔT·H).
        const T = (tHint !== undefined) ? tHint : this.sampleTemperature(wx, wy, wz);
        const tRefK = 0.5 * (this.evap.padOutletTemp + this.env.outsideTemperature) + KELVIN;
        const dT = (T + KELVIN) - tRefK;
        const wBuoy = Math.sign(dT) * Math.sqrt(G * (1 / tRefK) * Math.abs(dT) * H);
        vy += THREE.MathUtils.clamp(wBuoy, -1.2, 1.2);

        return [vx, vy, vz];
    }

    /**
     * Advance the thermal field by one step.
     * @param {number} dt - seconds (pre-scaled by the caller)
     */
    update(dt) {
        if (!this.field) return;

        const { x: rx, y: ry, z: rz } = this.res;
        const W = config.greenhouseWidth, L = config.greenhouseLength, H = config.greenhouseHeight;
        const hw = W / 2, hl = L / 2;
        const cellSizeX = W / rx, cellSizeY = H / ry, cellSizeZ = L / rz;

        const padOutlet = this.evap.update(this.env.outsideTemperature, config.airHumidity);
        const tOut = this.env.outsideTemperature;

        // Clear-sky radiant temperature (Swinbank correlation), kelvin.
        const skyK = 0.0552 * Math.pow(tOut + KELVIN, 1.5);
        const skyK4 = skyK * skyK * skyK * skyK;
        this.skyTemperature = skyK - KELVIN;

        // Shortwave solar (W/m²): incident on cover → transmitted to floor; remainder partly absorbed by cover.
        const gIncident = calculateDayFactor(this.env.currentTime) * config.maxLux / DAYLIGHT_EFFICACY;
        this.solarIrradiance = gIncident;
        const gFloor = config.solarGainCoefficient * gIncident;
        const gCover = (1 - config.solarGainCoefficient) * gIncident * 0.5;

        const meanVz = this._meanVentilation();
        const stepDt = Math.min(dt, 0.5);              // cap for advection stability (CFL-ish)

        // ground temperature lags toward the daily minimum (thermal mass)
        const tGround = config.outsideMinTemp + 0.5 * (tOut - config.outsideMinTemp);

        const fanSpacing = W / (config.fanCount + 1);

        for (let z = 0; z < rz; z++) {
            for (let y = 0; y < ry; y++) {
                for (let x = 0; x < rx; x++) {
                    const idx = this.idx(x, y, z);
                    const wx = (x + 0.5) / rx * W - hw;
                    const wy = (y + 0.5) / ry * H;
                    const wz = (z + 0.5) / rz * L - hl;

                    // --- Semi-Lagrangian advection along the flow ---
                    const v = this.velocityAt(wx, wy, wz, this.field[idx]);
                    let T = this.sampleTemperature(wx - v[0] * stepDt, wy - v[1] * stepDt, wz - v[2] * stepDt);

                    // 1. Evaporative-pad inlet: incoming cooled air replaces interior air.
                    if (z <= 1
                        && wy >= config.coolingPadElevation
                        && wy <= config.coolingPadElevation + config.coolingPadHeight
                        && Math.abs(wx) < hw * 0.9) {
                        const rate = THREE.MathUtils.clamp((meanVz / cellSizeZ) * stepDt, 0, 1);
                        T = T * (1 - rate) + padOutlet * rate;
                    }

                    // 2. Floor: absorbs transmitted solar; coupled to ground thermal mass.
                    if (y === 0) {
                        T += (config.floorAbsorptance * gFloor) / (RHO_C_AIR * cellSizeY) * stepDt;
                        const gRate = Math.min(2.0 / (RHO_C_AIR * cellSizeY) * stepDt, 0.3); // U_ground ≈ 2 W/m²K
                        T += (tGround - T) * gRate;
                    }

                    // 3. Roof / cover: absorbed solar + longwave radiation to sky + conduction.
                    if (y === ry - 1) {
                        T += gCover / (RHO_C_AIR * cellSizeY) * stepDt;
                        const tK = T + KELVIN;
                        const qLW = config.coverEmissivity * SIGMA * (tK * tK * tK * tK - skyK4); // W/m² net loss
                        T -= qLW / (RHO_C_AIR * cellSizeY) * stepDt;
                        const rRoof = Math.min(config.roofUValue / (RHO_C_AIR * cellSizeY) * stepDt, 0.3);
                        T += (tOut - T) * rRoof;
                    }

                    // 4. Side walls: conduction to outside.
                    if (x === 0 || x === rx - 1) {
                        const rWall = Math.min(config.wallUValue / (RHO_C_AIR * cellSizeX) * stepDt, 0.3);
                        T += (tOut - T) * rWall;
                    }

                    // 5. Exhaust wall infiltration away from the fans.
                    if (z === rz - 1) {
                        let nearFan = false;
                        for (let i = 1; i <= config.fanCount; i++) {
                            const fx = -W / 2 + i * fanSpacing;
                            if (Math.hypot(wx - fx, wy - config.fanHeight) < 0.8) { nearFan = true; break; }
                        }
                        if (!nearFan) T += (tOut - T) * (0.02 * stepDt);
                    }

                    this.fieldNext[idx] = T;
                }
            }
        }

        // --- Turbulent diffusion (single Jacobi-style sweep) ---
        const diffCoeff = THREE.MathUtils.clamp(
            config.thermalDiffusion * stepDt / (cellSizeZ * cellSizeZ), 0, 0.18
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

        const tmp = this.field;
        this.field = this.fieldNext;
        this.fieldNext = tmp;
    }
}
