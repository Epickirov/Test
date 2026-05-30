/**
 * A planar heat-map slice through the thermal field, painted onto a canvas
 * texture. The slice can be oriented along any axis and slid through the
 * greenhouse. It also drives the auto-tracked temperature colour scale
 * (config.scaleMin / config.scaleMax) shared with the particles and legend.
 */
import * as THREE from 'three';
import { config } from './config.js';
import { writeHeatColor } from './utils.js';

const TEX_SIZE = 256;

export class SliceView {
    /**
     * @param {THREE.Scene} scene
     * @param {import('./thermalField.js').ThermalField} thermalField
     */
    constructor(scene, thermalField) {
        this.scene = scene;
        this.thermal = thermalField;

        this.canvas = document.createElement('canvas');
        this.canvas.width = TEX_SIZE;
        this.canvas.height = TEX_SIZE;
        this.ctx = this.canvas.getContext('2d');
        this.imageData = this.ctx.createImageData(TEX_SIZE, TEX_SIZE);

        this.texture = new THREE.CanvasTexture(this.canvas);
        this.texture.minFilter = THREE.LinearFilter;
        this.texture.magFilter = THREE.LinearFilter;

        // Sentinel so the plane is visibly "alive" before the first repaint.
        this.ctx.fillStyle = '#1e293b';
        this.ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
        this.ctx.fillStyle = '#00d4ff';
        this.ctx.font = 'bold 24px sans-serif';
        this.ctx.textAlign = 'center';
        this.ctx.fillText('Loading thermal field...', TEX_SIZE / 2, TEX_SIZE / 2);
        this.texture.needsUpdate = true;

        this.mesh = new THREE.Mesh(
            new THREE.PlaneGeometry(1, 1),
            new THREE.MeshBasicMaterial({
                map: this.texture,
                transparent: true,
                opacity: config.sliceOpacity,
                side: THREE.DoubleSide,
                depthWrite: true,
                depthTest: true,
                toneMapped: false, // colours are a data ramp, don't tone-map them
            })
        );
        this.mesh.visible = false;
        this.mesh.renderOrder = 999; // draw after the transmissive glass box
        this.scene.add(this.mesh);

        this.rebuildMesh();
    }

    setVisible(visible) {
        this.mesh.visible = visible;
        if (visible) {
            this.rebuildMesh();
            this.updateTexture(); // force an immediate paint
        }
    }

    setOpacity(opacity) {
        this.mesh.material.opacity = opacity;
    }

    setAxis(axis) {
        config.sliceAxis = axis;
        this.rebuildMesh();
    }

    setPosition(position01) {
        config.slicePosition = position01;
        this.rebuildMesh();
    }

    /** Position and orient the plane for the current axis / slice position. */
    rebuildMesh() {
        this.mesh.geometry.dispose();
        const W = config.greenhouseWidth;
        const L = config.greenhouseLength;
        const H = config.greenhouseHeight;

        if (config.sliceAxis === 'z') {
            // Longitudinal: XY plane sliding along Z.
            this.mesh.geometry = new THREE.PlaneGeometry(W, H);
            this.mesh.position.set(0, H / 2, (config.slicePosition - 0.5) * L);
            this.mesh.rotation.set(0, 0, 0);
        } else if (config.sliceAxis === 'x') {
            // Cross-section: YZ plane sliding along X.
            this.mesh.geometry = new THREE.PlaneGeometry(L, H);
            this.mesh.position.set((config.slicePosition - 0.5) * W, H / 2, 0);
            this.mesh.rotation.set(0, Math.PI / 2, 0);
        } else {
            // Horizontal: XZ plane sliding along Y.
            this.mesh.geometry = new THREE.PlaneGeometry(W, L);
            this.mesh.position.set(0, config.slicePosition * H, 0);
            this.mesh.rotation.set(-Math.PI / 2, 0, 0);
        }
    }

    /** Repaint the slice texture by sampling the thermal field per pixel. */
    updateTexture() {
        if (!config.showSlice || !this.thermal.field) return;

        const data = this.imageData.data;
        const W = config.greenhouseWidth;
        const L = config.greenhouseLength;
        const H = config.greenhouseHeight;

        // Fixed, absolute colour scale so colour means temperature (not relative rank).
        const sMin = config.scaleMin;
        const sMax = Math.max(config.scaleMax, config.scaleMin + 2);

        for (let py = 0; py < TEX_SIZE; py++) {
            for (let px = 0; px < TEX_SIZE; px++) {
                const u = px / (TEX_SIZE - 1);
                const v = py / (TEX_SIZE - 1);

                let wx, wy, wz;
                if (config.sliceAxis === 'z') {
                    wx = (u - 0.5) * W;
                    wy = (1 - v) * H;
                    wz = (config.slicePosition - 0.5) * L;
                } else if (config.sliceAxis === 'x') {
                    wz = (u - 0.5) * L;
                    wy = (1 - v) * H;
                    wx = (config.slicePosition - 0.5) * W;
                } else {
                    wx = (u - 0.5) * W;
                    wz = (v - 0.5) * L;
                    wy = config.slicePosition * H;
                }

                const t = this.thermal.sampleTemperature(wx, wy, wz);
                const idx = (py * TEX_SIZE + px) * 4;
                writeHeatColor(data, idx, t, sMin, sMax);
                data[idx + 3] = 230;
            }
        }

        this.ctx.putImageData(this.imageData, 0, 0);
        this.texture.needsUpdate = true;
    }
}
