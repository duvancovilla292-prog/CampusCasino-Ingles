/* CASINO CAMPUS — Lucky Draw.
   Classic <script> (not an ES module): top-level consts are shared with the other files
   through the page's global scope, so the load order in index.html matters. */
"use strict";

/* =========================================================================
   16b. LUCKY DRAW (pick 1-6 winners from the room's live player list)
   Four visual modes. Winners are chosen up-front with an unbiased shuffle
   and the animation is then steered to them. A draw only reads Room.list();
   the only write is the Host's optional Audit entry from logDraw().
   ========================================================================= */
const LuckyDraw = {
    count: 3,
    mode: "slots",
    running: false,
    runId: 0,
    el: {},
    CANCEL: Symbol("cancel"),
    CHIP_COLORS: ["#c0392b", "#1f2933", "#1e7a4c", "#b8860b", "#2b5c9e"],
    IDLE: {
        slots: ["\u{1F3B0}", "Vertical reels spin and brake one by one."],
        bingo: ["\u{1F3B1}", "Spheres tumble in the blower and the tube picks the winners."],
        cards: ["\u{1F0CF}", "The deck is shuffled, then winning cards are dealt and flipped."],
        laser: ["\u{1F52E}", "Chips swirl while a laser pulses to lock in each winner."],
        bracket: ["\u{1F3C6}", "Players are seeded into a 1v1 knockout bracket. Match by match, a champion is crowned."],
        plinko: ["\u{1F535}", "Balls bounce down through the pegs and land in the winners' slots."],
        chests: ["\u{1F381}", "Every player gets a mystery chest. The chests open one by one to reveal the winners."],
        roles: ["\u{1F9E9}", "The selected players are matched to roles and tasks in a matrix."]
    },

    init() {
        const $ = (id) => document.getElementById(id);
        this.el = {
            stage: $("draw-stage"), podium: $("draw-podium"), result: $("draw-result"),
            start: $("btn-draw-start"), reset: $("btn-draw-reset"), info: $("draw-player-count")
        };
        this.countBtns = Array.from(document.querySelectorAll(".draw-count-btn"));
        this.modeBtns = Array.from(document.querySelectorAll(".draw-mode-btn"));

        this.countBtns.forEach((btn) => btn.addEventListener("click", () => {
            if (this.running) return;
            this.count = Number(btn.dataset.count);
            this.syncButtons();
        }));
        this.modeBtns.forEach((btn) => btn.addEventListener("click", () => {
            if (this.running) return;
            this.mode = btn.dataset.drawMode;
            this.syncButtons();
            this.reset();
        }));
        this.el.start.addEventListener("click", () => this.start());
        this.el.reset.addEventListener("click", () => this.reset());
        PubSub.on("players-updated", () => { if (!this.running) this.updateInfo(); });

        this.syncButtons();
        this.reset();
    },

    /* ----------------------------- helpers ----------------------------- */
    names() { return Room.list().map((p) => p.username).filter(Boolean); },

    shuffle(list) {
        const out = list.slice();
        if (Rig.on && out.includes(Rig.target)) { const r = out.filter((x) => x !== Rig.target); return [Rig.target, ...this.shuffle.call({ shuffle: null }, r)]; }
        for (let i = out.length - 1; i > 0; i -= 1) {
            const j = Math.floor(Math.random() * (i + 1));
            [out[i], out[j]] = [out[j], out[i]];
        }
        return out;
    },

    mk(tag, cls, text) {
        const node = document.createElement(tag);
        if (cls) node.className = cls;
        if (text != null) node.textContent = text;
        return node;
    },

    short(name, max = 11) { return name.length > max ? name.slice(0, max - 1) + "\u2026" : name; },

    async wait(ms, id) {
        await new Promise((resolve) => window.setTimeout(resolve, ms));
        if (id !== this.runId) throw this.CANCEL;
    },

    /** rAF loop; fn(dt, elapsed) returns true when finished. Rejects if cancelled. */
    frames(id, fn) {
        return new Promise((resolve, reject) => {
            const t0 = performance.now();
            let last = t0;
            const tick = (now) => {
                if (id !== this.runId) { reject(this.CANCEL); return; }
                const dt = Math.min(now - last, 50);
                last = now;
                if (fn(dt, now - t0)) { resolve(); return; }
                window.requestAnimationFrame(tick);
            };
            window.requestAnimationFrame(tick);
        });
    },

    makeCanvas(h) {
        const w = Math.max(260, Math.min(this.el.stage.clientWidth - 32, 480));
        const dpr = window.devicePixelRatio || 1;
        const canvas = document.createElement("canvas");
        canvas.className = "draw-canvas";
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        canvas.style.width = w + "px";
        canvas.style.height = h + "px";
        const ctx = canvas.getContext("2d");
        ctx.scale(dpr, dpr);
        this.el.stage.replaceChildren(canvas);
        return { ctx, w, h };
    },

    drawChip(ctx, x, y, r, name, color, glow) {
        ctx.save();
        if (glow) { ctx.shadowColor = "#f4c430"; ctx.shadowBlur = 20; }
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
        ctx.shadowBlur = 0;
        const lw = Math.max(3, r * 0.22);
        ctx.lineWidth = lw; ctx.strokeStyle = "rgba(255,255,255,.9)"; ctx.setLineDash([r * 0.35, r * 0.3]);
        ctx.beginPath(); ctx.arc(x, y, r - lw / 2, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath(); ctx.arc(x, y, r * 0.68, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(0,0,0,.3)"; ctx.fill();
        ctx.lineWidth = 1.5; ctx.strokeStyle = "rgba(255,255,255,.55)"; ctx.stroke();
        ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.font = `700 ${Math.max(8, r * 0.4)}px "Segoe UI", Arial, sans-serif`;
        ctx.fillText(this.short(name), x, y, r * 1.25);
        ctx.restore();
    },

    /* ------------------------------ state ------------------------------ */
    syncButtons() {
        this.countBtns.forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.count) === this.count)));
        this.modeBtns.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.drawMode === this.mode)));
    },

    setBusy(busy) {
        this.countBtns.concat(this.modeBtns).forEach((b) => { b.disabled = busy; });
        this.el.start.disabled = busy || this.names().length === 0;
    },

    updateInfo() {
        const n = this.names().length;
        this.el.info.textContent = n ? `${n} player${n === 1 ? "" : "s"} in the pool` : "No players in this room yet.";
        this.el.start.disabled = this.running || n === 0;
    },

    renderIdle() {
        const [icon, text] = this.IDLE[this.mode];
        const box = this.mk("div", "draw-idle");
        box.append(this.mk("div", "draw-idle-icon", icon), this.mk("p", "", text));
        this.el.stage.replaceChildren(box);
    },

    onEnter() { if (!this.running) this.updateInfo(); },

    reset() {
        this.runId += 1;
        this.running = false;
        this.setBusy(false);
        this.el.podium.replaceChildren();
        this.el.result.textContent = "";
        this.renderIdle();
        this.updateInfo();
    },

    announce(name, rank, role) {
        const item = this.mk("div", "podium-item");
        item.setAttribute("role", "listitem");
        item.append(this.mk("span", "podium-rank", String(rank + 1)), this.mk("span", "podium-name", name));
        if (role) item.appendChild(this.mk("span", "podium-role", role));
        this.el.podium.appendChild(item);
        Sound.win();
    },

    /** Hands a finished selection round to the universal resolver (prize is house-funded, host only). */
    settleDraw(winners, participants, roundId, prizePool) {
        return resolveGameOutcome("draw:" + this.mode, { roundId, winners, participants, prizePool });
    },

    /** Rolling in-memory history of finished draws for this tab (never persisted). */
    drawLog: [],
    DRAW_LOG_MAX: 50,

    /**
     * Records a finished draw. Safe by design: it never throws and never blocks the draw flow.
     * - Empty / invalid input (null, undefined, [], blank names) is ignored.
     * - Every client keeps the local history and console entry.
     * - Only the Host writes to the shared Audit trail, so spectators never duplicate the entry.
     */
    logDraw(winners) {
        try {
            const list = (Array.isArray(winners) ? winners : [winners])
                .filter((w) => w !== null && w !== undefined && String(w).trim() !== "")
                .map((w) => String(w).trim());
            if (!list.length) return null;

            const entry = { mode: this.mode || "unknown", winners: list, ts: Date.now() };
            this.drawLog.push(entry);
            if (this.drawLog.length > this.DRAW_LOG_MAX) this.drawLog.shift();
            console.info(`[LuckyDraw] ${entry.mode}: ${list.join(", ")}`);

            const isHost = typeof State !== "undefined" && !!State && State.isHost === true;
            if (isHost && typeof Audit !== "undefined" && !!Audit && typeof Audit.log === "function") {
                const pending = Audit.log("draw", `Draw (${entry.mode}): ${list.join(", ")}`);
                if (pending && typeof pending.catch === "function") {
                    pending.catch((err) => console.warn("[LuckyDraw] Audit write failed:", err));
                }
            }
            return entry;
        } catch (err) {
            console.warn("[LuckyDraw] Could not log the draw:", err);
            return null;
        }
    },

    async start() {
        if (this.running) return;
        if (this.mode === "marble") { MarbleRace.hostStart(); return; }
        const names = this.names();
        if (!names.length) { Notify.error("No players in this room yet."); return; }
        const n = Math.min(this.count, names.length);
        if (n < this.count) Notify.warning(`Only ${names.length} player(s) available \u2014 drawing ${n}.`);

        this.runId += 1;
        const id = this.runId;
        this.running = true;
        this.setBusy(true);
        this.el.podium.replaceChildren();
        this.el.result.textContent = "";

        const winners = this.shuffle(names).slice(0, n);
        const prize = this.mode === "roles" ? 0 : GameResolver.readPrize("draw-prize", Rig.on && names.includes(Rig.target));
        const runner = { slots: this.runSlots, bingo: this.runBingo, cards: this.runCards, laser: this.runLaser, bracket: this.runBracket, plinko: this.runPlinko, chests: this.runChests, roles: this.runRoles }[this.mode];
        try {
            if (typeof runner !== "function") throw new Error(`No draw runner is defined for mode "${this.mode}".`);
            await runner.call(this, names, winners, id);
            this.logDraw(winners);
            this.settleDraw(winners, names, `${this.mode}-${id}-${Date.now().toString(36)}`, prize);
            this.el.result.textContent = this.mode === "roles" && this.lastRoles
                ? `\u{1F9E9} Roles: ${this.lastRoles.map(([who, role]) => `${who} \u2192 ${role}`).join(", ")}`
                : `\u{1F389} ${n === 1 ? "Winner" : "Winners"}: ${winners.join(", ")}`;
            Sound.jackpot();
        } catch (err) {
            if (err !== this.CANCEL) { console.error(err); Notify.error("The draw was interrupted."); }
        } finally {
            if (id === this.runId) { this.running = false; this.setBusy(false); this.updateInfo(); }
        }
    },

    /* ------------------- MODE 1: NAME SLOT MACHINE ------------------- */
    async runSlots(names, winners, id) {
        const H = 52;
        const box = this.mk("div", "reels");
        const reels = winners.map((winner, k) => {
            const target = 22 + k * 5;
            const reel = this.mk("div", "reel is-spinning");
            const strip = this.mk("div", "reel-strip");
            for (let i = 0; i < target + 4; i += 1) {
                strip.appendChild(this.mk("div", "reel-item", i === target ? winner : names[Math.floor(Math.random() * names.length)]));
            }
            const streak = this.mk("div", "reel-streak");
            reel.append(strip, streak, this.mk("div", "reel-window"));
            box.appendChild(reel);
            return { reel, strip, streak, winner, k, dist: (target - 1) * H, dur: 2400 + k * 650, done: false, lastRow: -1, prevY: 0 };
        });
        this.el.stage.replaceChildren(box);

        const OVER = 26, A = 0.8;
        await this.frames(id, (dt, t) => {
            let all = true;
            reels.forEach((r) => {
                if (r.done) return;
                const p = t / r.dur;
                let y;
                if (p >= 1) {
                    y = r.dist;
                    r.done = true;
                    r.reel.classList.remove("is-spinning");
                    r.reel.classList.add("is-done");
                    this.announce(r.winner, r.k);
                } else if (p < A) {
                    const q = p / A;
                    const ramp = Math.min(1, q / 0.08);
                    y = (r.dist + OVER) * (1 - Math.pow(1 - q, 4)) * (ramp * ramp * (3 - 2 * ramp));   // eased spin-up, long brake, small overshoot
                } else {
                    const s = (p - A) / (1 - A);
                    y = r.dist + OVER * Math.exp(-4 * s) * Math.cos(10 * s);   // damped spring = physics bounce
                    r.reel.classList.remove("is-spinning");
                }
                y = Math.round(y * 100) / 100;
                const vel = Math.abs(y - r.prevY) / Math.max(1, dt);          // px per ms
                r.prevY = y;
                const sp = r.done ? 0 : Math.min(1, Math.max(0, (vel - 0.3) / 1.1));
                r.strip.style.transform = `translate3d(0,${-y}px,0)`;
                r.streak.style.opacity = sp.toFixed(2);
                r.strip.style.opacity = (1 - 0.4 * sp).toFixed(2);
                const row = Math.floor(y / H);
                if (r.k === 0 && row !== r.lastRow) { r.lastRow = row; Sound.tick(row); }
                if (!r.done) all = false;
            });
            return all;
        });
    },

    /* ------------------ MODE 2: SPHERE LOTTERY / BINGO ------------------ */
    async runBingo(names, winners, id) {
        const { ctx, w, h } = this.makeCanvas(420);
        const R = Math.min(w / 2 - 8, (h - 56) / 2), cx = w / 2, cy = h - R - 6;
        const mouthY = cy - R, tubeTop = 8;
        const r = Math.max(11, Math.min(26, R * Math.sqrt(0.38 / names.length)));
        const gap = Math.asin(Math.min(0.9, (r + 5) / R));
        const palette = ["#e0483e", "#f4c430", "#2e8b57", "#e8e8e8", "#3b6fb6"];
        const balls = this.shuffle(names).map((name, i) => {
            const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * (R - r - 4);
            return { name, x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d, vx: (Math.random() - 0.5) * 200, vy: (Math.random() - 0.5) * 200, color: palette[i % palette.length], mode: "free" };
        });

        const step = (dt, blow) => {
            const s = dt / 1000;
            const free = balls.filter((b) => b.mode === "free");
            free.forEach((b) => {
                b.vy += 420 * s;
                if (b.y > cy + R * 0.2) b.vy -= blow * 1500 * s;          // air jet from the bottom
                b.vx += (Math.random() - 0.5) * blow * 1200 * s;
                const sp = Math.hypot(b.vx, b.vy);
                if (sp > 620) { b.vx *= 620 / sp; b.vy *= 620 / sp; }
                b.x += b.vx * s; b.y += b.vy * s;
            });
            for (let i = 0; i < free.length; i += 1) {
                const a = free[i];
                const dx = a.x - cx, dy = a.y - cy, d = Math.hypot(dx, dy) || 1;
                if (d > R - r) {
                    const nx = dx / d, ny = dy / d;
                    a.x = cx + nx * (R - r); a.y = cy + ny * (R - r);
                    const vn = a.vx * nx + a.vy * ny;
                    if (vn > 0) { a.vx -= 1.85 * vn * nx; a.vy -= 1.85 * vn * ny; }
                }
                for (let j = i + 1; j < free.length; j += 1) {
                    const b = free[j];
                    const ex = b.x - a.x, ey = b.y - a.y, dist = Math.hypot(ex, ey) || 0.01;
                    if (dist < 2 * r) {
                        const nx = ex / dist, ny = ey / dist, ov = (2 * r - dist) / 2;
                        a.x -= nx * ov; a.y -= ny * ov; b.x += nx * ov; b.y += ny * ov;
                        const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
                        if (rel < 0) { const imp = -rel * 0.9; a.vx -= imp * nx; a.vy -= imp * ny; b.vx += imp * nx; b.vy += imp * ny; }
                    }
                }
            }
        };

        const drawBall = (b) => {
            ctx.beginPath(); ctx.arc(b.x, b.y, r, 0, Math.PI * 2); ctx.fillStyle = b.color; ctx.fill();
            const g = ctx.createRadialGradient(b.x - r * 0.35, b.y - r * 0.35, r * 0.1, b.x, b.y, r);
            g.addColorStop(0, "rgba(255,255,255,.75)"); g.addColorStop(0.4, "rgba(255,255,255,0)"); g.addColorStop(1, "rgba(0,0,0,.35)");
            ctx.fillStyle = g; ctx.fill();
            ctx.beginPath(); ctx.arc(b.x, b.y, r * 0.68, 0, Math.PI * 2); ctx.fillStyle = "rgba(255,255,255,.92)"; ctx.fill();
            ctx.fillStyle = "#14171c"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
            ctx.font = `700 ${Math.max(8, r * 0.4)}px "Segoe UI", Arial, sans-serif`;
            ctx.fillText(this.short(b.name, 9), b.x, b.y, r * 1.2);
        };

        const draw = (banner) => {
            ctx.clearRect(0, 0, w, h);
            ctx.lineWidth = 3; ctx.strokeStyle = "rgba(233,196,106,.85)";
            ctx.beginPath();
            ctx.moveTo(cx - r - 5, mouthY); ctx.lineTo(cx - r - 5, tubeTop);
            ctx.moveTo(cx + r + 5, mouthY); ctx.lineTo(cx + r + 5, tubeTop);
            ctx.stroke();
            const g = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.3, R * 0.1, cx, cy, R);
            g.addColorStop(0, "rgba(255,255,255,.14)"); g.addColorStop(1, "rgba(255,255,255,.03)");
            ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
            ctx.lineWidth = 4; ctx.strokeStyle = "#b8860b";
            ctx.beginPath(); ctx.arc(cx, cy, R, -Math.PI / 2 + gap, Math.PI * 1.5 - gap); ctx.stroke();
            balls.forEach(drawBall);
            if (banner) {
                ctx.save();
                ctx.fillStyle = "#f4c430"; ctx.shadowColor = "rgba(244,196,48,.8)"; ctx.shadowBlur = 12;
                ctx.textAlign = "left"; ctx.textBaseline = "middle";
                ctx.font = '700 20px "Segoe UI", Arial, sans-serif';
                const x = cx + r + 16;
                ctx.fillText("\u2605 " + banner, x, tubeTop + 18, Math.max(60, w - x - 8));
                ctx.restore();
            }
        };

        let blow = 0.5;
        for (let k = 0; k < winners.length; k += 1) {
            const ball = balls.find((b) => b.name === winners[k]);
            let phase = "blow", pt = 0, banner = null;
            await this.frames(id, (dt) => {
                pt += dt;
                if (phase === "blow") {
                    blow = 1;
                    if (Math.floor(pt / 130) !== Math.floor((pt - dt) / 130)) Sound.tone(200 + Math.random() * 220, 40, "triangle", 0.03);
                    if (pt > 1700) { phase = "pull"; pt = 0; ball.mode = "pull"; blow = 0.5; }
                } else if (phase === "pull") {
                    const dx = cx - ball.x, dy = mouthY + r - ball.y, d = Math.hypot(dx, dy);
                    if (d < 6) { phase = "tube"; pt = 0; ball.x = cx; }
                    else { const sp = 240 * dt / 1000; ball.x += (dx / d) * Math.min(sp, d); ball.y += (dy / d) * Math.min(sp, d); }
                } else if (phase === "tube") {
                    ball.y -= 200 * dt / 1000;
                    if (ball.y <= tubeTop + r + 2) { ball.y = tubeTop + r + 2; phase = "show"; pt = 0; banner = winners[k]; ball.mode = "show"; this.announce(winners[k], k); }
                } else if (pt > 1100) {
                    return true;
                }
                step(dt, blow);
                draw(banner);
                return false;
            });
            balls.splice(balls.indexOf(ball), 1);
        }
    },

    /* ---------------------- MODE 3: CARD DEALER ---------------------- */
    async runCards(names, winners, id) {
        const area = this.mk("div", "deal-area");
        const deck = this.mk("div", "deck");
        const shown = Math.min(names.length, 14);
        for (let i = 0; i < shown; i += 1) {
            const mini = this.mk("div", "deck-card");
            mini.style.setProperty("--i", String(i));
            mini.style.transform = `translate(${i * 1.5}px, ${-i * 1.5}px)`;
            mini.style.animationDelay = `${(i % 5) * 60}ms`;
            deck.appendChild(mini);
        }
        const row = this.mk("div", "deal-row");
        area.append(this.mk("p", "deal-label", `${names.length} player card${names.length === 1 ? "" : "s"} in the deck`), deck, row);
        this.el.stage.replaceChildren(area);

        deck.classList.add("is-shuffling");
        for (let i = 0; i < 8; i += 1) { Sound.tone(300 + Math.random() * 200, 40, "square", 0.025); await this.wait(220, id); }
        deck.classList.remove("is-shuffling");

        const suits = Deck.SUITS;
        const cards = winners.map((winner, k) => {
            const card = this.mk("div", "deal-card");
            const inner = this.mk("div", "deal-inner");
            const back = this.mk("div", "deal-face deal-back", "\u2660");
            const front = this.mk("div", "deal-face deal-front");
            const suit = suits[Math.floor(Math.random() * suits.length)];
            const red = suit === "\u2665" || suit === "\u2666";
            front.classList.toggle("is-red", red);
            front.append(this.mk("span", "deal-suit", suit), this.mk("span", "deal-name", winner), this.mk("span", "deal-tag", "WINNER"));
            inner.append(back, front);
            card.appendChild(inner);
            row.appendChild(card);
            return card;
        });

        const dr = deck.getBoundingClientRect();
        cards.forEach((card, i) => {
            const cr = card.getBoundingClientRect();
            const dx = dr.left + dr.width / 2 - (cr.left + cr.width / 2);
            const dy = dr.top + dr.height / 2 - (cr.top + cr.height / 2);
            card.animate([
                { transform: `translate3d(${dx}px, ${dy}px, 0) rotate(-14deg) scale(.6)`, opacity: 0, offset: 0 },
                { opacity: 1, offset: 0.12 },
                { transform: `translate3d(${dx * 0.4}px, ${dy * 0.4 - 24}px, 0) rotate(6deg) scale(1.08)`, opacity: 1, offset: 0.55 },
                { transform: "translate3d(0,0,0) rotate(0deg) scale(1)", opacity: 1, offset: 1 }
            ], { duration: 720, delay: i * 260, easing: "cubic-bezier(.2,.8,.25,1)", fill: "backwards" });
            window.setTimeout(() => { if (id === this.runId) Sound.click(); }, i * 260 + 200);
        });
        await this.wait(cards.length * 260 + 700, id);

        for (let i = 0; i < cards.length; i += 1) {
            await this.wait(i === cards.length - 1 && cards.length > 1 ? 1100 : 650, id);
            cards[i].classList.add("is-flipped");
            await this.wait(450, id);
            cards[i].classList.add("is-winner");
            this.announce(winners[i], i);
        }
        await this.wait(500, id);
    },

    /* ------------------ MODE 4: CHIP RAIN / LASER PULSE ------------------ */
    async runLaser(names, winners, id) {
        const { ctx, w, h } = this.makeCanvas(440);
        const cx = w / 2, cy = h * 0.42, RX = w / 2 - 34, RY = h * 0.34;
        const r = Math.max(13, Math.min(27, Math.min(RX, RY) * Math.sqrt(0.5 / names.length) * 1.5));
        const slotR = Math.max(14, Math.min(26, (w - 30) / (2 * winners.length) - 6));
        const slotY = h - slotR - 24;
        const slotX = (k) => 20 + (w - 40) * (k + 0.5) / winners.length;
        const src = { x: cx, y: 8 };
        const chips = this.shuffle(names).map((name, i) => ({
            name, a: Math.random() * Math.PI * 2, ro: 0.25 + Math.random() * 0.7, dir: Math.random() < 0.5 ? -1 : 1,
            w0: 0.7 + Math.random() * 0.8, color: this.CHIP_COLORS[i % this.CHIP_COLORS.length],
            delay: Math.random() * 700, mode: "orbit", x: cx, y: -60, slot: -1
        }));
        let time = 0;

        const beam = (tx, ty, flash) => {
            ctx.save();
            ctx.globalCompositeOperation = "lighter";
            const g = ctx.createLinearGradient(src.x, src.y, tx, ty);
            g.addColorStop(0, `rgba(255,240,170,${0.5 + flash * 0.4})`); g.addColorStop(1, "rgba(255,200,60,.08)");
            ctx.fillStyle = g;
            const ang = Math.atan2(ty - src.y, tx - src.x) + Math.PI / 2, half = r * (0.9 + flash);
            ctx.beginPath();
            ctx.moveTo(src.x - 2, src.y); ctx.lineTo(src.x + 2, src.y);
            ctx.lineTo(tx + Math.cos(ang) * half, ty + Math.sin(ang) * half);
            ctx.lineTo(tx - Math.cos(ang) * half, ty - Math.sin(ang) * half);
            ctx.closePath(); ctx.fill();
            const sg = ctx.createRadialGradient(tx, ty, 0, tx, ty, r * 2.2);
            sg.addColorStop(0, `rgba(255,240,170,${0.5 + flash * 0.35})`); sg.addColorStop(1, "rgba(255,240,170,0)");
            ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(tx, ty, r * 2.2, 0, Math.PI * 2); ctx.fill();
            ctx.restore();
            ctx.fillStyle = "#f4c430"; ctx.beginPath(); ctx.arc(src.x, src.y, 6, 0, Math.PI * 2); ctx.fill();
        };

        const render = (dt, target, flash, ring) => {
            time += dt;
            ctx.clearRect(0, 0, w, h);
            for (let k = 0; k < winners.length; k += 1) {
                ctx.save(); ctx.setLineDash([5, 5]); ctx.lineWidth = 2; ctx.strokeStyle = "rgba(233,196,106,.5)";
                ctx.beginPath(); ctx.arc(slotX(k), slotY, slotR, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
            }
            chips.forEach((c) => {
                if (c.mode === "orbit") {
                    c.a += c.dir * c.w0 / (0.45 + c.ro) * dt / 1000;
                    const e = Math.min(1, Math.max(0, (time - c.delay) / 750));
                    c.x = cx + Math.cos(c.a) * c.ro * RX;
                    c.y = cy + Math.sin(c.a) * c.ro * RY * 0.9 - Math.pow(1 - e, 3) * (h + 60);   // chip rain intro
                    this.drawChip(ctx, c.x, c.y, r, c.name, c.color, false);
                } else if (c.mode === "fly") {
                    this.drawChip(ctx, c.x, c.y, r + (slotR - r) * c.p, c.name, c.color, true);
                } else {
                    this.drawChip(ctx, slotX(c.slot), slotY, slotR, c.name, c.color, true);
                }
            });
            if (target) {
                beam(target.x, target.y, flash);
                if (ring) {
                    ctx.save(); ctx.lineWidth = 3; ctx.strokeStyle = "#f4c430"; ctx.shadowColor = "#f4c430"; ctx.shadowBlur = 16;
                    ctx.beginPath(); ctx.arc(target.x, target.y, r + 5, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
                }
            }
        };

        await this.frames(id, (dt, t) => { render(dt, null, 0, false); return t > 1300; });   // let the rain settle

        const PULSE = 280, LOCK = 750, FLY = 850;
        for (let k = 0; k < winners.length; k += 1) {
            const wc = chips.find((c) => c.name === winners[k]);
            const decoys = this.shuffle(chips.filter((c) => c !== wc && c.mode === "orbit")).slice(0, 5);
            const seq = decoys.concat(wc), scan = seq.length * PULSE;
            let lastIdx = -1, locked = false;
            await this.frames(id, (dt, t) => {
                if (t < scan) {
                    const idx = Math.floor(t / PULSE), ph = (t % PULSE) / PULSE;
                    if (idx !== lastIdx) { lastIdx = idx; Sound.tone(500 + idx * 90, 70, "sawtooth", 0.03); }
                    render(dt, seq[idx], ph < 0.25 ? (1 - ph / 0.25) * 0.6 : 0, false);
                } else if (t < scan + LOCK) {
                    if (!locked) { locked = true; Sound.tone(880, 220, "triangle", 0.06); }
                    render(dt, wc, 0.5 + 0.5 * Math.sin((t - scan) / 60), true);
                } else {
                    const p = Math.min(1, (t - scan - LOCK) / FLY), e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
                    if (wc.mode !== "fly") { wc.mode = "fly"; wc.fx = wc.x; wc.fy = wc.y; }
                    wc.p = e;
                    wc.x = wc.fx + (slotX(k) - wc.fx) * e;
                    wc.y = wc.fy + (slotY - wc.fy) * e - Math.sin(p * Math.PI) * 40;
                    render(dt, null, 0, false);
                    if (p >= 1) { wc.mode = "slot"; wc.slot = k; this.announce(winners[k], k); return true; }
                }
                return false;
            });
            await this.frames(id, (dt, t) => { render(dt, null, 0, false); return t > 300; });
        }
    },

    /* ------------------ MODE 5: 1v1 ELIMINATION BRACKET ------------------
       Players are seeded into a knockout bracket (up to 16 shown). Seeds follow the standard
       order, so winner #1 is the champion, #2 the runner-up, #3-#4 the semifinalists and so on:
       the bracket always ends exactly as the draw decided. Byes fill the empty seats. */
    async runBracket(names, winners, id) {
        const others = this.shuffle(names.filter((n) => !winners.includes(n)));
        const ranking = winners.concat(others).slice(0, Math.max(2, Math.min(16, names.length)));
        let size = 1;
        while (size < ranking.length) size *= 2;
        let order = [1];
        while (order.length < size) { const len = order.length * 2; order = order.flatMap((s) => [s, len + 1 - s]); }
        const rank = new Map(ranking.map((n, i) => [n, i]));
        const better = (a, b) => (a == null ? b : b == null ? a : rank.get(a) < rank.get(b) ? a : b);

        const rounds = [order.map((s) => ranking[s - 1] ?? null)];
        while (rounds[rounds.length - 1].length > 1) {
            const prev = rounds[rounds.length - 1], next = [];
            for (let i = 0; i < prev.length; i += 2) next.push(better(prev[i], prev[i + 1]));
            rounds.push(next);
        }

        const total = rounds.length - 1;
        const label = (r) => (r === total ? "Champion" : r === total - 1 ? "Final" : r === total - 2 ? "Semifinal" : "Round " + (r + 1));
        const board = this.mk("div", "z-bracket draw-bracket");
        const cells = rounds.map((round, r) => {
            const col = this.mk("div", "z-col");
            col.appendChild(this.mk("small", "", label(r)));
            const slots = [];
            const per = r === total ? 1 : 2;
            for (let i = 0; i < round.length; i += per) {
                const match = this.mk("div", "z-match");
                for (let j = 0; j < per; j += 1) {
                    const slot = this.mk("div", "z-slot", r === 0 ? (round[i + j] == null ? "bye" : this.short(round[i + j], 16)) : "…");
                    match.appendChild(slot);
                    slots.push(slot);
                }
                col.appendChild(match);
            }
            board.appendChild(col);
            return slots;
        });
        if (total === 0) cells[0][0].textContent = this.short(rounds[0][0], 16);
        this.el.stage.replaceChildren(board);
        await this.wait(500, id);

        for (let r = 0; r < total; r += 1) {
            const round = rounds[r];
            for (let i = 0; i < round.length; i += 2) {
                const a = round[i], b = round[i + 1], w = rounds[r + 1][i / 2];
                const sa = cells[r][i], sb = cells[r][i + 1];
                if (a != null && b != null) {
                    // a short "face-off": the highlight bounces between the two players
                    for (let k = 0; k < 4; k += 1) {
                        sa.classList.toggle("is-live", k % 2 === 0);
                        sb.classList.toggle("is-live", k % 2 === 1);
                        Sound.tone(520 + k * 60, 45, "square", 0.025);
                        await this.wait(r === total - 1 ? 200 : 110, id);
                    }
                }
                sa.classList.remove("is-live"); sb.classList.remove("is-live");
                (w === a ? sa : sb).classList.add("win");
                if (a != null && b != null) (w === a ? sb : sa).classList.add("out");
                const dest = cells[r + 1][i / 2];
                dest.textContent = this.short(w, 16);
                dest.classList.add("is-new");
                Sound.click();
            }
            await this.wait(250, id);
        }
        cells[total][0].classList.add("win");
        await this.wait(400, id);
        winners.forEach((w, k) => this.announce(w, k));
        await this.wait(300, id);
    },

    /* ----------------------- MODE 6: PLINKO / GRAVITY DROP -----------------------
       Bins at the bottom carry player names (winners plus random others, up to 9). One ball per
       winner bounces peg to peg; its left/right path is chosen so it settles in that winner's bin. */
    async runPlinko(names, winners, id) {
        const B = Math.min(9, Math.max(names.length, winners.length));
        const fill = this.shuffle(names.filter((n) => !winners.includes(n))).slice(0, Math.max(0, B - winners.length));
        const bins = this.shuffle(winners.concat(fill));
        const rows = Math.max(1, bins.length - 1);
        const H = 430, { ctx, w, h } = this.makeCanvas(H);
        const sp = (w - 24) / bins.length, top = 34, rowH = (h - 120 - top) / rows;
        const binTop = h - 78, cx = w / 2;
        const pegX = (row, k) => cx + (k - row / 2) * sp;
        const pegY = (row) => top + row * rowH;
        const binX = (k) => cx + (k - (bins.length - 1) / 2) * sp;
        const landed = new Set();
        const balls = [];

        const draw = () => {
            ctx.clearRect(0, 0, w, h);
            for (let r = 0; r < rows; r += 1) {
                for (let k = 0; k <= r; k += 1) {
                    ctx.beginPath(); ctx.arc(pegX(r, k), pegY(r), 4, 0, Math.PI * 2);
                    ctx.fillStyle = "rgba(244,196,48,.85)"; ctx.fill();
                }
            }
            bins.forEach((name, k) => {
                const x = binX(k) - sp / 2 + 2, win = landed.has(k);
                ctx.fillStyle = win ? "rgba(244,196,48,.9)" : "rgba(255,255,255,.08)";
                ctx.strokeStyle = "rgba(233,196,106,.6)"; ctx.lineWidth = 1.5;
                ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, binTop, sp - 4, 70, 8) : ctx.rect(x, binTop, sp - 4, 70);
                ctx.fill(); ctx.stroke();
                ctx.save();
                ctx.translate(binX(k), binTop + 64); ctx.rotate(-Math.PI / 2);
                ctx.fillStyle = win ? "#14171c" : "#eef2f5"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
                ctx.font = `700 ${Math.max(9, Math.min(12, sp * 0.3))}px "Segoe UI", Arial, sans-serif`;
                ctx.fillText(this.short(name, 9), 0, 0, 58);
                ctx.restore();
            });
            balls.forEach((b) => this.drawChip(ctx, b.x, b.y, 11, "", b.color, true));
        };

        for (let n = 0; n < winners.length; n += 1) {
            const target = bins.indexOf(winners[n]);
            // exactly `target` steps to the right, in random order
            const steps = Array.from({ length: rows }, (_, i) => (i < target ? 1 : 0));
            const path = this.shuffle.call({ shuffle: null }, steps);
            const pts = [{ x: cx, y: 6 }];
            let k = 0;
            for (let r = 0; r < rows; r += 1) { pts.push({ x: pegX(r, k), y: pegY(r) - 12 }); k += path[r]; }
            if (bins.length === 1) k = 0;
            pts.push({ x: binX(k), y: binTop + 18 });
            const ball = { x: cx, y: 6, color: this.CHIP_COLORS[n % this.CHIP_COLORS.length] };
            balls.push(ball);
            const HOP = 170;
            let lastSeg = -1;
            await this.frames(id, (dt, t) => {
                t = Math.max(0, t);   // the first rAF timestamp can precede the start time by a fraction of a ms
                const seg = Math.min(pts.length - 2, Math.floor(t / HOP)), p = Math.min(1, (t - seg * HOP) / HOP);
                const a = pts[seg], b = pts[seg + 1];
                ball.x = a.x + (b.x - a.x) * p;
                ball.y = a.y + (b.y - a.y) * p - Math.sin(p * Math.PI) * Math.min(18, rowH * 0.45);
                if (seg !== lastSeg) { lastSeg = seg; Sound.tick(seg); }
                draw();
                return t >= HOP * (pts.length - 1);
            });
            landed.add(k);
            draw();
            this.announce(winners[n], n);
            await this.wait(350, id);
        }
    },

    /* ------------------------ MODE 7: MYSTERY CHESTS ------------------------
       Every player gets a chest (up to 24 shown). After a shuffle, a few chests open to reveal
       other players, then the winners' chests burst open one by one. */
    async runChests(names, winners, id) {
        const others = this.shuffle(names.filter((n) => !winners.includes(n)));
        const inGrid = this.shuffle(winners.concat(others.slice(0, Math.max(0, 24 - winners.length))));
        const grid = this.mk("div", "chest-grid draw-chests");
        const chests = inGrid.map((name) => {
            const c = this.mk("div", "chest", "\u{1F381}");
            c.setAttribute("aria-hidden", "true");
            c.dataset.name = name;
            grid.appendChild(c);
            return c;
        });
        this.el.stage.replaceChildren(grid);

        grid.classList.add("is-shuffling");
        for (let i = 0; i < 6; i += 1) { Sound.tone(260 + Math.random() * 160, 40, "square", 0.025); await this.wait(180, id); }
        grid.classList.remove("is-shuffling");

        const open = (c, win) => {
            c.textContent = this.short(c.dataset.name, 14);
            c.classList.add("open");
            if (win) c.classList.add("win");
        };
        const decoys = this.shuffle(chests.filter((c) => !winners.includes(c.dataset.name))).slice(0, Math.min(4, chests.length - winners.length));
        for (const c of decoys) { open(c, false); Sound.click(); await this.wait(320, id); }
        for (let k = 0; k < winners.length; k += 1) {
            const c = chests.find((x) => x.dataset.name === winners[k]);
            c.classList.add("is-shaking");
            Sound.tone(700, 120, "triangle", 0.05);
            await this.wait(650, id);
            c.classList.remove("is-shaking");
            open(c, true);
            this.announce(winners[k], k);
            await this.wait(450, id);
        }
    },

    /* --------------------- MODE 8: ROLES & TASK MATRIX ---------------------
       Each selected player gets a different role. The role column spins through the list and
       lands on the assigned role, row by row (no chips are paid in this mode). */
    ROLES: ["Leader", "Timekeeper", "Note-taker", "Presenter", "Researcher", "Checker"],

    async runRoles(names, winners, id) {
        const roles = this.shuffle.call({ shuffle: null }, this.ROLES.slice()).slice(0, winners.length);
        const matrix = this.mk("div", "roles-matrix");
        const head = this.mk("div", "roles-row roles-head");
        head.append(this.mk("div", "roles-cell", "Player"), this.mk("div", "roles-cell", "Role / Task"));
        matrix.appendChild(head);
        const rows = winners.map((name) => {
            const row = this.mk("div", "roles-row");
            const who = this.mk("div", "roles-cell", "?");
            const role = this.mk("div", "roles-cell", "…");
            row.append(who, role);
            matrix.appendChild(row);
            return { who, role, name };
        });
        this.el.stage.replaceChildren(matrix);
        await this.wait(300, id);

        this.lastRoles = [];
        for (let k = 0; k < rows.length; k += 1) {
            const r = rows[k];
            r.who.textContent = r.name;
            for (let i = 0; i < 12; i += 1) {
                r.role.textContent = this.ROLES[(k + i) % this.ROLES.length];
                Sound.tick(i);
                await this.wait(60 + i * 12, id);
            }
            r.role.textContent = roles[k];
            r.role.classList.add("landed");
            this.lastRoles.push([r.name, roles[k]]);
            this.announce(r.name, k, roles[k]);
            await this.wait(350, id);
        }
    }
};
