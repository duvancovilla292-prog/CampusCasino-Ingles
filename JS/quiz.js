/* =========================================================================
 * Classroom Quiz (Tools > Quiz / Live Questions)
 * -------------------------------------------------------------------------
 * Classic script, loaded before admin-panel.js.
 *  - Data lives at rooms/<code>/quiz = { questions: {id: {...}}, live: {...} }.
 *  - UI permissions follow AdminCtl; server enforcement requires Firebase
 *    Auth / database rules (client checks alone cannot stop a determined user).
 *  - Bank edits never change the published snapshot until "Present" is pressed.
 *  - Every write is a Firebase transaction, so bank edits, presentations and
 *    deletions are serialized and stale controls can never hit a newer question.
 *
 * Bank order: each question may carry a numeric `order` (assigned on save / import). Records without it
 * (created by older versions) come first, in creation order; ordered ones follow. Previous / Next walk this
 * order, so the sequence is identical for every device and survives export -> import of data.json.
 *
 * Question types (stored in rooms/<code>/quiz/questions/<id>, always with prompt + `order`):
 *   choice (no `type` field, the original format) { options[], correctIndex }
 *   order  { type:"order", fragments[] }            fragments are stored in the CORRECT order, shown shuffled
 *   text   { type:"text", answers[], caseSensitive } free text / fill in the blank
 *
 * Settings (rooms/<code>/quiz/settings): { autoLaunch, answerBy:"player"|"admin", seconds, chain }.
 *
 * Turns (live.turn, only when a question is asked to specific players):
 *   turn = { queue[], at, seconds, deadline, by, started, log[], done, winner }
 *   - The player at queue[at] answers from their own device (or the Host answers for them). A wrong answer, a
 *     timeout or a pass moves the SAME question to the next player; a correct answer, or running out of players,
 *     finishes the turn and reveals the answer.
 *   - Answers are graded INSIDE a transaction on `live` (players write only that child), and every transition is
 *     guarded by { live.id, turn.at }: stale taps, double taps, the timer and the Host cannot skip two players.
 *   - `deadline` is an absolute server-synchronised time, so every device shows the same countdown.
 *
 * Live state shape:
 *   live = { id, questionId, question, index, total, optionsVisible, answerVisible, turn? }
 *   - index / total = position of the on-air question in the bank (0-based) and the bank size at the time it
 *     was put on air. They are synced through Firebase, so every player sees "Question 3 of 10" and follows
 *     the host's Previous / Next navigation in real time.
 *   - optionsVisible=false -> audience sees the prompt only (options A, B, C...
 *     are masked and their text is never rendered into the DOM).
 *   - answerVisible=true   -> the correct option is highlighted.
 * ========================================================================= */
"use strict";
const Quiz = {
    ref: null, listener: null, data: {}, ready: false, busy: false, editing: null,
    lastStage: "",          // fingerprint of the last stage render (drives entrance animations)
    target: "",             // Host-selected player for "Ask <player>" (UI state, not synced)
    draft: null,            // this device's unsent answer (picked fragments / typed text); resets every turn
    timerEls: null,         // countdown elements of the current stage
    ticker: 0, expiryKey: "", alertKey: "", turnBusy: false, // turn clock, timeout / alert de-duplication, answer in flight
    fullscreenBound: false, // document-level listeners are attached exactly once

    /* ------------------------------ helpers ------------------------------ */

    /** Only the authenticated Host may mutate the quiz. */
    allowed() { return State.isHost === true && Admin.unlocked === true; },

    /** 0 -> A, 25 -> Z, 26 -> AA ... (options are not limited to four). */
    label(index) {
        let value = index + 1, label = "";
        while (value > 0) { value--; label = String.fromCharCode(65 + value % 26) + label; value = Math.floor(value / 26); }
        return label;
    },

    /** Validates and normalizes a question; throws an Error with a user-facing message. */
    question(prompt, options, correctIndex) {
        prompt = String(prompt || "").trim();
        options = options.map((text) => String(text).trim());
        if (!prompt || prompt.length > 2000) throw new Error("Enter a question of up to 2,000 characters.");
        if (options.length < 2 || options.some((text) => !text || text.length > 500)) {
            throw new Error("Add at least two options, each 1 to 500 characters long.");
        }
        if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= options.length) {
            throw new Error("Select the correct answer.");
        }
        return { prompt, options, correctIndex };
    },

    /* ------------------------------ question types ------------------------------ */

    TYPES: ["choice", "order", "text"],
    TYPE_LABELS: { choice: "Multiple choice", order: "Sentence ordering", text: "Free text / fill in the blank" },
    LIMITS: { fragments: [3, 12], fragmentLength: 80, answers: 10, answerLength: 120 },
    MAX_QUESTIONS: 200,

    /** "choice" (the original format, stored without a `type`), "order" or "text". */
    typeOf(q) { return q && this.TYPES.includes(q.type) ? q.type : "choice"; },

    /** Choice and ordering have options / fragments that can be hidden; free text has nothing to hide. */
    hasOptions(q) { return this.typeOf(q) !== "text"; },

    /** Firebase may hand arrays back as objects; accept both (and a lone string for convenience). */
    toArray(v) { return Array.isArray(v) ? v : typeof v === "string" ? [v] : Object.values(v && typeof v === "object" ? v : {}); },

    /**
     * Comparison form of a typed answer: Unicode-normalized, curly quotes straightened, spaces collapsed,
     * edge punctuation (. , ; : ! ?) ignored, and lower-cased unless the question is case sensitive.
     */
    normalizeText(value, caseSensitive = false) {
        const s = String(value == null ? "" : value).normalize("NFKC")
            .replace(/[\u2018\u2019\u201B\u2032]/g, "'").replace(/[\u201C\u201D\u201F\u2033]/g, '"')
            .replace(/\s+/g, " ").trim()
            .replace(/^[\s.,;:!?]+|[\s.,;:!?]+$/g, "");
        return caseSensitive ? s : s.toLowerCase();
    },

    /** "I | have lived | here" -> 3 fragments; plain text without "|" is split into single words. */
    splitSentence(text) {
        const s = String(text == null ? "" : text).replace(/\r?\n/g, " ").trim();
        return (s.includes("|") ? s.split("|") : s.split(/\s+/)).map((part) => part.trim()).filter(Boolean);
    },

    /** Sentence ordering: `fragments` are stored in their CORRECT order and shuffled when put on air. */
    questionOrder(prompt, fragments) {
        prompt = String(prompt || "").trim();
        fragments = this.toArray(fragments).map((f) => String(f == null ? "" : f).replace(/\s+/g, " ").trim());
        const [min, max] = this.LIMITS.fragments;
        if (!prompt || prompt.length > 2000) throw new Error("Enter a question of up to 2,000 characters.");
        if (fragments.length < min || fragments.length > max || fragments.some((f) => !f || f.length > this.LIMITS.fragmentLength)) {
            throw new Error(`Use ${min} to ${max} fragments, each 1 to ${this.LIMITS.fragmentLength} characters long.`);
        }
        return { type: "order", prompt, fragments };
    },

    /** Free text / fill in the blank: any of the accepted answers wins (see normalizeText for what is ignored). */
    questionText(prompt, answers, caseSensitive) {
        prompt = String(prompt || "").trim();
        const cs = caseSensitive === true, seen = new Set(), clean = [];
        this.toArray(answers).forEach((a) => {
            const text = String(a == null ? "" : a).replace(/\s+/g, " ").trim(), key = this.normalizeText(text, cs);
            if (key && !seen.has(key)) { seen.add(key); clean.push(text); }
        });
        if (!prompt || prompt.length > 2000) throw new Error("Enter a question of up to 2,000 characters.");
        if (!clean.length || clean.length > this.LIMITS.answers || clean.some((a) => a.length > this.LIMITS.answerLength)) {
            throw new Error(`Add 1 to ${this.LIMITS.answers} accepted answers, each up to ${this.LIMITS.answerLength} characters long.`);
        }
        return { type: "text", prompt, answers: clean, caseSensitive: cs };
    },

    /** Validates a raw question of ANY type (imports, example files, data.json). Throws a user-facing Error. */
    parseQuestion(raw) {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Each question must be an object.");
        const type = raw.type == null || raw.type === "" ? "choice" : String(raw.type).toLowerCase();
        if (!this.TYPES.includes(type)) throw new Error(`Unknown question type "${String(raw.type).slice(0, 20)}".`);
        if (type === "order") return this.questionOrder(raw.prompt, raw.fragments !== undefined ? raw.fragments : this.splitSentence(raw.sentence));
        if (type === "text") return this.questionText(raw.prompt, raw.answers !== undefined ? raw.answers : raw.answer, raw.caseSensitive === true);
        return this.question(raw.prompt, this.toArray(raw.options), Number(raw.correctIndex));
    },

    /** Portable form of a stored question (what data.json and the example file contain). */
    exportQuestion(q) {
        const type = this.typeOf(q);
        if (type === "order") return { type, prompt: q.prompt, fragments: this.toArray(q.fragments) };
        if (type === "text") return { type, prompt: q.prompt, answers: this.toArray(q.answers), caseSensitive: q.caseSensitive === true };
        return { type, prompt: q.prompt, options: this.optionList(q), correctIndex: q.correctIndex };
    },

    /** Random permutation of 0..n-1 that is never the identity (so the fragments never arrive already solved). */
    shuffleOrder(n) {
        const order = Array.from({ length: n }, (_, i) => i);
        for (let i = n - 1; i > 0; i--) { const j = Math.floor(this.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
        if (n > 1 && order.every((v, i) => v === i)) order.push(order.shift());
        return order;
    },

    /** Copy of a bank question for the audience. Ordering questions get ONE shuffle that every device shares. */
    snapshot(q) {
        const type = this.typeOf(q);
        if (type === "order") { const fragments = this.toArray(q.fragments); return { type, prompt: q.prompt, fragments, shuffle: this.shuffleOrder(fragments.length) }; }
        if (type === "text") return { type, prompt: q.prompt, answers: this.toArray(q.answers), caseSensitive: q.caseSensitive === true };
        return { prompt: q.prompt, options: this.optionList(q), correctIndex: q.correctIndex }; // choice keeps its original shape
    },

    /** Shuffle used on screen: the shared one, or the stored order if it is missing / damaged. */
    shuffleOf(q) {
        const fragments = this.toArray(q.fragments), shuffle = this.toArray(q.shuffle);
        return shuffle.length === fragments.length && shuffle.every((v) => Number.isInteger(v) && v >= 0 && v < fragments.length) ? shuffle : fragments.map((_, i) => i);
    },

    /**
     * Grades an answer. choice: option index. order: fragment indexes in the player's order (fragments are compared by
     * text, so repeated words are fine). text: the typed string.
     */
    grade(q, answer) {
        const type = this.typeOf(q);
        if (type === "choice") return Number.isInteger(answer) && answer === q.correctIndex;
        if (type === "order") {
            const fragments = this.toArray(q.fragments);
            if (!Array.isArray(answer) || answer.length !== fragments.length) return false;
            if (answer.some((i) => !Number.isInteger(i) || i < 0 || i >= fragments.length) || new Set(answer).size !== fragments.length) return false;
            return answer.every((index, position) => fragments[index] === fragments[position]);
        }
        const cs = q.caseSensitive === true, given = this.normalizeText(String(answer == null ? "" : answer).slice(0, 300), cs);
        return !!given && this.toArray(q.answers).some((a) => this.normalizeText(a, cs) === given);
    },

    /** One-line description of a bank question (admin list). */
    describeQuestion(q) {
        const type = this.typeOf(q);
        if (type === "order") return `Ordering \u00B7 ${this.toArray(q.fragments).length} fragments`;
        if (type === "text") return `Free text \u00B7 ${this.toArray(q.answers).length} accepted answer(s)`;
        return `Multiple choice \u00B7 ${this.optionList(q).length} options \u00B7 correct: ${this.label(q.correctIndex)}`;
    },

    /* ------------------------------ settings & turns ------------------------------ */

    DEFAULT_SETTINGS: { autoLaunch: false, answerBy: "player", seconds: 30, chain: 3 },

    /** Clean quiz settings: auto-launch switch, who answers, seconds per turn (0 = no limit), fallback players. */
    normalizeSettings(raw) {
        const r = raw && typeof raw === "object" ? raw : {}, d = this.DEFAULT_SETTINGS;
        const int = (v, lo, hi, def) => { v = Math.round(Number(v)); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def; };
        return { autoLaunch: r.autoLaunch === true, answerBy: r.answerBy === "admin" ? "admin" : "player", seconds: int(r.seconds, 0, 300, d.seconds), chain: int(r.chain, 0, 10, d.chain) };
    },
    settings() { return this.normalizeSettings(this.data.settings); },

    random() { return Math.random(); },

    /** Server-synchronised clock (Firebase offset kept by the room listeners): every device agrees on when a turn ends. */
    now() { return Date.now() + ((typeof Dice !== "undefined" && Dice.off) || 0); },

    /**
     * Turn order: the selected player(s) first, then up to `chain` fallbacks taken from the rest of the pool
     * (shuffled unless `shuffle` is false). Names are trimmed and de-duplicated case-insensitively; max 12 in total.
     */
    buildQueue(selected, pool, chain, shuffle = true) {
        const clean = (list) => (Array.isArray(list) ? list : []).map((n) => String(n == null ? "" : n).trim()).filter(Boolean);
        const seen = new Set(), unique = (list) => list.filter((n) => { const k = n.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
        const first = unique(clean(selected)), rest = unique(clean(pool));
        if (shuffle) for (let i = rest.length - 1; i > 0; i--) { const j = Math.floor(this.random() * (i + 1)); [rest[i], rest[j]] = [rest[j], rest[i]]; }
        return [...first, ...rest.slice(0, Math.max(0, chain))].slice(0, 12);
    },

    /** "Next in line" for a Host assignment: `first`, then the players that follow them in the roster (wrapping around). */
    lineAfter(first, roster, chain) {
        const names = (Array.isArray(roster) ? roster : []).map(String), at = names.findIndex((n) => n.toLowerCase() === String(first).toLowerCase());
        return this.buildQueue([first], at < 0 ? names : [...names.slice(at + 1), ...names.slice(0, at)], chain, false);
    },

    /** Player names of the room, alphabetical. */
    playerNames() {
        const list = typeof Room !== "undefined" && typeof Room.list === "function" ? Room.list() : [];
        return list.map((p) => p && p.username).filter(Boolean).sort((a, b) => String(a).localeCompare(String(b)));
    },

    /** Name of the player whose turn it is ("" when no turn is running). */
    turnPlayer(live = this.data.live) {
        const t = live && live.turn;
        return t && !t.done && Array.isArray(t.queue) ? String(t.queue[t.at] || "") : "";
    },
    isMe(name) { return !!name && !!State.username && String(name).toLowerCase() === String(State.username).toLowerCase(); },

    /** Who may answer right now: the Host (always) or, unless the turn is "Host only", the player whose turn it is. */
    canAnswer(live = this.data.live) {
        const who = this.turnPlayer(live);
        if (!who) return false;
        return this.allowed() || ((live.turn.by || "player") === "player" && this.isMe(who));
    },

    /**
     * Applies one turn event to a live record IN PLACE. kind: correct | wrong | timeout | skip.
     * Correct ends the turn; anything else passes to the next player (new deadline) or ends it when the line is exhausted.
     * Finished turns reveal the answer. Pure on purpose: it runs inside transactions and in the unit tests.
     */
    turnStep(live, kind, by, now) {
        const t = live && live.turn;
        if (!t || t.done || !Array.isArray(t.queue) || !t.queue.length) return false;
        const log = this.toArray(t.log).slice(-29);
        log.push({ u: t.queue[t.at], r: kind, by, t: now });
        t.log = log;
        if (kind === "correct") { t.done = "correct"; t.winner = t.queue[t.at]; t.deadline = 0; }
        else if (t.at + 1 < t.queue.length) { t.at += 1; t.deadline = t.seconds > 0 ? now + t.seconds * 1000 : 0; }
        else { t.done = "exhausted"; t.deadline = 0; }
        if (t.done) { live.answerVisible = true; if (this.hasOptions(live.question)) live.optionsVisible = true; }
        return true;
    },

    /** Tiny DOM helper: element with safe textContent (never innerHTML for user data). */
    h(tag, cls, text) {
        const node = document.createElement(tag);
        if (cls) node.className = cls;
        if (text != null && text !== "") node.textContent = text;
        return node;
    },

    /** Updates the connection chip; `state` drives its colour via [data-state]. */
    setStatus(text, state) {
        const node = $z("quiz-connection");
        node.textContent = text;
        if (node.dataset) node.dataset.state = state; // dataset is absent in the unit-test stub
    },

    /** Option texts as a plain array (Firebase may hand back arrays as objects). */
    optionList(question) { return Object.values((question && question.options) || {}); },

    /**
     * Bank entries [id, question] in navigation order: legacy records without `order` first (by key, i.e.
     * creation time), then ordered ones by `order` (ties broken by key). Invalid records are ignored.
     */
    sortedEntries(map) {
        const byKey = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
        const ord = (q) => (Number.isFinite(q.order) ? q.order : null);
        return Object.entries(map || {})
            .filter(([, q]) => q && typeof q === "object")
            .sort(([ka, a], [kb, b]) => {
                const oa = ord(a), ob = ord(b);
                if (oa === null && ob === null) return byKey(ka, kb);
                if (oa === null) return -1;
                if (ob === null) return 1;
                return oa - ob || byKey(ka, kb);
            });
    },

    /** `order` for a question appended to the end of the bank. */
    nextOrder(map) {
        return 1 + Math.max(-1, ...Object.values(map || {}).map((q) => (q && Number.isFinite(q.order) ? q.order : -1)));
    },

    /** Live record for bank question `id` (position and total are snapshots); null when it is not in the bank. */
    liveFor(data, id, token) {
        const entries = this.sortedEntries(data.questions), at = entries.findIndex(([key]) => key === id);
        if (at < 0) return null;
        const q = entries[at][1];
        return {
            id: token, questionId: id,
            question: this.snapshot(q), // type-aware copy; never the `order` field
            index: at, total: entries.length, optionsVisible: false, answerVisible: false
        };
    },

    /**
     * Where the on-air question sits in the bank, from the shared state:
     * { at, total, hasPrev, hasNext }. With nothing on air, "Next" means "start with question 1".
     */
    position() {
        const total = this.sortedEntries(this.data.questions).length, live = this.data.live;
        if (!total) return { at: -1, total, hasPrev: false, hasNext: false };
        if (!live || !live.question) return { at: -1, total, hasPrev: false, hasNext: true };
        let at = this.sortedEntries(this.data.questions).findIndex(([key]) => key === live.questionId);
        if (at < 0) at = Number.isInteger(live.index) ? live.index : -1; // question imported without a bank entry
        return { at, total, hasPrev: at > 0, hasNext: at < total - 1 };
    },

    /* ------------------------------ lifecycle ------------------------------ */

    init() {
        const full = $z("quiz-fullscreen");
        full.addEventListener("click", async () => {
            try {
                if (document.fullscreenElement) await document.exitFullscreen();
                else await $z("game-quiz").requestFullscreen();
            } catch (_) { Notify.error("This browser does not allow fullscreen."); }
        });
        if (this.fullscreenBound) return;
        this.fullscreenBound = true;
        document.addEventListener("fullscreenchange", () => {
            const on = document.fullscreenElement === $z("game-quiz");
            $z("quiz-fullscreen").textContent = on ? "Exit fullscreen" : "Fullscreen";
        });
        document.addEventListener("game-changed", () => {
            if (Router.currentGameKey !== "quiz" && document.fullscreenElement === $z("game-quiz")) {
                document.exitFullscreen().catch(() => {});
            }
        });
        // Host shortcuts while projecting: Left / Right arrows (or PageUp / PageDown) = Previous / Next.
        document.addEventListener("keydown", (event) => this.onKey(event));
        // Random tools (Player Wheel, Lucky Draw) announce who was picked; with auto-launch on, send that player a question.
        if (typeof PubSub !== "undefined") {
            PubSub.on("selection-made", (info) => this.onSelection(info));
            PubSub.on("players-updated", () => { if (this.allowed()) this.renderTarget(); });
        }
    },

    /** Arrow-key navigation; ignored while typing, with dialogs / the admin panel open, or outside the Quiz screen. */
    onKey(event) {
        const step = { ArrowRight: 1, PageDown: 1, ArrowLeft: -1, PageUp: -1 }[event.key];
        if (!step || event.altKey || event.ctrlKey || event.metaKey) return;
        if (!this.allowed() || Router.currentGameKey !== "quiz") return;
        const target = event.target;
        if (target && (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable)) return;
        if (document.querySelector(".ui-dialog-overlay, #admin-modal:not([hidden]), .px-modal:not([hidden])")) return;
        const p = this.position();
        if (step > 0 ? !p.hasNext : !p.hasPrev) return;
        event.preventDefault();
        this.navigate(step);
    },

    /** Subscribes to the room's quiz node (called when the room connection starts). */
    start() {
        this.stop();
        if (!Room.db || !Room.code) return;
        this.ref = Room.db.ref(`rooms/${Room.code}/quiz`);
        const ref = this.ref;
        this.listener = (snapshot) => {
            if (this.ref !== ref) return; // ignore events from a previous room
            this.data = snapshot.val() || {};
            this.ready = true;
            this.setStatus("Live \u00B7 shared with this room", "live");
            this.noteTurn();
            this.render(); this.syncAdmin();
        };
        ref.on("value", this.listener, () => {
            if (this.ref !== ref) return;
            this.ready = false;
            this.setStatus("Could not read the quiz. Check the database rules and rejoin the room.", "error");
            this.render(); this.syncAdmin();
        });
    },

    /** Detaches the listener and wipes every trace of the previous room. */
    stop() {
        if (this.ref && this.listener) this.ref.off("value", this.listener);
        this.ref = this.listener = null;
        this.data = {}; this.ready = false; this.busy = false; this.lastStage = "";
        this.stopTicker(); this.draft = null; this.timerEls = null; this.turnBusy = false; this.alertKey = ""; this.target = "";
        this.clearAdmin(); this.render();
        this.setStatus("Connecting to the quiz\u2026", "connecting");
        if (document.fullscreenElement === $z("game-quiz")) document.exitFullscreen().catch(() => {});
    },

    /* ------------------------------ writes ------------------------------ */

    /** Runs `change(data)` in a transaction. Returning undefined from `change` aborts it. */
    async write(change) {
        if (!this.allowed() || !this.ref || !this.ready || this.busy) return false;
        const ref = this.ref;
        this.busy = true; this.renderHost(); this.syncAdmin();
        try {
            const result = await ref.transaction((data) => change(data || {}), undefined, false);
            if (this.ref !== ref) return false; // room changed while waiting
            if (!result.committed) throw new Error("The question changed. Review the current state and try again.");
            return true;
        } catch (error) {
            if (this.ref === ref) Notify.error(error.message || "Could not save the quiz.");
            return false;
        } finally {
            if (this.ref === ref) { this.busy = false; this.render(); this.syncAdmin(); }
        }
    },

    /** Publishes a bank question to the audience (options start hidden). */
    async present(id) {
        const token = this.ref?.push().key;
        return this.write((data) => {
            const live = this.liveFor(data, id, token);
            if (!live) return; // deleted elsewhere
            data.live = live;
            return data;
        });
    },

    /** Mutates the live question only if it is still the one the control was rendered for. */
    async liveChange(change) {
        const token = this.data.live?.id;
        if (!token) return;
        await this.write((data) => {
            if (data.live?.id !== token) return;
            change(data.live); return data;
        });
    },

    /** Convenience wrappers shared by the projection dock and the admin panel. */
    toggleOptions() {
        return this.liveChange((live) => { live.optionsVisible = !live.optionsVisible; if (!live.optionsVisible) live.answerVisible = false; });
    },
    toggleAnswer() { return this.liveChange((live) => { live.answerVisible = !live.answerVisible; }); },
    endQuestion() {
        const id = this.data.live?.id;
        if (!id) return Promise.resolve(false);
        return this.write((data) => { if (data.live?.id !== id) return; delete data.live; return data; });
    },

    /**
     * PREVIOUS (-1) / NEXT (+1): puts the adjacent bank question on air for the whole room.
     * Runs in a transaction against the freshest bank, so edits, deletions and a second Host device cannot
     * make it jump to a stale question; the new live record gets a fresh token and starts with options hidden.
     * With nothing on air, only Next is meaningful and it starts at the first question.
     */
    navigate(step) {
        const token = this.ref?.push().key, current = this.data.live?.id || null;
        return this.write((data) => {
            if ((data.live?.id || null) !== current) return; // the screen changed since the control was drawn
            const entries = this.sortedEntries(data.questions);
            if (!entries.length) return;
            let at;
            if (!data.live) at = step > 0 ? 0 : -1;
            else {
                const now = entries.findIndex(([key]) => key === data.live.questionId);
                const base = now >= 0 ? now : (Number.isInteger(data.live.index) ? data.live.index : (step > 0 ? -1 : entries.length));
                at = base + step;
            }
            if (at < 0 || at >= entries.length) return;
            data.live = this.liveFor(data, entries[at][0], token);
            return data;
        });
    },

    /** "Previous  3 / 10  Next" group shared by the projection dock and the admin panel. */
    navControls() {
        const p = this.position(), live = this.data.live, onAir = !!(live && live.question), h = this.h.bind(this);
        const group = h("div", "qz-nav");
        group.setAttribute("role", "group"); group.setAttribute("aria-label", "Question navigation");
        const prev = this.button("\u25C0 Previous", () => this.navigate(-1), !p.hasPrev, "secondary");
        prev.setAttribute("aria-label", "Previous question");
        const count = h("span", "qz-nav-count", onAir ? (p.at >= 0 ? `${p.at + 1} / ${p.total}` : "On air") : `${p.total} in bank`);
        count.setAttribute("aria-live", "polite");
        const next = this.button(onAir ? "Next \u25B6" : "\u25B6 Start", () => this.navigate(1), !p.hasNext, "primary");
        next.setAttribute("aria-label", onAir ? "Next question" : "Start with the first question");
        group.append(prev, count, next);
        return group;
    },

    /* ------------------------------ turns: start, answer, pass on ------------------------------ */

    /**
     * Puts bank question `id` on air as a TURN. `queue` lists who answers, in order; every wrong answer, timeout or
     * pass moves the SAME question to the next player. Options / fragments are shown at once (the player needs them).
     */
    async startTurn(id, queue) {
        queue = this.buildQueue(queue, [], 0);
        if (!queue.length) return false;
        const token = this.ref?.push().key;
        return this.write((data) => {
            const live = this.liveFor(data, id, token);
            if (!live) return; // deleted elsewhere
            const s = this.normalizeSettings(data.settings), now = this.now();
            live.optionsVisible = true;
            live.turn = { queue, at: 0, seconds: s.seconds, deadline: s.seconds > 0 ? now + s.seconds * 1000 : 0, by: s.answerBy, started: now };
            data.live = live;
            return data;
        });
    },

    /** A random bank question id, avoiding the one already on air when there is a choice. */
    randomQuestionId(data = this.data) {
        const ids = this.sortedEntries(data.questions).map(([id]) => id);
        const pool = ids.length > 1 ? ids.filter((id) => id !== (data.live && data.live.questionId)) : ids;
        return pool.length ? pool[Math.floor(this.random() * pool.length)] : null;
    },

    /**
     * "selection-made" (Player Wheel, Lucky Draw...): with the auto-launch setting on, the Host's device sends a random
     * question to the Quiz for the picked player(s); the rest of the pool is the fallback line. Players' devices ignore it.
     */
    async onSelection(info) {
        if (!this.allowed() || !this.ready || !this.settings().autoLaunch) return false;
        const id = this.randomQuestionId();
        if (!id) { Notify.warning("Auto-launch is on, but the Quiz has no questions yet."); return false; }
        const queue = this.buildQueue(info && info.winners, info && info.participants, this.settings().chain);
        if (!queue.length) return false;
        const sent = await this.startTurn(id, queue);
        if (sent) Notify.success(`Random question sent to the Quiz for ${queue[0]}.`);
        return sent;
    },

    /** Host assignment: `player` answers first (bank question `id`, default = the one on air); the next players in the roster are the fallbacks. */
    assign(player, id = this.data.live && this.data.live.questionId) {
        if (!player || !id) return Promise.resolve(false);
        return this.startTurn(id, this.lineAfter(player, this.playerNames(), this.settings().chain));
    },

    /** Child ref of the on-air question: players write ONLY here (never the whole quiz node). */
    liveRef() { return this.ref ? this.ref.child("live") : null; },

    /**
     * Runs one turn transition in a transaction on `live`. `guard` ties it to the exact state the control saw
     * ({ id, at, expire? }), so double taps, a second device, the timer and a manual pass can never skip two players.
     * Resolves with what `apply` returned, or null when stale / failed.
     */
    async turnWrite(guard, apply, quiet = false) {
        const ref = this.liveRef();
        if (!ref || !this.ready || this.turnBusy) return null;
        this.turnBusy = true; this.renderHost();
        let outcome = null;
        try {
            const result = await ref.transaction((live) => {
                outcome = null;
                if (!live) return null; // first call may arrive without a cached value; Firebase retries with the real one
                if (live.id !== guard.id || !live.turn || live.turn.done || live.turn.at !== guard.at) return; // stale: abort
                if (guard.expire && (!live.turn.deadline || this.now() < live.turn.deadline - 400)) return;     // not due yet
                outcome = apply(live);
                return live;
            }, undefined, false);
            return result.committed ? outcome : null;
        } catch (error) {
            if (!quiet) Notify.error("Could not send that. Check your connection and try again.");
            return null;
        } finally {
            this.turnBusy = false;
            if (this.ref) this.render();
        }
    },

    /** Sends an answer for the current turn: from the player's own device, or from the Host on their behalf. */
    async answer(value) {
        const live = this.data.live;
        if (!this.canAnswer(live)) return null;
        const byAdmin = this.allowed() && !this.isMe(this.turnPlayer(live));
        const out = await this.turnWrite({ id: live.id, at: live.turn.at }, (cur) => {
            const correct = this.grade(cur.question, value); // graded inside the transaction, from the shared question
            this.turnStep(cur, correct ? "correct" : "wrong", byAdmin ? "admin" : "player", this.now());
            return { correct, done: cur.turn.done || "", next: cur.turn.done ? "" : String(cur.turn.queue[cur.turn.at]) };
        });
        if (!out) return null;
        if (out.correct) Notify.success("Correct!");
        else if (out.done) Notify.warning("Not quite \u2014 nobody got it this time.");
        else Notify.warning(`Not quite. It's ${out.next}'s turn now.`);
        return out;
    },

    /** Host overrides during a turn: accept the answer as correct, or pass to the next player right now. */
    hostTurn(kind) {
        const live = this.data.live;
        if (!this.allowed() || !this.turnPlayer(live)) return Promise.resolve(null);
        return this.turnWrite({ id: live.id, at: live.turn.at }, (cur) => {
            this.turnStep(cur, kind === "correct" ? "correct" : "skip", "admin", this.now());
            return { done: cur.turn.done || "" };
        });
    },

    /** Time ran out: the first device to notice moves the line on (the guard makes any extra attempt harmless). */
    expire() {
        const live = this.data.live;
        if (!this.turnPlayer(live)) return Promise.resolve(null);
        return this.turnWrite({ id: live.id, at: live.turn.at, expire: true }, (cur) => { this.turnStep(cur, "timeout", "timer", this.now()); return { timeout: true }; }, true);
    },

    /** 250 ms clock while a turn runs: paints the countdown and triggers the timeout. */
    startTicker() { if (!this.ticker) this.ticker = setInterval(() => this.tick(), 250); },
    stopTicker() { if (this.ticker) clearInterval(this.ticker); this.ticker = 0; this.expiryKey = ""; },
    tick() {
        const live = this.data.live, t = live && live.turn;
        if (!t || t.done) { this.stopTicker(); return; }
        const left = t.deadline ? Math.max(0, t.deadline - this.now()) : null;
        this.paintTimer(left, t.seconds);
        if (left !== 0) return;
        const key = `${live.id}:${t.at}`;
        if (this.expiryKey === key) return; // one attempt per turn on this device
        // The answering player's device and the Host go first; any other device steps in a few seconds later.
        const grace = this.allowed() || this.isMe(this.turnPlayer(live)) ? 400 : 4000;
        if (this.now() - t.deadline < grace) return;
        this.expiryKey = key;
        this.expire();
    },
    paintTimer(left, total) {
        const els = this.timerEls;
        if (!els) return;
        if (left === null) { els.text.textContent = "No time limit"; els.fill.style.width = "100%"; return; }
        els.text.textContent = `${Math.ceil(left / 1000)}s`;
        els.fill.style.width = `${total > 0 ? Math.min(100, (left / (total * 1000)) * 100) : 0}%`;
        els.fill.classList.toggle("is-low", left <= 5000);
    },

    /** When it becomes MY turn: tell me and open the Quiz screen (once per turn). */
    noteTurn() {
        const live = this.data.live, who = this.turnPlayer(live);
        if (!who || !this.isMe(who) || (live.turn.by || "player") !== "player") return;
        const key = `${live.id}:${live.turn.at}`;
        if (this.alertKey === key) return;
        this.alertKey = key;
        Notify.warning("It's your turn to answer the Quiz question!");
        if (typeof Router !== "undefined" && Router.currentGameKey !== "quiz" && typeof GameCatalog !== "undefined" && typeof Missions !== "undefined" && GameCatalog.available("quiz", Missions.cfg)) Router.selectGame("quiz");
    },

    /* ------------------------------ question files (import / examples) ------------------------------ */

    /** Raw question list from an array, { questions }, or a full data.json (modules.quiz.questions); null when none. */
    extractQuestions(json) {
        if (Array.isArray(json)) return json;
        const asList = (v) => (Array.isArray(v) ? v : v && typeof v === "object" ? Object.values(v) : null);
        return asList(json && json.questions) || asList(json && json.modules && json.modules.quiz && json.modules.quiz.questions);
    },

    /** Validates a raw list: { questions: [clean...], skipped }. Stops at the bank limit. */
    parseMany(list, room = this.MAX_QUESTIONS) {
        const questions = []; let skipped = 0;
        list.forEach((raw) => {
            if (questions.length >= room) { skipped++; return; }
            try { questions.push(this.parseQuestion(raw)); } catch (e) { skipped++; }
        });
        return { questions, skipped };
    },

    /** APPENDS the questions of an imported / example file to the end of the bank (nothing is replaced). */
    async importQuestions(json) {
        const list = this.extractQuestions(json);
        if (!list) { Notify.error("No questions found in that file."); return false; }
        const have = Object.keys(this.data.questions || {}).length, { questions, skipped } = this.parseMany(list, Math.max(0, this.MAX_QUESTIONS - have));
        if (!questions.length) { Notify.error(skipped ? "None of the questions in that file were valid." : "That file has no questions."); return false; }
        const keys = questions.map(() => this.ref.push().key);
        const saved = await this.write((data) => {
            data.questions = data.questions || {};
            let order = this.nextOrder(data.questions);
            questions.forEach((q, i) => { data.questions[keys[i]] = { ...q, order: order++ }; });
            return data;
        });
        if (saved) {
            Notify.success(`${questions.length} question${questions.length === 1 ? "" : "s"} added to the bank.`);
            if (skipped) Notify.warning(`Skipped ${skipped} invalid or surplus question${skipped === 1 ? "" : "s"}.`);
        }
        return saved;
    },

    /** Reads a .json file chosen by the Host and imports its questions. */
    importFile(file) {
        if (!file) return;
        if (file.size > 1024 * 1024) { Notify.error("That file is too large (1 MB maximum)."); return; }
        const reader = new FileReader();
        reader.onerror = () => Notify.error("Could not read that file.");
        reader.onload = () => {
            let json;
            try { json = JSON.parse(String(reader.result)); } catch (e) { Notify.error("That file is not valid JSON."); return; }
            this.importQuestions(json);
        };
        reader.readAsText(file);
    },

    /** Adds the questions of data/quiz-examples.json (served with the site on GitHub Pages). */
    async addExamples() {
        try {
            const response = await fetch("data/quiz-examples.json", { cache: "no-store" });
            if (!response.ok) throw new Error(String(response.status));
            await this.importQuestions(await response.json());
        } catch (e) { Notify.error("Could not load quiz-examples.json."); }
    },

    /* ------------------------------ audience stage ------------------------------ */

    render() {
        const stage = $z("quiz-stage"), live = this.data.live, h = this.h.bind(this);
        // A remote update rebuilds the stage: remember typing focus so the answer draft survives it.
        if (this.draft && typeof document !== "undefined" && document.activeElement && stage.contains && stage.contains(document.activeElement)) {
            this.draft.focus = document.activeElement.tagName === "INPUT";
        }
        stage.textContent = ""; this.timerEls = null;
        if (!live?.question) {
            this.lastStage = ""; this.draft = null; this.stopTicker();
            const empty = h("div", "quiz-empty");
            empty.append(
                h("div", "quiz-empty-icon", "?"),
                h("p", "quiz-waiting", "Next question coming up"),
                h("p", "quiz-sub", "The host is preparing the questions. Keep this screen open to follow along.")
            );
            stage.append(empty);
        } else {
            const q = live.question, type = this.typeOf(q), turn = live.turn || null, running = !!this.turnPlayer(live);
            // Entrance animation only when the visible state really changed (not on busy/ready re-renders).
            const stamp = `${live.id}:${live.optionsVisible}:${live.answerVisible}:${turn ? `${turn.at}:${turn.done || ""}` : ""}`;
            const animate = stamp !== this.lastStage; this.lastStage = stamp;
            const head = h("div", "quiz-head");
            head.append(
                h("span", "quiz-live-badge", "LIVE"),
                ...(Number.isInteger(live.index) && live.total > 0 ? [h("span", "quiz-phase", `Question ${live.index + 1} of ${live.total}`)] : []),
                ...(type !== "choice" ? [h("span", "quiz-phase quiz-type", this.TYPE_LABELS[type])] : []),
                h("span", `quiz-phase${this.phaseOpen(live) ? " is-open" : ""}`, this.phaseText(live))
            );
            stage.append(head, h("h3", "quiz-prompt", q.prompt));
            if (turn) stage.append(this.renderTurn(live));
            stage.append(...(type === "order" ? this.bodyOrder(live, animate) : type === "text" ? this.bodyText(live) : this.bodyChoice(live, animate)));
            if (running) { this.startTicker(); this.tick(); } else this.stopTicker();
        }
        this.renderHost();
    },

    /** Status chip text of the stage header. */
    phaseText(live) {
        const t = live.turn, type = this.typeOf(live.question);
        if (t && !t.done) return this.isMe(this.turnPlayer(live)) && (t.by || "player") === "player" ? "Your turn!" : `${this.turnPlayer(live)}'s turn`;
        if (t && t.done === "correct") return `\u2713 ${t.winner} answered correctly`;
        if (t && t.done === "exhausted") return "No correct answer";
        if (type === "text") return "Write your answer";
        if (!live.optionsVisible) return "Question on air";
        return type === "order" ? "Put the fragments in order" : "Choose your answer";
    },
    phaseOpen(live) {
        const t = live.turn;
        return t ? (!t.done || t.done === "correct") : (live.optionsVisible || this.typeOf(live.question) === "text");
    },

    /** Turn banner: countdown bar + the line of players (current, failed, waiting, winner). */
    renderTurn(live) {
        const t = live.turn, h = this.h.bind(this), box = h("div", "quiz-turn"), running = !t.done;
        const queue = this.toArray(t.queue), log = this.toArray(t.log);
        if (running && t.deadline) {
            const timer = h("div", "quiz-timer"), fill = h("span", "quiz-timer-fill"), text = h("span", "quiz-timer-text");
            timer.setAttribute("aria-hidden", "true"); timer.append(fill, text); box.append(timer);
            this.timerEls = { fill, text };
        }
        const line = h("ol", "quiz-queue");
        queue.forEach((name, i) => {
            const entry = log[i], cls = ["quiz-queue-chip"];
            let mark = "";
            if (t.done === "correct" && i === t.at) { cls.push("is-won"); mark = "\u2713 "; }
            else if (entry && entry.r !== "correct") { cls.push("is-failed"); mark = entry.r === "timeout" ? "\u23F1 " : entry.r === "skip" ? "\u21B7 " : "\u2717 "; }
            else if (running && i === t.at) cls.push("is-current");
            else cls.push("is-waiting");
            if (this.isMe(name)) cls.push("is-me");
            line.append(h("li", cls.join(" "), mark + name));
        });
        box.append(line);
        return box;
    },

    /** Local (unsynced) answer draft; resets whenever the turn moves on. */
    draftFor(live) {
        const key = `${live.id}:${live.turn ? live.turn.at : ""}`;
        if (!this.draft || this.draft.key !== key) this.draft = { key, picks: [], text: "", focus: false };
        return this.draft;
    },

    /** Hint under the answer controls: whose answer this is. */
    answerHint(live) {
        const who = this.turnPlayer(live);
        return this.isMe(who) ? "It's your turn \u2014 answer before time runs out." : `Answering for ${who} as host.`;
    },

    solution(label, text) {
        const box = this.h("div", "quiz-solution");
        box.append(this.h("strong", "", `\u2713 ${label}`), this.h("span", "", text));
        return box;
    },

    /* ---- multiple choice ---- */
    bodyChoice(live, animate) {
        const q = live.question, h = this.h.bind(this), options = this.optionList(q), answerer = this.canAnswer(live) && !live.answerVisible;
        if (!live.optionsVisible) {
            // Letters are shown, but the option text is NOT in the DOM until revealed.
            const masked = h("ol", "quiz-options is-masked");
            masked.setAttribute("aria-hidden", "true");
            options.forEach((_, index) => {
                const item = h("li", "quiz-option is-masked");
                item.append(h("span", "quiz-letter", this.label(index)), h("span", "quiz-mask"));
                masked.append(item);
            });
            return [masked, h("p", "quiz-hidden-message", "Think of your answer and say it out loud. The options will be revealed in a moment.")];
        }
        const list = h("ol", `quiz-options${animate ? " is-entering" : ""}`);
        options.forEach((text, index) => {
            const correct = live.answerVisible && index === q.correctIndex;
            const state = live.answerVisible ? (correct ? " is-correct" : " is-dim") : "";
            const item = h("li", `quiz-option${state}${answerer ? " is-action" : ""}`);
            item.style.setProperty("--i", String(index));
            item.append(h("span", "quiz-letter", this.label(index)), h("span", "quiz-text", text));
            if (correct) item.append(h("strong", "quiz-correct", "\u2713 Correct answer"));
            if (answerer) {                                     // the answering player (or the Host) taps an option to answer
                item.tabIndex = 0; item.setAttribute("role", "button");
                const go = () => this.answer(index);
                item.addEventListener("click", go);
                item.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); go(); } });
            }
            list.append(item);
        });
        return answerer ? [list, h("p", "quiz-hint", this.answerHint(live))] : [list];
    },

    /* ---- sentence ordering ---- */
    bodyOrder(live, animate) {
        const q = live.question, h = this.h.bind(this), fragments = this.toArray(q.fragments), order = this.shuffleOf(q);
        if (!live.optionsVisible) {
            const masked = h("div", "quiz-frags is-masked");
            masked.setAttribute("aria-hidden", "true");
            fragments.forEach(() => masked.append(h("span", "quiz-frag is-masked")));
            return [masked, h("p", "quiz-hidden-message", "Get ready to put the pieces in the right order. The fragments will be revealed in a moment.")];
        }
        if (this.canAnswer(live) && !live.answerVisible) return [this.orderBuilder(live, fragments, order), h("p", "quiz-hint", this.answerHint(live))];
        const row = h("div", `quiz-frags${animate ? " is-entering" : ""}`);
        order.forEach((index, k) => { const chip = h("span", "quiz-frag", fragments[index]); chip.style.setProperty("--i", String(k)); row.append(chip); });
        return live.answerVisible ? [row, this.solution("Correct order", fragments.join(" "))] : [row];
    },

    /** Tap the fragments in order; tap a placed one to take it back; Submit when every piece is placed. */
    orderBuilder(live, fragments, order) {
        const h = this.h.bind(this), d = this.draftFor(live), box = h("div", "quiz-answer");
        const chip = (index, onClick, cls) => {
            const b = h("button", `quiz-frag is-action${cls ? " " + cls : ""}`, fragments[index]);
            b.type = "button"; b.disabled = !!this.turnBusy; b.addEventListener("click", onClick); return b;
        };
        const line = h("div", "quiz-frag-line");
        line.setAttribute("aria-label", "Your sentence");
        if (!d.picks.length) line.append(h("span", "quiz-frag-placeholder", "Tap the pieces in order\u2026"));
        d.picks.forEach((index, pos) => line.append(chip(index, () => { d.picks.splice(pos, 1); this.render(); }, "is-placed")));
        const pool = h("div", "quiz-frag-pool");
        order.filter((index) => !d.picks.includes(index)).forEach((index) => pool.append(chip(index, () => { d.picks.push(index); this.render(); })));
        const actions = h("div", "quiz-answer-row");
        const reset = h("button", "btn btn-ghost", "Reset"); reset.type = "button"; reset.disabled = !d.picks.length || !!this.turnBusy;
        reset.addEventListener("click", () => { d.picks = []; this.render(); });
        const send = h("button", "btn btn-primary", "Submit answer"); send.type = "button";
        send.disabled = d.picks.length !== fragments.length || !!this.turnBusy;
        send.addEventListener("click", () => this.answer(d.picks.slice()));
        actions.append(reset, send);
        box.append(line, pool, actions);
        return box;
    },

    /* ---- free text / fill in the blank ---- */
    bodyText(live) {
        const q = live.question, h = this.h.bind(this), answers = this.toArray(q.answers), nodes = [];
        if (this.canAnswer(live) && !live.answerVisible) return [this.textAnswer(live), h("p", "quiz-hint", this.answerHint(live))];
        if (live.turn && !live.turn.done) nodes.push(h("p", "quiz-hidden-message", `${this.turnPlayer(live)} is typing the answer\u2026`));
        else if (!live.turn && !live.answerVisible) nodes.push(h("p", "quiz-hidden-message", "Write your answer and say it out loud. The host will reveal the correct answer."));
        if (live.answerVisible) nodes.push(this.solution(answers.length > 1 ? "Accepted answers" : "Correct answer", answers.join("  /  ")));
        return nodes;
    },
    textAnswer(live) {
        const h = this.h.bind(this), d = this.draftFor(live), box = h("div", "quiz-answer");
        const input = h("input", "input-field quiz-answer-input"); input.type = "text"; input.maxLength = 300; input.value = d.text;
        input.placeholder = "Type your answer\u2026"; input.autocomplete = "off"; input.setAttribute("aria-label", "Your answer"); input.disabled = !!this.turnBusy;
        input.addEventListener("input", () => { d.text = input.value; send.disabled = !input.value.trim() || !!this.turnBusy; });
        const submit = () => { if (input.value.trim()) this.answer(input.value); };
        input.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); submit(); } });
        const send = h("button", "btn btn-primary", "Submit answer"); send.type = "button"; send.disabled = !d.text.trim() || !!this.turnBusy;
        send.addEventListener("click", submit);
        const row = h("div", "quiz-answer-row"); row.append(input, send);
        box.append(row);
        if (d.focus && typeof setTimeout === "function") setTimeout(() => input.focus(), 0);
        return box;
    },

    /** Button factory; respects the ready/busy gate. `variant` = secondary | primary | danger | ghost. */
    button(text, action, disabled = false, variant = "secondary") {
        const button = this.h("button", `btn btn-${variant}`, text);
        button.type = "button";
        button.disabled = disabled || !this.ready || this.busy || !!this.turnBusy;
        button.addEventListener("click", action);
        return button;
    },

    /** Host dock under the stage: navigation, turn controls, reveal / hide, end question. */
    renderHost() {
        const root = $z("quiz-host"); root.textContent = ""; root.hidden = !this.allowed();
        if (!this.allowed()) return;
        const live = this.data.live;
        const manage = this.button("\u2699 Manage questions", () => Admin.open(), false, "ghost");
        const nav = this.position().total ? [this.navControls()] : [];
        if (!live?.question) { root.append(...nav, manage); return; }
        const parts = [...nav], hasOptions = this.hasOptions(live.question);
        if (this.turnPlayer(live)) parts.push(this.turnControls());
        if (hasOptions) {
            const toggle = this.button(live.optionsVisible ? "\uD83D\uDE48 Hide options" : "\uD83D\uDC41 Reveal options", () => this.toggleOptions(), false, live.optionsVisible ? "secondary" : "primary");
            toggle.setAttribute("aria-pressed", String(live.optionsVisible));
            parts.push(toggle);
        }
        const answer = this.button(live.answerVisible ? "Hide correct answer" : "\u2713 Reveal correct answer", () => this.toggleAnswer(), hasOptions && !live.optionsVisible, "secondary");
        answer.setAttribute("aria-pressed", String(live.answerVisible));
        parts.push(answer, this.button("\u25A0 End question", () => this.endQuestion(), false, "danger"), manage);
        root.append(...parts);
    },

    /** Host controls while a turn runs: accept the answer as correct, or pass to the next player right now. */
    turnControls() {
        const group = this.h("div", "qz-turn-controls");
        group.append(
            this.button(`\u2713 Accept for ${this.turnPlayer()}`, () => this.hostTurn("correct"), false, "primary"),
            this.button("\u21B7 Pass to next", () => this.hostTurn("skip"), false, "secondary")
        );
        return group;
    },

    /* ------------------------------ admin panel ------------------------------ */

    /** "On air" card inside the admin panel: turn status, live controls and the correct answer. */
    renderAdminLive() {
        const root = $z("quiz-live-admin"), live = this.data.live, h = this.h.bind(this);
        root.textContent = "";
        if (!live?.question) {
            root.append(h("p", "qz-live-empty", "Nothing on air. Press Start, or Present on any question below."));
            if (this.position().total) root.append(this.navControls());
            return;
        }
        const q = live.question, type = this.typeOf(q), hasOptions = this.hasOptions(q), turn = live.turn;
        const top = h("div", "qz-live-top");
        top.append(h("span", "quiz-live-badge", "ON AIR"), h("span", "badge badge-gold", this.TYPE_LABELS[type]), h("strong", "qz-live-prompt", q.prompt));
        root.append(top);
        if (turn) {
            const status = h("p", "qz-turn-status", turn.done === "correct" ? `\u2713 ${turn.winner} answered correctly.` : turn.done ? "Nobody answered correctly." : `${this.turnPlayer(live)}'s turn \u2014 line: ${this.toArray(turn.queue).join(" \u2192 ")}`);
            root.append(status);
            if (!turn.done) root.append(this.turnControls());
        }
        root.append(this.navControls());
        const controls = h("div", "qz-live-controls");
        if (hasOptions) controls.append(this.button(live.optionsVisible ? "Hide options" : "Reveal options", () => this.toggleOptions(), false, live.optionsVisible ? "secondary" : "primary"));
        controls.append(this.button(live.answerVisible ? "Hide answer" : "Reveal answer", () => this.toggleAnswer(), hasOptions && !live.optionsVisible), this.button("End question", () => this.endQuestion(), false, "danger"));
        root.append(controls);
        if (type === "choice") {
            const label = h("label", "qz-field");
            label.append(h("span", "", "Correct answer (live)"));
            const select = h("select", "input-field");
            this.optionList(q).forEach((text, index) => {
                const option = h("option", "", `${this.label(index)}: ${text}`); option.value = String(index); select.append(option);
            });
            select.value = String(q.correctIndex);
            select.disabled = !this.ready || this.busy;
            select.addEventListener("change", () => {
                const index = Number(select.value);
                this.liveChange((value) => { value.question.correctIndex = index; value.answerVisible = false; });
            });
            label.append(select); root.append(label);
        } else {
            root.append(h("p", "qz-solution-line", type === "order" ? `Correct order: ${this.toArray(q.fragments).join(" ")}` : `Accepted: ${this.toArray(q.answers).join(" / ")}`));
        }
        if (this.target && live.questionId) {
            root.append(this.button(`Ask ${this.target} (restart as a turn)`, () => this.assign(this.target), false, "secondary"));
        }
    },

    /** Hides and empties every Host-only element (logout, leaving the room, failed PIN...). */
    clearAdmin() {
        const root = $z("quiz-admin"); root.textContent = ""; root.hidden = true;
        $z("quiz-host").textContent = ""; $z("quiz-host").hidden = true; this.editing = null;
        const tabBadge = $z("badge-quiz");
        if (tabBadge) { tabBadge.textContent = "0"; if (tabBadge.classList) tabBadge.classList.remove("is-live"); }
    },

    /** Builds the admin shell once, then refreshes settings, the bank and the live card on every sync. */
    syncAdmin() {
        if (!this.allowed()) { this.clearAdmin(); return; }
        const root = $z("quiz-admin"); root.hidden = false;
        if (!root.firstChild) {
            // Static markup only (no user data): safe to use innerHTML here.
            root.innerHTML = `
                <div class="qz-admin">
                  <header class="qz-admin-head">
                    <div><h3>Quiz &amp; Live Questions</h3>
                    <p class="form-help">Build your bank, then press <b>Present</b>. Options start hidden so students answer first. Editing the bank never changes the question that is on air.</p></div>
                  </header>
                  <section class="qz-settings" aria-labelledby="quiz-settings-title">
                    <h4 id="quiz-settings-title">Turns &amp; random tools</h4>
                    <label class="gv-switch qz-set-row"><span class="gv-name">Send a random question to the Quiz whenever a random tool (Player Wheel, Lucky Draw) picks a player</span><input type="checkbox" id="quiz-set-auto"></label>
                    <div class="qz-set-grid">
                      <label class="qz-field"><span>Who answers</span>
                        <select id="quiz-set-by" class="input-field"><option value="player">The picked player (or the host)</option><option value="admin">The host only</option></select></label>
                      <label class="qz-field"><span>Seconds per turn (0 = no limit)</span><input id="quiz-set-seconds" class="input-field" type="number" min="0" max="300" step="5"></label>
                      <label class="qz-field"><span>Fallback players after the first</span><input id="quiz-set-chain" class="input-field" type="number" min="0" max="10" step="1"></label>
                    </div>
                    <p class="form-help">If the picked player answers wrong, passes, or runs out of time, the SAME question moves to the next player in line automatically, on every device.</p>
                    <label class="qz-field"><span>Ask a specific player (used by Present)</span><select id="quiz-target" class="input-field"></select></label>
                  </section>
                  <div id="quiz-live-admin" class="qz-live-card"></div>
                  <div class="qz-bank-head"><h4>Question bank <span id="quiz-count" class="qz-count">0</span></h4>
                    <div class="qz-bank-tools">
                      <button type="button" id="quiz-new" class="btn btn-primary">+ New question</button>
                      <label class="btn btn-secondary btn-file">Import JSON<input type="file" id="quiz-import" accept="application/json,.json" hidden></label>
                      <button type="button" id="quiz-examples" class="btn btn-ghost">Add examples</button>
                    </div></div>
                  <div id="quiz-bank" class="quiz-bank"></div>
                  <form id="quiz-form" class="quiz-form" hidden novalidate>
                    <h4 id="quiz-form-title">New question</h4>
                    <label class="qz-field"><span>Question type</span>
                      <select id="quiz-type" class="input-field">
                        <option value="choice">Multiple choice (A / B / C / D)</option>
                        <option value="order">Sentence ordering</option>
                        <option value="text">Free text / fill in the blank</option>
                      </select></label>
                    <label class="qz-field"><span>Question</span>
                      <textarea id="quiz-prompt-input" class="input-field" maxlength="2000" required rows="3" placeholder="Type the question students will see\u2026"></textarea>
                      <small id="quiz-prompt-count" class="qz-counter">0 / 2000</small></label>
                    <div id="quiz-fields-choice">
                      <fieldset><legend>Options \u00B7 tap a letter to mark the correct answer</legend><div id="quiz-option-fields"></div></fieldset>
                      <button type="button" id="quiz-add-option" class="btn btn-secondary">+ Add option</button>
                    </div>
                    <div id="quiz-fields-order" hidden>
                      <label class="qz-field"><span>Correct sentence</span>
                        <textarea id="quiz-order-input" class="input-field" rows="2" placeholder="e.g. I | have lived | here | since 2010"></textarea>
                        <small class="form-help">Separate the fragments with <b>|</b>, or write plain text to split it into single words (3 to 12 fragments). Students see them shuffled.</small></label>
                      <div id="quiz-order-preview" class="quiz-frags qz-preview" aria-label="Fragments preview"></div>
                    </div>
                    <div id="quiz-fields-text" hidden>
                      <label class="qz-field"><span>Accepted answers (one per line)</span>
                        <textarea id="quiz-text-input" class="input-field" rows="3" placeholder="went&#10;has gone"></textarea>
                        <small class="form-help">Tip: use ____ in the question for the blank. Spaces, final punctuation and curly quotes are ignored when checking.</small></label>
                      <label class="gv-switch qz-set-row"><span class="gv-name">Case sensitive</span><input type="checkbox" id="quiz-text-case"></label>
                    </div>
                    <p id="quiz-form-error" class="form-error" role="alert"></p>
                    <div class="qz-form-actions"><button class="btn btn-primary" type="submit">Save question</button><button class="btn btn-ghost" type="button" id="quiz-cancel">Cancel</button></div>
                  </form>
                </div>`;
            $z("quiz-new").onclick = () => this.edit(null);
            $z("quiz-cancel").onclick = () => { this.editing = null; $z("quiz-form").hidden = true; };
            $z("quiz-add-option").onclick = () => this.optionField("");
            $z("quiz-form").onsubmit = (event) => { event.preventDefault(); this.saveForm(); };
            $z("quiz-type").onchange = () => this.setType($z("quiz-type").value);
            $z("quiz-order-input").addEventListener("input", () => this.renderOrderPreview());
            $z("quiz-prompt-input").addEventListener("input", () => {
                $z("quiz-prompt-count").textContent = `${$z("quiz-prompt-input").value.length} / 2000`;
            });
            $z("quiz-import").onchange = (event) => { const file = event.target.files && event.target.files[0]; event.target.value = ""; this.importFile(file); };
            $z("quiz-examples").onclick = () => this.addExamples();
            ["quiz-set-auto", "quiz-set-by", "quiz-set-seconds", "quiz-set-chain"].forEach((id) => { $z(id).onchange = () => this.saveSettings(); });
            $z("quiz-target").onchange = () => { this.target = $z("quiz-target").value; this.syncAdmin(); };
        }
        const bank = $z("quiz-bank"), h = this.h.bind(this); bank.textContent = "";
        const entries = this.sortedEntries(this.data.questions); // same order Previous / Next use
        $z("quiz-count").textContent = String(entries.length);
        // Tab badge in the Administrator Panel: bank size, with a live dot while a question is on air.
        const tabBadge = $z("badge-quiz");
        if (tabBadge) { tabBadge.textContent = String(entries.length); if (tabBadge.classList) tabBadge.classList.toggle("is-live", !!this.data.live?.question); }
        if (!entries.length) bank.append(h("p", "qz-empty", this.ready ? "No questions yet. Create the first one, import a JSON file, or add the examples." : "Loading questions\u2026"));
        entries.forEach(([id, question], position) => {
            const onAir = this.data.live?.questionId === id;
            const row = h("article", `quiz-bank-row${onAir ? " is-live" : ""}`);
            const info = h("div", "qz-row-info");
            info.append(h("span", "qz-row-num", String(position + 1)), h("div", "qz-row-text"));
            info.lastChild.append(h("strong", "", question.prompt), h("small", "", this.describeQuestion(question) + (onAir ? " \u00B7 ON AIR" : "")));
            const actions = h("div", "qz-row-actions");
            actions.append(
                this.button(this.target ? `Ask ${this.target}` : "Present", async () => {
                    const presented = this.target ? await this.assign(this.target, id) : await this.present(id);
                    if (presented && this.ref && this.data.live?.questionId === id && GameCatalog.available("quiz", Missions.cfg)) { Admin.close(); Router.selectGame("quiz"); }
                }, false, "primary"),
                this.button("Edit", () => this.edit(id)),
                this.button("Delete", async () => {
                    const ok = await Dialog.confirm({
                        title: "Delete question", tone: "danger", confirmLabel: "Delete",
                        message: "Delete this question? If it is on air, it will also be removed from the screen."
                    });
                    if (!ok) return;
                    const removed = await this.write((data) => {
                        if (!data.questions?.[id]) return;
                        delete data.questions[id];
                        if (data.live?.questionId === id) delete data.live;
                        return data;
                    });
                    if (removed && this.editing === id) { this.editing = null; $z("quiz-form").hidden = true; }
                }, false, "ghost")
            );
            row.append(info, actions); bank.append(row);
        });
        $z("quiz-new").disabled = !this.ready || this.busy;
        $z("quiz-form").querySelectorAll("input, textarea, select, button, fieldset").forEach((input) => { input.disabled = !this.ready || this.busy; });
        this.syncSettings(); this.renderTarget();
        this.relabelOptions();
        this.renderHost(); this.renderAdminLive();
    },

    /** Reflects the shared settings in the controls (a control being edited keeps what the Host is typing). */
    syncSettings() {
        const s = this.settings(), lock = !this.ready || this.busy;
        const put = (id, value, prop = "value") => {
            const el = $z(id);
            if (!el) return;
            if (typeof document === "undefined" || document.activeElement !== el) el[prop] = value;
            el.disabled = lock;
        };
        put("quiz-set-auto", s.autoLaunch, "checked"); put("quiz-set-by", s.answerBy);
        put("quiz-set-seconds", String(s.seconds)); put("quiz-set-chain", String(s.chain));
    },

    /** Saves the settings card (one transaction; every device picks the new rules up immediately). */
    saveSettings() {
        if (!this.allowed()) return Promise.resolve(false);
        const next = this.normalizeSettings({
            autoLaunch: $z("quiz-set-auto").checked, answerBy: $z("quiz-set-by").value,
            seconds: $z("quiz-set-seconds").value, chain: $z("quiz-set-chain").value
        });
        return this.write((data) => { data.settings = next; return data; });
    },

    /** "Ask a specific player" selector (kept in sync with the players in the room). */
    renderTarget() {
        const select = $z("quiz-target");
        if (!select || !select.options) return;
        const names = this.playerNames();
        if (this.target && !names.includes(this.target)) this.target = "";
        select.textContent = "";
        const any = this.h("option", "", "Everyone (no turns)"); any.value = ""; select.append(any);
        names.forEach((name) => { const o = this.h("option", "", name); o.value = name; select.append(o); });
        select.value = this.target || "";
    },

    /** Opens the editor for a bank question (id) or a blank one (null). */
    edit(id) {
        if (!this.allowed() || !this.ready || this.busy) return;
        const q = id ? this.data.questions?.[id] : { prompt: "", options: ["", ""], correctIndex: -1 };
        if (!q) return;
        this.editing = id;
        const form = $z("quiz-form"), type = this.typeOf(q);
        form.hidden = false; $z("quiz-form-error").textContent = "";
        $z("quiz-form-title").textContent = id ? "Edit question" : "New question";
        $z("quiz-type").value = type; this.setType(type);
        $z("quiz-prompt-input").value = q.prompt;
        $z("quiz-prompt-count").textContent = `${q.prompt.length} / 2000`;
        $z("quiz-option-fields").textContent = "";
        $z("quiz-order-input").value = type === "order" ? this.toArray(q.fragments).join(" | ") : "";
        $z("quiz-text-input").value = type === "text" ? this.toArray(q.answers).join("\n") : "";
        $z("quiz-text-case").checked = q.caseSensitive === true;
        if (type === "choice") Object.values(q.options).forEach((text, index) => this.optionField(text, index === q.correctIndex));
        this.renderOrderPreview();
        $z("quiz-prompt-input").focus({ preventScroll: true });
        if (form.scrollIntoView) form.scrollIntoView({ block: "nearest", behavior: "smooth" });
    },

    /** Shows the editor fields that belong to the chosen question type. */
    setType(type) {
        $z("quiz-fields-choice").hidden = type !== "choice";
        $z("quiz-fields-order").hidden = type !== "order";
        $z("quiz-fields-text").hidden = type !== "text";
        if (type === "choice" && !$z("quiz-option-fields").children.length) { this.optionField(""); this.optionField(""); }
    },

    /** Live preview of the fragments typed in the "Correct sentence" box. */
    renderOrderPreview() {
        const box = $z("quiz-order-preview");
        if (!box) return;
        box.textContent = "";
        this.splitSentence($z("quiz-order-input").value).forEach((part) => box.append(this.h("span", "quiz-frag", part)));
    },

    /** Adds one option row: [letter = "correct" radio] [text] [remove]. Elements are kept on the row object. */
    optionField(text, checked = false) {
        const root = $z("quiz-option-fields"), h = this.h.bind(this);
        const row = h("div", "quiz-option-field");
        const pick = h("label", "qz-pick");
        const radio = h("input"); radio.type = "radio"; radio.name = "quiz-correct"; radio.checked = checked;
        const badge = h("span", "qz-badge");
        pick.append(radio, badge);
        const input = h("input", "input-field"); input.type = "text"; input.maxLength = 500; input.required = true; input.value = text;
        const remove = h("button", "btn btn-ghost qz-remove", "\u2715"); remove.type = "button";
        remove.onclick = () => { row.remove(); this.relabelOptions(); };
        row.dom = { radio, input, remove, badge };
        row.append(pick, input, remove); root.append(row); this.relabelOptions();
    },

    /** Re-letters rows after add/remove and refreshes accessible names. */
    relabelOptions() {
        const rows = [...$z("quiz-option-fields").children];
        rows.forEach((row, index) => {
            const label = this.label(index), d = row.dom;
            if (!d) return;
            d.badge.textContent = label;
            d.radio.setAttribute("aria-label", `Mark option ${label} as correct`);
            d.input.setAttribute("aria-label", `Text of option ${label}`);
            d.input.placeholder = `Option ${label}`;
            d.remove.setAttribute("aria-label", `Remove option ${label}`);
            d.remove.disabled = this.busy || !this.ready || rows.length <= 2;
        });
    },

    /** Validates the form (any question type) and writes the question to the bank (create or update). */
    async saveForm() {
        if (!this.allowed() || !this.ready || this.busy) return;
        let question;
        try {
            const prompt = $z("quiz-prompt-input").value, type = $z("quiz-type").value;
            if (type === "order") question = this.questionOrder(prompt, this.splitSentence($z("quiz-order-input").value));
            else if (type === "text") question = this.questionText(prompt, $z("quiz-text-input").value.split(/\r?\n/), $z("quiz-text-case").checked);
            else {
                const rows = [...$z("quiz-option-fields").children];
                question = this.question(prompt, rows.map((row) => row.dom.input.value), rows.findIndex((row) => row.dom.radio.checked));
            }
        } catch (error) { $z("quiz-form-error").textContent = error.message; return; }
        const ref = this.ref, editing = this.editing, id = editing || ref.push().key;
        const saved = await this.write((data) => {
            if (editing && !data.questions?.[id]) return; // deleted elsewhere while editing
            data.questions = data.questions || {};
            const previous = data.questions[id];
            // New questions go to the end of the bank; edits keep their place (legacy records stay unordered).
            const record = { ...question };
            if (!previous) record.order = this.nextOrder(data.questions);
            else if (Number.isFinite(previous.order)) record.order = previous.order;
            data.questions[id] = record;
            return data;
        });
        if (saved && this.ref === ref) {
            this.editing = null; $z("quiz-form").hidden = true; Notify.success("Question saved.");
        }
    }
};
