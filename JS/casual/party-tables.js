/* CASINO CAMPUS — shared Party table flow for Ludo and Dominoes.
   Classic <script> (not an ES module): top-level consts are shared with the other files
   through the page's global scope, so the load order in index.html matters. */
"use strict";

/* =========================================================================
   COLOMBIAN LUDO (PARQUES) & DOMINOES (Casual & Party Games) — real-time multiplayer at rooms/<code>/parques and rooms/<code>/dominoes
   Both reuse the UNO table flow: shared lobby (host picks an optional stake, starts) -> match -> winner takes the pot.
   The rules engines mutate the Firebase transaction value `g`; clients only render shared state and animate `fx` records.
   Stake is charged to every seated player when the match starts (persisted per match, so a reload never double-charges).
   ========================================================================= */
const pt$ = (s) => document.getElementById(s), ptMk = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };

const PT_PIPS = [[], [4], [0, 8], [0, 4, 8], [0, 2, 6, 8], [0, 2, 4, 6, 8], [0, 2, 3, 5, 6, 8]];

/** Shared table plumbing: lobby, seats, optional stake, turn actions, idle skip, forfeit, chip settlement. */
const Party = (o) => {
    const el = (s) => pt$(o.p + "-" + s);
    return {
        MAX: o.max, get IDLE() { return RoomCfg.turnMs(45000); }, STAKES: [0, 10, 25, 50, 100, 250], E: o.E,
        ref: null, cb: null, tick: null, pres: { armed: null }, ann: {}, g: { phase: "lobby" }, hid: null, paid: 0, dealt: null, lastFx: null,
        store(k, v) { try { if (v === undefined) return window.sessionStorage.getItem(k); window.sessionStorage.setItem(k, v); } catch (e) { /* storage unavailable */ } return null; },
        init() { el("kick").addEventListener("click", () => this.kick()); el("leave").addEventListener("click", () => this.leave()); el("again").addEventListener("click", () => this.again()); this.setup(); },
        start() {
            this.stop(); if (!Room.db || !Room.code) return;
            this.ref = Room.db.ref(`rooms/${Room.code}/${o.node}`);
            this.cb = (s) => {
                const n = s.val() || { phase: "lobby" }; if (n.hid !== this.g.hid) this.onNew(); this.g = n;
                Tables.announce(this.ann, n, o.label); Tables.badge(o.key, n, this.MAX); Tables.presence(this.pres, this.ref, n, State.username);
                this.sync(); this.render();
            };
            this.ref.on("value", this.cb);
            this.tick = window.setInterval(() => { if (this.g.phase === "play") this.controls(); }, 1000);
            this.render();
        },
        stop() {
            if (this.ref && this.cb) this.ref.off("value", this.cb);
            if (this.tick) window.clearInterval(this.tick);
            this.ref = this.cb = this.tick = null; this.g = { phase: "lobby" }; this.hid = this.dealt = this.lastFx = null; this.pres = { armed: null }; this.ann = {};
            this.onNew(); Tables.badge(o.key, {}, this.MAX);
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
                if (!v || v.phase !== "play" || !v.order.includes(me)) return;
                o.E.leave(v, me);
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
                return o.E.deal(v);
            });
        },
        /* --- turn actions: the engine validates and applies them inside the transaction; `auto` plays for an idle player --- */
        act(type, p, who) {
            const me = State.username, u = who || me, g0 = this.g; if (!this.ref || !me || g0.phase !== "play" || (g0.order || [])[g0.turn] !== u) return;
            this.ref.transaction((v) => {
                if (!v || v.phase !== "play" || v.order[v.turn] !== u || v.hid !== g0.hid || v.turnAt !== g0.turnAt) return; v.idle = v.idle || {};
                if (who && Date.now() - (v.turnAt || 0) < this.IDLE) return;
                const id = Date.now() + "-" + Math.floor(Rng.float() * 1e6); let note;
                if (type === "auto") {
                    v.idle[u] = (v.idle[u] || 0) + 1;
                    if (v.idle[u] >= 3) { o.E.leave(v, u); const k = Tables.seatOf(v.seats, u); if (k) delete v.seats[k]; if (v.owner === u) v.owner = Tables.names(v.seats)[0] || ""; v.fx = null; note = `${u} was removed for inactivity`; }
                    else note = o.E.auto(v, u, id) || `${u} timed out`;
                } else { note = o.E.act(v, u, type, p, id); if (!note) return; }
                if (!who) v.idle[u] = 0; v.last = note; return v;
            }).catch(() => Notify.error("Could not send your move. Please try again."));
        },
        kick() {
            const g = this.g, u = g.order && g.order[g.turn]; if (g.phase !== "play" || !u || u === State.username) return;
            if (Date.now() - (g.turnAt || 0) < this.IDLE) return Notify.warning("Give them a little longer.");
            this.act("auto", null, u);
        },
        /* --- chips: stake charged once per match from shared state; the winner(s) split the pot --- */
        sync() {
            const g = this.g, me = State.username; if (!me || !g.hid || !g.in) return;
            const pk = `${o.key}-paid-${Room.code}-${g.hid}-${me}`;
            if (this.hid !== g.hid) { this.hid = g.hid; this.paid = Number(this.store(pk)) || 0; }
            const owed = (g.in[me] || 0) - this.paid;
            if (owed > 0) { State.debit(Math.min(owed, State.balance)); this.paid += owed; this.store(pk, String(this.paid)); }
            if (g.phase !== "done" || !g.res) return;
            const dk = `${o.key}-done-${Room.code}-${g.hid}-${me}`; if (this.store(dk)) return; this.store(dk, "1");
            const ws = g.res.ws || [], won = ws.includes(me), pot = g.res.pot || 0, share = won ? Math.floor(pot / ws.length) + (ws[0] === me ? pot % ws.length : 0) : 0;
            if (this.paid > 0) resolveGameOutcome(o.key, { roundId: g.hid + "-" + me, entries: [{ wager: this.paid, payout: share }] });
            if (won) { Effects.celebrate(`${o.label}! You win${share ? " " + share + " chips" : ""}!`); BW.sparkle(); Notify.success(share ? `You won ${share} chips!` : "You won the match!"); }
        },
        /* --- rendering --- */
        render() {
            if (CardFX.deferRender(this)) return;
            const g = this.g, live = g.phase === "play" || (g.phase === "done" && !!g.res), lobby = !Tables.isOpen(g) || !live;
            el("lobby").hidden = !lobby; el("live").hidden = lobby;
            if (lobby) {
                Tables.renderLobby(el("lobby"), g, {
                    title: o.label + " table", game: o.label, max: this.MAX, minStart: 2, soloNote: `${o.label} needs at least 2 players. Wait for someone to take a seat.`,
                    onOpen: () => this.openTable(), onTake: (k) => this.take(k), onLeave: () => this.leave(), onStart: () => this.deal(), onClose: () => this.closeTable(), onClaim: () => Tables.claim(this.ref, State.username)
                });
                this.betUi(); this.dealt = g.hid; return;
            }
            const fresh = this.dealt !== g.hid; this.view(fresh); this.controls(); this.dealt = g.hid; this.playFx();
        },
        betUi() {
            const g = this.g; if (!Tables.isOpen(g)) return;
            const can = g.phase === "lobby" && Tables.canDrive(g, State.username), box = ptMk("div", "uno-bet"), row = ptMk("div", "tl-actions");
            box.appendChild(ptMk("p", "tl-msg", g.bet ? `Table stake: ${g.bet} chips each \u2014 the winner takes the pot. Charged when the game starts.` : "No stake set \u2014 friendly match. The host can pick an optional chip stake below."));
            this.STAKES.forEach((n) => { const b = ptMk("button", "btn " + ((g.bet || 0) === n ? "btn-primary" : "btn-secondary"), n ? String(n) : "No bet"); b.type = "button"; b.disabled = !can || n > BetLimits.max(Router.currentGameKey); b.addEventListener("click", () => this.setBet(n)); row.appendChild(b); });
            box.appendChild(row); el("lobby").appendChild(box);
        },
        /** Shared bottom controls: pot label, idle-skip countdown, forfeit/leave and "back to lobby". */
        common(my) {
            const g = this.g, me = State.username, order = g.order || [], inGame = order.includes(me), live = g.phase === "play", seated = Tables.names(g.seats).includes(me);
            el("pot").textContent = g.bet ? `Pot ${(g.pot || 0).toLocaleString("en-US")} \u00B7 stake ${g.bet}` : "Friendly match";
            const wait = live && inGame && !my ? Math.ceil((this.IDLE - (Date.now() - (g.turnAt || 0))) / 1000) : 0, k = el("kick");
            k.hidden = !(live && inGame && !my && seated); k.disabled = wait > 0; k.textContent = wait > 0 ? `Skip idle player (${wait}s)` : "Skip idle player";
            el("leave").hidden = !(seated && (!live || inGame)); el("leave").textContent = live ? "Forfeit match" : "Leave table";
            el("again").hidden = !(g.phase === "done" && seated && Tables.canDrive(g, me));
        }
    };
};
