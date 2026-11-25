/* CASINO CAMPUS — Marble Gravity Race.
   Classic <script> (not an ES module): top-level consts are shared with the other files
   through the page's global scope, so the load order in index.html matters. */
"use strict";

/* =========================================================================
   MARBLE GRAVITY RACE — DETERMINISTIC PHYSICS CORE
   Every client (and the host's headless pre-run) executes this exact fixed-
   timestep simulation from the same {map, seed, racer count}. Only + - * /
   sqrt and floor are used (all bit-exact across engines) — no sin/cos/pow/
   hypot — so the marble that visibly crosses the line first IS the winner.
   ========================================================================= */
const MarbleSim = (() => {
    const W = 480, H = 3400, FIN = 3270, DT = 1 / 120, MAXT = 7200, BR = 12, MAXR = 24, CELL = 64, COLS = 8, ROWS = 54;
    const TAU = 6.283185307179586, PI = 3.141592653589793, q = (x) => x * x;
    const rng = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
    const dsin = (x) => { x -= Math.floor(x / TAU) * TAU; if (x > PI) x -= TAU; const s = x * x; return x * (1 - s / 6 * (1 - s / 20 * (1 - s / 42 * (1 - s / 72 * (1 - s / 110 * (1 - s / 156)))))); };
    const dcos = (x) => dsin(x + PI / 2);
    const FX = { boost: 260, freeze: 150, slow: 360, giant: 480, shrink: 480 };
    const PU = {
        boost: { c: "#ff9f1c", d: "Speed boost for the collector" }, freeze: { c: "#7fd8ff", d: "Freezes the current leader" },
        slow: { c: "#7bd88f", d: "Slows the current leader" }, giant: { c: "#f5d27a", d: "Collector grows heavy and huge" },
        shrink: { c: "#c77dff", d: "Shrinks the current leader" }, catchup: { c: "#ff5d8f", d: "Rockets the last-place marble" }
    };

    const mkBuilder = (seed) => {
        const R = rng(seed), o = { R, pegs: [], bumps: [], segs: [], spins: [], bands: [] };
        o.peg = (x, y, r) => o.pegs.push({ x, y, r }); o.bump = (x, y, r) => o.bumps.push({ x, y, r });
        o.seg = (x1, y1, x2, y2) => o.segs.push({ x1, y1, x2, y2, a: Math.min(y1, y2) - 24, b: Math.max(y1, y2) + 24 });
        o.spin = (cx, cy, len, w, arms) => o.spins.push({ cx, cy, len, w, arms });
        o.band = (a, b) => o.bands.push([a, b]);
        o.grid = (y0, y1, sx, sy, r, jit, rv) => {
            let row = 0;
            for (let y = y0; y < y1; y += sy, row++) {
                if (o.bands.some((b) => y > b[0] - 18 && y < b[1] + 18)) continue;
                for (let x = (row % 2 ? sx : sx / 2); x < W - 10; x += sx) o.peg(x + (R() - 0.5) * (jit || 0), y + (R() - 0.5) * (jit || 0), r + (rv ? R() * rv : 0));
            }
        };
        return o;
    };

    const MAPS = {
        casino: {
            name: "Classic Casino", icon: "🎰", seed: 1101, g: 820, e: 0.55, bg: ["#0b1a12", "#1c0b0e"], peg: "#f5d27a", segc: "#c9a24a", spin: "#e0483e", bump: "#1e9b62", glow: false, deco: "chips",
            desc: "Chip pegs, golden funnels and spinning roulette blades.",
            pool: [["boost", "Hot Streak", "🔥"], ["freeze", "Cold Deck", "🧊"], ["giant", "High Roller", "💰"], ["catchup", "Lucky Seven", "🍀"], ["slow", "House Edge", "🏠"]],
            build(b) {
                [720, 1500, 2280].forEach((y) => b.band(y - 10, y + 70));[1100, 1900, 2700].forEach((y) => b.band(y - 90, y + 90));
                b.grid(240, 3080, 64, 66, 5, 4);
                [720, 1500, 2280].forEach((y) => { b.seg(0, y, 185, y + 56); b.seg(W, y, 295, y + 56); });
                [[1100, 240, 88], [1900, 140, 62], [1900, 340, 62], [2700, 240, 88]].forEach(([y, x, l], k) => b.spin(x, y, l, (k % 2 ? -1 : 1) * 1.7, 2));
                [100, 240, 380].forEach((x) => b.bump(x, 2990, 17));
            }
        },
        cyber: {
            name: "Cyberpunk Neon", icon: "🌆", seed: 2202, g: 900, e: 0.6, bg: ["#07021a", "#001a24"], peg: "#39ffe0", segc: "#ff2fb3", spin: "#39ffe0", bump: "#a259ff", glow: true, deco: "grid",
            desc: "Laser rails zig-zag down a neon megacity with overclocked spinners.",
            pool: [["boost", "Overclock", "⚡"], ["freeze", "Stasis Field", "🧊"], ["slow", "Lag Spike", "📡"], ["shrink", "Nano Shrink", "🔬"], ["catchup", "Patch Update", "💾"]],
            build(b) {
                b.grid(140, 280, 70, 50, 4, 0);
                for (let k = 0, y = 300; y < 3050; y += 190, k++) {
                    if (k % 2 === 0) b.seg(0, y, W - 105, y + 62); else b.seg(W, y, 105, y + 62);
                    if (k % 3 === 1) b.spin(k % 2 ? 52 : 428, y + 132, 36, (k % 2 ? 1 : -1) * 3.2, 2);
                    if (k % 4 === 3) b.bump(k % 8 === 3 ? 60 : W - 60, y + 152, 13);
                }
                b.grid(3080, 3200, 80, 60, 5, 0);
            }
        },
        ruins: {
            name: "Ancient Ruins", icon: "🏛️", seed: 3303, g: 800, e: 0.5, bg: ["#241a0c", "#0f0a05"], peg: "#d9b46a", segc: "#a8875a", spin: "#c96f3b", bump: "#3aa6a0", glow: false, deco: "runes",
            desc: "Heavy stone pillars, crumbling ledges and slow temple blades.",
            pool: [["boost", "Tomb Wind", "🌪️"], ["freeze", "Curse of Stone", "🗿"], ["slow", "Sand Trap", "⏳"], ["giant", "Golden Idol", "🏺"], ["catchup", "Sun Blessing", "☀️"]],
            build(b) {
                [900, 1650, 2400].forEach((y) => b.band(y - 10, y + 60));
                b.grid(230, 3080, 100, 112, 15, 0);
                [900, 1650, 2400].forEach((y) => { b.seg(0, y, 150, y + 46); b.seg(W, y, 330, y + 46); b.spin(240, y + 50, 48, 1.1, 2); });
                [80, 400].forEach((x) => b.bump(x, 3000, 20));
            }
        },
        space: {
            name: "Space Galaxy", icon: "🪐", seed: 4404, g: 640, e: 0.7, bg: ["#050616", "#12062a"], peg: "#bcd0ff", segc: "#7d8cff", spin: "#ffd166", bump: "#ff7a59", glow: true, deco: "stars",
            desc: "Low gravity: asteroid fields, bouncy planets and orbiting satellites.",
            pool: [["boost", "Warp Drive", "🚀"], ["freeze", "Cryo Beam", "🛸"], ["slow", "Gravity Well", "🕳️"], ["shrink", "Shrink Ray", "🔭"], ["giant", "Supernova", "🌟"], ["catchup", "Nebula Assist", "🌌"]],
            build(b) {
                const R = b.R, d2 = (x, y, c) => q(x - c.x) + q(y - c.y);
                b.spin(240, 1000, 58, 1.9, 3); b.spin(140, 1900, 58, -1.9, 3); b.spin(350, 2700, 58, 1.9, 3);
                const freeOf = (x, y, pad) => b.spins.every((s) => q(x - s.cx) + q(y - s.cy) > q(s.len + pad));
                for (let i = 0; i < 9; i++) for (let t = 0; t < 40; t++) {
                    const x = 60 + R() * 360, y = 300 + i * 300 + R() * 120, r = 20 + R() * 10;
                    if (freeOf(x, y, r + 22) && b.bumps.every((p) => d2(x, y, p) > q(p.r + r + 80))) { b.bump(x, y, r); break; }
                }
                for (let t = 0; t < 320 && b.pegs.length < 118; t++) {
                    const x = 20 + R() * 440, y = 220 + R() * 2900, r = 4 + R() * 2;
                    if (freeOf(x, y, 24) && b.pegs.every((p) => d2(x, y, p) > 1936) && b.bumps.every((p) => d2(x, y, p) > q(p.r + 42))) b.peg(x, y, r);
                }
            }
        },
        candy: {
            name: "Candy Land", icon: "🍭", seed: 5505, g: 780, e: 0.78, bg: ["#3a1236", "#1b0a2e"], peg: "#ff8fcf", segc: "#fff1a8", spin: "#5ee6c8", bump: "#ffb347", glow: false, deco: "sprinkles",
            desc: "Bouncy lollipops, candy-cane ramps and peppermint spinners.",
            pool: [["boost", "Sugar Rush", "🍬"], ["slow", "Gum Trap", "🫧"], ["giant", "Gummy Giant", "🧸"], ["shrink", "Sour Shrink", "🍋"], ["freeze", "Popsicle Freeze", "🍦"], ["catchup", "Sweet Comeback", "🍩"]],
            build(b) {
                [800, 1700, 2600].forEach((y) => b.band(y - 10, y + 230));[1250, 2150].forEach((y) => b.band(y - 80, y + 80));
                b.grid(230, 3080, 76, 80, 9, 6, 4);
                [800, 1700, 2600].forEach((y) => { b.seg(0, y, 288, y + 72); b.seg(W, y + 150, 192, y + 222); });
                b.spin(240, 1250, 52, 2.4, 3); b.spin(240, 2150, 52, -2.4, 3);
            }
        }
    };
    const MAP_IDS = Object.keys(MAPS);
    MAP_IDS.forEach((id) => { MAPS[id].icons = {}; MAPS[id].pool.forEach(([k, n, i]) => { MAPS[id].icons[k] = { n, i }; }); });

    const geoCache = {};
    const geo = (id) => {
        if (geoCache[id]) return geoCache[id];
        const b = mkBuilder(MAPS[id].seed); MAPS[id].build(b);
        const circles = [];
        b.pegs.forEach((p) => circles.push({ x: p.x, y: p.y, r: p.r, k: 0, id: circles.length }));
        b.bumps.forEach((p) => circles.push({ x: p.x, y: p.y, r: p.r, k: 1, id: circles.length }));
        const grid = Array.from({ length: COLS * ROWS }, () => []);
        circles.forEach((c) => grid[Math.min(ROWS - 1, Math.max(0, (c.y / CELL) | 0)) * COLS + Math.min(COLS - 1, Math.max(0, (c.x / CELL) | 0))].push(c));
        return (geoCache[id] = { circles, grid, segs: b.segs, spins: b.spins });
    };

    const segD2 = (x, y, s) => { const ex = s.x2 - s.x1, ey = s.y2 - s.y1; let u = ((x - s.x1) * ex + (y - s.y1) * ey) / (ex * ex + ey * ey); u = u < 0 ? 0 : u > 1 ? 1 : u; return q(x - s.x1 - ex * u) + q(y - s.y1 - ey * u); };

    class Sim {
        constructor(cfg) {
            const M = this.M = MAPS[cfg.map], G = this.G = geo(cfg.map), R = this.R = rng(cfg.seed >>> 0), n = this.n = cfg.racers.length;
            this.count = Math.min(cfg.count || 1, n); this.t = 0; this.doneT = -1; this.done = false; this.order = []; this.events = [];
            this.sa = G.spins.map(() => 0); this.tips = G.spins.map((s) => new Array(s.arms * 2).fill(0)); this.hit = new Int32Array(G.circles.length).fill(-99999);
            const slots = []; for (let i = 0; i < n; i++) slots.push(i);
            for (let i = n - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)), t = slots[i]; slots[i] = slots[j]; slots[j] = t; }
            const rows = n <= 14 ? 1 : 2, cols = Math.ceil(n / rows);
            this.marbles = new Array(n);
            slots.forEach((who, k) => {
                const col = Math.floor(k / rows), ri = k % rows;
                this.marbles[who] = { i: who, x: 36 + (W - 72) * ((col + 0.5 * ri + 0.25) / cols) + (R() - 0.5) * 3, y: 44 + ri * 28, vx: (R() - 0.5) * 40, vy: 0, r: BR, fin: -1, ft: 0, bt: 0, st: 0, gt: 0, sh: 0, still: 0 };
            });
            this.pups = [];
            const pool = M.pool, cnt = 16, clear = (x, y) => G.circles.every((c) => q(x - c.x) + q(y - c.y) > q(c.r + 28)) && G.segs.every((s) => segD2(x, y, s) > 900) && G.spins.every((s) => q(x - s.cx) + q(y - s.cy) > q(s.len + 34));
            for (let k = 0; k < cnt; k++) {
                const y0 = 330 + k * (2650 / cnt);
                for (let tr = 0; tr < 30; tr++) { const x = 40 + R() * 400, y = y0 + R() * 120; if (clear(x, y)) { this.pups.push({ x, y, kind: pool[Math.floor(R() * pool.length)][0], got: -1 }); break; } }
            }
        }

        col(m, x1, y1, x2, y2, th, w, ox, oy, e) {
            const ex = x2 - x1, ey = y2 - y1; let u = ((m.x - x1) * ex + (m.y - y1) * ey) / (ex * ex + ey * ey); u = u < 0 ? 0 : u > 1 ? 1 : u;
            const px = x1 + ex * u, py = y1 + ey * u, dx = m.x - px, dy = m.y - py, rr = m.r + th, d2 = dx * dx + dy * dy;
            if (d2 >= rr * rr) return;
            const d = Math.sqrt(d2) || 1e-4, nx = dx / d, ny = dy / d; m.x = px + nx * rr; m.y = py + ny * rr;
            const vn = (m.vx + w * (py - oy)) * nx + (m.vy - w * (px - ox)) * ny;
            if (vn < 0) { m.vx -= (1 + e) * vn * nx; m.vy -= (1 + e) * vn * ny; }
        }

        /** Effect application. Leader/last are evaluated on live positions at this exact step. */
        apply(kind, m) {
            let lead = null, last = null;
            for (const o of this.marbles) { if (o.fin >= 0) continue; if (o !== m && (!lead || o.y > lead.y)) lead = o; if (!last || o.y < last.y) last = o; }
            let tgt = m;
            if (kind === "boost") { m.bt = FX.boost; m.vy += 200; }
            else if (kind === "giant") m.gt = FX.giant;
            else if (kind === "freeze" && lead) { lead.ft = FX.freeze; tgt = lead; }
            else if (kind === "slow" && lead) { lead.st = FX.slow; tgt = lead; }
            else if (kind === "shrink" && lead) { lead.sh = FX.shrink; tgt = lead; }
            else if (kind === "catchup" && last) { last.bt = FX.boost; last.vy += 240; tgt = last; }
            this.events.push({ k: "pu", t: this.t, kind, who: m.i, tgt: tgt.i });
        }

        step() {
            const t = ++this.t, M = this.M, G = this.G, e = M.e, ms = this.marbles, n = this.n, crossers = [];
            for (let s = 0; s < G.spins.length; s++) {
                const sp = G.spins[s], a = (this.sa[s] += sp.w * DT);
                for (let k = 0; k < sp.arms; k++) { const an = a + k * TAU / sp.arms; this.tips[s][k * 2] = sp.cx + sp.len * dcos(an); this.tips[s][k * 2 + 1] = sp.cy + sp.len * dsin(an); }
            }
            for (let i = 0; i < n; i++) {
                const m = ms[i], tr = BR * (m.gt > 0 ? 1.55 : 1) * (m.sh > 0 ? 0.62 : 1);
                m.r += (tr - m.r) * 0.12;
                if (m.ft > 0) { m.ft--; m.vx = 0; m.vy = 0; continue; }
                if (m.bt > 0) m.bt--; if (m.st > 0) m.st--; if (m.gt > 0) m.gt--; if (m.sh > 0) m.sh--;
                m.vy += (M.g * (m.bt > 0 ? 1.6 : 1) * (m.st > 0 ? 0.45 : 1) + (m.bt > 0 ? 260 : 0)) * DT;
                if (m.st > 0) { m.vx *= 0.992; m.vy *= 0.992; }
                if (m.vy > 820) m.vy = 820; if (m.vx > 620) m.vx = 620; else if (m.vx < -620) m.vx = -620;
                const py = m.y; m.x += m.vx * DT; m.y += m.vy * DT;
                if (m.fin < 0 && m.y >= FIN) { const f = (FIN - py) / (m.y - py); m.fin = t - 1 + (f < 0 ? 0 : f > 1 ? 1 : f); crossers.push(m); }
                if (m.x < m.r) { m.x = m.r; m.vx = -m.vx * e; } else if (m.x > W - m.r) { m.x = W - m.r; m.vx = -m.vx * e; }
                if (m.y > H - m.r) { m.y = H - m.r; m.vy = -m.vy * 0.3; m.vx *= 0.97; }
                const cx = Math.min(COLS - 1, Math.max(0, (m.x / CELL) | 0)), cy = Math.min(ROWS - 1, Math.max(0, (m.y / CELL) | 0));
                for (let gy = cy - 1; gy <= cy + 1; gy++) {
                    if (gy < 0 || gy >= ROWS) continue;
                    for (let gx = cx - 1; gx <= cx + 1; gx++) {
                        if (gx < 0 || gx >= COLS) continue;
                        const cell = G.grid[gy * COLS + gx];
                        for (let k = 0; k < cell.length; k++) {
                            const c = cell[k], dx = m.x - c.x, dy = m.y - c.y, rr = m.r + c.r, d2 = dx * dx + dy * dy;
                            if (d2 >= rr * rr) continue;
                            const d = Math.sqrt(d2) || 1e-4, nx = dx / d, ny = dy / d; m.x = c.x + nx * rr; m.y = c.y + ny * rr;
                            const vn = m.vx * nx + m.vy * ny;
                            if (vn < 0) { const b = c.k ? 1.95 : 1 + e; m.vx -= b * vn * nx; m.vy -= b * vn * ny; if (c.k) { m.vx += nx * 70; m.vy += ny * 70; } this.hit[c.id] = t; }
                        }
                    }
                }
                for (let s = 0; s < G.segs.length; s++) { const g = G.segs[s]; if (m.y < g.a || m.y > g.b) continue; this.col(m, g.x1, g.y1, g.x2, g.y2, 4, 0, 0, 0, e); }
                for (let s = 0; s < G.spins.length; s++) {
                    const sp = G.spins[s]; if (Math.abs(m.y - sp.cy) > sp.len + m.r + 8) continue;
                    for (let k = 0; k < sp.arms; k++) this.col(m, sp.cx, sp.cy, this.tips[s][k * 2], this.tips[s][k * 2 + 1], 4, sp.w, sp.cx, sp.cy, e);
                }
                if (m.vx * m.vx + m.vy * m.vy < 36) { if (++m.still > 80) { m.vx += (this.R() - 0.5) * 300; m.vy -= 60; m.still = 0; } } else m.still = 0;
            }
            for (let i = 0; i < n; i++) {
                const a = ms[i];
                for (let j = i + 1; j < n; j++) {
                    const b = ms[j], dy = b.y - a.y, rr = a.r + b.r; if (dy > rr || dy < -rr) continue;
                    const dx = b.x - a.x; if (dx > rr || dx < -rr) continue;
                    const d2 = dx * dx + dy * dy; if (d2 >= rr * rr) continue;
                    const d = Math.sqrt(d2) || 1e-4, nx = dx / d, ny = dy / d, ov = rr - d;
                    const ma = a.r * a.r * (a.ft > 0 ? 1e4 : 1), mb = b.r * b.r * (b.ft > 0 ? 1e4 : 1), ia = 1 / ma, ib = 1 / mb, is = ia + ib;
                    a.x -= nx * ov * ia / is; a.y -= ny * ov * ia / is; b.x += nx * ov * ib / is; b.y += ny * ov * ib / is;
                    const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
                    if (rv < 0) { const imp = -1.55 * rv / is; a.vx -= imp * nx * ia; a.vy -= imp * ny * ia; b.vx += imp * nx * ib; b.vy += imp * ny * ib; }
                }
            }
            for (let p = 0; p < this.pups.length; p++) {
                const u = this.pups[p]; if (u.got >= 0) continue;
                for (let i = 0; i < n; i++) { const m = ms[i]; if (m.fin >= 0 || m.y < u.y - 40 || m.y > u.y + 40) continue; if (q(m.x - u.x) + q(m.y - u.y) < q(m.r + 12)) { u.got = t; this.apply(u.kind, m); break; } }
            }
            if (crossers.length) {
                crossers.sort((a, b) => a.fin - b.fin || a.i - b.i);
                crossers.forEach((m) => { this.events.push({ k: "fin", t, i: m.i, rank: this.order.length }); this.order.push(m.i); });
            }
            if (!this.done && (this.order.length >= this.count || t >= MAXT)) {
                if (this.order.length < this.count) {
                    ms.filter((m) => m.fin < 0).sort((a, b) => b.y - a.y || a.i - b.i).forEach((m) => { if (this.order.length < this.count) this.order.push(m.i); });
                }
                this.done = true; this.doneT = t;
            }
        }
        static run(cfg) { const s = new Sim(cfg); while (!s.done) s.step(); return s.order.slice(); }
    }
    return { Sim, MAPS, MAP_IDS, PU, geo, W, H, FIN, DT, BR, MAXR };
})();

/* =========================================================================
   MARBLE GRAVITY RACE — LIVE RENDERER, FIREBASE SYNC, MAP PICKER, HOST FATE
   Host publishes {map, seed, racers, startAt} to rooms/{code}/marble/current.
   Every device replays the identical deterministic simulation against the
   shared server clock, so all screens show the same race, frame for frame.
   ========================================================================= */
const MarbleRace = (() => {
    const { Sim, MAPS, MAP_IDS, PU, geo, W, H, FIN, DT, BR, MAXR } = MarbleSim;
    const st = { off: 0, ref: null, offRef: null, cb: null, timer: null, lastId: null, pending: null, mapSel: "random", rigOn: false, rigTarget: "", imgs: new Map(), deco: {} };
    const now = () => Date.now() + st.off;
    const $ = (id) => document.getElementById(id);
    /** "Duvan Steven" -> "Duvan": keep only the first word, hard-cap very long single words. */
    const label = (name) => { const f = String(name || "").trim().split(/\s+/)[0] || "?"; return f.length > 10 ? f.slice(0, 9) + "\u2026" : f; };
    const hue = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = (Math.imul(h, 33) + s.charCodeAt(i)) | 0; return (h >>> 0) % 360; };
    const isUrl = (s) => /^(https?:|data:image)/.test(s || "");
    const img = (src) => { let i = st.imgs.get(src); if (!i) { i = new Image(); i.src = src; st.imgs.set(src, i); } return i; };
    const EMOJI = '"Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';

    const decoFor = (id) => {
        if (st.deco[id]) return st.deco[id];
        let a = MAPS[id].seed * 7 + 1; const r = () => { a = (a * 16807) % 2147483647; return a / 2147483647; };
        return (st.deco[id] = Array.from({ length: 170 }, () => ({ x: r() * W, y: r() * H, s: 0.5 + r(), k: Math.floor(r() * 6), p: r() * 6.28 })));
    };

    const drawDeco = (ctx, M, cam, vh, tm) => {
        const d = decoFor(M.id);
        ctx.save();
        if (M.deco === "grid") {
            ctx.strokeStyle = "rgba(57,255,224,.07)"; ctx.lineWidth = 1; ctx.beginPath();
            for (let x = 0; x <= W; x += 60) { ctx.moveTo(x, cam); ctx.lineTo(x, cam + vh); }
            for (let y = Math.floor(cam / 60) * 60; y < cam + vh; y += 60) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
            ctx.stroke();
        }
        d.forEach((o) => {
            if (o.y < cam - 30 || o.y > cam + vh + 30) return;
            if (M.deco === "chips") { ctx.strokeStyle = o.k % 2 ? "rgba(224,72,62,.10)" : "rgba(245,210,122,.09)"; ctx.lineWidth = 3; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.arc(o.x, o.y, 8 + o.s * 12, 0, 6.283); ctx.stroke(); ctx.setLineDash([]); }
            else if (M.deco === "stars") { ctx.fillStyle = `rgba(255,255,255,${0.25 + 0.35 * Math.abs(Math.sin(tm / 700 + o.p))})`; ctx.beginPath(); ctx.arc(o.x, o.y, o.s * 1.4, 0, 6.283); ctx.fill(); }
            else if (M.deco === "runes") { ctx.fillStyle = "rgba(217,180,106,.10)"; ctx.font = `${16 + o.s * 14}px serif`; ctx.fillText("☥☽△◇✦⚱"[o.k], o.x, o.y); }
            else if (M.deco === "sprinkles") { ctx.save(); ctx.translate(o.x, o.y); ctx.rotate(o.p); ctx.fillStyle = ["#ff8fcf", "#fff1a8", "#5ee6c8", "#ffb347", "#a5b4ff", "#ff6b6b"][o.k]; ctx.globalAlpha = 0.16; ctx.fillRect(-7 * o.s, -2, 14 * o.s, 4); ctx.restore(); }
            else if (M.deco === "grid") { ctx.fillStyle = o.k % 2 ? "rgba(255,47,179,.07)" : "rgba(57,255,224,.06)"; ctx.fillRect(o.x, o.y, 4 + o.s * 10, 22 + o.s * 30); }
        });
        ctx.restore();
    };

    const drawMarble = (ctx, m, R, hu, name, icon, rot, sc, crown) => {
        const r = m.r, x = m.x, y = m.y;
        ctx.save();
        if (m.bt > 0 || m.gt > 0 || m.st > 0 || m.sh > 0 || m.ft > 0) { ctx.shadowBlur = 16; ctx.shadowColor = m.ft > 0 ? "#7fd8ff" : m.bt > 0 ? "#ff9f1c" : m.gt > 0 ? "#f5d27a" : m.st > 0 ? "#7bd88f" : "#c77dff"; }
        const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.15, x, y, r);
        g.addColorStop(0, `hsl(${hu},80%,72%)`); g.addColorStop(1, `hsl(${hu},70%,32%)`);
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.fill(); ctx.shadowBlur = 0;
        ctx.strokeStyle = "rgba(255,255,255,.55)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, r - 1.5, rot, rot + 1.2); ctx.stroke();
        ctx.strokeStyle = "#e8c97a"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.stroke();
        ctx.fillStyle = "rgba(255,255,255,.22)"; ctx.beginPath(); ctx.arc(x, y, r * 0.66, 0, 6.283); ctx.fill();
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        if (isUrl(icon) && img(icon).complete && img(icon).naturalWidth) { ctx.save(); ctx.beginPath(); ctx.arc(x, y, r * 0.66, 0, 6.283); ctx.clip(); ctx.drawImage(img(icon), x - r * 0.66, y - r * 0.66, r * 1.32, r * 1.32); ctx.restore(); }
        else if (icon && !isUrl(icon)) { ctx.font = `${r * 1.05}px ${EMOJI}`; ctx.fillText(icon, x, y + r * 0.06); }
        else { ctx.fillStyle = "#fff"; ctx.font = `700 ${r * 0.85}px sans-serif`; ctx.fillText(name.slice(0, 2).toUpperCase(), x, y + 1); }
        if (m.ft > 0) { ctx.fillStyle = "rgba(160,225,255,.5)"; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.fill(); ctx.font = `${r}px ${EMOJI}`; ctx.fillText("❄️", x, y); }
        const fs = 11 / sc; ctx.font = `700 ${fs}px "Segoe UI",Arial,sans-serif`;
        const tw = ctx.measureText(name).width + 8 / sc, ly = y - r - 9 / sc;
        ctx.fillStyle = "rgba(8,8,10,.72)"; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x - tw / 2, ly - fs * 0.7, tw, fs * 1.4, fs * 0.7) : ctx.rect(x - tw / 2, ly - fs * 0.7, tw, fs * 1.4); ctx.fill();
        ctx.fillStyle = crown ? "#ffe08a" : "#f3e3b0"; ctx.fillText(name, x, ly + 0.5);
        if (crown) { ctx.font = `${13 / sc}px ${EMOJI}`; ctx.fillText("👑", x, ly - fs * 1.15); }
        ctx.restore();
    };

    /* ------------------------------ the race ------------------------------ */
    const race = async (cfg, id) => {
        const Lk = LuckyDraw, M = MAPS[cfg.map]; M.id = cfg.map;
        const G = geo(cfg.map), sim = new Sim(cfg), { ctx, w, h } = Lk.makeCanvas(560), sc = w / W, vh = h / sc;
        const names = cfg.racers.map((r) => label(r.n)), hues = cfg.racers.map((r) => hue(r.n)), rot = new Float32Array(sim.n), parts = [];
        const MEDAL = ["🥇", "🥈", "🥉", "🏅", "🏅", "🏅"];
        let cam = 0, evp = 0, banner = null, ticker = null, lastT = 0;
        const burst = (x, y, n, c, sp) => { for (let i = 0; i < n; i++) { const a = Math.random() * 6.283, v = (sp || 120) * (0.3 + Math.random()); parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 40, l: 1, c }); } };
        await Lk.frames(id, (dt, el) => {
            const tgt = Math.floor((now() - cfg.startAt) / (DT * 1000)); let steps = 0;
            while (sim.t < tgt && steps < 600 && !(sim.done && sim.t - sim.doneT > 300)) { sim.step(); steps++; }
            while (evp < sim.events.length) {
                const ev = sim.events[evp++];
                if (ev.k === "fin") {
                    if (ev.rank < sim.count) { Lk.announce(cfg.racers[ev.i].n, ev.rank); banner = { txt: `${MEDAL[ev.rank]} ${names[ev.i]}`, t: el }; }
                    burst(sim.marbles[ev.i].x, FIN, 26, "#f5d27a", 220);
                } else {
                    const info = M.icons[ev.kind], mk = sim.marbles[ev.tgt];
                    ticker = { txt: `${info.i} ${info.n}! ${names[ev.who]}${ev.tgt !== ev.who ? " → " + names[ev.tgt] : ""}`, t: el, c: PU[ev.kind].c };
                    burst(mk.x, mk.y, 14, PU[ev.kind].c, 150);
                }
            }
            let ly = 0; sim.marbles.forEach((m, i) => { if (m.y > ly) ly = m.y; rot[i] += m.vx * 0.016 / m.r; });
            const want = tgt < 0 ? 0 : Math.max(0, Math.min(H - vh, ly - vh * 0.42));
            cam += (want - cam) * (steps > 30 ? 1 : 0.14);
            const tm = performance.now();
            ctx.clearRect(0, 0, w, h); ctx.save(); ctx.scale(sc, sc); ctx.translate(0, -cam);
            const bg = ctx.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, M.bg[0]); bg.addColorStop(1, M.bg[1]);
            ctx.fillStyle = bg; ctx.fillRect(0, cam - 1, W, vh + 2);
            drawDeco(ctx, M, cam, vh, tm);
            ctx.strokeStyle = "rgba(232,201,122,.55)"; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(1, cam); ctx.lineTo(1, cam + vh); ctx.moveTo(W - 1, cam); ctx.lineTo(W - 1, cam + vh); ctx.stroke();
            ctx.font = '700 13px "Segoe UI",sans-serif'; ctx.textAlign = "center"; ctx.fillStyle = "rgba(232,201,122,.35)"; ctx.fillText(`${M.icon}  ${M.name.toUpperCase()}  ${M.icon}`, W / 2, 20);
            if (cam + vh > FIN - 10) { for (let i = 0; i < 24; i++) for (let j = 0; j < 2; j++) { ctx.fillStyle = (i + j) % 2 ? "#f5f0e0" : "#111"; ctx.fillRect(i * 20, FIN + j * 10, 20, 10); } ctx.fillStyle = "#f5d27a"; ctx.font = '700 20px "Palatino Linotype",Georgia,serif'; ctx.fillText("FINISH", W / 2, FIN + 44); }
            ctx.lineCap = "round"; if (M.glow) { ctx.shadowColor = M.segc; ctx.shadowBlur = 9; }
            ctx.strokeStyle = M.segc; ctx.lineWidth = 8; G.segs.forEach((s) => { if (s.b < cam || s.a > cam + vh) return; ctx.beginPath(); ctx.moveTo(s.x1, s.y1); ctx.lineTo(s.x2, s.y2); ctx.stroke(); });
            ctx.shadowColor = M.spin; ctx.strokeStyle = M.spin; ctx.lineWidth = 9;
            G.spins.forEach((sp, s) => { if (sp.cy + sp.len < cam || sp.cy - sp.len > cam + vh) return; ctx.beginPath(); for (let k = 0; k < sp.arms; k++) { ctx.moveTo(sp.cx, sp.cy); ctx.lineTo(sim.tips[s][k * 2] || sp.cx, sim.tips[s][k * 2 + 1] || sp.cy); } ctx.stroke(); ctx.fillStyle = "#e8c97a"; ctx.beginPath(); ctx.arc(sp.cx, sp.cy, 8, 0, 6.283); ctx.fill(); });
            ctx.shadowBlur = 0;
            G.circles.forEach((c) => {
                if (c.y < cam - 40 || c.y > cam + vh + 40) return;
                const flash = sim.t - sim.hit[c.id] < 14;
                if (sim.hit[c.id] > lastT) burst(c.x, c.y, c.k ? 6 : 2, c.k ? M.bump : "#fff", 90);
                if (c.k) { const g = ctx.createRadialGradient(c.x - c.r * 0.3, c.y - c.r * 0.3, 2, c.x, c.y, c.r); g.addColorStop(0, "#fff"); g.addColorStop(0.25, M.bump); g.addColorStop(1, "rgba(0,0,0,.6)"); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(c.x, c.y, c.r + (flash ? 3 : 0), 0, 6.283); ctx.fill(); ctx.strokeStyle = "#e8c97a"; ctx.lineWidth = 2; ctx.stroke(); }
                else { ctx.fillStyle = flash ? "#fff" : M.peg; ctx.beginPath(); ctx.arc(c.x, c.y, c.r + (flash ? 1.5 : 0), 0, 6.283); ctx.fill(); ctx.strokeStyle = "rgba(0,0,0,.4)"; ctx.lineWidth = 1; ctx.stroke(); }
            });
            lastT = sim.t;
            sim.pups.forEach((u) => {
                if (u.got >= 0 || u.y < cam - 30 || u.y > cam + vh + 30) return;
                const bob = Math.sin(tm / 300 + u.x) * 2.5, pc = PU[u.kind].c;
                ctx.fillStyle = pc + "44"; ctx.strokeStyle = pc; ctx.lineWidth = 2; ctx.shadowColor = pc; ctx.shadowBlur = 12; ctx.beginPath(); ctx.arc(u.x, u.y + bob, 13, 0, 6.283); ctx.fill(); ctx.stroke(); ctx.shadowBlur = 0;
                ctx.font = `15px ${EMOJI}`; ctx.fillStyle = "#fff"; ctx.textBaseline = "middle"; ctx.fillText(M.icons[u.kind].i, u.x, u.y + bob + 1);
            });
            const rank = sim.marbles.slice().sort((a, b) => (a.fin >= 0 ? a.fin : 1e6 - a.y) - (b.fin >= 0 ? b.fin : 1e6 - b.y));
            sim.marbles.slice().sort((a, b) => a.y - b.y).forEach((m) => drawMarble(ctx, m, m.r, hues[m.i], names[m.i], cfg.racers[m.i].a || "", rot[m.i], sc, tgt >= 0 && rank[0] === m && m.fin < 0));
            for (let i = parts.length - 1; i >= 0; i--) { const p = parts[i]; p.l -= dt / 700; if (p.l <= 0) { parts.splice(i, 1); continue; } p.vy += 380 * dt / 1000; p.x += p.vx * dt / 1000; p.y += p.vy * dt / 1000; ctx.globalAlpha = p.l; ctx.fillStyle = p.c; ctx.fillRect(p.x - 2, p.y - 2, 4, 4); }
            ctx.globalAlpha = 1; ctx.restore();
            /* HUD (screen space) */
            ctx.textBaseline = "middle"; ctx.textAlign = "left"; ctx.font = '700 11px "Segoe UI",sans-serif';
            rank.slice(0, 3).forEach((m, k) => { ctx.fillStyle = "rgba(8,8,10,.62)"; ctx.fillRect(6, 6 + k * 18, 96, 16); ctx.fillStyle = "#e8c97a"; ctx.fillText(`${MEDAL[k]} ${names[m.i]}`, 10, 14 + k * 18, 88); });
            ctx.fillStyle = "rgba(232,201,122,.25)"; ctx.fillRect(w - 9, 12, 4, h - 24);
            sim.marbles.forEach((m) => { ctx.fillStyle = `hsl(${hues[m.i]},80%,60%)`; ctx.beginPath(); ctx.arc(w - 7, 12 + (h - 24) * Math.min(1, m.y / FIN), 3, 0, 6.283); ctx.fill(); });
            ctx.textAlign = "center";
            if (ticker && el - ticker.t < 2600) { ctx.globalAlpha = Math.min(1, (2600 - (el - ticker.t)) / 600); ctx.fillStyle = "rgba(8,8,10,.75)"; ctx.fillRect(w / 2 - 110, h - 40, 220, 24); ctx.fillStyle = ticker.c; ctx.font = '700 12px "Segoe UI",sans-serif'; ctx.fillText(ticker.txt, w / 2, h - 27, 210); ctx.globalAlpha = 1; }
            if (banner && el - banner.t < 2600) { ctx.globalAlpha = Math.min(1, (2600 - (el - banner.t)) / 500); ctx.font = '700 26px "Palatino Linotype",Georgia,serif'; ctx.fillStyle = "rgba(8,8,10,.7)"; ctx.fillRect(0, h / 2 - 28, w, 56); ctx.fillStyle = "#f5d27a"; ctx.fillText(banner.txt, w / 2, h / 2, w - 20); ctx.globalAlpha = 1; }
            if (tgt < 0 || tgt < 90) { const s = Math.ceil(-tgt * DT); ctx.fillStyle = "rgba(0,0,0,.35)"; ctx.fillRect(0, 0, w, h); ctx.fillStyle = "#f5d27a"; ctx.font = '700 84px "Palatino Linotype",Georgia,serif'; ctx.fillText(tgt < 0 ? (s > 3 ? "READY" : String(s)) : "GO!", w / 2, h / 2, w - 20); if (tgt < 0 && s > 3) { ctx.font = '600 14px "Segoe UI",sans-serif'; ctx.fillText(`${M.icon} ${M.name}`, w / 2, h / 2 + 52); } }
            return (sim.done && sim.t - sim.doneT > 300) || el > 140000;
        });
        return cfg.w && cfg.w.length ? cfg.w : sim.order.slice(0, sim.count).map((i) => cfg.racers[i].n);
    };

    const play = async (cfg) => {
        const Lk = LuckyDraw; Lk.runId += 1; const id = Lk.runId;
        Lk.running = true; Lk.mode = "marble"; Lk.syncButtons(); Lk.setBusy(true); api.syncPanel();
        Lk.el.podium.replaceChildren(); Lk.el.result.textContent = "";
        try {
            const winners = await race(cfg, id);
            Lk.logDraw(winners); Lk.settleDraw(winners, cfg.racers.map((x) => x.n), cfg.id, State.isHost ? (Number(cfg.prize) || 0) : 0); Lk.el.result.textContent = `\u{1F389} ${winners.length === 1 ? "Winner" : "Winners"}: ${winners.join(", ")}`; Sound.jackpot();
        } catch (err) { if (err !== Lk.CANCEL) { console.error(err); Notify.error("The marble race was interrupted."); } }
        finally { if (id === Lk.runId) { Lk.running = false; Lk.setBusy(false); Lk.updateInfo(); } }
    };

    /** Rig = honest seed selection: physics stays untouched, we just pick a start seed that produces the wanted winner. */
    const findSeed = async (cfg, target) => {
        let best = cfg.seed, bestPos = 1e9, yieldAt = performance.now() + 30;
        for (let k = 0; k < 400; k++) {
            const seed = (cfg.seed + Math.imul(k, 2654435761)) >>> 0, pos = Sim.run({ ...cfg, seed }).indexOf(target);
            if (pos === 0) return seed;
            if (pos > 0 && pos < bestPos) { bestPos = pos; best = seed; }
            if (performance.now() > yieldAt) { await new Promise((r) => setTimeout(r)); yieldAt = performance.now() + 30; }
        }
        return best;
    };

    const api = {
        async hostStart() {
            const Lk = LuckyDraw;
            if (!State.isHost) { Notify.warning("Only the host can launch the marble race \u2014 it will play live on your screen."); return; }
            if (!Room.db || !Room.code) { Notify.error("Not connected to a room."); return; }
            const names = Lk.names();
            if (names.length < 2) { Notify.warning("The marble race needs at least 2 players in the room."); return; }
            Lk.running = true; Lk.setBusy(true); Lk.el.result.textContent = "\u{1F52E} Preparing the track\u2026";
            try {
                const map = st.mapSel === "random" ? MAP_IDS[Math.floor(Math.random() * MAP_IDS.length)] : st.mapSel;
                const target = (Rig.on && names.includes(Rig.target)) ? Rig.target : null;
                let pool = Lk.shuffle(names);
                if (pool.length > MAXR) { pool = pool.slice(0, MAXR); if (target && !pool.includes(target)) pool[0] = target; pool = Lk.shuffle(pool); }
                const racers = pool.map((n) => ({ n, a: Cosmetics.icon(n, "avatar") || "" }));
                const cfg = { id: Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36), map, count: Math.min(Lk.count, racers.length), racers, seed: Math.floor(Math.random() * 4294967296) >>> 0 };
                cfg.prize = GameResolver.readPrize("draw-prize", !!target);
                if (target) cfg.seed = await findSeed(cfg, pool.indexOf(target));
                cfg.w = Sim.run(cfg).slice(0, cfg.count).map((i) => racers[i].n);
                cfg.startAt = now() + 5500;
                Lk.running = false; Lk.setBusy(false); Lk.el.result.textContent = "";
                await Room.db.ref(`rooms/${Room.code}/marble/current`).set(cfg);
            } catch (err) { console.error(err); Lk.running = false; Lk.setBusy(false); Lk.el.result.textContent = ""; Notify.error("Could not start the marble race."); }
        },

        onCfg(cfg) {
            if (!cfg || !cfg.id || !cfg.racers || cfg.id === st.lastId) return;
            st.lastId = cfg.id;
            if (now() - cfg.startAt > 100000) return;
            st.pending = cfg; this.adopt(true);
        },
        adopt(toast) {
            const c = st.pending; if (!c) return;
            if (now() > c.startAt + 95000) { st.pending = null; return; }
            if (Router.currentGameKey === "draw") { st.pending = null; play(c); }
            else if (toast) Notify.success("\u{1F52E} Marble race starting! Open Random Selection Tools \u2192 Marble Gravity Race to watch live.");
        },
        start() {
            if (!Room.db || !Room.code) return;
            this.stop(); st.lastId = null;
            st.offRef = Room.db.ref(".info/serverTimeOffset"); st.offRef.on("value", (s) => { st.off = s.val() || 0; });
            st.ref = Room.db.ref(`rooms/${Room.code}/marble/current`); st.cb = (s) => this.onCfg(s.val()); st.ref.on("value", st.cb);
            st.timer = setInterval(() => this.adopt(false), 1000);
        },
        stop() {
            if (st.ref && st.cb) st.ref.off("value", st.cb); if (st.offRef) st.offRef.off();
            if (st.timer) clearInterval(st.timer); st.ref = st.cb = st.offRef = st.timer = null; st.pending = null;
        },

        /* ------------------------------ selection UI ------------------------------ */
        renderDesc() {
            const el = $("marble-map-desc"); el.replaceChildren();
            const M = st.mapSel === "random" ? null : MAPS[st.mapSel];
            const p = document.createElement("p"); p.textContent = M ? `${M.icon} ${M.desc}` : "\u{1F3B2} A surprise track is chosen when the race starts."; el.append(p);
            if (M) { const row = document.createElement("div"); row.className = "marble-chips"; M.pool.forEach(([k, n, i]) => { const c = document.createElement("span"); c.className = "marble-chip"; c.style.borderColor = PU[k].c; c.textContent = `${i} ${n}`; c.title = PU[k].d; row.append(c); }); el.append(row); }
        },
        syncPanel() {
            $("marble-panel").hidden = LuckyDraw.mode !== "marble";
        },
        init() {
            const sel = $("marble-map");
            [["random", "\u{1F3B2} Random Map"], ...MAP_IDS.map((k) => [k, `${MAPS[k].icon} ${MAPS[k].name}`])].forEach(([v, t]) => { const o = document.createElement("option"); o.value = v; o.textContent = t; sel.append(o); });
            sel.addEventListener("change", () => { st.mapSel = sel.value; this.renderDesc(); });
            this.renderDesc(); this.syncPanel();
        }
    };
    return api;
})();

/* --- wire the marble race into Lucky Draw / navigation / room lifecycle --- */
MarbleRace.init();

Object.assign(LuckyDraw.IDLE, { marble: ["\u{1F52E}", "Every player drops as a marble through a themed gravity maze. First across the line wins."] });

{
    const r0 = LuckyDraw.reset;
    LuckyDraw.reset = function () { r0.call(this); MarbleRace.syncPanel(); };
}

{ const s0 = Social.start, s1 = Social.stop; Social.start = function () { s0.call(Social); MarbleRace.start(); MarbleRace.syncPanel(); }; Social.stop = function () { s1.call(Social); MarbleRace.stop(); }; }
