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
    solarGainCoefficient: 0.7,     // glazing transmittance

    // ---- Simulation ----
    simulationSpeed: 1,
    particleCount: 1500,           // air particles kept inside the greenhouse (conserved)
    showParticleTrails: true,
    useFluidSimulation: true,
    fluidResolution: 32,
    fluidIterations: 12,

    // ---- Thermal field ----
    thermalDiffusion: 0.08,        // m²/s effective (turbulent eddy diffusivity)

    // ---- Visualization ----
    sliceAxis: 'z',
    slicePosition: 0.5,
    sliceOpacity: 0.8,
    showSlice: false,
    showHotSpots: false,
    scaleMin: 15,                  // auto-tracked temperature scale (°C)
    scaleMax: 40,

    // ---- Airflow rendering ----
    smokeMode: false,              // render airflow as colored smoke instead of discrete particles
    smokeSize: 1.4,                // smoke puff size (world units) — large enough to overlap into a haze
    smokeOpacity: 0.5,
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
