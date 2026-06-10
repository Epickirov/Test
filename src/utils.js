/**
 * Small, dependency-light helpers shared across subsystems.
 */
import { config } from './config.js';

/**
 * Resolution of the simulation grid.
 *
 * The fluid solver and the thermal field are co-located on the same grid so
 * that velocities and temperatures share indices. The grid is stretched to the
 * greenhouse aspect ratio and clamped to a sensible minimum so very thin
 * structures don't collapse to a degenerate (sub-cell) grid.
 *
 * NOTE: the original monolith computed this twice with two different formulas
 * (the fluid obstacle map skipped the clamp), which silently mismatched for
 * extreme aspect ratios. Centralising it here keeps every consumer in sync.
 *
 * @returns {{x:number, y:number, z:number}}
 */
export function computeGridResolution() {
    return {
        x: Math.max(8, Math.floor(config.fluidResolution * (config.greenhouseWidth / config.greenhouseLength))),
        y: Math.max(6, Math.floor(config.fluidResolution * (config.greenhouseHeight / config.greenhouseLength))),
        z: config.fluidResolution,
    };
}

/**
 * Daylight intensity factor in [0, 1] following a cosine bell between sunrise
 * and sunset (0 at night, 1 at solar noon).
 *
 * @param {number} hour - hour of day in [0, 24)
 * @returns {number}
 */
export function calculateDayFactor(hour) {
    if (hour < config.sunriseTime || hour > config.sunsetTime) return 0;
    const daylight = config.sunsetTime - config.sunriseTime;
    const noon = config.sunriseTime + daylight / 2;
    return Math.cos((Math.abs(hour - noon) / (daylight / 2)) * Math.PI / 2);
}

/**
 * Write a heat-ramp colour (blue → cyan → green → yellow → red) for a
 * temperature directly into an RGBA byte buffer. Writing in place avoids
 * allocating a throwaway `[r, g, b]` array for every pixel of the slice
 * texture (256×256 per repaint).
 *
 * Alpha is left untouched so the caller controls transparency.
 *
 * @param {Uint8ClampedArray} out - destination RGBA buffer
 * @param {number} offset - byte offset of the red channel
 * @param {number} t - temperature (°C)
 * @param {number} minT - low end of the colour scale (°C)
 * @param {number} maxT - high end of the colour scale (°C)
 */
export function writeHeatColor(out, offset, t, minT, maxT) {
    const norm = clamp01((t - minT) / (maxT - minT));
    // Hue sweeps 240° (blue) down to 0° (red).
    const h = ((1 - norm) * 240) / 60;
    const x = 1 - Math.abs((h % 2) - 1);

    let r, g, b;
    if (h < 1) { r = 1; g = x; b = 0; }
    else if (h < 2) { r = x; g = 1; b = 0; }
    else if (h < 3) { r = 0; g = 1; b = x; }
    else if (h < 4) { r = 0; g = x; b = 1; }
    else if (h < 5) { r = x; g = 0; b = 1; }
    else { r = 1; g = 0; b = x; }

    out[offset] = (r * 255) | 0;
    out[offset + 1] = (g * 255) | 0;
    out[offset + 2] = (b * 255) | 0;
}

/** Clamp a value into [0, 1] (NaN-safe, collapsing NaN to 0). */
function clamp01(v) {
    if (v <= 0 || Number.isNaN(v)) return 0;
    return v >= 1 ? 1 : v;
}

// ============================================================
// PSYCHROMETRICS (SI; pressures in kPa, humidity ratio in kg/kg)
// ============================================================

/** Standard atmospheric pressure, kPa. */
export const P_ATM = 101.325;

/** Saturation vapor pressure (Tetens), kPa, for T in °C. */
export function satVaporPressure(T) {
    return 0.6108 * Math.exp((17.27 * T) / (T + 237.3));
}

/** Humidity ratio (kg water / kg dry air) from temperature + relative humidity. */
export function humidityRatioFromRH(T, rh) {
    const e = satVaporPressure(T) * rh / 100;
    return (0.622 * e) / (P_ATM - e);
}

/** Relative humidity (%) from temperature + humidity ratio, clamped to [0, 100]. */
export function rhFromHumidityRatio(T, w) {
    const e = (w * P_ATM) / (0.622 + w);
    const rh = (100 * e) / satVaporPressure(T);
    return rh < 0 ? 0 : (rh > 100 ? 100 : rh);
}

/** Dew-point temperature (°C) of air with humidity ratio w. */
export function dewPoint(w) {
    const e = Math.max((w * P_ATM) / (0.622 + w), 1e-6);
    const ln = Math.log(e / 0.6108);
    return (237.3 * ln) / (17.27 - ln);
}

/** Vapor-pressure deficit (kPa) — the dryness "driving force" growers track. */
export function vaporPressureDeficit(T, w) {
    const e = (w * P_ATM) / (0.622 + w);
    return Math.max(satVaporPressure(T) - e, 0);
}

// ============================================================
// CANOPY GEOMETRY — shared by rendering, thermal sources and CFD drag
// ============================================================

/** Bench/plant layout derived from the greenhouse dimensions. */
export function canopyLayout() {
    const W = config.greenhouseWidth, L = config.greenhouseLength;
    return {
        stripCenters: [-W / 4, W / 4],  // two bench rows with a centre aisle
        stripHalfWidth: W / 7,
        halfLength: (L / 2) * 0.78,
        benchY: 0.8,                    // bench-top height (m)
        yLow: 0.85,                     // foliage band (m)
        yHigh: 1.55,
    };
}

/** True when (wx, wz) lies over a bench (used for floor shading). */
export function inCanopyFootprint(wx, wz) {
    if (!config.showCanopy) return false;
    const c = canopyLayout();
    if (Math.abs(wz) > c.halfLength) return false;
    return Math.abs(wx - c.stripCenters[0]) < c.stripHalfWidth
        || Math.abs(wx - c.stripCenters[1]) < c.stripHalfWidth;
}

/** True when the world point lies inside the foliage volume. */
export function inCanopy(wx, wy, wz) {
    if (!config.showCanopy) return false;
    const c = canopyLayout();
    if (wy < c.yLow || wy > c.yHigh) return false;
    return inCanopyFootprint(wx, wz);
}
