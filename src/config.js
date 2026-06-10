/**
 * Central, mutable configuration for the greenhouse simulation.
 *
 * Every subsystem imports this single object so the lil-gui panel can mutate
 * values live and have them picked up on the next frame. Keep this free of
 * behaviour — it is pure data.
 */
export const config = {
    // ---- Structure (metres) ----
    greenhouseLength: 12,
    greenhouseWidth: 6,
    greenhouseHeight: 3.5,

    // ---- HVAC ----
    fanCount: 2,
    fanSpeed: 0.5,
    fanHeight: 1.8,
    coolingPadHeight: 1.7,
    coolingPadElevation: 0.2,
    padEffectiveness: 0.85,        // typical for a well-maintained cellulose pad
    padWaterTemp: 20,              // pad supply-water temperature (°C); colder water → colder air

    // ---- Environment ----
    outsideTemp: 32,               // peak daytime (°C)
    outsideMinTemp: 18,            // overnight minimum (°C)
    airHumidity: 50,               // relative humidity (%)
    maxLux: 80000,
    sunriseTime: 6,
    sunsetTime: 18,

    // ---- Building thermal properties ----
    roofUValue: 6.0,               // W/m²·K, single-layer polyethylene-ish
    wallUValue: 5.0,
    solarGainCoefficient: 0.7,     // glazing solar transmittance (τ)
    coverEmissivity: 0.9,          // longwave emissivity of the glazing (sky radiation)
    floorAbsorptance: 0.85,        // fraction of transmitted solar absorbed at the floor

    // ---- Simulation ----
    simulationSpeed: 1,
    particleCount: 1500,           // air particles kept inside the greenhouse (conserved)
    showParticleTrails: true,
    useFluidSimulation: true,
    fluidResolution: 32,
    fluidIterations: 12,

    // ---- Thermal field ----
    thermalDiffusion: 0.08,        // m²/s effective (turbulent eddy diffusivity)

    // ---- Plant canopy ----
    showCanopy: true,              // benches with plants (transpiration, shading, flow drag)
    canopyTranspiration: 0.5,      // fraction of intercepted solar released as latent heat

    // ---- Visualization ----
    sliceAxis: 'z',
    sliceField: 't',               // 't' temperature | 'rh' relative humidity
    slicePosition: 0.5,
    sliceOpacity: 0.8,
    showSlice: false,
    showHotSpots: false,
    scaleMin: 10,                  // fixed temperature→colour scale (°C): blue = cold … red = hot
    scaleMax: 45,

    // ---- Airflow rendering ----
    smokeMode: false,              // render airflow as colored smoke instead of discrete particles
    smokeSize: 1.4,                // smoke puff size (sprite fallback) / density scale (volumetric)
    smokeOpacity: 0.7,
    showStreaklines: false,        // wind-tunnel streakline overlay (independent of particles/smoke)
    streaklineDensity: 1.0,        // how densely the streakline grid fills the greenhouse
};

/**
 * Size of the particle pool. Larger than the maximum interior population
 * (MAX_TARGET_PARTICLES) so there is always headroom for particles in transit
 * (being blown out of the fans) while the interior stays fully populated.
 */
export const MAX_PARTICLES = 7000;

/** Maximum interior population selectable in the GUI. */
export const MAX_TARGET_PARTICLES = 5000;

/** Number of history points retained per particle trail. */
export const TRAIL_LENGTH = 12;
