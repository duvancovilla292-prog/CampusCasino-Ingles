/* CASINO CAMPUS — Dominoes.
   Classic <script> (not an ES module): top-level consts are shared with the other files
   through the page's global scope, so the load order in index.html matters. */
"use strict";

/* =========================================================================
   DOMINOES — double-six set (28 tiles), 7 tiles each (2-4 players), linear line with two open ends.
   Opening: the highest double (else the heaviest tile) is played first. A player with no playable tile draws from the
   boneyard (tap it); with an empty boneyard the turn passes automatically. First empty hand wins the pot; if every player
   is stuck the game is blocked and the lowest pip count wins (ties split the pot).
   The line is stored as oriented codes a*10+b (left value, right value) so every client renders the same board.
   ========================================================================= */
const DM = (() => {
    const half = (n) => { const h = ptMk("div", "dh"); for (let i = 0; i < 9; i++) h.appendChild(ptMk("i", PT_PIPS[n].includes(i) ? "on" : "")); return h; };
    const tile = (a, b, cls, s) => { const d = ptMk("div", "dm " + cls); if (s) d.style.setProperty("--s", s + "px"); d.append(half(a), half(b)); d.setAttribute("aria-label", cls.includes("bk") ? "Hidden tile" : `Tile ${a}-${b}`); return d; };

    /*E-START*/
    const T = []; for (let a = 0; a <= 6; a++) for (let b = a; b <= 6; b++) T.push([a, b]);
    const E = {
        ends(g) { const c = g.ch || []; return c.length ? [Math.floor(c[0] / 10), c[c.length - 1] % 10] : null; },
        can(g, id) { const e = E.ends(g); if (!e) return id === g.open; const [a, b] = T[id]; return a === e[0] || b === e[0] || a === e[1] || b === e[1]; },
        ok(g, u) { return (g.hands[u] || []).filter((id) => E.can(g, id)); },
        sides(g, id) { const e = E.ends(g), [a, b] = T[id]; if (!e) return ["R"]; const l = a === e[0] || b === e[0], r = a === e[1] || b === e[1]; return l && r && e[0] !== e[1] ? ["L", "R"] : r ? ["R"] : l ? ["L"] : []; },
        pips(g, u) { return (g.hands[u] || []).reduce((s, id) => s + T[id][0] + T[id][1], 0); },
        adv(g) { g.turn = (g.turn + 1) % g.order.length; g.turnAt = Date.now(); },
        draw(g, u) { const y = g.yard || (g.yard = []); if (!y.length) return false; (g.hands[u] || (g.hands[u] = [])).push(y.pop()); return true; },
        starter(g) {
            let best = -1, id = 0, who = g.order[0];
            g.order.forEach((u) => (g.hands[u] || []).forEach((t) => { const [a, b] = T[t], s = a === b ? 100 + a : a + b + b / 10; if (s > best) { best = s; id = t; who = u; } }));
            return { id, u: who };
        },
        win(g, u, left) { const pips = {}; g.order.forEach((w) => { if (w !== u) pips[w] = E.pips(g, w); }); g.phase = "done"; g.turnAt = Date.now(); g.res = { ws: [u], pot: g.pot || 0, left: left ? 1 : 0, pips }; return "win"; },
        block(g) {
            const pips = {}; g.order.forEach((u) => { pips[u] = E.pips(g, u); });
            const low = Math.min(...g.order.map((u) => pips[u]));
            g.phase = "done"; g.turnAt = Date.now(); g.res = { ws: g.order.filter((u) => pips[u] === low), pot: g.pot || 0, blocked: 1, pips };
        },
        /** Auto-passes players who cannot move while the boneyard is empty; a full round of passes blocks the game. Returns who passed. */
        settle(g) {
            const out = [];
            for (let i = 0; i < 6 && g.phase === "play"; i++) {
                const u = g.order[g.turn]; if (E.ok(g, u).length || (g.yard || []).length) break;
                out.push(u); g.passes = (g.passes || 0) + 1;
                if (g.passes >= g.order.length) { E.block(g); break; }
                E.adv(g);
            }
            return out;
        },
        play(g, u, id, side) {
            const h = g.hands[u] || [], i = h.indexOf(id); if (i < 0 || !E.can(g, id)) return false;
            const [a, b] = T[id], ch = g.ch || (g.ch = []), e = E.ends(g);
            if (!e) ch.push(a * 10 + b);
            else if (side === "L" ? E.sides(g, id).includes("L") : !E.sides(g, id).includes("R")) { if (b === e[0]) ch.unshift(a * 10 + b); else ch.unshift(b * 10 + a); }
            else { if (a === e[1]) ch.push(a * 10 + b); else ch.push(b * 10 + a); }
            h.splice(i, 1); g.passes = 0;
            if (!h.length) E.win(g, u); else E.adv(g);
            return true;
        },
        act(g, u, type, p, id) {
            let t;
            if (type === "play") {
                if (!p || !E.play(g, u, +p.id, p.side)) return null;
                const [a, b] = T[+p.id]; t = `${u} played ${a}-${b}`; g.fx = { id, at: Date.now(), u, c: +p.id, s: p.side === "L" ? "L" : "R" };
            } else if (type === "draw") {
                if (E.ok(g, u).length || !E.draw(g, u)) return null; t = `${u} drew from the boneyard`; g.fx = { id, at: Date.now(), u, d: 1 };
            } else return null;
            const ps = E.settle(g);
            if (g.phase === "done") t += g.res.blocked ? " \u2014 the game is blocked" : g.res.left ? "" : " \u2014 Domino!";
            else if (ps.length) t += ` \u2014 ${ps.join(", ")} had no move and passed`;
            return t;
        },
        auto(g, u, id) {
            while (!E.ok(g, u).length && (g.yard || []).length) E.draw(g, u);
            const ok = E.ok(g, u).sort((a, b) => T[b][0] + T[b][1] - T[a][0] - T[a][1]);
            if (ok.length) { const r = E.act(g, u, "play", { id: ok[0], side: E.sides(g, ok[0])[0] }, id); return r ? `${u} timed out \u2014 ${r}` : null; }
            const ps = E.settle(g); g.fx = null; return `${u} timed out` + (ps.length ? " and passed" : "");
        },
        leave(g, u) {
            const i = g.order.indexOf(u); if (i < 0) return false;
            g.yard = (g.yard || []).concat(g.hands[u] || []); delete g.hands[u]; g.order.splice(i, 1);
            if (g.order.length < 2) return E.win(g, g.order[0], 1);
            if (i < g.turn) g.turn--; else if (i === g.turn) { g.turn %= g.order.length; g.turnAt = Date.now(); }
            if (!(g.ch || []).length) { const s = E.starter(g); g.open = s.id; g.turn = g.order.indexOf(s.u); g.turnAt = Date.now(); }
            E.settle(g); return true;
        },
        deal(v) {
            const names = Tables.names(v.seats).slice(0, 4), rot = (v.rot || 0) + 1, order = names.map((_, i) => names[(i + rot) % names.length]), bet = v.bet || 0;
            const ids = Array.from({ length: 28 }, (_, i) => i); for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[ids[i], ids[j]] = [ids[j], ids[i]]; }
            const hands = {}; order.forEach((u) => { hands[u] = ids.splice(-7); });
            const g = { seats: v.seats, owner: v.owner, max: v.max, rot, bet, phase: "play", hid: Date.now(), order, hands, yard: ids, ch: [], passes: 0, in: {}, pot: bet * order.length, turnAt: Date.now(), fx: null, res: null, turn: 0, open: 0 };
            const s = E.starter(g); g.open = s.id; g.turn = order.indexOf(s.u); g.last = `${s.u} opens with ${T[s.id][0]}-${T[s.id][1]}`;
            order.forEach((u) => { g.in[u] = bet; });
            return g;
        }
    };
    /*E-END*/

    return Object.assign(Party({ key: "dominoes", p: "dm", node: "dominoes", label: "Dominoes", max: 4, E }), {
        pend: null, prev: new Set(),
        onNew() { this.pend = null; this.prev = new Set(); },
        setup() {
            const y = pt$("dm-yard"); y.addEventListener("click", () => this.drawTile());
            y.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); this.drawTile(); } });
            pt$("dm-pick-l").addEventListener("click", () => this.choose("L")); pt$("dm-pick-r").addEventListener("click", () => this.choose("R"));
            pt$("dm-pick-x").addEventListener("click", () => { this.pend = null; pt$("dm-pick").hidden = true; });
        },
        drawTile() { const g = this.g, me = State.username; if (g.phase === "play" && (g.order || [])[g.turn] === me && !E.ok(g, me).length && (g.yard || []).length) this.act("draw"); },
        choose(side) { const id = this.pend; this.pend = null; pt$("dm-pick").hidden = true; if (id != null) this.act("play", { id, side }); },
        pick(id) {
            const s = E.sides(this.g, id); if (s.length === 1) return this.act("play", { id, side: s[0] });
            const e = E.ends(this.g); this.pend = id; pt$("dm-pick-l").textContent = `Left end (${e[0]})`; pt$("dm-pick-r").textContent = `Right end (${e[1]})`; pt$("dm-pick").hidden = false;
        },
        view(fresh) {
            const g = this.g, me = State.username, order = g.order || [], inGame = order.includes(me), live = g.phase === "play", who = live ? order[g.turn] : null, my = live && inGame && who === me, done = g.phase === "done";
            const fx = g.fx && g.fx.id !== this.lastFx && Date.now() - g.fx.at < 4000 ? g.fx : null;
            const opps = pt$("dm-opps"); opps.textContent = "";
            order.filter((u) => u !== me).forEach((u) => {
                const h = g.hands[u] || [], d = ptMk("div", "bw-seat dm-opp" + (u === who ? " turn" : "") + (g.res && (g.res.ws || []).includes(u) ? " win" : "")), fan = ptMk("div", "dm-fan");
                d.appendChild(ptMk("div", "bw-name", (u === who ? "\u25B6 " : "") + u + " \u00B7 " + h.length + (h.length === 1 ? " tile" : " tiles")));
                h.forEach((id) => fan.appendChild(done ? tile(T[id][0], T[id][1], "v", 16) : tile(0, 0, "v bk", 14))); d.appendChild(fan); opps.appendChild(d);
            });
            const ch = pt$("dm-chain"), code = g.ch || [], e = E.ends(g); ch.textContent = "";
            if (!code.length) ch.appendChild(ptMk("div", "dm-empty", live ? `Opening tile: ${T[g.open][0]}-${T[g.open][1]}` : ""));
            else {
                ch.appendChild(ptMk("span", "dm-end", "\u25C0 " + e[0]));
                code.forEach((c, i) => { const a = Math.floor(c / 10), b = c % 10, t = tile(a, b, a === b ? "v" : "h", 30); if (fx && fx.c != null && i === (fx.s === "L" ? 0 : code.length - 1)) t.classList.add("drop"); ch.appendChild(t); });
                ch.appendChild(ptMk("span", "dm-end", e[1] + " \u25B6"));
            }
            const yl = (g.yard || []).length, yd = pt$("dm-yard"); yd.textContent = "";
            for (let i = 0; i < Math.min(3, yl); i++) yd.appendChild(tile(0, 0, "v bk"));
            yd.appendChild(ptMk("span", "dm-count", yl ? `Boneyard \u00B7 ${yl}` : "Boneyard empty"));
            yd.classList.toggle("can", my && !E.ok(g, me).length && yl > 0);
            const hand = pt$("dm-hand"), mine = (g.hands[me] || []).slice().sort((a, b) => a - b); hand.textContent = ""; hand.hidden = !inGame;
            mine.forEach((id, i) => {
                const t = tile(T[id][0], T[id][1], "v", 38), can = my && E.can(g, id);
                if (my) t.classList.add(can ? "ok" : "no");
                if (can) { t.tabIndex = 0; t.setAttribute("role", "button"); t.addEventListener("click", () => this.pick(id)); t.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); this.pick(id); } }); }
                if (fresh) { t.classList.add("drop"); t.style.animationDelay = i * 70 + "ms"; } else if (fx && fx.d && fx.u === me && !this.prev.has(id)) t.classList.add("drop");
                hand.appendChild(t);
            });
            this.prev = new Set(mine); if (!my) this.pend = null; pt$("dm-pick").hidden = this.pend == null;
        },
        controls() {
            const g = this.g, me = State.username, order = g.order || [], inGame = order.includes(me), live = g.phase === "play", who = live ? order[g.turn] : null, my = live && inGame && who === me;
            const ok = my ? E.ok(g, me) : [], yl = (g.yard || []).length; let m = "";
            if (g.phase === "done" && g.res) {
                const r = g.res, w = (r.ws || []).join(" & "), pot = r.pot ? ` \u2014 ${r.pot} chips${r.ws.length > 1 ? " split" : ""}` : "";
                m = r.left ? `${w} wins by default${pot}.` : r.blocked ? `Blocked game \u2014 ${w} ${r.ws.length > 1 ? "tie" : "wins"} with the lowest count (${r.pips[r.ws[0]]} pips)${pot}.` : `${w} played the last tile \u2014 Domino!${pot}`;
            } else if (my) m = ok.length ? ((g.ch || []).length ? "Play a highlighted tile." : `Open with the ${T[g.open][0]}-${T[g.open][1]}.`) : yl ? "No playable tile \u2014 tap the boneyard to draw." : "No tiles to play \u2014 passing\u2026";
            else if (live) m = `${who}'s turn\u2026`;
            pt$("dm-status").textContent = m; pt$("dm-log").textContent = g.last || ""; this.common(my);
        },
        playFx() { const fx = this.g.fx; if (!fx || fx.id === this.lastFx) return; const late = this.lastFx === null; this.lastFx = fx.id; if (!(late && Date.now() - fx.at > 4000) && !CardFX.reduced()) { Sound.tone(fx.c != null ? 420 : 300, 60, "triangle", 0.04); CardFX.until = performance.now() + 600; } }
    });
})();

PQ.init(); DM.init();

{ const s0 = Social.start, s1 = Social.stop; Social.start = function () { s0.call(Social); PQ.start(); DM.start(); }; Social.stop = function () { s1.call(Social); PQ.stop(); DM.stop(); }; }
