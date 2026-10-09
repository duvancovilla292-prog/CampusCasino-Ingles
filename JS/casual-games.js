/* =========================================================================
   CASINO CAMPUS — CASUAL & PARTY GAMES
   UNO, Parqués, Dominoes, Chess, Chinese Checkers, Color Code Breaker, Picas y Fijas (all with
   the shared Party table flow and single-player Casino Bot fallback), Marble Gravity Race,
   Lucky Draw, Player Wheel and knockout Tournaments.
   Load order: 4 of 5 — needs firebase-sync.js, ui-audio.js and casino-games.js.
   Classic <script> (not an ES module): top-level const / function declarations are shared
   between the five files through the page's global lexical scope, so the cross-module
   references of the original single-closure build keep working unchanged.
   ========================================================================= */
"use strict";

/* =========================================================================
   14.5 PLAYER WHEEL (multiplayer name-elimination roulette)
   A separate game from the number/color Roulette above: the wheel's
   slices are the room's own players, pulled live from Firebase via
   Room.list(). Spinning never touches the database — it only affects
   an in-memory pool for the current browser tab. Winners can optionally
   be dropped from that in-memory pool for subsequent spins, but they
   always remain full room members.
   ========================================================================= */
const PlayerWheel = {
    pool: [],            // usernames currently active in this tab's wheel pool
    hasSession: false,   // whether a wheel session has already been started
    isSpinning: false,
    rotation: 0,
    spinId: 0,
    canvas: null,
    pendingWinner: null,

    init() {
        DOM.btnWheelSpin.addEventListener("click", () => this.spin());
        if (window.ResizeObserver) new ResizeObserver(() => this.draw()).observe(DOM.wheelContainer);
        else window.addEventListener("resize", () => this.draw());
        DOM.btnWheelRestart.addEventListener("click", () => this.restartPool());

        DOM.btnWheelRemove.addEventListener("click", () => this.resolveWinner(true));
        DOM.btnWheelKeep.addEventListener("click", () => this.resolveWinner(false));

        DOM.btnWheelResumeRestart.addEventListener("click", () => this.handleResumeChoice("restart"));
        DOM.btnWheelResumeContinue.addEventListener("click", () => this.handleResumeChoice("continue"));

        // If the Host deletes a player from the room entirely while the wheel
        // is idle, quietly drop them from the pool too (never the reverse —
        // removing someone from the pool must never touch the room roster).
        PubSub.on("players-updated", () => {
            if (!this.hasSession || this.isSpinning) return;
            const roomUsernames = new Set(Room.list().map((p) => p.username));
            const before = this.pool.length;
            this.pool = this.pool.filter((name) => roomUsernames.has(name));
            if (this.pool.length !== before && Router.currentGameKey === "wheel") {
                this.render();
            }
        });
    },

    /** Called by the Router each time the Player Wheel section is opened. */
    onEnter() {
        if (!this.hasSession) {
            this.startFreshPool();
            DOM.wheelResult.textContent = "";
            this.render();
            return;
        }
        // Returning to the wheel later in the same session — ask first,
        // rather than silently resetting or silently resuming.
        this.openResumeModal();
    },

    startFreshPool() {
        this.pool = Room.list().map((p) => p.username);
        this.hasSession = true;
    },

    restartPool() {
        if (this.isSpinning) return;
        this.startFreshPool();
        DOM.wheelResult.textContent = "";
        this.render();
        Notify.success("Wheel pool reset to all current room players.");
    },

    openResumeModal() {
        const count = this.pool.length;
        DOM.wheelResumeSubtitle.textContent = count > 0
            ? `You left the wheel earlier with ${count} player${count === 1 ? "" : "s"} still in the pool. Continue where you left off, or restart with everyone currently in the room?`
            : "Your previous pool was empty. Restart with everyone currently in the room, or continue with an empty pool.";
        DOM.wheelResumeModal.hidden = false;
    },

    handleResumeChoice(choice) {
        DOM.wheelResumeModal.hidden = true;
        if (choice === "restart") {
            this.startFreshPool();
            Notify.success("Wheel pool reset to all current room players.");
        } else {
            // Continue with the prior pool, only dropping anyone who has since
            // left the room entirely (the pool must never outlive the roster).
            const roomUsernames = new Set(Room.list().map((p) => p.username));
            this.pool = this.pool.filter((name) => roomUsernames.has(name));
        }
        DOM.wheelResult.textContent = "";
        this.render();
    },

    ensureCanvas() {
        if (this.canvas && this.canvas.isConnected) return;
        const cv = document.createElement("canvas");
        cv.className = "wheel-canvas";
        cv.setAttribute("aria-hidden", "true");
        DOM.wheelDial.appendChild(cv);
        DOM.wheelLabels.style.display = "none";
        DOM.wheelDial.style.transform = "";
        DOM.wheelPointer.style.transformOrigin = "50% 0";
        this.canvas = cv;
    },

    /** Re-rasterises the whole wheel every frame, so names stay razor-sharp while it turns (no rotated bitmaps). */
    draw(hi, flash) {
        this.ensureCanvas();
        const cv = this.canvas, size = Math.round(DOM.wheelDial.clientWidth - 12);
        if (size < 60) return;
        const dpr = Math.min(window.devicePixelRatio || 1, 2.5), px = Math.round(size * dpr);
        if (cv.width !== px) { cv.width = px; cv.height = px; }
        const ctx = cv.getContext("2d");
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, size, size);
        const css = getComputedStyle(document.documentElement);
        const c1 = css.getPropertyValue("--color-felt-light").trim() || "#0f6248";
        const c2 = css.getPropertyValue("--color-felt-dark").trim() || "#052d21";
        const cx = size / 2, R = size / 2 - 1, n = this.pool.length;
        if (n === 0) { ctx.fillStyle = c2; ctx.beginPath(); ctx.arc(cx, cx, R, 0, Math.PI * 2); ctx.fill(); return; }

        const slice = (Math.PI * 2) / n, rot = (this.rotation * Math.PI) / 180;
        const fs = Math.max(9, Math.min(15, R * 0.75 * slice * 0.7));
        const textR = R - 14, maxW = Math.max(30, textR - size * 0.15);
        ctx.font = `700 ${fs}px "Segoe UI", Arial, sans-serif`;
        ctx.textBaseline = "middle";
        for (let i = 0; i < n; i += 1) {
            const a0 = -Math.PI / 2 + rot + i * slice, a1 = a0 + slice;
            ctx.beginPath(); ctx.moveTo(cx, cx); ctx.arc(cx, cx, R, a0, a1); ctx.closePath();
            ctx.fillStyle = i % 2 === 0 ? c1 : c2; ctx.fill();
            if (i === hi) { ctx.fillStyle = `rgba(244,196,48,${0.25 + 0.55 * (flash || 0)})`; ctx.fill(); }
            ctx.lineWidth = 1; ctx.strokeStyle = "rgba(245,210,122,.35)"; ctx.stroke();
        }
        for (let i = 0; i < n; i += 1) {
            const am = -Math.PI / 2 + rot + i * slice + slice / 2;
            let label = this.pool[i];
            if (ctx.measureText(label).width > maxW) {
                while (label.length > 1 && ctx.measureText(label + "\u2026").width > maxW) label = label.slice(0, -1);
                label += "\u2026";
            }
            ctx.save(); ctx.translate(cx, cx); ctx.rotate(am); ctx.textAlign = "right";
            ctx.lineJoin = "round"; ctx.lineWidth = 3; ctx.strokeStyle = "rgba(0,0,0,.55)"; ctx.strokeText(label, textR, 0);
            ctx.fillStyle = i === hi ? "#fff3b0" : "#f6f1e0"; ctx.fillText(label, textR, 0);
            ctx.restore();
        }
        const g = ctx.createRadialGradient(cx, cx, R * 0.25, cx, cx, R);
        g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0,.38)");
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cx, R, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#e9c46a";
        for (let i = 0; n <= 60 && i < n; i += 1) {
            const a = -Math.PI / 2 + rot + i * slice;
            ctx.beginPath(); ctx.arc(cx + Math.cos(a) * (R - 4), cx + Math.sin(a) * (R - 4), 2.4, 0, Math.PI * 2); ctx.fill();
        }
    },

    render() {
        const count = this.pool.length;

        DOM.wheelPoolCount.textContent = `${count} player${count === 1 ? "" : "s"} in the pool`;
        DOM.wheelPoolList.innerHTML = "";
        this.pool.forEach((name) => {
            const chip = document.createElement("li");
            chip.className = "wheel-pool-chip";
            chip.textContent = name;
            DOM.wheelPoolList.appendChild(chip);
        });

        DOM.wheelEmptyState.hidden = count > 0;
        DOM.btnWheelSpin.disabled = count < 2;
        this.draw();
    },

    spin() {
        if (this.isSpinning) return;
        if (this.pool.length < 2) {
            Notify.error("Add at least two players to the pool before spinning.");
            return;
        }

        this.isSpinning = true;
        this.pendingWinner = null;
        DOM.btnWheelSpin.disabled = true;
        DOM.btnWheelRestart.disabled = true;
        DOM.wheelResult.textContent = "";
        Sound.click();

        const count = this.pool.length, slice = 360 / count;
        const winnerIndex = Rig.idx(this.pool, Math.floor(Math.random() * count));
        const jitter = (Math.random() - 0.5) * slice * 0.6;              // land anywhere inside the slice, not dead centre
        const currentMod = ((this.rotation % 360) + 360) % 360;
        const targetAngle = (((360 - (winnerIndex * slice + slice / 2 + jitter)) % 360) + 360) % 360;
        let delta = targetAngle - currentMod;
        if (delta <= 0) delta += 360;
        const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        const from = this.rotation, to = from + 360 * (reduce ? 1 : 5) + delta, dur = reduce ? 900 : 4600;
        const id = ++this.spinId, t0 = performance.now();
        let lastIdx = -1, kick = 0, lastT = t0;

        const frame = (now) => {
            if (id !== this.spinId) return;
            const p = Math.min(1, (now - t0) / dur), q = 1 - p;
            const ramp = Math.min(1, p / 0.06);
            const soft = (1 - q * q * q * q * q) * (ramp * ramp * (3 - 2 * ramp));     // eased spin-up, long quintic brake
            this.rotation = from + (to - from) * soft;
            const mod = ((this.rotation % 360) + 360) % 360;
            const idx = Math.floor((((360 - mod) % 360)) / slice) % count;
            if (idx !== lastIdx) {
                if (lastIdx !== -1) { kick = 1; if (p < 0.985) Sound.tone(520 + (idx % 4) * 60, 22, "triangle", 0.03); }
                lastIdx = idx;
            }
            kick = Math.max(0, kick - (now - lastT) / 140); lastT = now;
            DOM.wheelPointer.style.transform = `translateX(-50%) rotate(${(-kick * 16).toFixed(2)}deg)`;
            this.draw();
            if (p < 1) { window.requestAnimationFrame(frame); return; }
            this.rotation = ((this.rotation % 360) + 360) % 360;
            DOM.wheelPointer.style.transform = "";
            const f0 = performance.now();
            const flashLoop = (t2) => {
                if (id !== this.spinId) return;
                const k = (t2 - f0) / 750;
                this.draw(winnerIndex, 0.5 + 0.5 * Math.sin(k * Math.PI * 6));
                if (k < 1) window.requestAnimationFrame(flashLoop); else this.resolveSpin(winnerIndex);
            };
            window.requestAnimationFrame(flashLoop);
        };
        window.requestAnimationFrame(frame);
    },

    resolveSpin(winnerIndex) {
        const winner = this.pool[winnerIndex];
        this.pendingWinner = winner;
        this.isSpinning = false;
        DOM.btnWheelRestart.disabled = false;
        DOM.btnWheelSpin.disabled = this.pool.length < 2;
        DOM.wheelResult.textContent = `The wheel landed on ${winner}.`;
        const prize = GameResolver.readPrize("wheel-prize", Rig.on && Rig.target === winner);
        resolveGameOutcome("wheel", { winners: [winner], participants: this.pool.slice(), prizePool: prize });
        Sound.win();
        this.draw(winnerIndex, 1);

        DOM.wheelWinnerName.textContent = winner;
        DOM.wheelWinnerModal.hidden = false;
    },

    /** Applies the Keep/Remove choice from the winner modal. Removal only
     *  ever touches this.pool (the in-tab spin pool) — it never calls
     *  Room.deletePlayer or otherwise reaches the Firebase player list. */
    resolveWinner(remove) {
        DOM.wheelWinnerModal.hidden = true;
        if (this.pendingWinner && remove) {
            this.pool = this.pool.filter((name) => name !== this.pendingWinner);
            Notify.warning(`${this.pendingWinner} was removed from the wheel pool (still a room member).`);
        } else if (this.pendingWinner) {
            Notify.success(`${this.pendingWinner} stays in the wheel pool.`);
        }
        this.pendingWinner = null;
        this.render();
    }
};

/* =========================================================================
   16b. LUCKY DRAW (pick 1-6 winners from the room's live player list)
   Four visual modes. Winners are chosen up-front with an unbiased shuffle
   and the animation is then steered to them. Nothing here writes to the
   database: a draw only reads Room.list().
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
        laser: ["\u{1F52E}", "Chips swirl while a laser pulses to lock in each winner."]
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

    announce(name, rank) {
        const item = this.mk("div", "podium-item");
        item.setAttribute("role", "listitem");
        item.append(this.mk("span", "podium-rank", String(rank + 1)), this.mk("span", "podium-name", name));
        this.el.podium.appendChild(item);
        Sound.win();
    },

    /** Hands a finished selection round to the universal resolver (prize is house-funded, host only). */
    settleDraw(winners, participants, roundId, prizePool) {
        return resolveGameOutcome("draw:" + this.mode, { roundId, winners, participants, prizePool });
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
            await runner.call(this, names, winners, id);
            this.logDraw(winners);
            this.settleDraw(winners, names, `${this.mode}-${id}-${Date.now().toString(36)}`, prize);
            this.el.result.textContent = `\u{1F389} ${n === 1 ? "Winner" : "Winners"}: ${winners.join(", ")}`;
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
    }
};

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
        MAX: 6, IDLE: 45000, STAKES: [0, 10, 25, 50, 100, 250],
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
                const n = Tables.names(v.seats); if (n.length < 2 || !n.includes(me)) return;
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

/* =========================================================================
   PARQUÉS & DOMINOES (Casual & Party Games) — real-time multiplayer at rooms/<code>/parques and rooms/<code>/dominoes
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
        MAX: o.max, IDLE: 45000, STAKES: [0, 10, 25, 50, 100, 250], E: o.E,
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
                const n = Tables.names(v.seats); if (n.length < 2 || !n.includes(me)) return;
                return o.E.deal(v);
            });
        },
        /* --- turn actions: the engine validates and applies them inside the transaction; `auto` plays for an idle player --- */
        act(type, p, who) {
            const me = State.username, u = who || me, g0 = this.g; if (!this.ref || !me || g0.phase !== "play" || (g0.order || [])[g0.turn] !== u) return;
            this.ref.transaction((v) => {
                if (!v || v.phase !== "play" || v.order[v.turn] !== u) return; v.idle = v.idle || {};
                if (who && Date.now() - (v.turnAt || 0) < this.IDLE) return;
                const id = Date.now() + "-" + Math.floor(Math.random() * 1e6); let note;
                if (type === "auto") {
                    v.idle[u] = (v.idle[u] || 0) + 1;
                    if (v.idle[u] >= 3) { o.E.leave(v, u); const k = Tables.seatOf(v.seats, u); if (k) delete v.seats[k]; if (v.owner === u) v.owner = Tables.names(v.seats)[0] || ""; v.fx = null; note = `${u} was removed for inactivity`; }
                    else note = o.E.auto(v, u, id) || `${u} timed out`;
                } else { note = o.E.act(v, u, type, p, id); if (!note) return; }
                if (!who) v.idle[u] = 0; v.last = note; return v;
            }).catch(() => { });
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

/* =========================================================================
   PARQUÉS — 4 tokens each, 68-square ring (an 18x18 grid perimeter), 7-square home lane, centre target.
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
            const d = 1 + Math.floor(Math.random() * 6); g.die = d; g.turnAt = Date.now();
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

    const P = Object.assign(Party({ key: "parques", p: "pq", node: "parques", label: "Parqu\u00E9s", max: 4, E }), {
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
            const iv = window.setInterval(() => { this.face(1 + Math.floor(Math.random() * 6)); Sound.tone(300 + Math.random() * 200, 25, "square", 0.02); if (++n > 7) { window.clearInterval(iv); d.classList.remove("rolling"); this.face(v); } }, 90);
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

/* =========================================================================
   STRATEGY DUELS (Casual & Party Games) — Chess, Chinese Checkers, Color Code Breaker, Picas y Fijas
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

    /* ----------------- CODE BREAKERS: Color Code (Mastermind) + Picas y Fijas (Bulls & Cows) ----------------- */
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
                const h = g.gs[u] || [], cands = all.filter((c) => h.every((x) => { const r = fb(c, x.c); return r[0] === x.e && r[1] === x.p; }));
                const pick = h.length || !cfg.first ? cands[rnd(cands.length)] : cfg.first;
                return { type: "guess", p: { c: pick || all[0] } };
            },
            act(g, u, type, p, id) {
                if (type !== "guess" || !p || !valid(p.c)) return null;
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
            deal(v) { return mkGame(v, 2, (order) => { const sec = {}; order.forEach((u) => { sec[u] = secret(); }); return { sec, gs: {}, sv: {} }; }); }
        };
        E.auto = autoOf(E);
        return E;
    };
    const MME = CDE({ len: 4, sym: 6, dup: true, tries: 10, first: [0, 0, 1, 1], fija: "exact", pica: "colour-only" });
    const BCE = CDE({ len: 4, sym: 10, dup: false, tries: 10, fija: "fijas", pica: "picas" });
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

    /* --------------- CODE BREAKERS (shared UI): Color Code Breaker + Picas y Fijas --------------- */
    const codeUI = (G, cfg) => Object.assign(G, {
        cur: [],
        onNew() { this.cur = []; },
        setup() {
            const pal = $(cfg.p + "-pal");
            for (let v = 0; v < cfg.sym; v++) { const b = mk("button", cfg.kind === "col" ? `cd-peg c${v}` : "cd-key", cfg.kind === "col" ? "" : String(v)); b.type = "button"; b.dataset.v = v; b.setAttribute("aria-label", cfg.kind === "col" ? cfg.names[v] : "Digit " + v); b.addEventListener("click", () => this.push(v)); pal.appendChild(b); }
            $(cfg.p + "-back").addEventListener("click", () => { this.cur.pop(); this.cursor(); }); $(cfg.p + "-submit").addEventListener("click", () => { const c = this.cur.slice(); this.cur = []; this.act("guess", { c }); });
        },
        push(v) { const { my } = turnInfo(this.g); if (!my || this.cur.length >= cfg.len || (!cfg.dup && this.cur.includes(v))) return; this.cur.push(v); this.cursor(); },
        peg(v, cls) { return cfg.kind === "col" ? mk("span", `cd-peg sm c${v} ${cls || ""}`) : mk("span", "cd-dig " + (cls || ""), String(v)); },
        cursor() {
            const { my } = turnInfo(this.g), c = $(cfg.p + "-cur"); c.textContent = "";
            for (let i = 0; i < cfg.len; i++) { const s = this.cur[i] != null ? this.peg(this.cur[i], "fill") : mk("span", "cd-empty"); c.appendChild(s); }
            $(cfg.p + "-pal").querySelectorAll("button").forEach((b) => { b.disabled = !my || (!cfg.dup && this.cur.includes(+b.dataset.v)) || this.cur.length >= cfg.len; });
            $(cfg.p + "-submit").disabled = !my || this.cur.length !== cfg.len; $(cfg.p + "-back").disabled = !my || !this.cur.length; $(cfg.p + "-entry").hidden = !my;
        },
        view() {
            const g = this.g, { me, order, who } = turnInfo(g), fx = g.fx && g.fx.id !== this.lastFx && Date.now() - g.fx.at < 4000 ? g.fx : null, done = g.phase === "done", root = $(cfg.p + "-boards"); root.textContent = "";
            strip({ p: cfg.p, o: g }, who, (u) => `${(g.gs && g.gs[u] ? g.gs[u].length : 0)}/${cfg.tries} guesses`);
            (order.includes(me) ? [me].concat(order.filter((u) => u !== me)) : order).forEach((u) => {
                const box = mk("div", "cd-board" + (u === me ? " mine" : "")), h = (g.gs && g.gs[u]) || [];
                box.appendChild(mk("div", "bw-name", u === me ? "Your code attempts" : `${u}'s attempts`));
                if (done && g.sec) { const r = mk("div", "cd-row secret"); r.appendChild(mk("span", "cd-n", "\u2605")); const s = mk("span", "cd-slots"); g.sec[u].forEach((v) => s.appendChild(this.peg(v, "fill"))); r.appendChild(s); r.appendChild(mk("span", "cd-fb", "secret")); box.appendChild(r); }
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
            if (g.phase === "done" && g.res) m = resText(g, "cracked the code"); else if (my) m = cfg.hint; else if (live) m = `${who} is thinking\u2026`;
            $(cfg.p + "-status").textContent = m; $(cfg.p + "-log").textContent = g.last || ""; this.common(my); this.cursor();
        },
        playFx() {
            const fx = this.g.fx; if (!fx || fx.id === this.lastFx) return; const late = this.lastFx === null; this.lastFx = fx.id;
            if ((late && Date.now() - fx.at > 4000) || CardFX.reduced()) return;
            Sound.tone(300 + fx.ex * 90, 90, "triangle", 0.04); if (fx.ex === cfg.len) window.setTimeout(() => Sound.win(), 150); CardFX.until = performance.now() + 400;
        }
    });
    const MM = codeUI(Duel({ key: "mastermind", p: "mm", node: "mastermind", label: "Color Code Breaker", max: 2, E: MME, delay: 1100 }), { p: "mm", kind: "col", len: 4, sym: 6, dup: true, tries: 10, names: ["Ruby", "Gold", "Emerald", "Sapphire", "Amethyst", "Silver"], hint: "Your turn \u2014 build a 4-colour code. Gold pin = right colour & place, silver pin = right colour, wrong place." });
    const BC = codeUI(Duel({ key: "bullscows", p: "bc", node: "bullscows", label: "Picas y Fijas", max: 2, E: BCE, delay: 1100 }), { p: "bc", kind: "num", len: 4, sym: 10, dup: false, tries: 10, hint: "Your turn \u2014 enter 4 different digits. Fija = right digit, right place. Pica = right digit, wrong place." });

    [CH, CC, MM, BC].forEach((G) => G.init());
    { const s0 = Social.start, s1 = Social.stop; Social.start = function () { s0.call(Social);[CH, CC, MM, BC].forEach((G) => G.start()); }; Social.stop = function () { s1.call(Social);[CH, CC, MM, BC].forEach((G) => G.stop()); }; }
    document.addEventListener("game-changed", (e) => { [["chess", CH], ["checkers", CC], ["mastermind", MM], ["bullscows", BC]].forEach(([k, G]) => { if (e.detail.gameKey !== k && G.local) G.start(); }); });
})();

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

/* ---------- Knockout tournaments (host builds + reports; everyone watches live) ---------- */
const Tour = {
    d: null, pick: new Set(), game: "uno", prize: 0,
    GAMES: [["uno", "UNO"], ["parques", "Parqu\u00E9s"], ["dominoes", "Dominoes"], ["chess", "Chess"], ["checkers", "Chinese Checkers"], ["mastermind", "Color Code Breaker"], ["bullscows", "Picas y Fijas"], ["dice", "Quick Dice"]],
    rounds() { try { return JSON.parse(this.d.b); } catch (e) { return []; } },
    create() {
        const ents = [...this.pick].filter((u) => Room.exists(u)); if (ents.length < 2) return Notify.error("Pick at least 2 players.");
        const s = ents.slice().sort(() => Math.random() - 0.5); let n = 2; while (n < s.length) n *= 2;
        const r0 = []; for (let i = 0; i < n / 2; i++) r0.push({ a: s[i] || null, b: s[n - 1 - i] || null, w: null });
        const rs = [r0]; for (let m = n / 4; m >= 1; m /= 2) rs.push(Array.from({ length: m }, () => ({ a: null, b: null, w: null })));
        r0.forEach((m, i) => { if (!m.b) this.advance(rs, 0, i, m.a); });
        const prize = Math.min(50000, Math.max(0, Math.round(Number(this.prize) || 0)));
        zref("tour").set({ id: Date.now().toString(36), game: this.game, prize, ents: s, b: JSON.stringify(rs), champ: "" });
        Audit.log("tour", `Tournament created: ${GameResolver.label(this.game)}, ${s.length} players, prize ${fmt(prize)}`, prize); Sound.fanfare();
    },
    advance(rs, r, i, w) { rs[r][i].w = w; if (r + 1 < rs.length) rs[r + 1][i >> 1][i % 2 ? "b" : "a"] = w; },
    report(r, i, w) {
        if (!State.isHost || !this.d || this.d.champ) return;
        zref("tour").transaction((v) => {
            if (!v || v.champ) return; const rs = JSON.parse(v.b), m = rs[r][i]; if (m.w || (w !== m.a && w !== m.b)) return;
            this.advance(rs, r, i, w); v.b = JSON.stringify(rs); if (r === rs.length - 1) v.champ = w; return v;
        }, (e, ok, snap) => {
            if (!ok) return; const v = snap.val(); Sound.chip();
            if (v.champ) { Audit.log("tour", `${v.champ} won the tournament (prize ${fmt(v.prize)})`, v.prize); Sound.fanfare(); Fx.celebrate(); resolveGameOutcome("tournament", { roundId: v.id, winners: [v.champ], prizePool: v.prize }); }
        }, false);
    },
    on(v) {
        this.d = v; const me = State.username;
        if (v && v.champ === me) zref("tour/ack/" + me).transaction((x) => (x ? undefined : true), (e, ok) => { if (ok) Ach.bump({ champ: 1 }); }, false);
        this.paint();
    },
    paint() {
        const box = $z("z-tour"); if (!box || box.contains(document.activeElement) && document.activeElement.tagName === "INPUT") return;
        const names = Room.list().map((p) => p.username).filter(Boolean).sort(), d = this.d, host = State.isHost, now = Date.now();
        if (!this.pick.size && !this._seeded && names.length) { names.forEach((u) => { if (now - ((Room.get(u) || {}).updatedAt || 0) < 30 * 60000) this.pick.add(u); }); this._seeded = true; }
        let h = "";
        if (host) h += `<div class="px-row" style="flex-wrap:wrap"><b>Set up bracket</b><select id="z-t-game">${this.GAMES.map(([k, l]) => `<option value="${k}" ${k === this.game ? "selected" : ""}>${l}</option>`).join("")}</select><label>Prize <input type="number" id="z-t-prize" min="0" max="50000" value="${this.prize}" style="width:6rem"></label></div>
           <div class="mx-players">${names.map((n) => `<label><input type="checkbox" data-t="${esc(n)}" ${this.pick.has(n) ? "checked" : ""}> ${esc(n)}</label>`).join("")}</div>
           <button type="button" class="btn btn-primary btn-block" id="z-t-go" style="margin:.6rem 0">${d ? "Replace with new bracket" : "Create knockout bracket"} (${this.pick.size})</button>`;
        else if (!d) h += `<p class="mx-hint">No tournament yet. The host can build one from the active players.</p>`;
        if (d) {
            const rs = this.rounds(), lbl = (i) => (i === rs.length - 1 ? "Final" : i === rs.length - 2 ? "Semifinal" : "Round " + (i + 1));
            h += `<div class="z-tmeta"><b>${esc(GameResolver.label(d.game))} knockout</b><span>Prize ${fmt(d.prize)}</span>${d.champ ? `<span class="z-champ">\u{1F451} ${esc(d.champ)}</span>` : "<span>In progress</span>"}</div>
             <div class="z-bracket">${rs.map((r, ri) => `<div class="z-col"><small>${lbl(ri)}</small>${r.map((m, mi) => `<div class="z-match">${["a", "b"].map((s) => `<button type="button" class="z-slot ${m.w && m.w === m[s] ? "win" : m.w ? "out" : ""}" ${host && !m.w && m.a && m.b && !d.champ ? `data-r="${ri}" data-i="${mi}" data-w="${esc(m[s] || "")}"` : "disabled"}>${esc(m[s] || (ri === 0 ? "BYE" : "\u2014"))}</button>`).join("")}</div>`).join("")}</div>`).join("")}</div>
             ${host ? `<p class="mx-hint">Play each match in ${esc(GameResolver.label(d.game))}, then tap the winner to advance them. The champion receives the prize automatically.</p><button type="button" class="btn btn-ghost btn-small" id="z-t-clear">Cancel tournament</button>` : ""}`;
        }
        box.innerHTML = h;
    },
    init() {
        const box = $z("z-tour");
        box.addEventListener("click", (e) => {
            const t = e.target.closest("button"); if (!t) return;
            if (t.id === "z-t-go") this.create(); else if (t.id === "z-t-clear") { zref("tour").remove(); Audit.log("tour", "Tournament cancelled"); }
            else if (t.dataset.w) this.report(+t.dataset.r, +t.dataset.i, t.dataset.w);
        });
        box.addEventListener("change", (e) => {
            const t = e.target; if (t.dataset.t) { t.checked ? this.pick.add(t.dataset.t) : this.pick.delete(t.dataset.t); this.paint(); }
            else if (t.id === "z-t-game") this.game = t.value; else if (t.id === "z-t-prize") this.prize = t.value;
        });
        PubSub.on("players-updated", () => this.paint());
    }
};
