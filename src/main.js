/**
 * Entry point: builds the renderer, instantiates every subsystem, wires up the
 * DOM controls and drives the animation loop.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import { config } from './config.js';
import { Environment } from './environment.js';
import { Greenhouse } from './greenhouse.js';
import { EvaporativeCooling } from './evaporativeCooling.js';
import { FluidField } from './fluidField.js';
import { ThermalField } from './thermalField.js';
import { ParticleSystem } from './particleSystem.js';
import { SliceView } from './sliceView.js';
import { HotSpots } from './hotSpots.js';
import { SmokeVolume } from './smokeVolume.js';
import { Hud } from './hud.js';
import { createControlPanel } from './controlPanel.js';

/** Multiplier turning wall-clock seconds into simulation seconds. */
const PHYSICS_SCALE = 30;

class GreenhouseSimulation {
    constructor() {
        this._frame = 0;
        this._lastTimestamp = 0;
        this._sunDir = new THREE.Vector3();

        this._initRenderer();
        this._initSubsystems();
        this._wireDomControls();

        window.addEventListener('resize', () => this._onResize());

        this._animate = this._animate.bind(this);
        requestAnimationFrame(this._animate);
    }

    _initRenderer() {
        this.scene = new THREE.Scene();

        this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.set(15, 12, 15);

        this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 0.8;
        document.body.appendChild(this.renderer.domElement);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.maxPolarAngle = Math.PI / 2 - 0.05;
        this.controls.target.set(0, config.greenhouseHeight / 2, 0);
    }

    _initSubsystems() {
        this.environment = new Environment(this.scene);
        this.greenhouse = new Greenhouse(this.scene);
        this.evaporativeCooling = new EvaporativeCooling();
        this.fluidField = new FluidField();
        this.thermalField = new ThermalField(this.fluidField, this.evaporativeCooling, this.environment);
        this.particleSystem = new ParticleSystem(
            this.scene, this.fluidField, this.thermalField,
            this.greenhouse, this.environment, this.evaporativeCooling
        );
        this.sliceView = new SliceView(this.scene, this.thermalField);
        this.hotSpots = new HotSpots(this.scene, this.thermalField);
        this.smokeVolume = new SmokeVolume(this.scene, this.thermalField);
        this.hud = new Hud(this.thermalField, this.evaporativeCooling, this.environment, this.particleSystem);

        this.gui = createControlPanel({
            onStructureChange: () => this._rebuildStructure(),
            onParticleCountChange: () => this.particleSystem.createParticles(),
            onResolutionChange: () => {
                this.fluidField.init();
                this.thermalField.init();
                this.smokeVolume.init();
            },
        });
    }

    /** Rebuild everything that depends on greenhouse geometry. */
    _rebuildStructure() {
        this.greenhouse.build();
        this.thermalField.init();
        this.fluidField.init();
        this.sliceView.rebuildMesh();
        this.smokeVolume.init();
    }

    /** Switch between particle and smoke airflow rendering (volumetric, or sprite fallback). */
    _setSmoke(enabled) {
        config.smokeMode = enabled;
        if (this.smokeVolume.ok) {
            this.smokeVolume.setVisible(enabled);
            this.particleSystem.setVisible(!enabled);
        } else {
            this.particleSystem.setSmokeMode(enabled); // sprite fallback
        }
    }

    _wireDomControls() {
        document.getElementById('reset-simulation')
            .addEventListener('click', () => this.reset());

        const btnPart = document.getElementById('toggle-particles');
        btnPart.addEventListener('click', () => {
            const visible = !this.particleSystem.showing;
            this.particleSystem.setVisible(visible);
            btnPart.textContent = visible ? 'Hide Particles' : 'Show Particles';
        });

        const btnSmoke = document.getElementById('toggle-smoke');
        btnSmoke.addEventListener('click', () => {
            const smoke = !config.smokeMode;
            this._setSmoke(smoke);
            btnSmoke.classList.toggle('active', smoke);
            btnSmoke.textContent = smoke ? 'Particles' : 'Smoke';
        });

        const btnSlice = document.getElementById('toggle-slice');
        const slicePanel = document.getElementById('slice-control');
        btnSlice.addEventListener('click', () => {
            config.showSlice = !config.showSlice;
            btnSlice.classList.toggle('active', config.showSlice);
            slicePanel.classList.toggle('visible', config.showSlice);
            this.sliceView.setVisible(config.showSlice);
        });

        const btnIso = document.getElementById('toggle-iso');
        btnIso.addEventListener('click', () => {
            config.showHotSpots = !config.showHotSpots;
            btnIso.classList.toggle('active', config.showHotSpots);
            this.hotSpots.setVisible(config.showHotSpots);
        });

        document.getElementById('slice-axis')
            .addEventListener('change', (e) => this.sliceView.setAxis(e.target.value));

        document.getElementById('slice-pos').addEventListener('input', (e) => {
            this.sliceView.setPosition(e.target.value / 100);
            document.getElementById('slice-pos-label').textContent = `${e.target.value}%`;
        });

        document.getElementById('slice-opacity').addEventListener('input', (e) => {
            config.sliceOpacity = e.target.value / 100;
            document.getElementById('slice-op-label').textContent = `${e.target.value}%`;
            this.sliceView.setOpacity(config.sliceOpacity);
        });
    }

    reset() {
        this.particleSystem.createParticles();
        this.environment.currentTime = 12;
        this.thermalField.reset();
        this.fluidField.reset();
    }

    _onResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    _animate(timestamp) {
        requestAnimationFrame(this._animate);

        const dt = this._lastTimestamp ? Math.min((timestamp - this._lastTimestamp) / 1000, 0.05) : 0.016;
        this._lastTimestamp = timestamp;
        this._frame++;

        this.controls.update();
        this.environment.update(dt);

        const sdt = dt * PHYSICS_SCALE;
        this.fluidField.update(sdt);
        this.particleSystem.update(sdt);
        this.thermalField.update(sdt);

        if (config.smokeMode && this.smokeVolume.visible) {
            this._sunDir.copy(this.environment.sun.position);
            this.smokeVolume.update(sdt, this.camera, this._sunDir);
        }

        // Stagger the expensive visual/UI updates across frames.
        if (config.showSlice && this._frame % 2 === 0) this.sliceView.updateTexture();
        if (config.showHotSpots && this._frame % 6 === 0) this.hotSpots.update();
        if (this._frame % 3 === 0) {
            this.hud.update();
            this.greenhouse.update(this.thermalField);
        }

        this.renderer.render(this.scene, this.camera);
    }
}

// eslint-disable-next-line no-new
new GreenhouseSimulation();
