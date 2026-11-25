/* CASINO CAMPUS — Quick Dice.
   Classic <script> (not an ES module): top-level consts are shared with the other files
   through the page's global scope, so the load order in index.html matters. */
"use strict";

/* =========================================================================
   13. QUICK DICE (High/Low)
   ========================================================================= */
const Dice = {
    d: { st: "idle" }, off: 0, shown: null, timer: 0, anim: 0,
    SIDES: { l: ["Low 2\u20136", 2.2], s: ["Lucky 7", 5.5], h: ["High 8\u201312", 2.2] },
    now() { return Date.now() + this.off; },
    init() {
        const el = document.getElementById("z-dice"); if (!el) return;
        el.innerHTML = `<div class="z-dice-stage"><div class="z-die" id="z-d1">\u2680</div><div class="z-die" id="z-d2">\u2681</div></div>
              <div class="z-dice-info"><b id="z-dice-st">Place a bet to start a round</b><small id="z-dice-bets"></small></div>
              <div class="blackjack-controls"><div class="form-group bet-group"><label for="z-dice-amt">Bet</label><input type="number" id="z-dice-amt" class="input-field input-bet" min="1" step="1" value="50"></div>
              <div class="action-buttons">${Object.keys(this.SIDES).map((k) => `<button type="button" class="btn btn-action" data-side="${k}">${this.SIDES[k][0]}<small> pays${this.SIDES[k][1]}x</small></button>`).join("")}</div></div>
              <p id="z-dice-res" class="game-result" role="status"></p>`;
        el.addEventListener("click", (e) => { const b = e.target.closest("[data-side]"); if (b) this.bet(b.dataset.side); });
    },
    bet(side) {
        const me = State.username, amt = Validate.parseBet(document.getElementById("z-dice-amt")); if (amt === null || !me) return;
        const r = zref("dice"); if (!r) return; let why = "";
        r.transaction((v) => {
            v = v || { st: "idle" }; const t = this.now(); why = "";
            if (v.st === "bet" && t > v.end) { why = "Betting closed."; return; }
            if (v.st === "done" && t < (v.doneAt || 0) + 4500) { why = "Next round opens shortly."; return; }
            if (v.st !== "bet") v = { st: "bet", id: t + "-" + Rng.float().toString(36).slice(2, 6), end: t + 9000, bets: {} };
            v.bets = v.bets || {}; if (v.bets[me]) { why = "Already bet."; return; }
            v.bets[me] = { s: side, a: amt }; return v;
        }, (e, ok) => { if (ok) { State.debit(amt); Sound.chip && Sound.chip(); } else if (why) Notify.warning(why); }, false);
    },
    roll() {
        zref("dice").transaction((v) => {
            if (!v || v.st !== "bet" || this.now() < v.end) return;
            const a = 1 + Math.floor(Rng.float() * 6), b = 1 + Math.floor(Rng.float() * 6);
            v.st = "done"; v.d = [a, b]; v.doneAt = this.now(); return v;
        }, () => { }, false);
    },
    on(v) {
        this.d = v || { st: "idle" }; const g = this.d;
        if (g.st === "done" && this.shown !== g.id) { this.shown = g.id; this.reveal(g); }
        this.paint();
    },
    paint() {
        const g = this.d, st = document.getElementById("z-dice-st"), bt = document.getElementById("z-dice-bets"); if (!st) return;
        const list = Object.keys(g.bets || {}).map((u) => `${u}: ${this.SIDES[g.bets[u].s][0]} ${g.bets[u].a}`);
        if (bt) bt.textContent = list.join("  \u00B7  ");
        if (g.st === "bet") st.textContent = `Betting open \u2014 ${Math.max(0, Math.ceil((g.end - this.now()) / 1000))}s`;
        else if (g.st === "idle") st.textContent = "Place a bet to start a round";
    },
    reveal(g) {
        const f = "\u2680\u2681\u2682\u2683\u2684\u2685", [a, b] = g.d, t0 = Date.now();
        const st = document.getElementById("z-dice-st"); if (st) st.textContent = "Rolling..."; clearInterval(this.anim);
        this.anim = window.setInterval(() => {
            const fin = Date.now() - t0 > 1100;
            const d1 = document.getElementById("z-d1"), d2 = document.getElementById("z-d2");
            if (d1) d1.textContent = f[(fin ? a : 1 + Math.floor(Rng.float() * 6)) - 1];
            if (d2) d2.textContent = f[(fin ? b : 1 + Math.floor(Rng.float() * 6)) - 1];
            Sound.tick && Sound.tick(a + b);
            if (fin) { clearInterval(this.anim); this.settle(g); }
        }, 90);
    },
    settle(g) {
        const tot = g.d[0] + g.d[1], win = tot < 7 ? "l" : tot > 7 ? "h" : "s", me = State.username, my = (g.bets || {})[me];
        const st = document.getElementById("z-dice-st"); if (st) st.textContent = `Total ${tot} \u2192 ${this.SIDES[win][0]}`;
        if (!my) return;
        zref("dice/paid/" + me).transaction((v) => (v === g.id ? undefined : g.id), (e, ok) => {
            if (!ok) return; const won = my.s === win, pay = won ? Math.floor(my.a * this.SIDES[win][1]) : 0;
            resolveGameOutcome("dice", { roundId: g.id + "-" + me, entries: [{ wager: my.a, payout: pay }] });
            const res = document.getElementById("z-dice-res");
            if (res) res.textContent = won ? `You won ${pay} chips!` : `You lost ${my.a} chips.`;
            if (won) { Sound.win && Sound.win(); if (pay >= CONFIG.BIG_WIN_THRESHOLD) Effects.celebrate(`Quick Dice: +${pay}`); } else Sound.lose && Sound.lose();
        }, false);
    },
    tick() { if (this.d.st === "bet") { this.paint(); if (this.now() >= this.d.end) this.roll(); } }
};
