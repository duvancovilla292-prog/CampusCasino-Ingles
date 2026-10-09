/* =========================================================================
   CASINO CAMPUS — TRADITIONAL CASINO GAMES
   Shared card/deal engine (CardFX, Deck), the universal GameResolver (every round reports its
   outcome here), Blackjack, Roulette, Slots, Hi-Lo, Craps, Crash, Poker Dice, Money Wheel,
   La Viuda Negra (Black Widow Poker) and Quick Dice, with their betting / payout logic.
   Load order: 3 of 5 — needs firebase-sync.js and ui-audio.js.
   Classic <script> (not an ES module): top-level const / function declarations are shared
   between the five files through the page's global lexical scope, so the cross-module
   references of the original single-closure build keep working unchanged.
   ========================================================================= */
"use strict";

/* =========================================================================
   11b. CARD FX — shared dealing engine (Blackjack, La Viuda Negra)
   Cards are queued while a table renders, then flushed once: each one glides from the shoe to its
   slot along a small arc (translate3d + rotate, GPU composited) in true dealing order, then turns over.
   ========================================================================= */
const CardFX = {
    queue: [],
    until: 0,
    reduced() { return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches); },
    add(el, opts) { this.queue.push(Object.assign({ el, round: 0, ord: 0 }, opts)); },

    /** While a deal is in flight, postpone re-renders (they would rebuild the DOM and cancel the animation). */
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
        q.sort((a, b) => (a.round - b.round) || (a.ord - b.ord));   // round-robin: everyone's first card, then everyone's second...
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
        window.setTimeout(() => Sound.card(), delay + 90);
        slide.finished.then(flip, flip);
    }
};

/* =========================================================================
   12. CARD / DECK UTILITIES (shared by Blackjack and Hi-Lo)
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
   12b. UNIVERSAL GAME RESOLVER
   Every game / challenge / draw reports its outcome through ONE entry point:
  
     resolveGameOutcome(gameId, results)
  
   results (all fields optional, combine freely):
     roundId       unique id of this round (auto-generated when omitted; makes settlement idempotent)
     entries       [{ username?, wager, payout, credited? }]  per-player money result.
                   username defaults to the local player. `wager` was already debited when the bet
                   was placed; `payout` is the gross amount returned. credited:true means the payout
                   was already added to the balance by the game itself (e.g. Black Widow pot) so only
                   stats + vault fee are applied.
     winners       [username]  winners of a selection game (plinko, marble, bracket, wheel ...)
     prizePool     house-funded chips split equally between `winners` (remainder goes to rank 1)
     participants  [username]  everybody who took part (counts as a game played when chips move)
  
   For every affected player it updates balance, stats.gamesPlayed, stats.totalWagered and
   stats.netProfit with ONE atomic Firebase transaction (delta based, never an absolute overwrite).
   Payouts for players other than the local one are claimed once per round at rooms/<code>/rounds.
   ========================================================================= */
const GameResolver = {
    MAX_PRIZE: 5000,
    settled: new Set(),
    LABELS: {
        blackjack: "Blackjack", roulette: "Roulette", slots: "Slots", hilo: "Hi-Lo", craps: "Craps", crash: "Crash",
        moneywheel: "Money Wheel", pokerdice: "Poker Dice", blackwidow: "Black Widow Poker", uno: "UNO", parques: "Parqués", dominoes: "Dominoes", chess: "Chess", checkers: "Chinese Checkers", mastermind: "Color Code Breaker", bullscows: "Picas y Fijas", wheel: "Player Wheel"
    },

    label(gameId) {
        if (this.LABELS[gameId]) return this.LABELS[gameId];
        if (String(gameId).startsWith("draw:")) return "Lucky Draw";
        return String(gameId);
    },

    int(v) { const n = Math.round(Number(v)); return Number.isFinite(n) && n > 0 ? n : 0; },
    safeKey(s) { return String(s).replace(/[.#$\[\]\/\s]/g, "_").slice(0, 120); },

    /** Turns any supported results shape into [{ username, wager, payout, credited }]. */
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

    /** Host-only, house-funded prize. Returns 0 for non-hosts, selection-only draws and overridden draws. */
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

    /** Settles the local player's own entry: instant HUD update + one atomic remote delta. */
    applyLocal(e) {
        const gross = e.credited ? 0 : e.payout;
        State.balance = Math.max(0, State.balance + gross);
        const fee = e.wager > 0 ? Jackpot.rake(e.wager) : 0; // 2% vault contribution (also deducted locally)
        HUD.update();
        return Room.applyRound(e.username, {
            balance: gross - fee, gamesPlayed: 1, totalWagered: e.wager, netProfit: e.payout - e.wager - fee
        });
    },

    /** Settles other players. Only the client whose claim commits pays, so a round can never pay twice. */
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
        if (!entries.length) return Promise.resolve(summary); // selection-only round: nothing to settle

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

/** The one function every mini-game calls when a round ends. */
function resolveGameOutcome(gameId, results) { return GameResolver.resolve(gameId, results); }

document.addEventListener("game-changed", () => GameResolver.syncPrizeUi());

PubSub.on("players-updated", () => GameResolver.syncPrizeUi());

/* =========================================================================
   13. BLACKJACK — multiplayer table vs the dealer, synced at rooms/<code>/bj
   Flow: lobby (host starts) -> bets -> deal -> clockwise turns -> dealer -> payouts -> next round.
   Cards are ints 0..51 (rank = c % 13, suit = c / 13), same encoding as Black Widow.
   Chips: a bet is debited when its transaction commits; a payout is claimed exactly
   once per player through rooms/<code>/bj/paid/<name>, so reloads never double-pay.
   ========================================================================= */
const Blackjack = {
    MAX_SEATS: 5, IDLE_MS: 45000, NEXT_MS: 12000, DEAL_MS: 30000,
    R: "23456789TJQKA", S: ["\u2660", "\u2665", "\u2666", "\u2663"],
    ref: null, cb: null, tick: null, g: { phase: "lobby" }, pres: { armed: null }, ann: {}, claimed: {}, shown: {}, hid: null,
    $(id) { return document.getElementById(id); },
    isLive(g) { return g.phase === "play"; },

    init() {
        const on = (id, fn) => this.$(id).addEventListener("click", fn);
        on("btn-blackjack-bet", () => this.bet());
        on("btn-blackjack-hit", () => this.act("hit"));
        on("btn-blackjack-stand", () => this.act("stand"));
        on("btn-blackjack-double", () => this.act("double"));
        on("bj-deal", () => this.dealNow());
        on("bj-next", () => this.next());
        on("bj-lobby-back", () => this.backToLobby());
        on("bj-kick", () => this.kick());
        on("bj-leave", () => Tables.leave(this.ref, State.username));
        this.$("input-blackjack-bet").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); this.bet(); } });
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

    /* --- cards & scoring --- */
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
    /** meta: { round, ord, turnOver } — turnOver = the dealer's hole card being revealed in place (flip only, no travel). */
    renderCard(container, c, hidden, animate, meta) {
        const el = document.createElement("div");
        if (hidden) {
            el.className = "card card-back";
            container.appendChild(el);   // no face content is ever put in the DOM for a hidden card
            if (animate && meta && meta.travel) CardFX.add(el, Object.assign({ flip: false, reveal: null }, meta));
            return;
        }
        else if (animate || (meta && meta.turnOver)) { el.className = "card card-back"; }   // travels face-down, turns over on arrival
        else this.setFront(el, c);
        container.appendChild(el);
        if (hidden || !(animate || (meta && meta.turnOver))) return;
        CardFX.add(el, Object.assign({ flip: true, reveal: () => this.setFront(el, c), stay: !!(meta && meta.turnOver) }, meta));
    },
    /** holeHidden: only card #2 is face-down (dealer). allHidden: every card is face-down (other players' hands during a round). */
    fillHand(container, key, hand, holeHidden, allHidden) {
        const seen = this.shown[key] || 0; container.textContent = "";
        this.hole = this.hole || {};
        const was = this.hole[key];                       // false | "hole" | "all"
        (hand || []).forEach((c, i) => {
            const ord = key === "dealer" ? 999 : (this.seq = (this.seq || 0) + 1);
            const hid = !!allHidden || (!!holeHidden && i === 1);
            const turnOver = !hid && (was === "all" || (was === "hole" && i === 1));   // showdown: face-down cards flip over in place
            this.renderCard(container, c, hid, i >= seen, { round: i, ord, turnOver, travel: key !== "dealer" });
        });
        this.hole[key] = allHidden ? "all" : holeHidden ? "hole" : false;
        this.shown[key] = (hand || []).length;
    },

    /* --- table actions --- */
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

    /* --- betting & dealing --- */
    bet() {
        const me = State.username, g = this.g; if (!this.ref || !me) return;
        if (g.phase !== "bet" || !Tables.seatOf(g.seats, me) || (g.bets || {})[me]) return;
        const amount = Validate.parseBet(this.$("input-blackjack-bet")); if (amount === null) return;
        this.ref.transaction((v) => {
            if (!Tables.isOpen(v) || v.phase !== "bet") return;
            const names = Tables.names(v.seats); if (!names.includes(me)) return;
            v.bets = v.bets || {}; if (v.bets[me]) return;
            v.bets[me] = amount;
            return names.every((u) => v.bets[u]) ? this.deal(v) : v; // everyone is in: deal immediately
        }).then((r) => {
            if (!r.committed) return;
            const mineBet = ((r.snapshot.val() || {}).bets || {})[me];
            if (mineBet === amount) { State.debit(amount); Sound.click(); }
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
    /** Pure table-state transition: shuffles, deals two cards to every player who bet, and peeks for naturals. */
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
    /** Reveals the dealer, draws to 17 (stands on soft 17) and works out every payout. */
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

    /* --- turn actions: hit / stand / double (first two cards only) --- */
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

    /* --- payouts: each player claims their own share once --- */
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

    /* --- rendering --- */
    status(u) {
        const g = this.g, inHand = (g.order || []).includes(u), st = (g.st || {})[u], out = ((g.res || {}).out || {})[u];
        if (g.phase === "bet") return (g.bets || {})[u] ? "Bet placed" : "Betting";
        if (g.phase === "play") {
            if (!inHand) return "Sitting out";
            if (g.order[g.turn] === u) return "Playing";
            if (u !== State.username && (st === "bust" || st === "bj" || st === "stand")) return "Done";   // don't reveal bust / 21 to other players
            return { play: "Waiting", stand: "Stand", bust: "Bust", bj: "Blackjack" }[st] || "Waiting";
        }
        if (g.phase === "done") return !inHand ? "Sitting out" : ({ win: "Won", blackjack: "Blackjack", push: "Push", lose: "Lost", bust: "Bust" }[out] || "");
        return "Seated";
    },
    render() {
        if (CardFX.deferRender(this)) return;
        const g = this.g, lobby = !Tables.isOpen(g) || g.phase === "lobby";
        this.$("bj-lobby").hidden = !lobby; this.$("bj-live").hidden = lobby;
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
        if (!has) { el.textContent = ""; sc.textContent = "Dealing starts once bets are in"; return; }
        this.fillHand(el, "dealer", g.dealer, !g.up);
        sc.textContent = g.up ? `Score: ${this.score(g.dealer)}${this.score(g.dealer) > 21 ? " (bust)" : ""}` : `Showing: ${this.val(g.dealer[0])}`;
    },
    renderSeats() {
        const g = this.g, me = State.username, el = this.$("bj-seats"), live = g.phase === "play" || g.phase === "done";
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
            const hideCards = g.phase === "play" && u !== me;    // only your own cards are visible until the showdown
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
        this.$("bj-pot").textContent = "Bets " + total.toLocaleString("en-US");
        this.$("bj-phase").textContent = { bet: `Round ${g.round || 1} \u2014 place your bets`, play: `Round ${g.round || 1} \u2014 hands in play`, done: `Round ${g.round || 1} \u2014 complete` }[g.phase] || "Waiting for players";
        let msg;
        if (g.phase === "bet") msg = !seated ? "Take a seat to join the next hand." : myBet ? `Bet placed. Waiting for the others (${betsIn} of ${names.length} in).` : "Place your bet to get dealt in.";
        else if (g.phase === "play") msg = myTurn ? "Your turn: hit, stand or double down." : inHand ? `Waiting for ${who}\u2026` : `${who} is playing\u2026`;
        else { const o = ((g.res || {}).out || {})[me]; msg = o ? { blackjack: "Blackjack pays 3 to 2.", win: "You beat the dealer.", push: "Push.", lose: "The dealer wins this one.", bust: "You busted." }[o] : `Dealer finished with ${(g.res || {}).dealer}.`; }
        this.$("bj-status").textContent = msg;
        this.$("blackjack-result").textContent = g.phase === "done" && g.res ? `Dealer ${g.res.dealer > 21 ? "busts with " : "has "}${g.res.dealer}. ` + (g.order || []).map((u) => { const o = g.res.out[u], sh = g.res.shares[u] - g.bets[u]; return `${u}: ${o === "blackjack" ? "blackjack" : o}${sh ? ` (${sh > 0 ? "+" : ""}${sh})` : ""}`; }).join(" \u00B7 ") : (g.last || "");
        const canBet = g.phase === "bet" && seated && !myBet, inp = this.$("input-blackjack-bet");
        inp.disabled = !canBet; this.$("btn-blackjack-bet").disabled = !canBet;
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
   14. ROULETTE
   ========================================================================= */
const Roulette = {
    RED_NUMBERS: new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]),
    selectedChip: 10,
    selection: null,
    isSpinning: false,
    wheelRotation: 0,

    // Standard European wheel order, clockwise, starting at 0.
    WHEEL_ORDER: [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10,
        5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26],

    init() {
        this.buildWheel();
        this.buildNumberBoard();
        this.bindChipButtons();
        this.bindOutsideBets();
        DOM.btnRouletteSpin.addEventListener("click", () => this.spin());
        DOM.btnRouletteClear.addEventListener("click", () => this.clearSelection());
        this.updateBetDisplay();
    },

    /* Draws the wheel as SVG. Slot i is centred at i * step degrees clockwise
       from 12 o'clock when the wheel is unrotated, so the green 0 sits under
       the pointer at rest. Every European number (0-36) is printed in its pocket. */
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
        DOM.rouletteWheel.textContent = "";
        DOM.rouletteWheel.appendChild(svg);
    },

    /* Reads the pocket that is under the top pointer for a given rotation. This
       is the single source of truth: the payout uses this number, so the
       picture and the result cannot disagree. */
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
            el.style.transform = `rotate(${this.wheelRotation}deg)`;
            if (p < 1) window.requestAnimationFrame(tick); else done();
        };
        window.requestAnimationFrame(tick);
    },

    colorOf(number) {
        if (number === 0) return "green";
        return this.RED_NUMBERS.has(number) ? "red" : "black";
    },

    buildNumberBoard() {
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
        const chipButtons = DOM.chipPanel.querySelectorAll(".chip-btn");
        chipButtons.forEach((chip) => {
            chip.addEventListener("click", () => {
                chipButtons.forEach((c) => c.classList.remove("is-selected"));
                chip.classList.add("is-selected");
                this.selectedChip = Number.parseInt(chip.dataset.chipValue, 10);
                this.updateBetDisplay();
                Sound.click();
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
        Sound.click();
    },

    clearSelection() {
        if (this.isSpinning) return;
        this.selection = null;
        document.querySelectorAll(".roulette-number-cell.is-selected").forEach((el) => el.classList.remove("is-selected"));
        document.querySelectorAll(".roulette-color-bet.is-active, .roulette-parity-bet.is-active")
            .forEach((el) => el.classList.remove("is-active"));
        this.updateBetDisplay();
        DOM.rouletteResult.textContent = "";
    },

    updateBetDisplay() {
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
        DOM.btnRouletteSpin.disabled = true;
        DOM.rouletteResult.textContent = "";
        DOM.rouletteWheel.querySelectorAll(".rw-win").forEach((n) => n.classList.remove("rw-win"));

        // Choose the slot, then rotate so that slot's centre (+ small jitter that
        // stays inside the pocket) ends exactly under the pointer.
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
            DOM.rouletteWheel.querySelector(`[data-n="${winningNumber}"]`)?.classList.add("rw-win");
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

        if (payout > 0) {
            DOM.rouletteResult.textContent = `Winning number ${winningNumber} (${colorLabels[winningColor]}). You won ${payout} chips!`;
            Notify.success(`Roulette: ${winningNumber} ${colorLabels[winningColor]}. Won ${payout} chips.`);
            Sound.win();
            if (payout >= CONFIG.BIG_WIN_THRESHOLD) Effects.celebrate(`STRAIGHT UP! +${payout} chips`);
        } else {
            DOM.rouletteResult.textContent = `Winning number ${winningNumber} (${colorLabels[winningColor]}). Lost ${bet} chips.`;
            Notify.error(`Roulette: ${winningNumber} ${colorLabels[winningColor]}. Lost ${bet} chips.`);
            Sound.lose();
        }

        resolveGameOutcome("roulette", { entries: [{ wager: bet, payout }] });
        this.isSpinning = false;
        DOM.btnRouletteSpin.disabled = false;
    }
};

/* =========================================================================
   15. SLOT MACHINE
   ========================================================================= */
const Slots = {
    SYMBOLS: ["\u{1F352}", "\u{1F34B}", "\u{1F514}", "\u2B50", "7\uFE0F\u20E3", "\u{1F347}"],
    isSpinning: false,
    visible: [],   // [top, middle, bottom] symbols currently showing on each reel
    raf: 0,

    init() {
        DOM.btnSlotsSpin.addEventListener("click", () => this.spin());
        DOM.btnSlotsLever.addEventListener("click", () => this.spin());
        this.visible = DOM.reels.map(() => [this.randomSymbol(), this.randomSymbol(), this.randomSymbol()]);
        DOM.reels.forEach((reel, i) => this.paint(i, this.visible[i]));
    },

    randomSymbol() {
        return this.SYMBOLS[Math.floor(Math.random() * this.SYMBOLS.length)];
    },

    /** Replaces a reel's strip with exactly the given symbols (idle / landed state). */
    paint(i, symbols) {
        const strip = DOM.reels[i].querySelector(".sm-strip");
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
        if (this.isSpinning) return;

        const bet = Validate.parseBet(DOM.inputSlotsBet);
        if (bet === null) return;

        State.debit(bet);
        this.isSpinning = true;
        DOM.btnSlotsSpin.disabled = true;
        DOM.btnSlotsLever.disabled = true;
        DOM.btnSlotsLever.classList.add("lever-pulled");
        window.setTimeout(() => DOM.btnSlotsLever.classList.remove("lever-pulled"), 260);
        DOM.slotsResult.textContent = "";
        DOM.reels.forEach((r) => r.classList.remove("is-win", "is-locked"));
        Sound.click();

        const results = [this.randomSymbol(), this.randomSymbol(), this.randomSymbol()];
        this.animate(results).then(() => this.resolveSpin(bet, results));
    },

    /**
     * Vertical reel physics. Per reel: short wind-up pull, accelerate to cruise speed, brake with an
     * ease-out curve that overshoots the stop line, then a damped-spring bounce that locks the symbol in.
     * Speed drives a streak overlay (motion blur without CSS filters), so text is crisp whenever it is slow.
     */
    animate(results) {
        const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        const H = DOM.reels[0].clientHeight / 3 || 76;
        const V0 = 1.9, ACC = 260, DEC = 760, OVER = H * 0.22, WIND = 150, SPRING = 480;
        DOM.reels[0].parentElement.classList.add("is-spinning");

        const reels = DOM.reels.map((reel, i) => {
            const strip = reel.querySelector(".sm-strip"), streak = reel.querySelector(".sm-streak");
            const cruise0 = (reduce ? 120 : 520 + i * 460);
            const decDist = V0 * DEC / 3, accDist = V0 * ACC / 2;
            const rows = Math.ceil((accDist + decDist + cruise0 * V0) / H);
            const F = rows * H, target = F + OVER;
            const cruise = Math.max(0, (target - accDist - decDist) / V0);
            // Strip: [pad][final top, mid, bottom][filler...][previous top, mid, bottom]
            const n = rows + 4, items = new Array(n);
            items[0] = this.randomSymbol();
            for (let k = 1; k < n - 3; k += 1) items[k] = this.randomSymbol();
            const fin = [this.randomSymbol(), results[i], this.randomSymbol()];
            items[1] = fin[0]; items[2] = fin[1]; items[3] = fin[2];
            this.visible[i].forEach((sym, k) => { items[n - 3 + k] = sym; });
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
            if (t < r.tWind) return -14 * Math.sin((t / r.tWind) * Math.PI / 2);        // anticipation pull-back
            let u = t - r.tWind;
            const wound = -14;
            if (u < r.tAcc) return wound * (1 - u / r.tAcc) + V0 * u * u / (2 * r.tAcc);      // spin-up
            u -= r.tAcc;
            if (u < r.cruise) return r.accDist + V0 * u;                                  // cruise
            u -= r.cruise;
            const start = r.accDist + V0 * r.cruise;
            if (u < r.tDec) { const q = u / r.tDec; return start + r.decDist * (1 - Math.pow(1 - q, 3)); }   // brake past the line
            u -= r.tDec;
            const s = Math.min(1, u / SPRING);                                            // damped-spring lock-in
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
                    const v = Math.abs(pos - r.pos) / dt;                                      // px per ms
                    r.pos = pos;
                    const y = Math.round((pos - r.base) * 100) / 100;
                    r.strip.style.transform = `translate3d(0,${y}px,0)`;
                    const sp = Math.min(1, Math.max(0, (v - 0.35) / 1.2));
                    r.streak.style.opacity = sp.toFixed(2);
                    r.strip.style.opacity = (1 - 0.35 * sp).toFixed(2);
                    const row = Math.floor(pos / r.H);
                    if (r.i === 0 && row !== r.lastRow && v > 0.3) { Sound.tick(row); }
                    r.lastRow = row;
                    if (t >= te) {
                        r.done = true;
                        r.strip.style.transform = `translate3d(0,${-(r.base - r.F)}px,0)`;
                        r.strip.style.opacity = "1"; r.streak.style.opacity = "0";
                        r.reel.classList.add("is-locked");
                        Sound.tone(150, 70, "triangle", 0.07);
                    } else all = false;
                });
                if (all) {
                    DOM.reels[0].parentElement.classList.remove("is-spinning");
                    // collapse each strip to the three landed symbols so the DOM stays tiny
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

        if (a === b && b === c) {
            payout = bet * 10;
        } else if (a === b || b === c || a === c) {
            payout = bet * 2;
        }

        if (payout > 0) {
            DOM.reels.forEach((reel, i) => {
                const hit = (a === b && b === c) || results.filter((x) => x === results[i]).length > 1;
                if (hit) reel.classList.add("is-win");
            });
            DOM.slotsResult.textContent = `${results.join(" ")} \u2014 Winning combination! You won ${payout} chips.`;
            Notify.success(`Slots: won ${payout} chips.`);
            Sound.win();
            if (a === b && b === c) Effects.celebrate(`JACKPOT! +${payout} chips`);
        } else {
            DOM.slotsResult.textContent = `${results.join(" ")} \u2014 No match. Lost ${bet} chips.`;
            Notify.error(`Slots: lost ${bet} chips.`);
            Sound.lose();
        }

        resolveGameOutcome("slots", { entries: [{ wager: bet, payout }] });
        this.isSpinning = false;
        DOM.btnSlotsSpin.disabled = false;
        DOM.btnSlotsLever.disabled = false;
    }
};

/* =========================================================================
   16. HI-LO
   ========================================================================= */
const HiLo = {
    currentCard: null,
    isResolving: false,

    init() {
        this.currentCard = this.drawCard();
        this.renderCurrentCard();
        DOM.btnHiloHigher.addEventListener("click", () => this.guess("higher"));
        DOM.btnHiloLower.addEventListener("click", () => this.guess("lower"));
    },

    /** Two-stage 3D flip: the card turns edge-on, the face is swapped while it is invisible, then it turns back. */
    flip(el, apply, ms = 210) {
        const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        if (reduce || !el.animate) { apply(); return Promise.resolve(); }
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
        if (!card) { el.textContent = "?"; el.classList.add("hilo-card-hidden"); el.classList.remove("card-red", "card-black"); return; }
        el.textContent = `${card.rank}${card.suit}`;
        el.classList.remove("hilo-card-hidden");
        el.classList.toggle("card-red", Deck.isRedSuit(card.suit));
        el.classList.toggle("card-black", !Deck.isRedSuit(card.suit));
    },
    /** After the result has been shown: the new card slides into the "current" slot with a flip, the next slot flips face-down again. */
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
        DOM.hiloCurrentCard.textContent = `${this.currentCard.rank}${this.currentCard.suit}`;
        DOM.hiloCurrentCard.classList.toggle("card-red", Deck.isRedSuit(this.currentCard.suit));
        DOM.hiloCurrentCard.classList.toggle("card-black", !Deck.isRedSuit(this.currentCard.suit));
        DOM.hiloNextCard.textContent = "?";
        DOM.hiloNextCard.classList.add("hilo-card-hidden");
        DOM.hiloNextCard.classList.remove("card-red", "card-black");
    },

    guess(direction) {
        if (this.isResolving) return;

        const bet = Validate.parseBet(DOM.inputHiloBet);
        if (bet === null) return;

        State.debit(bet);
        this.isResolving = true;
        DOM.hiloResult.textContent = "";

        const nextCard = this.drawCard();
        // flip the hidden card over, hold a beat so the player can read it, then resolve
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

        if (!isHigher && !isLower) {
            payout = bet;
            DOM.hiloResult.textContent = `Push on ${nextCard.rank}${nextCard.suit}. Bet returned.`;
            Notify.warning("Hi-Lo: push, bet returned.");
        } else if (guessedCorrectly) {
            payout = bet * 2;
            DOM.hiloResult.textContent = `Correct! ${nextCard.rank}${nextCard.suit} was ${directionLabel}. You won ${payout} chips.`;
            Notify.success(`Hi-Lo: won ${payout} chips.`);
            Sound.win();
            if (payout >= CONFIG.BIG_WIN_THRESHOLD) Effects.celebrate(`NICE CALL! +${payout} chips`);
        } else {
            DOM.hiloResult.textContent = `Wrong! ${nextCard.rank}${nextCard.suit} was not ${directionLabel}. Lost ${bet} chips.`;
            Notify.error(`Hi-Lo: lost ${bet} chips.`);
            Sound.lose();
        }

        resolveGameOutcome("hilo", { entries: [{ wager: bet, payout }] });
        this.advanceCard(nextCard).then(() => { this.isResolving = false; });
    }
};

/* =========================================================================
   21b. EXTRA — feedback FX, new casino games, new Lucky Draw modes
   ========================================================================= */
const Extra = (() => {
    const $ = (s) => document.querySelector(s);
    const mk = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };
    const rnd = (a, b) => a + Math.random() * (b - a);
    const pick = (a) => a[Math.floor(Math.random() * a.length)];
    const shuffle = (a) => LuckyDraw.shuffle(a);
    const RM = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const buzz = (ms) => { if (!RM) try { navigator.vibrate && navigator.vibrate(ms); } catch (e) { /* unsupported */ } };
    const shake = (el, ms = 25) => { if (RM) return; el.classList.remove("fx-shake"); void el.offsetWidth; el.classList.add("fx-shake"); buzz(ms); };

    /** DOM spark burst inside a position:relative host. */
    const domBurst = (host, x, y, n = 14) => {
        if (RM) return;
        for (let i = 0; i < n; i += 1) {
            const s = mk("i", "fx-spark"); s.style.left = x + "px"; s.style.top = y + "px"; host.append(s);
            const a = rnd(0, 6.283), d = rnd(30, 95);
            s.animate([{ transform: "translate(0,0) scale(1)", opacity: 1 }, { transform: `translate(${Math.cos(a) * d}px,${Math.sin(a) * d + 20}px) scale(.2)`, opacity: 0 }],
                { duration: rnd(450, 800), easing: "cubic-bezier(.2,.8,.4,1)" }).onfinish = () => s.remove();
        }
    };

    /** Canvas particle system. */
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
        const sec = $("#game-" + key);
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
        g.res.textContent = `${msg} ${net > 0 ? "You won " + payout + " chips." : net === 0 ? "Bet returned." : "Lost " + bet + " chips."}`;
        if (net > 0) { Notify.success(`${name}: won ${payout} chips.`); Sound.win(); if (payout >= CONFIG.BIG_WIN_THRESHOLD) Effects.celebrate(`${name.toUpperCase()}! +${payout} chips`); }
        else if (net < 0) { Notify.error(`${name}: lost ${bet} chips.`); Sound.lose(); } else Notify.warning(`${name}: push.`);
    };

    /* ------------------------------ CRAPS ------------------------------ */
    const PIPS = { 1: [[0, 0]], 2: [[-1, -1], [1, 1]], 3: [[-1, -1], [0, 0], [1, 1]], 4: [[-1, -1], [1, -1], [-1, 1], [1, 1]], 5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]], 6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]] };
    const drawDie = (ctx, x, y, size, rot, face, lift) => {
        ctx.save(); ctx.fillStyle = "rgba(0,0,0,.35)"; ctx.beginPath(); ctx.ellipse(x, y + size * 0.62, size * (0.5 - lift * 0.1), size * 0.12, 0, 0, 6.283); ctx.fill(); ctx.restore();
        ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.fillStyle = "#f7f2e6"; ctx.strokeStyle = "#b8860b"; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.roundRect(-size / 2, -size / 2, size, size, 10); ctx.fill(); ctx.stroke();
        ctx.fillStyle = "#14171c"; PIPS[face].forEach(([px, py]) => { ctx.beginPath(); ctx.arc(px * size * 0.26, py * size * 0.26, size * 0.075, 0, 6.283); ctx.fill(); });
        ctx.restore();
    };
    const craps = () => {
        const g = shell("craps", "Craps / Dice Betting", "Pick a total (2–12) or an outcome, then roll. 7 loses High/Low.");
        const PAY = { 2: 30, 3: 15, 4: 10, 5: 8, 6: 6, 7: 5, 8: 6, 9: 8, 10: 10, 11: 15, 12: 30 };
        const types = [...Object.keys(PAY).map((n) => ({ label: n, mult: PAY[n], win: (t) => t === Number(n) })),
        { label: "Even", mult: 2, win: (t) => t % 2 === 0 }, { label: "Odd", mult: 2, win: (t) => t % 2 === 1 },
        { label: "Low 2-6", mult: 2, win: (t) => t < 7 }, { label: "High 8-12", mult: 2, win: (t) => t > 7 }];
        let sel = types[5], busy = false; const bs = [];
        const cv = canvas(g.stage, 360, 200); const { ctx, w, h } = cv, P = new Particles();
        const still = (a, b) => { felt(ctx, w, h); drawDie(ctx, 110, h - 50, 64, 0, a, 0); drawDie(ctx, 250, h - 50, 64, 0, b, 0); };
        still(3, 4);
        const grid = mk("div", "xg-controls");
        types.forEach((t) => { const b = btn("", "btn btn-game-select xg-chipbtn"); b.append(t.label, Object.assign(mk("small"), { textContent: t.mult + "x" })); b.setAttribute("aria-pressed", String(t === sel)); b.addEventListener("click", () => { if (busy) return; sel = t; bs.forEach((x, i) => x.setAttribute("aria-pressed", String(types[i] === t))); }); bs.push(b); grid.append(b); });
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

    /* ------------------------------- CRASH ------------------------------ */
    const crash = () => {
        const g = shell("crash", "Crash / The Rocket", "The multiplier climbs from 1.00x. Cash out before the rocket explodes!");
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

    /* ---------------------------- POKER DICE ---------------------------- */
    const FACES = ["A", "K", "Q", "J", "10", "9"];
    const evalHand = (v) => {
        const c = {}; v.forEach((x) => { c[x] = (c[x] || 0) + 1; });
        const grp = Object.entries(c).map(([f, n]) => [n, 6 - Number(f)]).sort((a, b) => b[0] - a[0] || b[1] - a[1]);
        const pat = grp.map((x) => x[0]).join(""), u = [...new Set(v)].sort((a, b) => a - b);
        const straight = u.length === 5 && u[4] - u[0] === 4;
        const [cat, name] = pat === "5" ? [7, "Five of a Kind"] : pat === "41" ? [6, "Four of a Kind"] : pat === "32" ? [5, "Full House"] : straight ? [4, "Straight"] : pat === "311" ? [3, "Three of a Kind"] : pat === "221" ? [2, "Two Pair"] : pat === "2111" ? [1, "One Pair"] : [0, "High Card"];
        return { cat, name, score: cat * 1e6 + grp.reduce((a, x) => a * 10 + x[1], 0) };
    };
    const pokerDice = () => {
        const g = shell("pokerdice", "Poker Dice", "Roll 5 dice, hold what you like, reroll once, and beat the dealer's hand. Full House or better pays 3x.");
        const row = mk("div", "pd-row"), dealer = mk("div", "pd-dealer"); g.stage.style.flexDirection = "column"; g.stage.style.gap = "0.75rem"; g.stage.append(row, dealer);
        let vals = [], held = [false, false, false, false, false], phase = "idle", bet = 0;
        const dice = [0, 1, 2, 3, 4].map((i) => { const d = btn("?", "pd-die"); d.addEventListener("click", () => { if (phase !== "rolled") return; held[i] = !held[i]; d.classList.toggle("is-held", held[i]); }); row.append(d); return d; });
        const r6 = () => Math.floor(Math.random() * 6);
        const paint = (changed) => dice.forEach((d, i) => { d.textContent = FACES[vals[i]]; d.classList.toggle("is-held", held[i]); if (changed.includes(i)) { d.classList.remove("pd-roll"); void d.offsetWidth; d.classList.add("pd-roll"); } });
        const deal = btn("🎲 Roll", "btn btn-primary", () => {
            if (phase !== "idle") return; const b = Validate.parseBet(g.bet); if (b === null) return;
            State.debit(b); bet = b; vals = [0, 1, 2, 3, 4].map(r6); held = held.map(() => false); phase = "rolled"; g.res.textContent = ""; dealer.textContent = "";
            paint([0, 1, 2, 3, 4]); buzz(20); again.disabled = stand.disabled = false; deal.disabled = true;
        });
        const finish = () => {
            phase = "idle"; again.disabled = stand.disabled = true; deal.disabled = false;
            let dv = [0, 1, 2, 3, 4].map(r6); const cnt = {}; dv.forEach((x) => { cnt[x] = (cnt[x] || 0) + 1; });
            const top = Number(Object.entries(cnt).sort((a, b) => b[1] - a[1])[0][0]); dv = dv.map((x) => (cnt[top] > 1 && x !== top ? r6() : x));
            const me = evalHand(vals), dl = evalHand(dv);
            dealer.replaceChildren(document.createTextNode(`Dealer: ${dl.name} `), ...dv.map((x) => mk("span", "pd-die", FACES[x])));
            const win = me.score > dl.score, tie = me.score === dl.score;
            if (win) { domBurst(g.stage, g.stage.clientWidth / 2, 40, 18); shake(g.stage, 25); }
            settle(g, "Poker Dice", bet, win ? bet * (me.cat >= 5 ? 3 : 2) : tie ? bet : 0, `You: ${me.name} vs Dealer: ${dl.name}.`);
        };
        const again = btn("🔁 Reroll Unheld", "btn btn-secondary", () => { if (phase !== "rolled") return; const ch = []; vals = vals.map((v, i) => { if (held[i]) return v; ch.push(i); return r6(); }); paint(ch); buzz(20); window.setTimeout(finish, 500); phase = "wait"; });
        const stand = btn("✋ Stand", "btn btn-secondary", () => { if (phase === "rolled") finish(); });
        again.disabled = stand.disabled = true; g.ctl.append(g.lab, deal, again, stand);
        vals = [0, 1, 2, 3, 4]; paint([]); dice.forEach((d) => { d.textContent = "?"; });
    };

    /* ---------------------------- MONEY WHEEL --------------------------- */
    const moneyWheel = () => {
        const g = shell("moneywheel", "Money Wheel", "Stake chips on one or more multipliers, then spin. A hit pays stake × (multiplier + 1).");
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

    /* ------------------- LUCKY DRAW: history + fx + modes ------------------ */
    const MODE_LABEL = { slots: "Slot Reels", bingo: "Bingo Blower", cards: "Card Dealer", laser: "Chip Laser", bracket: "1v1 Bracket", plinko: "Plinko", marble: "Marble Race", chests: "Mystery Chests", roles: "Roles Matrix" };
    const ROLES = ["Leader", "Speaker", "Evaluator", "Writer", "Timekeeper", "Reporter"];
    const installDraw = () => {
        const history = [], listEl = $("#draw-history-list");
        const renderHistory = () => {
            listEl.replaceChildren();
            if (!history.length) { listEl.append(mk("li", "draw-history-empty", "No draws yet this session.")); return; }
            history.forEach((h) => { const li = mk("li"); li.append(mk("time", "", h.time), document.createTextNode(`${h.mode}: ${h.names.join(", ")}`)); listEl.append(li); });
        };
        $("#btn-history-clear").addEventListener("click", () => { history.length = 0; renderHistory(); });
        const origAnnounce = LuckyDraw.announce;
        Object.assign(LuckyDraw.IDLE, { bracket: ["🏆", "Random 1v1 knockout matches until a champion emerges."], plinko: ["🔵", "Named chips drop through pegs into the golden selection bins."], chests: ["🎁", "Tap the chests to reveal the selected players."], roles: ["🧩", "Winners are matched with team roles by a slot matrix."] });
        Object.assign(LuckyDraw, {
            logDraw(names) { history.unshift({ time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), mode: MODE_LABEL[this.mode], names: names.slice() }); if (history.length > 15) history.pop(); renderHistory(); },
            /* Contact feedback: every time a name lands in a selection zone, burst + shake + vibrate. */
            announce(name, rank) {
                origAnnounce.call(this, name, rank);
                const s = this.el.stage, r = s.getBoundingClientRect(), k = rank || 0;
                domBurst(s, r.width / 2 + (k % 3 - 1) * 50, this.mode === "bingo" ? 40 : r.height - 70, 16); shake(s, 30);
            },

            async runBracket(names, winners, id) {
                const pool = shuffle(names).slice(0, 16);   // shuffle() keeps the chosen winner at index 0, so they are never cut
                if (pool.length < 2) { winners.splice(0, winners.length, pool[0]); this.announce(pool[0], 0); return; }
                const size = 2 ** Math.ceil(Math.log2(pool.length)), byes = size - pool.length, slots = []; let pi = 0;
                for (let m = 0; m < size / 2; m += 1) slots.push(pool[pi++], m < byes ? null : pool[pi++]);
                const rounds = [], losers = []; let cur = slots;
                while (cur.length > 1) {
                    const nxt = [], ms = [];
                    for (let m = 0; m < cur.length / 2; m += 1) { const a = cur[2 * m], b = cur[2 * m + 1], rigged = Rig.on && (a === Rig.target || b === Rig.target), win = !b ? a : !a ? b : rigged ? Rig.target : Math.random() < 0.5 ? a : b; if (a && b) losers.push({ n: win === a ? b : a, r: rounds.length }); ms.push({ bye: !a || !b, win }); nxt.push(win); }
                    rounds.push(ms); cur = nxt;
                }
                const place = [cur[0], ...losers.sort((x, y) => y.r - x.r).map((l) => l.n)];
                const show = [slots]; rounds.forEach((r) => show.push(new Array(r.length).fill(null)));
                const { ctx, w, h } = this.makeCanvas(420), R = show.length, cw = (w - 8) / R, P = new Particles(); let hi = null, jolt = 0;
                const stop = loop((dt) => {
                    ctx.save(); felt(ctx, w, h); if (jolt > 0.2) { ctx.translate(rnd(-jolt, jolt), rnd(-jolt, jolt)); jolt *= 0.85; }
                    show.forEach((col, r) => col.forEach((nm, i) => {
                        const ch = h / col.length, x = 4 + r * cw, bw = cw - 8, bh = Math.min(26, ch - 6), y = (i + 0.5) * ch - bh / 2, on = hi && ((hi.r === r && (i >> 1) === hi.m) || (hi.r + 1 === r && i === hi.m && nm));
                        ctx.fillStyle = r === R - 1 && nm ? "#f4c430" : nm ? "#12523f" : "rgba(0,0,0,.25)"; ctx.strokeStyle = on ? "#f4c430" : "#2a3542"; ctx.lineWidth = on ? 3 : 1;
                        ctx.beginPath(); ctx.roundRect(x, y, bw, bh, 6); ctx.fill(); ctx.stroke();
                        ctx.fillStyle = r === R - 1 && nm ? "#10151a" : nm ? "#fff" : "#6b7785"; ctx.font = `600 ${Math.max(9, Math.min(12, bw / 7))}px sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
                        ctx.fillText(nm ? this.short(nm, Math.max(4, Math.floor(bw / 7))) : r === 0 ? "BYE" : "?", x + bw / 2, y + bh / 2);
                    }));
                    P.draw(ctx, dt); ctx.restore();
                });
                try {
                    for (let r = 0; r < rounds.length; r += 1) {
                        for (let m = 0; m < rounds[r].length; m += 1) {
                            const mt = rounds[r][m]; hi = { r, m };
                            if (!mt.bye) await this.wait(700, id);
                            show[r + 1][m] = mt.win;
                            if (!mt.bye) { P.burst(4 + (r + 1) * cw + cw / 2, (m + 0.5) * (h / show[r + 1].length), 14, "#f4c430"); jolt = 3.5; buzz(15); Sound.win(); }
                        }
                        await this.wait(300, id);
                    }
                    hi = null; await this.wait(500, id);
                } finally { stop(); }
                winners.splice(0, winners.length, ...place.slice(0, winners.length));
                for (let k = 0; k < winners.length; k += 1) { this.announce(winners[k], k); await this.wait(350, id); }
            },

            async runPlinko(names, winners, id) {
                const pool = shuffle(names).slice(0, 20), { ctx, w, h } = this.makeCanvas(460), P = new Particles();
                const B = 7, bw = w / B, floorY = h - 46, pegs = [], N = winners.length;
                for (let r = 0; r < 8; r += 1) { const y = 70 + r * ((floorY - 110) / 7); for (let i = 0; i <= B; i += 1) { const x = (i + (r % 2 ? 0.5 : 0)) * bw; if (x <= w) pegs.push({ x, y, f: 0 }); } }
                const queue = pool.slice(), chips = [], cnt = new Array(B).fill(0), landed = [], chosen = [], fav = (Rig.on && pool.includes(Rig.target)) ? Rig.target : null; let spawnT = 0, jolt = 0, idx = 0;
                await this.frames(id, (dt) => {
                    spawnT += dt; if (queue.length && spawnT > 320) { spawnT = 0; const nm = queue.shift(); chips.push({ name: nm, x: rnd(w * 0.35, w * 0.65), y: 12, vx: rnd(-30, 30), vy: 0, r: 11, st: 0, color: this.CHIP_COLORS[idx++ % 5], bin: 0 }); }
                    for (let sub = 0; sub < 3; sub += 1) {
                        const s = dt / 3000;
                        chips.forEach((c) => {
                            if (c.st) return; c.vy += 1000 * s;
                            if (fav && c.name === fav && c.y > 40) c.vx += ((w / 2) - c.x) * 9 * s - c.vx * 1.6 * s;   // soft pull toward the centre bins: looks like luck, lands in the star zone
                            c.x += c.vx * s; c.y += c.vy * s;
                            if (c.x < c.r) { c.x = c.r; c.vx = Math.abs(c.vx) * 0.6; } if (c.x > w - c.r) { c.x = w - c.r; c.vx = -Math.abs(c.vx) * 0.6; }
                            pegs.forEach((p) => {
                                const dx = c.x - p.x, dy = c.y - p.y, d = Math.hypot(dx, dy), min = c.r + 4;
                                if (d < min && d > 0) { const nx = dx / d, ny = dy / d; c.x = p.x + nx * min; c.y = p.y + ny * min; const vn = c.vx * nx + c.vy * ny; if (vn < 0) { c.vx -= 1.55 * vn * nx; c.vy -= 1.55 * vn * ny; c.vx += rnd(-20, 20); p.f = 1; P.burst(p.x, p.y, 2, "#fff"); jolt = Math.max(jolt, 0.7); } }
                            });
                            if (c.y + c.r >= floorY) {
                                c.st = 1; c.bin = Math.max(0, Math.min(B - 1, Math.floor(c.x / bw))); c.x = (c.bin + 0.5) * bw + rnd(-8, 8); c.y = h - 18 - cnt[c.bin] * 5; cnt[c.bin] += 1; landed.push(c);
                                if (c.bin >= 2 && c.bin <= 4 && chosen.length < N && (!fav || chosen.includes(fav) || c.name === fav)) { chosen.push(c.name); this.announce(c.name, chosen.length - 1); P.burst(c.x, floorY, 24, "#f4c430"); jolt = 4; buzz(30); }
                            }
                        });
                    }
                    ctx.save(); felt(ctx, w, h); if (jolt > 0.15) { ctx.translate(rnd(-jolt, jolt), rnd(-jolt, jolt)); jolt *= 0.85; }
                    for (let i = 0; i < B; i += 1) { ctx.fillStyle = i >= 2 && i <= 4 ? "rgba(244,196,48,.22)" : "rgba(0,0,0,.25)"; ctx.fillRect(i * bw, floorY, bw, h - floorY); ctx.fillStyle = "#e9c46a"; ctx.font = "16px sans-serif"; ctx.textAlign = "center"; ctx.fillText(i >= 2 && i <= 4 ? "★" : "·", (i + 0.5) * bw, floorY + 16); ctx.strokeStyle = "#b8860b"; ctx.beginPath(); ctx.moveTo(i * bw, floorY); ctx.lineTo(i * bw, h); ctx.stroke(); }
                    pegs.forEach((p) => { p.f = Math.max(0, p.f - dt / 200); ctx.fillStyle = p.f > 0 ? "#f4c430" : "#cfd8dc"; ctx.beginPath(); ctx.arc(p.x, p.y, 4 + p.f * 2, 0, 6.283); ctx.fill(); });
                    chips.forEach((c) => this.drawChip(ctx, c.x, c.y, c.r, c.name, c.color, c.st && c.bin >= 2 && c.bin <= 4));
                    P.draw(ctx, dt); ctx.restore();
                    return landed.length === pool.length && !P.active;
                });
                if (fav && !chosen.includes(fav)) { chosen.push(fav); this.announce(fav, 0); await this.wait(350, id); }
                const rest = landed.filter((c) => !chosen.includes(c.name)).sort((a, b) => Math.abs(a.bin - 3) - Math.abs(b.bin - 3));
                while (chosen.length < N && rest.length) { const c = rest.shift(); chosen.push(c.name); this.announce(c.name, chosen.length - 1); await this.wait(350, id); }
                winners.splice(0, winners.length, ...chosen);
            },

            async runChests(names, winners, id) {
                const N = winners.length, total = Math.min(24, Math.max(9, names.length, N)), contents = shuffle([...winners, ...new Array(total - N).fill(null)]);
                const grid = mk("div", "chest-grid"); let found = 0; const order = [], fav = (Rig.on && winners.includes(Rig.target)) ? Rig.target : null;
                contents.forEach((c0, ci) => {
                    const b = btn("🎁", "chest", () => {
                        if (b.classList.contains("open") || found >= N || id !== this.runId) return;
                        let c = contents[ci];
                        if (c && fav && found === 0 && c !== fav) { const j = contents.indexOf(fav); if (j >= 0) contents[j] = c; contents[ci] = fav; c = fav; }   // swap hidden contents before reveal
                        b.classList.add("open"); const r = b.getBoundingClientRect(), g = grid.getBoundingClientRect();
                        if (c) { b.classList.add("win"); b.textContent = c; found += 1; order.push(c); this.announce(c, found - 1); domBurst(grid, r.left - g.left + r.width / 2, r.top - g.top + r.height / 2, 18); }
                        else { b.textContent = "🍀"; domBurst(grid, r.left - g.left + r.width / 2, r.top - g.top + r.height / 2, 5); buzz(10); }
                    });
                    b.setAttribute("aria-label", "Mystery chest"); grid.append(b);
                });
                this.el.stage.replaceChildren(grid); Notify.warning(`Tap the chests — ${N} hide a winner.`);
                while (found < N) await this.wait(200, id);
                winners.splice(0, winners.length, ...order);
            },

            async runRoles(names, winners, id) {
                const base = winners.map((_, i) => ROLES[i] || "Member" + (i - ROLES.length + 1)), roles = (Rig.on && winners[0] === Rig.target) ? [base[0], ...shuffle(base.slice(1))] : shuffle(base);
                const mat = mk("div", "roles-matrix"), rows = winners.map(() => { const row = mk("div", "roles-row"), a = mk("div", "roles-cell", "???"), b = mk("div", "roles-cell", "—"); row.append(a, b); mat.append(row); return { a, b }; });
                this.el.stage.replaceChildren(mat);
                for (let k = 0; k < winners.length; k += 1) {
                    rows[k].a.textContent = winners[k]; this.announce(winners[k], k);
                    let d = 40; const end = performance.now() + 1100;
                    while (performance.now() < end) { rows[k].b.textContent = pick(ROLES); await this.wait(d, id); d *= 1.12; }
                    rows[k].b.textContent = roles[k]; rows[k].a.classList.add("landed"); rows[k].b.classList.add("landed");
                    const r = rows[k].b.getBoundingClientRect(), s = mat.getBoundingClientRect(); domBurst(this.el.stage, r.left - this.el.stage.getBoundingClientRect().left + r.width / 2, r.top - this.el.stage.getBoundingClientRect().top + r.height / 2, 14);
                    const pod = this.el.podium.children[k]; if (pod) pod.append(mk("span", "podium-role", "· " + roles[k]));
                    void s; await this.wait(300, id);
                }
            }
        });
    };

    return { init() { craps(); crash(); pokerDice(); moneyWheel(); installDraw(); } };
})();

/* =========================================================================
   LA VIUDA NEGRA (Black Widow Poker) — real-time multiplayer, synced at rooms/<code>/bw
   Per-player stats live at rooms/<code>/bwstats so a new deal never wipes them.
   Flow: lobby (host starts) -> ante -> 5 cards each + 5-card "La Viuda" -> clockwise turns
         (pass / swap / fold / "Me hasta aqui") -> final cycle -> showdown -> next hand or back to lobby.
   Solo mode: with one player seated, they play the hand against "The House" (a hand that never acts).
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
    /* La Viuda is "claimed" (g.up = 1) once somebody swaps all five. Until then, a player on their FIRST turn may still swap one card blind (hidden slot), swap all five, or pass. */
    canSwap1(g, u) { return this.isLive(g) && g.order[g.turn] === u && (!!g.up || this.isFirst(g, u)); },
    canSwapAll(g, u) { return this.isLive(g) && g.order[g.turn] === u && !g.up && this.isFirst(g, u); },
    store(key, val) {
        try { if (val === undefined) return window.sessionStorage.getItem(key); window.sessionStorage.setItem(key, val); } catch (e) { /* storage unavailable */ }
        return null;
    },
    init() {
        const on = (id, fn) => this.$(id).addEventListener("click", fn);
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
        this.$("bw-result").addEventListener("click", (e) => { if (e.target === this.$("bw-result")) this.closeResult(); });
        document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !this.$("bw-result").hidden) this.closeResult(); });
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
    /* --- table & seats --- */
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
    /* --- deal: one shuffled 52-card deck, 5 cards per player, 5 face-down cards for La Viuda.
           Host starts the game; after a showdown any seated player can deal once the host has been idle a while.
           One seated player = solo hand against The House (5 extra cards, matched ante, never acts). --- */
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
    /* --- turn actions: pass / swapall (first turn) / swap1 (needs La Viuda face-up) / fold / close ("Me hasta aqui") --- */
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
                if (!first || v.up) return;            // only on your own first turn, and only while nobody has claimed La Viuda yet
                v.fx = { id: Date.now() + "-" + Math.floor(Math.random() * 1e6), u: me, t: "all", was: 0, at: Date.now() };
                v.hands[me] = widow; v.widow = hand; v.up = 1; note = `${me} swapped all five cards with La Viuda`;
            } else if (type === "swap1") {
                const h = p && p.h, w = p && p.w;
                if ((!v.up && !first) || !(h >= 0 && h < 5) || !(w >= 0 && w < 5)) return;
                v.fx = { id: Date.now() + "-" + Math.floor(Math.random() * 1e6), u: me, t: "one", h, w, was: v.up ? 1 : 0, at: Date.now() };
                const t = hand[h]; hand[h] = widow[w]; widow[w] = t; v.hands[me] = hand; v.widow = widow; note = v.up ? `${me} swapped one card with La Viuda` : `${me} swapped one card with a hidden La Viuda card`;
            } else if (type === "fold") {
                v.folded[me] = 1; note = `${me} folded and forfeits the ante`;
            } else if (type === "pass") { note = `${me} passed`; } else return;
            v.played[me] = (v.played[me] || 0) + 1; v.last = note;
            if (type !== "close" && v.phase === "final") v.fin[me] = 1;
            const alive = v.order.filter((u) => !v.folded[u]);
            if (type === "fold" && (alive.length <= 1)) return this.finish(v); // everybody else folded (or the solo player folded to The House)
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
    /* --- showdown: best 5-card poker hand takes the pot, ties split it; folded hands are out; The House joins solo hands --- */
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
    /* --- hand evaluation: [category, ...tiebreakers]; 0 High Card ... 9 Royal Flush (Ace plays high or low in straights) --- */
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
    /* --- chips: ante is charged once per hand from the shared state (persisted per hand so a reload never double-charges) --- */
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
            if (share > 0) { Effects.celebrate(`\u2660 ${g.res.best} \u2014 you win ${share}!`); this.sparkle(); Notify.success(`You won ${share} chips${g.res.byFold ? "." : " with " + g.res.cats[me] + "."}`); }
        }
        if (this.shown !== g.hid) {
            this.shown = g.hid;
            window.setTimeout(() => { if (this.g.hid === g.hid && this.g.phase === "done" && Router.currentGameKey === "blackwidow") this.openResult(); }, 1800);
        }
    },
    sparkle() {
        for (let i = 0; i < 36; i += 1) {
            const s = document.createElement("span"); s.className = "spark"; s.style.left = (30 + Math.random() * 40) + "vw"; s.style.top = (30 + Math.random() * 30) + "vh";
            s.style.setProperty("--sx", ((Math.random() - 0.5) * 320) + "px"); s.style.setProperty("--sy", ((Math.random() - 0.5) * 320) + "px");
            s.addEventListener("animationend", () => s.remove()); document.body.appendChild(s);
        }
    },
    /* --- cards: two faces so turning over is a real 3D flip; face content is only put in the DOM when the card is face-up --- */
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
        cd.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
    },
    /* Gliding, flipping swap animation. g.fx is written together with the swap, so every client plays the same thing once.
       The real cards are already in their new places; we hide them, fly two clones along an arc and flip them as they cross. */
    lastFx: null, fxCount: 0,
    playSwapFx() {
        const g = this.g, fx = g.fx; if (!fx || !fx.id) return;
        const joinedLate = this.lastFx === null;
        if (fx.id === this.lastFx) return;
        this.lastFx = fx.id;
        if (joinedLate && Date.now() - (fx.at || 0) > 4000) return;   // joined mid-hand: don't replay an old swap
        if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
        const me = State.username, mine = fx.u === me, hand = g.hands[fx.u] || [], pairs = fx.t === "all" ? [0, 1, 2, 3, 4].map((i) => [i, i]) : [[fx.h, fx.w]];
        pairs.forEach(([h, w], n) => {
            const he = document.querySelector(`#bw-seats .bw-card[data-k="${fx.u}:${h}"]`), we = document.querySelector(`#bw-widow .bw-card[data-k="w${w}"]`);
            if (!he || !we) return;
            const hr = he.getBoundingClientRect(), wr = we.getBoundingClientRect(), delay = n * 90, dur = 760;
            // [element, from-rect, to-rect, card, starts face-up, ends face-up]
            const legs = [
                [we, hr, wr, g.widow[w], mine, !!g.up],                    // my old card: hand -> widow
                [he, wr, hr, hand[h], !!fx.was, mine]                       // widow card: widow -> hand
            ];
            legs.forEach(([real, from, to, c, fromUp, toUp], li) => {
                if (c == null || c < 0) return;
                real.style.visibility = "hidden";
                const known = fromUp || toUp, fl = this.card("fx" + (this.fxCount += 1), c, known);
                delete this.faces["fx" + this.fxCount];
                fl.classList.remove("up", "pick", "sel", "deal"); if (fromUp) fl.classList.add("up");
                const dx = to.left - from.left, dy = to.top - from.top, lift = Math.min(70, 24 + Math.abs(dy) * 0.18) * (li ? 1 : -1);
                Object.assign(fl.style, { position: "fixed", left: from.left + "px", top: from.top + "px", width: from.width + "px", height: from.height + "px", margin: "0", zIndex: "400", pointerEvents: "none", transition: "none", willChange: "transform" });
                fl.firstChild.style.transitionDuration = (dur * 0.7) + "ms"; fl.firstChild.style.transitionDelay = delay + 80 + "ms";
                document.body.appendChild(fl);
                const sx = to.width / from.width, sy = to.height / from.height;
                const anim = fl.animate([
                    { transform: "translate(0,0) scale(1) rotate(0deg)", offset: 0 },
                    { transform: `translate(${dx * 0.5}px,${dy * 0.5 + lift}px) scale(1.22) rotate(${li ? 7 : -7}deg)`, offset: 0.5 },
                    { transform: `translate(${dx}px,${dy}px) scale(${sx},${sy}) rotate(0deg)`, offset: 1 }
                ], { duration: dur, delay, easing: "cubic-bezier(.4,.1,.2,1)", fill: "both" });
                if (fromUp !== toUp) window.requestAnimationFrame(() => window.requestAnimationFrame(() => fl.classList.toggle("up", toUp)));
                const done = () => { fl.remove(); real.style.visibility = ""; };
                anim.onfinish = done; anim.oncancel = done; window.setTimeout(done, dur + delay + 600);
            });
            Sound.click && Sound.click();
        });
    },
    describe(c) { const s = (c / 13) | 0, rk = this.R[c % 13]; return (rk === "T" ? "10" : rk) + this.S[s]; },
    dealFx(cd, round, ord) {
        const up = cd.classList.contains("up");
        if (up) cd.classList.remove("up");                       // deal face-down, then turn my own cards over on arrival
        CardFX.add(cd, { round, ord, flip: false, reveal: up ? () => cd.classList.add("up") : null });
    },
    render() {
        if (CardFX.deferRender(this)) return;
        const g = this.g, inHand = this.isLive(g) || (g.phase === "done" && !!g.res), lobby = !Tables.isOpen(g) || !inHand, fresh = this.dealt !== g.hid;
        this.$("bw-lobby").hidden = !lobby; this.$("bw-live").hidden = lobby;
        if (lobby) {
            Tables.renderLobby(this.$("bw-lobby"), g, {
                title: "La Viuda Negra table", game: "Black Widow Poker", max: this.MAX_SEATS, minStart: 1,
                soloNote: `Just you so far. Start now to play one hand against The House (ante ${this.ANTE}), or wait for more players.`,
                onOpen: () => this.openTable(), onTake: (k) => this.take(k), onLeave: () => this.leave(),
                onStart: () => this.deal(), onClose: () => this.closeTable(), onClaim: () => Tables.claim(this.ref, State.username)
            });
            this.dealt = g.hid; return;
        }
        this.seq = 0;
        this.renderWidow(fresh); this.renderSeats(fresh);
        CardFX.flush(document.getElementById("bw-deck"), 95);
        this.renderControls(); this.renderStats();
        this.dealt = g.hid;
        this.playSwapFx();
    },
    renderWidow(fresh) {
        const g = this.g, me = State.username, live = this.isLive(g), inHand = live || (g.phase === "done" && !!g.res);
        const wrap = this.$("bw-widow-wrap"), el = this.$("bw-widow"); wrap.hidden = !inHand; el.textContent = "";
        if (!inHand) return;
        const canPick = this.canSwap1(g, me), up = !!g.up;
        if (!canPick) this.sel.w = null;
        (g.widow || []).forEach((c, i) => {
            const cd = this.card("w" + i, c, up);
            if (fresh) this.dealFx(cd, 10 + i, 999);
            if (canPick) this.makePick(cd, "w", i, "La Viuda card " + (i + 1) + (up ? ": " + this.describe(c) : " (face-down)"));
            el.appendChild(cd);
        });
        this.$("bw-widow-label").textContent = up ? "La Viuda \u2014 face-up, swap one card at a time" : "La Viuda \u2014 face-down, still unclaimed (swap all five on your first turn, or blind-swap one card)";
    },
    renderSeats(fresh) {
        const g = this.g, me = State.username, el = this.$("bw-seats"), live = this.isLive(g), inHand = live || (g.phase === "done" && !!g.res);
        const names = inHand ? (g.order || []).slice() : Tables.names(g.seats), canPick = this.canSwap1(g, me), done = g.phase === "done", fold = g.folded || {};
        if (inHand && g.house) names.push(HOUSE);
        if (!canPick) this.sel.h = null;
        el.textContent = "";
        names.forEach((u) => {
            const won = done && g.res.winners.includes(u), house = u === HOUSE, folded = !!fold[u], turn = live && g.order[g.turn] === u, d = document.createElement("div");
            d.className = "bw-seat" + (u === me ? " me" : "") + (turn ? " turn" : "") + (won ? " win" : "") + (folded ? " out" : "");
            const n = document.createElement("div"); n.className = "bw-name"; n.append((turn ? "\u25B6 " : "") + this.nm(u) + (u === me ? " (you)" : ""));
            const tag = (t, cls) => { const s = document.createElement("span"); s.className = "bw-tag " + (cls || ""); s.textContent = t; n.appendChild(s); };
            if (u === g.owner) tag("Host");
            if (inHand) {
                if (house) tag("solo opponent");
                else {
                    if (folded) tag("Folded", "st-folded"); else if (turn) tag("Playing", "st-playing"); else if (!done) tag("Waiting", "st-waiting");
                    tag(`ante ${(g.in || {})[u] || 0}`);
                    if (g.closer === u) tag("Me hasta aqu\u00ED"); else if (g.phase === "final" && (g.fin || {})[u]) tag("last turn done");
                }
                if (done && g.res.cats[u] && !folded && !g.res.byFold) tag(g.res.cats[u]);
                if (won) tag("+" + g.res.shares[u], "st-won");
            }
            d.appendChild(n);
            if (inHand) {
                const h = document.createElement("div"), face = (u === me && !house) || (done && !folded && !g.res.byFold); h.className = "bw-hand";
                (g.hands[u] || []).forEach((c, ci) => {
                    const cd = this.card(u + ":" + ci, c, face);
                    if (fresh) this.dealFx(cd, ci, this.seq = (this.seq || 0) + 1);
                    if (u === me && canPick) this.makePick(cd, "h", ci, "Your card " + (ci + 1) + ": " + this.describe(c));
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
        const first = live && this.isFirst(g, me), final = g.phase === "final", folded = !!(g.folded || {})[me];
        this.$("bw-pot").textContent = "Pot " + (inHand ? g.pot : 0).toLocaleString("en-US");
        this.$("bw-phase").textContent = { play: "Open play", final: `Final cycle \u2014 ${g.closer} closed`, done: "Showdown" }[g.phase] || "Waiting for players";
        this.$("bw-log").textContent = inHand && g.last ? g.last : "";
        let msg;
        if (g.phase === "done" && g.res) {
            const w = g.res.winners.map((u) => this.nm(u));
            msg = g.res.byFold ? `${w[0]} takes ${g.res.pot} chips \u2014 ${g.res.best.toLowerCase()}.` : w.length > 1 ? `Split pot: ${w.join(" & ")} tie with ${g.res.best}.` : `${w[0]} wins ${g.res.pot} chips with ${g.res.best}.`;
        } else if (live && folded) msg = "You folded. Waiting for the showdown\u2026";
        else if (live && myTurn) {
            if (final) msg = first ? (g.up ? "Last chance \u2014 swap one card with La Viuda, pass, or fold." : "Last chance \u2014 swap all five, blind-swap one card, pass, or fold.") : (g.up ? "Last chance \u2014 swap one card with La Viuda, pass, or fold." : "Last chance \u2014 La Viuda is still hidden: pass or fold.");
            else if (first) msg = g.up ? "Your first turn \u2014 La Viuda is already taken. Tap one of your cards and one La Viuda card to swap, or pass, fold, or close." : "Your first turn \u2014 swap all five with La Viuda (nobody has taken it yet), tap a card of yours + a face-down La Viuda card for a single blind swap, pass, fold, or close.";
            else msg = g.up ? "Tap one of your cards and one La Viuda card, then confirm \u2014 or pass, fold, or close." : "La Viuda is still hidden \u2014 pass, fold, or call \u201CMe hasta aqu\u00ED\u201D.";
        } else if (live) msg = inOrder ? `Waiting for ${who}\u2026` : `${who} is playing\u2026`;
        else msg = "";
        this.$("bw-status").textContent = msg;
        const drive = Tables.canDrive(g, me), wait2 = Math.ceil((this.NEXT_MS - (Date.now() - (g.turnAt || 0))) / 1000);
        const deal = this.$("bw-deal"); deal.hidden = !(g.phase === "done" && seated); deal.disabled = !drive && wait2 > 0;
        deal.textContent = drive || wait2 <= 0 ? "Deal next hand" : `Deal next hand (${wait2}s)`;
        this.$("bw-lobby-back").hidden = !(g.phase === "done" && g.owner === me);
        this.$("bw-leave").hidden = !seated; this.$("bw-leave").disabled = live && inOrder;
        const acting = live && inOrder && !folded; this.$("bw-turn-actions").hidden = !acting;
        const can1 = this.canSwap1(g, me);
        this.$("bw-pass").disabled = !myTurn;
        this.$("bw-swapall").disabled = !this.canSwapAll(g, me); this.$("bw-swapall").hidden = !acting;
        const s1 = this.$("bw-swap1"); s1.disabled = !(can1 && this.sel.h !== null && this.sel.w !== null); s1.hidden = !acting;
        this.$("bw-fold").disabled = !myTurn; this.$("bw-fold").hidden = !acting;
        const cl = this.$("bw-close"); cl.disabled = !(myTurn && g.phase === "play"); cl.hidden = !acting || final;
        const wait = live && inOrder && !myTurn ? Math.ceil((this.IDLE_MS - (Date.now() - (g.turnAt || 0))) / 1000) : 0;
        const kick = this.$("bw-kick"); kick.hidden = !(live && inOrder && !myTurn);
        kick.disabled = wait > 0; kick.textContent = wait > 0 ? `Skip idle player (${wait}s)` : "Skip idle player";
    },
    renderStats() {
        const el = this.$("bw-stats"), rows = Object.keys(this.stats || {}).map((u) => ({ u, s: this.stats[u] })).sort((a, b) => (b.s.wins || 0) - (a.s.wins || 0) || (b.s.net || 0) - (a.s.net || 0));
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
    /* --- winner announcement overlay --- */
    openResult() {
        const g = this.g; if (!g.res || g.phase !== "done") return;
        const r = g.res, body = this.$("bw-result-body"), me = State.username, fold = g.folded || {};
        this.$("bw-result-title").textContent = r.winners.length > 1 ? "Split pot" : `${this.nm(r.winners[0])} wins`;
        this.$("bw-result-sub").textContent = `${r.best} \u00B7 pot ${r.pot} chips` + (g.closer ? ` \u00B7 closed by ${g.closer}` : "");
        body.textContent = "";
        const rows = (g.order || []).slice(); if (g.house) rows.push(HOUSE);
        rows.forEach((u) => {
            const won = r.winners.includes(u), folded = !!fold[u], row = document.createElement("div"); row.className = "bw-res-row" + (won ? " win" : "") + (folded ? " folded" : "");
            const nm = document.createElement("div"); nm.className = "bw-res-name"; nm.textContent = this.nm(u) + (u === me ? " (you)" : "");
            const cs = document.createElement("div"); cs.className = "bw-res-cards";
            if (!folded && !r.byFold) (g.hands[u] || []).forEach((c) => { const m = document.createElement("span"), s = (c / 13) | 0; m.className = "bw-mini" + (s === 1 || s === 2 ? " red" : ""); m.textContent = this.describe(c); cs.appendChild(m); });
            const ct = document.createElement("div"); ct.className = "bw-res-cat"; ct.textContent = (folded ? "Folded" : r.byFold ? (won ? "Last player standing" : "") : r.cats[u]) + (won ? ` \u00B7 +${r.shares[u]}` : "");
            row.append(nm, cs, ct); body.appendChild(row);
        });
        const seated = Tables.names(g.seats).includes(me); this.$("bw-result-deal").hidden = !(seated && Tables.canDrive(g, me)); this.$("bw-result").hidden = false; this.$("bw-result-close").focus({ preventScroll: true });
    },
    closeResult() { const m = this.$("bw-result"); if (m && !m.hidden) m.hidden = true; }
};

BW.init();

{ const s0 = Social.start, s1 = Social.stop; Social.start = function () { s0.call(Social); Blackjack.start(); BW.start(); }; Social.stop = function () { s1.call(Social); Blackjack.stop(); BW.stop(); }; }

GameResolver.LABELS.dice = "Quick Dice"; GameResolver.LABELS.tournament = "Tournament";

/* ---------- Quick Dice: shared High/Low round (2d6) synced at rooms/<code>/dice ---------- */
const Dice = {
    d: { st: "idle" }, off: 0, shown: null, timer: 0, anim: 0,
    SIDES: { l: ["Low 2\u20136", 2.2], s: ["Lucky 7", 5.5], h: ["High 8\u201312", 2.2] },
    now() { return Date.now() + this.off; },
    init() {
        $z("z-dice").innerHTML = `<div class="z-dice-stage"><div class="z-die" id="z-d1">\u2680</div><div class="z-die" id="z-d2">\u2681</div></div>
           <div class="z-dice-info"><b id="z-dice-st">Place a bet to start a round</b><small id="z-dice-bets"></small></div>
           <div class="blackjack-controls"><div class="form-group bet-group"><label for="z-dice-amt">Bet</label><input type="number" id="z-dice-amt" class="input-field input-bet" min="1" step="1" value="50"></div>
           <div class="action-buttons">${Object.keys(this.SIDES).map((k) => `<button type="button" class="btn btn-action" data-side="${k}">${this.SIDES[k][0]}<small> pays ${this.SIDES[k][1]}x</small></button>`).join("")}</div></div>
           <p id="z-dice-res" class="game-result" role="status"></p>`;
        $z("z-dice").addEventListener("click", (e) => { const b = e.target.closest("[data-side]"); if (b) this.bet(b.dataset.side); });
    },
    bet(side) {
        const me = State.username, amt = Validate.parseBet($z("z-dice-amt")); if (amt === null || !me) return;
        const r = zref("dice"); if (!r) return; let why = "";
        r.transaction((v) => {
            v = v || { st: "idle" }; const t = this.now(); why = "";
            if (v.st === "bet" && t > v.end) { why = "Betting is closed \u2014 rolling!"; return; }
            if (v.st === "done" && t < (v.doneAt || 0) + 4500) { why = "Next round opens in a moment."; return; }
            if (v.st !== "bet") v = { st: "bet", id: t + "-" + Math.random().toString(36).slice(2, 6), end: t + 9000, bets: {} };
            v.bets = v.bets || {}; if (v.bets[me]) { why = "You already bet this round."; return; }
            v.bets[me] = { s: side, a: amt }; return v;
        }, (e, ok) => { if (ok) { State.debit(amt); Sound.chip(); } else if (why) Notify.warning(why); }, false);
    },
    roll() {
        zref("dice").transaction((v) => {
            if (!v || v.st !== "bet" || this.now() < v.end) return;
            const a = 1 + Math.floor(Math.random() * 6), b = 1 + Math.floor(Math.random() * 6);
            v.st = "done"; v.d = [a, b]; v.doneAt = this.now(); return v;
        }, () => { }, false);
    },
    on(v) {
        this.d = v || { st: "idle" }; const g = this.d, me = State.username;
        if (g.st === "done" && this.shown !== g.id) { this.shown = g.id; this.reveal(g); }
        this.paint();
    },
    paint() {
        const g = this.d, st = $z("z-dice-st"), bt = $z("z-dice-bets"); if (!st) return;
        const list = Object.keys(g.bets || {}).map((u) => `${u}: ${this.SIDES[g.bets[u].s][0]} ${fmt(g.bets[u].a)}`);
        bt.textContent = list.join("  \u00B7  ");
        if (g.st === "bet") st.textContent = `Betting open \u2014 ${Math.max(0, Math.ceil((g.end - this.now()) / 1000))}s`;
        else if (g.st === "idle") st.textContent = "Place a bet to start a round";
    },
    reveal(g) {
        const f = "\u2680\u2681\u2682\u2683\u2684\u2685", [a, b] = g.d, t0 = Date.now();
        $z("z-dice-st").textContent = "Rolling\u2026"; clearInterval(this.anim);
        this.anim = window.setInterval(() => {
            const fin = Date.now() - t0 > 1100; $z("z-d1").textContent = f[(fin ? a : 1 + Math.floor(Math.random() * 6)) - 1]; $z("z-d2").textContent = f[(fin ? b : 1 + Math.floor(Math.random() * 6)) - 1]; Sound.tick(a + b);
            if (fin) { clearInterval(this.anim); this.settle(g); }
        }, 90);
    },
    settle(g) {
        const tot = g.d[0] + g.d[1], win = tot < 7 ? "l" : tot > 7 ? "h" : "s", me = State.username, my = (g.bets || {})[me];
        $z("z-dice-st").textContent = `Total ${tot} \u2192 ${this.SIDES[win][0]}`;
        if (!my) return;
        zref("dice/paid/" + me).transaction((v) => (v === g.id ? undefined : g.id), (e, ok) => {
            if (!ok) return; const won = my.s === win, pay = won ? Math.floor(my.a * this.SIDES[win][1]) : 0;
            resolveGameOutcome("dice", { roundId: g.id + "-" + me, entries: [{ wager: my.a, payout: pay }] });
            $z("z-dice-res").textContent = won ? `You won ${fmt(pay)} chips!` : `You lost ${fmt(my.a)} chips.`;
            if (won) { Sound.win(); Ach.bump({ dicew: 1 }); if (pay >= CONFIG.BIG_WIN_THRESHOLD) Effects.celebrate(`Quick Dice: +${fmt(pay)}`); } else Sound.lose();
        }, false);
    },
    tick() { if (this.d.st === "bet") { this.paint(); if (this.now() >= this.d.end) this.roll(); } }
};
