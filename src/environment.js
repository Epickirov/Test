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

        this.scene.add(new THREE.AmbientLight(0xffffff, 0.4));

        const floor = new THREE.Mesh(
            new THREE.PlaneGeometry(200, 200),
            new THREE.MeshStandardMaterial({ color: 0x2d4c1e, roughness: 0.8, metalness: 0.1 })
        );
        floor.rotation.x = -Math.PI / 2;
        floor.receiveShadow = true;
        this.scene.add(floor);
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

        // outsideTemp is the user-set daytime peak; the air cools toward the
        // night minimum as the sun drops. (At solar noon, outside == outsideTemp.)
        this.outsideTemperature = config.outsideTemp - (1 - dayFactor) * (config.outsideTemp - config.outsideMinTemp);
    }
}
