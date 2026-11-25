/* CASINO CAMPUS — Craps, Crash and Money Wheel.
   Classic <script> (not an ES module): top-level consts are shared with the other files
   through the page's global scope, so the load order in index.html matters. */
"use strict";

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
