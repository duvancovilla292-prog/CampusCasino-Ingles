/* =========================================================================
   CASINO CAMPUS — TRADITIONAL CASINO GAMES
   Shared card/deal engine (CardFX, Deck), Universal GameResolver, Blackjack,
   Roulette, Slots, Hi-Lo, Craps, Crash, Money Wheel, La Viuda Negra, Quick Dice,
   Multiplayer Baccarat, 3D Poker Dice, and VIP Keno.
   ========================================================================= */
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
        blackwidow: "Black Widow Poker", uno: "UNO", parques: "Parqués", dominoes: "Dominoes", chess: "Chess",
        checkers: "Chinese Checkers", mastermind: "Color Code Breaker", bullscows: "Picas y Fijas", wheel: "Player Wheel"
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

/* =========================================================================
   4. BLACKJACK
   ========================================================================= */
const Blackjack = {
    MAX_SEATS: 5, IDLE_MS: 45000, NEXT_MS: 12000, DEAL_MS: 30000,
    R: "23456789TJQKA", S: ["\u2660", "\u2665", "\u2666", "\u2663"],
    ref: null, cb: null, tick: null, g: { phase: "lobby" }, pres: { armed: null }, ann: {}, claimed: {}, shown: {}, hid: null,
    $(id) { return document.getElementById(id); },
    isLive(g) { return g.phase === "play"; },

    init() {
        const on = (id, fn) => { const el = this.$(id); if (el) el.addEventListener("click", fn); };
        on("btn-blackjack-bet", () => this.bet());
        on("btn-blackjack-hit", () => this.act("hit"));
        on("btn-blackjack-stand", () => this.act("stand"));
        on("btn-blackjack-double", () => this.act("double"));
        on("bj-deal", () => this.dealNow());
        on("bj-next", () => this.next());
        on("bj-lobby-back", () => this.backToLobby());
        on("bj-kick", () => this.kick());
        on("bj-leave", () => Tables.leave(this.ref, State.username));
        const inp = this.$("input-blackjack-bet");
        if (inp) inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); this.bet(); } });
    },
    start() {
        this.stop(); if (!Room.db || !Room.code) return;
        this.ref = Room.db.ref(`rooms/${Room.code}/bj`);
        this.cb = (s) => {
            const n = s.val() || { phase: "lobby" };
            if (n.hid !== this.g.hid) { this.shown = {}; this.hole = {}; }
            this.g = n;
            Tables.announce(this.ann, n, "Blackjack"); Tables.badge("blackjack", n, this.MAX_SEATS); Tables.presence(this.pres, this.ref, n, State.username);
            this.sync(); this.render();
        };
        this.ref.on("value", this.cb);
        this.tick = window.setInterval(() => { if (this.g.phase !== "lobby") this.renderControls(); }, 1000);
        this.render();
    },
    stop() {
        if (this.ref && this.cb) this.ref.off("value", this.cb);
        if (this.tick) window.clearInterval(this.tick);
        this.ref = this.cb = this.tick = null; this.g = { phase: "lobby" }; this.pres = { armed: null }; this.ann = {}; this.claimed = {}; this.shown = {}; this.hid = null;
        Tables.badge("blackjack", {}, this.MAX_SEATS);
    },

    val(c) { const r = c % 13; return r === 12 ? 11 : r >= 8 ? 10 : r + 2; },
    score(hand) {
        let t = 0, a = 0;
        (hand || []).forEach((c) => { t += this.val(c); if (c % 13 === 12) a += 1; });
        while (t > 21 && a > 0) { t -= 10; a -= 1; }
        return t;
    },
    isNatural(hand) { return (hand || []).length === 2 && this.score(hand) === 21; },
    setFront(el, c) {
        const su = (c / 13) | 0, rk = this.R[c % 13];
        el.className = "card " + (su === 1 || su === 2 ? "card-red" : "card-black");
        el.textContent = (rk === "T" ? "10" : rk) + this.S[su];
    },
    renderCard(container, c, hidden, animate, meta) {
        const el = document.createElement("div");
        if (hidden) {
            el.className = "card card-back";
            container.appendChild(el);
            if (animate && meta && meta.travel) CardFX.add(el, Object.assign({ flip: false, reveal: null }, meta));
            return;
        } else if (animate || (meta && meta.turnOver)) { el.className = "card card-back"; }
        else this.setFront(el, c);
        container.appendChild(el);
        if (hidden || !(animate || (meta && meta.turnOver))) return;
        CardFX.add(el, Object.assign({ flip: true, reveal: () => this.setFront(el, c), stay: !!(meta && meta.turnOver) }, meta));
    },
    fillHand(container, key, hand, holeHidden, allHidden) {
        const seen = this.shown[key] || 0; container.textContent = "";
        this.hole = this.hole || {};
        const was = this.hole[key];
        (hand || []).forEach((c, i) => {
            const ord = key === "dealer" ? 999 : (this.seq = (this.seq || 0) + 1);
            const hid = !!allHidden || (!!holeHidden && i === 1);
            const turnOver = !hid && (was === "all" || (was === "hole" && i === 1));
            this.renderCard(container, c, hid, i >= seen, { round: i, ord, turnOver, travel: key !== "dealer" });
        });
        this.hole[key] = allHidden ? "all" : holeHidden ? "hole" : false;
        this.shown[key] = (hand || []).length;
    },

    openTable() { if (this.ref) Tables.open(this.ref, State.username, this.MAX_SEATS); },
    take(key) { if (this.ref) Tables.take(this.ref, State.username, key, ["lobby", "bet", "done"]); },
    start_() {
        const me = State.username; if (!this.ref) return;
        this.ref.transaction((v) => {
            if (!Tables.isOpen(v) || v.phase !== "lobby" || v.owner !== me) return;
            return { phase: "bet", owner: v.owner, seats: v.seats, max: v.max, rot: v.rot || 0, round: 1, hid: Date.now(), turnAt: Date.now(), last: "" };
        });
    },
    closeTable() { if (this.ref) Tables.close(this.ref, State.username, State.isHost, ["lobby", "done"]).then((r) => { if (!r.committed) Notify.warning("Finish the round before closing the table."); }); },
    backToLobby() {
        const me = State.username; if (!this.ref) return;
        this.ref.transaction((v) => {
            if (!Tables.isOpen(v) || v.owner !== me || v.phase !== "done") return;
            return { phase: "lobby", owner: v.owner, seats: v.seats, max: v.max, rot: v.rot || 0, hid: Date.now(), turnAt: Date.now() };
        });
    },
    leaveOk(g, me) { const inHand = (g.order || []).includes(me); return !(g.phase === "play" && inHand) && !(g.phase === "bet" && (g.bets || {})[me]); },

    bet() {
        const me = State.username, g = this.g; if (!this.ref || !me) return;
        if (g.phase !== "bet" || !Tables.seatOf(g.seats, me) || (g.bets || {})[me]) return;
        const amount = Validate.parseBet(this.$("input-blackjack-bet")); if (amount === null) return;
        this.ref.transaction((v) => {
            if (!Tables.isOpen(v) || v.phase !== "bet") return;
            const names = Tables.names(v.seats); if (!names.includes(me)) return;
            v.bets = v.bets || {}; if (v.bets[me]) return;
            v.bets[me] = amount;
            return names.every((u) => v.bets[u]) ? this.deal(v) : v;
        }).then((r) => {
            if (!r.committed) return;
            const mineBet = ((r.snapshot.val() || {}).bets || {})[me];
            if (mineBet === amount) { State.debit(amount); Sound.click && Sound.click(); }
        }).catch(() => { });
    },
    dealNow() {
        const me = State.username; if (!this.ref) return;
        this.ref.transaction((v) => {
            if (!Tables.isOpen(v) || v.phase !== "bet" || !Object.keys(v.bets || {}).length) return;
            if (!Tables.canDrive(v, me) && Date.now() - (v.turnAt || 0) < this.DEAL_MS) return;
            return this.deal(v);
        });
    },
    deal(v) {
        const names = Tables.names(v.seats).filter((u) => (v.bets || {})[u]);
        const deck = Array.from({ length: 52 }, (_, i) => i);
        for (let i = 51; i > 0; i -= 1) { const j = Math.floor(Math.random() * (i + 1));[deck[i], deck[j]] = [deck[j], deck[i]]; }
        const hands = {}, st = {}, bets = {};
        names.forEach((u) => { hands[u] = [deck.pop(), deck.pop()]; st[u] = this.isNatural(hands[u]) ? "bj" : "play"; bets[u] = v.bets[u]; });
        const dealer = [deck.pop(), deck.pop()];
        Object.assign(v, { phase: "play", order: names, hands, st, bets, dealer, deck, up: 0, turnAt: Date.now(), last: "Cards dealt", res: null, paid: null });
        v.turn = names.findIndex((u) => st[u] === "play");
        return v.turn < 0 || this.isNatural(dealer) ? this.runDealer(v) : v;
    },
    runDealer(v) {
        v.up = 1;
        const contest = v.order.some((u) => v.st[u] === "stand");
        while (contest && this.score(v.dealer) < 17) v.dealer.push(v.deck.pop());
        const dt = this.score(v.dealer), dNat = this.isNatural(v.dealer), shares = {}, out = {};
        v.order.forEach((u) => {
            const bet = v.bets[u], pt = this.score(v.hands[u]);
            let s = 0, o = "lose";
            if (v.st[u] === "bust") o = "bust";
            else if (v.st[u] === "bj") { if (dNat) { s = bet; o = "push"; } else { s = Math.round(bet * 2.5); o = "blackjack"; } }
            else if (dNat) o = "lose";
            else if (dt > 21 || pt > dt) { s = bet * 2; o = "win"; }
            else if (pt === dt) { s = bet; o = "push"; }
            shares[u] = s; out[u] = o;
        });
        v.phase = "done"; v.turn = -1; v.turnAt = Date.now(); v.res = { shares, out, dealer: dt };
        return v;
    },
    next() {
        const me = State.username; if (!this.ref) return;
        this.ref.transaction((v) => {
            if (!Tables.isOpen(v) || v.phase !== "done") return;
            if (!Tables.canDrive(v, me) && Date.now() - (v.turnAt || 0) < this.NEXT_MS) return;
            return { phase: "bet", owner: v.owner, seats: v.seats, max: v.max, rot: v.rot || 0, round: (v.round || 1) + 1, hid: Date.now(), turnAt: Date.now(), last: "" };
        });
    },

    act(type, who) {
        const me = who || State.username, g = this.g; if (!this.ref || !me) return;
        if (type === "double" && !who && !BetLimits.ok("blackjack", ((g.bets || {})[me] || 0) * 2)) return;
        if (type === "double" && !who && !State.canAfford((g.bets || {})[me] || 0)) return Notify.error("You don't have enough chips to double down.");
        let extra = 0;
        this.ref.transaction((v) => {
            extra = 0;
            if (!v || v.phase !== "play" || v.order[v.turn] !== me) return;
            if (who && Date.now() - (v.turnAt || 0) < this.IDLE_MS) return;
            const hand = (v.hands[me] || []).slice();
            if (type === "hit") {
                hand.push(v.deck.pop()); v.hands[me] = hand; const t = this.score(hand);
                v.st[me] = t > 21 ? "bust" : t === 21 ? "stand" : "play"; v.last = `${me} hit`;
            } else if (type === "double") {
                if (hand.length !== 2) return;
                extra = v.bets[me]; v.bets[me] = extra * 2; hand.push(v.deck.pop()); v.hands[me] = hand;
                v.st[me] = this.score(hand) > 21 ? "bust" : "stand"; v.last = `${me} doubled down`;
            } else if (type === "stand") { v.st[me] = "stand"; v.last = `${me} stood`; }
            else return;
            v.turnAt = Date.now();
            if (v.st[me] === "play") return v;
            const nx = v.order.findIndex((u, i) => i > v.turn && v.st[u] === "play");
            if (nx < 0) return this.runDealer(v);
            v.turn = nx; return v;
        }).then((r) => { if (r.committed && extra) State.debit(extra); }).catch(() => { });
    },
    kick() {
        const g = this.g, u = g.order && g.order[g.turn];
        if (!u || u === State.username || g.phase !== "play") return;
        if (Date.now() - (g.turnAt || 0) < this.IDLE_MS) return Notify.warning("Give them a little longer.");
        this.act("stand", u);
    },

    sync() {
        const g = this.g, me = State.username;
        if (!me || g.phase !== "done" || !g.res || !(g.order || []).includes(me) || this.claimed[g.hid]) return;
        this.claimed[g.hid] = true;
        const share = (g.res.shares || {})[me] || 0, stake = (g.bets || {})[me] || 0, out = (g.res.out || {})[me];
        this.ref.child("paid/" + me).transaction((c) => (c ? undefined : Date.now())).then((r) => {
            if (!r.committed) return;
            resolveGameOutcome("blackjack", { roundId: g.hid + "-" + me, entries: [{ wager: stake, payout: share }] });
            const text = { blackjack: `Blackjack! You won ${share} chips.`, win: `You won ${share} chips.`, push: "Push. Your bet was returned.", lose: `Dealer wins. You lost ${stake} chips.`, bust: `You busted and lost ${stake} chips.` }[out];
            if (out === "blackjack" || out === "win") { Notify.success(text); Sound.win(); if (share >= CONFIG.BIG_WIN_THRESHOLD) Effects.celebrate(`${out === "blackjack" ? "BLACKJACK" : "YOU WON"}! +${share} chips`); }
            else if (out === "push") Notify.warning(text);
            else { Notify.error(text); Sound.lose(); }
        }).catch(() => { });
    },

    status(u) {
        const g = this.g, inHand = (g.order || []).includes(u), st = (g.st || {})[u], out = ((g.res || {}).out || {})[u];
        if (g.phase === "bet") return (g.bets || {})[u] ? "Bet placed" : "Betting";
        if (g.phase === "play") {
            if (!inHand) return "Sitting out";
            if (g.order[g.turn] === u) return "Playing";
            if (u !== State.username && (st === "bust" || st === "bj" || st === "stand")) return "Done";
            return { play: "Waiting", stand: "Stand", bust: "Bust", bj: "Blackjack" }[st] || "Waiting";
        }
        if (g.phase === "done") return !inHand ? "Sitting out" : ({ win: "Won", blackjack: "Blackjack", push: "Push", lose: "Lost", bust: "Bust" }[out] || "");
        return "Seated";
    },
    render() {
        if (CardFX.deferRender(this)) return;
        const g = this.g, lobby = !Tables.isOpen(g) || g.phase === "lobby";
        const lEl = this.$("bj-lobby"), vEl = this.$("bj-live");
        if (lEl) lEl.hidden = !lobby; if (vEl) vEl.hidden = lobby;
        if (lobby) {
            this.$("blackjack-result").textContent = "";
            Tables.renderLobby(this.$("bj-lobby"), g, {
                title: "Blackjack table", game: "Blackjack", max: this.MAX_SEATS, minStart: 1,
                soloNote: "Just you so far. Start now to play solo against the dealer, or wait for more players.",
                onOpen: () => this.openTable(), onTake: (k) => this.take(k), onLeave: () => Tables.leave(this.ref, State.username),
                onStart: () => this.start_(), onClose: () => this.closeTable(), onClaim: () => Tables.claim(this.ref, State.username)
            });
            return;
        }
        this.seq = 0;
        this.renderDealer(); this.renderSeats();
        CardFX.flush(document.getElementById("bj-shoe"), 190);
        this.renderControls();
    },
    renderDealer() {
        const g = this.g, el = this.$("dealer-cards"), sc = this.$("dealer-score"), has = (g.dealer || []).length > 0;
        if (!el || !sc) return;
        if (!has) { el.textContent = ""; sc.textContent = "Dealing starts once bets are in"; return; }
        this.fillHand(el, "dealer", g.dealer, !g.up);
        sc.textContent = g.up ? `Score: ${this.score(g.dealer)}${this.score(g.dealer) > 21 ? " (bust)" : ""}` : `Showing: ${this.val(g.dealer[0])}`;
    },
    renderSeats() {
        const g = this.g, me = State.username, el = this.$("bj-seats"), live = g.phase === "play" || g.phase === "done";
        if (!el) return;
        const seated = Tables.names(g.seats), list = live ? Array.from(new Set([...(g.order || []), ...seated])) : seated;
        el.textContent = "";
        list.forEach((u) => {
            const inHand = live && (g.order || []).includes(u), hand = (g.hands || {})[u] || [], out = ((g.res || {}).out || {})[u];
            const turn = g.phase === "play" && g.order[g.turn] === u;
            const d = document.createElement("div");
            d.className = "bj-seat" + (u === me ? " me" : "") + (turn ? " turn" : "") + (out === "win" || out === "blackjack" ? " win" : "") + (out === "lose" || out === "bust" ? " lose" : "") + (live && !inHand ? " out" : "");
            const n = document.createElement("div"); n.className = "bw-name"; n.append((turn ? "\u25B6 " : "") + u + (u === me ? " (you)" : ""));
            const tag = (t, cls) => { const s = document.createElement("span"); s.className = "bw-tag " + (cls || ""); s.textContent = t; n.appendChild(s); };
            if (u === g.owner) tag("Host");
            const status = this.status(u); if (status) tag(status, "st-" + status.toLowerCase().replace(/[^a-z]/g, ""));
            if (g.phase === "done" && inHand) { const sh = ((g.res || {}).shares || {})[u] || 0, b = (g.bets || {})[u] || 0; tag(sh - b >= 0 ? `+${sh - b}` : `${sh - b}`, sh - b > 0 ? "st-won" : sh - b < 0 ? "st-lost" : ""); }
            d.appendChild(n);
            const bet = (g.bets || {})[u]; if (bet) { const chip = document.createElement("div"); chip.className = "bj-bet"; chip.textContent = "Bet " + bet; d.appendChild(chip); }
            const row = document.createElement("div"); row.className = "card-row";
            const hideCards = g.phase === "play" && u !== me;
            if (inHand) this.fillHand(row, "p:" + u, hand, false, hideCards);
            d.appendChild(row);
            if (inHand) {
                const sc = document.createElement("span"); sc.className = "score-display"; const t = this.score(hand);
                sc.textContent = hideCards ? `${hand.length} cards \u00B7 hidden` : (t > 21 ? "Bust " + t : "Score: " + t);
                d.appendChild(sc);
            }
            el.appendChild(d);
        });
    },
    renderControls() {
        const g = this.g, me = State.username, names = Tables.names(g.seats), seated = names.includes(me), inHand = (g.order || []).includes(me);
        const who = g.phase === "play" ? g.order[g.turn] : null, myTurn = who === me, myBet = (g.bets || {})[me], hand = (g.hands || {})[me] || [];
        const total = Object.values(g.bets || {}).reduce((a, b) => a + b, 0), betsIn = Object.keys(g.bets || {}).length;
        if (!this.$("bj-pot")) return;
        this.$("bj-pot").textContent = "Bets " + total.toLocaleString("en-US");
        this.$("bj-phase").textContent = { bet: `Round ${g.round || 1} \u2014 place your bets`, play: `Round ${g.round || 1} \u2014 hands in play`, done: `Round ${g.round || 1} \u2014 complete` }[g.phase] || "Waiting for players";
        let msg;
        if (g.phase === "bet") msg = !seated ? "Take a seat to join the next hand." : myBet ? `Bet placed. Waiting for the others (${betsIn} of ${names.length} in).` : "Place your bet to get dealt in.";
        else if (g.phase === "play") msg = myTurn ? "Your turn: hit, stand or double down." : inHand ? `Waiting for ${who}\u2026` : `${who} is playing\u2026`;
        else { const o = ((g.res || {}).out || {})[me]; msg = o ? { blackjack: "Blackjack pays 3 to 2.", win: "You beat the dealer.", push: "Push.", lose: "The dealer wins this one.", bust: "You busted." }[o] : `Dealer finished with ${(g.res || {}).dealer}.`; }
        this.$("bj-status").textContent = msg;
        this.$("blackjack-result").textContent = g.phase === "done" && g.res ? `Dealer ${g.res.dealer > 21 ? "busts with " : "has "}${g.res.dealer}. ` + (g.order || []).map((u) => { const o = g.res.out[u], sh = g.res.shares[u] - g.bets[u]; return `${u}: ${o === "blackjack" ? "blackjack" : o}${sh ? ` (${sh > 0 ? "+" : ""}${sh})` : ""}`; }).join(" \u00B7 ") : (g.last || "");
        const canBet = g.phase === "bet" && seated && !myBet, inp = this.$("input-blackjack-bet");
        if (inp) inp.disabled = !canBet;
        this.$("btn-blackjack-bet").disabled = !canBet;
        this.$("btn-blackjack-hit").disabled = !myTurn; this.$("btn-blackjack-stand").disabled = !myTurn;
        this.$("btn-blackjack-double").disabled = !(myTurn && hand.length === 2 && State.canAfford(myBet || 0));
        const drive = Tables.canDrive(g, me), dealWait = Math.ceil((this.DEAL_MS - (Date.now() - (g.turnAt || 0))) / 1000), nextWait = Math.ceil((this.NEXT_MS - (Date.now() - (g.turnAt || 0))) / 1000);
        const dl = this.$("bj-deal"); dl.hidden = !(g.phase === "bet" && seated && betsIn > 0 && betsIn < names.length); dl.disabled = !drive && dealWait > 0;
        dl.textContent = drive || dealWait <= 0 ? "Deal now" : `Deal now (${dealWait}s)`;
        const nx = this.$("bj-next"); nx.hidden = !(g.phase === "done" && seated); nx.disabled = !drive && nextWait > 0;
        nx.textContent = drive || nextWait <= 0 ? "Next round" : `Next round (${nextWait}s)`;
        this.$("bj-lobby-back").hidden = !(g.phase === "done" && g.owner === me);
        const wait = g.phase === "play" && inHand && !myTurn ? Math.ceil((this.IDLE_MS - (Date.now() - (g.turnAt || 0))) / 1000) : 0;
        const kick = this.$("bj-kick"); kick.hidden = !(g.phase === "play" && inHand && !myTurn); kick.disabled = wait > 0; kick.textContent = wait > 0 ? `Skip idle player (${wait}s)` : "Skip idle player";
        const lv = this.$("bj-leave"); lv.hidden = !seated; lv.disabled = !this.leaveOk(g, me);
    }
};

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
    run: 0, tableId: null, settledIds: {},

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
        this.d = { st: "idle" }; this.busy = false; this.dealing = false; this.animating = false; this.tableId = null; this.settledIds = {};
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
        if (g.st === "done" && this.tableId !== g.id) {
            this.tableId = g.id;
            const fresh = this.now() - (g.doneAt || 0) < 9000;
            this.reveal(g, fresh && Router.currentGameKey === "baccarat" && !document.hidden);
        } else if (g.st === "bet" && this.tableId !== g.id) {
            this.run += 1; this.animating = false; this.tableId = g.id; this.clearTable();
        } else if (g.st === "idle" && this.tableId !== null) {
            this.run += 1; this.animating = false; this.tableId = null; this.clearTable();
        }
        this.paint();
    },

    clearTable() {
        ["p", "b"].forEach((k) => {
            const elCards = this.$("bac-cards-" + k), elScore = this.$("bac-score-" + k), elHand = this.$("bac-hand-" + k);
            if (elCards) elCards.textContent = "";
            if (elScore) elScore.textContent = "";
            if (elHand) elHand.classList.remove("win", "lose");
        });
        const t = this.$("bac-table"); if (t) t.classList.remove("tie");
        const res = this.$("baccarat-result"); if (res) res.textContent = "";
    },
    addCard(side, c, round, ord) {
        const el = document.createElement("div"); el.className = "card card-back";
        const container = this.$("bac-cards-" + side);
        if (container) container.appendChild(el);
        CardFX.add(el, { round, ord, flip: true, reveal: () => Blackjack.setFront(el, c) });
    },
    setScore(side, hand, label) { const sc = this.$("bac-score-" + side); if (sc) sc.textContent = `${label}: ${this.total(hand)}`; },
    say(text) { const st = this.$("bac-status"); if (st) st.textContent = text; },

    async reveal(g, animate) {
        const id = ++this.run, alive = () => id === this.run;
        this.clearTable();
        const P = g.p || [], B = g.b || [];
        if (!animate) {
            [["p", P], ["b", B]].forEach(([s, h]) => h.forEach((c) => { const el = document.createElement("div"); Blackjack.setFront(el, c); const cont = this.$("bac-cards-" + s); if (cont) cont.appendChild(el); }));
            this.setScore("p", P, "Player"); this.setScore("b", B, "Banker");
            this.finish(g); return;
        }
        this.animating = true; this.paint();
        this.say("Dealing cards...");
        this.addCard("p", P[0], 0, 0); this.addCard("b", B[0], 0, 1); this.addCard("p", P[1], 1, 0); this.addCard("b", B[1], 1, 1);
        CardFX.flush(this.$("bac-shoe"), 240);
        await this.wait(2500); if (!alive()) return;
        this.setScore("p", P.slice(0, 2), "Player"); this.setScore("b", B.slice(0, 2), "Banker");
        if (g.nat) { this.say(`Natural ${Math.max(this.total(P.slice(0, 2)), this.total(B.slice(0, 2)))}! No more cards drawn.`); await this.wait(1200); if (!alive()) return; }
        else {
            if (P.length > 2) { this.say("Player draws 3rd card..."); this.addCard("p", P[2], 2, 0); CardFX.flush(this.$("bac-shoe"), 200); await this.wait(1600); if (!alive()) return; this.setScore("p", P, "Player"); }
            else { this.say("Player stands."); await this.wait(800); if (!alive()) return; }
            if (B.length > 2) { this.say("Banker draws 3rd card..."); this.addCard("b", B[2], 2, 1); CardFX.flush(this.$("bac-shoe"), 200); await this.wait(1600); if (!alive()) return; this.setScore("b", B, "Banker"); }
            else { this.say("Banker stands."); await this.wait(800); if (!alive()) return; }
        }
        this.animating = false;
        this.finish(g);
    },
    finish(g) {
        const names = { p: "Player", b: "Banker", t: "Tie" };
        const handP = this.$("bac-hand-p"), handB = this.$("bac-hand-b"), tbl = this.$("bac-table");
        if (handP) { handP.classList.toggle("win", g.win === "p"); handP.classList.toggle("lose", g.win === "b"); }
        if (handB) { handB.classList.toggle("win", g.win === "b"); handB.classList.toggle("lose", g.win === "p"); }
        if (tbl) tbl.classList.toggle("tie", g.win === "t");
        const line = `Player ${g.pt} \u2014 Banker ${g.bt}. ${g.win === "t" ? "Tie!" : names[g.win] + " wins!"}`;
        this.say(line); const res = this.$("baccarat-result"); if (res) res.textContent = line;
        this.paint(); this.settle(g);
    },
    settle(g) {
        const me = State.username, my = (g.bets || {})[me];
        if (!me || !my || !this.ref || this.settledIds[g.id]) return;
        this.settledIds[g.id] = true;
        this.ref.child("paid/" + me).transaction((v) => (v === g.id ? undefined : g.id), (e, ok) => {
            if (!ok) return;
            const stake = this.staked(my), pay = this.payout(my, g.win), net = pay - stake;
            resolveGameOutcome("baccarat", { roundId: g.id + "-" + me, entries: [{ wager: stake, payout: pay }] });
            const res = this.$("baccarat-result");
            if (res) {
                if (net > 0) {
                    res.textContent += ` You won ${pay.toLocaleString("en-US")} chips!`; Notify.success(`Baccarat: won ${pay.toLocaleString("en-US")} chips.`); Sound.win && Sound.win();
                    if (pay >= CONFIG.BIG_WIN_THRESHOLD) Effects.celebrate(`BACCARAT! +${pay.toLocaleString("en-US")} chips`);
                } else if (net === 0) { res.textContent += " Push! Stakes returned."; Notify.warning("Baccarat: push."); }
                else { res.textContent += ` You lost ${stake.toLocaleString("en-US")} chips.`; Notify.error(`Baccarat: lost ${stake.toLocaleString("en-US")} chips.`); Sound.lose && Sound.lose(); }
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

/* =========================================================================
   6. OVERHAULED 3D POKER DICE ENGINE
   ========================================================================= */
const PokerDice = {
    FACES: ["A", "K", "Q", "J", "10", "9"],
    RANKS: [5, 4, 3, 2, 1, 0],
    MULT: { 7: 12, 6: 6, 5: 4, 4: 3, 3: 2, 2: 1.5, 1: 1 },

    playerDice: [0, 0, 0, 0, 0],
    dealerDice: [0, 0, 0, 0, 0],
    held: [false, false, false, false, false],
    state: "idle", // "idle", "rolled", "finished"
    betAmount: 10,

    $(id) { return document.getElementById(id); },

    init() {
        const btnRoll = this.$("btn-pd-roll");
        const btnReroll = this.$("btn-pd-reroll");
        const btnStand = this.$("btn-pd-stand");

        if (btnRoll) btnRoll.addEventListener("click", () => this.startRoll());
        if (btnReroll) btnReroll.addEventListener("click", () => this.reroll());
        if (btnStand) btnStand.addEventListener("click", () => this.stand());

        this.renderDiceUI();
    },

    randDie() { return Math.floor(Math.random() * 6); },

    evalHand(dice) {
        const cnt = {};
        dice.forEach((x) => { cnt[x] = (cnt[x] || 0) + 1; });
        const grp = Object.entries(cnt).map(([f, n]) => [n, Number(f)]).sort((a, b) => b[0] - a[0] || b[1] - a[1]);
        const pat = grp.map((x) => x[0]).join("");
        const uniq = [...new Set(dice)].sort((a, b) => a - b);
        const straight = uniq.length === 5 && (uniq[4] - uniq[0] === 4);

        let cat = 0, name = "High Card";
        if (pat === "5") { cat = 7; name = "5 of a Kind"; }
        else if (pat === "41") { cat = 6; name = "4 of a Kind"; }
        else if (pat === "32") { cat = 5; name = "Full House"; }
        else if (straight) { cat = 4; name = "Straight"; }
        else if (pat === "311") { cat = 3; name = "3 of a Kind"; }
        else if (pat === "221") { cat = 2; name = "Two Pair"; }
        else if (pat === "2111") { cat = 1; name = "One Pair"; }

        const score = cat * 1e6 + grp.reduce((acc, x) => acc * 10 + x[1], 0);
        return { cat, name, score };
    },

    renderDiceUI() {
        const pRow = this.$("pd-dice-row");
        const dRow = this.$("pd-dealer-dice");
        if (!pRow || !dRow) return;

        pRow.textContent = "";
        this.playerDice.forEach((v, i) => {
            const cube = document.createElement("div");
            cube.className = `pd-cube rank-${this.FACES[v]}` + (this.held[i] ? " is-held" : "");
            const span = document.createElement("span");
            span.className = "pd-cube-val";
            span.textContent = this.state === "idle" ? "?" : this.FACES[v];
            cube.appendChild(span);

            if (this.state === "rolled") {
                cube.addEventListener("click", () => {
                    this.held[i] = !this.held[i];
                    Sound.click && Sound.click();
                    this.renderDiceUI();
                });
            }
            pRow.appendChild(cube);
        });

        dRow.textContent = "";
        this.dealerDice.forEach((v) => {
            const cube = document.createElement("div");
            cube.className = `pd-cube rank-${this.FACES[v]}`;
            const span = document.createElement("span");
            span.className = "pd-cube-val";
            span.textContent = this.state === "finished" ? this.FACES[v] : "?";
            cube.appendChild(span);
            dRow.appendChild(cube);
        });

        const pEval = this.state === "idle" ? { name: "--", cat: 0 } : this.evalHand(this.playerDice);
        const dEval = this.state !== "finished" ? { name: "--" } : this.evalHand(this.dealerDice);

        const pBadge = this.$("pd-hand-name");
        if (pBadge) pBadge.textContent = pEval.name;
        const dBadge = this.$("pd-dealer-hand-name");
        if (dBadge) dBadge.textContent = dEval.name;

        const paytable = this.$("pd-paytable");
        if (paytable) {
            paytable.querySelectorAll("span").forEach((sp) => {
                const c = Number(sp.dataset.cat);
                sp.classList.toggle("active", pEval.cat === c);
            });
        }
    },

    startRoll() {
        if (this.state !== "idle" && this.state !== "finished") return;
        const bet = Validate.parseBet(this.$("input-pd-bet"));
        if (bet === null) return;
        if (!BetLimits.ok("pokerdice", bet)) return;
        if (!State.canAfford(bet)) return Notify.error("You don't have enough chips.");

        State.debit(bet);
        this.betAmount = bet;
        this.held = [false, false, false, false, false];
        this.playerDice = [0, 1, 2, 3, 4].map(() => this.randDie());
        this.dealerDice = [0, 1, 2, 3, 4].map(() => this.randDie());

        this.state = "rolled";
        Sound.chip && Sound.chip();

        const btnRoll = this.$("btn-pd-roll");
        const btnReroll = this.$("btn-pd-reroll");
        const btnStand = this.$("btn-pd-stand");
        if (btnRoll) btnRoll.disabled = true;
        if (btnReroll) btnReroll.disabled = false;
        if (btnStand) btnStand.disabled = false;

        const pRow = this.$("pd-dice-row");
        if (pRow) pRow.querySelectorAll(".pd-cube").forEach((c) => c.classList.add("rolling"));

        window.setTimeout(() => {
            this.renderDiceUI();
        }, 400);
    },

    reroll() {
        if (this.state !== "rolled") return;
        this.playerDice = this.playerDice.map((v, i) => (this.held[i] ? v : this.randDie()));
        this.finishRound();
    },

    stand() {
        if (this.state !== "rolled") return;
        this.finishRound();
    },

    finishRound() {
        this.state = "finished";
        const btnRoll = this.$("btn-pd-roll");
        const btnReroll = this.$("btn-pd-reroll");
        const btnStand = this.$("btn-pd-stand");
        if (btnRoll) btnRoll.disabled = false;
        if (btnReroll) btnReroll.disabled = true;
        if (btnStand) btnStand.disabled = true;

        const pEval = this.evalHand(this.playerDice);
        const dEval = this.evalHand(this.dealerDice);

        this.renderDiceUI();

        const won = pEval.score > dEval.score;
        const tie = pEval.score === dEval.score;
        const mult = this.MULT[pEval.cat] || 1;
        let payout = 0;

        if (won) {
            payout = Math.floor(this.betAmount * (1 + mult));
        } else if (tie) {
            payout = this.betAmount;
        }

        const resEl = this.$("pokerdice-result");
        if (resEl) {
            if (won) {
                resEl.textContent = `You won ${payout.toLocaleString("en-US")} chips! (${pEval.name} vs Dealer's ${dEval.name})`;
                Notify.success(`Poker Dice: won ${payout.toLocaleString("en-US")} chips.`);
                Sound.win && Sound.win();
                if (payout >= CONFIG.BIG_WIN_THRESHOLD) Effects.celebrate(`POKER DICE WIN! +${payout.toLocaleString("en-US")} chips`);
            } else if (tie) {
                resEl.textContent = `Push! (${pEval.name}). Bet returned.`;
                Notify.warning("Poker Dice: push.");
            } else {
                resEl.textContent = `Dealer won with ${dEval.name}. Lost ${this.betAmount.toLocaleString("en-US")} chips.`;
                Notify.error(`Poker Dice: lost ${this.betAmount.toLocaleString("en-US")} chips.`);
                Sound.lose && Sound.lose();
            }
        }

        resolveGameOutcome("pokerdice", { entries: [{ wager: this.betAmount, payout }] });
    }
};

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

/* =========================================================================
   9. SLOT MACHINE
   ========================================================================= */
const Slots = {
    SYMBOLS: ["\u{1F352}", "\u{1F34B}", "\u{1F514}", "\u2B50", "7\uFE0F\u20E3", "\u{1F347}"],
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

    randomSymbol() { return this.SYMBOLS[Math.floor(Math.random() * this.SYMBOLS.length)]; },

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
        if (a === b && b === c) payout = bet * 10;
        else if (a === b || b === c || a === c) payout = bet * 2;

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

/* =========================================================================
   10. HI-LO
   ========================================================================= */
const HiLo = {
    currentCard: null,
    isResolving: false,

    init() {
        this.currentCard = this.drawCard();
        this.renderCurrentCard();
        if (DOM.btnHiloHigher) DOM.btnHiloHigher.addEventListener("click", () => this.guess("higher"));
        if (DOM.btnHiloLower) DOM.btnHiloLower.addEventListener("click", () => this.guess("lower"));
    },

    flip(el, apply, ms = 210) {
        const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        if (reduce || !el || !el.animate) { apply(); return Promise.resolve(); }
        const T = (deg, sc) => `perspective(700px) rotateY(${deg}deg) scale(${sc})`;
        return new Promise((resolve) => {
            const a = el.animate([{ transform: T(0, 1) }, { transform: T(90, 1.06) }], { duration: ms, easing: "ease-in", fill: "forwards" });
            a.onfinish = () => {
                apply();
                const b = el.animate([{ transform: T(-90, 1.06) }, { transform: T(0, 1) }], { duration: ms * 1.15, easing: "cubic-bezier(.2,.8,.3,1.2)" });
                a.cancel(); b.onfinish = () => resolve(); b.oncancel = () => resolve();
            };
            a.oncancel = () => resolve();
        });
    },
    setCardFace(el, card) {
        if (!el) return;
        if (!card) { el.textContent = "?"; el.classList.add("hilo-card-hidden"); el.classList.remove("card-red", "card-black"); return; }
        el.textContent = `${card.rank}${card.suit}`;
        el.classList.remove("hilo-card-hidden");
        el.classList.toggle("card-red", Deck.isRedSuit(card.suit));
        el.classList.toggle("card-black", !Deck.isRedSuit(card.suit));
    },
    advanceCard(nextCard) {
        const hold = (ms) => new Promise((r) => window.setTimeout(r, ms));
        return hold(900).then(() => Promise.all([
            this.flip(DOM.hiloCurrentCard, () => { this.currentCard = nextCard; this.setCardFace(DOM.hiloCurrentCard, nextCard); }),
            hold(120).then(() => this.flip(DOM.hiloNextCard, () => this.setCardFace(DOM.hiloNextCard, null)))
        ]));
    },

    drawCard() {
        const rank = Deck.RANKS[Math.floor(Math.random() * Deck.RANKS.length)];
        const suit = Deck.SUITS[Math.floor(Math.random() * Deck.SUITS.length)];
        return { rank, suit, value: Deck.numericValue(rank) };
    },

    renderCurrentCard() {
        if (!DOM.hiloCurrentCard) return;
        DOM.hiloCurrentCard.textContent = `${this.currentCard.rank}${this.currentCard.suit}`;
        DOM.hiloCurrentCard.classList.toggle("card-red", Deck.isRedSuit(this.currentCard.suit));
        DOM.hiloCurrentCard.classList.toggle("card-black", !Deck.isRedSuit(this.currentCard.suit));
        if (DOM.hiloNextCard) {
            DOM.hiloNextCard.textContent = "?";
            DOM.hiloNextCard.classList.add("hilo-card-hidden");
            DOM.hiloNextCard.classList.remove("card-red", "card-black");
        }
    },

    guess(direction) {
        if (this.isResolving) return;
        const bet = Validate.parseBet(DOM.inputHiloBet);
        if (bet === null) return;

        State.debit(bet);
        this.isResolving = true;
        if (DOM.hiloResult) DOM.hiloResult.textContent = "";

        const nextCard = this.drawCard();
        this.flip(DOM.hiloNextCard, () => this.setCardFace(DOM.hiloNextCard, nextCard), 230)
            .then(() => new Promise((r) => window.setTimeout(r, 350)))
            .then(() => this.resolveGuess(direction, bet, nextCard));
    },

    resolveGuess(direction, bet, nextCard) {
        const isHigher = nextCard.value > this.currentCard.value;
        const isLower = nextCard.value < this.currentCard.value;
        const guessedCorrectly = (direction === "higher" && isHigher) || (direction === "lower" && isLower);
        const directionLabel = direction === "higher" ? "higher" : "lower";
        let payout = 0;

        if (DOM.hiloResult) {
            if (!isHigher && !isLower) {
                payout = bet;
                DOM.hiloResult.textContent = `Push on ${nextCard.rank}${nextCard.suit}. Bet returned.`;
                Notify.warning("Hi-Lo: push.");
            } else if (guessedCorrectly) {
                payout = bet * 2;
                DOM.hiloResult.textContent = `Correct! ${nextCard.rank}${nextCard.suit} was ${directionLabel}. You won ${payout} chips.`;
                Notify.success(`Hi-Lo: won ${payout} chips.`);
                Sound.win && Sound.win();
                if (payout >= CONFIG.BIG_WIN_THRESHOLD) Effects.celebrate(`NICE CALL! +${payout} chips`);
            } else {
                DOM.hiloResult.textContent = `Wrong! ${nextCard.rank}${nextCard.suit} was not ${directionLabel}. Lost ${bet} chips.`;
                Notify.error(`Hi-Lo: lost ${bet} chips.`);
                Sound.lose && Sound.lose();
            }
        }

        resolveGameOutcome("hilo", { entries: [{ wager: bet, payout }] });
        this.advanceCard(nextCard).then(() => { this.isResolving = false; });
    }
};

/* =========================================================================
   11. EXTRA CASINO GAMES (Craps, Crash, Money Wheel)
   ========================================================================= */
const Extra = (() => {
    const $ = (s) => document.querySelector(s);
    const mk = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };
    const rnd = (a, b) => a + Math.random() * (b - a);
    const RM = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const buzz = (ms) => { if (!RM) try { navigator.vibrate && navigator.vibrate(ms); } catch (e) { } };
    const shake = (el, ms = 25) => { if (RM || !el) return; el.classList.remove("fx-shake"); void el.offsetWidth; el.classList.add("fx-shake"); buzz(ms); };

    class Particles {
        constructor() { this.list = []; }
        burst(x, y, n = 16, color = "#f4c430") {
            for (let i = 0; i < n; i += 1) { const a = rnd(0, 6.283), s = rnd(60, 260); this.list.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 60, life: 1, color, r: rnd(1.5, 3.5) }); }
        }
        draw(ctx, dt) {
            const s = dt / 1000;
            this.list = this.list.filter((p) => (p.life -= s * 1.6) > 0);
            this.list.forEach((p) => { p.vy += 500 * s; p.x += p.vx * s; p.y += p.vy * s; ctx.globalAlpha = Math.max(0, p.life); ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.283); ctx.fill(); });
            ctx.globalAlpha = 1;
        }
        get active() { return this.list.length > 0; }
    }

    const canvas = (host, w, h) => {
        const c = mk("canvas", "xg-canvas"), d = window.devicePixelRatio || 1;
        c.width = w * d; c.height = h * d; c.style.maxWidth = w + "px"; c.style.aspectRatio = `${w}/${h}`;
        const ctx = c.getContext("2d"); ctx.scale(d, d); host.replaceChildren(c);
        return { c, ctx, w, h };
    };
    const loop = (fn) => {
        let last = performance.now(), on = true;
        const t = (now) => { if (!on) return; const dt = Math.min(now - last, 40); last = now; if (fn(dt, now) === false) { on = false; return; } requestAnimationFrame(t); };
        requestAnimationFrame(t);
        return () => { on = false; };
    };
    const felt = (ctx, w, h) => { ctx.fillStyle = "#0b3d2e"; ctx.fillRect(0, 0, w, h); };

    const shell = (key, title, hint) => {
        const sec = $("#game-" + key); if (!sec) return null;
        sec.textContent = "";
        const p = mk("p", "modal-subtitle", hint); p.style.textAlign = "center";
        const stage = mk("div", "xg-stage"), ctl = mk("div", "xg-controls"), res = mk("p", "game-result");
        res.setAttribute("role", "status"); res.setAttribute("aria-live", "polite");
        const bet = mk("input", "xg-bet"); bet.type = "number"; bet.min = 1; bet.value = 10; bet.setAttribute("aria-label", "Bet amount");
        const lab = mk("label", "xg-bet-label", "Bet"); lab.append(bet);
        sec.append(mk("h2", "", title), p, stage, ctl, res);
        return { key, sec, stage, ctl, res, bet, lab };
    };
    const btn = (label, cls = "btn btn-primary", fn) => { const b = mk("button", cls, label); b.type = "button"; if (fn) b.addEventListener("click", fn); return b; };

    const settle = (g, name, bet, payout, msg) => {
        resolveGameOutcome(g.key, { entries: [{ wager: bet, payout }] });
        const net = payout - bet;
        g.res.textContent = `${msg} ${net > 0 ? "You won " + payout + " chips!" : net === 0 ? "Bet returned." : "Lost " + bet + " chips."}`;
        if (net > 0) { Notify.success(`${name}: won ${payout} chips.`); Sound.win && Sound.win(); if (payout >= CONFIG.BIG_WIN_THRESHOLD) Effects.celebrate(`${name.toUpperCase()}! +${payout} chips`); }
        else if (net < 0) { Notify.error(`${name}: lost ${bet} chips.`); Sound.lose && Sound.lose(); } else Notify.warning(`${name}: push.`);
    };

    const PIPS = { 1: [[0, 0]], 2: [[-1, -1], [1, 1]], 3: [[-1, -1], [0, 0], [1, 1]], 4: [[-1, -1], [1, -1], [-1, 1], [1, 1]], 5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]], 6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]] };
    const drawDie = (ctx, x, y, size, rot, face, lift) => {
        ctx.save(); ctx.fillStyle = "rgba(0,0,0,.35)"; ctx.beginPath(); ctx.ellipse(x, y + size * 0.62, size * (0.5 - lift * 0.1), size * 0.12, 0, 0, 6.283); ctx.fill(); ctx.restore();
        ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.fillStyle = "#f7f2e6"; ctx.strokeStyle = "#b8860b"; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.roundRect(-size / 2, -size / 2, size, size, 10); ctx.fill(); ctx.stroke();
        ctx.fillStyle = "#14171c"; PIPS[face].forEach(([px, py]) => { ctx.beginPath(); ctx.arc(px * size * 0.26, py * size * 0.26, size * 0.075, 0, 6.283); ctx.fill(); });
        ctx.restore();
    };

    const craps = () => {
        const g = shell("craps", "Craps / Dice Betting", "Pick a target outcome, then roll.");
        if (!g) return;
        const PAY = { 2: 30, 3: 15, 4: 10, 5: 8, 6: 6, 7: 5, 8: 6, 9: 8, 10: 10, 11: 15, 12: 30 };
        const types = [...Object.keys(PAY).map((n) => ({ label: n, mult: PAY[n], win: (t) => t === Number(n) })),
        { label: "Even", mult: 2, win: (t) => t % 2 === 0 }, { label: "Odd", mult: 2, win: (t) => t % 2 === 1 },
        { label: "Low 2-6", mult: 2, win: (t) => t < 7 }, { label: "High 8-12", mult: 2, win: (t) => t > 7 }];
        let sel = types[5], busy = false; const bs = [];
        const cv = canvas(g.stage, 360, 200); const { ctx, w, h } = cv, P = new Particles();
        const still = (a, b) => { felt(ctx, w, h); drawDie(ctx, 110, h - 50, 64, 0, a, 0); drawDie(ctx, 250, h - 50, 64, 0, b, 0); };
        still(3, 4);
        const grid = mk("div", "xg-controls");
        types.forEach((t) => {
            const b = btn("", "btn btn-game-select xg-chipbtn");
            b.append(t.label, Object.assign(mk("small"), { textContent: t.mult + "x" }));
            b.setAttribute("aria-pressed", String(t === sel));
            b.addEventListener("click", () => { if (busy) return; sel = t; bs.forEach((x, i) => x.setAttribute("aria-pressed", String(types[i] === t))); });
            bs.push(b); grid.append(b);
        });
        const go = btn("🎲 Roll Dice", "btn btn-primary", () => {
            if (busy) return; const bet = Validate.parseBet(g.bet); if (bet === null) return;
            State.debit(bet); busy = true; go.disabled = true; g.res.textContent = "";
            const fin = [1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)];
            const dice = [0, 1].map((i) => ({ x: 110 + i * 140, y: -40 - i * 30, vy: 0, rot: rnd(0, 6), vr: rnd(-12, 12), face: 1 + Math.floor(Math.random() * 6), n: 0, done: false, fin: fin[i] }));
            const floor = h - 50;
            loop((dt) => {
                const s = dt / 1000; felt(ctx, w, h);
                dice.forEach((d) => {
                    if (!d.done) {
                        d.vy += 1800 * s; d.y += d.vy * s; d.rot += d.vr * s;
                        if (d.y > floor) {
                            d.y = floor; d.vy *= -0.55; d.vr *= 0.6; d.n += 1; P.burst(d.x, floor + 28, 8, "#fff");
                            if (d.n === 1) shake(g.stage, 30);
                            if (d.n >= 3 || Math.abs(d.vy) < 120) { d.done = true; d.vy = 0; d.rot = 0; d.face = d.fin; } else d.face = 1 + Math.floor(Math.random() * 6);
                        } else if (Math.random() < 0.25) d.face = 1 + Math.floor(Math.random() * 6);
                    }
                    drawDie(ctx, d.x, d.y, 64, d.rot, d.face, Math.max(0, (floor - d.y) / 200));
                });
                P.draw(ctx, dt);
                if (dice.every((d) => d.done) && !P.active) {
                    const tot = fin[0] + fin[1], win = sel.win(tot);
                    settle(g, "Craps", bet, win ? bet * sel.mult : 0, `Rolled ${fin[0]} + ${fin[1]} = ${tot}.`);
                    busy = false; go.disabled = false; return false;
                }
            });
        });
        g.ctl.append(g.lab, go); g.ctl.before(grid);
    };

    const crash = () => {
        const g = shell("crash", "Crash / The Rocket", "Cash out before the rocket explodes!");
        if (!g) return;
        const { ctx, w, h } = canvas(g.stage, 360, 240), P = new Particles();
        let run = false, bet = 0, m = 1, t = 0, cashed = 0, crashAt = 2, exploded = false, jolt = 0;
        const out = btn("💰 Cash Out", "btn btn-secondary"), go = btn("🚀 Launch");
        out.disabled = true;
        const pos = (tt, xm, ym) => [30 + (tt / xm) * (w - 50), h - 24 - ((Math.exp(0.18 * tt) - 1) / (ym - 1)) * (h - 50)];
        const frame = (dt) => {
            if (run && !exploded) {
                t += dt / 1000; m = Math.exp(0.18 * t);
                if (m >= crashAt) {
                    m = crashAt; exploded = true; const [x, y] = pos(t, Math.max(6, t * 1.15), Math.max(2, m * 1.25));
                    P.burst(x, y, 40, "#e0483e"); P.burst(x, y, 30, "#f4c430"); jolt = 6; buzz(80); shake(g.stage, 80);
                    if (!cashed) settle(g, "Crash", bet, 0, `💥 Crashed at ${m.toFixed(2)}x.`);
                    else g.res.textContent += ` (Rocket crashed at ${m.toFixed(2)}x)`;
                    out.disabled = true;
                }
            }
            const xm = Math.max(6, t * 1.15), ym = Math.max(2, m * 1.25);
            ctx.save(); felt(ctx, w, h);
            if (jolt > 0.2) { ctx.translate(rnd(-jolt, jolt), rnd(-jolt, jolt)); jolt *= 0.85; }
            ctx.strokeStyle = "#f4c430"; ctx.lineWidth = 3; ctx.beginPath();
            for (let i = 0; i <= 40; i += 1) { const [x, y] = pos(t * i / 40, xm, ym); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
            ctx.stroke();
            const [rx, ry] = pos(t, xm, ym); ctx.font = "28px serif"; ctx.textAlign = "center"; ctx.fillText(exploded ? "💥" : "🚀", rx, ry);
            ctx.fillStyle = exploded ? "#e0483e" : cashed ? "#2e8b57" : "#eef2f5"; ctx.font = "700 44px sans-serif"; ctx.fillText(m.toFixed(2) + "x", w / 2, h / 2);
            if (cashed) { ctx.font = "600 15px sans-serif"; ctx.fillText(`Cashed out @ ${cashed.toFixed(2)}x`, w / 2, h / 2 + 26); }
            P.draw(ctx, dt); ctx.restore();
            if (exploded && !P.active) { run = false; go.disabled = false; return false; }
        };
        go.addEventListener("click", () => {
            if (run) return; const b = Validate.parseBet(g.bet); if (b === null) return;
            State.debit(b); bet = b; run = true; exploded = false; cashed = 0; t = 0; m = 1; g.res.textContent = "";
            crashAt = Math.min(100, Math.max(1, Math.floor(96 / (1 - Math.random())) / 100));
            go.disabled = true; out.disabled = false; loop(frame);
        });
        out.addEventListener("click", () => {
            if (!run || exploded || cashed) return; cashed = m; out.disabled = true;
            const payout = Math.floor(bet * m); const [x, y] = pos(t, Math.max(6, t * 1.15), Math.max(2, m * 1.25));
            P.burst(x, y, 24, "#2e8b57"); shake(g.stage, 20);
            settle(g, "Crash", bet, payout, `Cashed out at ${m.toFixed(2)}x.`);
        });
        frame(0); g.ctl.append(g.lab, go, out);
    };

    const moneyWheel = () => {
        const g = shell("moneywheel", "Money Wheel", "Stake chips on multipliers, then spin.");
        if (!g) return;
        const SL = [1, 2, 1, 5, 1, 2, 1, 10, 1, 2, 1, 5, 1, 20, 1, 2, 1, 5, 1, 2, 1, 10, 1, 2], A = 6.283185307 / SL.length;
        const COL = { 1: "#2b5c9e", 2: "#1e7a4c", 5: "#b8860b", 10: "#a8302a", 20: "#7b3fa0" };
        const { ctx, w, h } = canvas(g.stage, 300, 340), P = new Particles();
        const bets = { 1: 0, 2: 0, 5: 0, 10: 0, 20: 0 }; let th = 0, spinning = false, jolt = 0;
        const draw = (dt = 16) => {
            ctx.save(); felt(ctx, w, h); if (jolt > 0.2) { ctx.translate(rnd(-jolt, jolt), rnd(-jolt, jolt)); jolt *= 0.8; }
            ctx.translate(w / 2, 175); ctx.rotate(th);
            SL.forEach((v, i) => { ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, 135, i * A, (i + 1) * A); ctx.fillStyle = COL[v]; ctx.globalAlpha = i % 2 ? 0.85 : 1; ctx.fill(); ctx.globalAlpha = 1; ctx.strokeStyle = "#f7f2e6"; ctx.lineWidth = 1.5; ctx.stroke(); ctx.save(); ctx.rotate((i + 0.5) * A); ctx.fillStyle = "#fff"; ctx.font = "700 13px sans-serif"; ctx.textAlign = "right"; ctx.fillText(v + "x", 125, 5); ctx.restore(); });
            ctx.beginPath(); ctx.arc(0, 0, 18, 0, 6.283); ctx.fillStyle = "#f4c430"; ctx.fill(); ctx.restore();
            ctx.save(); ctx.fillStyle = "#e0483e"; ctx.beginPath(); ctx.moveTo(w / 2 - 12, 4); ctx.lineTo(w / 2 + 12, 4); ctx.lineTo(w / 2, 46); ctx.fill(); P.draw(ctx, dt); ctx.restore();
        };
        draw();
        const idx = () => Math.floor((((-1.5707963 - th) / A) % SL.length + SL.length) % SL.length);
        const chips = Object.keys(bets).map((k) => { const b = btn("", "btn btn-game-select xg-chipbtn"); b.append(k + "x", mk("small", "", "0")); b.addEventListener("click", () => { if (spinning) return; const s = Validate.parseBet(g.bet); if (s === null) return; if (!BetLimits.ok("moneywheel", Object.values(bets).reduce((a, b) => a + b, 0) + s)) return; State.debit(s); bets[k] += s; b.lastChild.textContent = bets[k]; }); return b; });
        const spin = btn("🎡 Spin", "btn btn-primary", () => {
            if (spinning) return; const total = Object.values(bets).reduce((a, b) => a + b, 0);
            if (!total) { Notify.error("Place a stake on at least one multiplier."); return; }
            spinning = true; spin.disabled = true; g.res.textContent = "";
            const target = Math.floor(Math.random() * SL.length), th0 = th, dur = 4500;
            const th1 = -1.5707963 - (target + rnd(0.2, 0.8)) * A - 6.283185307 * 6; let t0 = null, lastI = idx();
            loop((dt, now) => {
                t0 = t0 || now; const p = Math.min(1, (now - t0) / dur), e = 1 - (1 - p) ** 3; th = th0 + (th1 - th0) * e;
                const i = idx(); if (i !== lastI) { lastI = i; P.burst(w / 2, 46, 3, "#fff"); jolt = 1.2; buzz(6); }
                draw(dt);
                if (p >= 1) {
                    const v = SL[idx()], payout = bets[v] * (v + 1);
                    P.burst(w / 2, 46, 30, "#f4c430"); shake(g.stage, 40);
                    settle(g, "Money Wheel", total, payout, `Wheel landed on ${v}x.`);
                    Object.keys(bets).forEach((k, n) => { bets[k] = 0; chips[n].lastChild.textContent = "0"; });
                    spinning = false; spin.disabled = false; return false;
                }
            });
        });
        g.ctl.append(g.lab); chips.forEach((c) => g.ctl.append(c)); g.ctl.append(spin);
    };

    return { init() { craps(); crash(); moneyWheel(); } };
})();

/* =========================================================================
   12. BLACK WIDOW POKER (La Viuda Negra)
   ========================================================================= */
const HOUSE = "_house";

const BW = {
    ANTE: 10, MAX_SEATS: 6, IDLE_MS: 45000, NEXT_MS: 12000,
    ref: null, cb: null, statsRef: null, statsCb: null, tick: null, pres: { armed: null }, ann: {},
    g: { phase: "lobby" }, stats: {}, hid: null, paid: 0, dealt: null, shown: null, faces: {}, sel: { h: null, w: null },
    CATS: ["High Card", "One Pair", "Two Pair", "Three of a Kind", "Straight", "Flush", "Full House", "Four of a Kind", "Straight Flush", "Royal Flush"],
    R: "23456789TJQKA", S: ["\u2660", "\u2665", "\u2666", "\u2663"],
    $(id) { return document.getElementById(id); },
    nm(u) { return u === HOUSE ? "The House" : u; },
    isLive(g) { return g.phase === "play" || g.phase === "final"; },
    isFirst(g, u) { return !(((g.played || {})[u] || 0) > 0); },
    canSwap1(g, u) { return this.isLive(g) && g.order[g.turn] === u && (!!g.up || this.isFirst(g, u)); },
    canSwapAll(g, u) { return this.isLive(g) && g.order[g.turn] === u && !g.up && this.isFirst(g, u); },
    store(key, val) {
        try { if (val === undefined) return window.sessionStorage.getItem(key); window.sessionStorage.setItem(key, val); } catch (e) { }
        return null;
    },
    init() {
        const on = (id, fn) => { const el = this.$(id); if (el) el.addEventListener("click", fn); };
        on("bw-leave", () => this.leave());
        on("bw-deal", () => this.deal());
        on("bw-lobby-back", () => this.backToLobby());
        on("bw-pass", () => this.act("pass"));
        on("bw-swapall", () => this.act("swapall"));
        on("bw-swap1", () => this.act("swap1", { h: this.sel.h, w: this.sel.w }));
        on("bw-fold", () => this.act("fold"));
        on("bw-close", () => this.act("close"));
        on("bw-kick", () => this.kick());
        on("bw-result-close", () => this.closeResult());
        on("bw-result-deal", () => { this.closeResult(); this.deal(); });
        const resModal = this.$("bw-result");
        if (resModal) resModal.addEventListener("click", (e) => { if (e.target === resModal) this.closeResult(); });
    },
    start() {
        this.stop(); if (!Room.db || !Room.code) return;
        this.ref = Room.db.ref(`rooms/${Room.code}/bw`);
        this.statsRef = Room.db.ref(`rooms/${Room.code}/bwstats`);
        this.cb = (s) => {
            const n = s.val() || { phase: "lobby" };
            if (n.hid !== this.g.hid) { this.faces = {}; this.sel = { h: null, w: null }; }
            this.g = n;
            Tables.announce(this.ann, n, "Black Widow Poker"); Tables.badge("blackwidow", n, this.MAX_SEATS); Tables.presence(this.pres, this.ref, n, State.username);
            this.sync(); this.render();
        };
        this.statsCb = (s) => { this.stats = s.val() || {}; this.renderStats(); };
        this.ref.on("value", this.cb);
        this.statsRef.on("value", this.statsCb);
        this.tick = window.setInterval(() => { if (this.g.phase !== "lobby") this.renderControls(); }, 1000);
        this.render();
    },
    stop() {
        if (this.ref && this.cb) this.ref.off("value", this.cb);
        if (this.statsRef && this.statsCb) this.statsRef.off("value", this.statsCb);
        if (this.tick) window.clearInterval(this.tick);
        this.ref = this.cb = this.statsRef = this.statsCb = this.tick = null;
        this.g = { phase: "lobby" }; this.stats = {}; this.hid = null; this.shown = null; this.faces = {}; this.sel = { h: null, w: null }; this.pres = { armed: null }; this.ann = {};
        Tables.badge("blackwidow", {}, this.MAX_SEATS);
        const m = document.getElementById("bw-result"); if (m) m.hidden = true;
    },
    canSit() { if (State.balance < this.ANTE) { Notify.error(`You need at least ${this.ANTE} chips to sit down.`); return false; } return true; },
    openTable() { if (this.ref && this.canSit()) Tables.open(this.ref, State.username, this.MAX_SEATS); },
    take(key) { if (this.ref && this.canSit()) Tables.take(this.ref, State.username, key, ["lobby", "done"]); },
    leave() {
        const me = State.username, g = this.g; if (!this.ref || !me) return;
        if (this.isLive(g) && (g.order || []).includes(me)) return Notify.warning("Finish the hand before leaving the table.");
        Tables.leave(this.ref, me);
    },
    closeTable() { if (this.ref) Tables.close(this.ref, State.username, State.isHost, ["lobby", "done"]).then((r) => { if (!r.committed) Notify.warning("Finish the hand before closing the table."); }); },
    backToLobby() {
        const me = State.username; if (!this.ref) return;
        this.ref.transaction((v) => {
            if (!Tables.isOpen(v) || v.owner !== me || v.phase !== "done") return;
            return { phase: "lobby", owner: v.owner, seats: v.seats, max: v.max, rot: v.rot || 0, hid: Date.now(), turnAt: Date.now() };
        });
    },
    deal() {
        const me = State.username; if (!this.ref || !me) return;
        if (State.balance < this.ANTE) return Notify.error(`You need ${this.ANTE} chips for the ante.`);
        this.ref.transaction((v) => {
            if (!Tables.isOpen(v) || this.isLive(v)) return;
            const names = Tables.names(v.seats); if (!names.includes(me)) return;
            if (!Tables.canDrive(v, me) && !(v.phase === "done" && Date.now() - (v.turnAt || 0) >= this.NEXT_MS)) return;
            const solo = names.length === 1, rot = (v.rot || 0) + 1, order = names.map((_, i) => names[(i + rot) % names.length]);
            const deck = Array.from({ length: 52 }, (_, i) => i);
            for (let i = 51; i > 0; i -= 1) { const j = Math.floor(Math.random() * (i + 1));[deck[i], deck[j]] = [deck[j], deck[i]]; }
            const n = order.length * 5, hands = {}, ante = {}; order.forEach((u, i) => { hands[u] = deck.slice(i * 5, i * 5 + 5); ante[u] = this.ANTE; });
            if (solo) hands[HOUSE] = deck.slice(n + 5, n + 10);
            return {
                seats: v.seats, owner: v.owner, max: v.max, rot, phase: "play", hid: Date.now(), order, hands, widow: deck.slice(n, n + 5), up: 0, house: solo ? 1 : 0,
                in: ante, pot: (order.length + (solo ? 1 : 0)) * this.ANTE, turn: 0, played: { _: 0 }, fin: { _: 0 }, folded: { _: 0 }, closer: "", turnAt: Date.now(), last: "", res: null
            };
        });
    },
    act(type, p, who) {
        const me = who || State.username; if (!this.ref || !me) return;
        this.ref.transaction((v) => {
            if (!v || !this.isLive(v) || v.order[v.turn] !== me) return;
            if (who && Date.now() - (v.turnAt || 0) < this.IDLE_MS) return;
            v.played = v.played || {}; v.fin = v.fin || {}; v.folded = v.folded || {};
            const first = !((v.played[me] || 0) > 0), hand = v.hands[me].slice(), widow = v.widow.slice(); let note;
            if (type === "close") {
                if (v.phase !== "play") return;
                v.phase = "final"; v.closer = me; note = `${me} called \u201CMe hasta aqu\u00ED\u201D \u2014 final cycle begins`;
            } else if (type === "swapall") {
                if (!first || v.up) return;
                v.fx = { id: Date.now() + "-" + Math.floor(Math.random() * 1e6), u: me, t: "all", was: 0, at: Date.now() };
                v.hands[me] = widow; v.widow = hand; v.up = 1; note = `${me} swapped all 5 cards with La Viuda`;
            } else if (type === "swap1") {
                const h = p && p.h, w = p && p.w;
                if ((!v.up && !first) || !(h >= 0 && h < 5) || !(w >= 0 && w < 5)) return;
                v.fx = { id: Date.now() + "-" + Math.floor(Math.random() * 1e6), u: me, t: "one", h, w, was: v.up ? 1 : 0, at: Date.now() };
                const t = hand[h]; hand[h] = widow[w]; widow[w] = t; v.hands[me] = hand; v.widow = widow; note = v.up ? `${me} swapped 1 card with La Viuda` : `${me} swapped 1 card with a hidden La Viuda card`;
            } else if (type === "fold") {
                v.folded[me] = 1; note = `${me} folded`;
            } else if (type === "pass") { note = `${me} passed`; } else return;
            v.played[me] = (v.played[me] || 0) + 1; v.last = note;
            if (type !== "close" && v.phase === "final") v.fin[me] = 1;
            const alive = v.order.filter((u) => !v.folded[u]);
            if (type === "fold" && (alive.length <= 1)) return this.finish(v);
            let nxt = (v.turn + 1) % v.order.length;
            for (let k = 0; k < v.order.length && v.folded[v.order[nxt]]; k += 1) nxt = (nxt + 1) % v.order.length;
            if (v.phase === "final" && v.order[nxt] === v.closer) return this.finish(v);
            v.turn = nxt; v.turnAt = Date.now(); return v;
        }).then((r) => { this.settle(r); this.sel = { h: null, w: null }; }).catch(() => { });
    },
    kick() {
        const g = this.g, u = g.order && g.order[g.turn];
        if (!u || u === State.username || !this.isLive(g)) return;
        if (Date.now() - (g.turnAt || 0) < this.IDLE_MS) return Notify.warning("Give them a little longer.");
        this.act("pass", null, u);
    },
    finish(v) {
        const fold = v.folded || {}, live = v.order.filter((u) => !fold[u]), all = v.house ? live.concat(HOUSE) : live;
        const sc = all.map((u) => this.eval5(v.hands[u])), top = sc.reduce((a, b) => (this.cmp(a, b) >= 0 ? a : b));
        const winners = all.filter((u, i) => this.cmp(sc[i], top) === 0), pot = v.pot, each = Math.floor(pot / winners.length), shares = {}, cats = {}, cidx = {};
        winners.forEach((u, i) => { shares[u] = each + (i === 0 ? pot - each * winners.length : 0); });
        all.forEach((u, i) => { cats[u] = this.CATS[sc[i][0]]; cidx[u] = sc[i][0]; });
        v.order.forEach((u) => { if (fold[u]) { cats[u] = "Folded"; cidx[u] = 0; } });
        const byFold = v.house ? live.length === 0 : live.length <= 1;
        v.phase = "done"; v.turnAt = Date.now(); v.res = { winners, pot, best: byFold ? (v.house ? "The House by fold" : "Everyone else folded") : this.CATS[top[0]], cats, cidx, shares, byFold: byFold ? 1 : 0 };
        return v;
    },
    settle(r) {
        if (!r || !r.committed) return;
        const v = r.snapshot.val(); if (!v || v.phase !== "done" || !v.res) return;
        Object.keys(v.res.shares).filter((u) => u !== HOUSE).forEach((u) => Room.playersRef.child(u).child("balance").transaction((b) => (b == null ? b : b + v.res.shares[u])));
    },
    eval5(cs) {
        const rk = cs.map((c) => c % 13).sort((a, b) => b - a), su = cs.map((c) => (c / 13) | 0), fl = su.every((s) => s === su[0]), cnt = {};
        rk.forEach((r) => { cnt[r] = (cnt[r] || 0) + 1; });
        const gr = Object.keys(cnt).map(Number).sort((a, b) => cnt[b] - cnt[a] || b - a), shape = gr.map((r) => cnt[r]).join("");
        const uniq = gr.length === 5, st = uniq && rk[0] - rk[4] === 4, wheel = uniq && rk.join() === "12,3,2,1,0", hi = wheel ? 3 : rk[0];
        let cat = 0;
        if (st || wheel) cat = fl ? (hi === 12 ? 9 : 8) : 4;
        else if (shape === "41") cat = 7; else if (shape === "32") cat = 6; else if (fl) cat = 5;
        else if (shape === "311") cat = 3; else if (shape === "221") cat = 2; else if (shape === "2111") cat = 1;
        return [cat, ...((st || wheel) ? [hi] : gr)];
    },
    cmp(a, b) { for (let i = 0; i < Math.max(a.length, b.length); i += 1) { const d = (a[i] || 0) - (b[i] || 0); if (d) return d; } return 0; },
    sync() {
        const g = this.g, me = State.username;
        if (g.phase !== "done") this.closeResult();
        if (!me || !g.hid) return;
        if (this.hid !== g.hid) { this.hid = g.hid; this.paid = Number(this.store(`bw-paid-${Room.code}-${g.hid}-${me}`)) || 0; }
        const owed = ((g.in || {})[me] || 0) - this.paid;
        if (owed > 0) { State.debit(Math.min(owed, State.balance)); this.paid += owed; this.store(`bw-paid-${Room.code}-${g.hid}-${me}`, String(this.paid)); }
        if (g.phase !== "done" || !g.res) return;
        const doneKey = `bw-done-${Room.code}-${g.hid}-${me}`;
        if ((g.order || []).includes(me) && !this.store(doneKey)) {
            this.store(doneKey, "1");
            const share = (g.res.shares || {})[me] || 0, stake = this.paid, cat = ((g.res.cidx || {})[me]) || 0;
            resolveGameOutcome("blackwidow", { roundId: g.hid + "-" + me, entries: [{ wager: stake, payout: share, credited: true }] });
            if (this.statsRef) {
                this.statsRef.child(me).transaction((s) => {
                    s = s || { hands: 0, wins: 0, net: 0, best: 0 };
                    s.hands = (s.hands || 0) + 1; if (share > 0) s.wins = (s.wins || 0) + 1;
                    s.net = (s.net || 0) + share - stake; s.best = Math.max(s.best || 0, cat); return s;
                });
            }
            if (share > 0) { Effects.celebrate(`\u2660 ${g.res.best} \u2014 you win ${share}!`); this.sparkle(); Notify.success(`You won ${share} chips!`); }
        }
        if (this.shown !== g.hid) {
            this.shown = g.hid;
            window.setTimeout(() => { if (this.g.hid === g.hid && this.g.phase === "done" && Router.currentGameKey === "blackwidow") this.openResult(); }, 1800);
        }
    },
    sparkle() {
        for (let i = 0; i < 30; i += 1) {
            const s = document.createElement("span"); s.className = "spark"; s.style.left = (30 + Math.random() * 40) + "vw"; s.style.top = (30 + Math.random() * 30) + "vh";
            s.style.setProperty("--sx", ((Math.random() - 0.5) * 320) + "px"); s.style.setProperty("--sy", ((Math.random() - 0.5) * 320) + "px");
            s.addEventListener("animationend", () => s.remove()); document.body.appendChild(s);
        }
    },
    card(key, c, up) {
        const d = document.createElement("div"), inn = document.createElement("div"), f = document.createElement("div"), b = document.createElement("div");
        d.className = "bw-card"; d.dataset.k = key; inn.className = "bw-in"; f.className = "bw-face bw-front"; b.className = "bw-face bw-back";
        if (up && c >= 0) {
            const s = (c / 13) | 0, rk = this.R[c % 13], t = document.createElement("b"), i = document.createElement("i");
            t.textContent = rk === "T" ? "10" : rk; i.textContent = this.S[s]; f.append(t, i);
            if (s === 1 || s === 2) d.classList.add("red");
        }
        inn.append(f, b); d.appendChild(inn);
        const was = this.faces[key]; this.faces[key] = !!up;
        if (up && was === false) window.requestAnimationFrame(() => window.requestAnimationFrame(() => d.classList.add("up")));
        else if (up) d.classList.add("up");
        return d;
    },
    makePick(cd, kind, i, label) {
        cd.classList.add("pick"); if (this.sel[kind] === i) cd.classList.add("sel");
        cd.tabIndex = 0; cd.setAttribute("role", "button"); cd.setAttribute("aria-label", label); cd.setAttribute("aria-pressed", this.sel[kind] === i ? "true" : "false");
        const go = () => { this.sel[kind] = this.sel[kind] === i ? null : i; this.render(); };
        cd.addEventListener("click", go);
    },
    render() {
        if (CardFX.deferRender(this)) return;
        const g = this.g, inHand = this.isLive(g) || (g.phase === "done" && !!g.res), lobby = !Tables.isOpen(g) || !inHand;
        const lEl = this.$("bw-lobby"), vEl = this.$("bw-live");
        if (lEl) lEl.hidden = !lobby; if (vEl) vEl.hidden = lobby;
        if (lobby) {
            Tables.renderLobby(this.$("bw-lobby"), g, {
                title: "La Viuda Negra table", game: "Black Widow Poker", max: this.MAX_SEATS, minStart: 1,
                soloNote: `Just you so far. Start now to play against The House (ante ${this.ANTE}), or wait.`,
                onOpen: () => this.openTable(), onTake: (k) => this.take(k), onLeave: () => this.leave(),
                onStart: () => this.deal(), onClose: () => this.closeTable(), onClaim: () => Tables.claim(this.ref, State.username)
            });
            this.dealt = g.hid; return;
        }
        this.seq = 0;
        this.renderWidow(); this.renderSeats();
        CardFX.flush(document.getElementById("bw-deck"), 95);
        this.renderControls(); this.renderStats();
        this.dealt = g.hid;
    },
    renderWidow() {
        const g = this.g, me = State.username, live = this.isLive(g), inHand = live || (g.phase === "done" && !!g.res);
        const wrap = this.$("bw-widow-wrap"), el = this.$("bw-widow"); if (!wrap || !el) return;
        wrap.hidden = !inHand; el.textContent = "";
        if (!inHand) return;
        const canPick = this.canSwap1(g, me), up = !!g.up;
        if (!canPick) this.sel.w = null;
        (g.widow || []).forEach((c, i) => {
            const cd = this.card("w" + i, c, up);
            if (canPick) this.makePick(cd, "w", i, "La Viuda card " + (i + 1));
            el.appendChild(cd);
        });
        const lbl = this.$("bw-widow-label");
        if (lbl) lbl.textContent = up ? "La Viuda \u2014 Face-up" : "La Viuda \u2014 Face-down";
    },
    renderSeats() {
        const g = this.g, me = State.username, el = this.$("bw-seats"), live = this.isLive(g), inHand = live || (g.phase === "done" && !!g.res);
        if (!el) return;
        const names = inHand ? (g.order || []).slice() : Tables.names(g.seats), canPick = this.canSwap1(g, me), done = g.phase === "done", fold = g.folded || {};
        if (inHand && g.house) names.push(HOUSE);
        if (!canPick) this.sel.h = null;
        el.textContent = "";
        names.forEach((u) => {
            const won = done && g.res && g.res.winners.includes(u), house = u === HOUSE, folded = !!fold[u], turn = live && g.order[g.turn] === u, d = document.createElement("div");
            d.className = "bw-seat" + (u === me ? " me" : "") + (turn ? " turn" : "") + (won ? " win" : "") + (folded ? " out" : "");
            const n = document.createElement("div"); n.className = "bw-name"; n.append((turn ? "\u25B6 " : "") + this.nm(u) + (u === me ? " (you)" : ""));
            const tag = (t, cls) => { const s = document.createElement("span"); s.className = "bw-tag " + (cls || ""); s.textContent = t; n.appendChild(s); };
            if (u === g.owner) tag("Host");
            if (inHand) {
                if (house) tag("solo opponent");
                else {
                    if (folded) tag("Folded", "st-folded"); else if (turn) tag("Playing", "st-playing"); else if (!done) tag("Waiting", "st-waiting");
                }
                if (done && g.res && g.res.cats && g.res.cats[u] && !folded && !g.res.byFold) tag(g.res.cats[u]);
            }
            d.appendChild(n);
            if (inHand) {
                const h = document.createElement("div"), face = (u === me && !house) || (done && !folded && !g.res.byFold); h.className = "bw-hand";
                (g.hands[u] || []).forEach((c, ci) => {
                    const cd = this.card(u + ":" + ci, c, face);
                    if (u === me && canPick) this.makePick(cd, "h", ci, "Your card " + (ci + 1));
                    h.appendChild(cd);
                });
                d.appendChild(h);
            }
            el.appendChild(d);
        });
    },
    renderControls() {
        const g = this.g, me = State.username, names = Tables.names(g.seats), seated = names.includes(me), live = this.isLive(g);
        const inHand = live || (g.phase === "done" && !!g.res), inOrder = inHand && (g.order || []).includes(me), who = live ? g.order[g.turn] : null, myTurn = who === me;
        const final = g.phase === "final", folded = !!(g.folded || {})[me];
        if (!this.$("bw-pot")) return;
        this.$("bw-pot").textContent = "Pot " + (inHand ? g.pot : 0).toLocaleString("en-US");
        this.$("bw-phase").textContent = { play: "Open play", final: `Final cycle \u2014 ${g.closer} closed`, done: "Showdown" }[g.phase] || "Waiting for players";
        const logEl = this.$("bw-log"); if (logEl) logEl.textContent = inHand && g.last ? g.last : "";

        const drive = Tables.canDrive(g, me);
        const deal = this.$("bw-deal"); if (deal) deal.hidden = !(g.phase === "done" && seated);
        const back = this.$("bw-lobby-back"); if (back) back.hidden = !(g.phase === "done" && g.owner === me);
        const leave = this.$("bw-leave"); if (leave) { leave.hidden = !seated; leave.disabled = live && inOrder; }

        const acting = live && inOrder && !folded;
        const turnBox = this.$("bw-turn-actions"); if (turnBox) turnBox.hidden = !acting;

        const btnPass = this.$("bw-pass"); if (btnPass) btnPass.disabled = !myTurn;
        const btnSwapAll = this.$("bw-swapall"); if (btnSwapAll) btnSwapAll.disabled = !this.canSwapAll(g, me);
        const btnSwap1 = this.$("bw-swap1"); if (btnSwap1) btnSwap1.disabled = !(this.canSwap1(g, me) && this.sel.h !== null && this.sel.w !== null);
        const btnFold = this.$("bw-fold"); if (btnFold) btnFold.disabled = !myTurn;
        const btnClose = this.$("bw-close"); if (btnClose) { btnClose.disabled = !(myTurn && g.phase === "play"); btnClose.hidden = !acting || final; }
    },
    renderStats() {
        const el = this.$("bw-stats"); if (!el) return;
        const rows = Object.keys(this.stats || {}).map((u) => ({ u, s: this.stats[u] })).sort((a, b) => (b.s.wins || 0) - (a.s.wins || 0) || (b.s.net || 0) - (a.s.net || 0));
        el.textContent = ""; el.hidden = !rows.length; if (!rows.length) return;
        const h = document.createElement("h3"); h.textContent = "Table stats"; el.appendChild(h);
        const t = document.createElement("table"), hd = t.createTHead().insertRow();
        ["Player", "Hands", "Wins", "Net chips", "Best hand"].forEach((x) => { const c = document.createElement("th"); c.textContent = x; hd.appendChild(c); });
        const tb = t.createTBody();
        rows.forEach(({ u, s }) => {
            const r = tb.insertRow(), net = s.net || 0;
            [u + (u === State.username ? " (you)" : ""), s.hands || 0, s.wins || 0, (net > 0 ? "+" : "") + net, this.CATS[s.best || 0]].forEach((x, i) => { const c = r.insertCell(); c.textContent = x; if (i === 3) c.className = net > 0 ? "pos" : net < 0 ? "neg" : ""; });
        });
        el.appendChild(t);
    },
    openResult() {
        const g = this.g; if (!g.res || g.phase !== "done") return;
        const r = g.res, body = this.$("bw-result-body"), me = State.username, fold = g.folded || {};
        const titleEl = this.$("bw-result-title"), subEl = this.$("bw-result-sub");
        if (titleEl) titleEl.textContent = r.winners.length > 1 ? "Split pot" : `${this.nm(r.winners[0])} wins`;
        if (subEl) subEl.textContent = `${r.best} \u00B7 pot ${r.pot} chips`;
        if (body) {
            body.textContent = "";
            const rows = (g.order || []).slice(); if (g.house) rows.push(HOUSE);
            rows.forEach((u) => {
                const won = r.winners.includes(u), folded = !!fold[u], row = document.createElement("div"); row.className = "bw-res-row" + (won ? " win" : "") + (folded ? " folded" : "");
                const nm = document.createElement("div"); nm.className = "bw-res-name"; nm.textContent = this.nm(u) + (u === me ? " (you)" : "");
                const ct = document.createElement("div"); ct.className = "bw-res-cat"; ct.textContent = (folded ? "Folded" : r.cats[u]) + (won ? ` \u00B7 +${r.shares[u]}` : "");
                row.append(nm, ct); body.appendChild(row);
            });
        }
        const modal = this.$("bw-result"); if (modal) modal.hidden = false;
    },
    closeResult() { const m = this.$("bw-result"); if (m && !m.hidden) m.hidden = true; }
};

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
            if (v.st !== "bet") v = { st: "bet", id: t + "-" + Math.random().toString(36).slice(2, 6), end: t + 9000, bets: {} };
            v.bets = v.bets || {}; if (v.bets[me]) { why = "Already bet."; return; }
            v.bets[me] = { s: side, a: amt }; return v;
        }, (e, ok) => { if (ok) { State.debit(amt); Sound.chip && Sound.chip(); } else if (why) Notify.warning(why); }, false);
    },
    roll() {
        zref("dice").transaction((v) => {
            if (!v || v.st !== "bet" || this.now() < v.end) return;
            const a = 1 + Math.floor(Math.random() * 6), b = 1 + Math.floor(Math.random() * 6);
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
            if (d1) d1.textContent = f[(fin ? a : 1 + Math.floor(Math.random() * 6)) - 1];
            if (d2) d2.textContent = f[(fin ? b : 1 + Math.floor(Math.random() * 6)) - 1];
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

/* =========================================================================
   14. INITIALIZATION & LIFECYCLE HOOKS
   ========================================================================= */
Blackjack.init();
Baccarat.init();
PokerDice.init();
Keno.init();
BW.init();
Dice.init();
Extra.init();

if (typeof Social !== "undefined" && Social) {
    const s0 = Social.start, s1 = Social.stop;
    Social.start = function () {
        if (s0) s0.call(Social);
        Blackjack.start();
        Baccarat.start();
        BW.start();
    };
    Social.stop = function () {
        if (s1) s1.call(Social);
        Blackjack.stop();
        Baccarat.stop();
        BW.stop();
    };
}