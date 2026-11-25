/* CASINO CAMPUS — VIP Keno.
   Classic <script> (not an ES module): top-level consts are shared with the other files
   through the page's global scope, so the load order in index.html matters. */
"use strict";

/* =========================================================================
   7. VIP KENO ENGINE
   ========================================================================= */
const Keno = {
    selectedSpots: new Set(),
    drawnBalls: [],
    isDrawing: false,
    betAmount: 10,

    PAYTABLES: {
        1: { 1: 3 },
        2: { 2: 9 },
        3: { 2: 2, 3: 16 },
        4: { 2: 1, 3: 5, 4: 24 },
        5: { 3: 2, 4: 10, 5: 60 },
        6: { 3: 1, 4: 4, 5: 20, 6: 120 },
        7: { 4: 2, 5: 15, 6: 50, 7: 300 },
        8: { 4: 2, 5: 8, 6: 25, 7: 100, 8: 600 },
        9: { 5: 4, 6: 15, 7: 60, 8: 250, 9: 800 },
        10: { 0: 1, 5: 2, 6: 8, 7: 30, 8: 120, 9: 400, 10: 1000 }
    },

    $(id) { return document.getElementById(id); },

    init() {
        this.buildGrid();
        const btnPlay = this.$("btn-keno-play");
        const btnQuick = this.$("btn-keno-quick");
        const btnClear = this.$("btn-keno-clear");

        if (btnPlay) btnPlay.addEventListener("click", () => this.startDraw());
        if (btnQuick) btnQuick.addEventListener("click", () => this.quickPick());
        if (btnClear) btnClear.addEventListener("click", () => this.clearSelection());

        const chipsEl = this.$("keno-chips");
        if (chipsEl) {
            chipsEl.addEventListener("click", (e) => {
                const c = e.target.closest("[data-keno-chip]"); if (!c) return;
                const inp = this.$("input-keno-bet"); if (inp) inp.value = c.dataset.kenoChip;
                chipsEl.querySelectorAll("[data-keno-chip]").forEach((x) => x.classList.toggle("is-selected", x === c));
                Sound.click && Sound.click();
            });
        }
        this.updatePaytablePreview();
    },

    buildGrid() {
        const grid = this.$("keno-grid");
        if (!grid) return;
        grid.textContent = "";

        for (let i = 1; i <= 80; i += 1) {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "keno-num";
            btn.textContent = String(i);
            btn.dataset.num = String(i);

            btn.addEventListener("click", () => this.toggleSpot(i));
            grid.appendChild(btn);
        }
    },

    toggleSpot(num) {
        if (this.isDrawing) return;
        if (this.selectedSpots.has(num)) {
            this.selectedSpots.delete(num);
        } else {
            if (this.selectedSpots.size >= 10) {
                Notify.warning("Maximum 10 spots allowed.");
                return;
            }
            this.selectedSpots.add(num);
        }
        Sound.click && Sound.click();
        this.paintGrid();
        this.updatePaytablePreview();
    },

    quickPick() {
        if (this.isDrawing) return;
        this.selectedSpots.clear();
        while (this.selectedSpots.size < 10) {
            this.selectedSpots.add(1 + Math.floor(Math.random() * 80));
        }
        Sound.chip && Sound.chip();
        this.paintGrid();
        this.updatePaytablePreview();
    },

    clearSelection() {
        if (this.isDrawing) return;
        this.selectedSpots.clear();
        this.drawnBalls = [];
        this.paintGrid();
        this.updatePaytablePreview();
        const rack = this.$("keno-rack"); if (rack) rack.textContent = "";
        const blower = this.$("keno-blower"); if (blower) blower.querySelectorAll(".keno-blower-ball").forEach((b) => b.remove());
        const hitsCounter = this.$("keno-hits-count"); if (hitsCounter) hitsCounter.textContent = "0";
        const res = this.$("keno-result"); if (res) res.textContent = "";
    },

    paintGrid() {
        const grid = this.$("keno-grid");
        if (!grid) return;
        grid.querySelectorAll(".keno-num").forEach((btn) => {
            const n = Number(btn.dataset.num);
            const isSel = this.selectedSpots.has(n);
            const isDrawn = this.drawnBalls.includes(n);
            const isHit = isSel && isDrawn;

            btn.classList.toggle("selected", isSel);
            btn.classList.toggle("drawn", isDrawn);
            btn.classList.toggle("hit", isHit);
        });

        const badge = this.$("keno-spots-count");
        if (badge) badge.textContent = String(this.selectedSpots.size);
    },

    updatePaytablePreview() {
        const box = this.$("keno-paytable-list");
        if (!box) return;

        const count = this.selectedSpots.size;
        if (count === 0) {
            box.textContent = "Select 1 to 10 numbers to preview payouts.";
            return;
        }

        const table = this.PAYTABLES[count] || {};
        box.textContent = "";

        Object.keys(table).sort((a, b) => Number(b) - Number(a)).forEach((hits) => {
            const mult = table[hits];
            const row = document.createElement("div");
            row.className = "keno-pay-row";
            row.id = `keno-pay-row-${hits}`;
            row.innerHTML = `<span>${hits} Hits</span> <strong>${mult}x</strong>`;
            box.appendChild(row);
        });
    },

    async startDraw() {
        if (this.isDrawing) return;
        if (this.selectedSpots.size === 0) {
            Notify.warning("Select at least 1 spot before starting.");
            return;
        }

        const bet = Validate.parseBet(this.$("input-keno-bet"));
        if (bet === null) return;
        if (!BetLimits.ok("keno", bet)) return;
        if (!State.canAfford(bet)) return Notify.error("You don't have enough chips.");

        State.debit(bet);
        this.betAmount = bet;
        this.isDrawing = true;
        this.drawnBalls = [];

        const btnPlay = this.$("btn-keno-play");
        if (btnPlay) btnPlay.disabled = true;

        const rack = this.$("keno-rack"); if (rack) rack.textContent = "";
        const resEl = this.$("keno-result"); if (resEl) resEl.textContent = "";

        // Blower animation setup
        const pool = Array.from({ length: 80 }, (_, i) => i + 1);
        for (let i = pool.length - 1; i > 0; i -= 1) {
            const j = Math.floor(Math.random() * (i + 1));
            [pool[i], pool[j]] = [pool[j], pool[i]];
        }
        const winning20 = pool.slice(0, 20);

        const blower = this.$("keno-blower");
        let activeBlowerBall = null;

        for (let i = 0; i < 20; i += 1) {
            const ballNum = winning20[i];
            this.drawnBalls.push(ballNum);

            if (blower) {
                if (activeBlowerBall) activeBlowerBall.remove();
                activeBlowerBall = document.createElement("div");
                activeBlowerBall.className = "keno-blower-ball";
                activeBlowerBall.textContent = String(ballNum);
                blower.appendChild(activeBlowerBall);
            }

            if (rack) {
                const ballEl = document.createElement("div");
                const isHit = this.selectedSpots.has(ballNum);
                ballEl.className = "keno-rack-ball" + (isHit ? " is-hit" : "");
                ballEl.textContent = String(ballNum);
                rack.appendChild(ballEl);
            }

            this.paintGrid();

            const hitsCount = Array.from(this.selectedSpots).filter((n) => this.drawnBalls.includes(n)).length;
            const hitsCounter = this.$("keno-hits-count");
            if (hitsCounter) hitsCounter.textContent = String(hitsCount);

            Sound.tick && Sound.tick(ballNum);
            await new Promise((r) => window.setTimeout(r, 140));
        }

        if (activeBlowerBall) activeBlowerBall.remove();
        this.isDrawing = false;
        if (btnPlay) btnPlay.disabled = false;

        this.finishDraw();
    },

    finishDraw() {
        const count = this.selectedSpots.size;
        const hits = Array.from(this.selectedSpots).filter((n) => this.drawnBalls.includes(n)).length;
        const mult = (this.PAYTABLES[count] && this.PAYTABLES[count][hits]) || 0;
        const payout = this.betAmount * mult;

        const resEl = this.$("keno-result");
        if (resEl) {
            if (payout > 0) {
                resEl.textContent = `Matched ${hits} of ${count} spots! You won ${payout.toLocaleString("en-US")} chips! (${mult}x)`;
                Notify.success(`VIP Keno: ${hits} hits! Won ${payout.toLocaleString("en-US")} chips.`);
                Sound.win && Sound.win();
                if (payout >= CONFIG.BIG_WIN_THRESHOLD) Effects.celebrate(`KENO WIN! +${payout.toLocaleString("en-US")} chips`);
            } else {
                resEl.textContent = `Matched ${hits} of ${count} spots. Lost ${this.betAmount.toLocaleString("en-US")} chips.`;
                Notify.error(`VIP Keno: lost ${this.betAmount.toLocaleString("en-US")} chips.`);
                Sound.lose && Sound.lose();
            }
        }

        const activeRow = this.$(`keno-pay-row-${hits}`);
        if (activeRow) activeRow.classList.add("active-hit");

        resolveGameOutcome("keno", { entries: [{ wager: this.betAmount, payout }] });
    }
};
