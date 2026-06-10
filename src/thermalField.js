/**
 * The 3-D air-state field — temperature AND moisture, the centrepiece of the
 * simulation.
 *
 * Two scalar grids (temperature °C, specific humidity kg/kg) co-located with
 * the flow. Each step both are:
 *   1. advected backwards along the CFD velocity (semi-Lagrangian),
 *   2. driven by a per-cell SI energy + moisture balance:
 *        - shortwave solar transmitted through the glazing, absorbed at the
 *          floor (shaded under the benches) and intercepted by the canopy,
 *        - canopy transpiration: a tunable fraction of intercepted solar is
 *          released as latent heat — moistening the air instead of warming it,
 *        - longwave thermal radiation from the cover to a clear-sky temperature
 *          (Stefan–Boltzmann) → real night-time radiative cooling,
 *        - conduction through cover/walls (U-values), ground thermal mass,
 *        - the evaporative pad: cools the inlet air AND adds the corresponding
 *          moisture (Δw = cp·ΔT/λ, capped at saturation),
 *        - fan-wall infiltration exchanging with outside air,
 *        - condensation: humidity is capped at saturation for the local T,
 *   3. smoothed by a turbulent-diffusion sweep.
 *
 * Downstream consumers derive RH, dew point and VPD via utils psychrometrics.
 */
import * as THREE from 'three';
import { config } from './config.js';
import {
    computeGridResolution, calculateDayFactor,
    humidityRatioFromRH, inCanopy, inCanopyFootprint, canopyLayout,
} from './utils.js';

// Physical constants (SI).
const RHO_C_AIR = 1206;            // volumetric heat capacity of air, J/(m³·K)  (ρ≈1.2, cp≈1005)
const RHO_AIR = 1.2;               // air density, kg/m³
const LAMBDA_V = 2.45e6;           // latent heat of vaporization, J/kg
const SIGMA = 5.670374419e-8;      // Stefan–Boltzmann constant, W/(m²·K⁴)
const DAYLIGHT_EFFICACY = 110;     // luminous efficacy of daylight, lm/W  (LUX → W/m²)
const KELVIN = 273.15;
const CANOPY_ABSORPTANCE = 0.8;    // fraction of incoming solar a bench of plants intercepts

export class ThermalField {
    /**
     * @param {import('./cfd.js').CFDSolver} flow - airflow velocity source
     * @param {import('./evaporativeCooling.js').EvaporativeCooling} evaporativeCooling
     * @param {import('./environment.js').Environment} environment
     */
    constructor(flow, evaporativeCooling, environment) {
        this.flow = flow;
        this.evap = evaporativeCooling;
        this.env = environment;

        this.field = null;        // Float32Array of temperatures (°C)
        this.fieldNext = null;    // double buffer for advection
        this.humidity = null;     // Float32Array of humidity ratios (kg/kg)
        this.humidityNext = null;
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
        this.humidity = new Float32Array(n);
        this.humidityNext = new Float32Array(n);
        this.reset();
    }

    reset() {
        if (!this.field) return;
        this.field.fill(this.env.outsideTemperature);
        this.fieldNext.fill(this.env.outsideTemperature);
        this._wOutside = humidityRatioFromRH(this.env.outsideTemperature, config.airHumidity);
        this.humidity.fill(this._wOutside);
        this.humidityNext.fill(this._wOutside);
    }

    idx(x, y, z) {
        return x + y * this.res.x + z * this.res.x * this.res.y;
    }

    /** Trilinear sample of an arbitrary cell array; `fallback` outside the grid. */
    _sample(arr, wx, wy, wz, fallback) {
        const { x: rx, y: ry, z: rz } = this.res;
        const hw = config.greenhouseWidth / 2;
        const hl = config.greenhouseLength / 2;
        const fx = ((wx + hw) / config.greenhouseWidth) * (rx - 1);
        const fy = (wy / config.greenhouseHeight) * (ry - 1);
        const fz = ((wz + hl) / config.greenhouseLength) * (rz - 1);

        if (fx < 0 || fx >= rx - 1 || fy < 0 || fy >= ry - 1 || fz < 0 || fz >= rz - 1) {
            return fallback;
        }

        const x0 = Math.floor(fx), y0 = Math.floor(fy), z0 = Math.floor(fz);
        const x1 = x0 + 1, y1 = y0 + 1, z1 = z0 + 1;
        const dx = fx - x0, dy = fy - y0, dz = fz - z0;

        const c00 = arr[this.idx(x0, y0, z0)] * (1 - dx) + arr[this.idx(x1, y0, z0)] * dx;
        const c10 = arr[this.idx(x0, y1, z0)] * (1 - dx) + arr[this.idx(x1, y1, z0)] * dx;
        const c01 = arr[this.idx(x0, y0, z1)] * (1 - dx) + arr[this.idx(x1, y0, z1)] * dx;
        const c11 = arr[this.idx(x0, y1, z1)] * (1 - dx) + arr[this.idx(x1, y1, z1)] * dx;
        const c0 = c00 * (1 - dy) + c10 * dy;
        const c1 = c01 * (1 - dy) + c11 * dy;
        return c0 * (1 - dz) + c1 * dz;
    }

    /** Trilinearly interpolated temperature at a world position (°C). */
    sampleTemperature(wx, wy, wz) {
        return this._sample(this.field, wx, wy, wz, this.env.outsideTemperature);
    }

    /** Trilinearly interpolated humidity ratio at a world position (kg/kg). */
    sampleHumidity(wx, wy, wz) {
        const fallback = this._wOutside !== undefined
            ? this._wOutside
            : humidityRatioFromRH(this.env.outsideTemperature, config.airHumidity);
        return this._sample(this.humidity, wx, wy, wz, fallback);
    }

    /**
     * Flow velocity (m/s) at a world position, from the CFD solver.
     * @returns {[number, number, number]}
     */
    velocityAt(wx, wy, wz) {
        return this.flow.velocityAt(wx, wy, wz);
    }

    /**
     * Advance the air-state field by one step.
     * @param {number} dt - seconds (pre-scaled by the caller)
     */
    update(dt) {
        if (!this.field) return;

        const { x: rx, y: ry, z: rz } = this.res;
        const W = config.greenhouseWidth, L = config.greenhouseLength, H = config.greenhouseHeight;
        const hw = W / 2, hl = L / 2;
        const cellSizeX = W / rx, cellSizeY = H / ry, cellSizeZ = L / rz;

        const padOutlet = this.evap.update(this.env.outsideTemperature, config.airHumidity);
        const wPad = this.evap.outletHumidityRatio;
        const tOut = this.env.outsideTemperature;
        const wOut = humidityRatioFromRH(tOut, config.airHumidity);
        this._wOutside = wOut;

        // Clear-sky radiant temperature (Swinbank correlation), kelvin.
        const skyK = 0.0552 * Math.pow(tOut + KELVIN, 1.5);
        const skyK4 = skyK * skyK * skyK * skyK;
        this.skyTemperature = skyK - KELVIN;

        // Shortwave solar (W/m²): incident on cover → transmitted to floor; remainder partly absorbed by cover.
        const gIncident = calculateDayFactor(this.env.currentTime) * config.maxLux / DAYLIGHT_EFFICACY;
        this.solarIrradiance = gIncident;
        const gFloor = config.solarGainCoefficient * gIncident;
        const gCover = (1 - config.solarGainCoefficient) * gIncident * 0.5;

        // Canopy energy partition: intercepted solar splits into latent
        // (transpiration → humidity) and sensible (air heating) over the band.
        const cl = canopyLayout();
        const canopyDepth = Math.max(cl.yHigh - cl.yLow, 0.3);
        const gCanopy = gFloor * CANOPY_ABSORPTANCE;
        const fLatent = config.canopyTranspiration;
        const canopySensibleRate = ((1 - fLatent) * gCanopy) / (RHO_C_AIR * canopyDepth); // K/s
        const canopyLatentRate = (fLatent * gCanopy) / (LAMBDA_V * RHO_AIR * canopyDepth); // (kg/kg)/s

        const stepDt = Math.min(dt, 0.5);              // cap for advection stability (CFL-ish)
        const inletRate = THREE.MathUtils.clamp(config.fanSpeed * 3 * stepDt, 0, 1);

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

                    // --- Semi-Lagrangian advection along the flow (both scalars) ---
                    const v = this.velocityAt(wx, wy, wz);
                    const bx = wx - v[0] * stepDt, by = wy - v[1] * stepDt, bz = wz - v[2] * stepDt;
                    let T = this._sample(this.field, bx, by, bz, tOut);
                    let wHum = this._sample(this.humidity, bx, by, bz, wOut);

                    // 1. Evaporative-pad inlet: cooled AND humidified air replaces interior air.
                    if (z <= 1
                        && wy >= config.coolingPadElevation
                        && wy <= config.coolingPadElevation + config.coolingPadHeight
                        && Math.abs(wx) < hw * 0.9) {
                        T = T * (1 - inletRate) + padOutlet * inletRate;
                        wHum = wHum * (1 - inletRate) + wPad * inletRate;
                    }

                    // 2. Floor: absorbs transmitted solar (shaded under benches); ground coupling.
                    if (y === 0) {
                        const shade = inCanopyFootprint(wx, wz) ? (1 - CANOPY_ABSORPTANCE) : 1;
                        T += (config.floorAbsorptance * gFloor * shade) / (RHO_C_AIR * cellSizeY) * stepDt;
                        const gRate = Math.min(2.0 / (RHO_C_AIR * cellSizeY) * stepDt, 0.3); // U_ground ≈ 2 W/m²K
                        T += (tGround - T) * gRate;
                    }

                    // 3. Plant canopy: transpiration (latent) + reduced sensible heating + moisture.
                    if (gCanopy > 0 && inCanopy(wx, wy, wz)) {
                        T += canopySensibleRate * stepDt;
                        wHum += canopyLatentRate * stepDt;
                    }

                    // 4. Roof / cover: absorbed solar + longwave radiation to sky + conduction.
                    if (y === ry - 1) {
                        T += gCover / (RHO_C_AIR * cellSizeY) * stepDt;
                        const tK = T + KELVIN;
                        const qLW = config.coverEmissivity * SIGMA * (tK * tK * tK * tK - skyK4); // W/m² net loss
                        T -= qLW / (RHO_C_AIR * cellSizeY) * stepDt;
                        const rRoof = Math.min(config.roofUValue / (RHO_C_AIR * cellSizeY) * stepDt, 0.3);
                        T += (tOut - T) * rRoof;
                    }

                    // 5. Side walls: conduction to outside.
                    if (x === 0 || x === rx - 1) {
                        const rWall = Math.min(config.wallUValue / (RHO_C_AIR * cellSizeX) * stepDt, 0.3);
                        T += (tOut - T) * rWall;
                    }

                    // 6. Exhaust wall infiltration away from the fans (heat + moisture).
                    if (z === rz - 1) {
                        let nearFan = false;
                        for (let i = 1; i <= config.fanCount; i++) {
                            const fx = -W / 2 + i * fanSpacing;
                            if (Math.hypot(wx - fx, wy - config.fanHeight) < 0.8) { nearFan = true; break; }
                        }
                        if (!nearFan) {
                            const leak = 0.02 * stepDt;
                            T += (tOut - T) * leak;
                            wHum += (wOut - wHum) * leak;
                        }
                    }

                    // 7. Condensation: air cannot hold more than saturation at its temperature.
                    const wSat = humidityRatioFromRH(T, 100);
                    if (wHum > wSat) wHum = wSat;
                    if (wHum < 0) wHum = 0;

                    this.fieldNext[idx] = T;
                    this.humidityNext[idx] = wHum;
                }
            }
        }

        // --- Turbulent diffusion (single Jacobi-style sweep, both scalars) ---
        const diffCoeff = THREE.MathUtils.clamp(
            config.thermalDiffusion * stepDt / (cellSizeZ * cellSizeZ), 0, 0.18
        );
        if (diffCoeff > 0.001) {
            for (const fn of [this.fieldNext, this.humidityNext]) {
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
        }

        let tmp = this.field;
        this.field = this.fieldNext;
        this.fieldNext = tmp;
        tmp = this.humidity;
        this.humidity = this.humidityNext;
        this.humidityNext = tmp;
    }
}
