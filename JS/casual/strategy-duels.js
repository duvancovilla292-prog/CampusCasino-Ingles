/* CASINO CAMPUS — Chess, Chinese Checkers, Connect Four, Battleship, Color Code Breaker, Bulls & Cows.
   Classic <script> (not an ES module): top-level consts are shared with the other files
   through the page's global scope, so the load order in index.html matters. */
"use strict";

/* =========================================================================
   STRATEGY DUELS (Casual & Party Games) — Chess, Chinese Checkers, Color Code Breaker, Bulls & Cows
   Real-time multiplayer at rooms/<code>/{chess,checkers,mastermind,bullscows} through the shared Party table flow
   (lobby -> optional stake -> match -> winner takes the pot), plus single-player matches against the Casino Bot:
   the bot sits at a LocalRef table that implements the Firebase transaction interface, so solo and online games run
   the exact same rules engines, stake handling and chip settlement.
   NOTE: the code-breaker secrets live in the shared match state (this is a serverless casual game, like the other tables).
   ========================================================================= */
(() => {
    const BOT = "Casino Bot", $ = pt$, mk = ptMk;
    /*DE-START*/
    const rnd = (n) => Math.floor(Math.random() * n);
    const shuf = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1);[a[i], a[j]] = [a[j], a[i]]; } return a; };
    const finish = (g, ws, why, left) => { g.phase = "done"; g.turnAt = Date.now(); g.res = { ws, pot: g.pot || 0, why: why || "", left: left ? 1 : 0 }; };
    const mkGame = (v, n, extra) => {
        const names = Tables.names(v.seats).slice(0, n), rot = (v.rot || 0) + 1, order = names.map((_, i) => names[(i + rot) % names.length]), bet = v.bet || 0;
        const g = { seats: v.seats, owner: v.owner, max: v.max, rot, bet, phase: "play", hid: Date.now(), order, turn: 0, in: {}, pot: bet * order.length, turnAt: Date.now(), fx: null, res: null };
        order.forEach((u) => { g.in[u] = bet; });
        return Object.assign(g, extra(order, g));
    };
    const autoOf = (E) => (g, u, id) => { const m = E.ai(g, u), r = m && E.act(g, u, m.type, m.p, id); return r ? `${u} timed out \u2014 ${r}` : null; };
    const duelLeave = (g, u) => { const i = g.order.indexOf(u); if (i < 0) return false; g.order.splice(i, 1); finish(g, [g.order[0]], "opponent left", 1); return true; };

    /* ---------------------------------- CHESS ---------------------------------- */
    const CHE = (() => {
        const isW = (p) => p !== "." && p === p.toUpperCase();
        const N = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]], K = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
        const D = { B: K.filter((d) => d[0] && d[1]), R: K.filter((d) => !d[0] || !d[1]), Q: K };
        const VAL = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 }, sqn = (i) => "abcdefgh"[i & 7] + (8 - (i >> 3));
        const START = "rnbqkbnrpppppppp" + ".".repeat(32) + "PPPPPPPPRNBQKBNR";
        const att = (b, sq, w) => {
            const r = sq >> 3, c = sq & 7, at = (rr, cc) => (rr >= 0 && rr < 8 && cc >= 0 && cc < 8 ? b[rr * 8 + cc] : null);
            for (const dc of [-1, 1]) if (at(w ? r + 1 : r - 1, c + dc) === (w ? "P" : "p")) return true;
            for (const [a, d] of N) if (at(r + a, c + d) === (w ? "N" : "n")) return true;
            for (const [a, d] of K) {
                if (at(r + a, c + d) === (w ? "K" : "k")) return true;
                let rr = r + a, cc = c + d;
                while (rr >= 0 && rr < 8 && cc >= 0 && cc < 8) { const p = b[rr * 8 + cc]; if (p !== ".") { const u = p.toUpperCase(); if (isW(p) === w && (u === "Q" || (a && d ? u === "B" : u === "R"))) return true; break; } rr += a; cc += d; }
            }
            return false;
        };
        const gen = (s) => {
            const b = s.b, w = s.t === "w", out = [];
            for (let i = 0; i < 64; i++) {
                const p = b[i]; if (p === "." || isW(p) !== w) continue;
                const r = i >> 3, c = i & 7, u = p.toUpperCase(), add = (t, x) => out.push(Object.assign({ f: i, t }, x || {}));
                if (u === "P") {
                    const d = w ? -1 : 1, r1 = r + d, pr = w ? 0 : 7;
                    if (r1 < 0 || r1 > 7) continue;
                    const fwd = (t) => { if (t >> 3 === pr) ["Q", "R", "B", "N"].forEach((q) => add(t, { p: q })); else add(t); };
                    if (b[r1 * 8 + c] === ".") { fwd(r1 * 8 + c); if (r === (w ? 6 : 1) && b[(r + 2 * d) * 8 + c] === ".") add((r + 2 * d) * 8 + c); }
                    for (const dc of [-1, 1]) { const cc = c + dc; if (cc < 0 || cc > 7) continue; const t = r1 * 8 + cc; if (b[t] !== "." && isW(b[t]) !== w) fwd(t); else if (t === s.e) add(t, { ep: 1 }); }
                } else if (u === "N" || u === "K") {
                    for (const [dr, dc] of u === "N" ? N : K) { const rr = r + dr, cc = c + dc; if (rr < 0 || rr > 7 || cc < 0 || cc > 7) continue; const t = rr * 8 + cc; if (b[t] === "." || isW(b[t]) !== w) add(t); }
                    const h = w ? 60 : 4, R = w ? "R" : "r";
                    if (u === "K" && i === h && !att(b, i, !w)) {
                        if (s.c.includes(w ? "K" : "k") && b[h + 1] === "." && b[h + 2] === "." && b[h + 3] === R && !att(b, h + 1, !w) && !att(b, h + 2, !w)) add(h + 2, { cs: 1 });
                        if (s.c.includes(w ? "Q" : "q") && b[h - 1] === "." && b[h - 2] === "." && b[h - 3] === "." && b[h - 4] === R && !att(b, h - 1, !w) && !att(b, h - 2, !w)) add(h - 2, { cs: -1 });
                    }
                } else {
                    for (const [dr, dc] of D[u]) { let rr = r + dr, cc = c + dc; while (rr >= 0 && rr < 8 && cc >= 0 && cc < 8) { const t = rr * 8 + cc; if (b[t] === ".") add(t); else { if (isW(b[t]) !== w) add(t); break; } rr += dr; cc += dc; } }
                }
            }
            return out;
        };
        const make = (s, m) => {
            const b = s.b.split(""), p = b[m.f], w = s.t === "w", u = p.toUpperCase(); let cap = b[m.t] !== ".", c = s.c;
            b[m.t] = m.p ? (w ? m.p : m.p.toLowerCase()) : p; b[m.f] = ".";
            if (m.ep) { b[m.t + (w ? 8 : -8)] = "."; cap = true; }
            if (m.cs) { const h = w ? 60 : 4; if (m.cs > 0) { b[h + 1] = b[h + 3]; b[h + 3] = "."; } else { b[h - 1] = b[h - 4]; b[h - 4] = "."; } }
            const rights = { 60: "KQ", 4: "kq", 63: "K", 56: "Q", 7: "k", 0: "q" };
            [m.f, m.t].forEach((q) => { if (rights[q]) for (const ch of rights[q]) c = c.replace(ch, ""); });
            return { b: b.join(""), t: w ? "b" : "w", c, e: u === "P" && Math.abs(m.t - m.f) === 16 ? (m.f + m.t) / 2 : -1, h: u === "P" || cap ? 0 : s.h + 1 };
        };
        const legal = (s) => { const w = s.t === "w"; return gen(s).filter((m) => { const n = make(s, m); return !att(n.b, n.b.indexOf(w ? "K" : "k"), !w); }); };
        const status = (s) => {
            const ms = legal(s), w = s.t === "w", ks = s.b.indexOf(w ? "K" : "k"), chk = ks >= 0 && att(s.b, ks, !w); let end = "";
            const rest = s.b.replace(/[.kK]/g, "");
            if (!ms.length) end = chk ? "mate" : "stalemate"; else if (s.h >= 100) end = "50-move rule"; else if (rest === "" || /^[nNbB]$/.test(rest)) end = "insufficient material";
            return { ms, chk, end };
        };
        const ev = (b) => {
            let sc = 0;
            for (let i = 0; i < 64; i++) {
                const p = b[i]; if (p === ".") continue;
                const w = isW(p), u = p.toLowerCase(), r = i >> 3, c = i & 7, cen = 3.5 - Math.max(Math.abs(r - 3.5), Math.abs(c - 3.5)); let v = VAL[u];
                if (u === "n" || u === "b") v += cen * 8; else if (u === "p") v += (w ? 6 - r : r - 1) * 6 + cen * 2; else if (u === "q") v += cen * 3;
                sc += w ? v : -v;
            }
            return sc;
        };
        const search = (s, d, a, bt) => {
            if (!d) return (s.t === "w" ? 1 : -1) * ev(s.b);
            const ms = gen(s).sort((x, y) => (VAL[s.b[y.t].toLowerCase()] || 0) - (VAL[s.b[x.t].toLowerCase()] || 0)); let best = -1e9;
            for (const m of ms) {
                if (s.b[m.t].toLowerCase() === "k") return 1e5 + d;
                const v = -search(make(s, m), d - 1, -bt, -a); if (v > best) { best = v; if (v > a) a = v; if (a >= bt) break; }
            }
            return ms.length ? best : 0;
        };
        const cs = (g) => ({ b: g.b, t: g.tn, c: g.cr, e: g.ep, h: g.hm });
        const E = {
            isW, sqn, cs, legal, status, att,
            ai(g) {
                const s = cs(g), ms = legal(s); let best = null, bv = -1e9;
                ms.forEach((m) => { const v = -search(make(s, m), 2, -1e9, 1e9) + Math.random() * 6; if (v > bv) { bv = v; best = m; } });
                return best && { type: "move", p: { f: best.f, t: best.t, p: best.p } };
            },
            act(g, u, type, p, id) {
                if (type !== "move" || !p) return null;
                const s = cs(g), m = legal(s).find((x) => x.f === +p.f && x.t === +p.t && (!x.p || x.p === (p.p || "Q"))); if (!m) return null;
                const cap = s.b[m.t] !== "." || m.ep ? 1 : 0, n = make(s, m), st = status(n);
                Object.assign(g, { b: n.b, tn: n.t, cr: n.c, ep: n.e, hm: n.h, chk: st.chk ? 1 : 0, turn: n.t === "w" ? 0 : 1, turnAt: Date.now() });
                g.fx = { id, at: Date.now(), u, f: m.f, t: m.t, cap, cs: m.cs || 0 };
                let note = `${u}: ${sqn(m.f)}\u2192${sqn(m.t)}${m.p ? "=" + m.p : ""}`;
                if (st.end === "mate") { finish(g, [u], "checkmate"); note += " \u2014 checkmate!"; }
                else if (st.end) { finish(g, g.order.slice(), st.end); note += ` \u2014 draw (${st.end})`; }
                else if (st.chk) note += " +";
                return note;
            },
            leave: duelLeave,
            deal(v) { return mkGame(v, 2, () => ({ b: START, tn: "w", cr: "KQkq-", ep: -1, hm: 0, chk: 0 })); }
        };
        E.auto = autoOf(E);
        return E;
    })();

    /* ------------------------------- CHINESE CHECKERS ------------------------------- */
    const CCE = (() => {
        const CELLS = [], IDX = {};
        for (let x = -8; x <= 8; x++) for (let y = -8; y <= 8; y++) {
            const z = -x - y; if (Math.abs(z) > 8) continue;
            const hex = Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) <= 4;
            const tip = (x >= 5 && y >= -4 && z >= -4) || (x <= -5 && y <= 4 && z <= 4) || (y >= 5 && x >= -4 && z >= -4) || (y <= -5 && x <= 4 && z <= 4) || (z >= 5 && x >= -4 && y >= -4) || (z <= -5 && x <= 4 && y <= 4);
            if (hex || tip) { IDX[x + "," + y] = CELLS.length; CELLS.push([x, y, z]); }
        }
        const DIRS = [[1, -1], [-1, 1], [1, 0], [-1, 0], [0, 1], [0, -1]];
        const NB = CELLS.map(([x, y]) => DIRS.map(([a, b]) => { const j = IDX[(x + a) + "," + (y + b)]; return j == null ? -1 : j; }));
        /* ring order (clockwise from the top): -z, +x, -y, +z, -x, +y; the opposite corner is always +3 */
        const RING = [(c) => c[2] <= -5, (c) => c[0] >= 5, (c) => c[1] <= -5, (c) => c[2] >= 5, (c) => c[0] <= -5, (c) => c[1] >= 5];
        const CORNER = RING.map((f) => CELLS.map((c, i) => (f(c) ? i : -1)).filter((i) => i >= 0));
        const hd = (c, t) => (Math.abs(c[0] - t[0]) + Math.abs(c[1] - t[1]) + Math.abs(c[2] - t[2])) / 2;
        const occ = (g) => { const o = {}; g.order.forEach((u) => (g.pc[u] || []).forEach((i) => { o[i] = u; })); return o; };
        const reach = (g, f) => {
            const o = occ(g), res = {}; o[f] = null;
            NB[f].forEach((a) => { if (a >= 0 && !o[a]) res[a] = [f, a]; });
            const q = [f], seen = { [f]: [f] };
            while (q.length) {
                const c = q.shift();
                NB[c].forEach((a, k) => { if (a < 0 || !o[a]) return; const b = NB[a][k]; if (b < 0 || o[b] || seen[b]) return; seen[b] = seen[c].concat(b); q.push(b); if (!res[b]) res[b] = seen[b]; });
            }
            return res;
        };
        const won = (g, u) => { const t = CORNER[(g.cn[u] + 3) % 6], mine = g.pc[u].filter((i) => t.includes(i)).length; return mine === 10 || (mine >= 9 && t.every((i) => occ(g)[i] != null)); };
        const adv = (g) => {
            const n = g.order.length;
            for (let k = 0; k < n; k++) { g.turn = (g.turn + 1) % n; if (g.pc[g.order[g.turn]].some((f) => Object.keys(reach(g, f)).length)) break; }
            g.turnAt = Date.now();
        };
        const E = {
            CELLS, CORNER, reach,
            ai(g, u) {
                const tgt = CORNER[(g.cn[u] + 3) % 6], ts = new Set(tgt), ap = tgt.reduce((a, i) => (hd(CELLS[i], [0, 0, 0]) > hd(CELLS[a], [0, 0, 0]) ? i : a), tgt[0]), d = (i) => hd(CELLS[i], CELLS[ap]); let best = null, bs = -1e9;
                g.pc[u].forEach((f) => { const r = reach(g, f); for (const k in r) { const t = +k; let s = (d(f) - d(t)) * 10 + d(f) * 0.35 + Math.random() * 1.5; if (ts.has(t) && !ts.has(f)) s += 4; else if (ts.has(f) && !ts.has(t)) s -= 12; if (s > bs) { bs = s; best = { type: "move", p: { f, t } }; } } });
                return best;
            },
            act(g, u, type, p, id) {
                if (type !== "move" || !p || !g.pc[u].includes(+p.f)) return null;
                const path = reach(g, +p.f)[+p.t]; if (!path) return null;
                g.pc[u][g.pc[u].indexOf(+p.f)] = +p.t; g.fx = { id, at: Date.now(), u, path };
                if (won(g, u)) { finish(g, [u], "all marbles home"); return `${u} moves every marble home!`; }
                adv(g); return `${u} ${path.length > 2 ? "hops" : "steps"} (${path.length - 1} ${path.length > 2 ? "jumps" : "step"})`.replace("(1 jumps)", "(1 jump)");
            },
            leave(g, u) {
                const i = g.order.indexOf(u); if (i < 0) return false;
                g.order.splice(i, 1); delete g.pc[u]; delete g.cn[u];
                if (g.order.length < 2) { finish(g, [g.order[0]], "opponents left", 1); return true; }
                if (i < g.turn) g.turn--; else if (i === g.turn) { g.turn %= g.order.length; g.turnAt = Date.now(); }
                return true;
            },
            deal(v) {
                return mkGame(v, 4, (order) => {
                    const cs = order.length === 2 ? [0, 3] : order.length === 3 ? [0, 2, 4] : [0, 1, 3, 4], pc = {}, cn = {};
                    order.forEach((u, i) => { cn[u] = cs[i]; pc[u] = CORNER[cs[i]].slice(); });
                    return { pc, cn };
                });
            }
        };
        E.auto = autoOf(E);
        return E;
    })();

    /* ----------------- CODE BREAKERS: Color Code (Mastermind) + Bulls & Cows ----------------- */
    const CDE = (cfg) => {
        const fb = (sec, gu) => {
            let ex = 0; const cs = {}, cg = {};
            for (let i = 0; i < cfg.len; i++) if (sec[i] === gu[i]) ex++; else { cs[sec[i]] = (cs[sec[i]] || 0) + 1; cg[gu[i]] = (cg[gu[i]] || 0) + 1; }
            let co = 0; for (const k in cg) co += Math.min(cg[k], cs[k] || 0);
            return [ex, co];
        };
        const valid = (c) => Array.isArray(c) && c.length === cfg.len && c.every((x) => Number.isInteger(x) && x >= 0 && x < cfg.sym) && (cfg.dup || new Set(c).size === c.length);
        const all = (() => { const out = []; const go = (a) => { if (a.length === cfg.len) return out.push(a.slice()); for (let s = 0; s < cfg.sym; s++) if (cfg.dup || !a.includes(s)) { a.push(s); go(a); a.pop(); } }; go([]); return out; })();
        const secret = () => (cfg.dup ? Array.from({ length: cfg.len }, () => rnd(cfg.sym)) : shuf(Array.from({ length: cfg.sym }, (_, i) => i)).slice(0, cfg.len));
        const E = {
            fb, valid,
            ai(g, u) {
                if (g.sp === "set") return { type: "secret", p: { c: secret() } };
                const h = (g.gs || {})[u] || [], cands = all.filter((c) => h.every((x) => { const r = fb(c, x.c); return r[0] === x.e && r[1] === x.p; }));
                const pick = h.length || !cfg.first ? cands[rnd(cands.length)] : cfg.first;
                return { type: "guess", p: { c: pick || all[0] } };
            },
            act(g, u, type, p, id) {
                if (g.phase !== "play" || g.order[g.turn] !== u || !p || !valid(p.c)) return null;
                if (g.sp === "set") {
                    if (type !== "secret") return null;
                    const opponent = g.order.find((name) => name !== u);
                    if (!opponent) return null;
                    g.sec = g.sec || {};
                    if (g.sec[opponent]) return null;
                    g.sec[opponent] = p.c.slice();
                    g.turn = (g.turn + 1) % g.order.length; g.turnAt = Date.now();
                    if (g.order.every((name) => valid(g.sec[name]))) { g.sp = "guess"; g.turn = 0; }
                    return `${u} locked a secret code`;
                }
                if (type !== "guess" || !valid((g.sec || {})[u])) return null;
                g.gs = g.gs || {}; g.sv = g.sv || {}; const h = (g.gs[u] = g.gs[u] || []); if (h.length >= cfg.tries) return null;
                const [ex, co] = fb(g.sec[u], p.c); h.push({ c: p.c.map(Number), e: ex, p: co });
                g.fx = { id, at: Date.now(), u, n: h.length - 1, ex }; if (ex === cfg.len) g.sv[u] = h.length;
                let note = `${u} guessed \u2014 ${ex} ${cfg.fija}, ${co} ${cfg.pica}`;
                g.turn = (g.turn + 1) % g.order.length; g.turnAt = Date.now();
                if (g.turn === 0) {
                    const ws = g.order.filter((x) => g.sv[x]);
                    if (ws.length) { finish(g, ws, "cracked"); note += ws.length > 1 ? " \u2014 both cracked the code!" : ` \u2014 ${ws[0]} cracked the code!`; }
                    else if (g.order.every((x) => (g.gs[x] || []).length >= cfg.tries)) { finish(g, g.order.slice(), "out of tries"); note += " \u2014 nobody cracked it"; }
                }
                return note;
            },
            leave: duelLeave,
            deal(v) { return mkGame(v, 2, () => ({ sp: "set", sec: {}, gs: {}, sv: {} })); }
        };
        E.auto = autoOf(E);
        return E;
    };
    const MME = CDE({ len: 4, sym: 6, dup: true, tries: 10, first: [0, 0, 1, 1], fija: "exact", pica: "colour-only" });
    const BCE = CDE({ len: 4, sym: 10, dup: false, tries: 10, fija: "fijas", pica: "picas" });

    /* ------------------------------------ CONNECT FOUR ------------------------------------ */
    /* Board = 42-char string, row-major, row 0 on top: "." empty, "0" = first player (Ruby), "1" = second (Gold). */
    const C4E = (() => {
        const W = 7, H = 6, ORD = [3, 2, 4, 1, 5, 0, 6], DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];
        const put = (b, i, p) => b.slice(0, i) + p + b.slice(i + 1);
        const drop = (b, c) => { for (let r = H - 1; r >= 0; r--) if (b[r * W + c] === ".") return r; return -1; };
        const line = (b, r, c, dr, dc, p) => {
            const out = [];
            for (let k = 0; k < 4; k++) { const rr = r + dr * k, cc = c + dc * k; if (rr < 0 || rr >= H || cc < 0 || cc >= W || b[rr * W + cc] !== p) return null; out.push(rr * W + cc); }
            return out;
        };
        const win = (b, p) => { for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) for (const [dr, dc] of DIRS) { const l = line(b, r, c, dr, dc, p); if (l) return l; } return null; };
        const heur = (b, p, o) => {
            let s = 0;
            for (let r = 0; r < H; r++) if (b[r * W + 3] === p) s += 3;
            for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) for (const [dr, dc] of DIRS) {
                const er = r + dr * 3, ec = c + dc * 3; if (er < 0 || er >= H || ec < 0 || ec >= W) continue;
                let np = 0, no = 0; for (let k = 0; k < 4; k++) { const x = b[(r + dr * k) * W + c + dc * k]; if (x === p) np++; else if (x === o) no++; }
                if (!no) s += [0, 1, 5, 30, 0][np];
            }
            return s;
        };
        const neg = (b, me, op, d, a, bt) => {
            if (win(b, op)) return -1e5 - d;
            const cols = ORD.filter((c) => b[c] === "."); if (!cols.length) return 0;
            if (!d) return heur(b, me, op) - heur(b, op, me);
            let best = -1e9;
            for (const c of cols) { const v = -neg(put(b, drop(b, c) * W + c, me), op, me, d - 1, -bt, -a); if (v > best) { best = v; if (v > a) a = v; if (a >= bt) break; } }
            return best;
        };
        const E = {
            W, H, win,
            ai(g, u) {
                if (g.phase !== "play") return null;
                const me = String(g.order.indexOf(u)), op = me === "0" ? "1" : "0"; let best = null, bv = -1e9;
                ORD.forEach((c) => { const r = drop(g.bd, c); if (r < 0) return; const v = -neg(put(g.bd, r * W + c, me), op, me, 4, -1e9, 1e9) + Math.random() * 2; if (v > bv) { bv = v; best = c; } });
                return best == null ? null : { type: "drop", p: { c: best } };
            },
            act(g, u, type, p, id) {
                if (type !== "drop" || !p) return null;
                const c = Number(p.c); if (!Number.isInteger(c) || c < 0 || c >= W) return null;
                const r = drop(g.bd, c); if (r < 0) return null;
                const pc = String(g.order.indexOf(u)); g.bd = put(g.bd, r * W + c, pc); g.fx = { id, at: Date.now(), u, c, r };
                const note = `${u} dropped a chip in column ${c + 1}`, w = win(g.bd, pc);
                if (w) { g.ln = w; finish(g, [u], "four in a row"); return note + " — four in a row!"; }
                if (!g.bd.includes(".")) { finish(g, g.order.slice(), "board full"); return note + " — the board is full"; }
                g.turn = (g.turn + 1) % 2; g.turnAt = Date.now(); return note;
            },
            leave: duelLeave,
            deal(v) { return mkGame(v, 2, () => ({ bd: ".".repeat(W * H) })); }
        };
        E.auto = autoOf(E);
        return E;
    })();

    /* -------------------------------------- BATTLESHIP -------------------------------------- */
    /* fl[user] = 100-char fleet grid ("." water, "0".."4" ship ids); sh[user] = shots received on that board ("." / "m" miss / "h" hit).
       Sub-phase g.sp: "place" (both fleets are deployed simultaneously) -> "fire" (alternating shots). */
    const BSE = (() => {
        const SH = [["Carrier", 5], ["Battleship", 4], ["Cruiser", 3], ["Submarine", 3], ["Destroyer", 2]], COORD = (i) => "ABCDEFGHIJ"[i % 10] + (Math.floor(i / 10) + 1);
        const cellsOf = (f, id) => { const o = []; for (let i = 0; i < 100; i++) if (f[i] === String(id)) o.push(i); return o; };
        const valid = (f) => {
            if (typeof f !== "string" || f.length !== 100 || !/^[.0-4]{100}$/.test(f)) return false;
            return SH.every(([, len], id) => { const c = cellsOf(f, id); return c.length === len && (c.every((x, k) => x === c[0] + k && Math.floor(x / 10) === Math.floor(c[0] / 10)) || c.every((x, k) => x === c[0] + k * 10)); });
        };
        const rand = () => {
            for (; ;) {
                const f = Array(100).fill("."); let ok = true;
                for (let id = 0; id < 5 && ok; id++) {
                    const len = SH[id][1]; let done = false;
                    for (let t = 0; t < 200 && !done; t++) {
                        const hz = Math.random() < 0.5, r = rnd(hz ? 10 : 11 - len), c = rnd(hz ? 11 - len : 10);
                        const cs = Array.from({ length: len }, (_, k) => (r + (hz ? 0 : k)) * 10 + c + (hz ? k : 0));
                        if (cs.every((i) => f[i] === ".")) { cs.forEach((i) => { f[i] = String(id); }); done = true; }
                    }
                    ok = done;
                }
                if (ok) return f.join("");
            }
        };
        const sunk = (f, sh, id) => cellsOf(f, id).every((i) => sh[i] === "h");
        const afloat = (g, u) => (g.fl && g.fl[u] && g.sh && g.sh[u] ? SH.filter((_, id) => !sunk(g.fl[u], g.sh[u], id)).length : 5);
        const E = {
            SH, COORD, valid, rand, sunk, afloat, cellsOf,
            begin(g) { g.sp = "fire"; g.turn = 0; g.turnAt = Date.now(); },
            place(g, u, f) {
                if (g.sp !== "place" || !g.order.includes(u) || (g.rd && g.rd[u]) || !valid(f)) return null;
                (g.fl = g.fl || {})[u] = f; (g.rd = g.rd || {})[u] = 1;
                if (g.order.every((x) => g.rd[x])) { E.begin(g); return `${u} is deployed — both fleets ready, ${g.order[0]} fires first`; }
                return `${u} deployed their fleet`;
            },
            autoPlace(g) { (g.fl = g.fl || {}); (g.rd = g.rd || {}); g.order.forEach((u) => { if (!g.rd[u]) { g.fl[u] = rand(); g.rd[u] = 1; } }); E.begin(g); },
            ai(g, u) {
                if (g.sp !== "fire" || g.phase !== "play") return null;
                const foe = g.order.find((x) => x !== u), sh = g.sh[foe], fl = g.fl[foe], un = (i) => sh[i] === ".";
                const nb = (i) => { const r = Math.floor(i / 10), c = i % 10, o = []; if (r > 0) o.push(i - 10); if (r < 9) o.push(i + 10); if (c > 0) o.push(i - 1); if (c < 9) o.push(i + 1); return o; };
                const live = []; for (let i = 0; i < 100; i++) if (sh[i] === "h" && !sunk(fl, sh, +fl[i])) live.push(i);
                let pool = [];
                if (live.length) {
                    let bs = 0; const sc = {};
                    live.forEach((i) => nb(i).forEach((j) => { if (!un(j)) return; const s = 1 + (live.includes(i - (j - i)) ? 3 : 0); sc[j] = (sc[j] || 0) + s; if (sc[j] > bs) bs = sc[j]; }));
                    pool = Object.keys(sc).filter((k) => sc[k] === bs).map(Number);
                }
                if (!pool.length) { for (let i = 0; i < 100; i++) if (un(i) && (Math.floor(i / 10) + (i % 10)) % 2 === 0) pool.push(i); }
                if (!pool.length) for (let i = 0; i < 100; i++) if (un(i)) pool.push(i);
                return pool.length ? { type: "fire", p: { i: pool[rnd(pool.length)] } } : null;
            },
            act(g, u, type, p, id) {
                if (type !== "fire" || g.sp !== "fire" || !p) return null;
                const foe = g.order.find((x) => x !== u), i = Number(p.i); if (!foe || !Number.isInteger(i) || i < 0 || i > 99) return null;
                const sh = g.sh[foe]; if (sh[i] !== ".") return null;
                const cell = g.fl[foe][i], hit = cell !== "."; g.sh[foe] = sh.slice(0, i) + (hit ? "h" : "m") + sh.slice(i + 1);
                let r = hit ? "hit" : "miss", name = "";
                if (hit && sunk(g.fl[foe], g.sh[foe], +cell)) { r = "sunk"; name = SH[+cell][0]; }
                g.fx = { id, at: Date.now(), u, i, r, n: name };
                let note = `${u} fires at ${COORD(i)} — ` + (r === "miss" ? "Miss" : r === "hit" ? "Hit!" : `${foe}'s ${name} is Sunk!`);
                if (afloat(g, foe) === 0) { finish(g, [u], "fleet destroyed"); return note + " — fleet destroyed!"; }
                g.turn = (g.turn + 1) % 2; g.turnAt = Date.now(); return note;
            },
            leave: duelLeave,
            deal(v) {
                return mkGame(v, 2, (order) => {
                    const fl = {}, sh = {}, rd = {};
                    order.forEach((u) => { sh[u] = ".".repeat(100); if (u === BOT) { fl[u] = rand(); rd[u] = 1; } });
                    return { sp: "place", fl, sh, rd, last: "Deploy your fleets" };
                });
            }
        };
        E.auto = autoOf(E);
        return E;
    })();
    /*DE-END*/

    /* ---- Local table: same interface as a Firebase ref, so solo AI matches reuse the whole Party flow (lobby, stake, chips) ---- */
    class LocalRef {
        constructor(v) { this.v = v; this.cbs = []; }
        snap() { const v = this.v == null ? null : JSON.parse(JSON.stringify(this.v)); return { val: () => v }; }
        on(e, cb) { this.cbs.push(cb); cb(this.snap()); }
        off(e, cb) { this.cbs = this.cbs.filter((c) => c !== cb); }
        child() { return { onDisconnect: () => ({ remove() { }, cancel() { } }) }; }
        transaction(fn) {
            const r = fn(this.snap().val()); if (r === undefined) return Promise.resolve({ committed: false });
            this.v = r; this.cbs.slice().forEach((c) => c(this.snap())); return Promise.resolve({ committed: true });
        }
    }

    /** Party table + optional single-player match against the Casino Bot (runs entirely in the browser). */
    const Duel = (o) => {
        const P = Party(o), B = { stop: P.stop, leave: P.leave, closeTable: P.closeTable, deal: P.deal, common: P.common, render: P.render, sync: P.sync }, el = (s) => $(o.p + "-" + s);
        return Object.assign(P, {
            local: false, aiT: 0, snd: null,
            stop() { B.stop.call(this); clearTimeout(this.aiT); this.local = false; },
            solo() {
                const me = State.username; if (!me) return; this.stop(); this.local = true;
                this.ref = new LocalRef({ phase: "lobby", owner: me, seats: { s0: me, s1: BOT }, max: 2, rot: 0, bet: 0, hid: Date.now(), turnAt: Date.now() });
                this.cb = (s) => { const n = s.val() || { phase: "lobby" }; if (n.hid !== this.g.hid) this.onNew(); this.g = n; this.sync(); this.render(); this.think(); };
                this.ref.on("value", this.cb);
                this.tick = window.setInterval(() => { if (this.g.phase === "play") this.controls(); }, 1000);
            },
            deal() {
                if (!this.local) return B.deal.call(this);
                const bet = this.g.bet || 0; if (bet && !BetLimits.ok(Router.currentGameKey, bet)) return; if (State.balance < bet) return Notify.error(`You need ${bet} chips to cover the stake.`);
                this.ref.transaction((v) => (v && v.phase === "lobby" ? o.E.deal(v) : undefined));
            },
            leave() {
                if (!this.local) return B.leave.call(this);
                const g = this.g, me = State.username;
                if (g.phase === "play") {
                    if (!window.confirm("Forfeit the match? You lose your stake.")) return;
                    this.store(`${o.key}-done-${Room.code}-${g.hid}-${me}`, "1");
                    if (this.paid > 0) resolveGameOutcome(o.key, { roundId: g.hid + "-" + me, entries: [{ wager: this.paid, payout: 0 }] });
                    Sound.lose();
                }
                this.start();
            },
            closeTable() { if (this.local) this.start(); else B.closeTable.call(this); },
            /** Same chip settlement as every table game; a split pot (draw) settles quietly with no "you win" fanfare. */
            sync() {
                const r = this.g.res; if (!(this.g.phase === "done" && r && r.ws.length > 1)) return B.sync.call(this);
                const c = [Effects.celebrate, BW.sparkle, Notify.success]; Effects.celebrate = BW.sparkle = Notify.success = () => { };
                try { B.sync.call(this); } finally { [Effects.celebrate, BW.sparkle, Notify.success] = c; }
            },
            /** The bot thinks for a moment, then plays inside a local transaction (same engine call a human move uses). */
            think() {
                clearTimeout(this.aiT); const g = this.g;
                if (!this.local || g.phase !== "play" || g.order[g.turn] !== BOT) return;
                const hid = g.hid, turn = g.turn;
                this.aiT = window.setTimeout(() => {
                    const c = this.g; if (c.hid !== hid || c.phase !== "play" || c.turn !== turn) return;
                    this.ref.transaction((v) => {
                        if (!v || v.phase !== "play" || v.order[v.turn] !== BOT) return;
                        const id = Date.now() + "-bot", m = o.E.ai(v, BOT); let note = m && o.E.act(v, BOT, m.type, m.p, id);
                        if (!note) note = o.E.auto(v, BOT, id); if (!note) return;
                        v.last = note; return v;
                    });
                }, o.delay || 900);
            },
            common(my) {
                B.common.call(this, my); const g = this.g, me = State.username, live = el("live"), r = g.res;
                if (this.local) el("kick").hidden = true;
                const out = g.phase === "done" && r ? ((r.ws || []).length > 1 ? "draw" : r.ws.includes(me) ? "win" : "lose") : "";
                live.dataset.res = out;
                if (out && this.snd !== g.hid && (g.order || []).includes(me)) { this.snd = g.hid; if (out === "lose") { Sound.lose(); Notify.warning("You lost this match."); } else if (out === "draw") Notify.success("Draw \u2014 stakes are split."); }
            },
            render() {
                B.render.call(this); const g = this.g, lob = el("lobby");
                if (this.local || lob.hidden || Tables.seatOf(g.seats || {}, State.username)) return;
                const row = mk("div", "tl-actions"), b = mk("button", "btn btn-action", "\u{1F916} Play vs AI (single player)"); b.type = "button"; b.addEventListener("click", () => this.solo()); row.appendChild(b); lob.appendChild(row);
            }
        });
    };
    const resText = (g, label) => {
        const r = g.res, pot = r.pot ? ` \u2014 ${r.pot} chips${r.ws.length > 1 ? " split" : ""}` : "", w = r.ws.join(" & ");
        return r.left ? `${w} wins by default${pot}.` : r.ws.length > 1 ? `Draw (${r.why})${pot}.` : `${w} wins \u2014 ${r.why || label}${pot}!`;
    };
    const strip = (g, who, extra) => {
        const s = $(g.p + "-players"); s.textContent = "";
        (g.o.order || []).forEach((u, i) => {
            const d = mk("div", `bw-seat pq-pl pk${i}` + (u === who ? " turn" : "") + (g.o.res && g.o.res.ws.includes(u) ? " win" : ""));
            d.appendChild(mk("div", "bw-name", (u === who ? "\u25B6 " : "") + u + (u === State.username ? " (you)" : ""))); d.appendChild(mk("div", "bw-info", extra(u, i))); s.appendChild(d);
        });
    };
    const turnInfo = (g) => { const me = State.username, order = g.order || [], live = g.phase === "play", who = live ? order[g.turn] : null; return { me, order, live, who, my: live && who === me, inGame: order.includes(me) }; };

    /* ---------------------------------- CHESS ---------------------------------- */
    const GLYPH = { K: "\u265A", Q: "\u265B", R: "\u265C", B: "\u265D", N: "\u265E", P: "\u265F" };
    const CH = Duel({ key: "chess", p: "ch", node: "chess", label: "Chess", max: 2, E: CHE, delay: 650 });
    Object.assign(CH, {
        sel: null, pend: null,
        onNew() { this.sel = this.pend = null; if ($("ch-promo")) $("ch-promo").hidden = true; },
        setup() {
            $("ch-board").addEventListener("click", (e) => { const q = e.target.closest("[data-sq]"); if (q) this.click(+q.dataset.sq); });
            $("ch-promo").querySelectorAll("[data-p]").forEach((b) => b.addEventListener("click", () => { const d = this.pend; this.pend = this.sel = null; $("ch-promo").hidden = true; if (d) this.act("move", { f: d.f, t: d.t, p: b.dataset.p }); }));
            $("ch-promo-x").addEventListener("click", () => { this.pend = this.sel = null; $("ch-promo").hidden = true; this.view(); });
        },
        click(q) {
            const g = this.g, me = State.username; if (g.phase !== "play" || g.order[g.turn] !== me) return;
            const s = CHE.cs(g), p = s.b[q], ms = CHE.legal(s);
            if (this.sel != null) {
                const c = ms.filter((m) => m.f === this.sel && m.t === q);
                if (c.length) { if (c[0].p) { this.pend = { f: this.sel, t: q }; $("ch-promo").hidden = false; return; } const f = this.sel; this.sel = null; return this.act("move", { f, t: q }); }
            }
            this.sel = p !== "." && CHE.isW(p) === (g.order[0] === me) && ms.some((m) => m.f === q) ? q : null; this.view();
        },
        view() {
            const g = this.g, me = State.username, flip = g.order[1] === me, s = CHE.cs(g), { who, my } = turnInfo(g);
            const tg = this.sel != null ? CHE.legal(s).filter((m) => m.f === this.sel).map((m) => m.t) : [], fx = g.fx, ks = g.chk ? s.b.indexOf(s.t === "w" ? "K" : "k") : -1;
            strip({ p: "ch", o: g }, who, (u, i) => (i ? "\u265A Black" : "\u2654 White")); const b = $("ch-board"); b.textContent = "";
            for (let k = 0; k < 64; k++) {
                const q = flip ? 63 - k : k, r = q >> 3, c = q & 7, p = s.b[q], sq = mk("div", "ch-sq " + ((r + c) & 1 ? "dk" : "lt")); sq.dataset.sq = q;
                if (q === this.sel) sq.classList.add("sel"); if (tg.includes(q)) sq.classList.add(p === "." ? "tgt" : "cap"); if (fx && (fx.f === q || fx.t === q)) sq.classList.add("last"); if (q === ks) sq.classList.add("chk");
                if (p !== ".") { const pc = mk("span", "pc " + (CHE.isW(p) ? "w" : "b"), GLYPH[p.toUpperCase()] + "\uFE0E"); pc.setAttribute("aria-label", p); sq.appendChild(pc); }
                if ((k & 7) === 0) sq.appendChild(mk("i", "rk", String(8 - r))); if (k >> 3 === 7) sq.appendChild(mk("i", "fl", "abcdefgh"[c]));
                b.appendChild(sq);
            }
            $("ch-promo").hidden = !this.pend;
        },
        controls() {
            const g = this.g, { who, my, live } = turnInfo(g); let m = "";
            if (g.phase === "done" && g.res) m = resText(g, "checkmate"); else if (my) m = g.chk ? "Check! Your move \u2014 protect your king." : "Your move \u2014 tap a piece, then a highlighted square."; else if (live) m = `${who} is thinking\u2026`;
            $("ch-status").textContent = m; $("ch-log").textContent = g.last || ""; this.common(my);
        },
        playFx() {
            const g = this.g, fx = g.fx; if (!fx || fx.id === this.lastFx) return; const late = this.lastFx === null; this.lastFx = fx.id;
            if ((late && Date.now() - fx.at > 4000) || CardFX.reduced() || Router.currentGameKey !== "chess") return;
            const b = $("ch-board"), flip = g.order[1] === State.username, sz = b.clientWidth / 8, d = (q) => (flip ? 63 - q : q);
            const glide = (from, to, z) => {
                const e = b.querySelector(`[data-sq="${to}"] .pc`); if (!e) return; const a = d(from), c = d(to);
                e.style.zIndex = z; e.animate([{ transform: `translate(${((a & 7) - (c & 7)) * sz}px,${((a >> 3) - (c >> 3)) * sz}px) scale(1.12)` }, { transform: "none" }], { duration: 420, easing: "cubic-bezier(.3,.7,.2,1)" }).onfinish = () => { e.style.zIndex = ""; };
            };
            glide(fx.f, fx.t, 6); if (fx.cs) glide(fx.cs > 0 ? fx.t + 1 : fx.t - 2, fx.t - fx.cs, 5);
            Sound.tone(fx.cap ? 170 : 420, fx.cap ? 170 : 60, fx.cap ? "sawtooth" : "triangle", 0.05); CardFX.until = performance.now() + 500;
        }
    });

    /* ------------------------------- CHINESE CHECKERS ------------------------------- */
    const CC = Duel({ key: "checkers", p: "cc", node: "checkers", label: "Chinese Checkers", max: 4, E: CCE, delay: 800 });
    const XY = CCE.CELLS.map(([x, , z]) => [x + z / 2, z * 0.8660254]), MX = [Math.min(...XY.map((a) => a[0])), Math.max(...XY.map((a) => a[0]))], MY = [Math.min(...XY.map((a) => a[1])), Math.max(...XY.map((a) => a[1]))];
    const cpos = (i) => [4 + ((XY[i][0] - MX[0]) / (MX[1] - MX[0])) * 92, 4 + ((XY[i][1] - MY[0]) / (MY[1] - MY[0])) * 92], cplace = (e, i) => { const [x, y] = cpos(i); e.style.left = x.toFixed(3) + "%"; e.style.top = y.toFixed(3) + "%"; };
    Object.assign(CC, {
        sel: null,
        onNew() { this.sel = null; },
        setup() {
            const b = $("cc-board"); b.style.aspectRatio = `${MX[1] - MX[0]} / ${MY[1] - MY[0]}`;
            CCE.CELLS.forEach((_, i) => { const h = mk("div", "cc-hole"); h.dataset.i = i; cplace(h, i); b.appendChild(h); });
            b.appendChild(mk("div", "cc-pcs")).id = "cc-pcs";
            b.addEventListener("click", (e) => {
                const g = this.g, me = State.username, t = e.target.closest("[data-i]"); if (!t || g.phase !== "play" || g.order[g.turn] !== me) return; const i = +t.dataset.i;
                if ((g.pc[me] || []).includes(i)) { this.sel = this.sel === i ? null : i; return this.view(); }
                if (this.sel != null && t.classList.contains("hint")) { const f = this.sel; this.sel = null; this.act("move", { f, t: i }); }
            });
        },
        view() {
            const g = this.g, { me, order, who, my } = turnInfo(g), r = my && this.sel != null ? CCE.reach(g, this.sel) : {}, zone = {};
            strip({ p: "cc", o: g }, who, (u) => `${(g.pc[u] || []).filter((i) => CCE.CORNER[(g.cn[u] + 3) % 6].includes(i)).length}/10 home`);
            order.forEach((u, pi) => CCE.CORNER[g.cn[u]].forEach((i) => { zone[i] = pi; }));
            $("cc-board").querySelectorAll(".cc-hole").forEach((h, i) => { h.className = "cc-hole" + (zone[i] != null ? " z pk" + zone[i] : "") + (r[i] ? " hint" : ""); });
            const L = $("cc-pcs"); L.textContent = "";
            order.forEach((u, pi) => g.pc[u].forEach((i) => {
                const e = mk("div", "cc-pc pk" + pi + (i === this.sel ? " sel" : "")); e.dataset.i = i; e.dataset.u = u; cplace(e, i);
                if (u === me && my && g.phase === "play") { e.classList.add("ok"); e.setAttribute("role", "button"); e.tabIndex = 0; e.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); e.click(); } }); }
                L.appendChild(e);
            }));
        },
        controls() {
            const g = this.g, { who, my, live } = turnInfo(g); let m = "";
            if (g.phase === "done" && g.res) m = resText(g, "all marbles home"); else if (my) m = this.sel == null ? "Your move \u2014 pick a marble, then a glowing hole. Chain jumps over any marble." : "Choose a glowing hole (steps or chained jumps)."; else if (live) m = `${who} is thinking\u2026`;
            $("cc-status").textContent = m; $("cc-log").textContent = g.last || ""; this.common(my);
        },
        playFx() {
            const g = this.g, fx = g.fx; if (!fx || fx.id === this.lastFx) return; const late = this.lastFx === null; this.lastFx = fx.id;
            if ((late && Date.now() - fx.at > 4000) || CardFX.reduced() || Router.currentGameKey !== "checkers") return;
            const e = $("cc-pcs").querySelector(`[data-i="${fx.path[fx.path.length - 1]}"]`); if (!e) return;
            const kf = fx.path.map((i, k) => { const [x, y] = cpos(i); return { left: x + "%", top: y + "%", transform: `translate(-50%,-50%) scale(${k && k < fx.path.length - 1 ? 1.25 : 1})` }; }), n = kf.length - 1;
            kf[n].left = e.style.left; kf[n].top = e.style.top; e.style.zIndex = "9";
            e.animate(kf, { duration: Math.max(300, 260 * n), easing: "ease-in-out" }).onfinish = () => { e.style.zIndex = ""; };
            fx.path.forEach((_, k) => { if (k) window.setTimeout(() => Sound.tone(380 + k * 40, 40, "triangle", 0.03), (260 * n / n) * k); }); CardFX.until = performance.now() + 260 * n + 100;
        }
    });

    /* --------------- CODE BREAKERS (shared UI): Color Code Breaker + Bulls & Cows --------------- */
    const codeUI = (G, cfg) => Object.assign(G, {
        cur: [],
        onNew() { this.cur = []; this.entryTurn = null; },
        setup() {
            const pal = $(cfg.p + "-pal");
            for (let v = 0; v < cfg.sym; v++) { const b = mk("button", cfg.kind === "col" ? `cd-peg c${v}` : "cd-key", cfg.kind === "col" ? "" : String(v)); b.type = "button"; b.dataset.v = v; b.setAttribute("aria-label", cfg.kind === "col" ? cfg.names[v] : "Digit " + v); b.addEventListener("click", () => this.push(v)); pal.appendChild(b); }
            $(cfg.p + "-back").addEventListener("click", () => { this.cur.pop(); this.cursor(); }); $(cfg.p + "-submit").addEventListener("click", () => { const c = this.cur.slice(); this.cur = []; this.act(this.g.sp === "set" ? "secret" : "guess", { c }); this.cursor(); });
        },
        push(v) { const { my } = turnInfo(this.g); if (!my || this.cur.length >= cfg.len || (!cfg.dup && this.cur.includes(v))) return; this.cur.push(v); this.cursor(); },
        peg(v, cls) { return cfg.kind === "col" ? mk("span", `cd-peg sm c${v} ${cls || ""}`) : mk("span", "cd-dig " + (cls || ""), String(v)); },
        cursor() {
            const token = `${this.g.hid}:${this.g.sp}:${this.g.turn}:${this.g.turnAt}`;
            if (this.entryTurn !== token) { this.cur = []; this.entryTurn = token; }
            const { my } = turnInfo(this.g), c = $(cfg.p + "-cur"); c.textContent = "";
            for (let i = 0; i < cfg.len; i++) { const s = this.cur[i] != null ? this.peg(this.cur[i], "fill") : mk("span", "cd-empty"); c.appendChild(s); }
            $(cfg.p + "-pal").querySelectorAll("button").forEach((b) => { b.disabled = !my || (!cfg.dup && this.cur.includes(+b.dataset.v)) || this.cur.length >= cfg.len; });
            $(cfg.p + "-submit").textContent = this.g.sp === "set" ? "Lock secret for opponent" : "Submit guess";
            $(cfg.p + "-submit").disabled = !my || this.cur.length !== cfg.len; $(cfg.p + "-back").disabled = !my || !this.cur.length; $(cfg.p + "-entry").hidden = !my;
        },
        view() {
            const g = this.g, { me, order, who } = turnInfo(g), fx = g.fx && g.fx.id !== this.lastFx && Date.now() - g.fx.at < 4000 ? g.fx : null, done = g.phase === "done", root = $(cfg.p + "-boards"); root.textContent = "";
            strip({ p: cfg.p, o: g }, who, (u) => `${(g.gs && g.gs[u] ? g.gs[u].length : 0)}/${cfg.tries} guesses`);
            (order.includes(me) ? [me].concat(order.filter((u) => u !== me)) : order).forEach((u) => {
                const box = mk("div", "cd-board" + (u === me ? " mine" : "")), h = (g.gs && g.gs[u]) || [];
                box.appendChild(mk("div", "bw-name", u === me ? "Your code attempts" : `${u}'s attempts`));
                if (done && g.sec && g.sec[u]) { const r = mk("div", "cd-row secret"); r.appendChild(mk("span", "cd-n", "\u2605")); const s = mk("span", "cd-slots"); g.sec[u].forEach((v) => s.appendChild(this.peg(v, "fill"))); r.appendChild(s); r.appendChild(mk("span", "cd-fb", "secret")); box.appendChild(r); }
                for (let i = 0; i < cfg.tries; i++) {
                    const x = h[i], row = mk("div", "cd-row" + (x ? " done" : "") + (fx && fx.u === u && fx.n === i ? " new" : "") + (x && x.e === cfg.len ? " cracked" : "")); row.appendChild(mk("span", "cd-n", String(i + 1)));
                    const s = mk("span", "cd-slots"); for (let k = 0; k < cfg.len; k++) s.appendChild(x ? this.peg(x.c[k], "fill") : mk("span", "cd-empty")); row.appendChild(s);
                    const pins = mk("span", "cd-pins"); for (let k = 0; k < cfg.len; k++) { const p = mk("i", x ? (k < x.e ? "k" : k < x.e + x.p ? "w" : "") : ""); p.style.animationDelay = k * 90 + "ms"; pins.appendChild(p); } row.appendChild(pins);
                    if (cfg.kind === "num") row.appendChild(mk("span", "cd-fb", x ? `${x.e}F \u00B7 ${x.p}P` : ""));
                    box.appendChild(row);
                }
                root.appendChild(box);
            });
            this.cursor();
        },
        controls() {
            const g = this.g, { who, my, live } = turnInfo(g); let m = "";
            if (g.phase === "done" && g.res) m = resText(g, "cracked the code"); else if (g.sp === "set") m = my ? "Choose a secret code for your opponent. It stays hidden until the match ends." : `${who} is choosing a secret code…`; else if (my) m = cfg.hint; else if (live) m = `${who} is thinking\u2026`;
            $(cfg.p + "-status").textContent = m; $(cfg.p + "-log").textContent = g.last || ""; this.common(my); this.cursor();
        },
        playFx() {
            const fx = this.g.fx; if (!fx || fx.id === this.lastFx) return; const late = this.lastFx === null; this.lastFx = fx.id;
            if ((late && Date.now() - fx.at > 4000) || CardFX.reduced()) return;
            Sound.tone(300 + fx.ex * 90, 90, "triangle", 0.04); if (fx.ex === cfg.len) window.setTimeout(() => Sound.win(), 150); CardFX.until = performance.now() + 400;
        }
    });
    const MM = codeUI(Duel({ key: "mastermind", p: "mm", node: "mastermind", label: "Color Code Breaker", max: 2, E: MME, delay: 1100 }), { p: "mm", kind: "col", len: 4, sym: 6, dup: true, tries: 10, names: ["Ruby", "Gold", "Emerald", "Sapphire", "Amethyst", "Silver"], hint: "Your turn \u2014 build a 4-colour code. Gold pin = right colour & place, silver pin = right colour, wrong place." });
    const BC = codeUI(Duel({ key: "bullscows", p: "bc", node: "bullscows", label: "Bulls & Cows", max: 2, E: BCE, delay: 1100 }), { p: "bc", kind: "num", len: 4, sym: 10, dup: false, tries: 10, hint: "Your turn \u2014 enter 4 different digits. Fija = right digit, right place. Pica = right digit, wrong place." });


    /* ---------------------------------- CONNECT FOUR (UI) ---------------------------------- */
    const C4 = Duel({ key: "connect4", p: "c4", node: "connect4", label: "Connect Four", max: 2, E: C4E, delay: 800 });
    Object.assign(C4, {
        onNew() { },
        setup() {
            const d = $("c4-drops");
            for (let c = 0; c < C4E.W; c++) { const b = mk("button", "c4-drop", "▼"); b.type = "button"; b.dataset.c = c; b.setAttribute("aria-label", "Drop a chip in column " + (c + 1)); b.addEventListener("click", () => this.col(c)); d.appendChild(b); }
            $("c4-board").addEventListener("click", (e) => { const t = e.target.closest("[data-c]"); if (t) this.col(+t.dataset.c); });
        },
        col(c) { const g = this.g; if (g.phase === "play" && turnInfo(g).my) this.act("drop", { c }); },
        view() {
            const g = this.g, { who, my } = turnInfo(g), bd = g.bd || ".".repeat(42), ln = g.ln || [], fx = g.fx && g.fx.id !== this.lastFx && Date.now() - g.fx.at < 4000 ? g.fx : null;
            strip({ p: "c4", o: g }, who, (u, i) => (i ? "● Gold chips" : "● Ruby chips"));
            const b = $("c4-board"); b.textContent = "";
            for (let i = 0; i < 42; i++) {
                const r = Math.floor(i / 7), c = i % 7, cell = mk("div", "c4-cell" + (ln.includes(i) ? " win" : "") + (g.fx && g.fx.r === r && g.fx.c === c ? " last" : "")); cell.dataset.c = c;
                if (bd[i] !== ".") {
                    const chip = mk("div", "c4-chip pk" + bd[i]); if (fx && fx.r === r && fx.c === c) { chip.classList.add("drop"); chip.style.setProperty("--r", r); }
                    cell.appendChild(chip);
                }
                b.appendChild(cell);
            }
            $("c4-drops").querySelectorAll(".c4-drop").forEach((x) => { x.disabled = !my || bd[+x.dataset.c] !== "."; });
        },
        controls() {
            const g = this.g, { who, my, live } = turnInfo(g); let m = "";
            if (g.phase === "done" && g.res) m = resText(g, "four in a row"); else if (my) m = "Your turn — pick a column to drop your chip."; else if (live) m = `${who} is thinking…`;
            $("c4-status").textContent = m; $("c4-log").textContent = g.last || ""; this.common(my);
        },
        playFx() {
            const g = this.g, fx = g.fx; if (!fx || fx.id === this.lastFx) return; const late = this.lastFx === null; this.lastFx = fx.id;
            if ((late && Date.now() - fx.at > 4000) || CardFX.reduced() || Router.currentGameKey !== "connect4") return;
            window.setTimeout(() => Sound.tone(240 + fx.r * 25, 70, "triangle", 0.05), 180 + fx.r * 60);
            if (g.phase === "done" && g.ln) window.setTimeout(() => Sound.win(), 600);
            CardFX.until = performance.now() + 700;
        }
    });

    /* ----------------------------------- BATTLESHIP (UI) ----------------------------------- */
    const BS = Duel({ key: "battleship", p: "bs", node: "battleship", label: "Battleship", max: 2, E: BSE, delay: 900 });
    const bsKick = BS.kick;
    Object.assign(BS, {
        pl: null, ct: 0,
        onNew() { this.pl = { f: Array(100).fill("."), sel: 0, hz: true }; },
        kick() {
            const g = this.g;
            if (g.phase === "play" && g.sp === "place") {
                if (Date.now() - (g.turnAt || 0) < this.IDLE) return Notify.warning("Give them a little longer.");
                return this.ref.transaction((v) => { if (!v || v.phase !== "play" || v.sp !== "place" || Date.now() - (v.turnAt || 0) < this.IDLE) return; BSE.autoPlace(v); v.last = "An idle fleet was deployed automatically"; return v; });
            }
            return bsKick.call(this);
        },
        place(f) { const me = State.username; if (!this.ref || !me) return; this.ref.transaction((v) => { if (!v || v.phase !== "play") return; const n = BSE.place(v, me, f); if (!n) return; v.last = n; return v; }); },
        setup() {
            this.onNew();
            $("bs-rotate").addEventListener("click", () => { this.pl.hz = !this.pl.hz; this.view(); });
            $("bs-random").addEventListener("click", () => { this.pl.f = BSE.rand().split(""); this.pl.sel = null; this.view(); });
            $("bs-reset").addEventListener("click", () => { this.onNew(); this.view(); });
            $("bs-ready").addEventListener("click", () => { const f = this.pl.f.join(""); if (BSE.valid(f)) this.place(f); });
            $("bs-ships").addEventListener("click", (e) => { const b = e.target.closest("[data-id]"); if (!b) return; const id = +b.dataset.id; if (this.pl.f.includes(String(id))) this.pl.f = this.pl.f.map((x) => (x === String(id) ? "." : x)); this.pl.sel = id; this.view(); });
            $("bs-boards").addEventListener("click", (e) => { const t = e.target.closest("[data-i]"); if (!t) return; this.cell(t.closest("[data-b]").dataset.b, +t.dataset.i); });
        },
        placing() { const g = this.g, me = State.username; return g.phase === "play" && g.sp === "place" && (g.order || []).includes(me) && !(g.rd && g.rd[me]); },
        cell(kind, i) {
            const g = this.g, me = State.username, pl = this.pl;
            if (kind === "me" && this.placing()) {
                const k = pl.f[i];
                if (k !== ".") { pl.f = pl.f.map((x) => (x === k ? "." : x)); pl.sel = +k; return this.view(); }
                if (pl.sel == null || pl.f.includes(String(pl.sel))) return Notify.warning("Select a ship first.");
                const len = BSE.SH[pl.sel][1], r = Math.floor(i / 10), c = i % 10;
                if ((pl.hz ? c + len > 10 : r + len > 10)) return Notify.warning("That ship does not fit there.");
                const cs = Array.from({ length: len }, (_, n) => i + (pl.hz ? n : n * 10));
                if (cs.some((x) => pl.f[x] !== ".")) return Notify.warning("Ships can't overlap.");
                cs.forEach((x) => { pl.f[x] = String(pl.sel); });
                const nx = BSE.SH.findIndex((_, id) => !pl.f.includes(String(id))); pl.sel = nx < 0 ? null : nx; return this.view();
            }
            if (kind === "foe" && g.phase === "play" && g.sp === "fire" && turnInfo(g).my) { const foe = g.order.find((u) => u !== me); if (foe && g.sh[foe][i] === ".") this.act("fire", { i }); }
        },
        board(kind, title, fl, sh, o) {
            const wrap = mk("div", "bs-board-wrap"), grid = mk("div", "bs-grid"); wrap.appendChild(mk("h4", "", title)); grid.dataset.b = kind;
            grid.appendChild(mk("span", "bs-lbl")); for (let c = 0; c < 10; c++) grid.appendChild(mk("span", "bs-lbl", "ABCDEFGHIJ"[c]));
            for (let r = 0; r < 10; r++) {
                grid.appendChild(mk("span", "bs-lbl", String(r + 1)));
                for (let c = 0; c < 10; c++) {
                    const i = r * 10 + c, f = fl ? fl[i] : ".", s = sh ? sh[i] : ".", cl = ["bs-c"]; let sk = false;
                    if (f !== "." && fl && sh && s === "h" && BSE.sunk(Array.isArray(fl) ? fl.join("") : fl, sh, +f)) sk = true;
                    if (o.own) { if (f !== ".") cl.push("ship"); } else if (sk) cl.push("ship"); else if (o.reveal && f !== ".") cl.push("ship", "reveal");
                    if (sk) cl.push("sunk"); else if (s === "h") cl.push("hit"); else if (s === "m") cl.push("miss");
                    if (o.ok && s === ".") cl.push("ok"); if (o.pl) cl.push("pl"); if (o.fx && o.fx.i === i) cl.push("shot");
                    const d = mk("div", cl.join(" ")); d.dataset.i = i; if (s !== ".") d.setAttribute("aria-label", `${BSE.COORD(i)} ${sk ? "sunk" : s === "h" ? "hit" : "miss"}`); grid.appendChild(d);
                }
            }
            wrap.appendChild(grid); return wrap;
        },
        view() {
            const g = this.g, me = State.username, order = g.order || [], inGame = order.includes(me), foe = order.find((u) => u !== me), { who, my } = turnInfo(g);
            const done = g.phase === "done", placing = g.phase === "play" && g.sp === "place", dock = this.placing(), fire = g.phase === "play" && g.sp === "fire";
            const fx = g.fx && g.fx.id !== this.lastFx && Date.now() - g.fx.at < 4000 ? g.fx : null, root = $("bs-boards"); root.textContent = "";
            strip({ p: "bs", o: g }, who, (u) => (placing ? (g.rd && g.rd[u] ? "Fleet ready" : "Deploying…") : `${BSE.afloat(g, u)}/5 ships afloat`));
            $("bs-dock").hidden = !dock;
            if (dock) {
                const pl = this.pl, box = $("bs-ships"); box.textContent = "";
                BSE.SH.forEach(([n, len], id) => {
                    const placed = pl.f.includes(String(id)), b = mk("button", "bs-ship-btn" + (pl.sel === id ? " sel" : "") + (placed ? " placed" : "")); b.type = "button"; b.dataset.id = id;
                    const bar = mk("i"); for (let k = 0; k < len; k++) bar.appendChild(mk("b")); b.append(mk("span", "", `${n} (${len})`), bar); box.appendChild(b);
                });
                $("bs-rotate").textContent = "Rotate: " + (pl.hz ? "Horizontal" : "Vertical"); $("bs-ready").disabled = BSE.SH.some((_, id) => !pl.f.includes(String(id)));
                root.appendChild(this.board("me", "Your fleet — deploy", pl.f.join(""), null, { own: true, pl: true }));
            } else if (inGame && foe) {
                const mineF = g.fl && g.fl[me], mineS = g.sh && g.sh[me];
                root.appendChild(this.board("my", "Your fleet", mineF, mineS, { own: true, fx: fx && fx.u !== me ? fx : null }));
                if (fire || done) root.appendChild(this.board("foe", `${foe}'s waters`, g.fl && g.fl[foe], g.sh && g.sh[foe], { ok: fire && my, reveal: done, fx: fx && fx.u === me ? fx : null }));
            }
        },
        controls() {
            const g = this.g, me = State.username, { who, my, live, inGame } = turnInfo(g), placing = g.phase === "play" && g.sp === "place"; let m = "";
            if (g.phase === "done" && g.res) m = resText(g, "fleet destroyed");
            else if (placing) m = inGame ? (g.rd && g.rd[me] ? "Fleet deployed — waiting for your opponent…" : "Deploy your fleet: pick a ship, then click a cell (the ship starts there). Click a placed ship to pick it up.") : "";
            else if (my) m = "Your shot, Admiral — click a cell in the enemy waters."; else if (live) m = `${who} is taking aim…`;
            $("bs-status").textContent = m; $("bs-log").textContent = g.last || ""; this.common(placing ? inGame && !(g.rd && g.rd[me]) : my);
        },
        playFx() {
            const g = this.g, fx = g.fx; if (!fx || fx.id === this.lastFx) return; const late = this.lastFx === null; this.lastFx = fx.id;
            if ((late && Date.now() - fx.at > 4000) || CardFX.reduced() || Router.currentGameKey !== "battleship") return;
            const c = $("bs-callout"); c.textContent = fx.r === "sunk" ? `${fx.n} SUNK!` : fx.r === "hit" ? "HIT!" : "MISS"; c.className = "bs-callout " + fx.r; c.hidden = false;
            window.clearTimeout(this.ct); this.ct = window.setTimeout(() => { c.hidden = true; }, 1500);
            if (fx.r === "miss") Sound.tone(260, 160, "sine", 0.04); else if (fx.r === "hit") Sound.tone(150, 220, "sawtooth", 0.06); else { Sound.tone(110, 420, "sawtooth", 0.07); window.setTimeout(() => Sound.win(), 300); }
            CardFX.until = performance.now() + 900;
        }
    });

    [CH, CC, MM, BC, C4, BS].forEach((G) => G.init());
    { const s0 = Social.start, s1 = Social.stop; Social.start = function () { s0.call(Social);[CH, CC, MM, BC, C4, BS].forEach((G) => G.start()); }; Social.stop = function () { s1.call(Social);[CH, CC, MM, BC, C4, BS].forEach((G) => G.stop()); }; }
    document.addEventListener("game-changed", (e) => { [["chess", CH], ["checkers", CC], ["connect4", C4], ["battleship", BS], ["mastermind", MM], ["bullscows", BC]].forEach(([k, G]) => { if (e.detail.gameKey !== k && G.local) G.start(); }); });
})();
