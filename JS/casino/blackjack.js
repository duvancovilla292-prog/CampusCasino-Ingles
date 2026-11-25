/* CASINO CAMPUS — Blackjack.
   Classic <script> (not an ES module): top-level consts are shared with the other files
   through the page's global scope, so the load order in index.html matters. */
"use strict";

/* =========================================================================
   4. BLACKJACK
   ========================================================================= */
const Blackjack = {
    MAX_SEATS: 5, get IDLE_MS() { return RoomCfg.turnMs(45000); }, NEXT_MS: 12000, DEAL_MS: 30000,
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
