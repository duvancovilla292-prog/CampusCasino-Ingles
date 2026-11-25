/* CASINO CAMPUS — Hangman.
   Classic <script> (not an ES module): top-level consts are shared with the other files
   through the page's global scope, so the load order in index.html matters. */
"use strict";

/* =========================================================================
   HANGMAN (Casual & Party Games) — real-time multiplayer at rooms/<code>/hangman
   Uses the shared Party table flow (lobby -> optional stake -> match -> settlement) like UNO / Connect Four.
   Rules:
     - The secret word comes from the SYSTEM (themed word bank) or from a player acting as WORD MASTER
       (the table driver locks in a custom word + optional hint; the master sits out the guessing).
     - Guessers take turns in order, one action per turn: guess a LETTER, or SOLVE the whole word
       (a wrong solve costs 2 mistakes). The whole table shares one gallows: when the drawing completes, the word wins.
     - Optional chips: every seated player pays the stake into the pot. Each correct letter pays its guesser a BOUNTY
       out of the pot (capped at 60% of the pot so the finish is always worth something). Whoever completes the word
       (last letter or a correct solve) takes whatever is left. If the gallows wins, the Word Master takes the rest;
       with a system word the rest is split among the remaining guessers (a near-refund).
   NOTE: like the code-breaker games, the secret lives in the shared match state (lightly obfuscated, NOT secure) —
   this is a serverless casual game, so it is intended for friendly play.
   ========================================================================= */
(() => {
    const $ = pt$, mk = ptMk, MAX = 6, PARTS = 10, KEY = "hangman";
    const LIVES = [6, 8, 10], BOUNTIES = [0, 5, 10, 25], BOUNTY_CAP = 0.6;
    const ROWS = ["QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM"];

    /* ------------------------------ word bank (A–Z and single spaces only) ------------------------------ */
    const THEMES = {
        "Animals": ["ELEPHANT", "GIRAFFE", "PENGUIN", "DOLPHIN", "KANGAROO", "CHEETAH", "OCTOPUS", "FLAMINGO", "CROCODILE", "HEDGEHOG", "BUTTERFLY", "SQUIRREL", "PORCUPINE", "CHAMELEON", "PEACOCK", "GORILLA", "LEOPARD", "SEAHORSE", "PLATYPUS", "WOODPECKER"],
        "Food & Drink": ["SPAGHETTI", "CHOCOLATE", "PANCAKES", "AVOCADO", "BROCCOLI", "DUMPLING", "CROISSANT", "LASAGNA", "BURRITO", "PINEAPPLE", "MUSHROOM", "WATERMELON", "CHEESECAKE", "GUACAMOLE", "TIRAMISU", "EMPANADA", "SANDWICH", "STRAWBERRY", "CINNAMON", "MEATBALLS"],
        "Geography": ["COLOMBIA", "AUSTRALIA", "ARGENTINA", "SWITZERLAND", "PORTUGAL", "VIETNAM", "MOROCCO", "NORWAY", "ICELAND", "SINGAPORE", "MEXICO", "EGYPT", "CANADA", "BRAZIL", "THAILAND", "NEW ZEALAND", "SOUTH AFRICA", "COSTA RICA", "AMAZON RIVER", "MOUNT EVEREST"],
        "Casino": ["JACKPOT", "ROULETTE", "BLACKJACK", "CROUPIER", "POKER FACE", "ROYAL FLUSH", "SLOT MACHINE", "HIGH ROLLER", "LUCKY SEVEN", "WILD CARD", "GOLDEN CHIP", "BEGINNERS LUCK", "SNAKE EYES", "ALL IN", "FULL HOUSE", "PAIR OF ACES", "CRAPS", "BACCARAT", "CHIP STACK", "DEALER"],
        "Campus Life": ["LIBRARY", "PROFESSOR", "SEMESTER", "LECTURE", "SCHOLARSHIP", "CAFETERIA", "HOMEWORK", "GRADUATION", "DORMITORY", "LABORATORY", "CLASSMATE", "TEXTBOOK", "DEADLINE", "FINAL EXAM", "STUDY GROUP", "FRESHMAN", "CAMPUS TOUR", "THESIS", "SEMINAR", "DIPLOMA"],
        "Technology": ["JAVASCRIPT", "DATABASE", "ALGORITHM", "FIREWALL", "BROWSER", "KEYBOARD", "COMPILER", "NETWORK", "PASSWORD", "FRAMEWORK", "BANDWIDTH", "VARIABLE", "SERVER", "CLOUD STORAGE", "OPEN SOURCE", "MACHINE LEARNING", "PIXEL", "BACKEND", "REPOSITORY", "BLUETOOTH"],
        "Sports": ["BASKETBALL", "GOALKEEPER", "MARATHON", "VOLLEYBALL", "SWIMMING", "CYCLING", "GYMNASTICS", "PENALTY KICK", "WORLD CUP", "HOME RUN", "TOUCHDOWN", "BADMINTON", "SKATEBOARD", "TRIATHLON", "ARCHERY", "SNOWBOARD", "HAT TRICK", "OFFSIDE", "WEIGHTLIFTING", "TABLE TENNIS"]
    };
    const THEME_KEYS = Object.keys(THEMES);

    /* ------------------------------ pure helpers ------------------------------ */
    const rnd = (n) => Math.floor(Rng.float() * n);
    /** Uppercases, strips accents (Ñ -> N), keeps A–Z and single spaces. */
    const clean = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z]+/g, " ").trim();
    const wordOk = (w) => w.length >= 3 && w.length <= 24 && (w.match(/[A-Z]/g) || []).length >= 3 && w.split(" ").length <= 4;
    const enc = (w) => window.btoa(w.split("").reverse().join(""));
    const dec = (s) => { try { return window.atob(String(s || "")).split("").reverse().join(""); } catch (e) { return ""; } };
    const maskOf = (w, gs) => w.split("").map((c) => (c === " " ? " " : gs.includes(c) ? c : "_")).join("");
    /** Drawing stage 0..PARTS for `wr` mistakes out of `lv` allowed (so 6/8/10 lives all end with a complete drawing). */
    const stageOf = (wr, lv) => Math.min(PARTS, Math.ceil((wr * PARTS) / lv));

    /* ------------------------------ rules engine (runs inside Firebase transactions) ------------------------------ */
    const HME = (() => {
        const advance = (g) => { g.turn = (g.turn + 1) % g.order.length; g.turnAt = Date.now(); };
        const bounty = (g) => Math.max(0, Math.min((g.cfg && g.cfg.bty) || 0, Math.floor((g.pot || 0) * BOUNTY_CAP) - (g.pd || 0)));
        const split = (pay, list, rem) => { if (!list.length || rem <= 0) return; const s = Math.floor(rem / list.length); list.forEach((u, i) => { pay[u] = (pay[u] || 0) + s + (i === 0 ? rem - s * list.length : 0); }); };
        /** Ends the match and computes every player's final payout. The payouts always add up to (at most) the pot. */
        const settle = (g, kind, who, why) => {
            const word = dec(g.sec), rem = Math.max(0, (g.pot || 0) - (g.pd || 0)), pay = Object.assign({}, g.pay || {}), alive = (g.order || []).slice();
            let v = [];
            if (kind === "win") { pay[who] = (pay[who] || 0) + rem; v = [who]; }
            else if (kind === "fail") { if (g.master) { pay[g.master] = (pay[g.master] || 0) + rem; v = [g.master]; } else split(pay, alive, rem); }
            else if (kind === "gone") { split(pay, alive, rem); v = alive; }
            else if (kind === "empty") { if (g.master) { pay[g.master] = (pay[g.master] || 0) + rem; v = [g.master]; } }
            g.rv = maskOf(word, word);
            g.phase = "done"; g.turnAt = Date.now();
            g.res = { kind, who: who || "", ws: v.length ? v : alive, v, pot: g.pot || 0, why: why || "", word, pay, left: 0 };
        };
        const E = {
            THEMES, LIVES, BOUNTIES,
            deal(v) {
                const cfg = v.cfg || {}, names = Tables.names(v.seats).slice(0, MAX), bet = v.bet || 0, rot = (v.rot || 0) + 1;
                let master = "", word = "", theme = "";
                const sec = cfg.mode === "master" && cfg.sec ? clean(dec(cfg.sec)) : "";
                if (sec && wordOk(sec) && names.includes(cfg.master) && names.length >= 2) {
                    master = cfg.master; word = sec; theme = String(cfg.hint || "").slice(0, 24) || (THEMES[cfg.theme] ? cfg.theme : "Secret word");
                } else {
                    const k = THEMES[cfg.theme] ? cfg.theme : THEME_KEYS[rnd(THEME_KEYS.length)]; word = THEMES[k][rnd(THEMES[k].length)]; theme = k;
                }
                const guessers = names.filter((n) => n !== master), order = guessers.map((_, i) => guessers[(i + rot) % guessers.length]);
                const lv = LIVES.includes(cfg.lv) ? cfg.lv : 6, bty = bet && BOUNTIES.includes(cfg.bty) ? cfg.bty : 0;
                const g = {
                    seats: v.seats, owner: v.owner, max: v.max, rot, bet, phase: "play", hid: Date.now(), order, turn: 0, in: {}, pot: bet * names.length,
                    turnAt: Date.now(), fx: null, res: null, sec: enc(word), rv: maskOf(word, ""), gs: "", wr: 0, th: theme, master, st: {}, pay: {}, pd: 0,
                    cfg: { mode: master ? "master" : "system", theme: cfg.theme || "", hint: master ? String(cfg.hint || "").slice(0, 24) : "", lv, bty }
                };
                names.forEach((u) => { g.in[u] = bet; });
                return g;
            },
            act(g, u, type, p, id) {
                if (g.phase !== "play" || g.order[g.turn] !== u) return null;
                const word = dec(g.sec); if (!word) return null;
                const lv = (g.cfg && g.cfg.lv) || 6; g.gs = g.gs || ""; g.pay = g.pay || {}; g.st = g.st || {}; g.pd = g.pd || 0;
                const st = (g.st[u] = g.st[u] || { h: 0, m: 0 });
                if (type === "guess") {
                    const ch = String((p && p.ch) || "").toUpperCase(); if (!/^[A-Z]$/.test(ch) || g.gs.includes(ch)) return null;
                    g.gs += ch;
                    if (word.includes(ch)) {
                        const n = word.split(ch).length - 1, b = bounty(g); st.h++; g.rv = maskOf(word, g.gs);
                        g.fx = { id, at: Date.now(), u, ch, hit: 1 };
                        if (b) { g.pay[u] = (g.pay[u] || 0) + b; g.pd += b; }
                        const note = `${u} found ${n}\u00D7 \u201C${ch}\u201D${b ? ` (+${b} chips)` : ""}`;
                        if (!g.rv.includes("_")) { settle(g, "win", u, "completed the word"); return note + " \u2014 word complete!"; }
                        advance(g); return note;
                    }
                    st.m++; g.wr = (g.wr || 0) + 1; g.fx = { id, at: Date.now(), u, ch, hit: 0 };
                    const note = `${u} guessed \u201C${ch}\u201D \u2014 not in the word`;
                    if (g.wr >= lv) { settle(g, "fail", null, "the drawing is complete"); return note + " \u2014 the drawing is complete!"; }
                    advance(g); return note;
                }
                if (type === "solve") {
                    const w = clean(p && p.w); if (!w || w.length > 24) return null;
                    if (w === word) {
                        st.h++; g.fx = { id, at: Date.now(), u, ch: "*", hit: 1, solve: 1 };
                        settle(g, "win", u, "solved the word"); return `${u} solved it!`;
                    }
                    st.m++; g.wr = Math.min(lv, (g.wr || 0) + 2); g.fx = { id, at: Date.now(), u, ch: "*", hit: 0, solve: 1 };
                    const note = `${u} tried to solve \u2014 wrong (+2 mistakes)`;
                    if (g.wr >= lv) { settle(g, "fail", null, "the drawing is complete"); return note + " \u2014 the drawing is complete!"; }
                    advance(g); return note;
                }
                return null;
            },
            /** Idle player: the turn is simply skipped (Party removes players after 3 idle strikes). */
            auto(g, u) { if (g.phase !== "play" || g.order[g.turn] !== u) return null; g.fx = null; advance(g); return `${u} ran out of time \u2014 turn skipped`; },
            /** A guesser leaves (or is removed): the match carries on unless nobody is left; the master leaving hands the win to the guessers. */
            leave(g, u) {
                if (g.phase !== "play") return false;
                if (u === g.master) { settle(g, "gone", null, "the Word Master left"); return true; }
                const i = g.order.indexOf(u); if (i < 0) return false;
                g.order.splice(i, 1);
                if (!g.order.length) { settle(g, "empty", null, "every guesser left"); return true; }
                if (i < g.turn) g.turn--; if (g.turn >= g.order.length) g.turn = 0; g.turnAt = Date.now(); return true;
            }
        };
        return E;
    })();

    /* ------------------------------ table UI ------------------------------ */
    const HM = Party({ key: KEY, p: "hm", node: "hangman", label: "Hangman", max: MAX, E: HME });
    const B = { deal: HM.deal, again: HM.again, render: HM.render, common: HM.common };
    Object.assign(HM, {
        prevRv: null, prevStage: 0, snd: null,
        onNew() { this.prevRv = null; this.prevStage = 0; },
        setup() {
            /* gallows drawing (stroke-only SVG; parts are revealed by stage) */
            const S = "http://www.w3.org/2000/svg";
            $("hm-gallows").innerHTML = `<svg viewBox="0 0 220 260" xmlns="${S}" focusable="false">
                <g class="hm-frame"><path d="M20 244H140M60 244V30H150M60 72L102 30M150 30V60" pathLength="1"/></g>
                <g class="hm-p" data-s="1"><circle cx="150" cy="80" r="20" pathLength="1"/></g>
                <g class="hm-p" data-s="2"><path d="M150 100V165" pathLength="1"/></g>
                <g class="hm-p" data-s="3"><path d="M150 116L122 146" pathLength="1"/></g>
                <g class="hm-p" data-s="4"><path d="M150 116L178 146" pathLength="1"/></g>
                <g class="hm-p" data-s="5"><path d="M150 165L126 208" pathLength="1"/></g>
                <g class="hm-p" data-s="6"><path d="M150 165L174 208" pathLength="1"/></g>
                <g class="hm-p" data-s="7"><path d="M139 73l7 7M146 73l-7 7M154 73l7 7M161 73l-7 7" pathLength="1"/></g>
                <g class="hm-p" data-s="8"><path d="M141 91Q150 83 159 91" pathLength="1"/></g>
                <g class="hm-p" data-s="9"><circle cx="120" cy="148" r="4" pathLength="1"/><circle cx="180" cy="148" r="4" pathLength="1"/></g>
                <g class="hm-p" data-s="10"><path d="M112 210H128M172 210H188" pathLength="1"/></g>
            </svg>`;
            /* letter keyboard */
            const keys = $("hm-keys");
            ROWS.forEach((r) => {
                const row = mk("div", "hm-keyrow");
                r.split("").forEach((ch) => { const b = mk("button", "hm-key", ch); b.type = "button"; b.dataset.k = ch; b.setAttribute("aria-label", "Guess letter " + ch); b.addEventListener("click", () => this.guess(ch)); row.appendChild(b); });
                keys.appendChild(row);
            });
            document.addEventListener("keydown", (e) => {
                if (Router.currentGameKey !== KEY || e.ctrlKey || e.metaKey || e.altKey || !/^[a-zA-Z]$/.test(e.key)) return;
                const t = e.target; if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
                this.guess(e.key.toUpperCase());
            });
            /* solve box */
            $("hm-solve-btn").addEventListener("click", () => this.solve());
            $("hm-solve-in").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); this.solve(); } });
            /* host / word master set-up panel (static controls so typing is never wiped by a live re-render) */
            $("hm-src").addEventListener("change", (e) => this.setCfg(e.target.value === "master" ? { mode: "master" } : { mode: "system", sec: null, master: null, n: null, hint: null }));
            $("hm-theme-sel").addEventListener("change", (e) => this.setCfg({ theme: e.target.value }));
            $("hm-lives").addEventListener("change", (e) => this.setCfg({ lv: +e.target.value }));
            $("hm-bounty").addEventListener("change", (e) => this.setCfg({ bty: +e.target.value }));
            $("hm-hint").addEventListener("change", (e) => this.setCfg({ hint: e.target.value.trim().slice(0, 24) }));
            $("hm-lock").addEventListener("click", () => this.lock());
            $("hm-clear").addEventListener("click", () => this.setCfg({ sec: null, master: null, n: null }));
            $("hm-secret").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); this.lock(); } });
            $("hm-reveal").addEventListener("click", () => { const i = $("hm-secret"), show = i.type === "password"; i.type = show ? "text" : "password"; $("hm-reveal").textContent = show ? "Hide" : "Show"; });
        },
        /* --- lobby configuration (table driver only; stored at rooms/<code>/hangman/cfg) --- */
        setCfg(patch) {
            const me = State.username; if (!this.ref || !me) return Promise.resolve(null);
            return this.ref.transaction((v) => {
                if (!Tables.isOpen(v) || v.phase !== "lobby" || !Tables.canDrive(v, me)) return;
                const c = Object.assign({}, v.cfg || {});
                Object.keys(patch).forEach((k) => { if (patch[k] === null || patch[k] === "" || patch[k] === undefined) delete c[k]; else c[k] = patch[k]; });
                v.cfg = c; return v;
            }).catch(() => { Notify.error("Could not save Hangman settings. Please try again."); return null; });
        },
        async lock() {
            const w = clean($("hm-secret").value);
            if (!wordOk(w)) return Notify.warning("Use 3\u201324 letters (A\u2013Z, up to 4 words) for the secret word.");
            const result = await this.setCfg({ mode: "master", sec: enc(w), master: State.username, n: w.replace(/ /g, "").length });
            if (!result?.committed) return Notify.warning("The word was not locked. Check that you still control the table.");
            $("hm-secret").value = ""; $("hm-secret").type = "password"; $("hm-reveal").textContent = "Show";
            Notify.success("Secret word locked in — you will be the Word Master.");
        },
        deal() {
            const c = this.g.cfg || {};
            if (c.mode === "master" && !c.sec) return Notify.warning("Lock in a secret word first, or switch the word source to \u201CSystem word\u201D.");
            if (c.mode === "master" && c.master && !Tables.names(this.g.seats).includes(c.master)) return Notify.warning(`${c.master} set the secret word but is no longer seated. Clear the word or switch to the system word.`);
            B.deal.call(this);
        },
        /** Back to the lobby keeping the table settings (the custom word is consumed). */
        again() {
            const me = State.username; if (!this.ref) return;
            this.ref.transaction((v) => {
                if (!Tables.isOpen(v) || v.phase !== "done" || !Tables.canDrive(v, me)) return;
                const c = Object.assign({}, v.cfg || {}); delete c.sec; delete c.master; delete c.n; delete c.hint; c.mode = "system";
                const n = { phase: "lobby", owner: v.owner, seats: v.seats, max: v.max, rot: v.rot || 0, bet: v.bet || 0, hid: Date.now(), turnAt: Date.now(), cfg: c };
                return n;
            });
        },
        /* --- player actions --- */
        guess(ch) {
            const g = this.g, order = g.order || [];
            if (g.phase !== "play" || order[g.turn] !== State.username || (g.gs || "").includes(ch)) return;
            this.act("guess", { ch });
        },
        solve() {
            const g = this.g, order = g.order || [], inp = $("hm-solve-in");
            if (g.phase !== "play" || order[g.turn] !== State.username) return;
            const w = clean(inp.value), len = (g.rv || "").length;
            if (!w) return Notify.warning("Type your answer first.");
            if (w.length !== len) return Notify.warning(`The answer has ${len} characters (spaces count).`);
            if (!window.confirm("A wrong answer costs 2 mistakes and ends your turn. Submit?")) return;
            inp.value = ""; this.act("solve", { w });
        },
        /* --- chips: every seat pays the stake once; payouts come from the settled pot (bounties + finish) --- */
        sync() {
            const g = this.g, me = State.username; if (!me || !g.hid || !g.in) return;
            const pk = `${KEY}-paid-${Room.code}-${g.hid}-${me}`;
            if (this.hid !== g.hid) { this.hid = g.hid; this.paid = Number(this.store(pk)) || 0; }
            const owed = (g.in[me] || 0) - this.paid;
            if (owed > 0) { State.debit(Math.min(owed, State.balance)); this.paid += owed; this.store(pk, String(this.paid)); }
            if (g.phase !== "done" || !g.res) return;
            const dk = `${KEY}-done-${Room.code}-${g.hid}-${me}`; if (this.store(dk)) return; this.store(dk, "1");
            const r = g.res, payout = Math.max(0, Math.floor((r.pay || {})[me] || 0)), won = (r.v || []).includes(me);
            if (this.paid > 0) resolveGameOutcome(KEY, { roundId: g.hid + "-" + me, entries: [{ wager: this.paid, payout }] });
            if (won) { Effects.celebrate(`Hangman! You win${payout ? " " + payout + " chips" : ""}!`); BW.sparkle(); Notify.success(payout ? `You collected ${payout} chips!` : "You won the round!"); }
            else if (payout > 0) Notify.success(`You collected ${payout} chips.`);
        },
        /* --- rendering --- */
        render() {
            B.render.call(this); this.setupUi();
        },
        setupUi() {
            const g = this.g, me = State.username, box = $("hm-setup"), live = g.phase === "play" || (g.phase === "done" && !!g.res);
            const show = Tables.isOpen(g) && !live; box.hidden = !show; if (!show) return;
            const can = g.phase === "lobby" && Tables.canDrive(g, me), c = g.cfg || {}, isM = c.mode === "master", bet = g.bet || 0;
            const put = (id, val) => { const e = $(id); if (document.activeElement !== e) e.value = val; e.disabled = !can; return e; };
            put("hm-src", isM ? "master" : "system"); put("hm-theme-sel", THEMES[c.theme] ? c.theme : ""); put("hm-lives", String(LIVES.includes(c.lv) ? c.lv : 6));
            const bs = put("hm-bounty", String(bet ? (BOUNTIES.includes(c.bty) ? c.bty : 0) : 0)); bs.disabled = !can || !bet;
            put("hm-hint", c.hint || "");
            $("hm-row-master").hidden = !isM; $("hm-secret").disabled = !can; $("hm-lock").disabled = !can; $("hm-reveal").disabled = !can;
            $("hm-clear").hidden = !(isM && c.sec && can);
            const msg = [];
            if (isM) msg.push(c.sec ? `\u{1F512} Secret word locked by ${c.master} (${c.n || "?"} letters). ${c.master === me ? "You will be the Word Master and sit out the guessing." : `${c.master} will be the Word Master.`}` : "Type a secret word and press \u201CLock in word\u201D.");
            else msg.push(`System word \u2014 ${THEMES[c.theme] ? c.theme : "random theme"}.`);
            msg.push(`${LIVES.includes(c.lv) ? c.lv : 6} mistakes allowed.`);
            msg.push(bet ? (c.bty ? `Bounty: ${c.bty} chips per correct letter (from the pot, max ${Math.round(BOUNTY_CAP * 100)}%).` : "No letter bounty.") : "Set a table stake to enable letter bounties.");
            if (!can) msg.push("Only the table host can change these settings.");
            $("hm-setup-msg").textContent = msg.join(" ");
        },
        view() {
            const g = this.g, me = State.username, order = g.order || [], live = g.phase === "play", who = live ? order[g.turn] : null, my = live && who === me;
            const lv = (g.cfg && g.cfg.lv) || 6, wr = Math.min(g.wr || 0, lv), stg = stageOf(wr, lv), rv = g.rv || "", gs = g.gs || "", done = g.phase === "done";
            const word = g.sec ? dec(g.sec) : "", isMaster = !!g.master && g.master === me;
            /* players strip */
            const strip = $("hm-players"); strip.textContent = ""; const vs = (g.res && g.res.v) || [], pay = (g.res && g.res.pay) || g.pay || {};
            const seat = (u, i, sub) => { const d = mk("div", `bw-seat pq-pl pk${i % 4}` + (u === who ? " turn" : "") + (vs.includes(u) ? " win" : "")); d.appendChild(mk("div", "bw-name", (u === who ? "\u25B6 " : "") + u + (u === me ? " (you)" : ""))); d.appendChild(mk("div", "bw-info", sub)); strip.appendChild(d); };
            if (g.master) seat(g.master, 3, "\u{1F3A9} Word Master" + (pay[g.master] && done ? ` \u00B7 +${pay[g.master]}` : ""));
            order.forEach((u, i) => { const s = (g.st || {})[u] || { h: 0, m: 0 }, p = pay[u] || 0; seat(u, i, `\u2714 ${s.h}  \u2716 ${s.m}` + (p ? `  \u00B7 +${p} chips` : "")); });
            /* gallows */
            const parts = $("hm-gallows").querySelectorAll(".hm-p");
            parts.forEach((p) => { const n = +p.dataset.s, on = n <= stg; p.classList.toggle("on", on); p.classList.toggle("fresh", on && n > this.prevStage && !CardFX.reduced()); });
            $("hm-gallows").classList.toggle("dead", g.res ? g.res.kind === "fail" : stg >= PARTS);
            this.prevStage = stg;
            /* secret word slots */
            const wd = $("hm-word"); wd.textContent = ""; const prev = this.prevRv;
            rv.split("").forEach((c, i) => {
                if (c === " ") { wd.appendChild(mk("span", "hm-slot sp")); return; }
                const hidden = c === "_", s = mk("span", "hm-slot" + (hidden ? "" : " on") + (!hidden && prev && prev[i] === "_" && !CardFX.reduced() ? " pop" : "") + (!hidden && g.res && g.res.kind === "fail" && !gs.includes(c) ? " miss" : ""), hidden ? "" : c);
                if (hidden && isMaster && live && word[i]) { s.classList.add("peek"); s.textContent = word[i]; }
                wd.appendChild(s);
            });
            wd.setAttribute("aria-label", "Secret word: " + rv.replace(/_/g, "blank "));
            this.prevRv = rv;
            /* side info */
            $("hm-theme").textContent = g.th ? `Theme \u00B7 ${g.th}` : "";
            const m = $("hm-meter"); m.textContent = ""; m.appendChild(mk("span", "hm-meter-l", `Mistakes ${wr} / ${lv}`)); const pips = mk("span", "hm-pips");
            for (let i = 0; i < lv; i++) pips.appendChild(mk("i", i < wr ? "x" : "")); m.appendChild(pips);
            const wrong = gs.split("").filter((c) => !rv.includes(c)); $("hm-wrong").textContent = wrong.length ? "Missed: " + wrong.join(" ") : "No misses yet";
            /* keyboard + solve box */
            $("hm-keys").querySelectorAll(".hm-key").forEach((k) => { const ch = k.dataset.k, used = gs.includes(ch), hit = used && rv.includes(ch); k.classList.toggle("hit", hit); k.classList.toggle("miss", used && !hit); k.disabled = !my || used; });
            $("hm-solve").hidden = !(live && order.includes(me)); $("hm-solve-in").disabled = !my; $("hm-solve-btn").disabled = !my;
            $("hm-solve-in").maxLength = 24;
        },
        controls() {
            const g = this.g, me = State.username, order = g.order || [], live = g.phase === "play", who = live ? order[g.turn] : null, my = live && who === me, r = g.res;
            let m = "";
            if (g.phase === "done" && r) {
                const word = r.word || "", pot = r.pot ? ` Pot ${r.pot} chips.` : "";
                if (r.kind === "win") m = `${r.who} ${r.why}! The word was ${word}.${pot}`;
                else if (r.kind === "fail") m = `The gallows wins \u2014 the word was ${word}.${r.v.length ? ` ${r.v[0]} (Word Master) takes the remaining pot.` : pot ? " Remaining pot is shared among the guessers." : ""}`;
                else if (r.kind === "gone") m = `${r.why} \u2014 guessers win. The word was ${word}.${pot}`;
                else m = `${r.why}. The word was ${word}.${pot}`;
            } else if (my) m = "Your turn \u2014 pick a letter, or try to solve the whole word.";
            else if (live && g.master === me) m = `You are the Word Master \u2014 ${who} is guessing. Your secret word is shown faintly under the blanks.`;
            else if (live) m = `${who} is choosing a letter\u2026`;
            $("hm-status").textContent = m; $("hm-log").textContent = g.last || "";
            this.common(my);
            const live2 = $("hm-live"), won = r ? (r.v || []).includes(me) : false, played = order.includes(me) || g.master === me;
            const out = g.phase === "done" && r && played ? (won ? "win" : "lose") : ""; live2.dataset.res = out;
            if (out && this.snd !== g.hid) { this.snd = g.hid; if (out === "lose") { Sound.lose(); Notify.warning(r.kind === "fail" && !g.master ? "The gallows won this round." : "You lost this round."); } }
        },
        common(my) {
            B.common.call(this, my); const g = this.g;
            const left = Math.max(0, (g.pot || 0) - (g.pd || 0)), b = (g.cfg && g.cfg.bty) || 0;
            $("hm-pot").textContent = g.bet ? `Pot ${left.toLocaleString("en-US")} left of ${(g.pot || 0).toLocaleString("en-US")} \u00B7 stake ${g.bet}${b ? ` \u00B7 +${b} per correct letter` : ""}` : "Friendly match";
        },
        playFx() {
            const g = this.g, fx = g.fx; if (!fx || fx.id === this.lastFx) return;
            const late = this.lastFx === null; this.lastFx = fx.id;
            if ((late && Date.now() - fx.at > 4000) || CardFX.reduced() || Router.currentGameKey !== KEY) return;
            if (fx.hit) { Sound.tone(520, 110, "triangle", 0.05); window.setTimeout(() => Sound.tone(780, 140, "triangle", 0.05), 110); }
            else Sound.tone(160, 280, "sawtooth", 0.05);
            if (g.phase === "done" && g.res) window.setTimeout(() => { if ((g.res.v || []).includes(State.username)) Sound.win(); }, 450);
            CardFX.until = performance.now() + 700;
        }
    });

    HM.init();
    { const s0 = Social.start, s1 = Social.stop; Social.start = function () { s0.call(Social); HM.start(); }; Social.stop = function () { s1.call(Social); HM.stop(); }; }
})();
