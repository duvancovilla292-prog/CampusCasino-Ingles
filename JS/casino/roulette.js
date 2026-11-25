/* CASINO CAMPUS — Roulette.
   Classic <script> (not an ES module): top-level consts are shared with the other files
   through the page's global scope, so the load order in index.html matters. */
"use strict";

/* =========================================================================
   8. ROULETTE
   ========================================================================= */
const Roulette = {
    RED_NUMBERS: new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]),
    selectedChip: 10,
    selection: null,
    isSpinning: false,
    wheelRotation: 0,
    WHEEL_ORDER: [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10,
        5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26],

    init() {
        this.buildWheel();
        this.buildNumberBoard();
        this.bindChipButtons();
        this.bindOutsideBets();
        if (DOM.btnRouletteSpin) DOM.btnRouletteSpin.addEventListener("click", () => this.spin());
        if (DOM.btnRouletteClear) DOM.btnRouletteClear.addEventListener("click", () => this.clearSelection());
        this.updateBetDisplay();
    },

    buildWheel() {
        const NS = "http://www.w3.org/2000/svg";
        const count = this.WHEEL_ORDER.length, step = 360 / count, cx = 100, cy = 100;
        const pt = (deg, r) => {
            const rad = (deg * Math.PI) / 180;
            return [(cx + r * Math.sin(rad)).toFixed(3), (cy - r * Math.cos(rad)).toFixed(3)];
        };
        const el = (name, attrs) => {
            const n = document.createElementNS(NS, name);
            Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, v));
            return n;
        };
        const svg = el("svg", { viewBox: "0 0 200 200", class: "roulette-wheel-svg", "aria-hidden": "true" });
        svg.appendChild(el("circle", { cx, cy, r: 100, fill: "#b8860b" }));
        const R1 = 95, R0 = 52;
        this.WHEEL_ORDER.forEach((number, i) => {
            const [ax, ay] = pt((i - 0.5) * step, R1), [bx, by] = pt((i + 0.5) * step, R1);
            const [cx2, cy2] = pt((i + 0.5) * step, R0), [dx, dy] = pt((i - 0.5) * step, R0);
            svg.appendChild(el("path", {
                d: `M ${dx} ${dy} L ${ax} ${ay} A ${R1} ${R1} 0 0 1 ${bx} ${by} L ${cx2} ${cy2} A ${R0} ${R0} 0 0 0 ${dx} ${dy} Z`,
                class: `rw-slice rw-${this.colorOf(number)}`, "data-n": String(number)
            }));
            const label = el("text", { x: cx, y: cy - 81, transform: `rotate(${(i * step).toFixed(4)} ${cx} ${cy})`, class: "rw-label" });
            label.textContent = String(number);
            svg.appendChild(label);
        });
        svg.appendChild(el("circle", { cx, cy, r: R0 - 2, fill: "#1a130a", stroke: "#e9c46a", "stroke-width": 2 }));
        svg.appendChild(el("circle", { cx, cy, r: 9, fill: "#e9c46a" }));
        if (DOM.rouletteWheel) {
            DOM.rouletteWheel.textContent = "";
            DOM.rouletteWheel.appendChild(svg);
        }
    },

    numberAtPointer(rotation) {
        const count = this.WHEEL_ORDER.length, step = 360 / count;
        const a = (((-rotation) % 360) + 360) % 360;
        return this.WHEEL_ORDER[Math.round(a / step) % count];
    },

    animateTo(from, to, ms, done) {
        const t0 = performance.now(), el = DOM.rouletteWheel;
        const tick = (now) => {
            const p = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - p, 4);
            this.wheelRotation = p < 1 ? from + (to - from) * e : to;
            if (el) el.style.transform = `rotate(${this.wheelRotation}deg)`;
            if (p < 1) window.requestAnimationFrame(tick); else done();
        };
        window.requestAnimationFrame(tick);
    },

    colorOf(number) {
        if (number === 0) return "green";
        return this.RED_NUMBERS.has(number) ? "red" : "black";
    },

    buildNumberBoard() {
        if (!DOM.rouletteNumbers) return;
        for (let number = 0; number <= 36; number += 1) {
            const cell = document.createElement("button");
            cell.type = "button";
            cell.className = "roulette-number-cell";
            cell.textContent = String(number);
            cell.dataset.number = String(number);

            const color = this.colorOf(number);
            if (color === "red") cell.classList.add("is-red");
            if (color === "black") cell.classList.add("is-black");

            cell.addEventListener("click", () => this.selectBet({ type: "number", value: number }, cell));
            DOM.rouletteNumbers.appendChild(cell);
        }
    },

    bindChipButtons() {
        if (!DOM.chipPanel) return;
        const chipButtons = DOM.chipPanel.querySelectorAll(".chip-btn");
        chipButtons.forEach((chip) => {
            chip.addEventListener("click", () => {
                chipButtons.forEach((c) => c.classList.remove("is-selected"));
                chip.classList.add("is-selected");
                this.selectedChip = Number.parseInt(chip.dataset.chipValue, 10);
                this.updateBetDisplay();
                Sound.click && Sound.click();
            });
        });
        chipButtons[0]?.classList.add("is-selected");
    },

    bindOutsideBets() {
        document.querySelectorAll(".roulette-color-bet").forEach((btn) => {
            btn.addEventListener("click", () => this.selectBet({ type: "color", value: btn.dataset.color }, btn));
        });
        document.querySelectorAll(".roulette-parity-bet").forEach((btn) => {
            btn.addEventListener("click", () => this.selectBet({ type: "parity", value: btn.dataset.parity }, btn));
        });
    },

    selectBet(selection, element) {
        if (this.isSpinning) return;
        document.querySelectorAll(".roulette-number-cell.is-selected").forEach((el) => el.classList.remove("is-selected"));
        document.querySelectorAll(".roulette-color-bet.is-active, .roulette-parity-bet.is-active")
            .forEach((el) => el.classList.remove("is-active"));

        element.classList.add(element.classList.contains("roulette-number-cell") ? "is-selected" : "is-active");
        this.selection = selection;
        this.updateBetDisplay();
        Sound.click && Sound.click();
    },

    clearSelection() {
        if (this.isSpinning) return;
        this.selection = null;
        document.querySelectorAll(".roulette-number-cell.is-selected").forEach((el) => el.classList.remove("is-selected"));
        document.querySelectorAll(".roulette-color-bet.is-active, .roulette-parity-bet.is-active")
            .forEach((el) => el.classList.remove("is-active"));
        this.updateBetDisplay();
        if (DOM.rouletteResult) DOM.rouletteResult.textContent = "";
    },

    updateBetDisplay() {
        if (!DOM.inputRouletteBet) return;
        if (!this.selection) {
            DOM.inputRouletteBet.value = `Selection: none (chip ${this.selectedChip})`;
            return;
        }
        const labels = { number: "number", color: "color", parity: "parity" };
        DOM.inputRouletteBet.value = `${labels[this.selection.type]}: ${this.selection.value} \u2014 chip ${this.selectedChip}`;
    },

    spin() {
        if (this.isSpinning) return;
        if (!this.selection) { Notify.error("Choose a number, color or parity before spinning."); return; }
        if (!BetLimits.ok("roulette", this.selectedChip)) return;
        if (!State.canAfford(this.selectedChip)) { Notify.error("You don't have enough chips for that bet."); return; }

        State.debit(this.selectedChip);
        this.isSpinning = true;
        if (DOM.btnRouletteSpin) DOM.btnRouletteSpin.disabled = true;
        if (DOM.rouletteResult) DOM.rouletteResult.textContent = "";
        if (DOM.rouletteWheel) DOM.rouletteWheel.querySelectorAll(".rw-win").forEach((n) => n.classList.remove("rw-win"));

        const count = this.WHEEL_ORDER.length, step = 360 / count;
        const slotIndex = Math.floor(Math.random() * count);
        const jitter = (Math.random() - 0.5) * step * 0.6;
        const cur = ((this.wheelRotation % 360) + 360) % 360;
        const target = (((-(slotIndex * step + jitter)) % 360) + 360) % 360;
        const delta = (((target - cur) % 360) + 360) % 360;
        const from = this.wheelRotation, to = from + 360 * 5 + delta;
        const reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        const winningNumber = this.numberAtPointer(to);

        this.animateTo(from, to, reduced ? 500 : 4600, () => {
            if (DOM.rouletteWheel) DOM.rouletteWheel.querySelector(`[data-n="${winningNumber}"]`)?.classList.add("rw-win");
            this.resolveSpin(winningNumber);
        });
    },

    resolveSpin(winningNumber) {
        const winningColor = this.colorOf(winningNumber);
        const bet = this.selectedChip;
        let payout = 0;

        if (this.selection.type === "number" && this.selection.value === winningNumber) {
            payout = bet * 36;
        } else if (this.selection.type === "color" && this.selection.value === winningColor) {
            payout = bet * 2;
        } else if (this.selection.type === "parity" && winningNumber !== 0) {
            const isEven = winningNumber % 2 === 0;
            if ((this.selection.value === "even" && isEven) || (this.selection.value === "odd" && !isEven)) {
                payout = bet * 2;
            }
        }

        const colorLabels = { red: "red", black: "black", green: "green" };

        if (DOM.rouletteResult) {
            if (payout > 0) {
                DOM.rouletteResult.textContent = `Winning number ${winningNumber} (${colorLabels[winningColor]}). You won ${payout} chips!`;
                Notify.success(`Roulette: ${winningNumber} ${colorLabels[winningColor]}. Won ${payout} chips.`);
                Sound.win && Sound.win();
                if (payout >= CONFIG.BIG_WIN_THRESHOLD) Effects.celebrate(`STRAIGHT UP! +${payout} chips`);
            } else {
                DOM.rouletteResult.textContent = `Winning number ${winningNumber} (${colorLabels[winningColor]}). Lost ${bet} chips.`;
                Notify.error(`Roulette: ${winningNumber} ${colorLabels[winningColor]}. Lost ${bet} chips.`);
                Sound.lose && Sound.lose();
            }
        }

        resolveGameOutcome("roulette", { entries: [{ wager: bet, payout }] });
        this.isSpinning = false;
        if (DOM.btnRouletteSpin) DOM.btnRouletteSpin.disabled = false;
    }
};
