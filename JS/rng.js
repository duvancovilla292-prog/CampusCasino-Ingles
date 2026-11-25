/* =========================================================================
   CASINO CAMPUS — SHARED RANDOM SOURCE
   Every game draws its randomness (shuffles, dice, wheels, room codes...) from Rng
   instead of Math.random(). Rng is backed by crypto.getRandomValues(), so results
   cannot be predicted from earlier ones the way Math.random() output sometimes can.
   It falls back to Math.random() where Web Crypto is missing (old browsers, tests).

   Note: each client still decides its own outcomes. A player who edits the page's
   JavaScript can still cheat; only a trusted server (or Cloud Functions) can stop that.
   Load order: first — the other files use Rng at runtime.
   ========================================================================= */
"use strict";

const Rng = (() => {
    const source = typeof crypto !== "undefined" && crypto && typeof crypto.getRandomValues === "function" ? crypto : null;
    const pool = new Uint32Array(256);
    let next = pool.length;

    /** Uniform float in [0, 1), like Math.random(). */
    function float() {
        if (!source) return Math.random();
        if (next >= pool.length) { source.getRandomValues(pool); next = 0; }
        return pool[next++] / 4294967296;
    }

    return {
        float,
        /** Integer in [0, n). */
        int(n) { return Math.floor(float() * n); },
        /** Random element of an array. */
        pick(list) { return list[Math.floor(float() * list.length)]; }
    };
})();
