/**
 * Outdoor environment: sky dome, sun (directional light + shadows), ambient
 * fill, ground plane, and the day-night cycle that drives outside temperature.
 */
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { config } from './config.js';
import { calculateDayFactor } from './utils.js';

export class Environment {
    /** @param {THREE.Scene} scene */
    constructor(scene) {
        this.scene = scene;
        this.currentTime = 12;          // hour of day in [0, 24)
        this.outsideTemperature = 30;   // °C, updated every frame

        this.sky = null;
        this.sun = null;
        this.ambient = null;

        this._build();
    }

    _build() {
        this.sky = new Sky();
        this.sky.scale.setScalar(10000);
        this.scene.add(this.sky);

        const skyUniforms = this.sky.material.uniforms;
        skyUniforms['turbidity'].value = 10;
        skyUniforms['rayleigh'].value = 2;
        skyUniforms['mieCoefficient'].value = 0.005;
        skyUniforms['mieDirectionalG'].value = 0.8;

        this.sun = new THREE.DirectionalLight(0xffffff, 2);
        this.sun.castShadow = true;
        this.sun.shadow.mapSize.width = 2048;
        this.sun.shadow.mapSize.height = 2048;
        this.sun.shadow.camera.near = 0.5;
        this.sun.shadow.camera.far = 150;
        this.sun.shadow.camera.left = -20;
        this.sun.shadow.camera.right = 20;
        this.sun.shadow.camera.top = 20;
        this.sun.shadow.camera.bottom = -20;
        this.sun.shadow.bias = -0.0005;
        this.scene.add(this.sun);

        this.ambient = new THREE.AmbientLight(0xffffff, 0.4);
        this.scene.add(this.ambient);

        const floor = new THREE.Mesh(
            new THREE.PlaneGeometry(200, 200),
            new THREE.MeshStandardMaterial({
                map: Environment._makeGrassTexture(),
                roughness: 0.95,
                metalness: 0.05,
            })
        );
        floor.rotation.x = -Math.PI / 2;
        floor.receiveShadow = true;
        this.scene.add(floor);
    }

    /** Procedural speckled-grass texture for the ground plane. */
    static _makeGrassTexture() {
        const size = 128;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#3b5a2a';
        ctx.fillRect(0, 0, size, size);
        const shades = ['#2f4d22', '#46682f', '#54763a', '#33531f', '#3f6128'];
        for (let i = 0; i < 900; i++) {
            ctx.fillStyle = shades[(Math.random() * shades.length) | 0];
            ctx.fillRect(Math.random() * size, Math.random() * size, 1 + Math.random() * 2, 1 + Math.random() * 2);
        }
        const tex = new THREE.CanvasTexture(canvas);
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(28, 28);
        tex.colorSpace = THREE.SRGBColorSpace;
        return tex;
    }

    /**
     * Advance the clock, reposition the sun, and recompute outside temperature.
     * @param {number} deltaTime - seconds (already scaled by the caller)
     */
    update(deltaTime) {
        const hourInc = deltaTime * config.simulationSpeed * (3600 / 5) / 3600;
        this.currentTime = (this.currentTime + hourInc) % 24;

        const phi = THREE.MathUtils.degToRad(90 - ((this.currentTime - 6) / 12 * 180));
        const theta = THREE.MathUtils.degToRad(180);
        const sunPos = new THREE.Vector3().setFromSphericalCoords(100, phi, theta);
        this.sky.material.uniforms['sunPosition'].value.copy(sunPos);
        this.sun.position.copy(sunPos);

        const dayFactor = calculateDayFactor(this.currentTime);
        this.sun.intensity = Math.max(0, dayFactor * 2);
        this.ambient.intensity = 0.08 + 0.32 * dayFactor; // night scenes actually get dark

        // outsideTemp is the user-set daytime peak. Air temperature lags solar
        // noon by ~2 h (ground/air thermal mass), so the daily peak lands at
        // ~14:00 like a real diurnal cycle, easing to the night minimum.
        const tempFactor = calculateDayFactor(((this.currentTime - 2) % 24 + 24) % 24);
        this.outsideTemperature = config.outsideTemp - (1 - tempFactor) * (config.outsideTemp - config.outsideMinTemp);
    }
}
