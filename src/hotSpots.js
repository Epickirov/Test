/**
 * Markers that highlight the hottest cells of the thermal field. Each marker is
 * a solid core inside a wireframe shell so it reads clearly through the glass.
 */
import * as THREE from 'three';
import { config } from './config.js';

const MARKER_COUNT = 8;

export class HotSpots {
    /**
     * @param {THREE.Scene} scene
     * @param {import('./thermalField.js').ThermalField} thermalField
     */
    constructor(scene, thermalField) {
        this.scene = scene;
        this.thermal = thermalField;

        this.group = new THREE.Group();
        this.group.visible = false;
        this.group.renderOrder = 1000;
        this.scene.add(this.group);

        const sphere = new THREE.SphereGeometry(0.3, 16, 12);
        for (let i = 0; i < MARKER_COUNT; i++) {
            const marker = new THREE.Group();
            marker.visible = false;
            marker.renderOrder = 1000;

            const core = new THREE.Mesh(
                sphere,
                new THREE.MeshBasicMaterial({ color: 0xff3300, toneMapped: false })
            );
            core.renderOrder = 1000;
            marker.add(core);

            const shell = new THREE.Mesh(
                sphere,
                new THREE.MeshBasicMaterial({ color: 0xffaa00, wireframe: true, toneMapped: false })
            );
            shell.scale.setScalar(1.6);
            shell.renderOrder = 1001;
            marker.add(shell);

            this.group.add(marker);
        }
    }

    setVisible(visible) {
        this.group.visible = visible;
        if (visible) this.update();
    }

    /** Place markers on the hottest cells above the mid-scale threshold. */
    update() {
        if (!this.group.visible || !this.thermal.field) return;
        const { x: rx, y: ry, z: rz } = this.thermal.res;
        const field = this.thermal.field;

        // Downsampled candidate scan.
        const candidates = [];
        for (let z = 2; z < rz - 2; z += 2) {
            for (let y = 1; y < ry - 1; y += 2) {
                for (let x = 1; x < rx - 1; x += 2) {
                    candidates.push({ T: field[this.thermal.idx(x, y, z)], x, y, z });
                }
            }
        }
        candidates.sort((a, b) => b.T - a.T);

        const hw = config.greenhouseWidth / 2;
        const hl = config.greenhouseLength / 2;
        const threshold = config.scaleMin + (config.scaleMax - config.scaleMin) * 0.5;

        for (let i = 0; i < this.group.children.length; i++) {
            const marker = this.group.children[i];
            if (i < candidates.length && candidates[i].T > threshold) {
                const c = candidates[i];
                marker.position.set(
                    (c.x + 0.5) / rx * config.greenhouseWidth - hw,
                    (c.y + 0.5) / ry * config.greenhouseHeight,
                    (c.z + 0.5) / rz * config.greenhouseLength - hl
                );
                const normT = THREE.MathUtils.clamp(
                    (c.T - threshold) / Math.max(0.1, config.scaleMax - threshold), 0, 1
                );
                marker.scale.setScalar(0.6 + normT * 1.0);
                marker.visible = true;
            } else {
                marker.visible = false;
            }
        }
    }
}
