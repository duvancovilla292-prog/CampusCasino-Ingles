/* CASINO CAMPUS — Slot machine.
   Classic <script> (not an ES module): top-level consts are shared with the other files
   through the page's global scope, so the load order in index.html matters. */
"use strict";

/* =========================================================================
   9. SLOT MACHINE
   ========================================================================= */
const Slots = {
    SYMBOLS: ["\u{1F352}", "\u{1F34B}", "\u{1F514}", "\u2B50", "7\uFE0F\u20E3", "\u{1F347}"],
    /** Total return (stake included). 6 equally likely symbols: 12x and 1.5x give a 95.8% RTP. */
    PAY_THREE: 12,
    PAY_TWO: 1.5,
    isSpinning: false,
    visible: [],
    raf: 0,

    init() {
        if (DOM.btnSlotsSpin) DOM.btnSlotsSpin.addEventListener("click", () => this.spin());
        if (DOM.btnSlotsLever) DOM.btnSlotsLever.addEventListener("click", () => this.spin());
        if (DOM.reels) {
            this.visible = DOM.reels.map(() => [this.randomSymbol(), this.randomSymbol(), this.randomSymbol()]);
            DOM.reels.forEach((reel, i) => this.paint(i, this.visible[i]));
        }
    },

    randomSymbol() { return this.SYMBOLS[Math.floor(Rng.float() * this.SYMBOLS.length)]; },

    paint(i, symbols) {
        if (!DOM.reels || !DOM.reels[i]) return;
        const strip = DOM.reels[i].querySelector(".sm-strip");
        if (!strip) return;
        strip.textContent = "";
        symbols.forEach((sym, k) => {
            const d = document.createElement("div");
            d.className = "sm-sym" + (k === 1 ? " is-mid" : "");
            d.textContent = sym;
            strip.appendChild(d);
        });
        strip.style.transform = "translate3d(0,0,0)";
    },

    spin() {
        if (this.isSpinning || !DOM.reels) return;
        const bet = Validate.parseBet(DOM.inputSlotsBet);
        if (bet === null) return;

        State.debit(bet);
        this.isSpinning = true;
        if (DOM.btnSlotsSpin) DOM.btnSlotsSpin.disabled = true;
        if (DOM.btnSlotsLever) {
            DOM.btnSlotsLever.disabled = true;
            DOM.btnSlotsLever.classList.add("lever-pulled");
            window.setTimeout(() => DOM.btnSlotsLever.classList.remove("lever-pulled"), 260);
        }
        if (DOM.slotsResult) DOM.slotsResult.textContent = "";
        DOM.reels.forEach((r) => r.classList.remove("is-win", "is-locked"));
        Sound.click && Sound.click();

        const results = [this.randomSymbol(), this.randomSymbol(), this.randomSymbol()];
        this.animate(results).then(() => this.resolveSpin(bet, results));
    },

    animate(results) {
        const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        const H = (DOM.reels[0] && DOM.reels[0].clientHeight / 3) || 76;
        const V0 = 1.9, ACC = 260, DEC = 760, OVER = H * 0.22, WIND = 150, SPRING = 480;
        if (DOM.reels[0] && DOM.reels[0].parentElement) DOM.reels[0].parentElement.classList.add("is-spinning");

        const reels = DOM.reels.map((reel, i) => {
            const strip = reel.querySelector(".sm-strip"), streak = reel.querySelector(".sm-streak");
            const cruise0 = (reduce ? 120 : 520 + i * 460);
            const decDist = V0 * DEC / 3, accDist = V0 * ACC / 2;
            const rows = Math.ceil((accDist + decDist + cruise0 * V0) / H);
            const F = rows * H, target = F + OVER;
            const cruise = Math.max(0, (target - accDist - decDist) / V0);
            const n = rows + 4, items = new Array(n);
            items[0] = this.randomSymbol();
            for (let k = 1; k < n - 3; k += 1) items[k] = this.randomSymbol();
            const fin = [this.randomSymbol(), results[i], this.randomSymbol()];
            items[1] = fin[0]; items[2] = fin[1]; items[3] = fin[2];
            if (this.visible[i]) this.visible[i].forEach((sym, k) => { items[n - 3 + k] = sym; });
            strip.textContent = "";
            items.forEach((sym, k) => {
                const d = document.createElement("div");
                d.className = "sm-sym" + (k === 2 ? " is-mid" : "");
                d.textContent = sym;
                strip.appendChild(d);
            });
            this.visible[i] = fin;
            return {
                i, reel, strip, streak, F, target, base: (n - 3) * H, n, H, accDist, decDist, cruise,
                tWind: WIND, tAcc: ACC, tDec: DEC, done: false, pos: 0, lastRow: -1
            };
        });

        const posAt = (r, t) => {
            if (t < r.tWind) return -14 * Math.sin((t / r.tWind) * Math.PI / 2);
            let u = t - r.tWind;
            const wound = -14;
            if (u < r.tAcc) return wound * (1 - u / r.tAcc) + V0 * u * u / (2 * r.tAcc);
            u -= r.tAcc;
            if (u < r.cruise) return r.accDist + V0 * u;
            u -= r.cruise;
            const start = r.accDist + V0 * r.cruise;
            if (u < r.tDec) { const q = u / r.tDec; return start + r.decDist * (1 - Math.pow(1 - q, 3)); }
            u -= r.tDec;
            const s = Math.min(1, u / SPRING);
            return r.F + OVER * Math.exp(-5.2 * s) * Math.cos(9 * s) * (s >= 1 ? 0 : 1);
        };
        const endAt = (r) => r.tWind + r.tAcc + r.cruise + r.tDec + SPRING;

        return new Promise((resolve) => {
            const t0 = performance.now();
            let last = t0;
            const tick = (now) => {
                const t = now - t0, dt = Math.max(1, now - last);
                last = now;
                let all = true;
                reels.forEach((r) => {
                    if (r.done) return;
                    const te = endAt(r);
                    const pos = t >= te ? r.F : posAt(r, t);
                    const v = Math.abs(pos - r.pos) / dt;
                    r.pos = pos;
                    const y = Math.round((pos - r.base) * 100) / 100;
                    if (r.strip) r.strip.style.transform = `translate3d(0,${y}px,0)`;
                    const sp = Math.min(1, Math.max(0, (v - 0.35) / 1.2));
                    if (r.streak) r.streak.style.opacity = sp.toFixed(2);
                    if (r.strip) r.strip.style.opacity = (1 - 0.35 * sp).toFixed(2);
                    const row = Math.floor(pos / r.H);
                    if (r.i === 0 && row !== r.lastRow && v > 0.3) { Sound.tick && Sound.tick(row); }
                    r.lastRow = row;
                    if (t >= te) {
                        r.done = true;
                        if (r.strip) {
                            r.strip.style.transform = `translate3d(0,${-(r.base - r.F)}px,0)`;
                            r.strip.style.opacity = "1";
                        }
                        if (r.streak) r.streak.style.opacity = "0";
                        if (r.reel) r.reel.classList.add("is-locked");
                        Sound.tone && Sound.tone(150, 70, "triangle", 0.07);
                    } else all = false;
                });
                if (all) {
                    if (DOM.reels[0] && DOM.reels[0].parentElement) DOM.reels[0].parentElement.classList.remove("is-spinning");
                    reels.forEach((r) => this.paint(r.i, this.visible[r.i]));
                    resolve();
                } else this.raf = window.requestAnimationFrame(tick);
            };
            this.raf = window.requestAnimationFrame(tick);
        });
    },

    resolveSpin(bet, results) {
        const [a, b, c] = results;
        let payout = 0;
        if (a === b && b === c) payout = bet * this.PAY_THREE;
        else if (a === b || b === c || a === c) payout = Math.floor(bet * this.PAY_TWO);

        if (DOM.slotsResult) {
            if (payout > 0) {
                DOM.reels.forEach((reel, i) => {
                    const hit = (a === b && b === c) || results.filter((x) => x === results[i]).length > 1;
                    if (hit) reel.classList.add("is-win");
                });
                DOM.slotsResult.textContent = `${results.join(" ")} \u2014 Winning match! You won ${payout} chips.`;
                Notify.success(`Slots: won ${payout} chips.`);
                Sound.win && Sound.win();
                if (a === b && b === c) Effects.celebrate(`JACKPOT! +${payout} chips`);
            } else {
                DOM.slotsResult.textContent = `${results.join(" ")} \u2014 No match. Lost ${bet} chips.`;
                Notify.error(`Slots: lost ${bet} chips.`);
                Sound.lose && Sound.lose();
            }
        }

        resolveGameOutcome("slots", { entries: [{ wager: bet, payout }] });
        this.isSpinning = false;
        if (DOM.btnSlotsSpin) DOM.btnSlotsSpin.disabled = false;
        if (DOM.btnSlotsLever) DOM.btnSlotsLever.disabled = false;
    }
};
