/**
 * Evaporative (wet-bulb) cooling model for the cellulose pad wall.
 */
import * as THREE from 'three';
import { config } from './config.js';

export class EvaporativeCooling {
    constructor() {
        this.wetBulbTemp = 20;        // °C
        this.padOutletTemp = 20;      // °C, air temperature leaving the pad
        this.effectiveness = 0.85;    // current pad ε after RH derating
    }

    /**
     * Stull (2011) empirical wet-bulb temperature.
     * Accurate to ~0.3 °C for relative humidity in 5–99 %.
     *
     * @param {number} tDryBulb - dry-bulb (ambient) temperature (°C)
     * @param {number} rh - relative humidity (%)
     * @returns {number} wet-bulb temperature (°C)
     */
    static wetBulb(tDryBulb, rh) {
        return tDryBulb * Math.atan(0.151977 * Math.sqrt(rh + 8.313659))
            + Math.atan(tDryBulb + rh)
            - Math.atan(rh - 1.676331)
            + 0.00391838 * Math.pow(rh, 1.5) * Math.atan(0.023101 * rh)
            - 4.686035;
    }

    /**
     * Update the cached wet-bulb, pad effectiveness and pad outlet temperature.
     *
     * Pad outlet = T_db − ε·(T_db − T_sink). Evaporation can cool the air to the
     * wet-bulb temperature; if the supply water is colder than the wet-bulb it
     * adds sensible cooling and the air approaches the water temperature, so the
     * sink is the colder of the two. Effectiveness is derated at very high
     * humidity (reduced driving force / wet-pad fouling).
     *
     * @param {number} tDryBulb - ambient dry-bulb temperature (°C)
     * @param {number} rh - relative humidity (%)
     * @returns {number} the new pad outlet temperature (°C)
     */
    update(tDryBulb, rh) {
        this.wetBulbTemp = EvaporativeCooling.wetBulb(tDryBulb, rh);

        const rhDerating = THREE.MathUtils.clamp(1.0 - Math.max(0, (rh - 70) / 60), 0.5, 1.0);
        this.effectiveness = config.padEffectiveness * rhDerating;

        const sink = Math.min(this.wetBulbTemp, config.padWaterTemp);
        this.padOutletTemp = tDryBulb - this.effectiveness * (tDryBulb - sink);
        return this.padOutletTemp;
    }
}
