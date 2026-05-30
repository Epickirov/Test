/**
 * Airflow particles rendered as a single InstancedMesh, plus additive line
 * trails. Particles enter through the cooling pad, follow the fluid velocity
 * field, take on the local air temperature and exit through the fans.
 *
 * A free-list of inactive slots keeps top-up O(needed) rather than O(MAX).
 */
import * as THREE from 'three';
import { config, MAX_PARTICLES, TRAIL_LENGTH } from './config.js';

const PARTICLE_RADIUS = 0.08;

export class ParticleSystem {
    constructor(scene, fluidField, thermalField, greenhouse, environment, evaporativeCooling) {
        this.scene = scene;
        this.fluid = fluidField;
        this.thermal = thermalField;
        this.greenhouse = greenhouse;
        this.env = environment;
        this.evap = evaporativeCooling;

        this.instancedParticles = null;
        this.trailMesh = null;
        this.trailPositions = null;
        this.trailColors = null;

        this.particlesData = [];
        this.activeParticleCount = 0;
        this.freeParticleIndices = [];
        this.showing = true;

        // Reusable scratch objects (avoid per-frame allocation).
        this._dummy = new THREE.Object3D();
        this._color = new THREE.Color();
        this._flowVec = new THREE.Vector3();

        this.init();
    }

    init() {
        if (this.instancedParticles) {
            this.scene.remove(this.instancedParticles);
            this.instancedParticles.geometry.dispose();
            this.instancedParticles.material.dispose();
        }
        if (this.trailMesh) {
            this.scene.remove(this.trailMesh);
            this.trailMesh.geometry.dispose();
            this.trailMesh.material.dispose();
        }
        this.particlesData.length = 0;
        this.freeParticleIndices = [];

        this.instancedParticles = new THREE.InstancedMesh(
            new THREE.SphereGeometry(0.06, 8, 8),
            new THREE.MeshBasicMaterial({ color: 0xffffff }),
            MAX_PARTICLES
        );
        this.instancedParticles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.instancedParticles.instanceColor =
            new THREE.InstancedBufferAttribute(new Float32Array(MAX_PARTICLES * 3), 3);
        this.scene.add(this.instancedParticles);

        const segmentsPerTrail = TRAIL_LENGTH - 1;
        const totalVertices = MAX_PARTICLES * segmentsPerTrail * 2;
        this.trailPositions = new Float32Array(totalVertices * 3);
        this.trailColors = new Float32Array(totalVertices * 3);

        const trailGeo = new THREE.BufferGeometry();
        trailGeo.setAttribute('position', new THREE.BufferAttribute(this.trailPositions, 3).setUsage(THREE.DynamicDrawUsage));
        trailGeo.setAttribute('color', new THREE.BufferAttribute(this.trailColors, 3).setUsage(THREE.DynamicDrawUsage));
        this.trailMesh = new THREE.LineSegments(trailGeo, new THREE.LineBasicMaterial({
            vertexColors: true,
            transparent: true,
            opacity: 0.4,
            blending: THREE.AdditiveBlending,
        }));
        this.scene.add(this.trailMesh);

        this.createParticles();
    }

    /** Seed the pool: ~80% start inside, ~20% as incoming outside air. */
    createParticles() {
        this.activeParticleCount = config.particleCount;
        this.freeParticleIndices = [];

        for (let i = 0; i < MAX_PARTICLES; i++) {
            if (i < this.activeParticleCount) {
                this._initParticle(i, i < this.activeParticleCount * 0.8 ? 'inside' : 'outside');
            } else {
                this.particlesData[i] = { active: false };
                this.freeParticleIndices.push(i);
            }
        }
    }

    _initParticle(i, state) {
        const hw = config.greenhouseWidth / 2;
        const hl = config.greenhouseLength / 2;

        let x, y, z;
        if (state === 'outside' && config.showOutsideParticles) {
            x = (Math.random() - 0.5) * hw * 1.5;
            y = config.coolingPadElevation + (Math.random() * config.coolingPadHeight);
            z = -hl - 0.5 - Math.random() * 2.5;
        } else {
            x = (Math.random() - 0.5) * hw * 1.8;
            y = config.coolingPadElevation + (Math.random() * config.coolingPadHeight);
            z = -hl + 0.1 + (Math.random() * hl);
            state = 'inside';
        }

        this.particlesData[i] = {
            active: true,
            state,
            exiting: false,
            position: new THREE.Vector3(x, y, z),
            velocity: new THREE.Vector3(
                (Math.random() - 0.5) * 0.2,
                (Math.random() - 0.5) * 0.2,
                state === 'outside' ? Math.random() * 0.5 + 0.5 : Math.random() * 0.5 + 0.2
            ),
            temperature: state === 'outside' ? this.env.outsideTemperature : this.evap.padOutletTemp,
            trailHistory: Array.from({ length: TRAIL_LENGTH }, () => new THREE.Vector3(x, y, z)),
            trailUpdateCounter: 0,
        };
    }

    setVisible(visible) {
        this.showing = visible;
        this.instancedParticles.visible = visible;
        this.trailMesh.visible = visible && config.showParticleTrails;
    }

    /** Number of active particles currently inside the greenhouse. */
    countActiveInside() {
        let count = 0;
        for (let i = 0; i < MAX_PARTICLES; i++) {
            const p = this.particlesData[i];
            if (p && p.active && p.state === 'inside') count++;
        }
        return count;
    }

    update(deltaTime) {
        const hw = config.greenhouseWidth / 2;
        const hl = config.greenhouseLength / 2;
        const r = PARTICLE_RADIUS;
        const dummy = this._dummy;
        const color = this._color;
        const fans = this.greenhouse.fans;
        const padBottom = config.coolingPadElevation;
        const padTop = config.coolingPadElevation + config.coolingPadHeight;
        const drawTrails = this.showing && config.showParticleTrails;
        const useFluid = config.useFluidSimulation && this.fluid.available;

        let drawIndex = 0;
        let trailVertIndex = 0;

        // Top up active particles from the free list.
        while (this.freeParticleIndices.length > 0
            && (MAX_PARTICLES - this.freeParticleIndices.length) < this.activeParticleCount) {
            this._initParticle(this.freeParticleIndices.pop(), 'outside');
        }

        for (let i = 0; i < MAX_PARTICLES; i++) {
            const p = this.particlesData[i];
            if (!p || !p.active) continue;

            p.velocity.multiplyScalar(0.99);
            p.velocity.y -= 0.0001 * deltaTime;

            if (p.state === 'outside') {
                p.velocity.y += (((padBottom + padTop) / 2) - p.position.y) * 0.05 * deltaTime;
                p.velocity.x += (0 - p.position.x) * 0.02 * deltaTime;
                p.velocity.z += 0.1 * deltaTime;
                p.position.addScaledVector(p.velocity, deltaTime * 0.5);

                if (p.position.z > -hl) {
                    if (Math.abs(p.position.x) < hw && p.position.y > padBottom && p.position.y < padTop) {
                        p.state = 'inside';
                        p.temperature = this.evap.padOutletTemp;
                        p.position.z = -hl + r;
                    } else {
                        p.position.z = -hl - r;
                        p.velocity.z *= -0.5;
                    }
                }

                if (Math.abs(p.position.x) > hw * 2) { p.position.x = Math.sign(p.position.x) * hw * 2; p.velocity.x *= -0.5; }
                if (p.position.y > config.greenhouseHeight * 1.5) { p.position.y = config.greenhouseHeight * 1.5; p.velocity.y *= -0.5; }
                if (p.position.y < r) { p.position.y = r; p.velocity.y *= -0.5; }

            } else if (p.exiting) {
                p.position.addScaledVector(p.velocity, deltaTime * 0.5);
                if (p.position.z > hl + 4) {
                    p.active = false;
                    this.freeParticleIndices.push(i);
                }

            } else {
                // INSIDE: follow the fluid field, equilibrate to local air temp.
                if (useFluid) {
                    const fv = this.fluid.sampleVelocityAtWorld(p.position.x, p.position.y, p.position.z);
                    this._flowVec.set(
                        fv[0] * hw * 0.04,
                        fv[1] * config.greenhouseHeight * 0.04,
                        fv[2] * hl * 0.04
                    );
                    p.velocity.lerp(this._flowVec, 0.15);
                } else {
                    p.velocity.z += 0.1 * config.fanSpeed * deltaTime;
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
                        const distToFanCenter = Math.hypot(p.position.x - fan.position.x, p.position.y - fan.position.y);
                        const fanRadius = 0.7;
                        if (distToFanCenter < fanRadius && config.fanSpeed > 0) {
                            if (Math.random() < 0.9) {
                                p.exiting = true;
                                p.velocity.x = (fan.position.x - p.position.x) * 0.1;
                                p.velocity.y = (fan.position.y - p.position.y) * 0.1;
                                p.velocity.z = 2.0 * config.fanSpeed;
                                exited = true;
                                break;
                            }
                        } else if (distToFanCenter < fanRadius * 2.5 && config.fanSpeed > 0) {
                            p.velocity.x += (fan.position.x - p.position.x) * 0.05 * config.fanSpeed;
                            p.velocity.y += (fan.position.y - p.position.y) * 0.05 * config.fanSpeed;
                        }
                    }
                    if (!exited) {
                        p.position.z = hl - r;
                        p.velocity.z *= -0.5;
                    }
                }
            }

            // ---- Render this particle ----
            dummy.position.copy(p.position);
            dummy.updateMatrix();
            this.instancedParticles.setMatrixAt(drawIndex, dummy.matrix);

            const tRatio = THREE.MathUtils.clamp(
                (p.temperature - config.scaleMin) / (config.scaleMax - config.scaleMin), 0, 1
            );
            color.setHSL((1 - tRatio) * 0.66, 1.0, 0.5);
            this.instancedParticles.setColorAt(drawIndex, color);
            drawIndex++;

            if (drawTrails) {
                if (++p.trailUpdateCounter > 2) {
                    p.trailHistory.pop();
                    p.trailHistory.unshift(p.position.clone());
                    p.trailUpdateCounter = 0;
                }
                for (let j = 0; j < TRAIL_LENGTH - 1; j++) {
                    const pt1 = p.trailHistory[j];
                    const pt2 = p.trailHistory[j + 1];
                    const i1 = (trailVertIndex++) * 3;
                    this.trailPositions[i1] = pt1.x; this.trailPositions[i1 + 1] = pt1.y; this.trailPositions[i1 + 2] = pt1.z;
                    this.trailColors[i1] = color.r; this.trailColors[i1 + 1] = color.g; this.trailColors[i1 + 2] = color.b;
                    const i2 = (trailVertIndex++) * 3;
                    this.trailPositions[i2] = pt2.x; this.trailPositions[i2 + 1] = pt2.y; this.trailPositions[i2 + 2] = pt2.z;
                    this.trailColors[i2] = color.r; this.trailColors[i2 + 1] = color.g; this.trailColors[i2 + 2] = color.b;
                }
            }
        }

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
