/* CASINO CAMPUS — Black Widow Poker.
   Classic <script> (not an ES module): top-level consts are shared with the other files
   through the page's global scope, so the load order in index.html matters. */
"use strict";

/* =========================================================================
   12. BLACK WIDOW POKER
   ========================================================================= */
const HOUSE = "_house";

const BW = {
    ANTE: 10, MAX_SEATS: 6, get IDLE_MS() { return RoomCfg.turnMs(45000); }, NEXT_MS: 12000,
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
                v.phase = "final"; v.closer = me; note = `${me} called \u201CI\u2019m done here\u201D \u2014 final cycle begins`;
            } else if (type === "swapall") {
                if (!first || v.up) return;
                v.fx = { id: Date.now() + "-" + Math.floor(Math.random() * 1e6), u: me, t: "all", was: 0, at: Date.now() };
                v.hands[me] = widow; v.widow = hand; v.up = 1; note = `${me} swapped all 5 cards with the Widow`;
            } else if (type === "swap1") {
                const h = p && p.h, w = p && p.w;
                if ((!v.up && !first) || !(h >= 0 && h < 5) || !(w >= 0 && w < 5)) return;
                v.fx = { id: Date.now() + "-" + Math.floor(Math.random() * 1e6), u: me, t: "one", h, w, was: v.up ? 1 : 0, at: Date.now() };
                const t = hand[h]; hand[h] = widow[w]; widow[w] = t; v.hands[me] = hand; v.widow = widow; note = v.up ? `${me} swapped 1 card with the Widow` : `${me} swapped 1 card with a hidden Widow card`;
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
                title: "Black Widow table", game: "Black Widow Poker", max: this.MAX_SEATS, minStart: 1,
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
            if (canPick) this.makePick(cd, "w", i, "Widow card " + (i + 1));
            el.appendChild(cd);
        });
        const lbl = this.$("bw-widow-label");
        if (lbl) lbl.textContent = up ? "The Widow \u2014 Face-up" : "The Widow \u2014 Face-down";
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
