/**
 * Markers that highlight the hottest regions of the thermal field. Each marker
 * is a solid core inside a wireframe shell so it reads clearly through the glass.
 *
 * Markers are kept stable: the threshold adapts to the field's actual mean and
 * spread (so they appear whenever there is a real hot region and stay hidden
 * when the field is uniform), and each marker tracks the nearest hot cell while
 * smoothly lerping its position and scale — so they glide instead of teleporting.
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
        this._tmp = new THREE.Vector3();

        this.group = new THREE.Group();
        this.group.visible = false;
        this.group.renderOrder = 1000;
        this.scene.add(this.group);

        const sphere = new THREE.SphereGeometry(0.3, 16, 12);
        for (let i = 0; i < MARKER_COUNT; i++) {
            const marker = new THREE.Group();
            marker.visible = false;
            marker.renderOrder = 1000;
            marker.scale.setScalar(0);
            marker.userData.scale = 0;

            const core = new THREE.Mesh(sphere, new THREE.MeshBasicMaterial({ color: 0xff3300, toneMapped: false }));
            core.renderOrder = 1000;
            marker.add(core);

            const shell = new THREE.Mesh(sphere, new THREE.MeshBasicMaterial({ color: 0xffaa00, wireframe: true, toneMapped: false }));
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

    /** Track and place markers on the hottest regions, smoothly. */
    update() {
        if (!this.group.visible || !this.thermal.field) return;
        const { x: rx, y: ry, z: rz } = this.thermal.res;
        const field = this.thermal.field;
        const hw = config.greenhouseWidth / 2;
        const hl = config.greenhouseLength / 2;

        // Field statistics (downsampled) → adaptive threshold.
        let sum = 0, count = 0, max = -Infinity;
        for (let z = 2; z < rz - 2; z += 2) {
            for (let y = 1; y < ry - 1; y += 2) {
                for (let x = 1; x < rx - 1; x += 2) {
                    const T = field[this.thermal.idx(x, y, z)];
                    sum += T; count++;
                    if (T > max) max = T;
                }
            }
        }
        const mean = count ? sum / count : 0;
        const spread = max - mean;
        const threshold = mean + 0.45 * spread;

        // Collect the hottest cells above the threshold (only if there is a real hot region).
        const candidates = [];
        if (spread > 0.4) {
            for (let z = 2; z < rz - 2; z += 2) {
                for (let y = 1; y < ry - 1; y += 2) {
                    for (let x = 1; x < rx - 1; x += 2) {
                        const T = field[this.thermal.idx(x, y, z)];
                        if (T > threshold) {
                            candidates.push({
                                T,
                                wx: (x + 0.5) / rx * config.greenhouseWidth - hw,
                                wy: (y + 0.5) / ry * config.greenhouseHeight,
                                wz: (z + 0.5) / rz * config.greenhouseLength - hl,
                            });
                        }
                    }
                }
            }
            candidates.sort((a, b) => b.T - a.T);
            candidates.length = Math.min(candidates.length, MARKER_COUNT);
        }

        // Assign each marker to the nearest unused candidate; lerp position + scale.
        const used = new Array(candidates.length).fill(false);
        const span = Math.max(0.1, max - threshold);
        for (const marker of this.group.children) {
            let best = -1, bestDist = Infinity;
            for (let i = 0; i < candidates.length; i++) {
                if (used[i]) continue;
                const c = candidates[i];
                const d = (marker.position.x - c.wx) ** 2 + (marker.position.y - c.wy) ** 2 + (marker.position.z - c.wz) ** 2;
                if (d < bestDist) { bestDist = d; best = i; }
            }

            if (best >= 0) {
                used[best] = true;
                const c = candidates[best];
                this._tmp.set(c.wx, c.wy, c.wz);
                if (marker.userData.scale < 0.05) marker.position.copy(this._tmp); // snap in on first appearance
                else marker.position.lerp(this._tmp, 0.08); // gentle tracking
                const target = 0.6 + THREE.MathUtils.clamp((c.T - threshold) / span, 0, 1) * 1.0;
                marker.userData.scale += (target - marker.userData.scale) * 0.12;
                marker.visible = true;
            } else {
                marker.userData.scale += (0 - marker.userData.scale) * 0.15;
                marker.visible = marker.userData.scale > 0.05;
            }
            marker.scale.setScalar(marker.userData.scale);
        }
    }
}
