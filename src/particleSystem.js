/**
 * Airflow visualization. The same particle simulation can be rendered two ways:
 *
 *   - "particles" — discrete instanced spheres with additive line trails,
 *   - "smoke"     — soft, colored, semi-transparent point sprites (a haze).
 *
 * Population model: the greenhouse interior holds a *conserved* number of
 * particles (`config.particleCount`) representing the air. Particles enter at
 * the cooling pad, follow the flow, take on the local air temperature, and are
 * blown out through the fans. Anything that exits (or otherwise leaves the
 * domain) is recycled, and any interior deficit is refilled at the pad every
 * frame — so the on-screen population stays constant regardless of throughput.
 *
 * A free-list of inactive slots keeps top-up O(needed) rather than O(MAX).
 */
import * as THREE from 'three';
import { config, MAX_PARTICLES, TRAIL_LENGTH } from './config.js';

const PARTICLE_RADIUS = 0.08;
const EXIT_DISTANCE = 1.5;        // how far past the fan an exiting particle travels before recycling

export class ParticleSystem {
    constructor(scene, thermalField, greenhouse, environment, evaporativeCooling) {
        this.scene = scene;
        this.thermal = thermalField;
        this.greenhouse = greenhouse;
        this.env = environment;
        this.evap = evaporativeCooling;

        // "particles" representation
        this.instancedParticles = null;
        this.trailMesh = null;
        this.trailPositions = null;
        this.trailColors = null;

        // "smoke" representation
        this.smokePoints = null;
        this.smokeGeometry = null;
        this.smokePositions = null;
        this.smokeColors = null;
        this.smokeMaterial = null;

        this.particlesData = [];
        this.freeParticleIndices = [];
        this.showing = true;

        // Reusable scratch objects (avoid per-frame allocation).
        this._dummy = new THREE.Object3D();
        this._color = new THREE.Color();
        this._flowVec = new THREE.Vector3();

        this.init();
    }

    init() {
        this._disposeRenderObjects();
        this.particlesData.length = 0;
        this.freeParticleIndices = [];

        // --- Particles: instanced spheres + additive trails ---
        this.instancedParticles = new THREE.InstancedMesh(
            new THREE.SphereGeometry(0.06, 8, 8),
            new THREE.MeshBasicMaterial({ color: 0xffffff }),
            MAX_PARTICLES
        );
        this.instancedParticles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.instancedParticles.instanceColor =
            new THREE.InstancedBufferAttribute(new Float32Array(MAX_PARTICLES * 3), 3);
        this.scene.add(this.instancedParticles);

        const totalVertices = MAX_PARTICLES * (TRAIL_LENGTH - 1) * 2;
        this.trailPositions = new Float32Array(totalVertices * 3);
        this.trailColors = new Float32Array(totalVertices * 3);
        const trailGeo = new THREE.BufferGeometry();
        trailGeo.setAttribute('position', new THREE.BufferAttribute(this.trailPositions, 3).setUsage(THREE.DynamicDrawUsage));
        trailGeo.setAttribute('color', new THREE.BufferAttribute(this.trailColors, 3).setUsage(THREE.DynamicDrawUsage));
        this.trailMesh = new THREE.LineSegments(trailGeo, new THREE.LineBasicMaterial({
            vertexColors: true, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending,
        }));
        this.scene.add(this.trailMesh);

        // --- Smoke: soft colored point sprites ---
        this.smokePositions = new Float32Array(MAX_PARTICLES * 3);
        this.smokeColors = new Float32Array(MAX_PARTICLES * 3);
        this.smokeGeometry = new THREE.BufferGeometry();
        this.smokeGeometry.setAttribute('position', new THREE.BufferAttribute(this.smokePositions, 3).setUsage(THREE.DynamicDrawUsage));
        this.smokeGeometry.setAttribute('color', new THREE.BufferAttribute(this.smokeColors, 3).setUsage(THREE.DynamicDrawUsage));
        this.smokeGeometry.setDrawRange(0, 0);
        this.smokeMaterial = new THREE.PointsMaterial({
            map: ParticleSystem._makeSmokeTexture(),
            size: config.smokeSize,
            sizeAttenuation: true,
            vertexColors: true,
            transparent: true,
            opacity: config.smokeOpacity,
            depthWrite: false,
            blending: THREE.NormalBlending,
        });
        this.smokePoints = new THREE.Points(this.smokeGeometry, this.smokeMaterial);
        this.scene.add(this.smokePoints);

        this.createParticles();
        this._applyVisibility();
    }

    _disposeRenderObjects() {
        for (const obj of [this.instancedParticles, this.trailMesh, this.smokePoints]) {
            if (!obj) continue;
            this.scene.remove(obj);
            obj.geometry.dispose();
            const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
            for (const m of mats) { if (m.map) m.map.dispose(); m.dispose(); }
        }
    }

    /** Soft radial-gradient sprite used for smoke puffs. */
    static _makeSmokeTexture() {
        const s = 64;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = s;
        const ctx = canvas.getContext('2d');
        const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
        g.addColorStop(0.0, 'rgba(255,255,255,1)');
        g.addColorStop(0.4, 'rgba(255,255,255,0.45)');
        g.addColorStop(1.0, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, s, s);
        return new THREE.CanvasTexture(canvas);
    }

    /** Seed the interior with the full population, distributed through the volume. */
    createParticles() {
        this.freeParticleIndices = [];
        const target = config.particleCount;
        for (let i = 0; i < MAX_PARTICLES; i++) {
            if (i < target) {
                this._spawnParticle(i, false);
            } else {
                this.particlesData[i] = { active: false };
                this.freeParticleIndices.push(i);
            }
        }
    }

    /**
     * (Re)initialise slot `i`.
     * @param {number} i
     * @param {boolean} atPad - true to enter at the cooling-pad inlet, false to
     *                          seed at a random point throughout the volume.
     */
    _spawnParticle(i, atPad) {
        const hl = config.greenhouseLength / 2;
        const r = PARTICLE_RADIUS;
        const padBottom = config.coolingPadElevation;

        let x, y, z, vz;
        if (atPad) {
            x = (Math.random() - 0.5) * config.greenhouseWidth * 0.9;
            y = padBottom + Math.random() * config.coolingPadHeight;
            z = -hl + r + Math.random() * 0.15;
            vz = 0.5 + Math.random() * 0.6;
        } else {
            x = (Math.random() - 0.5) * config.greenhouseWidth * 0.9;
            y = r + Math.random() * (config.greenhouseHeight - 2 * r);
            z = -hl + r + Math.random() * (config.greenhouseLength - 2 * r);
            vz = 0.2 + Math.random() * 0.4;
        }

        const position = new THREE.Vector3(x, y, z);
        this.particlesData[i] = {
            active: true,
            exiting: false,
            position,
            velocity: new THREE.Vector3((Math.random() - 0.5) * 0.2, (Math.random() - 0.5) * 0.2, vz),
            temperature: this.evap.padOutletTemp,
            trailHistory: Array.from({ length: TRAIL_LENGTH }, () => position.clone()),
            trailUpdateCounter: 0,
        };
    }

    setVisible(visible) {
        this.showing = visible;
        this._applyVisibility();
    }

    setSmokeMode(enabled) {
        config.smokeMode = enabled;
        this._applyVisibility();
    }

    _applyVisibility() {
        const smoke = config.smokeMode;
        this.instancedParticles.visible = this.showing && !smoke;
        this.trailMesh.visible = this.showing && !smoke && config.showParticleTrails;
        this.smokePoints.visible = this.showing && smoke;
    }

    /** Number of active particles currently inside the greenhouse (excludes those exiting). */
    countActiveInside() {
        let count = 0;
        for (let i = 0; i < MAX_PARTICLES; i++) {
            const p = this.particlesData[i];
            if (p && p.active && !p.exiting) count++;
        }
        return count;
    }

    update(deltaTime) {
        const hw = config.greenhouseWidth / 2;
        const hl = config.greenhouseLength / 2;
        const r = PARTICLE_RADIUS;
        const fans = this.greenhouse.fans;
        const smoke = config.smokeMode;
        const drawTrails = this.showing && !smoke && config.showParticleTrails;
        this.trailMesh.visible = drawTrails; // reflect the live GUI toggle

        const nearestFan = (px) => {
            let best = fans[0], bestDist = Infinity;
            for (const f of fans) {
                const d = Math.abs(px - f.position.x);
                if (d < bestDist) { bestDist = d; best = f; }
            }
            return best;
        };

        let drawIndex = 0;
        let trailVertIndex = 0;
        let insideCount = 0;

        for (let i = 0; i < MAX_PARTICLES; i++) {
            const p = this.particlesData[i];
            if (!p || !p.active) continue;

            p.velocity.multiplyScalar(0.99);
            p.velocity.y -= 0.0001 * deltaTime;

            if (p.exiting) {
                // Blown out of a fan — fly clear of the greenhouse, then recycle.
                p.position.addScaledVector(p.velocity, deltaTime * 0.5);
                if (p.position.z > hl + EXIT_DISTANCE) {
                    p.active = false;
                    this.freeParticleIndices.push(i);
                    continue;
                }
            } else {
                // Interior air: follow the flow and equilibrate to the local temperature.
                if (useFluid) {
                    const fv = this.fluid.sampleVelocityAtWorld(p.position.x, p.position.y, p.position.z);
                    this._flowVec.set(fv[0] * hw * 0.04, fv[1] * config.greenhouseHeight * 0.04, fv[2] * hl * 0.04);
                    p.velocity.lerp(this._flowVec, 0.15);
                } else {
                    // Fallback flow: forward drift + light turbulence, funnelling to the
                    // nearest fan in the rear half so particles reach an exit (no pile-up).
                    p.velocity.z += 0.1 * config.fanSpeed * deltaTime;
                    p.velocity.x += (Math.random() - 0.5) * 0.02 * deltaTime;
                    p.velocity.y += (Math.random() - 0.5) * 0.02 * deltaTime;
                    if (p.position.z > 0) {
                        const f = nearestFan(p.position.x);
                        p.velocity.x += (f.position.x - p.position.x) * 0.02 * config.fanSpeed * deltaTime;
                        p.velocity.y += (f.position.y - p.position.y) * 0.01 * config.fanSpeed * deltaTime;
                    }
                }

                const localT = this.thermal.sampleTemperature(p.position.x, p.position.y, p.position.z);
                p.temperature = p.temperature * 0.85 + localT * 0.15;

                p.position.addScaledVector(p.velocity, deltaTime * 0.5);

                if (p.position.x > hw - r) { p.position.x = hw - r; p.velocity.x = 0; p.velocity.z += 0.01; }
                if (p.position.x < -hw + r) { p.position.x = -hw + r; p.velocity.x = 0; p.velocity.z += 0.01; }
                if (p.position.y > config.greenhouseHeight - r) { p.position.y = config.greenhouseHeight - r; p.velocity.y = 0; }
                if (p.position.y < r) { p.position.y = r; p.velocity.y = 0; }
                if (p.position.z < -hl + r) { p.position.z = -hl + r; p.velocity.z = Math.abs(p.velocity.z) + 0.01; }

                if (p.position.z > hl - r) {
                    let exited = false;
                    for (const fan of fans) {
                        const distToFan = Math.hypot(p.position.x - fan.position.x, p.position.y - fan.position.y);
                        const fanRadius = 0.7;
                        if (distToFan < fanRadius && config.fanSpeed > 0) {
                            if (Math.random() < 0.9) {
                                p.exiting = true;
                                p.velocity.x = (fan.position.x - p.position.x) * 0.1;
                                p.velocity.y = (fan.position.y - p.position.y) * 0.1;
                                p.velocity.z = 2.0 * config.fanSpeed;
                                exited = true;
                                break;
                            }
                        } else if (distToFan < fanRadius * 2.5 && config.fanSpeed > 0) {
                            p.velocity.x += (fan.position.x - p.position.x) * 0.05 * config.fanSpeed;
                            p.velocity.y += (fan.position.y - p.position.y) * 0.05 * config.fanSpeed;
                        }
                    }
                    if (!exited) {
                        // Bounce off the exhaust wall and slide toward a fan so it can leave.
                        p.position.z = hl - r;
                        p.velocity.z *= -0.4;
                        const f = nearestFan(p.position.x);
                        p.velocity.x += Math.sign(f.position.x - p.position.x) * 0.3 * config.fanSpeed * deltaTime;
                        p.velocity.y += Math.sign(f.position.y - p.position.y) * 0.3 * config.fanSpeed * deltaTime;
                    }
                }

                if (!p.exiting) insideCount++;
            }

            this._renderParticle(p, drawIndex, smoke);

            if (drawTrails) {
                if (++p.trailUpdateCounter > 2) {
                    p.trailHistory.pop();
                    p.trailHistory.unshift(p.position.clone());
                    p.trailUpdateCounter = 0;
                }
                const c = this._color;
                for (let j = 0; j < TRAIL_LENGTH - 1; j++) {
                    const a = p.trailHistory[j], b = p.trailHistory[j + 1];
                    const i1 = (trailVertIndex++) * 3;
                    this.trailPositions[i1] = a.x; this.trailPositions[i1 + 1] = a.y; this.trailPositions[i1 + 2] = a.z;
                    this.trailColors[i1] = c.r; this.trailColors[i1 + 1] = c.g; this.trailColors[i1 + 2] = c.b;
                    const i2 = (trailVertIndex++) * 3;
                    this.trailPositions[i2] = b.x; this.trailPositions[i2 + 1] = b.y; this.trailPositions[i2 + 2] = b.z;
                    this.trailColors[i2] = c.r; this.trailColors[i2 + 1] = c.g; this.trailColors[i2 + 2] = c.b;
                }
            }

            drawIndex++;
        }

        // Conserve the interior population: refill any deficit as fresh air at the pad.
        let deficit = config.particleCount - insideCount;
        while (deficit > 0 && this.freeParticleIndices.length > 0) {
            const idx = this.freeParticleIndices.pop();
            this._spawnParticle(idx, true);
            this._renderParticle(this.particlesData[idx], drawIndex, smoke);
            drawIndex++;
            deficit--;
        }

        this._finalizeBuffers(smoke, drawIndex, trailVertIndex, drawTrails);
    }

    /** Write one particle's transform/colour into the active representation's buffers. */
    _renderParticle(p, drawIndex, smoke) {
        const tRatio = THREE.MathUtils.clamp(
            (p.temperature - config.scaleMin) / (config.scaleMax - config.scaleMin), 0, 1
        );
        this._color.setHSL((1 - tRatio) * 0.66, 1.0, 0.5);

        if (smoke) {
            const o = drawIndex * 3;
            this.smokePositions[o] = p.position.x;
            this.smokePositions[o + 1] = p.position.y;
            this.smokePositions[o + 2] = p.position.z;
            this.smokeColors[o] = this._color.r;
            this.smokeColors[o + 1] = this._color.g;
            this.smokeColors[o + 2] = this._color.b;
        } else {
            this._dummy.position.copy(p.position);
            this._dummy.updateMatrix();
            this.instancedParticles.setMatrixAt(drawIndex, this._dummy.matrix);
            this.instancedParticles.setColorAt(drawIndex, this._color);
        }
    }

    _finalizeBuffers(smoke, drawIndex, trailVertIndex, drawTrails) {
        if (smoke) {
            this.smokeGeometry.setDrawRange(0, drawIndex);
            this.smokeGeometry.attributes.position.needsUpdate = true;
            this.smokeGeometry.attributes.color.needsUpdate = true;
            this.smokeMaterial.size = config.smokeSize;
            this.smokeMaterial.opacity = config.smokeOpacity;
        } else {
            this.instancedParticles.count = drawIndex;
            this.instancedParticles.instanceMatrix.needsUpdate = true;
            this.instancedParticles.instanceColor.needsUpdate = true;
            if (drawTrails) {
                this.trailMesh.geometry.attributes.position.needsUpdate = true;
                this.trailMesh.geometry.attributes.color.needsUpdate = true;
                const usedFloats = trailVertIndex * 3;
                if (usedFloats < this.trailPositions.length) {
                    this.trailPositions.fill(0, usedFloats);
                }
            }
        }
    }
}
