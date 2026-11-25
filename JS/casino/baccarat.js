/* CASINO CAMPUS — Baccarat.
   Classic <script> (not an ES module): top-level consts are shared with the other files
   through the page's global scope, so the load order in index.html matters. */
"use strict";

/* =========================================================================
   5. OVERHAULED BACCARAT (Punto Banco)
   ========================================================================= */
const Baccarat = {
    BET_MS: 15000,
    RESULT_MS: 12000,
    DECKS: 8,
    TIE_PAYS: 8,
    BANKER_PAYS_PCT: 195,
    HIST_MAX: 18,
    FALLBACK_MAX: 50000,
    SPOTS: { p: "Player", b: "Banker", t: "Tie" },

    ref: null, cb: null, offRef: null, offCb: null, tick: null,
    off: 0, d: { st: "idle" }, busy: false, dealing: false, animating: false,
    run: 0, tableId: null, revealedId: null, pendingSettle: null, settledIds: {},

    $(id) { return document.getElementById(id); },
    now() { return Date.now() + this.off; },
    reduced() { return CardFX.reduced(); },
    wait(ms) { return new Promise((r) => window.setTimeout(r, this.reduced() ? Math.min(ms, 250) : ms)); },

    init() {
        const spotsEl = this.$("bac-spots");
        if (spotsEl) {
            spotsEl.addEventListener("click", (e) => {
                const b = e.target.closest("[data-spot]");
                if (b && !b.disabled) this.bet(b.dataset.spot);
            });
        }
        const chipsEl = this.$("bac-chips");
        if (chipsEl) {
            chipsEl.addEventListener("click", (e) => {
                const c = e.target.closest("[data-bac-chip]"); if (!c) return;
                const inp = this.$("baccarat-bet"); if (inp) inp.value = c.dataset.bacChip;
                chipsEl.querySelectorAll("[data-bac-chip]").forEach((x) => x.classList.toggle("is-selected", x === c));
                Sound.click && Sound.click();
            });
        }
    },

    start() {
        this.stop(); if (!Room.db || !Room.code) return;
        this.ref = Room.db.ref(`rooms/${Room.code}/baccarat`);
        this.offRef = Room.db.ref(".info/serverTimeOffset");
        this.offCb = (s) => { this.off = Number(s.val()) || 0; };
        this.offRef.on("value", this.offCb);
        this.cb = (s) => this.on(s.val());
        this.ref.on("value", this.cb);
        this.tick = window.setInterval(() => this.onTick(), 500);
        this.paint();
    },

    stop() {
        if (this.ref && this.cb) this.ref.off("value", this.cb);
        if (this.offRef && this.offCb) this.offRef.off("value", this.offCb);
        if (this.tick) window.clearInterval(this.tick);
        this.run += 1;
        this.ref = this.cb = this.offRef = this.offCb = this.tick = null;
        this.d = { st: "idle" }; this.busy = false; this.dealing = false; this.animating = false; this.tableId = null; this.revealedId = null; this.pendingSettle = null; this.settledIds = {};
        if (this.$("bac-cards-p")) { this.clearTable(); this.paint(); }
    },

    val(c) { const r = c % 13; return r === 12 ? 1 : r >= 8 ? 0 : r + 2; },
    total(hand) { return (hand || []).reduce((t, c) => t + this.val(c), 0) % 10; },
    rand(n) {
        if (window.crypto && window.crypto.getRandomValues) { const a = new Uint32Array(1); window.crypto.getRandomValues(a); return a[0] % n; }
        return Math.floor(Math.random() * n);
    },
    draw6() {
        const shoe = []; for (let d = 0; d < this.DECKS; d += 1) for (let c = 0; c < 52; c += 1) shoe.push(c);
        const out = [];
        for (let i = 0; i < 6; i += 1) { const j = i + this.rand(shoe.length - i);[shoe[i], shoe[j]] = [shoe[j], shoe[i]]; out.push(shoe[i]); }
        return out;
    },
    bankerDraws(bt, p3) {
        if (bt <= 2) return true;
        if (bt === 3) return p3 !== 8;
        if (bt === 4) return p3 >= 2 && p3 <= 7;
        if (bt === 5) return p3 >= 4 && p3 <= 7;
        if (bt === 6) return p3 === 6 || p3 === 7;
        return false;
    },
    play(c) {
        const p = [c[0], c[2]], b = [c[1], c[3]];
        let pt = this.total(p), bt = this.total(b);
        const nat = pt >= 8 || bt >= 8;
        if (!nat) {
            let p3 = null;
            if (pt <= 5) { p.push(c[4]); p3 = this.val(c[4]); pt = this.total(p); }
            if (p3 === null ? bt <= 5 : this.bankerDraws(bt, p3)) b.push(c[5]);
            bt = this.total(b);
        }
        return { p, b, pt, bt, nat, win: pt > bt ? "p" : bt > pt ? "b" : "t" };
    },
    payout(bets, win) {
        const p = bets.p || 0, b = bets.b || 0, t = bets.t || 0;
        if (win === "p") return p * 2;
        if (win === "b") return Math.floor(b * this.BANKER_PAYS_PCT / 100);
        return t * (this.TIE_PAYS + 1) + p + b;
    },
    staked(bets) { return ((bets && bets.p) || 0) + ((bets && bets.b) || 0) + ((bets && bets.t) || 0); },

    limitOk(roundTotal) {
        if (typeof BetLimits !== "undefined" && BetLimits && typeof BetLimits.ok === "function") return BetLimits.ok("baccarat", roundTotal);
        if (roundTotal > this.FALLBACK_MAX) { Notify.error(`The maximum bet per round is ${this.FALLBACK_MAX.toLocaleString("en-US")} chips.`); return false; }
        return true;
    },
    canBet(g) {
        const t = this.now();
        if (this.animating) return false;
        if (g.st === "bet") return t < g.end;
        if (g.st === "done") return t >= (g.doneAt || 0) + this.RESULT_MS;
        return true;
    },
    bet(spot) {
        const me = State.username; if (!me || !this.ref || !this.SPOTS[spot] || this.busy) return;
        const g = this.d;
        if (!this.canBet(g)) return Notify.warning(g.st === "bet" ? "Bets are closed \u2014 dealing in progress." : "Next round opens shortly.");
        const amt = Validate.parseBet(this.$("baccarat-bet")); if (amt === null) return;
        const mine = g.st === "bet" ? this.staked((g.bets || {})[me]) : 0;
        if (!this.limitOk(mine + amt)) return;
        if (!State.canAfford(amt)) return Notify.error("You don't have enough chips for that bet.");
        this.busy = true; let why = "";
        this.ref.transaction((v) => {
            v = v || { st: "idle" }; const t = this.now(); why = "";
            if (v.st === "bet" && t >= v.end) { why = "Bets are closed \u2014 dealing in progress."; return; }
            if (v.st === "done" && t < (v.doneAt || 0) + this.RESULT_MS) { why = "Next round opens shortly."; return; }
            if (v.st !== "bet") v = { st: "bet", id: t + "-" + Math.random().toString(36).slice(2, 6), end: t + this.BET_MS, bets: {}, hist: v.hist || [] };
            v.bets = v.bets || {};
            const b = Object.assign({ p: 0, b: 0, t: 0 }, v.bets[me] || {});
            b[spot] += amt; v.bets[me] = b;
            return v;
        }, (e, ok) => {
            this.busy = false;
            if (ok) { State.debit(amt); Sound.chip && Sound.chip(); } else if (why) Notify.warning(why);
        }, false);
    },

    onTick() {
        const g = this.d;
        if (g.st === "bet" && this.now() >= g.end) this.deal();
        this.paint();
    },
    deal() {
        if (!this.ref || this.dealing) return;
        this.dealing = true;
        this.ref.transaction((v) => {
            if (!v || v.st !== "bet" || this.now() < v.end) return;
            const r = this.play(this.draw6());
            v.st = "done"; v.p = r.p; v.b = r.b; v.pt = r.pt; v.bt = r.bt; v.nat = r.nat; v.win = r.win; v.doneAt = this.now();
            v.hist = (v.hist || []).concat(r.win).slice(-this.HIST_MAX);
            return v;
        }, () => { this.dealing = false; }, false);
    },
    on(v) {
        this.d = v || { st: "idle" }; const g = this.d;
        if (g.st === "done" && Array.isArray(g.p) && Array.isArray(g.b)) {
            /* FIX: reveal is keyed on its own id. The old code compared against tableId, which the "bet" phase had
               already set to this same round id, so the reveal for the finished round never ran. */
            if (this.revealedId !== g.id) {
                this.revealedId = g.id; this.tableId = g.id;
                const fresh = this.now() - (g.doneAt || 0) < 9000;
                this.reveal(g, fresh && this.isActive());
            }
        } else if (g.st === "bet") {
            if (this.tableId !== g.id) { this.cancelReveal(); this.tableId = g.id; this.revealedId = null; this.clearTable(); }
        } else if (g.st === "idle" && this.tableId !== null) {
            this.cancelReveal(); this.tableId = null; this.revealedId = null; this.clearTable();
        }
        this.paint();
    },

    /* True only when the Baccarat table is actually on screen (no dependency on Router internals). */
    isActive() {
        const sec = this.$("game-baccarat");
        return !!sec && !sec.hidden && sec.getClientRects().length > 0 && !document.hidden;
    },
    /* Stops any running reveal; if a payout was still waiting for the animation, settle it quietly first. */
    cancelReveal() {
        const g = this.pendingSettle;
        this.run += 1; this.animating = false; this.pendingSettle = null;
        if (g) this.settle(g, true);
    },

    clearTable() {
        [ "p", "b" ].forEach((k) => {
            const elCards = this.$("bac-cards-" + k), elScore = this.$("bac-score-" + k), elHand = this.$("bac-hand-" + k);
            if (elCards) elCards.textContent = "";
            if (elScore) elScore.textContent = "";
            if (elHand) elHand.classList.remove("win", "lose");
        });
        const t = this.$("bac-table"); if (t) t.classList.remove("tie");
        const res = this.$("baccarat-result"); if (res) res.textContent = "";
    },

    /* Creates a face-down card inside the hand container and slides it in from the shoe. */
    dealCard(side, card) {
        const cont = this.$("bac-cards-" + side); if (!cont) return null;
        const el = document.createElement("div");
        el.className = "card card-back bac-card";
        el.dataset.card = String(card);
        cont.appendChild(el);
        if (!this.reduced()) {
            const shoe = this.$("bac-shoe");
            if (shoe) {
                const s = shoe.getBoundingClientRect(), r = el.getBoundingClientRect();
                el.style.setProperty("--bac-from-x", Math.round(s.left + s.width / 2 - (r.left + r.width / 2)) + "px");
                el.style.setProperty("--bac-from-y", Math.round(s.top + s.height / 2 - (r.top + r.height / 2)) + "px");
            }
            el.classList.add("bac-dealing");
            el.addEventListener("animationend", () => el.classList.remove("bac-dealing"), { once: true });
        }
        if (typeof Sound !== "undefined" && Sound && Sound.card) Sound.card();
        return el;
    },
    /* Two-step flip: edge-on (90deg) -> swap in the real face -> back to flat. */
    async flipCard(el, card) {
        if (!el) return;
        if (this.reduced()) { Blackjack.setFront(el, card); el.classList.add("bac-card"); return; }
        el.classList.remove("bac-dealing"); el.classList.add("bac-flip-out");
        await this.wait(140);
        Blackjack.setFront(el, card);               /* setFront() resets className, so re-add ours */
        el.classList.add("bac-card", "bac-flip-in");
        await this.wait(190);
        el.classList.remove("bac-flip-in");
    },
    /* Instant, no-animation card (late joiners, background tab, returning to the table). */
    placeCard(side, card) {
        const cont = this.$("bac-cards-" + side); if (!cont) return;
        const el = document.createElement("div"); Blackjack.setFront(el, card); el.classList.add("bac-card");
        cont.appendChild(el);
    },
    setScore(side, hand, label) { const sc = this.$("bac-score-" + side); if (sc) sc.textContent = `${label}: ${this.total(hand)}`; },
    say(text) { const st = this.$("bac-status"); if (st) st.textContent = text; },

    async reveal(g, animate) {
        const id = ++this.run, alive = () => id === this.run;
        this.clearTable();
        const P = g.p || [], B = g.b || [];
        if (!animate) {
            P.forEach((c) => this.placeCard("p", c)); B.forEach((c) => this.placeCard("b", c));
            this.setScore("p", P, "Player"); this.setScore("b", B, "Banker");
            this.finish(g); return;
        }
        this.animating = true; this.pendingSettle = g; this.paint();
        const el = { p: [], b: [] };
        const deal = async (side, hand, i, ms) => { el[side][i] = this.dealCard(side, hand[i]); await this.wait(ms || 420); return alive(); };

        /* 1. Deal four cards face-down, one at a time: Player, Banker, Player, Banker */
        this.say("Dealing cards...");
        if (!await deal("p", P, 0)) return; if (!await deal("b", B, 0)) return;
        if (!await deal("p", P, 1)) return; if (!await deal("b", B, 1)) return;
        await this.wait(350); if (!alive()) return;

        /* 2. Flip Player's hand, then Banker's hand */
        this.say("Player reveals...");
        await this.flipCard(el.p[0], P[0]); if (!alive()) return;
        await this.flipCard(el.p[1], P[1]); if (!alive()) return;
        this.setScore("p", P.slice(0, 2), "Player"); await this.wait(500); if (!alive()) return;
        this.say("Banker reveals...");
        await this.flipCard(el.b[0], B[0]); if (!alive()) return;
        await this.flipCard(el.b[1], B[1]); if (!alive()) return;
        this.setScore("b", B.slice(0, 2), "Banker"); await this.wait(700); if (!alive()) return;

        /* 3. Third-card rules */
        if (g.nat) {
            this.say(`Natural ${Math.max(this.total(P.slice(0, 2)), this.total(B.slice(0, 2)))}! No more cards drawn.`);
            await this.wait(1200); if (!alive()) return;
        } else {
            if (P.length > 2) {
                this.say("Player draws a third card...");
                if (!await deal("p", P, 2, 500)) return;
                await this.flipCard(el.p[2], P[2]); if (!alive()) return;
                this.setScore("p", P, "Player"); await this.wait(700); if (!alive()) return;
            } else { this.say("Player stands."); await this.wait(800); if (!alive()) return; }
            if (B.length > 2) {
                this.say("Banker draws a third card...");
                if (!await deal("b", B, 2, 500)) return;
                await this.flipCard(el.b[2], B[2]); if (!alive()) return;
                this.setScore("b", B, "Banker"); await this.wait(700); if (!alive()) return;
            } else { this.say("Banker stands."); await this.wait(800); if (!alive()) return; }
        }

        /* 4. Result, then payout */
        this.animating = false;
        this.finish(g);
    },
    finish(g) {
        this.pendingSettle = null; this.animating = false;
        const names = { p: "Player", b: "Banker", t: "Tie" };
        const handP = this.$("bac-hand-p"), handB = this.$("bac-hand-b"), tbl = this.$("bac-table");
        if (handP) { handP.classList.toggle("win", g.win === "p"); handP.classList.toggle("lose", g.win === "b"); }
        if (handB) { handB.classList.toggle("win", g.win === "b"); handB.classList.toggle("lose", g.win === "p"); }
        if (tbl) tbl.classList.toggle("tie", g.win === "t");
        const line = `Player ${g.pt} \u2014 Banker ${g.bt}. ${g.win === "t" ? "Tie!" : names[g.win] + " wins!"}`;
        this.say(line); const res = this.$("baccarat-result"); if (res) res.textContent = line;
        this.paint(); this.settle(g);
    },
    /* Pays once per player per round (Firebase "paid/<user>" guard). quiet = don't touch the result line. */
    settle(g, quiet) {
        const me = State.username, my = (g.bets || {})[me];
        if (!me || !my || !this.ref || this.settledIds[g.id]) return;
        this.settledIds[g.id] = true;
        this.ref.child("paid/" + me).transaction((v) => (v === g.id ? undefined : g.id), (e, ok) => {
            if (!ok) return;
            const stake = this.staked(my), pay = this.payout(my, g.win), net = pay - stake, fmt = (n) => n.toLocaleString("en-US");
            resolveGameOutcome("baccarat", { roundId: g.id + "-" + me, entries: [{ wager: stake, payout: pay }] });
            const res = quiet ? null : this.$("baccarat-result");
            if (net > 0) {
                if (res) res.textContent += ` You won ${fmt(pay)} chips!`;
                Notify.success(`Baccarat: won ${fmt(pay)} chips.`); Sound.win && Sound.win();
                if (pay >= CONFIG.BIG_WIN_THRESHOLD) Effects.celebrate(`BACCARAT! +${fmt(pay)} chips`);
            } else if (net === 0) {
                if (res) res.textContent += " Push! Stakes returned."; Notify.warning("Baccarat: push.");
            } else {
                if (res) res.textContent += ` You lost ${fmt(stake)} chips.`;
                Notify.error(`Baccarat: lost ${fmt(stake)} chips.`); Sound.lose && Sound.lose();
            }
        }, false);
    },

    paint() {
        if (!this.$("bac-spots")) return;
        const g = this.d, me = State.username, t = this.now(), bets = g.bets || {};
        const phase = this.$("bac-phase");
        if (phase) {
            if (this.animating) phase.textContent = "Dealing in progress";
            else if (g.st === "bet") phase.textContent = t < g.end ? `Betting open \u2014 ${Math.max(0, Math.ceil((g.end - t) / 1000))}s` : "Bets closed";
            else if (g.st === "done") phase.textContent = t < (g.doneAt || 0) + this.RESULT_MS ? "Round complete" : "Place your bets";
            else phase.textContent = "Place your bets";
        }
        if (g.st === "idle") this.say("Tap Player, Banker, or Tie to open the round.");
        else if (g.st === "bet" && !this.animating) this.say(t < g.end ? "Bets are open." : "No more bets \u2014 dealing...");

        const open = this.canBet(g), mineB = (g.st === "bet" || g.st === "done") ? (bets[me] || {}) : {};
        this.$("bac-spots").querySelectorAll("[data-spot]").forEach((btn) => {
            const k = btn.dataset.spot; let all = 0;
            Object.keys(bets).forEach((u) => { all += (bets[u] && bets[u][k]) || 0; });
            btn.disabled = !open;
            btn.classList.toggle("win", g.st === "done" && !this.animating && g.win === k);
            const mSpan = btn.querySelector(".bac-mine"), aSpan = btn.querySelector(".bac-all");
            if (mSpan) mSpan.textContent = mineB[k] ? `Your bet: ${mineB[k].toLocaleString("en-US")}` : "";
            if (aSpan) aSpan.textContent = all ? `Table: ${all.toLocaleString("en-US")}` : "";
        });
        const tb = this.$("bac-tablebets");
        if (tb) {
            const list = Object.keys(bets).map((u) => `${u}: ${["p", "b", "t"].filter((k) => bets[u][k]).map((k) => this.SPOTS[k][0] + " " + bets[u][k]).join(" + ")}`);
            tb.textContent = list.length ? list.join("  \u00B7  ") : "";
        }

        const plate = this.$("bac-plate");
        if (plate) {
            const hist = (g.hist || []).slice(0, this.animating ? -1 : undefined);
            plate.textContent = "";
            hist.forEach((k) => { const s = document.createElement("span"); s.className = "bac-dot " + k; s.textContent = k.toUpperCase(); s.title = this.SPOTS[k]; plate.appendChild(s); });
        }
    }
};
