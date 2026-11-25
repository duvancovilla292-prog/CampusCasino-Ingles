/* CASINO CAMPUS — Card FX, deck utilities and the universal game resolver.
   Classic <script> (not an ES module): top-level consts are shared with the other files
   through the page's global scope, so the load order in index.html matters. */
"use strict";

/* =========================================================================
   1. CARD FX — Shared Dealing Engine
   ========================================================================= */
const CardFX = {
    queue: [],
    until: 0,
    reduced() { return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches); },
    add(el, opts) { this.queue.push(Object.assign({ el, round: 0, ord: 0 }, opts)); },

    deferRender(owner) {
        const left = this.until - performance.now();
        if (left <= 0) return false;
        if (!owner._fxTimer) owner._fxTimer = window.setTimeout(() => { owner._fxTimer = null; owner.render(); }, left + 40);
        return true;
    },

    flush(origin, step) {
        const q = this.queue.splice(0);
        if (!q.length) return;
        step = step || 170;
        q.sort((a, b) => (a.round - b.round) || (a.ord - b.ord));
        const o = origin && origin.getBoundingClientRect();
        let end = 0;
        q.forEach((it, k) => {
            const d = q.length > 1 ? k * step : 0;
            end = Math.max(end, d + (it.stay ? 450 : 1050));
            this.fly(it, o, d);
        });
        this.until = performance.now() + end;
    },

    fly(it, o, delay) {
        const el = it.el, reveal = it.reveal;
        if (this.reduced() || !el.animate) { if (reveal) reveal(); return; }
        const done = () => { el.style.zIndex = ""; el.style.willChange = ""; };
        const flip = () => {
            if (!reveal) { done(); return; }
            if (!it.flip) { reveal(); done(); return; }
            const P = "perspective(520px) ";
            const a1 = el.animate([{ transform: P + "rotateY(0deg)" }, { transform: P + "rotateY(90deg)" }], { duration: 130, easing: "ease-in", fill: "forwards" });
            a1.finished.then(() => {
                reveal();
                const a2 = el.animate([{ transform: P + "rotateY(-90deg)" }, { transform: P + "rotateY(0deg)" }], { duration: 170, easing: "ease-out", fill: "forwards" });
                return a2.finished.then(() => { a1.cancel(); a2.cancel(); });
            }).then(done, done);
        };
        if (it.stay) { el.style.zIndex = "30"; window.setTimeout(flip, delay + 250); return; }

        const r = el.getBoundingClientRect();
        let dx = 0, dy = -90;
        if (o && o.width) { dx = o.left + o.width / 2 - (r.left + r.width / 2); dy = o.top + o.height / 2 - (r.top + r.height / 2); }
        const tilt = Math.random() * 14 - 7;
        el.style.zIndex = "30"; el.style.willChange = "transform, opacity";
        const slide = el.animate([
            { transform: `translate3d(${dx}px,${dy}px,0) rotate(${-tilt * 2}deg) scale(.72)`, opacity: 0, offset: 0 },
            { opacity: 1, offset: 0.1 },
            { transform: `translate3d(${dx * 0.4}px,${dy * 0.4 - 18}px,0) rotate(${tilt}deg) scale(1.08)`, opacity: 1, offset: 0.5 },
            { transform: "translate3d(0,0,0) rotate(0deg) scale(1)", opacity: 1, offset: 1 }
        ], { duration: 640, delay: delay, easing: "cubic-bezier(.2,.75,.25,1)", fill: "backwards" });
        window.setTimeout(() => Sound.card && Sound.card(), delay + 90);
        slide.finished.then(flip, flip);
    }
};

/* =========================================================================
   2. DECK UTILITIES
   ========================================================================= */
const Deck = {
    SUITS: ["\u2660", "\u2665", "\u2666", "\u2663"],
    RANKS: ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"],

    createShuffled() {
        const deck = [];
        for (const suit of this.SUITS) {
            for (const rank of this.RANKS) {
                deck.push({ rank, suit });
            }
        }
        for (let i = deck.length - 1; i > 0; i -= 1) {
            const j = Math.floor(Math.random() * (i + 1));
            [deck[i], deck[j]] = [deck[j], deck[i]];
        }
        return deck;
    },

    isRedSuit(suit) {
        return suit === "\u2665" || suit === "\u2666";
    },

    numericValue(rank) {
        if (rank === "A") return 14;
        if (rank === "K") return 13;
        if (rank === "Q") return 12;
        if (rank === "J") return 11;
        return Number.parseInt(rank, 10);
    }
};

/* =========================================================================
   3. UNIVERSAL GAME RESOLVER
   ========================================================================= */
const GameResolver = {
    MAX_PRIZE: 5000,
    settled: new Set(),
    LABELS: {
        blackjack: "Blackjack", baccarat: "Baccarat", roulette: "Roulette", slots: "Slots", hilo: "Hi-Lo",
        craps: "Craps", crash: "Crash", moneywheel: "Money Wheel", pokerdice: "Poker Dice", keno: "VIP Keno",
        blackwidow: "Black Widow Poker", uno: "UNO", parques: "Colombian Ludo", dominoes: "Dominoes", chess: "Chess",
        checkers: "Chinese Checkers", mastermind: "Color Code Breaker", bullscows: "Bulls & Cows", wheel: "Player Wheel"
    },

    label(gameId) {
        if (this.LABELS[gameId]) return this.LABELS[gameId];
        if (String(gameId).startsWith("draw:")) return "Lucky Draw";
        return String(gameId);
    },

    int(v) { const n = Math.round(Number(v)); return Number.isFinite(n) && n > 0 ? n : 0; },
    safeKey(s) { return String(s).replace(/[.#$\[\]\/\s]/g, "_").slice(0, 120); },

    normalize(results) {
        const r = results || {}, me = State.username, map = new Map();
        const add = (u, wager, payout, credited) => {
            if (!u) return;
            const e = map.get(u) || { username: u, wager: 0, payout: 0, credited: false };
            e.wager += wager; e.payout += payout; e.credited = e.credited || !!credited;
            map.set(u, e);
        };
        (Array.isArray(r.entries) ? r.entries : []).forEach((e) => add(e.username || me, this.int(e.wager), this.int(e.payout), e.credited));

        const winners = Array.isArray(r.winners) ? [...new Set(r.winners.filter(Boolean))] : [];
        const pool = Math.min(this.int(r.prizePool), this.MAX_PRIZE * 10);
        if (winners.length && pool > 0) {
            const share = Math.floor(pool / winners.length), rest = pool - share * winners.length;
            winners.forEach((u, i) => add(u, 0, share + (i === 0 ? rest : 0), false));
        }
        if (map.size && Array.isArray(r.participants)) r.participants.filter(Boolean).forEach((u) => add(u, 0, 0, false));
        return [...map.values()];
    },

    readPrize(inputId, overridden) {
        const el = document.getElementById(inputId);
        const v = Math.min(this.MAX_PRIZE, this.int(el && el.value));
        if (!v || !State.isHost) return 0;
        if (overridden) { Notify.warning("Prize skipped for this draw."); return 0; }
        return v;
    },

    syncPrizeUi() {
        ["draw-prize-row", "wheel-prize-row"].forEach((id) => { const el = document.getElementById(id); if (el) el.hidden = !State.isHost; });
    },

    applyLocal(e) {
        const gross = e.credited ? 0 : e.payout;
        State.balance = Math.max(0, State.balance + gross);
        const fee = e.wager > 0 ? Jackpot.rake(e.wager) : 0;
        HUD.update();
        return Room.applyRound(e.username, {
            balance: gross - fee, gamesPlayed: 1, totalWagered: e.wager, netProfit: e.payout - e.wager - fee
        });
    },

    async applyRemote(gameId, roundId, entries) {
        if (!Room.db || !Room.code || !Room.playersRef) return false;
        const claim = Room.db.ref(`rooms/${Room.code}/rounds/${this.safeKey(gameId + "_" + roundId)}`);
        const res = await claim.transaction((v) => (v ? undefined : {
            gameId, roundId, by: State.username, ts: Date.now(),
            entries: entries.map((e) => ({ u: e.username, w: e.wager, p: e.payout }))
        }));
        if (!res.committed) return false;
        await Promise.all(entries.map((e) => Room.applyRound(e.username, {
            balance: e.credited ? 0 : e.payout, gamesPlayed: 1, totalWagered: e.wager, netProfit: e.payout - e.wager
        })));
        return true;
    },

    resolve(gameId, results) {
        const r = results || {}, me = State.username;
        const roundId = String(r.roundId || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`);
        const key = gameId + ":" + roundId;
        if (!gameId || !me || this.settled.has(key)) return Promise.resolve(null);
        this.settled.add(key);

        // Random selector tools (Player Wheel, Lucky Draw) announce who was picked. The Quiz listens to this to
        // send a random question to the picked player(s); a failing listener must never block the prize settlement.
        if (gameId === "wheel" || String(gameId).startsWith("draw:")) {
            try {
                PubSub.emit("selection-made", {
                    gameId,
                    winners: Array.isArray(r.winners) ? r.winners.filter(Boolean) : [],
                    participants: Array.isArray(r.participants) ? r.participants.filter(Boolean) : []
                });
            } catch (err) { console.error("selection-made listener failed", err); }
        }

        const entries = this.normalize(r);
        const summary = { gameId, roundId, entries, ts: Date.now() };
        if (!entries.length) return Promise.resolve(summary);

        const mine = entries.filter((e) => e.username === me), others = entries.filter((e) => e.username !== me);
        const localTasks = mine.map((e) => this.applyLocal(e));
        const remoteTask = others.length ? this.applyRemote(gameId, roundId, others) : Promise.resolve(false);
        PubSub.emit("round-resolved", summary);

        return Promise.all([...localTasks, remoteTask]).then((done) => {
            const paid = new Set(mine.map((e) => e.username));
            if (done[done.length - 1]) others.forEach((e) => paid.add(e.username));
            const awarded = entries.filter((e) => paid.has(e.username) && e.payout > 0 && e.wager === 0);
            if (awarded.length) {
                const total = awarded.reduce((a, e) => a + e.payout, 0);
                Notify.success(`${this.label(gameId)}: ${total.toLocaleString("en-US")} chips awarded to ${awarded.map((e) => e.username).join(", ")}.`);
            }
            return summary;
        }).catch((err) => { console.error("Round settlement failed", err); Notify.error("Could not save the round result."); return null; });
    }
};

function resolveGameOutcome(gameId, results) { return GameResolver.resolve(gameId, results); }
document.addEventListener("game-changed", () => GameResolver.syncPrizeUi());
PubSub.on("players-updated", () => GameResolver.syncPrizeUi());
