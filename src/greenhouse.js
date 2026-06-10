/**
 * The greenhouse structure: glazing shell, frame, cooling pad and exhaust fans.
 *
 * Owns the THREE.Group containing all structural meshes and is responsible for
 * disposing them when the geometry is rebuilt (e.g. when dimensions change).
 */
import * as THREE from 'three';
import { config } from './config.js';
import { canopyLayout } from './utils.js';

export class Greenhouse {
    /** @param {THREE.Scene} scene */
    constructor(scene) {
        this.scene = scene;
        this.group = new THREE.Group();
        /** @type {THREE.Group[]} fan groups, in left-to-right creation order */
        this.fans = [];
        this.glassMaterial = null;
        this._condensing = false;
        this.build();
    }

    /** Tear down the current structure, releasing all GPU resources. */
    dispose() {
        this.group.traverse((obj) => {
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) {
                const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
                for (const m of materials) {
                    if (m.map) m.map.dispose();
                    m.dispose();
                }
            }
        });
        this.scene.remove(this.group);
        this.group = new THREE.Group();
        this.fans = [];
    }

    /** (Re)build the structure from the current config. */
    build() {
        this.dispose();

        const glassMat = new THREE.MeshPhysicalMaterial({
            color: 0xffffff, metalness: 0.1, roughness: 0.1, transmission: 0.9, ior: 1.5,
            thickness: 0.5, transparent: true, opacity: 1, side: THREE.DoubleSide,
        });
        this.glassMaterial = glassMat;
        this._condensing = false;

        const structureGeo = new THREE.BoxGeometry(
            config.greenhouseWidth, config.greenhouseHeight, config.greenhouseLength
        );
        const glassBox = new THREE.Mesh(structureGeo, glassMat);
        glassBox.position.y = config.greenhouseHeight / 2;
        glassBox.receiveShadow = true;
        glassBox.renderOrder = -1; // draw glass first so opaque interior layers correctly
        this.group.add(glassBox);

        const frameLines = new THREE.LineSegments(
            new THREE.EdgesGeometry(structureGeo),
            new THREE.LineBasicMaterial({ color: 0x333333, linewidth: 2 })
        );
        frameLines.position.copy(glassBox.position);
        this.group.add(frameLines);

        const pad = new THREE.Mesh(
            new THREE.BoxGeometry(0.3, config.coolingPadHeight, config.greenhouseWidth * 0.9),
            new THREE.MeshStandardMaterial({ color: 0x3a7bd5, roughness: 0.9 })
        );
        pad.position.set(0, config.coolingPadElevation + config.coolingPadHeight / 2, -config.greenhouseLength / 2);
        pad.rotation.y = Math.PI / 2;
        pad.castShadow = true;
        pad.receiveShadow = true;
        this.group.add(pad);

        this._createFans();
        this._createCanopy();
        this.scene.add(this.group);
    }

    /**
     * Fog the glazing when interior moisture condenses on the cold cover —
     * the classic misted-up greenhouse look.
     */
    setCondensation(on) {
        if (!this.glassMaterial || this._condensing === on) return;
        this._condensing = on;
        this.glassMaterial.roughness = on ? 0.45 : 0.1;
        this.glassMaterial.transmission = on ? 0.72 : 0.9;
    }

    /** Benches with instanced potted plants (the canopy the physics acts on). */
    _createCanopy() {
        if (!config.showCanopy) return;
        const cl = canopyLayout();

        const benchGeo = new THREE.BoxGeometry(cl.stripHalfWidth * 2, 0.07, cl.halfLength * 2);
        const benchMat = new THREE.MeshStandardMaterial({ color: 0x8a6f4d, roughness: 0.9 });
        const legGeo = new THREE.BoxGeometry(0.06, cl.benchY, 0.06);

        const cols = Math.max(2, Math.floor((cl.halfLength * 2) / 0.55));
        const rowOffsets = [-cl.stripHalfWidth * 0.45, cl.stripHalfWidth * 0.45];
        const plantCount = cl.stripCenters.length * rowOffsets.length * cols;

        const trunkGeo = new THREE.CylinderGeometry(0.02, 0.03, 0.22, 6);
        const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 1.0 });
        const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, plantCount);

        const foliageGeo = new THREE.IcosahedronGeometry(0.26, 1);
        const foliageMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 });
        const foliage = new THREE.InstancedMesh(foliageGeo, foliageMat, plantCount);
        foliage.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(plantCount * 3), 3);
        foliage.castShadow = true;
        foliage.receiveShadow = true;

        const dummy = new THREE.Object3D();
        const color = new THREE.Color();
        const spacing = (cl.halfLength * 2) / cols;
        let n = 0;

        for (const xc of cl.stripCenters) {
            const bench = new THREE.Mesh(benchGeo, benchMat);
            bench.position.set(xc, cl.benchY, 0);
            bench.castShadow = true;
            bench.receiveShadow = true;
            this.group.add(bench);

            for (const zEnd of [-cl.halfLength + 0.15, cl.halfLength - 0.15]) {
                for (const ox of [-cl.stripHalfWidth + 0.08, cl.stripHalfWidth - 0.08]) {
                    const leg = new THREE.Mesh(legGeo, benchMat);
                    leg.position.set(xc + ox, cl.benchY / 2, zEnd);
                    this.group.add(leg);
                }
            }

            for (const ox of rowOffsets) {
                for (let c = 0; c < cols; c++) {
                    const px = xc + ox + (Math.random() - 0.5) * 0.08;
                    const pz = -cl.halfLength + (c + 0.5) * spacing + (Math.random() - 0.5) * 0.1;

                    dummy.position.set(px, cl.benchY + 0.035 + 0.11, pz);
                    dummy.scale.setScalar(1);
                    dummy.rotation.set(0, 0, 0);
                    dummy.updateMatrix();
                    trunks.setMatrixAt(n, dummy.matrix);

                    const s = 0.85 + Math.random() * 0.4;
                    dummy.position.set(px, cl.benchY + 0.42 + (s - 1) * 0.1, pz);
                    dummy.scale.set(s, s * 0.85, s);
                    dummy.rotation.y = Math.random() * Math.PI;
                    dummy.updateMatrix();
                    foliage.setMatrixAt(n, dummy.matrix);

                    color.setHSL(0.31 + Math.random() * 0.05, 0.55 + Math.random() * 0.2, 0.28 + Math.random() * 0.1);
                    foliage.setColorAt(n, color);
                    n++;
                }
            }
        }

        this.group.add(trunks);
        this.group.add(foliage);
    }

    _createFans() {
        const fanSpacing = config.greenhouseWidth / (config.fanCount + 1);
        const casingMat = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.5, roughness: 0.5 });
        const bladeMat = new THREE.MeshStandardMaterial({ color: 0x111111 });

        for (let i = 1; i <= config.fanCount; i++) {
            const fanGroup = new THREE.Group();

            const casing = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.3, 32), casingMat);
            casing.rotation.x = Math.PI / 2;
            casing.castShadow = true;
            fanGroup.add(casing);

            const blades = [];
            for (let j = 0; j < 3; j++) {
                const blade = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.2, 0.05), bladeMat);
                blade.position.z = 0.1;
                blade.rotation.z = j * Math.PI * 2 / 3;
                blade.castShadow = true;
                fanGroup.add(blade);
                blades.push(blade);
            }

            fanGroup.position.set(
                -config.greenhouseWidth / 2 + i * fanSpacing,
                config.fanHeight,
                config.greenhouseLength / 2
            );

            const label = this._createFanLabel();
            fanGroup.add(label.sprite);
            fanGroup.userData = { type: 'fan', blades, label };

            this.group.add(fanGroup);
            this.fans.push(fanGroup);
        }
    }

    /** Build a canvas-backed sprite used to print the exhaust temperature. */
    _createFanLabel() {
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        ctx.font = 'bold 28px Arial';
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.fillText('--°C out', 128, 42);

        const texture = new THREE.CanvasTexture(canvas);
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true }));
        sprite.scale.set(3, 0.75, 1);
        sprite.position.set(0, -1.2, 0);

        return { canvas, ctx, sprite, texture };
    }

    /**
     * Spin the blades and refresh each fan's exhaust-temperature readout.
     * Called at the HUD cadence (a few times per second) rather than every
     * frame, matching the original update rate.
     *
     * @param {import('./thermalField.js').ThermalField} thermalField
     */
    update(thermalField) {
        const exhaustZ = config.greenhouseLength / 2 - 0.5;

        for (const fan of this.fans) {
            const t = thermalField.sampleTemperature(fan.position.x, config.fanHeight, exhaustZ);

            const { ctx, canvas, texture } = fan.userData.label;
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 28px Arial';
            ctx.textAlign = 'center';
            ctx.fillText(`${t.toFixed(1)}°C out`, 128, 42);
            texture.needsUpdate = true;

            for (const blade of fan.userData.blades) {
                blade.rotation.z += 0.2 * config.fanSpeed;
            }
        }
    }
}
