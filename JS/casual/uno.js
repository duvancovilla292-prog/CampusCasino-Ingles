/* CASINO CAMPUS — UNO.
   Classic <script> (not an ES module): top-level consts are shared with the other files
   through the page's global scope, so the load order in index.html matters. */
"use strict";

/* =========================================================================
   UNO (Casual & Party Games) — real-time multiplayer at rooms/<code>/uno
   Flow: lobby (host picks optional stake, starts) -> 7 cards each -> clockwise/counter-clockwise turns
         -> first empty hand wins the pot. Stake is charged to every seated player when the game starts.
   Rules: match colour/number, Skip, Reverse (acts as Skip with 2 players), Draw Two, Wild, Wild Draw Four
          (only when you hold no card of the current colour). Draw penalties STACK: Draw Two on Draw Two
          (or a Draw Four on it); Draw Four only on Draw Four. Draw one card: play it or keep it.
   ========================================================================= */
const UNO = (() => {
    const CARDS = []; // id -> [colour 0-3 (4 = wild), value 0-9, 10 Skip, 11 Reverse, 12 Draw Two, 13 Wild, 14 Wild Draw Four]
    for (let c = 0; c < 4; c++) { CARDS.push([c, 0]); for (let v = 1; v < 13; v++) CARDS.push([c, v], [c, v]); }
    for (let i = 0; i < 4; i++) CARDS.push([4, 13]); for (let i = 0; i < 4; i++) CARDS.push([4, 14]);
    const CN = ["Red", "Yellow", "Green", "Blue", "Wild"], HEX = ["#d6372f", "#e8a900", "#1f9d57", "#2468c8"];
    const SYM = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "\u2298", "\u21C4", "+2", "\u2605", "+4"];
    const VN = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "Skip", "Reverse", "Draw Two", "Wild", "Wild Draw Four"];
    const $ = (id) => document.getElementById(id), mk = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };
    const sh = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[a[i], a[j]] = [a[j], a[i]]; } return a; };
    const nm = (id) => (CARDS[id][0] === 4 ? VN[CARDS[id][1]] : CN[CARDS[id][0]] + " " + VN[CARDS[id][1]]);
    const face = (id) => { const [c, v] = CARDS[id], d = mk("div", "uc c" + c), s = SYM[v]; d.append(mk("i", "a", s), mk("b", "", s), mk("i", "z", s)); d.setAttribute("aria-label", nm(id)); return d; };
    const back = () => mk("div", "uc bk");
    const ctr = (r, w) => ({ left: r.left + r.width / 2 - w / 2, top: r.top + r.height / 2 - w * 0.75, width: w, height: w * 1.5 });

    /* ---- rules engine: every function mutates the Firebase transaction value `g` ---- */
    const E = {
        fix(g) { g.deck = g.deck || []; g.disc = g.disc || []; g.idle = g.idle || {}; },
        adv(g, k) { const n = g.order.length; g.turn = (((g.turn + g.dir * k) % n) + n) % n; g.turnAt = Date.now(); g.drew = -1; },
        ok(g, id, h) {
            const [c, v] = CARDS[id], t = CARDS[g.disc[g.disc.length - 1]];
            if (g.pend) return g.pt === 12 ? v === 12 || v === 14 : v === 14;      // stacking: only a matching penalty card may answer
            if (v === 13) return true;
            if (v === 14) return h.every((x) => CARDS[x][0] !== g.col);              // Wild Draw Four only without the current colour
            return c === g.col || v === t[1];
        },
        take(g, u, n) {
            const h = g.hands[u]; let k = 0;
            for (; k < n; k++) { if (!g.deck.length) { if (g.disc.length < 2) break; const t = g.disc.pop(); g.deck = sh(g.disc); g.disc = [t]; } h.push(g.deck.pop()); }
            return k;
        },
        win(g, u, left) { g.phase = "done"; g.turnAt = Date.now(); g.res = { w: u, pot: g.pot || 0, left: left ? 1 : 0 }; return "win"; },
        play(g, u, id, col) {
            const h = g.hands[u], i = h.indexOf(id); if (i < 0 || (g.drew >= 0 && g.drew !== id) || !E.ok(g, id, h)) return false;
            const [c, v] = CARDS[id]; if (c === 4 && !(col >= 0 && col < 4)) return false;
            h.splice(i, 1); g.disc.push(id); g.col = c < 4 ? c : col;
            if (!h.length) return E.win(g, u);
            let k = 1;
            if (v === 10) k = 2;                                                     // Skip
            else if (v === 11) { g.dir *= -1; if (g.order.length === 2) k = 2; }     // Reverse (Skip with two players)
            else if (v === 12 || v === 14) { g.pend = (g.pend || 0) + (v === 12 ? 2 : 4); g.pt = v; }
            E.adv(g, k); return true;
        },
        draw(g, u) {
            if (g.pend) { const n = E.take(g, u, g.pend); g.pend = 0; g.pt = 0; E.adv(g, 1); return n; }  // eat the stacked penalty, lose the turn
            if (g.drew >= 0) return -1;
            const h = g.hands[u], n = E.take(g, u, 1);
            if (n && E.ok(g, h[h.length - 1], h)) g.drew = h[h.length - 1]; else E.adv(g, 1);
            return n;
        },
        leave(g, u) {
            const i = g.order.indexOf(u); if (i < 0) return false;
            g.deck.unshift(...(g.hands[u] || [])); delete g.hands[u]; g.order.splice(i, 1);
            if (g.order.length < 2) return E.win(g, g.order[0], 1);
            if (i < g.turn) g.turn--;
            else if (i === g.turn) { g.turn = g.dir > 0 ? g.turn % g.order.length : (g.turn - 1 + g.order.length) % g.order.length; g.drew = -1; g.turnAt = Date.now(); }
            return true;
        },
        deal(v) {
            const names = Tables.names(v.seats), rot = (v.rot || 0) + 1, order = names.map((_, i) => names[(i + rot) % names.length]), bet = v.bet || 0;
            const deck = sh(Array.from({ length: 108 }, (_, i) => i)), hands = {};
            order.forEach((u) => { hands[u] = deck.splice(-7); });
            let k = deck.length - 1; while (CARDS[deck[k]][1] > 12) k--;              // the starting card is never a Wild
            const first = deck.splice(k, 1)[0], fv = CARDS[first][1];
            const g = { seats: v.seats, owner: v.owner, max: v.max, rot, bet, phase: "play", hid: Date.now(), order, hands, deck, disc: [first], col: CARDS[first][0], turn: 0, dir: 1, pend: 0, pt: 0, drew: -1, in: {}, pot: bet * order.length, turnAt: Date.now(), last: "Match the top card by colour or number", fx: null, res: null };
            order.forEach((u) => { g.in[u] = bet; });
            if (fv >= 10) { if (fv === 11) g.dir = -1; if (fv === 12) E.take(g, order[0], 2); E.adv(g, 1); g.last = "Starting card: " + nm(first) + (fv === 11 ? " \u2014 play runs counter-clockwise" : fv === 12 ? ` \u2014 ${order[0]} draws 2 and is skipped` : ` \u2014 ${order[0]} is skipped`); }
            return g;
        }
    };

    const U = {
        MAX: 6, get IDLE() { return RoomCfg.turnMs(45000); }, STAKES: [0, 10, 25, 50, 100, 250],
        ref: null, cb: null, tick: null, pres: { armed: null }, ann: {}, g: { phase: "lobby" }, hid: null, paid: 0, dealt: null, lastFx: null, wild: null, rect: null, prev: new Set(),
        store(k, v) { try { if (v === undefined) return window.sessionStorage.getItem(k); window.sessionStorage.setItem(k, v); } catch (e) { /* storage unavailable */ } return null; },
        init() {
            const on = (id, fn) => $(id).addEventListener("click", fn);
            on("uno-pass", () => this.act("pass")); on("uno-kick", () => this.kick()); on("uno-leave", () => this.leave()); on("uno-again", () => this.again());
            on("uno-wild-x", () => { this.wild = null; $("uno-pick").hidden = true; });
            on("uno-deck", () => this.act("draw"));
            $("uno-deck").addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); this.act("draw"); } });
            $("uno-pick").querySelectorAll("[data-c]").forEach((b) => b.addEventListener("click", () => { const w = this.wild; this.wild = null; $("uno-pick").hidden = true; if (w != null) this.act("play", { id: w, col: +b.dataset.c }); }));
        },
        start() {
            this.stop(); if (!Room.db || !Room.code) return;
            this.ref = Room.db.ref(`rooms/${Room.code}/uno`);
            this.cb = (s) => {
                const n = s.val() || { phase: "lobby" }; if (n.hid !== this.g.hid) this.wild = null; this.g = n;
                Tables.announce(this.ann, n, "UNO"); Tables.badge("uno", n, this.MAX); Tables.presence(this.pres, this.ref, n, State.username);
                this.sync(); this.render();
            };
            this.ref.on("value", this.cb);
            this.tick = window.setInterval(() => { if (this.g.phase === "play") this.controls(); }, 1000);
            this.render();
        },
        stop() {
            if (this.ref && this.cb) this.ref.off("value", this.cb);
            if (this.tick) window.clearInterval(this.tick);
            this.ref = this.cb = this.tick = null; this.g = { phase: "lobby" }; this.hid = this.dealt = this.lastFx = null; this.wild = null; this.pres = { armed: null }; this.ann = {}; this.prev = new Set();
            Tables.badge("uno", {}, this.MAX);
        },
        /* --- table, seats and optional stake --- */
        canSit() { const b = this.g.bet || 0; if (State.balance < b) { Notify.error(`You need ${b} chips to join this table's stake.`); return false; } return true; },
        openTable() { if (this.ref) Tables.open(this.ref, State.username, this.MAX); },
        take(k) { if (this.ref && this.canSit()) Tables.take(this.ref, State.username, k, ["lobby", "done"]); },
        closeTable() { if (this.ref) Tables.close(this.ref, State.username, State.isHost, ["lobby", "done"]).then((r) => { if (!r.committed) Notify.warning("Finish the match before closing the table."); }); },
        setBet(n) { if (n && !BetLimits.ok(Router.currentGameKey, n)) return; const me = State.username; if (this.ref) this.ref.transaction((v) => { if (!Tables.isOpen(v) || v.phase !== "lobby" || !Tables.canDrive(v, me)) return; v.bet = n; return v; }); },
        leave() {
            const me = State.username, g = this.g; if (!this.ref || !me) return;
            if (g.phase !== "play" || !(g.order || []).includes(me)) return Tables.leave(this.ref, me);
            if (!window.confirm("Leave the match? You forfeit your stake.")) return;
            this.ref.transaction((v) => {
                if (!v || v.phase !== "play" || !v.order.includes(me)) return; E.fix(v); E.leave(v, me);
                const k = Tables.seatOf(v.seats, me); if (k) delete v.seats[k];
                if (v.owner === me) v.owner = Tables.names(v.seats)[0] || "";
                v.fx = null; v.last = `${me} left the match`; return v;
            });
        },
        again() {
            const me = State.username; if (!this.ref) return;
            this.ref.transaction((v) => { if (!Tables.isOpen(v) || v.phase !== "done" || !Tables.canDrive(v, me)) return; return { phase: "lobby", owner: v.owner, seats: v.seats, max: v.max, rot: v.rot || 0, bet: v.bet || 0, hid: Date.now(), turnAt: Date.now() }; });
        },
        deal() {
            const me = State.username, g = this.g, bet = g.bet || 0; if (!this.ref) return; if (bet && !BetLimits.ok(Router.currentGameKey, bet)) return;
            const poor = Tables.names(g.seats).filter((u) => (u === me ? State.balance : ((Room.get(u) || {}).balance || 0)) < bet);
            if (poor.length) return Notify.error(`${poor.join(", ")} can't cover the ${bet}-chip stake.`);
            this.ref.transaction((v) => {
                if (!Tables.isOpen(v) || v.phase !== "lobby" || !Tables.canDrive(v, me)) return;
                const n = Tables.names(v.seats); if (n.length < Force.min(2) || !n.includes(me)) return;
                return E.deal(v);
            });
        },
        /* --- turn actions: play (card + wild colour) / draw / pass (keep the drawn card) / auto (idle player) --- */
        act(type, p, who) {
            const me = State.username, u = who || me, g0 = this.g; if (!this.ref || !me || g0.phase !== "play" || (g0.order || [])[g0.turn] !== u) return;
            this.ref.transaction((v) => {
                if (!v || v.phase !== "play" || v.order[v.turn] !== u) return; E.fix(v);
                if (who && Date.now() - (v.turnAt || 0) < this.IDLE) return;
                const id = Date.now() + "-" + Math.floor(Math.random() * 1e6); let note, r;
                if (type === "play") {
                    if (!p || (r = E.play(v, u, p.id, p.col)) === false) return;
                    v.fx = { id, t: "p", u, c: p.id, at: Date.now() }; const x = CARDS[p.id][1];
                    note = `${u} played ${nm(p.id)}` + (CARDS[p.id][0] === 4 ? ` \u2014 colour is now ${CN[p.col]}` : "") + (r === "win" ? "" : v.pend ? ` \u2014 ${v.order[v.turn]} must stack or draw ${v.pend}` : x === 10 ? " \u2014 next player skipped" : x === 11 ? " \u2014 direction reversed" : "");
                } else if (type === "draw") {
                    if ((r = E.draw(v, u)) < 0) return; v.fx = { id, t: "d", u, n: r, at: Date.now() }; note = `${u} drew ${r} card${r === 1 ? "" : "s"}`;
                } else if (type === "pass") { if (v.drew < 0) return; E.adv(v, 1); note = `${u} kept the drawn card`; }
                else if (type === "auto") {
                    v.idle[u] = (v.idle[u] || 0) + 1;
                    if (v.idle[u] >= 3) { r = E.leave(v, u); const k = Tables.seatOf(v.seats, u); if (k) delete v.seats[k]; if (v.owner === u) v.owner = Tables.names(v.seats)[0] || ""; v.fx = null; note = `${u} was removed for inactivity`; }
                    else { r = E.draw(v, u); if (v.drew >= 0) E.adv(v, 1); v.fx = { id, t: "d", u, n: Math.max(r, 0), at: Date.now() }; note = `${u} timed out`; }
                } else return;
                if (!who) v.idle[u] = 0; v.last = note; return v;
            }).catch(() => { });
        },
        kick() {
            const g = this.g, u = g.order && g.order[g.turn]; if (g.phase !== "play" || !u || u === State.username) return;
            if (Date.now() - (g.turnAt || 0) < this.IDLE) return Notify.warning("Give them a little longer.");
            this.act("auto", null, u);
        },
        pick(id, el) { this.rect = el.getBoundingClientRect(); if (CARDS[id][0] === 4) { this.wild = id; $("uno-pick").hidden = false; return; } this.act("play", { id }); },
        /* --- chips: stake charged once per match from shared state (persisted per match so a reload never double-charges); winner is paid the pot --- */
        sync() {
            const g = this.g, me = State.username; if (!me || !g.hid || !g.in) return;
            const pk = `uno-paid-${Room.code}-${g.hid}-${me}`;
            if (this.hid !== g.hid) { this.hid = g.hid; this.paid = Number(this.store(pk)) || 0; }
            const owed = (g.in[me] || 0) - this.paid;
            if (owed > 0) { State.debit(Math.min(owed, State.balance)); this.paid += owed; this.store(pk, String(this.paid)); }
            if (g.phase !== "done" || !g.res) return;
            const dk = `uno-done-${Room.code}-${g.hid}-${me}`; if (this.store(dk)) return; this.store(dk, "1");
            const won = g.res.w === me;
            if (this.paid > 0) resolveGameOutcome("uno", { roundId: g.hid + "-" + me, entries: [{ wager: this.paid, payout: won ? g.res.pot : 0 }] });
            if (won) { Effects.celebrate(`UNO! You win${g.res.pot ? " " + g.res.pot + " chips" : ""}!`); BW.sparkle(); Notify.success(g.res.pot ? `You won ${g.res.pot} chips!` : "You won the match!"); }
        },
        /* --- rendering --- */
        render() {
            if (CardFX.deferRender(this)) return;
            const g = this.g, live = g.phase === "play" || (g.phase === "done" && !!g.res), lobby = !Tables.isOpen(g) || !live;
            $("uno-lobby").hidden = !lobby; $("uno-live").hidden = lobby;
            if (lobby) {
                Tables.renderLobby($("uno-lobby"), g, {
                    title: "UNO table", game: "UNO", max: this.MAX, minStart: 2, soloNote: "UNO needs at least 2 players. Wait for someone to take a seat.",
                    onOpen: () => this.openTable(), onTake: (k) => this.take(k), onLeave: () => this.leave(), onStart: () => this.deal(), onClose: () => this.closeTable(), onClaim: () => Tables.claim(this.ref, State.username)
                });
                this.betUi(); this.dealt = g.hid; return;
            }
            const fresh = this.dealt !== g.hid; this.table(fresh);
            CardFX.flush($("uno-deck"), 95); this.controls(); this.dealt = g.hid; this.playFx();
        },
        betUi() {
            const g = this.g; if (!Tables.isOpen(g)) return;
            const can = g.phase === "lobby" && Tables.canDrive(g, State.username), box = mk("div", "uno-bet"), row = mk("div", "tl-actions");
            box.appendChild(mk("p", "tl-msg", g.bet ? `Table stake: ${g.bet} chips each \u2014 the winner takes the pot. Charged when the game starts.` : "No stake set \u2014 friendly match. The host can pick an optional chip stake below."));
            this.STAKES.forEach((n) => { const b = mk("button", "btn " + ((g.bet || 0) === n ? "btn-primary" : "btn-secondary"), n ? String(n) : "No bet"); b.type = "button"; b.disabled = !can || n > BetLimits.max(Router.currentGameKey); b.addEventListener("click", () => this.setBet(n)); row.appendChild(b); });
            box.appendChild(row); $("uno-lobby").appendChild(box);
        },
        table(fresh) {
            const g = this.g, me = State.username, order = g.order || [], inGame = order.includes(me), live = g.phase === "play", who = live ? order[g.turn] : null, myTurn = live && inGame && who === me;
            const fx = g.fx && g.fx.id !== this.lastFx && Date.now() - g.fx.at < 4000 ? g.fx : null;
            const opps = $("uno-opps"); opps.textContent = "";
            order.filter((u) => u !== me).forEach((u) => {
                const h = g.hands[u] || [], d = mk("div", "bw-seat uno-opp" + (u === who ? " turn" : "") + (g.res && g.res.w === u ? " win" : "")), fan = mk("div", "uno-fan");
                d.dataset.u = u; d.appendChild(mk("div", "bw-name", (u === who ? "\u25B6 " : "") + u + " \u00B7 " + h.length + (h.length === 1 ? " card" : " cards")));
                h.slice(0, 9).forEach(() => fan.appendChild(back())); d.appendChild(fan); opps.appendChild(d);
            });
            const dl = g.disc || [], disc = $("uno-disc"); disc.textContent = "";
            dl.slice(-4).forEach((id) => { const c = face(id); c.style.transform = `rotate(${((id * 37) % 25) - 12}deg)`; disc.appendChild(c); });
            disc.style.setProperty("--cc", HEX[g.col] || "transparent"); disc.setAttribute("aria-label", `Discard pile: ${nm(dl[dl.length - 1])}, current colour ${CN[g.col]}`);
            const dk = $("uno-deck"); dk.textContent = ""; for (let i = 0; i < 3; i++) { const c = back(); c.style.transform = `translate(${i * 2}px,${-i * 2}px)`; dk.appendChild(c); }
            dk.classList.toggle("can", myTurn && (!!g.pend || g.drew < 0));
            const hand = $("uno-hand"), mine = (g.hands[me] || []).slice().sort((a, b) => CARDS[a][0] - CARDS[b][0] || CARDS[a][1] - CARDS[b][1] || a - b);
            hand.textContent = ""; hand.hidden = !inGame; if (!inGame || !mine.length) this.wild = null;
            mine.forEach((id, i) => {
                const c = face(id), can = myTurn && (g.drew < 0 || g.drew === id) && E.ok(g, id, g.hands[me]);
                if (myTurn) c.classList.add(can ? "ok" : "no");
                if (can) { c.tabIndex = 0; c.setAttribute("role", "button"); c.addEventListener("click", () => this.pick(id, c)); c.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); this.pick(id, c); } }); }
                if (fresh) CardFX.add(c, { round: i, ord: 0 }); else if (fx && fx.t === "d" && fx.u === me && !this.prev.has(id)) CardFX.add(c, { round: i, ord: 0 });
                hand.appendChild(c);
            });
            this.prev = new Set(mine); $("uno-pick").hidden = this.wild == null;
        },
        controls() {
            const g = this.g, me = State.username, order = g.order || [], inGame = order.includes(me), live = g.phase === "play", who = live ? order[g.turn] : null, my = live && inGame && who === me, seated = Tables.names(g.seats).includes(me);
            $("uno-pot").textContent = g.bet ? `Pot ${(g.pot || 0).toLocaleString("en-US")} \u00B7 stake ${g.bet}` : "Friendly match";
            $("uno-dir").classList.toggle("rev", g.dir < 0); $("uno-dir").title = g.dir < 0 ? "Counter-clockwise" : "Clockwise";
            let m = "";
            if (g.phase === "done" && g.res) m = g.res.left ? `${g.res.w} wins by default${g.res.pot ? " \u2014 " + g.res.pot + " chips" : ""}.` : `${g.res.w} played the last card and wins${g.res.pot ? " " + g.res.pot + " chips" : ""}!`;
            else if (my) m = g.pend ? `Stack a ${g.pt === 12 ? "Draw Two (or a Draw Four)" : "Draw Four"}, or tap the pile to draw ${g.pend}.` : g.drew >= 0 ? "Play the card you drew, or keep it." : "Play a highlighted card or tap the draw pile.";
            else if (live) m = `${who}'s turn\u2026`;
            $("uno-status").textContent = m; $("uno-log").textContent = g.last || "";
            $("uno-pass").hidden = !(my && g.drew >= 0);
            const wait = live && inGame && !my ? Math.ceil((this.IDLE - (Date.now() - (g.turnAt || 0))) / 1000) : 0, k = $("uno-kick");
            k.hidden = !(live && inGame && !my && seated); k.disabled = wait > 0; k.textContent = wait > 0 ? `Skip idle player (${wait}s)` : "Skip idle player";
            $("uno-leave").hidden = !(seated && (!live || inGame)); $("uno-leave").textContent = live ? "Forfeit match" : "Leave table";
            $("uno-again").hidden = !(g.phase === "done" && seated && Tables.canDrive(g, me));
        },
        /* --- animations: cards glide along an arc between the piles, hands and seats (deal/draw reuse CardFX) --- */
        fly(el, from, to, delay, dur) {
            const dx = to.left + to.width / 2 - (from.left + from.width / 2), dy = to.top + to.height / 2 - (from.top + from.height / 2), tilt = Math.random() * 20 - 10;
            el.style.setProperty("--uw", from.width + "px");
            Object.assign(el.style, { position: "fixed", left: from.left + "px", top: from.top + "px", margin: "0", zIndex: "400", pointerEvents: "none", willChange: "transform" }); document.body.appendChild(el);
            const a = el.animate([
                { transform: "translate(0,0) scale(1) rotate(0deg)", offset: 0 },
                { transform: `translate(${dx * 0.5}px,${dy * 0.5 - 34}px) scale(1.2) rotate(${tilt}deg)`, offset: 0.5 },
                { transform: `translate(${dx}px,${dy}px) scale(${to.width / from.width}) rotate(${tilt / 2}deg)`, offset: 1 }
            ], { duration: dur, delay, easing: "cubic-bezier(.3,.1,.2,1)", fill: "both" });
            return new Promise((res) => { const d = () => { el.remove(); res(); }; a.onfinish = d; a.oncancel = d; window.setTimeout(d, dur + delay + 500); });
        },
        playFx() {
            const g = this.g, fx = g.fx; if (!fx || fx.id === this.lastFx) return;
            const late = this.lastFx === null; this.lastFx = fx.id;
            if ((late && Date.now() - fx.at > 4000) || CardFX.reduced() || Router.currentGameKey !== "uno") return;
            const me = State.username, dk = $("uno-deck").getBoundingClientRect(), dc = $("uno-disc").getBoundingClientRect();
            const seat = Array.from($("uno-opps").children).find((e) => e.dataset.u === fx.u), sr = seat ? seat.getBoundingClientRect() : null;
            Sound.tone(fx.t === "p" ? 440 : 330, 60, "triangle", 0.04);
            if (fx.t === "p") {
                const from = fx.u === me ? this.rect : sr && ctr(sr, 44); if (!from) return;
                const top = $("uno-disc").lastElementChild; if (top) top.style.visibility = "hidden";
                this.fly(face(fx.c), from, dc, 0, 560).then(() => { if (top) top.style.visibility = ""; });
            } else if (fx.u !== me && sr) for (let i = 0; i < Math.min(fx.n || 0, 6); i++) this.fly(back(), dk, ctr(sr, 30), i * 120, 480);
        }
    };
    return U;
})();

UNO.init();

{ const s0 = Social.start, s1 = Social.stop; Social.start = function () { s0.call(Social); UNO.start(); }; Social.stop = function () { s1.call(Social); UNO.stop(); }; }
