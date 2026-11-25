/* CASINO CAMPUS — Colombian Ludo.
   Classic <script> (not an ES module): top-level consts are shared with the other files
   through the page's global scope, so the load order in index.html matters. */
"use strict";

/* =========================================================================
   COLOMBIAN LUDO (PARQUES) — 4 tokens each, 68-square ring (an 18x18 grid perimeter), 7-square home lane, centre target.
   Progress per token: -1 base | 0..67 ring (0 = own entry square) | 68..74 home lane | 75 centre (exact roll needed).
   Rules: a 6 brings a token out (capturing a lone rival on the entry square); 6 / capture / reaching the centre = roll again;
          three sixes in a row lose the turn; landing on a lone rival off a safe square (entries + corners) sends it to base;
          two tokens of one colour on a square form a blockade that rivals can neither land on nor pass.
   ========================================================================= */
const PQ = (() => {
    const CN = ["Ruby", "Gold", "Sapphire", "Emerald"];
    const rotN = (x, y, n) => { for (let i = 0; i < n; i++) { const t = x; x = 17 - y; y = t; } return [x, y]; };
    const trk = (i) => { const s = Math.floor(i / 17), p = i % 17; return s === 0 ? [p, 0] : s === 1 ? [17, p] : s === 2 ? [17 - p, 17] : [0, 17 - p]; };
    const fin = (c, k) => { let dx = -0.6 + 0.4 * k, dy = -0.75; for (let i = 0; i < c; i++) { const t = dx; dx = -dy; dy = t; } return [8.5 + dx, 8.5 + dy]; };
    const cell = (c, p, k) => (p < 0 ? rotN(2 + (k % 2) * 2, 2 + (k >> 1) * 2, c) : p <= 67 ? trk((17 * c + 8 + p) % 68) : p <= 74 ? rotN(8, p - 67, c) : fin(c, k));
    const pc = (v) => ((v + 0.5) / 18 * 100).toFixed(3) + "%";
    const place = (e, x, y) => { e.style.left = pc(x); e.style.top = pc(y); };

    /*E-START*/
    const E = {
        idx(c, p) { return (17 * c + 8 + p) % 68; },
        safe(i) { return i % 17 === 8 || i % 17 === 0; },
        at(g, i) { const r = []; g.order.forEach((w) => g.tok[w].forEach((p, k) => { if (p >= 0 && p <= 67 && E.idx(g.col[w], p) === i) r.push({ u: w, k }); })); return r; },
        wall(g, u, i) { const m = {}; E.at(g, i).forEach((t) => { if (t.u !== u) m[t.u] = (m[t.u] || 0) + 1; }); return Object.keys(m).some((w) => m[w] >= 2); },
        moves(g, u, d) {
            const c = g.col[u], out = [];
            g.tok[u].forEach((p, k) => {
                if (p === 75) return;
                if (p < 0) { if (d === 6 && !E.wall(g, u, E.idx(c, 0))) out.push(k); return; }
                const np = p + d; if (np > 75) return;
                for (let q = p + 1; q <= Math.min(np, 67); q++) if (E.wall(g, u, E.idx(c, q))) return;
                out.push(k);
            });
            return out;
        },
        adv(g) { g.turn = (g.turn + 1) % g.order.length; g.ph = "roll"; g.six = 0; g.turnAt = Date.now(); },
        win(g, u, left) { g.phase = "done"; g.turnAt = Date.now(); g.res = { ws: [u], pot: g.pot || 0, left: left ? 1 : 0 }; return "win"; },
        roll(g, u) {
            const d = 1 + Math.floor(Rng.float() * 6); g.die = d; g.turnAt = Date.now();
            if (d === 6 && (g.six = (g.six || 0) + 1) >= 3) { E.adv(g); return "triple"; }
            const m = E.moves(g, u, d);
            if (!m.length) { if (d === 6) g.ph = "roll"; else E.adv(g); return "none"; }
            g.ph = "move"; return m.length === 1 ? "one" : "pick";
        },
        move(g, u, k) {
            const c = g.col[u], p = g.tok[u][k], d = g.die, np = p < 0 ? 0 : p + d, cap = [];
            g.tok[u][k] = np;
            if (np <= 67) { const i = E.idx(c, np); if (np === 0 || !E.safe(i)) E.at(g, i).forEach((t) => { if (t.u !== u) cap.push({ u: t.u, k: t.k, i }); }); }
            cap.forEach((x) => { g.tok[x.u][x.k] = -1; });
            const mv = { k, from: p, to: np, cap };
            if (g.tok[u].every((x) => x === 75)) { E.win(g, u); return mv; }
            if (d === 6 || cap.length || np === 75) { g.ph = "roll"; g.turnAt = Date.now(); } else E.adv(g);
            return mv;
        },
        say(g, mv) {
            let s = mv.from < 0 ? "brings a token out of base" : `moves token ${mv.k + 1}`;
            if (mv.cap.length) s += ` and captures ${mv.cap.map((x) => x.u).join(", ")}`;
            if (mv.to === 75) s += " into the centre";
            if (g.phase === "done") s += " \u2014 all four tokens are home!";
            return s;
        },
        act(g, u, type, p, id) {
            let mv = null, d = null, t;
            if (type === "roll") {
                if (g.ph !== "roll") return null;
                const r = E.roll(g, u); d = g.die; t = `${u} rolled a ${d}`;
                if (r === "triple") t += " \u2014 three sixes in a row, the turn is lost";
                else if (r === "none") t += " \u2014 no legal move" + (d === 6 ? ", roll again" : "");
                else if (r === "one") { mv = E.move(g, u, E.moves(g, u, d)[0]); t += " and " + E.say(g, mv); }
                else t += " \u2014 choose a token";
            } else if (type === "move") {
                if (g.ph !== "move" || !p || !E.moves(g, u, g.die).includes(+p.k)) return null;
                mv = E.move(g, u, +p.k); t = `${u} ` + E.say(g, mv);
            } else return null;
            g.fx = { id, at: Date.now(), u, d, m: mv }; return t;
        },
        auto(g, u, id) {
            let t = null;
            if (g.ph === "roll") t = E.act(g, u, "roll", null, id);
            if (g.phase === "play" && g.order[g.turn] === u && g.ph === "move") { const k = E.moves(g, u, g.die).sort((a, b) => g.tok[u][b] - g.tok[u][a])[0]; t = E.act(g, u, "move", { k }, id) || t; }
            return t ? `${u} timed out \u2014 ${t}` : null;
        },
        leave(g, u) {
            const i = g.order.indexOf(u); if (i < 0) return false;
            g.order.splice(i, 1); delete g.tok[u]; delete g.col[u];
            if (g.order.length < 2) return E.win(g, g.order[0], 1);
            if (i < g.turn) g.turn--; else if (i === g.turn) { g.turn %= g.order.length; g.ph = "roll"; g.six = 0; g.turnAt = Date.now(); }
            return true;
        },
        deal(v) {
            const names = Tables.names(v.seats).slice(0, 4), rot = (v.rot || 0) + 1, order = names.map((_, i) => names[(i + rot) % names.length]), bet = v.bet || 0, n = order.length;
            const cols = n === 2 ? [0, 2] : [0, 1, 2, 3], col = {}, tok = {};
            order.forEach((u, i) => { col[u] = cols[i]; tok[u] = [-1, -1, -1, -1]; });
            const g = { seats: v.seats, owner: v.owner, max: v.max, rot, bet, phase: "play", hid: Date.now(), order, col, tok, turn: 0, ph: "roll", die: 0, six: 0, in: {}, pot: bet * n, turnAt: Date.now(), last: "Roll a 6 to bring a token out of base", fx: null, res: null };
            order.forEach((u) => { g.in[u] = bet; });
            return g;
        }
    };
    /*E-END*/

    const P = Object.assign(Party({ key: "parques", p: "pq", node: "parques", label: "Colombian Ludo", max: 4, E }), {
        onNew() { /* no pending local UI state */ },
        setup() {
            const b = pt$("pq-board"), add = (cls, x, y) => { const d = ptMk("div", cls); place(d, x, y); b.appendChild(d); };
            for (let c = 0; c < 4; c++) { add("pq-yard pk" + c, ...rotN(3, 3, c)); for (let k = 0; k < 4; k++) add("pq-slot pk" + c, ...cell(c, -1, k)); }
            add("pq-center", 8.5, 8.5);
            for (let i = 0; i < 68; i++) { const e = i % 17 === 8; add("pq-sq" + (e || i % 17 === 0 ? " safe" : "") + (e ? " entry pk" + (i - 8) / 17 : ""), ...trk(i)); }
            for (let c = 0; c < 4; c++) for (let j = 0; j < 7; j++) add("pq-sq lane pk" + c, ...rotN(8, 1 + j, c));
            b.appendChild(ptMk("div", "pq-tokens")).id = "pq-tokens";
            const d = pt$("pq-die"); for (let i = 0; i < 9; i++) d.appendChild(ptMk("i"));
            const roll = () => this.act("roll");
            pt$("pq-roll").addEventListener("click", roll); d.addEventListener("click", roll);
            d.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); roll(); } });
        },
        face(v) { Array.from(pt$("pq-die").children).forEach((c, i) => c.classList.toggle("on", PT_PIPS[v || 0].includes(i))); },
        view() {
            const g = this.g, me = State.username, order = g.order || [], inGame = order.includes(me), live = g.phase === "play", who = live ? order[g.turn] : null, myTurn = live && inGame && who === me;
            const legal = myTurn && g.ph === "move" ? E.moves(g, me, g.die) : [];
            const strip = pt$("pq-players"); strip.textContent = "";
            order.forEach((u) => {
                const c = g.col[u], d = ptMk("div", `bw-seat pq-pl pk${c}` + (u === who ? " turn" : "") + (g.res && (g.res.ws || []).includes(u) ? " win" : ""));
                d.appendChild(ptMk("div", "bw-name", (u === who ? "\u25B6 " : "") + u + (u === me ? " (you)" : "")));
                d.appendChild(ptMk("div", "bw-info", `${CN[c]} \u00B7 ${g.tok[u].filter((x) => x === 75).length}/4 home`)); strip.appendChild(d);
            });
            const L = pt$("pq-tokens"); L.textContent = "";
            const items = []; order.forEach((u) => g.tok[u].forEach((p, k) => items.push({ u, k, p, c: g.col[u], xy: cell(g.col[u], p, k) })));
            const grp = {}; items.forEach((t) => { if (t.p >= 0 && t.p < 75) (grp[t.xy.join()] = grp[t.xy.join()] || []).push(t); });
            items.forEach((t) => {
                const gp = grp[t.xy.join()], n = gp ? gp.length : 1, i = gp ? gp.indexOf(t) : 0, off = (i - (n - 1) / 2) * 0.34;
                const wall = !!gp && t.p <= 67 && gp.filter((x) => x.u === t.u).length >= 2;
                const e = ptMk("div", `pq-tok pk${t.c}` + (t.p === 75 ? " fin" : "") + (wall ? " wall" : "")); e.dataset.u = t.u; e.dataset.k = t.k;
                place(e, t.xy[0] + off, t.xy[1] + off); e.setAttribute("aria-label", `${t.u}, ${CN[t.c]} token ${t.k + 1}`);
                if (t.u === me && legal.includes(t.k)) {
                    e.classList.add("ok"); e.tabIndex = 0; e.setAttribute("role", "button");
                    const go = () => this.act("move", { k: t.k }); e.addEventListener("click", go);
                    e.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); go(); } });
                }
                L.appendChild(e);
            });
        },
        controls() {
            const g = this.g, me = State.username, order = g.order || [], inGame = order.includes(me), live = g.phase === "play", who = live ? order[g.turn] : null, my = live && inGame && who === me;
            const d = pt$("pq-die"); if (!d.classList.contains("rolling")) this.face(g.die || 0);
            d.classList.toggle("can", my && g.ph === "roll"); d.tabIndex = my && g.ph === "roll" ? 0 : -1;
            let m = "";
            if (g.phase === "done" && g.res) m = g.res.left ? `${g.res.ws[0]} wins by default${g.res.pot ? " \u2014 " + g.res.pot + " chips" : ""}.` : `${g.res.ws[0]} brings every token home and wins${g.res.pot ? " " + g.res.pot + " chips" : ""}!`;
            else if (my) m = g.ph === "roll" ? "Your turn \u2014 roll the dice." : `You rolled a ${g.die}. Tap a glowing token to move it.`;
            else if (live) m = `${who}'s turn\u2026`;
            pt$("pq-status").textContent = m; pt$("pq-log").textContent = g.last || "";
            pt$("pq-roll").hidden = !(my && g.ph === "roll"); this.common(my);
        },
        /* --- animations: the die tumbles, then the token hops square by square; captured tokens glide back to their base --- */
        rollAnim(v) {
            const d = pt$("pq-die"); d.classList.add("rolling"); let n = 0;
            const iv = window.setInterval(() => { this.face(1 + Math.floor(Rng.float() * 6)); Sound.tone(300 + Rng.float() * 200, 25, "square", 0.02); if (++n > 7) { window.clearInterval(iv); d.classList.remove("rolling"); this.face(v); } }, 90);
        },
        tokEl(u, k) { return Array.from(pt$("pq-tokens").children).find((e) => e.dataset.u === u && +e.dataset.k === k); },
        playFx() {
            const g = this.g, fx = g.fx; if (!fx || fx.id === this.lastFx) return;
            const late = this.lastFx === null; this.lastFx = fx.id;
            if ((late && Date.now() - fx.at > 4000) || CardFX.reduced() || Router.currentGameKey !== "parques") return;
            let t = 0; if (fx.d) { this.rollAnim(fx.d); t = 800; }
            const m = fx.m, c = g.col[fx.u], e = m && c != null ? this.tokEl(fx.u, m.k) : null;
            if (e) {
                const pts = [cell(c, m.from, m.k)]; if (m.from < 0) pts.push(cell(c, 0, m.k)); else for (let q = m.from + 1; q <= m.to; q++) pts.push(cell(c, q, m.k));
                const dur = Math.max(320, 150 * (pts.length - 1)), last = pts.length - 1;
                const kf = pts.map((p, i) => ({ left: pc(p[0]), top: pc(p[1]), transform: `translate(-50%,-50%) scale(${i && i < last && i % 2 ? 1.22 : 1})` }));
                kf[last].left = e.style.left; kf[last].top = e.style.top; kf[last].transform = "translate(-50%,-50%) scale(1)";
                e.style.zIndex = "9"; const a = e.animate(kf, { duration: dur, delay: t, easing: "ease-in-out", fill: "backwards" }); a.onfinish = () => { e.style.zIndex = ""; };
                pts.forEach((_, i) => { if (i) window.setTimeout(() => Sound.tone(380 + i * 24, 35, "triangle", 0.03), t + (dur / last) * i); });
                (m.cap || []).forEach((x) => {
                    const ce = this.tokEl(x.u, x.k); if (!ce) return; const [cx, cy] = trk(x.i);
                    ce.animate([{ left: pc(cx), top: pc(cy) }, { left: ce.style.left, top: ce.style.top }], { duration: 600, delay: t + dur, easing: "ease-in", fill: "backwards" });
                    window.setTimeout(() => Sound.tone(150, 180, "sawtooth", 0.05), t + dur);
                });
                t += dur + ((m.cap || []).length ? 600 : 0);
            }
            CardFX.until = performance.now() + t + 200;
        }
    });
    return P;
})();
