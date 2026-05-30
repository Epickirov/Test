/**
 * The on-screen info panel. Reads state from the physics subsystems and writes
 * it into the DOM. Element references are cached once at construction so the
 * per-frame update avoids repeated `getElementById` lookups.
 */
import { config } from './config.js';
import { calculateDayFactor } from './utils.js';

export class Hud {
    /**
     * @param {import('./thermalField.js').ThermalField} thermalField
     * @param {import('./evaporativeCooling.js').EvaporativeCooling} evaporativeCooling
     * @param {import('./environment.js').Environment} environment
     * @param {import('./particleSystem.js').ParticleSystem} particleSystem
     */
    constructor(thermalField, evaporativeCooling, environment, particleSystem) {
        this.thermal = thermalField;
        this.evap = evaporativeCooling;
        this.env = environment;
        this.particles = particleSystem;

        const ids = [
            'temp', 'time', 'humidity', 'lux', 'active-particles', 'outside-temp-value',
            'db-temp', 'wb-temp', 'pad-eff', 'pad-outlet', 'wb-badge',
            'cool-zone-temp', 'mid-zone-temp', 'exhaust-zone-temp', 'delta-temp',
            'pad-velocity', 'fan-velocity', 'scale-min', 'scale-max',
        ];
        this.el = {};
        for (const id of ids) this.el[id] = document.getElementById(id);
    }

    update() {
        const el = this.el;
        const { outsideTemperature, currentTime } = this.env;

        // ---- Zone temperatures from the thermal field (mid-height band) ----
        const zones = this._averageZoneTemps();

        // ---- Global readouts ----
        el['temp'].textContent = zones.global.toFixed(1);
        el['time'].textContent = formatClock(currentTime);
        el['humidity'].textContent = Math.round(config.airHumidity);
        el['lux'].textContent = Math.round(calculateDayFactor(currentTime) * config.maxLux).toLocaleString();
        el['active-particles'].textContent = this.particles.countActiveInside();
        el['outside-temp-value'].textContent = outsideTemperature.toFixed(1);

        // ---- Evaporative cooling ----
        el['db-temp'].textContent = outsideTemperature.toFixed(1);
        el['wb-temp'].textContent = this.evap.wetBulbTemp.toFixed(1);
        el['pad-eff'].textContent = (this.evap.effectiveness * 100).toFixed(0);
        el['pad-outlet'].textContent = this.evap.padOutletTemp.toFixed(1);
        this._updateBadge(this.evap.padOutletTemp);

        // ---- Zones ----
        el['cool-zone-temp'].textContent = zones.cool.toFixed(1);
        el['mid-zone-temp'].textContent = zones.mid.toFixed(1);
        el['exhaust-zone-temp'].textContent = zones.exhaust.toFixed(1);
        el['delta-temp'].textContent = (zones.exhaust - zones.cool).toFixed(1);

        // ---- Velocities ----
        const padArea = config.greenhouseWidth * config.coolingPadHeight;
        const fanArea = Math.PI * 0.49 * config.fanCount;
        const fanVel = 8.0 * config.fanSpeed;
        el['pad-velocity'].textContent = ((fanArea / padArea) * fanVel).toFixed(2);
        el['fan-velocity'].textContent = fanVel.toFixed(2);

        // ---- Scale legend ----
        el['scale-min'].textContent = config.scaleMin.toFixed(0);
        el['scale-max'].textContent = config.scaleMax.toFixed(0);
    }

    /**
     * Average the thermal field over a mid-height band, split into cooling /
     * centre / exhaust thirds along the airflow axis.
     */
    _averageZoneTemps() {
        const fallback = this.env.outsideTemperature;
        if (!this.thermal.field) {
            return { global: fallback, cool: fallback, mid: fallback, exhaust: fallback };
        }

        const { x: rx, y: ry, z: rz } = this.thermal.res;
        const field = this.thermal.field;
        const z1 = Math.floor(rz / 3);
        const z2 = Math.floor(2 * rz / 3);
        const yStart = Math.floor(ry * 0.2);
        const yEnd = Math.floor(ry * 0.7);

        let coolSum = 0, coolN = 0, midSum = 0, midN = 0, exhSum = 0, exhN = 0, gSum = 0, gN = 0;
        for (let z = 0; z < rz; z++) {
            for (let y = yStart; y < yEnd; y++) {
                for (let x = 1; x < rx - 1; x++) {
                    const T = field[this.thermal.idx(x, y, z)];
                    gSum += T; gN++;
                    if (z < z1) { coolSum += T; coolN++; }
                    else if (z < z2) { midSum += T; midN++; }
                    else { exhSum += T; exhN++; }
                }
            }
        }

        return {
            global: gN ? gSum / gN : fallback,
            cool: coolN ? coolSum / coolN : fallback,
            mid: midN ? midSum / midN : fallback,
            exhaust: exhN ? exhSum / exhN : fallback,
        };
    }

    /** Comfort badge tuned for Phalaenopsis (≤28 °C ideal). */
    _updateBadge(padOutletTemp) {
        const badge = this.el['wb-badge'];
        if (padOutletTemp <= 26) {
            badge.className = 'wb-badge wb-good';
            badge.textContent = 'EFFECTIVE';
        } else if (padOutletTemp <= 30) {
            badge.className = 'wb-badge wb-fair';
            badge.textContent = 'MARGINAL';
        } else {
            badge.className = 'wb-badge wb-poor';
            badge.textContent = 'OVERLOADED';
        }
    }
}

/** Format a fractional hour as HH:MM. */
function formatClock(hour) {
    const h = Math.floor(hour).toString().padStart(2, '0');
    const m = Math.floor((hour % 1) * 60).toString().padStart(2, '0');
    return `${h}:${m}`;
}
