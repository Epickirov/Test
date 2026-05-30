# Greenhouse Thermal Dynamics — Real-Time CFD

An interactive 3D visualization of airflow and heat transfer in a fan-and-pad
cooled greenhouse, built with [three.js](https://threejs.org/). It couples a
fluid solver, a 3D temperature field, and an evaporative-cooling model, and
renders the result as flowing particles, a thermal slice plane, and hot-spot
markers.

## Running

ES modules and the import map must be served over HTTP (they will not load from
a `file://` URL). From the project root:

```bash
python3 -m http.server 8000
# then open http://localhost:8000/
```

(or any static server — `npx serve`, etc.)

An internet connection is required: three.js, lil-gui and the fluid solver are
loaded from CDNs. If the fluid solver fails to load, the simulation still runs
with advection and buoyancy disabled (the temperature field continues to evolve
from its source and diffusion terms).

## Controls

- **Drag / scroll** — orbit and zoom the camera.
- **Reset** — re-seed particles, reset the clock and the thermal field.
- **Hide/Show Particles** — toggle the airflow particles and trails.
- **Thermal Slice** — show a cross-sectional heat map; the side panel chooses
  its orientation, position and opacity.
- **Hot-Spot Markers** — mark the hottest cells of the field.
- **Simulation Parameters** (top-right gear, lil-gui) — live-tune the structure,
  HVAC, environment, building thermal properties and simulation settings.

## Project structure

The simulation was refactored from a single ~1660-line HTML file into focused
ES modules:

```
index.html            Markup, import map, CDN script tags
styles.css            All styling
src/
  config.js           Tunable parameters + constants (the single source of truth)
  utils.js            Grid resolution, day-night curve, heat-ramp colour
  environment.js      Sky, sun + shadows, ground, day-night cycle, outside temp
  greenhouse.js       Glazing shell, frame, cooling pad, fans (+ blade/label updates)
  evaporativeCooling.js  Wet-bulb (Stull 2011) + pad-outlet model
  fluidField.js       Wrapper around the external fluid solver (obstacles, in/out flow)
  thermalField.js     3D temperature field: advection, diffusion, sources, buoyancy
  particleSystem.js   Instanced airflow particles + additive trails
  sliceView.js        Canvas-textured thermal slice plane
  hotSpots.js         Hottest-cell markers
  controlPanel.js     lil-gui parameter panel
  hud.js              Info-panel DOM readouts
  main.js             Orchestrator: renderer, subsystem wiring, animation loop
```

### Architecture

`main.js` owns a `GreenhouseSimulation` instance that constructs every subsystem
and runs the loop. State has a single clear owner and is read through references
rather than shared globals:

- `Environment` owns the clock and `outsideTemperature`.
- `EvaporativeCooling` owns the wet-bulb / pad-outlet values.
- `ThermalField` owns the temperature grid and the world↔grid sampling helpers.
- `FluidField` owns the velocity field and degrades to zero velocity when the
  solver is unavailable.

The fluid solver and thermal field share one grid resolution
(`computeGridResolution`) so velocities and temperatures stay index-aligned.
