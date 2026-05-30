/**
 * lil-gui parameter panel. Pure wiring: it binds `config` fields to controls
 * and invokes the supplied callbacks when a change requires rebuilding part of
 * the simulation.
 */
import GUI from 'lil-gui';
import { config, MAX_TARGET_PARTICLES } from './config.js';

/**
 * @param {object} callbacks
 * @param {() => void} callbacks.onStructureChange   - greenhouse geometry changed
 * @param {() => void} callbacks.onParticleCountChange
 * @param {() => void} callbacks.onResolutionChange   - grid resolution changed
 * @returns {GUI}
 */
export function createControlPanel({ onStructureChange, onParticleCountChange, onResolutionChange }) {
    // Narrower panel on small screens so it doesn't dominate a phone display.
    const width = window.innerWidth <= 768 ? Math.min(260, window.innerWidth - 24) : 300;
    const gui = new GUI({ title: 'Simulation Parameters', width });
    gui.close();

    const struct = gui.addFolder('Structure');
    struct.add(config, 'greenhouseLength', 5, 36).name('Length (m)').onFinishChange(onStructureChange);
    struct.add(config, 'greenhouseWidth', 3, 36).name('Width (m)').onFinishChange(onStructureChange);
    struct.add(config, 'greenhouseHeight', 2, 6).name('Height (m)').onFinishChange(onStructureChange);

    const equip = gui.addFolder('HVAC Equipment');
    equip.add(config, 'fanCount', 1, 8, 1).name('Fan Count').onFinishChange(onStructureChange);
    equip.add(config, 'fanSpeed', 0, 1).name('Fan Speed');
    equip.add(config, 'coolingPadHeight', 0.5, 3.5).name('Pad Height (m)').onFinishChange(onStructureChange);
    equip.add(config, 'coolingPadElevation', 0, 2.0).name('Pad Elevation (m)').onFinishChange(onStructureChange);
    equip.add(config, 'padEffectiveness', 0.3, 0.95).name('Pad ε (typ 0.85)');

    // Outside air temperature + humidity live in the on-screen Climate Controls panel.
    const env = gui.addFolder('Environment');
    env.add(config, 'outsideMinTemp', 5, 30).name('Night Min (°C)');
    env.add(config, 'maxLux', 10000, 120000, 1000).name('Peak LUX');

    const therm = gui.addFolder('Thermal Field');
    therm.add(config, 'thermalDiffusion', 0.001, 0.5).name('Eddy Diffusivity');
    therm.add(config, 'roofUValue', 1, 10).name('Roof U-value');
    therm.add(config, 'wallUValue', 1, 10).name('Wall U-value');
    therm.add(config, 'solarGainCoefficient', 0, 1).name('Solar Transmit (τ)');
    therm.add(config, 'coverEmissivity', 0.5, 1.0).name('Cover Emissivity');
    therm.add(config, 'scaleMin', -10, 30, 1).name('Colour Min (°C)');
    therm.add(config, 'scaleMax', 20, 60, 1).name('Colour Max (°C)');

    const sim = gui.addFolder('Simulation');
    sim.add(config, 'simulationSpeed', { 'Real-Time': 0.0014, '1X': 1, '5X': 5, '20X Fast': 20 }).name('Time Scale');
    sim.add(config, 'particleCount', 100, MAX_TARGET_PARTICLES, 100).name('Particle Count').onFinishChange(onParticleCountChange);
    sim.add(config, 'showParticleTrails').name('Particle Trails');
    sim.add(config, 'fluidResolution', { 'Low (24)': 24, 'Med (32)': 32, 'High (48)': 48 })
        .name('Field Resolution').onFinishChange(onResolutionChange);

    const vis = gui.addFolder('Smoke');
    vis.add(config, 'smokeSize', 0.3, 3.0).name('Puff Size');
    vis.add(config, 'smokeOpacity', 0.1, 1.0).name('Opacity');

    return gui;
}
