/* CASINO CAMPUS — Player Wheel.
   Classic <script> (not an ES module): top-level consts are shared with the other files
   through the page's global scope, so the load order in index.html matters. */
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
