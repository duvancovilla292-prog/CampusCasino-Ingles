/* =========================================================================
   CASINO CAMPUS — HOST / ADMIN CONTROLS
   Administrator Panel (host-only), Host Settings (room, shop and mission management, mission
   resets), rig / chosen-winner toggle, bet limits, audit log, Central Bank admin view, and the
   final DOMContentLoaded bootstrap.
   Load order: 5 of 5 (LAST) — needs every other file.
   Classic <script> (not an ES module): top-level const / function declarations are shared
   between the five files through the page's global lexical scope, so the cross-module
   references of the original single-closure build keep working unchanged.
   ========================================================================= */
"use strict";

/* =========================================================================
   19c. DIALOG — promise-based replacement for window.confirm / window.prompt
   Renders a centered dialog on desktop and a bottom sheet on phones (style.css, "ADMIN v3").
     Dialog.confirm({ title, message, confirmLabel, cancelLabel, tone: "danger" })  -> Promise<boolean>
     Dialog.prompt({ title, message, value, inputType, placeholder, confirmLabel }) -> Promise<string | null>
   Only one dialog is open at a time; Escape / backdrop tap cancels; focus is trapped and restored.
   ========================================================================= */
const Dialog = (() => {
    let layer = null, settle = null, opener = null;

    const el = (tag, cls, text) => {
        const node = document.createElement(tag);
        if (cls) node.className = cls;
        if (text != null) node.textContent = text;
        return node;
    };

    /** Closes the open dialog (if any) and resolves its promise with `value`. */
    function finish(value) {
        if (!layer) return;
        const node = layer, done = settle;
        layer = settle = null;
        document.removeEventListener("keydown", onKey, true);
        node.classList.add("is-closing");
        window.setTimeout(() => node.remove(), 180);
        if (opener && opener.isConnected) opener.focus({ preventScroll: true });
        opener = null;
        done(value);
    }

    /** Capture-phase key handler: Escape cancels, Tab stays inside the dialog. */
    function onKey(event) {
        if (!layer) return;
        const cancelValue = layer.dataset.mode === "prompt" ? null : false;
        if (event.key === "Escape") {
            event.preventDefault(); event.stopPropagation();
            finish(cancelValue);
        } else if (event.key === "Tab") {
            const items = [...layer.querySelectorAll("button, input")].filter((n) => !n.disabled);
            if (!items.length) return;
            const first = items[0], last = items[items.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
    }

    function open(o) {
        if (layer) finish(o.mode === "prompt" ? null : false); // never stack dialogs
        return new Promise((resolve) => {
            settle = resolve; opener = document.activeElement;
            const prompt = o.mode === "prompt", cancelValue = prompt ? null : false;
            layer = el("div", "ui-dialog-overlay"); layer.dataset.mode = o.mode;
            const box = el("div", "ui-dialog");
            box.setAttribute("role", prompt ? "dialog" : "alertdialog"); box.setAttribute("aria-modal", "true");
            const title = el("h3", "ui-dialog-title", o.title || (prompt ? "Enter a value" : "Please confirm"));
            title.id = "ui-dialog-title"; box.setAttribute("aria-labelledby", title.id);
            const grab = el("div", "sheet-grabber"); grab.setAttribute("aria-hidden", "true");
            box.append(grab, title);
            if (o.message) {
                const message = el("p", "ui-dialog-message", o.message);
                message.style.whiteSpace = "pre-line"; // keeps the line breaks of multi-line summaries
                box.append(message);
            }

            let input = null;
            if (prompt) {
                input = el("input", "input-field"); input.type = o.inputType || "text";
                if (input.type === "number") { input.min = "0"; input.inputMode = "numeric"; }
                input.value = o.value == null ? "" : String(o.value);
                if (o.placeholder) input.placeholder = o.placeholder;
                input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); finish(input.value); } });
                box.append(input);
            }
            const cancel = el("button", "btn btn-ghost", o.cancelLabel || "Cancel"); cancel.type = "button";
            cancel.addEventListener("click", () => finish(cancelValue));
            const ok = el("button", `btn ${o.tone === "danger" ? "btn-danger" : "btn-primary"}`, o.confirmLabel || "OK"); ok.type = "button";
            ok.addEventListener("click", () => finish(prompt ? input.value : true));
            const actions = el("div", "ui-dialog-actions"); actions.append(cancel, ok);
            box.append(actions); layer.append(box);
            layer.addEventListener("click", (e) => { if (e.target === layer) finish(cancelValue); });

            document.body.appendChild(layer);
            document.addEventListener("keydown", onKey, true);
            // Destructive confirmations focus "Cancel" first so a stray Enter cannot delete anything.
            const focusTarget = input || (o.tone === "danger" ? cancel : ok);
            focusTarget.focus({ preventScroll: true });
            if (input) input.select();
        });
    }

    return {
        confirm: (options) => open({ mode: "confirm", ...options }),
        prompt: (options) => open({ mode: "prompt", ...options })
    };
})();

/* =========================================================================
   19d. PRESENCE — who is online right now (rooms/<code>/presence/<username>)
   Each device writes its own node ({ ts, deviceId }) and asks the server to delete it on disconnect,
   so the count is real-time and self-healing. The deviceId tells the Admin Panel which device is
   behind each online player (used to give / remove admin rank per device). If database rules refuse it, `supported` stays false
   and the UI simply hides the online indicators.
   ========================================================================= */
const Presence = {
    users: {}, supported: false, broken: false,
    ref: null, listener: null, mine: null, connRef: null, connListener: null,

    /** Firebase keys cannot contain . $ # [ ] / */
    key(name) { return String(name).replace(/[.$#\[\]\/]/g, "_"); },
    isOnline(name) { return this.supported && !!this.users[this.key(name)]; },

    start() {
        this.stop();
        if (!Room.db || !Room.code) return;
        const base = Room.db.ref(`rooms/${Room.code}/presence`);
        this.ref = base;
        this.listener = (snapshot) => {
            if (this.ref !== base) return; // stale event from a previous room
            this.users = snapshot.val() || {};
            this.supported = !this.broken;
            PubSub.emit("presence-updated");
        };
        base.on("value", this.listener, () => {
            if (this.ref !== base) return;
            this.supported = false; this.users = {};
            PubSub.emit("presence-updated");
        });
        if (!State.username) return;
        const mine = base.child(this.key(State.username));
        this.mine = mine;
        this.connRef = Room.db.ref(".info/connected");
        this.connListener = (snapshot) => {
            if (snapshot.val() !== true || this.mine !== mine) return;
            // Register the cleanup first, then announce: a crash in between can never leave a ghost.
            mine.onDisconnect().remove()
                .then(() => mine.set({ ts: TS(), deviceId: DeviceStore.getDeviceId() }))
                .catch(() => { this.broken = true; this.supported = false; PubSub.emit("presence-updated"); });
        };
        this.connRef.on("value", this.connListener);
    },

    stop() {
        if (this.ref && this.listener) this.ref.off("value", this.listener);
        if (this.connRef && this.connListener) this.connRef.off("value", this.connListener);
        if (this.mine) { this.mine.onDisconnect().cancel().catch(() => {}); this.mine.remove().catch(() => {}); }
        this.ref = this.listener = this.mine = this.connRef = this.connListener = null;
        this.users = {}; this.supported = false; this.broken = false;
    }
};

/* =========================================================================
   19e. GAMES ADMIN (tab "Casual Games") — category + per-game visibility switches
   Writes rooms/<code>/cfg/{sectionsDisabled|disabled}/<key> (same nodes the game menu reads via
   Missions.cfg / GameCatalog.apply). The inputs carry data-visibility so applyCfg() in
   ui-audio.js keeps them in sync with Firebase automatically; refresh() updates counters.
   ========================================================================= */
const GamesAdmin = {
    ICONS: { casino: "\uD83C\uDFB0", tools: "\uD83E\uDDF0", casual: "\uD83C\uDFB2" },
    built: false,

    root() { return $z("admin-games"); },

    /** How many games of a category players can currently see. */
    stats(cat) {
        const cfg = Missions.cfg, sectionOn = !cfg.sectionsDisabled?.[cat.id];
        const on = sectionOn ? cat.games.filter((key) => !cfg.disabled?.[key]).length : 0;
        return { total: cat.games.length, on, sectionOn };
    },

    /** One iOS-style switch row. `master` styles the whole-section switch. */
    switchRow(text, visibility, key, aria, master) {
        const label = AdminCtl.el("label", `gv-switch${master ? " gv-master" : ""}`);
        const input = document.createElement("input");
        input.type = "checkbox"; input.setAttribute("role", "switch");
        input.dataset.visibility = visibility; input.dataset.key = key; input.setAttribute("aria-label", aria);
        label.append(AdminCtl.el("span", "gv-name", text), input);
        return label;
    },

    build() {
        const root = this.root();
        if (!root) return;
        const el = AdminCtl.el.bind(AdminCtl);
        root.textContent = "";
        GameCatalog.categories.forEach((cat) => {
            const card = el("section", "gv-card"); card.dataset.cat = cat.id;
            const head = el("header", "gv-head"), title = el("div", "gv-title"), h3 = el("h3");
            const icon = el("span", "gv-ic", this.ICONS[cat.id] || "\uD83C\uDFAE"); icon.setAttribute("aria-hidden", "true");
            h3.append(icon, document.createTextNode(cat.label));
            title.append(h3, el("span", "gv-count badge", ""));
            head.append(title, this.switchRow("Whole section", "sectionsDisabled", cat.id, `Show the ${cat.label} section to players`, true));
            const list = el("ul", "gv-list");
            cat.games.forEach((key) => {
                const label = GameCatalog.label(key), item = el("li", "gv-row");
                item.append(this.switchRow(label, "disabled", key, `Show ${label} to players`, false));
                list.append(item);
            });
            card.append(head, list); root.append(card);
        });
        this.built = true;
    },

    /** Builds on first use (Host only) and refreshes counters. */
    render() {
        if (!AdminCtl.allowed()) { this.clear(); return; }
        if (!this.built) this.build();
        this.refresh();
    },

    /** Syncs switch positions, per-category badges and the tab counter with the live room config. */
    refresh() {
        const root = this.root();
        if (!this.built || !root || !AdminCtl.allowed()) return;
        const cfg = Missions.cfg;
        let active = 0;
        GameCatalog.categories.forEach((cat) => {
            const card = root.querySelector(`[data-cat="${cat.id}"]`);
            if (!card) return;
            const { total, on, sectionOn } = this.stats(cat);
            active += on;
            card.classList.toggle("is-off", !sectionOn);
            card.querySelectorAll("[data-visibility]").forEach((input) => {
                input.checked = !cfg[input.dataset.visibility]?.[input.dataset.key];
            });
            const badge = card.querySelector(".gv-count");
            badge.textContent = sectionOn ? `${on}/${total} active` : "Section off";
            badge.className = `gv-count badge ${!sectionOn || on === 0 ? "badge-off" : on === total ? "badge-ok" : "badge-warn"}`;
        });
        $z("badge-games").textContent = String(active);
    },

    clear() {
        const root = this.root();
        if (root) root.textContent = "";
        this.built = false;
        $z("badge-games").textContent = "0";
    },

    /** Delegated change handler (bound once in Admin.init). */
    async onChange(event) {
        const input = event.target.closest("[data-visibility]");
        if (!input) return;
        if (!AdminCtl.allowed() || !Room.db || !Room.code) { input.checked = !input.checked; return; }
        const { visibility, key } = input.dataset;
        const cat = GameCatalog.categories.find((c) => c.id === key);
        const name = visibility === "sectionsDisabled" ? (cat ? cat.label : key) : GameCatalog.label(key);
        input.disabled = true;
        try {
            await Room.db.ref(`rooms/${Room.code}/cfg/${visibility}/${key}`).set(!input.checked);
            Notify.success(`${name} ${input.checked ? "enabled" : "disabled"}.`);
        } catch (error) {
            input.checked = !input.checked;
            Notify.error("Could not save visibility. Please try again.");
        } finally {
            input.disabled = false;
        }
    }
};

/* =========================================================================
   19f. BACKUP — full room export / import (data.json)
   -------------------------------------------------------------------------
   One structured JSON file backs up and restores the whole room:

     {
       app, schemaVersion, exportedAt, roomCode,
       games: [...],                         // alias of modules.casualGames.games so the file also works
                                             // as the repository seed (Arcade.loadSeed reads `games`)
       modules: {
         casualGames: { custom, games[] },   // title, icon/emoji, iframe src, thumbnail, size, enabled
         quiz:        { questions[], live, settings }, // questions of every type (choice / order / text) in navigation
                                             // order + "question on air" state + turn / auto-launch settings
                                             // (live.questionId / index / optionsVisible / answerVisible)
         store:       { items[], hidden[] },  // host-added items (prices, SVG, icons) + items removed from sale
         room:        { cfg, visibility, settings, limits, bank },
         players:     { <username>: {...} }
       }
     }

   - Export reads the server state once, so the file always matches what players see.
   - Import never trusts the file: every module is re-validated with the same normalizers the
     admin forms use (Arcade.normalizeList, Quiz.parseQuestion, Catalog.norm / Svg.clean), keys are
     checked against Firebase's key rules, sizes are capped, and invalid entries are skipped
     (and reported) instead of being written.
   - Everything is written with ONE multi-path update(): Firebase applies it atomically (all or
     nothing) and the room listeners then refresh every connected player instantly.
   - The secret "rig / chosen winner" switch is deliberately never exported or imported.
   - Older files ({ players } or a bare players map) and bare game lists still import.
   ========================================================================= */
/* BACKUP:BEGIN (tests/backup_test.cjs slices the file between these markers) */
const Backup = {
    APP: "casino-campus",
    VERSION: 2,
    FILE_NAME: "data.json",
    MAX_BYTES: 5 * 1024 * 1024,
    MAX: { questions: 200, items: 300, names: 80, players: 500, depth: 8 },
    busy: false,

    /* ------------------------------ small pure helpers ------------------------------ */

    isObj(v) { return v !== null && typeof v === "object" && !Array.isArray(v); },

    /** Firebase keys must be non-empty and cannot contain . $ # [ ] / or control characters. */
    safeKey(k) { return typeof k === "string" && k.length > 0 && k.length <= 100 && !/[.$#\[\]\/\u0000-\u001F\u007F]/.test(k); },

    /** True when a value holds only JSON primitives and Firebase-safe keys, and is not absurdly deep. */
    cleanTree(v, depth = 0) {
        if (depth > this.MAX.depth) return false;
        if (Array.isArray(v)) return v.every((x) => this.cleanTree(x, depth + 1));
        if (this.isObj(v)) return Object.keys(v).every((k) => this.safeKey(k) && this.cleanTree(v[k], depth + 1));
        return v === null || typeof v === "string" || typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v));
    },

    clamp(v, lo, hi, def) { v = Number(v); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def; },

    /** Keeps only { key: true } entries, optionally restricted to a list of known keys. */
    flags(obj, known) {
        const out = {};
        if (this.isObj(obj)) Object.keys(obj).forEach((k) => { if (obj[k] === true && (!known || known.includes(k))) out[k] = true; });
        return out;
    },

    /** Empty maps are stored as null (Firebase cannot hold empty objects). */
    orNull(obj) { return Object.keys(obj).length ? obj : null; },

    /** Firebase hands arrays back as objects when indexes are sparse; accept both shapes. */
    toList(v) { return Array.isArray(v) ? v : Object.values(this.isObj(v) ? v : {}); },

    /** Fresh push-style key (falls back to a random id when no room is connected, e.g. in tests). */
    newKey() {
        const ref = typeof zref === "function" ? zref("quiz") : null;
        return ref ? ref.push().key : "q" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    },

    /* ------------------------------ EXPORT ------------------------------ */

    /** Reads every module from the server (one-shot reads) and packs it into the backup object. */
    async collect() {
        const read = (path) => { const ref = zref(path); return ref ? ref.once("value").then((s) => s.val()) : Promise.resolve(null); };
        const [quiz, shop, cfg, adm, lim, bank, players] = await Promise.all(["quiz", "shop", "cfg", "adm/cfg", "lim", "bank/cfg", "players"].map(read));
        return this.build({ quiz, shop, cfg, adm, lim, bank, players, games: Arcade.list(), custom: !!Arcade.remote, roomCode: State.roomCode });
    },

    /** Pure: raw Firebase nodes -> backup object (no DOM / network, so it can be unit-tested). */
    build(raw) {
        const games = (raw.games || []).map((g) => ({ ...g }));

        // Same order Previous / Next use (Quiz.sortedEntries); the array position IS the order in the file.
        const questions = Quiz.sortedEntries(raw.quiz && raw.quiz.questions)
            .map(([id, q]) => ({ id, ...Quiz.exportQuestion(q) }));   // any type: choice / order / text
        const lv = raw.quiz && raw.quiz.live;
        const live = lv && this.isObj(lv.question) ? {
            questionId: lv.questionId || null,
            index: Number.isInteger(lv.index) ? lv.index : null,   // position synced to the room (Previous / Next)
            optionsVisible: !!lv.optionsVisible,                 // "On air": options A/B/C/D hidden until revealed
            answerVisible: !!lv.answerVisible,
            question: Quiz.exportQuestion(lv.question)
        } : null;                                              // (running turns are temporary and are not exported)
        const settings = raw.quiz && raw.quiz.settings ? Quiz.normalizeSettings(raw.quiz.settings) : null;

        const hiddenMap = (raw.shop && raw.shop.hidden) || {};
        const items = Object.values((raw.shop && raw.shop.items) || {}).filter((i) => this.isObj(i)).map((i) => {
            const out = { slot: i.slot, id: i.id, name: i.name, price: i.price, rarity: i.rarity };
            if (i.icon) out.icon = i.icon;
            if (i.svg) out.svg = i.svg;
            if (i.color) out.color = i.color;
            return out;
        });

        const c = raw.cfg || {};
        const adm = raw.adm, lim = raw.lim, bank = raw.bank;
        return {
            app: this.APP,
            schemaVersion: this.VERSION,
            exportedAt: new Date().toISOString(),
            roomCode: raw.roomCode || null,
            games,
            modules: {
                casualGames: { custom: !!raw.custom, games },
                quiz: { questions, live, settings },
                store: { items, hidden: Object.keys(hiddenMap).filter((k) => hiddenMap[k]) },
                room: {
                    cfg: {
                        roomName: c.roomName || "", bonusMult: c.bonusMult || 1, missionsOn: c.missionsOn !== false,
                        names: this.isObj(c.names) ? { ...c.names } : {}, mDisabled: this.flags(c.mDisabled)
                    },
                    visibility: { sectionsDisabled: this.flags(c.sectionsDisabled), disabled: this.flags(c.disabled) },
                    settings: adm ? { turnSec: adm.turnSec, rounds: adm.rounds, difficulty: adm.difficulty } : null,
                    limits: lim ? { g: lim.g, games: this.isObj(lim.games) ? { ...lim.games } : {} } : null,
                    bank: bank ? { on: bank.on !== false, max: bank.max, rate: bank.rate, auto: !!bank.auto } : null
                },
                players: this.isObj(raw.players) ? raw.players : {}
            }
        };
    },

    /** Saves the object as a file (Blob + temporary link; works on GitHub Pages and on phones). */
    download(payload) {
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob), link = document.createElement("a");
        link.href = url; link.download = this.FILE_NAME;
        document.body.appendChild(link); link.click(); link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000); // revoking at once cancels the download in some browsers
    },

    async exportData() {
        if (!AdminCtl.allowed()) return Notify.error("Only the unlocked Host can export data.");
        if (this.busy) return;
        this.busy = true;
        try {
            const payload = await this.collect(), m = payload.modules;
            this.download(payload);
            Notify.success(`${this.FILE_NAME} downloaded: ${m.casualGames.games.length} games, ${m.quiz.questions.length} questions, ` +
                `${m.store.items.length} store items, ${Object.keys(m.players).length} players.`);
        } catch (e) {
            Notify.error("Could not export the data. Check your connection and try again.");
        } finally { this.busy = false; }
    },

    /* ------------------------------ IMPORT: validation ------------------------------ */

    /**
     * Validates and sanitizes a parsed JSON file. Returns { plan, skipped } where `plan` only holds
     * clean data ready to write; throws an Error with a user-facing message when nothing is usable.
     */
    validate(json) {
        if (Array.isArray(json)) json = { games: json };            // a bare game list (repository data/data.json)
        if (!this.isObj(json)) throw new Error("The file must contain a JSON object.");
        if (json.app != null && json.app !== this.APP) throw new Error("This file was not exported from Casino Campus.");
        if (json.schemaVersion != null && !(Number.isInteger(json.schemaVersion) && json.schemaVersion >= 1 && json.schemaVersion <= this.VERSION)) {
            throw new Error("This backup comes from a newer version of the app.");
        }
        const mods = this.isObj(json.modules) ? json.modules : {};
        const plan = {}, skipped = { players: 0, games: 0, questions: 0, items: 0 };

        /* ----- players (also the legacy shapes: { players } or the players map itself) ----- */
        let rawPlayers = mods.players !== undefined ? mods.players : json.players;
        const looksLegacy = rawPlayers === undefined && json.modules === undefined && json.games === undefined && json.app == null &&
            Object.keys(json).length > 0 && Object.values(json).every((v) => this.isObj(v));
        if (looksLegacy) rawPlayers = json;
        if (rawPlayers !== undefined) {
            if (!this.isObj(rawPlayers)) throw new Error("The players section is not valid.");
            const players = {};
            let count = 0;
            Object.keys(rawPlayers).forEach((key) => {
                const p = rawPlayers[key];
                if (count >= this.MAX.players || !this.safeKey(key) || !this.isObj(p) || !this.cleanTree(p) ||
                    (p.balance != null && !Number.isFinite(p.balance))) { skipped.players++; return; }
                players[key] = { ...p, username: key };            // the node key is the source of truth
                count++;
            });
            if (count) plan.players = players;
        }

        /* ----- casual games (iframe list) ----- */
        const cg = mods.casualGames !== undefined ? mods.casualGames : (json.games !== undefined ? { games: json.games } : undefined);
        if (cg !== undefined) {
            const raw = Array.isArray(cg) ? cg : (this.isObj(cg) ? cg.games : null);
            if (!Array.isArray(raw) && !this.isObj(raw)) throw new Error("The casual games section is not valid.");
            const list = this.toList(raw);
            const r = Arcade.normalizeList(list);                    // checks title, iframe host allow-list, thumbnail, size, unique ids
            skipped.games = r.skipped + Math.max(0, list.length - Arcade.MAX_GAMES);
            if (r.list.length || !skipped.games) plan.casualGames = r.list;
        }

        /* ----- quiz (questions + the "question on air" state) ----- */
        if (mods.quiz !== undefined) {
            const qz = mods.quiz;
            if (!this.isObj(qz)) throw new Error("The quiz section is not valid.");
            // Arrays keep their file order; id -> question maps are sorted like the app does (legacy records first).
            const rawMap = this.isObj(qz.questions) ? qz.questions : {};
            const entries = Array.isArray(qz.questions)
                ? qz.questions.map((q) => [this.isObj(q) ? q.id : null, q])
                : Quiz.sortedEntries(rawMap);
            if (!Array.isArray(qz.questions)) skipped.questions += Object.keys(rawMap).length - entries.length;
            const questions = {}, idMap = {};
            let count = 0;
            entries.forEach(([oldId, q]) => {
                if (count >= this.MAX.questions || !this.isObj(q)) { skipped.questions++; return; }
                try {
                    const clean = Quiz.parseQuestion(q);             // same rules as the editor, for every question type
                    let id = String(oldId == null ? "" : oldId);
                    if (!/^[A-Za-z0-9_-]{1,40}$/.test(id) || questions[id]) id = this.newKey();
                    questions[id] = { ...clean, order: count };     // contiguous 0..n-1: Previous / Next follow the file order
                    if (oldId != null) idMap[String(oldId)] = id;
                    count++;
                } catch (e) { skipped.questions++; }
            });
            let live = null;
            const lv = qz.live;
            if (this.isObj(lv)) {
                const mapped = idMap[String(lv.questionId)];
                let snapshot = mapped ? questions[mapped] : null;
                if (!snapshot && this.isObj(lv.question)) {
                    try { snapshot = Quiz.parseQuestion(lv.question); } catch (e) { snapshot = null; }
                }
                if (snapshot) {
                    // Choice / ordering: the answer can only be visible once the options are. Free text has no options to reveal.
                    const open = lv.optionsVisible === true;
                    live = {
                        id: this.newKey(),                            // new token: stale controls can never hit the restored question
                        question: Quiz.snapshot(snapshot),            // ordering questions get a fresh shared shuffle
                        optionsVisible: open,
                        answerVisible: (open || !Quiz.hasOptions(snapshot)) && lv.answerVisible === true
                    };
                    if (mapped) { live.questionId = mapped; live.index = questions[mapped].order; live.total = count; }
                }
            }
            if (count || !skipped.questions) plan.quiz = { questions, live };
            if (plan.quiz && qz.settings != null) plan.quiz.settings = Quiz.normalizeSettings(qz.settings); // turns / auto-launch rules
        }

        /* ----- store (host-added items + items removed from sale) ----- */
        if (mods.store !== undefined) {
            const st = mods.store;
            if (!this.isObj(st)) throw new Error("The store section is not valid.");
            const list = this.toList(st.items), items = {};
            skipped.items = Math.max(0, list.length - this.MAX.items);
            list.slice(0, this.MAX.items).forEach((raw) => {
                const it = this.isObj(raw) ? Catalog.norm(raw) : null; // validates slot / id / price and sanitizes raw SVG
                if (!it) { skipped.items++; return; }
                const rec = { slot: it.slot, id: it.id, name: it.name, price: it.price, rarity: it.rarity };
                if (it.icon) rec.icon = it.icon;
                if (it.svg) rec.svg = it.svg;
                if (it.color) rec.color = it.color;
                items[Catalog.key(it.slot, it.id)] = rec;               // key is recomputed, never trusted
            });
            const hidden = {};
            const hiddenList = Array.isArray(st.hidden) ? st.hidden : Object.keys(this.isObj(st.hidden) ? st.hidden : {}).filter((k) => st.hidden[k] === true);
            hiddenList.forEach((k) => {
                const m = /^([a-z]+):([a-z0-9_-]{1,40})$/.exec(String(k));
                if (m && SLOTS.includes(m[1])) hidden[m[0]] = true;
            });
            if (Object.keys(items).length || !skipped.items) plan.store = { items, hidden };
        }

        /* ----- room & admin settings ----- */
        if (mods.room !== undefined) {
            const rm = mods.room;
            if (!this.isObj(rm)) throw new Error("The room settings section is not valid.");
            const room = {};
            if (this.isObj(rm.cfg)) {
                const c = rm.cfg, names = {};
                let n = 0;
                if (this.isObj(c.names)) Object.keys(c.names).forEach((k) => {
                    const v = String(c.names[k] == null ? "" : c.names[k]).trim().slice(0, 32);
                    if (n < this.MAX.names && /^[A-Za-z0-9_-]{1,48}$/.test(k) && v) { names[k] = v; n++; }
                });
                room.cfg = {
                    roomName: String(c.roomName || "").trim().slice(0, 40),
                    bonusMult: Math.round(this.clamp(c.bonusMult, 0, 10, 1) * 100) / 100,
                    missionsOn: c.missionsOn !== false,
                    names,
                    mDisabled: this.flags(c.mDisabled, Missions.QUESTS.map((q) => q.id))
                };
            }
            if (this.isObj(rm.visibility)) {
                room.visibility = {
                    sectionsDisabled: this.flags(rm.visibility.sectionsDisabled, GameCatalog.categories.map((c) => c.id)),
                    disabled: this.flags(rm.visibility.disabled, GameCatalog.categories.flatMap((c) => c.games))
                };
            }
            if (this.isObj(rm.settings)) {
                const s = rm.settings;
                room.settings = {
                    turnSec: Math.round(this.clamp(s.turnSec, 5, 600, RoomCfg.DEF.turnSec)),
                    rounds: Math.round(this.clamp(s.rounds, 1, 20, RoomCfg.DEF.rounds)),
                    difficulty: ["easy", "normal", "hard"].includes(s.difficulty) ? s.difficulty : "normal"
                };
            }
            if (this.isObj(rm.limits)) {
                const games = {};
                if (this.isObj(rm.limits.games)) Object.keys(rm.limits.games).forEach((k) => {
                    const v = Math.round(Number(rm.limits.games[k]));
                    if (/^[A-Za-z0-9:_-]{1,48}$/.test(k) && v > 0 && v <= 1e9) games[k] = v;
                });
                room.limits = { g: Math.round(this.clamp(rm.limits.g, 1, 1e9, BetLimits.DEF)), games };
            }
            if (this.isObj(rm.bank)) {
                const b = rm.bank;
                room.bank = { on: b.on !== false, max: Math.round(this.clamp(b.max, 1, 1e9, 500)), rate: this.clamp(b.rate, 0, 100, 10), auto: b.auto === true };
            }
            if (Object.keys(room).length) plan.room = room;
        }

        if (!Object.keys(plan).length) {
            const any = skipped.players + skipped.games + skipped.questions + skipped.items > 0;
            throw new Error(any ? "None of the entries in that file were valid." : "No importable data found in that file.");
        }
        return { plan, skipped };
    },

    /** Human-readable summary of what an import will replace (shown in the confirmation dialog). */
    describe(plan) {
        const n = (o) => Object.keys(o).length, lines = [];
        if (plan.casualGames) lines.push(`\u2022 Casual games: ${plan.casualGames.length}`);
        if (plan.quiz) lines.push(`\u2022 Quiz: ${n(plan.quiz.questions)} question(s)${plan.quiz.live ? ", question on air restored" : ""}${plan.quiz.settings ? ", quiz settings" : ""}`);
        if (plan.store) lines.push(`\u2022 Store: ${n(plan.store.items)} custom item(s), ${n(plan.store.hidden)} removed from sale`);
        if (plan.room) {
            const r = plan.room, parts = [];
            if (r.cfg) parts.push("room options");
            if (r.visibility) parts.push("game visibility");
            if (r.settings) parts.push("turn rules");
            if (r.limits) parts.push("bet limits");
            if (r.bank) parts.push("bank");
            lines.push(`\u2022 Room & admin settings: ${parts.join(", ")}`);
        }
        if (plan.players) lines.push(`\u2022 Players: ${n(plan.players)} (merged by username)`);
        return lines;
    },

    /** "Skipped 2 games, 1 question." — or an empty string when nothing was rejected. */
    skippedText(skipped) {
        const parts = [["players", "player"], ["games", "game"], ["questions", "question"], ["items", "store item"]]
            .filter(([k]) => skipped[k] > 0).map(([k, label]) => `${skipped[k]} ${label}${skipped[k] === 1 ? "" : "s"}`);
        return parts.length ? `Skipped invalid entries: ${parts.join(", ")}.` : "";
    },

    /* ------------------------------ IMPORT: write ------------------------------ */

    /** Pure: sanitized plan -> one multi-path update object, relative to rooms/<code>/. */
    toUpdates(plan) {
        const u = {}, by = State.username || "host";
        if (plan.casualGames) {
            const games = {};
            plan.casualGames.forEach((g, i) => { games[g.id] = { ...g, order: i }; });   // same node shape as Arcade.persist()
            u.arcade = { custom: true, games, ts: TS(), by };
        }
        if (plan.quiz) {
            u["quiz/questions"] = this.orNull(plan.quiz.questions);
            u["quiz/live"] = plan.quiz.live;                                              // null clears the screen
            if (plan.quiz.settings) u["quiz/settings"] = plan.quiz.settings;              // only when the file carries them
        }
        if (plan.store) {
            const items = {};
            Object.keys(plan.store.items).forEach((k) => { items[k] = { ...plan.store.items[k], by, ts: TS() }; });
            u["shop/items"] = this.orNull(items);
            u["shop/hidden"] = this.orNull(plan.store.hidden);
        }
        if (plan.room) {
            const r = plan.room;
            // Individual children (never the whole cfg node) so the secret rig switch is left untouched.
            if (r.cfg) {
                u["cfg/roomName"] = r.cfg.roomName; u["cfg/bonusMult"] = r.cfg.bonusMult; u["cfg/missionsOn"] = r.cfg.missionsOn;
                u["cfg/names"] = this.orNull(r.cfg.names); u["cfg/mDisabled"] = this.orNull(r.cfg.mDisabled);
            }
            if (r.visibility) {
                u["cfg/sectionsDisabled"] = this.orNull(r.visibility.sectionsDisabled);
                u["cfg/disabled"] = this.orNull(r.visibility.disabled);
            }
            if (r.settings) u["adm/cfg"] = { ...r.settings, ts: TS() };
            if (r.limits) u.lim = { g: r.limits.g, games: r.limits.games };
            if (r.bank) u["bank/cfg"] = r.bank;
        }
        if (plan.players) Object.keys(plan.players).forEach((k) => { u["players/" + k] = plan.players[k]; });
        return u;
    },

    /** Writes the plan atomically, then refreshes the panels that are currently open. */
    async apply(plan) {
        const root = Room.db && Room.code ? Room.db.ref(`rooms/${Room.code}`) : null;
        if (!root) throw new Error("Not connected to a room.");
        await root.update(this.toUpdates(plan));      // all or nothing; local listeners fire immediately
        // Listeners (Arcade, Quiz, Catalog, Missions cfg, RoomCfg, BetLimits, Bank, players) already updated the
        // local state; refresh the open panels explicitly as well.
        Arcade.repoDirty = true;
        if (typeof Arcade.updateWarn === "function") Arcade.updateWarn();
        Admin.renderTable();
        Quiz.syncAdmin();
    },

    /* ------------------------------ IMPORT: UI flow ------------------------------ */

    /** <input type="file"> change handler. */
    importData(event) {
        const input = event.target, file = input.files && input.files[0];
        input.value = "";                              // lets the Host pick the same file again later
        if (!file) return;
        if (!AdminCtl.allowed()) return Notify.error("Only the unlocked Host can import data.");
        if (file.size > this.MAX_BYTES) return Notify.error("That file is too large (5 MB maximum).");
        const reader = new FileReader();
        reader.onerror = () => Notify.error("Could not read that file.");
        reader.onload = () => this.run(String(reader.result));
        reader.readAsText(file);
    },

    /** Parse -> validate -> confirm -> write -> toast. */
    async run(text) {
        if (this.busy) return;
        let parsed, result;
        try { parsed = JSON.parse(text); } catch (e) { return Notify.error("That file is not valid JSON."); }
        try { result = this.validate(parsed); } catch (e) { return Notify.error(e.message || "That file doesn't have a valid format."); }
        const { plan, skipped } = result, extra = this.skippedText(skipped);
        const ok = await Dialog.confirm({
            title: "Import data", tone: "danger", confirmLabel: "Import & sync",
            message: "This replaces the following data in this room and syncs it to every connected player right away:\n" +
                this.describe(plan).join("\n") + (extra ? "\n\n" + extra : "") + "\n\nThis cannot be undone."
        });
        if (!ok || !AdminCtl.allowed()) return;
        this.busy = true;
        try {
            await this.apply(plan);
            Audit.log("config", "Backup imported: " + this.describe(plan).map((l) => l.replace("\u2022 ", "")).join("; "));
            Notify.success("Data successfully imported and synced");
            if (extra) Notify.warning(extra);
        } catch (e) {
            Notify.error("Import failed and nothing was changed. Check your connection and the database rules.");
        } finally { this.busy = false; }
    }
};
/* BACKUP:END */

/* =========================================================================
   20. ADMINISTRATOR PANEL (Host-only)
   ========================================================================= */
const Admin = {
    unlocked: false,
    tab: "players",      // last tab shown (restored when the panel is reopened)
    closeTimer: 0,

    init() {
        DOM.btnOpenAdmin.addEventListener("click", () => this.open());
        DOM.btnOpenAdminLobby.addEventListener("click", () => this.open());
        DOM.btnAdminClose.addEventListener("click", () => this.close());
        DOM.adminModal.addEventListener("click", (event) => {
            if (event.target === DOM.adminModal) this.close();
        });
        DOM.btnAdminUnlock.addEventListener("click", () => this.tryUnlock());
        DOM.inputAdminCode.addEventListener("keydown", (event) => {
            if (event.key === "Enter") this.tryUnlock();
        });
        DOM.btnAdminExport.addEventListener("click", () => this.exportData());
        DOM.inputAdminImport.addEventListener("change", (event) => this.importData(event));
        DOM.btnAdminResetAll.addEventListener("click", () => this.resetAll());

        // ---- Tabs: click + keyboard (Left / Right / Home / End), WAI-ARIA tablist pattern ----
        const tabs = DOM.adminModal.querySelector(".admin-tabs");
        tabs.addEventListener("click", (event) => {
            const button = event.target.closest("[data-admin-tab]");
            if (button) this.setTab(button.dataset.adminTab);
        });
        tabs.addEventListener("keydown", (event) => {
            const list = [...tabs.querySelectorAll("[data-admin-tab]")];
            const at = list.indexOf(document.activeElement);
            if (at < 0) return;
            const target = { ArrowRight: list[(at + 1) % list.length], ArrowLeft: list[(at - 1 + list.length) % list.length], Home: list[0], End: list[list.length - 1] }[event.key];
            if (!target) return;
            event.preventDefault(); this.setTab(target.dataset.adminTab); target.focus();
        });

        // ---- Per-tab widgets ----
        $z("admin-player-search").addEventListener("input", () => this.renderTable());
        $z("admin-games").addEventListener("change", (event) => GamesAdmin.onChange(event));
        $z("btn-admin-host-tools").addEventListener("click", () => {
            this.close();
            const settings = document.getElementById("btn-host-settings");
            if (settings) settings.click();
        });
        // Escape closes the panel unless a dialog / popup sits on top of it.
        document.addEventListener("keydown", (event) => {
            if (event.key !== "Escape" || DOM.adminModal.hidden) return;
            if (document.querySelector(".ui-dialog-overlay, .cx-pop-layer")) return;
            this.close();
        });

        PubSub.on("players-updated", () => {
            if (this.unlocked && !DOM.adminModal.hidden) this.renderTable();
        });
        PubSub.on("presence-updated", () => {
            if (this.unlocked && !DOM.adminModal.hidden) this.renderTable();
        });
    },

    /** Shows one tab panel and hides the others. Unknown names fall back to "players". */
    setTab(name) {
        const tabs = [...DOM.adminModal.querySelectorAll("[data-admin-tab]")];
        if (!tabs.some((tab) => tab.dataset.adminTab === name)) name = "players";
        this.tab = name;
        tabs.forEach((tab) => {
            const on = tab.dataset.adminTab === name;
            tab.setAttribute("aria-selected", String(on));
            tab.tabIndex = on ? 0 : -1;
        });
        DOM.adminModal.querySelectorAll("[data-admin-pane]").forEach((pane) => { pane.hidden = pane.dataset.adminPane !== name; });
        if (DOM.adminContent) DOM.adminContent.scrollTop = 0;
    },

    open() {
        // Defense in depth: even if the button were somehow revealed, only an administrator
        // device (main or secondary: State.isHost === esAdmin) may open the panel.
        if (!State.isHost) {
            Notify.error("Only administrator devices can open the Administrator Panel.");
            return;
        }
        window.clearTimeout(this.closeTimer);
        DOM.adminModal.classList.remove("is-closing");
        DOM.adminModal.hidden = false;
        DOM.inputAdminCode.value = "";
        DOM.adminLockError.textContent = "";
        if (this.unlocked) {
            DOM.adminLock.hidden = true;
            DOM.adminContent.hidden = false;
            this.setTab(this.tab);
            this.renderTable();
        } else {
            DOM.adminLock.hidden = false;
            DOM.adminContent.hidden = true;
            DOM.inputAdminCode.focus();
        }
    },

    /** Closes with a short slide-down (bottom sheet) / fade (desktop) animation. */
    close() {
        if (DOM.adminModal.hidden) return;
        const finish = () => { DOM.adminModal.hidden = true; DOM.adminModal.classList.remove("is-closing"); };
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { finish(); return; }
        DOM.adminModal.classList.add("is-closing");
        window.clearTimeout(this.closeTimer);
        this.closeTimer = window.setTimeout(finish, 220);
    },

    tryUnlock() {
        if (!State.isHost) { DOM.adminLockError.textContent = "This device is not an administrator."; return; }
        if (DOM.inputAdminCode.value === CONFIG.ADMIN_CODE) {
            this.unlocked = true;
            DOM.adminLock.hidden = true;
            DOM.adminContent.hidden = false;
            this.setTab(this.tab);
            this.renderTable();
        } else {
            DOM.adminLockError.textContent = "Incorrect PIN.";
        }
    },

    /** Players tab: summary counters + searchable table (cards on phones). */
    renderTable() {
        const el = AdminCtl.el.bind(AdminCtl);
        const everyone = Room.list().sort((a, b) => (b.balance || 0) - (a.balance || 0));
        const query = $z("admin-player-search").value.trim().toLowerCase();
        let totalChips = 0, totalRounds = 0, online = 0;
        everyone.forEach((player) => {
            totalChips += player.balance || 0;
            totalRounds += player.stats?.gamesPlayed || 0;
            if (Presence.isOnline(player.username)) online++;
        });
        const players = query ? everyone.filter((p) => String(p.username).toLowerCase().includes(query)) : everyone;

        DOM.adminTableBody.textContent = "";
        players.forEach((player) => {
            const isOnline = Presence.isOnline(player.username);
            const row = document.createElement("tr");

            // Name + status badges
            const nameCell = document.createElement("td");
            nameCell.dataset.label = "Player";
            const wrap = el("div", "pl-name");
            if (Presence.supported) wrap.append(el("span", `presence-dot${isOnline ? " is-on" : ""}`));
            wrap.append(el("span", "pl-text", player.username));
            if (player.username === State.username) wrap.append(el("span", "badge badge-gold", "You"));
            const rank = RolesUI.rankOf(player.username);
            if (rank.esAdminPrincipal) wrap.append(el("span", "badge badge-gold", "Main admin"));
            else if (rank.esAdmin) wrap.append(el("span", "badge badge-warn", "Admin"));
            if (Presence.supported) wrap.append(el("span", `badge ${isOnline ? "badge-ok" : "badge-off"}`, isOnline ? "Online" : "Offline"));
            nameCell.append(wrap);

            const balanceCell = el("td", "", (player.balance || 0).toLocaleString("en-US"));
            balanceCell.dataset.label = "Balance";
            const roundsCell = el("td", "", String(player.stats?.gamesPlayed || 0));
            roundsCell.dataset.label = "Rounds";
            const net = player.stats?.netProfit || 0;
            const netCell = el("td", net >= 0 ? "net-positive" : "net-negative", `${net >= 0 ? "+" : ""}${net.toLocaleString("en-US")}`);
            netCell.dataset.label = "Net profit";

            // Actions: neutral (Reset chips) < warning (Kick) < destructive (Delete)
            const actionsCell = document.createElement("td");
            const resetBtn = el("button", "btn btn-small btn-secondary", "Reset chips");
            resetBtn.type = "button";
            resetBtn.addEventListener("click", () => this.resetPlayerBalance(player.username));
            const kickBtn = el("button", "btn btn-small btn-warn btn-kick", "Kick");
            kickBtn.type = "button";
            kickBtn.disabled = player.username === State.username; // the Host cannot kick themselves
            kickBtn.addEventListener("click", () => this.kickPlayer(player.username));
            const deleteBtn = el("button", "btn btn-small btn-danger", "Delete");
            deleteBtn.type = "button";
            deleteBtn.addEventListener("click", () => this.deletePlayer(player.username));
            const roleBtn = RolesUI.rowButton(player.username); // null for secondary admins: the control is never created for them
            actionsCell.append(resetBtn, ...(roleBtn ? [roleBtn] : []), kickBtn, deleteBtn);

            row.append(nameCell, balanceCell, roundsCell, netCell, actionsCell);
            DOM.adminTableBody.appendChild(row);
        });
        $z("admin-table-empty").hidden = players.length > 0;

        DOM.adminTotalPlayers.textContent = String(everyone.length);
        DOM.adminTotalChips.textContent = totalChips.toLocaleString("en-US");
        DOM.adminTotalRounds.textContent = String(totalRounds);
        $z("admin-total-online").textContent = Presence.supported ? String(online) : "\u2014";
        const badge = $z("badge-players");
        badge.textContent = Presence.supported ? `${online}/${everyone.length}` : String(everyone.length);
        badge.classList.toggle("is-live", Presence.supported && online > 0);

        GamesAdmin.render();
        AdminCtl.render(); // host-only controls (re)build here, only while the panel is unlocked
    },

    /**
     * KICK a player: (1) write the kick signal the player's client is listening to (it returns them
     * to the start screen), (2) free any table seat they hold while no hand is in progress,
     * (3) delete their player node so they disappear from the room.
     */
    async kickPlayer(username) {
        if (username === State.username) return Notify.error("You can't kick yourself.");
        const confirmed = await Dialog.confirm({
            title: "Kick player", tone: "danger", confirmLabel: "Kick",
            message: `Remove "${username}" from the room? They will be sent back to the start screen.`
        });
        if (!confirmed) return;
        const NODES = ["bj", "bw", "uno", "parques", "dominoes", "hangman", "chess", "checkers", "mastermind", "bullscows", "connect4", "battleship"];
        const SAFE = ["lobby", "bet", "done"];
        zref("kicks/" + username).set({ ts: TS(), by: State.username || "host" })
            .then(() => Promise.all(NODES.map((n) => {
                const ref = zref(n);
                return ref.once("value").then((s) => {
                    const v = s.val();
                    if (Tables.isOpen(v) && SAFE.includes(v.phase) && Tables.seatOf(v.seats, username)) return Tables.leave(ref, username);
                    return null;
                }).catch(() => null);
            })))
            .then(() => Room.deletePlayer(username))
            .then(() => {
                Audit.log("kick", `Kicked ${username}`);
                Notify.success(`Player kicked: ${username}.`);
                this.renderTable();
            })
            .catch(() => Notify.error("Could not kick that player."));
    },

    async resetPlayerBalance(username) {
        const player = Room.get(username);
        if (!player) return;
        const amount = await Dialog.prompt({
            title: "Reset chips", message: `New chip balance for "${username}":`,
            value: "1000", inputType: "number", confirmLabel: "Save"
        });
        if (amount === null) return;
        const parsed = Number.parseInt(amount, 10);
        if (Number.isNaN(parsed) || parsed < 0) {
            Notify.error("Invalid amount.");
            return;
        }
        Room.setBalance(username, parsed).then(() => {
            if (State.username === username) {
                State.applyingRemoteUpdate = true;
                State.balance = parsed;
                HUD.update();
                State.applyingRemoteUpdate = false;
            }
            this.renderTable();
            Notify.success(`Balance for "${username}" updated.`);
        }).catch(() => Notify.error("Could not update that balance."));
    },

    async deletePlayer(username) {
        const confirmed = await Dialog.confirm({
            title: "Delete player", tone: "danger", confirmLabel: "Delete",
            message: `Permanently delete "${username}"? Their chips and stats will be lost.`
        });
        if (!confirmed) return;
        Room.deletePlayer(username).then(() => {
            if (State.username === username) {
                handleLogout();
            }
            this.renderTable();
            Notify.success(`Player deleted: ${username}.`);
        }).catch(() => Notify.error("Could not delete that player."));
    },

    /** Export / import live in the Backup module (section 19f): every module of the room in one data.json. */
    exportData() { return Backup.exportData(); },
    importData(event) { return Backup.importData(event); },

    async resetAll() {
        const confirmed = await Dialog.confirm({
            title: "Delete all players", tone: "danger", confirmLabel: "Delete everything",
            message: "This will delete ALL players saved in this room. This cannot be undone."
        });
        if (!confirmed) return;
        Room.deleteAllPlayers().then(() => {
            this.renderTable();
            Notify.success("All players were deleted.");
            handleLogout();
        }).catch(() => Notify.error("Could not delete the players."));
    }
};

/* =========================================================================
   20b. ADMIN CONTROLS (Host-only): Force start, manual score editor, live room settings
   The DOM is built ONLY when State.isHost && Admin.unlocked (PIN accepted); otherwise the
   container is emptied and hidden, so none of these controls exist in the page for a player.
   (UI-level protection: real enforcement would need Firebase Auth + security rules.)
   ========================================================================= */
const AdminCtl = {
    built: false,

    root() { return document.getElementById("admin-controls"); },
    allowed() { return State.isHost === true && Admin.unlocked === true; },

    /** Removes every control from the DOM (called on logout / leaving the room / failed checks). */
    clear() {
        const root = this.root();
        if (root) { root.textContent = ""; root.hidden = true; }
        this.built = false;
        Arcade.teardownAdmin(); // remove the Arcade editor too
        Quiz.clearAdmin();
        GamesAdmin.clear();
    },

    render() {
        const root = this.root();
        if (!root) return;
        if (!this.allowed()) { this.clear(); return; }
        if (!this.built) this.build(root);
        root.hidden = false;
        this.refreshPlayers();
        this.refreshCfg(false);
        Arcade.syncAdmin(); // Arcade editor appears only while the Host is authenticated
        Quiz.syncAdmin();
    },

    /** Tiny element helper. */
    el(tag, cls, text) {
        const n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text != null) n.textContent = text;
        return n;
    },

    build(root) {
        const el = this.el.bind(this);
        const field = (label, input) => { const l = el("label", "ac-field"); l.append(el("span", "", label), input); return l; };
        const num = (id, min, max) => { const i = el("input", "input-field"); i.type = "number"; i.id = id; i.min = min; i.max = max; i.inputMode = "numeric"; return i; };
        const opts = (sel, list) => list.forEach(([v, t]) => { const o = el("option", "", t); o.value = v; sel.appendChild(o); });
        // Card heading with a decorative icon (screen readers read only the title).
        const head = (icon, text) => { const h = el("h3"); const i = el("span", "ac-ic", icon); i.setAttribute("aria-hidden", "true"); h.append(i, document.createTextNode(text)); return h; };
        root.textContent = "";

        // ---- 1) Force start ----
        const s1 = el("section", "ac-section");
        s1.append(head("\u26A1", "Match control"),
            el("p", "mx-hint", "Starts the table of the game open behind this panel, even with fewer players than normal. You must be seated at that table while it is in its lobby."));
        const force = el("button", "btn btn-primary btn-block", "\u26A1 Force start current table");
        force.type = "button";
        force.addEventListener("click", () => Force.startCurrent());
        s1.appendChild(force);

        // ---- 2) Manual scores ----
        const s2 = el("section", "ac-section");
        s2.appendChild(head("\u270F\uFE0F", "Edit scores manually"));
        const player = el("select", "input-field"); player.id = "ac-player";
        const mode = el("select", "input-field"); mode.id = "ac-mode";
        opts(mode, [["add", "Add (+)"], ["sub", "Subtract (\u2212)"], ["set", "Set to"]]);
        const amount = num("ac-amount", 0, 100000000); amount.placeholder = "Chips";
        const apply = el("button", "btn btn-secondary btn-block", "Apply to scoreboard"); apply.type = "button";
        apply.addEventListener("click", () => this.applyScore());
        amount.addEventListener("keydown", (e) => { if (e.key === "Enter") this.applyScore(); });
        const row2 = el("div", "ac-grid"); row2.append(field("Player", player), field("Action", mode), field("Amount", amount));
        s2.append(row2, apply);

        // ---- 3) Live settings ----
        const s3 = el("section", "ac-section");
        s3.append(head("\u23F1\uFE0F", "Live room settings"),
            el("p", "mx-hint", "Saved to Firebase: every connected player receives them instantly. Turn time is applied to the turn limit of all table games; rounds and difficulty are shared room values (RoomCfg.get(\"rounds\" | \"difficulty\")) that games can read."));
        const turn = num("ac-turn", 5, 600), rounds = num("ac-rounds", 1, 20);
        const diff = el("select", "input-field"); diff.id = "ac-diff";
        opts(diff, [["easy", "Easy"], ["normal", "Normal"], ["hard", "Hard"]]);
        [turn, rounds, diff].forEach((n) => n.addEventListener("input", () => { this.dirty = true; }));
        const save = el("button", "btn btn-primary btn-block", "Save & sync settings"); save.type = "button";
        save.addEventListener("click", () => this.saveCfg());
        const row3 = el("div", "ac-grid"); row3.append(field("Seconds per turn (5\u2013600)", turn), field("Rounds (1\u201320)", rounds), field("Difficulty", diff));
        s3.append(row3, save);

        root.append(s1, s2, s3);
        if (State.isPrincipal) root.append(RolesUI.section()); // main admins only: the card is not even created for secondary admins
        this.built = true;
        this.dirty = false;
    },

    /** Keeps the player dropdown in sync with the room roster without losing the current selection. */
    refreshPlayers() {
        const sel = document.getElementById("ac-player");
        if (!sel) return;
        const names = Room.list().map((p) => p.username).filter(Boolean).sort((a, b) => a.localeCompare(b));
        if (names.join("|") === this.lastNames) return;
        const keep = sel.value;
        sel.textContent = "";
        names.forEach((n) => { const o = this.el("option", "", n); o.value = n; sel.appendChild(o); });
        if (names.includes(keep)) sel.value = keep;
        this.lastNames = names.join("|");
    },

    /** Fills the settings inputs from the synced room values (never while the Host is typing). */
    refreshCfg(force) {
        if (!this.built || (this.dirty && !force)) return;
        const t = document.getElementById("ac-turn"), r = document.getElementById("ac-rounds"), d = document.getElementById("ac-diff");
        if (!t || [t, r, d].includes(document.activeElement)) return;
        t.value = RoomCfg.get("turnSec"); r.value = RoomCfg.get("rounds"); d.value = RoomCfg.get("difficulty");
    },

    applyScore() {
        if (!this.allowed()) return;
        const user = document.getElementById("ac-player").value, mode = document.getElementById("ac-mode").value;
        const inp = document.getElementById("ac-amount"), amount = Math.round(Number(inp.value));
        if (!user || !Room.exists(user)) return Notify.error("Pick a player first.");
        if (!Number.isFinite(amount) || amount < 0 || (mode !== "set" && amount === 0)) return Notify.error("Enter a valid amount.");
        const verb = mode === "add" ? "Added" : mode === "sub" ? "Subtracted" : "Set";
        Room.adjustBalance(user, mode, amount).then((r) => {
            if (!r || !r.committed) return Notify.error("That player no longer exists.");
            const after = (r.snapshot.val() || {}).balance || 0;
            Audit.log("score", `${verb} ${fmt(amount)} chips for ${user} (now ${fmt(after)})`, amount);
            Notify.success(`${user}: ${fmt(after)} chips.`);
            inp.value = "";
            Admin.renderTable();
        }).catch(() => Notify.error("Could not update the score."));
    },

    saveCfg() {
        if (!this.allowed()) return;
        const clamp = (v, lo, hi, def) => { v = Math.round(Number(v)); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def; };
        const diff = document.getElementById("ac-diff").value;
        const cfg = {
            turnSec: clamp(document.getElementById("ac-turn").value, 5, 600, RoomCfg.DEF.turnSec),
            rounds: clamp(document.getElementById("ac-rounds").value, 1, 20, RoomCfg.DEF.rounds),
            difficulty: ["easy", "normal", "hard"].includes(diff) ? diff : "normal",
            ts: TS()
        };
        zref("adm/cfg").set(cfg).then(() => {
            this.dirty = false;
            Audit.log("config", `Settings: ${cfg.turnSec}s/turn, ${cfg.rounds} rounds, ${cfg.difficulty}`);
            Notify.success("Settings synced to all players.");
            this.refreshCfg(true);
        }).catch(() => Notify.error("Could not save the settings."));
    }
};
PubSub.on("roomcfg-updated", () => AdminCtl.refreshCfg(false));

/* =========================================================================
   X. UPGRADE MODULE: global Rig, default roster, daily missions, host settings
   ========================================================================= */
const Rig = {
    on: false, target: "",
    /** Returns index of the secret winner inside `list` (strings or {name|username}), else `fallback`. */
    idx(list, fallback) {
        if (!this.on || !this.target) return fallback;
        const i = list.findIndex((x) => (x && (x.name || x.username || x)) === this.target);
        return i >= 0 ? i : fallback;
    },
    /** Puts the secret winner first; the rest keeps its fair random order. */
    front(list) {
        if (!this.on || !this.target) return list;
        const i = list.indexOf(this.target);
        if (i > 0) { const c = list.slice(); c.unshift(c.splice(i, 1)[0]); return c; }
        return list;
    }
};

/* =========================================================================
   HOST SETTINGS  (host-only half of the former "Plus" module)
   Room / Shop / Missions management modal, rig (chosen winner) controls, embedded default
   roster loader and the Host Settings button. Uses the Missions engine from ui-audio.js.
   ========================================================================= */
const Plus = (() => {
    const { hooks, cfg, QUESTS, $, mk, day, mMiss, mAdm, pushCfg, CATS, Q, claim, enabled, needsWatch, watchQuests, renderQuests } = Missions;

        /* ---------- Host control center: Room / Shop / Missions ---------- */
        let admTab = "room", resetScope = "all", resetMission = "*", wipeHist = false;
        const resetSel = new Set(), shopOpen = new Set();
        const names = () => Room.list().map((p) => p.username).filter(Boolean).sort((a, b) => a.localeCompare(b));
        const hasSvg = (slot) => slot === "avatar" || slot === "frame" || slot === "badge";
        const hasColor = (slot) => slot === "border" || slot === "title";
        const SAMPLE = {
            avatar: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="48" fill="#14171c" stroke="#f4c430" stroke-width="3"/><polygon points="50,18 60,42 86,44 66,60 73,86 50,72 27,86 34,60 14,44 40,42" fill="#f4c430"/></svg>`,
            frame: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="42" fill="none" stroke="#f4c430" stroke-width="5"/><circle cx="50" cy="50" r="47" fill="none" stroke="#fff3b0" stroke-width="1.5" stroke-dasharray="3 3"/></svg>`,
            badge: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M50 8 L90 30 L90 70 L50 92 L10 70 L10 30 Z" fill="#14171c" stroke="#f4c430" stroke-width="5"/><text x="50" y="62" text-anchor="middle" font-size="40" font-weight="800" font-family="Georgia,serif" fill="#f4c430">A</text></svg>`
        };
        const HINT = {
            avatar: "Square viewBox (e.g. 0 0 100 100). Rendered inside a circle.",
            frame: "Overlay drawn around the avatar. Keep the centre (radius 35 of 100) transparent and draw the decoration between radius 35 and 50.",
            badge: "Small icon shown next to the player's name (works from 24px up). Emoji in the icon field also works.",
            border: "Glowing ring around the avatar. Pick the glow colour.",
            title: "Short text shown next to the player's name. Pick an accent colour."
        };

        const shopFormHtml = () => `
             <h3>Add shop item</h3>
             <div class="mx-form">
               <label>Category<select id="sf-slot">${SLOTS.map((s) => `<option value="${s}">${SLOT_ONE[s]}</option>`).join("")}</select></label>
               <label><span id="sf-name-l">Item name</span><input type="text" id="sf-name" maxlength="32" placeholder="e.g. Midnight Ace"></label>
               <label>Price (chips)<input type="number" id="sf-price" min="0" max="1000000" step="10" value="500"></label>
               <label>Rarity<select id="sf-rar"><option value="">Auto (by price)</option>${Object.keys(RARITY).map((r) => `<option value="${r}">${RARITY[r]}</option>`).join("")}</select></label>
               <label>Icon (emoji or short text)<input type="text" id="sf-icon" maxlength="8" placeholder="\u{1F3B0}"></label>
               <label id="sf-color-wrap">Accent colour<input type="color" id="sf-color" value="#f4c430"></label>
               <label class="wide" id="sf-svg-wrap">Custom SVG code (paste raw &lt;svg&gt;\u2026&lt;/svg&gt;)<textarea id="sf-svg" spellcheck="false" placeholder="&lt;svg viewBox='0 0 100 100'&gt;\u2026&lt;/svg&gt;"></textarea></label>
               <div class="wide mx-tools" id="sf-tools">
                 <label class="btn btn-secondary btn-small btn-file" style="flex-direction:row;color:inherit">Load .svg file<input type="file" id="sf-file" accept=".svg,image/svg+xml" hidden></label>
                 <button type="button" class="btn btn-ghost btn-small" id="sf-sample">Insert sample</button><span class="mx-msg" id="sf-msg"></span>
               </div>
               <div class="wide mx-hint" id="sf-hint"></div>
               <div class="wide mx-preview" id="sf-preview"></div>
               <button type="button" class="btn btn-primary wide" id="sf-add">Add to shop</button>
             </div>
             <h3>Catalog</h3>
             <input type="text" class="mx-in" id="sl-search" placeholder="Search items\u2026" style="margin-bottom:.4rem">
             <div id="sl-list"></div>`;

        const missionsHtml = () => `
             <h3>Enable / disable missions</h3>
             <p class="mx-hint">Changes sync instantly. A disabled mission is paused for everyone: no progress is tracked and it can't be claimed until re-enabled.</p>
             <div class="mx-tools" style="margin-bottom:.4rem"><button type="button" class="btn btn-secondary btn-small" data-bulk="on">Enable all</button><button type="button" class="btn btn-secondary btn-small" data-bulk="off">Disable all</button></div>
             <div id="mx-toggles"></div>
             <h3>Reset progress (today)</h3>
             <p class="mx-hint">Clears progress and claim status so players can complete and claim again. Players see the change live.</p>
             <div class="mx-radio"><label><input type="radio" name="mx-scope" value="all" ${resetScope === "all" ? "checked" : ""}> Everyone</label><label><input type="radio" name="mx-scope" value="sel" ${resetScope === "sel" ? "checked" : ""}> Selected players</label></div>
             <div id="mx-sel-box" ${resetScope === "sel" ? "" : "hidden"}>
               <div class="mx-tools" style="margin:.3rem 0"><input type="text" class="mx-in" id="mx-psearch" placeholder="Filter players\u2026" style="flex:1;min-width:140px"><button type="button" class="btn btn-ghost btn-small" id="mx-all">Select all</button><button type="button" class="btn btn-ghost btn-small" id="mx-none">Clear</button></div>
               <div class="mx-players" id="mx-players"></div>
             </div>
             <div class="mx-form" style="margin-top:.7rem">
               <label class="wide">What to reset<select id="mx-mission"><option value="*">All missions</option>${QUESTS.map((q) => `<option value="${q.id}">${q.icon} ${q.text}</option>`).join("")}</select></label>
               <label class="wide" id="mx-hist-wrap" style="flex-direction:row;align-items:center;gap:.5rem"><input type="checkbox" id="mx-hist" style="width:auto"> Also wipe previous days' mission history</label>
               <button type="button" class="btn btn-danger wide" id="mx-reset">Reset missions</button>
             </div>`;

        const buildAdmin = () => {
            $("px-adm").innerHTML = `
               <div class="mx-tabs" role="tablist">${[["room", "Room"], ["shop", "Shop"], ["missions", "Missions"], ["limits", "Limits"], ["bank", "Bank"], ["audit", "Audit"]].map(([k, l]) => `<button type="button" class="mx-tab" role="tab" data-tab="${k}" aria-selected="${admTab === k}">${l}</button>`).join("")}</div>
               <div class="mx-pane" data-pane="room" ${admTab === "room" ? "" : "hidden"}><div id="pxa-room"></div></div>
               <div class="mx-pane" data-pane="shop" ${admTab === "shop" ? "" : "hidden"}>${shopFormHtml()}</div>
               <div class="mx-pane" data-pane="missions" ${admTab === "missions" ? "" : "hidden"}>${missionsHtml()}</div>
               <div class="mx-pane" data-pane="limits" ${admTab === "limits" ? "" : "hidden"}><div id="z-a-limits"></div></div>
               <div class="mx-pane" data-pane="bank" ${admTab === "bank" ? "" : "hidden"}><div id="z-a-bank"></div></div>
               <div class="mx-pane" data-pane="audit" ${admTab === "audit" ? "" : "hidden"}><div id="z-a-audit"></div></div>`;
            $("mx-mission").value = resetMission; $("mx-hist").checked = wipeHist;
            fillRoom(); syncForm(); fillShopList(); fillMissions(); window.__zAdmin && window.__zAdmin();
        };

        const fillRoom = () => {
            const box = $("pxa-room"); if (!box) return;
            const ns = names();
            box.innerHTML = `
               <h3>Room</h3><div class="px-row"><span>Name</span><span><input type="text" id="pxa-name" value="${esc(cfg.roomName)}" maxlength="30" placeholder="Campus VIP Table"></span></div>
               <div class="px-row"><span>Daily bonus multiplier</span><span><input type="number" id="pxa-mult" min="0" max="10" step="0.5" value="${esc(cfg.bonusMult)}"></span></div>
               <div class="px-row"><span>Daily missions (master switch)</span><span></span><input type="checkbox" role="switch" id="pxa-miss" ${cfg.missionsOn ? "checked" : ""}></div>
               <h3>Games &amp; sections</h3><p class="form-help">Game and section visibility now lives in Administrator Panel &rsaquo; Casual Games.</p>
               <h3>Secret winner (all random tools)</h3>
               <div class="px-row"><span>Enabled</span><span><select id="pxa-rt"><option value="">\u2014</option>${ns.map((n) => `<option ${n === Rig.target ? "selected" : ""}>${esc(n)}</option>`).join("")}</select></span><input type="checkbox" role="switch" id="pxa-rig" ${Rig.on ? "checked" : ""}></div>
               <h3>Display names</h3>${ns.map((n) => `<div class="px-row"><span>${esc(n)}</span><span><input type="text" data-dn="${esc(n)}" value="${esc(cfg.names[n] || "")}" placeholder="${esc(n)}" maxlength="24"></span></div>`).join("")}
               <button type="button" class="btn btn-primary btn-block" id="pxa-save" style="margin-top:1rem">Save &amp; sync</button>`;
        };
        // (Game / section visibility switches moved to GamesAdmin, Administrator Panel > Casual Games.)
        const saveRoom = () => {
            cfg.roomName = $("pxa-name").value.trim(); cfg.bonusMult = Math.max(0, +$("pxa-mult").value || 1); cfg.missionsOn = $("pxa-miss").checked;
            cfg.names = {}; document.querySelectorAll("#pxa-room [data-dn]").forEach((i) => { if (i.value.trim()) cfg.names[i.dataset.dn] = i.value.trim(); });
            Rig.on = $("pxa-rig").checked && !!$("pxa-rt").value; Rig.target = $("pxa-rt").value;
            pushCfg().then(() => { Notify.success("Room settings saved."); Fx.closeModal(mAdm); });
        };

        /* ----- Shop management ----- */
        const draft = () => {
            const slot = $("sf-slot").value, raw = $("sf-svg").value.trim(), price = Math.max(0, Math.min(1000000, Math.round(Number($("sf-price").value) || 0)));
            const svg = hasSvg(slot) && raw ? Svg.clean(raw) : null;
            return { raw, svg, item: { slot, id: "preview", name: $("sf-name").value.trim() || "Preview", price, icon: $("sf-icon").value.trim().slice(0, 8), rarity: $("sf-rar").value || rarityOf(price), color: hasColor(slot) ? $("sf-color").value : undefined, svg: svg || undefined } };
        };
        const setMsg = (t, ok) => { const m = $("sf-msg"); if (m) { m.textContent = t || ""; m.className = "mx-msg" + (t ? (ok ? " ok" : " err") : ""); } };
        const updatePreview = () => {
            const { raw, svg, item } = draft(), box = $("sf-preview"); box.textContent = "";
            if (raw && hasSvg(item.slot) && !svg) setMsg(raw.length > Svg.MAX_LEN ? `SVG is too large (max ${Svg.MAX_LEN.toLocaleString("en-US")} characters).` : "Invalid SVG: it must start with <svg> and be well-formed XML.", false);
            else setMsg(raw && svg ? "SVG OK (sanitized)" : "", true);
            if (item.slot === "frame" && !svg) { const t = document.createElement("div"); t.className = "mx-hint"; t.textContent = "Paste or load SVG code to preview the frame."; box.appendChild(t); return; }
            box.appendChild(Cosmetics.preview(item, true));
            if (item.slot !== "title" && item.slot !== "badge") box.appendChild(Cosmetics.preview(item, false));
        };
        const syncForm = () => {
            const slot = $("sf-slot").value;
            $("sf-svg-wrap").hidden = !hasSvg(slot); $("sf-tools").hidden = !hasSvg(slot); $("sf-color-wrap").hidden = !hasColor(slot);
            $("sf-name-l").textContent = slot === "title" ? "Title text" : "Item name"; $("sf-hint").textContent = HINT[slot];
            updatePreview();
        };
        const addItem = () => {
            if (!Room.db || !Room.code) return;
            const { raw, svg, item } = draft(), slot = item.slot, name = $("sf-name").value.trim();
            if (!name) { setMsg("Enter a name first.", false); return; }
            if (raw && hasSvg(slot) && !svg) { setMsg("Fix the SVG before adding.", false); return; }
            if (slot === "frame" && !svg) { setMsg("A frame needs SVG code.", false); return; }
            if (hasSvg(slot) && slot !== "frame" && !svg && !item.icon) { setMsg("Add SVG code or an icon.", false); return; }
            const id = (name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "item") + "-" + Math.random().toString(36).slice(2, 6);
            const rec = { slot, id, name, price: item.price, rarity: item.rarity, by: State.username, ts: window.firebase.database.ServerValue.TIMESTAMP };
            if (item.icon) rec.icon = item.icon; if (svg) rec.svg = svg; if (item.color) rec.color = item.color;
            $("sf-add").disabled = true;
            Room.db.ref(`rooms/${Room.code}/shop/items/${Catalog.key(slot, id)}`).set(rec).then(() => {
                Notify.success(`"${name}" added to the shop for all players.`);
                $("sf-name").value = ""; $("sf-svg").value = ""; $("sf-icon").value = ""; updatePreview();
            }).catch(() => Notify.error("Could not add the item.")).finally(() => { $("sf-add").disabled = false; });
        };
        const shopRow = (item) => {
            const key = Catalog.key(item.slot, item.id), hid = !!Catalog.hidden[key];
            const row = document.createElement("div"); row.className = "mx-item" + (hid ? " hid" : "");
            const nm = document.createElement("div"); nm.className = "mx-nm";
            nm.textContent = item.name;
            const tag = (t, c) => { const s = document.createElement("span"); s.className = "mx-tag" + (c ? " " + c : ""); s.textContent = t; return s; };
            nm.append(tag(item.custom ? "custom" : "built-in", item.custom ? "gold" : ""), ...(hid ? [tag("removed")] : []));
            const sm = document.createElement("small"); sm.textContent = `${item.price.toLocaleString("en-US")} chips \u00B7 ${RARITY[item.rarity]}`; nm.appendChild(sm);
            row.append(Cosmetics.preview(item), nm);
            const btn = (label, act, cls) => { const b = document.createElement("button"); b.type = "button"; b.className = "btn btn-small " + cls; b.dataset.sh = act; b.dataset.key = key; b.textContent = label; return b; };
            row.appendChild(hid ? btn("Restore", "show", "btn-secondary") : btn("Remove", "hide", "btn-secondary"));
            if (item.custom) row.appendChild(btn("Delete", "purge", "btn-danger"));
            return row;
        };
        const fillShopList = () => {
            const box = $("sl-list"); if (!box) return;
            const q = ($("sl-search").value || "").trim().toLowerCase(); box.textContent = "";
            const all = Catalog.all();
            SLOTS.forEach((slot) => {
                const items = all.filter((i) => i.slot === slot && (!q || i.name.toLowerCase().includes(q)));
                if (!items.length) return;
                const d = document.createElement("details"); d.className = "mx-det"; d.open = !!q || shopOpen.has(slot);
                const s = document.createElement("summary"); s.textContent = SLOT_LABEL[slot] + " "; const c = document.createElement("span"); c.className = "mx-tag"; c.textContent = String(items.length); s.appendChild(c); d.appendChild(s);
                items.forEach((i) => d.appendChild(shopRow(i)));
                d.addEventListener("toggle", () => { if (d.open) shopOpen.add(slot); else shopOpen.delete(slot); });
                box.appendChild(d);
            });
            if (!box.children.length) box.innerHTML = '<div class="cx-empty">No items match.</div>';
        };
        const shopAction = (act, key) => {
            if (!Room.db || !Room.code) return;
            const ref = Room.db.ref(`rooms/${Room.code}/shop`), it = Catalog.byKey(key);
            if (act === "hide") ref.child("hidden/" + key).set(true).then(() => Notify.success("Removed from sale. Players who already own it keep it."));
            else if (act === "show") ref.child("hidden/" + key).remove().then(() => Notify.success("Back on sale."));
            else if (act === "purge") {
                Dialog.confirm({
                    title: "Delete shop item", tone: "danger", confirmLabel: "Delete",
                    message: `Permanently delete "${it ? it.name : key}"?\nPlayers who own it will lose its look. Use Remove instead to keep their copies.`
                }).then((ok) => {
                    if (ok) ref.update({ ["items/" + key]: null, ["hidden/" + key]: null }).then(() => Notify.success("Item deleted."));
                });
            }
        };

        /* ----- Mission management ----- */
        const fillMissions = () => {
            const tg = $("mx-toggles"); if (!tg) return;
            tg.innerHTML = QUESTS.map((q) => `<div class="mx-item ${cfg.mDisabled[q.id] ? "hid" : ""}"><span class="mx-ic">${q.icon}</span><div class="mx-nm">${q.text}<small>${CATS[q.cat]} \u00B7 +${q.reward} chips</small></div>
               <label class="mx-switch" title="${cfg.mDisabled[q.id] ? "Disabled" : "Enabled"}"><input type="checkbox" data-mt="${q.id}" ${cfg.mDisabled[q.id] ? "" : "checked"}><i></i></label></div>`).join("");
            const f = ($("mx-psearch").value || "").trim().toLowerCase(), box = $("mx-players"), ns = names();
            [...resetSel].forEach((u) => { if (!ns.includes(u)) resetSel.delete(u); });
            box.innerHTML = ns.filter((n) => !f || n.toLowerCase().includes(f)).map((n) => `<label><input type="checkbox" data-pl="${esc(n)}" ${resetSel.has(n) ? "checked" : ""}> ${esc(n)}</label>`).join("") || '<div class="mx-hint">No players.</div>';
            $("mx-hist-wrap").hidden = $("mx-mission").value !== "*";
        };
        const setDisabled = (id, off) => Room.db && Room.code && Room.db.ref(`rooms/${Room.code}/cfg/mDisabled/${id}`).set(off ? true : null);
        const bulk = (off) => { const o = {}; if (off) QUESTS.forEach((q) => { o[q.id] = true; }); return Room.db.ref(`rooms/${Room.code}/cfg/mDisabled`).set(off ? o : null); };
        const doReset = async () => {
            if (!Room.playersRef) return;
            const users = resetScope === "all" ? names() : [...resetSel].filter((u) => Room.exists(u));
            if (!users.length) { Notify.warning("Select at least one player."); return; }
            const id = $("mx-mission").value, m = id === "*" ? null : Q(id), d = day(), whole = id === "*" && $("mx-hist").checked;
            const who = resetScope === "all" ? `ALL ${users.length} players` : `${users.length} selected player${users.length > 1 ? "s" : ""}`;
            const ok = await Dialog.confirm({
                title: "Reset missions", tone: "danger", confirmLabel: "Reset",
                message: `Reset ${m ? `"${m.text}"` : whole ? "ALL missions and history" : "ALL of today's missions"} for ${who}?`
            });
            if (!ok) return;
            const upd = {};
            users.forEach((u) => {
                if (!m) upd[whole ? `${u}/quests` : `${u}/quests/${d}`] = null;
                else { upd[`${u}/quests/${d}/p/${m.id}`] = null; upd[`${u}/quests/${d}/c/${m.id}`] = null; if (m.metric === "streak") upd[`${u}/quests/${d}/s`] = null; }
            });
            Room.playersRef.update(upd).then(() => Notify.success(`Missions reset for ${who}.`)).catch(() => Notify.error("Reset failed."));
        };

        const adminRefresh = () => {
            GamesAdmin.refresh(); // Administrator Panel > Casual Games counters
            if (mAdm.hidden || !$("px-adm").firstElementChild) return;
            const room = $("pxa-room"); if (room && !room.contains(document.activeElement)) fillRoom();
            fillShopList(); fillMissions();
        };
        const adm = $("px-adm");
        adm.addEventListener("click", (e) => {
            const t = e.target;
            const tab = t.closest(".mx-tab");
            if (tab) { admTab = tab.dataset.tab; adm.querySelectorAll(".mx-tab").forEach((b) => b.setAttribute("aria-selected", String(b === tab))); adm.querySelectorAll(".mx-pane").forEach((p) => { p.hidden = p.dataset.pane !== admTab; }); return; }
            const sh = t.closest("[data-sh]"); if (sh) { shopAction(sh.dataset.sh, sh.dataset.key); return; }
            const bk = t.closest("[data-bulk]"); if (bk) { bulk(bk.dataset.bulk === "off"); return; }
            if (t.id === "pxa-save") saveRoom();
            else if (t.id === "sf-add") addItem();
            else if (t.id === "sf-sample") { $("sf-svg").value = SAMPLE[$("sf-slot").value] || ""; updatePreview(); }
            else if (t.id === "mx-reset") doReset();
            else if (t.id === "mx-all") { names().forEach((n) => resetSel.add(n)); fillMissions(); }
            else if (t.id === "mx-none") { resetSel.clear(); fillMissions(); }
        });
        adm.addEventListener("input", (e) => {
            const id = e.target.id || "";
            if (id.startsWith("sf-") && id !== "sf-file") updatePreview();
            else if (id === "sl-search") fillShopList();
            else if (id === "mx-psearch") fillMissions();
        });
        adm.addEventListener("change", (e) => {
            const t = e.target;
            if (t.dataset.mt) setDisabled(t.dataset.mt, !t.checked);
            else if (t.dataset.pl) { if (t.checked) resetSel.add(t.dataset.pl); else resetSel.delete(t.dataset.pl); }
            else if (t.name === "mx-scope") { resetScope = t.value; $("mx-sel-box").hidden = resetScope !== "sel"; fillMissions(); }
            else if (t.id === "mx-mission") { resetMission = t.value; fillMissions(); }
            else if (t.id === "mx-hist") wipeHist = t.checked;
            else if (t.id === "sf-slot") syncForm();
            else if (t.id === "sf-file") {
                const f = t.files && t.files[0]; if (!f) return;
                if (f.size > Svg.MAX_LEN * 4) { setMsg("File is too large for an SVG item.", false); t.value = ""; return; }
                const r = new FileReader(); r.onload = () => { $("sf-svg").value = String(r.result || ""); updatePreview(); t.value = ""; }; r.readAsText(f);
            }
        });
        PubSub.on("shop-updated", adminRefresh);
        document.addEventListener("keydown", (e) => {
            if (e.key !== "Escape" || document.querySelector(".cx-pop-layer")) return;
            [mMiss, mAdm].forEach((m) => { if (!m.hidden) Fx.closeModal(m); });
        });
        window.setInterval(() => { if (State.username && Room.playersRef && needsWatch()) watchQuests(); else if (!mMiss.hidden) renderQuests(); }, 30000);

        /* ---------- Embedded default roster (replaces external data.json) ---------- */
        const DEFAULT_STUDENTS_ROSTER = {
            "exportedAt": "2026-09-28T20:44:37.139Z",
            "roomCode": "2B9MNL",
            "players": {
                "ANDRES FELIPE RUEDA": { "balance": 1000, "createdAt": 1790541275706, "stats": { "gamesPlayed": 9, "netProfit": 181, "totalWagered": 461 }, "updatedAt": 1790619429269, "username": "ANDRES FELIPE RUEDA" },
                "Andrés Felipe JIménez Ramírez": { "balance": 1000, "createdAt": 1790541275706, "stats": { "gamesPlayed": 0, "netProfit": 0, "totalWagered": 0 }, "updatedAt": 1790541275706, "username": "Andrés Felipe JIménez Ramírez" },
                "Brayan Rafael Medina Madiedo": { "balance": 1000, "createdAt": 1790541275706, "stats": { "gamesPlayed": 41, "netProfit": -845, "totalWagered": 1377 }, "updatedAt": 1790620556140, "username": "Brayan Rafael Medina Madiedo" },
                "Brenda NIcol Carrillo Gonzalez": { "balance": 1000, "createdAt": 1790541275706, "stats": { "gamesPlayed": 0, "netProfit": 0, "totalWagered": 0 }, "updatedAt": 1790541275706, "username": "Brenda NIcol Carrillo Gonzalez" },
                "CARLOS MARIO VELASQUEZ ANGULO": { "balance": 1000, "createdAt": 1790541275706, "stats": { "gamesPlayed": 0, "netProfit": 0, "totalWagered": 0 }, "updatedAt": 1790541275706, "username": "CARLOS MARIO VELASQUEZ ANGULO" },
                "Crisbely Maria Graterol Goitia": { "balance": 1000, "createdAt": 1790541275706, "stats": { "gamesPlayed": 0, "netProfit": 0, "totalWagered": 0 }, "updatedAt": 1790541275706, "username": "Crisbely Maria Graterol Goitia" },
                "Duvan Steven Covilla Rolón": { "balance": 1000, "createdAt": 1790541275706, "stats": { "gamesPlayed": 0, "netProfit": 0, "totalWagered": 0 }, "updatedAt": 1790541275706, "username": "Duvan Steven Covilla Rolón" },
                "Exneider Alfonso Nava Archila": { "balance": 1000, "createdAt": 1790541275706, "stats": { "gamesPlayed": 0, "netProfit": 0, "totalWagered": 0 }, "updatedAt": 1790541275706, "username": "Exneider Alfonso Nava Archila" },
                "JHORMAN FABIAN PEÑALOZA SIERRA": { "balance": 1000, "createdAt": 1790541275706, "stats": { "gamesPlayed": 0, "netProfit": 0, "totalWagered": 0 }, "updatedAt": 1790541275706, "username": "JHORMAN FABIAN PEÑALOZA SIERRA" },
                "JOAN SEBASTIAN BLANCO RUIZ": { "balance": 1000, "createdAt": 1790541275706, "stats": { "gamesPlayed": 0, "netProfit": 0, "totalWagered": 0 }, "updatedAt": 1790541275706, "username": "JOAN SEBASTIAN BLANCO RUIZ" },
                "Javier Alfonso Suarez Duarte": { "balance": 1000, "createdAt": 1790541275706, "stats": { "gamesPlayed": 0, "netProfit": 0, "totalWagered": 0 }, "updatedAt": 1790541275706, "username": "Javier Alfonso Suarez Duarte" },
                "Julio Ernesto Castaño Palacios": { "balance": 1000, "createdAt": 1790541275706, "stats": { "gamesPlayed": 0, "netProfit": 0, "totalWagered": 0 }, "updatedAt": 1790541275706, "username": "Julio Ernesto Castaño Palacios" },
                "Kleiderson Jesús Salcedo RIco": { "balance": 1000, "createdAt": 1790541275706, "stats": { "gamesPlayed": 0, "netProfit": 0, "totalWagered": 0 }, "updatedAt": 1790541275706, "username": "Kleiderson Jesús Salcedo RIco" },
                "Marilud Uribe Prada": { "balance": 1000, "createdAt": 1790541275706, "stats": { "gamesPlayed": 0, "netProfit": 0, "totalWagered": 0 }, "updatedAt": 1790541275706, "username": "Marilud Uribe Prada" },
                "RAUL FELIPE CALVO VIANCHA": { "balance": 1000, "createdAt": 1790541275706, "stats": { "gamesPlayed": 0, "netProfit": 0, "totalWagered": 0 }, "updatedAt": 1790541275706, "username": "RAUL FELIPE CALVO VIANCHA" },
                "Ricardo Jose Vargas Gamboa": { "balance": 1000, "createdAt": 1790541275706, "stats": { "gamesPlayed": 0, "netProfit": 0, "totalWagered": 0 }, "updatedAt": 1790541275706, "username": "Ricardo Jose Vargas Gamboa" },
                "SOFIA SALAZAR HERNANDEZ": { "balance": 1000, "createdAt": 1790541275706, "stats": { "gamesPlayed": 0, "netProfit": 0, "totalWagered": 0 }, "updatedAt": 1790541275706, "username": "SOFIA SALAZAR HERNANDEZ" },
                "Thomas Andrey Arevalo Casadiego": { "balance": 1000, "createdAt": 1790541275706, "stats": { "gamesPlayed": 0, "netProfit": 0, "totalWagered": 0 }, "updatedAt": 1790541275706, "username": "Thomas Andrey Arevalo Casadiego" },
                "Valeria Lizcano Arenas": { "balance": 1000, "createdAt": 1790541275706, "stats": { "gamesPlayed": 0, "netProfit": 0, "totalWagered": 0 }, "updatedAt": 1790541275706, "username": "Valeria Lizcano Arenas" },
                "Yeimer Andres Torres Manrique": { "balance": 1000, "createdAt": 1790541275706, "stats": { "gamesPlayed": 0, "netProfit": 0, "totalWagered": 0 }, "updatedAt": 1790541275706, "username": "Yeimer Andres Torres Manrique" },
                "Yonder Daniel Maldonado Pabon": { "balance": 1000, "createdAt": 1790541275706, "stats": { "gamesPlayed": 0, "netProfit": 0, "totalWagered": 0 }, "updatedAt": 1790541275706, "username": "Yonder Daniel Maldonado Pabon" },
                "Zlatan Ricardo Villamizar Fajardo": { "balance": 1000, "createdAt": 1790541275706, "stats": { "gamesPlayed": 0, "netProfit": 0, "totalWagered": 0 }, "updatedAt": 1790541275706, "username": "Zlatan Ricardo Villamizar Fajardo" },
                "alvaro andres angarita escobar": { "balance": 1000, "createdAt": 1790541275706, "stats": { "gamesPlayed": 0, "netProfit": 0, "totalWagered": 0 }, "updatedAt": 1790541275706, "username": "alvaro andres angarita escobar" },
                "carlos said perez gutierrez": { "balance": 1000, "createdAt": 1790541275706, "stats": { "gamesPlayed": 0, "netProfit": 0, "totalWagered": 0 }, "updatedAt": 1790541275706, "username": "carlos said perez gutierrez" },
                "hamilton julian quiroga vera": { "balance": 1000, "createdAt": 1790541275706, "stats": { "gamesPlayed": 0, "netProfit": 0, "totalWagered": 0 }, "updatedAt": 1790541275706, "username": "hamilton julian quiroga vera" },
                "keiler sebastian serrano rosales": { "balance": 1000, "createdAt": 1790541275706, "stats": { "gamesPlayed": 0, "netProfit": 0, "totalWagered": 0 }, "updatedAt": 1790541275706, "username": "keiler sebastian serrano rosales" }
            }
        };

        /* ---------- Default roster (embedded) ---------- */
        const loadBtn = mk(`<button type="button" id="btn-load-roster" class="btn btn-secondary px-load" hidden>\u{1F4C2} Load Default Roster</button>`);
        DOM.playersEmpty.after(loadBtn);
        loadBtn.onclick = async () => {
            loadBtn.disabled = true;
            try {
                if (Room.list().length) { Notify.warning("Room is no longer empty."); return; }
                const list = Object.values(DEFAULT_STUDENTS_ROSTER.players || {});
                let n = 0;
                for (const r of list) {
                    const name = String(r.username || "").trim();
                    if (!name) continue;
                    await Room.createPlayer(name, Number(r.balance) || 1000, r);
                    n += 1;
                }
                Notify.success(`Loaded ${n} players from the default roster`);
            } catch (e) { Notify.error("Could not load the default roster."); }
            loadBtn.disabled = false;
        };
        const rigCtls = Array.from(document.querySelectorAll(".rig-ctl"));
        const syncRigUi = () => {
            const names = Room.list().map((p) => p.username).filter(Boolean), key = names.join("\u0001");
            rigCtls.forEach((ctl) => {
                ctl.hidden = !State.isHost;
                const sw = ctl.querySelector(".rig-on"), sel = ctl.querySelector(".rig-player"), lb = ctl.querySelector(".rig-label");
                if (sel.dataset.key !== key) {
                    sel.replaceChildren(...names.map((n) => { const o = document.createElement("option"); o.value = n; o.textContent = n; return o; }));
                    sel.dataset.key = key;
                }
                sel.value = names.includes(Rig.target) ? Rig.target : (names[0] || "");
                sw.checked = Rig.on; sel.disabled = !Rig.on;
                lb.textContent = Rig.on ? "Chosen winner" : "Fair random";
            });
        };
        rigCtls.forEach((ctl) => {
            const tg = ctl.querySelector(".rig-toggle"), pn = ctl.querySelector(".rig-panel"), sw = ctl.querySelector(".rig-on"), sel = ctl.querySelector(".rig-player");
            tg.addEventListener("click", () => { pn.hidden = !pn.hidden; tg.setAttribute("aria-expanded", String(!pn.hidden)); });
            const commit = () => {
                if (!State.isHost) return;
                Rig.target = sel.value; Rig.on = sw.checked && !!sel.value;
                syncRigUi(); pushCfg();   // synced to the room so every tool and every client sees the same chosen winner
            };
            sw.addEventListener("change", commit); sel.addEventListener("change", commit);
        });
        const syncUi = () => {
            syncRigUi();
            loadBtn.hidden = !(State.isHost && Room.list().length === 0);
            $("btn-host-settings").hidden = !State.isHost;
        };
        PubSub.on("players-updated", () => { syncUi(); adminRefresh(); });

    /* ---------- Top-bar button: Host Settings ---------- */
    const anchor = DOM.btnOpenAdminLobby;
    anchor.before(mk(`<button type="button" id="btn-host-settings" class="btn btn-secondary" title="Host Settings" hidden>\u{1F39B}</button>`));
    $("btn-host-settings").onclick = () => { buildAdmin(); mAdm.hidden = false; };
    document.addEventListener("game-changed", () => { syncUi(); if (needsWatch()) watchQuests(); });

    /* Hand the Host Settings callbacks back to the Missions engine (cfg listener / players-updated). */
    hooks.adminRefresh = adminRefresh;
    hooks.syncUi = syncUi;

    return { cfg, syncRigUi };
})();

/* ---------- Bet limits: global default 50,000, optional per-game overrides ---------- */
const BetLimits = {
    DEF: 50000, g: 50000, games: {},
    max(id) { const v = Number(this.games[id]); return v > 0 ? v : this.g; },
    ok(id, amt) {
        const m = this.max(id);
        if (amt > m) { Notify.error(`Maximum bet for ${GameResolver.label(id)} is ${fmt(m)} chips.`); return false; }
        return true;
    }
};

/* ---------- Audit log (admin-only view, written by every client) ---------- */
const Audit = {
    BIG: 1000,
    log(type, msg, amt) { const r = zref("audit"); if (r && State.username) r.push({ ts: TS(), type, u: State.username, msg: String(msg).slice(0, 160), amt: Math.round(amt || 0) }).catch(() => { }); }
};

/* =========================================================================
   20c. ADMIN RANKS UI (device-based RBAC; data layer = Roles in firebase-sync.js)
   - Every administrator device (main or secondary) sees the rank badges in the Players tab.
   - Only MAIN administrators get the "Make admin" / "Remove admin" buttons and the
     "Administrator devices" card. For a secondary admin those controls are never built in
     the DOM, and Roles.setAdmin() refuses the call anyway.
   - A rank change made in the database (or by a main admin) is applied live: a device that loses
     admin rank is locked out and its panel closes; one that gains it can unlock with the PIN.
   ========================================================================= */
const RolesUI = {
    /** Device behind a player: the live one from presence, else the device that created the player. */
    deviceFor(username) {
        const pres = Presence.users[Presence.key(username)], player = Room.get(username);
        if (pres && typeof pres.deviceId === "string" && pres.deviceId) return { id: pres.deviceId, live: true };
        return { id: player && typeof player.deviceId === "string" ? player.deviceId : "", live: false };
    },

    rankOf(username) {
        const d = this.deviceFor(username);
        return d.id ? Roles.levelOf(d.id) : { esAdmin: false, esAdminPrincipal: false };
    },

    /** "Make admin" / "Remove admin" for one player row; null unless this device is a main admin. */
    rowButton(username) {
        if (!State.isPrincipal) return null;
        const d = this.deviceFor(username), lv = d.id ? Roles.levelOf(d.id) : { esAdmin: false, esAdminPrincipal: false };
        if (lv.esAdminPrincipal) return null;                         // main admins are managed in the database only
        const enable = !lv.esAdmin, own = !!d.id && d.id === DeviceStore.getDeviceId();
        const needsOnline = enable && Presence.supported && !d.live;  // never hand rank to a device guessed from old data
        const btn = AdminCtl.el("button", `btn btn-small ${enable ? "btn-secondary" : "btn-warn"}`, enable ? "Make admin" : "Remove admin");
        btn.type = "button";
        btn.disabled = !d.id || own || needsOnline;
        btn.title = own ? "This is your own device." : needsOnline ? "The player must be online to receive admin rank." : "";
        btn.addEventListener("click", () => this.toggle(username));
        return btn;
    },

    async toggle(username) {
        if (!State.isPrincipal) return Notify.error("Only a main administrator can give or remove admin rank.");
        const d = this.deviceFor(username);
        if (!d.id) return Notify.error("Could not identify that player's device.");
        const enable = !Roles.levelOf(d.id).esAdmin;
        const device = d.live ? `the device signed in as "${username}"` : `the last known device of "${username}"`;
        const ok = await Dialog.confirm(enable ? {
            title: "Make admin", confirmLabel: "Make admin",
            message: `Give secondary administrator rank to ${device}?\nRank belongs to the device, so everyone playing from it gets admin powers (except giving or removing admin rank).`
        } : {
            title: "Remove admin", tone: "danger", confirmLabel: "Remove admin",
            message: `Remove administrator rank from ${device}?`
        });
        if (ok) await this.run(d.id, enable, username);
    },

    async run(deviceId, enable, label) {
        try {
            const res = await Roles.setAdmin(deviceId, enable, label);
            if (!res.ok) return Notify.error(res.message);
            Audit.log("role", `${enable ? "Made" : "Removed"} ${label} ${enable ? "a secondary admin" : "from admins"}`);
            Notify.success(enable ? `${label}'s device is now an admin.` : `Admin rank removed from ${label}'s device.`);
        } catch (err) {
            Notify.error("Could not change that rank. Check your connection and the database rules.");
        }
    },

    /** Room tab card (main admins only): every administrator device, with Remove admin for secondary ones. */
    section() {
        const el = AdminCtl.el.bind(AdminCtl), card = el("section", "ac-section"), h3 = el("h3"), icon = el("span", "ac-ic", "\uD83D\uDEE1\uFE0F");
        card.id = "ac-roles"; icon.setAttribute("aria-hidden", "true");
        h3.append(icon, document.createTextNode("Administrator devices"));
        const list = el("ul", "gv-list"); list.id = "ac-roles-list";
        card.append(h3, el("p", "mx-hint", "Admin rank belongs to a device. Secondary admins can do everything except give or remove admin rank. Main admins are set in the database (devices/<deviceId>: esAdmin, esAdminPrincipal)."), list);
        this.renderDevices(list);
        return card;
    },

    renderDevices(list) {
        list = list || document.getElementById("ac-roles-list");
        if (!list) return;
        const el = AdminCtl.el.bind(AdminCtl), me = DeviceStore.getDeviceId(), devices = Roles.list();
        list.textContent = "";
        if (!devices.length) { const li = el("li", "mx-hint", "No administrator devices yet."); list.append(li); return; }
        devices.forEach((dev) => {
            const row = el("li", "gv-row"), box = el("div", "pl-name");
            row.style.padding = ".5rem 0";
            box.append(el("span", "pl-text", dev.label || "Unnamed device"),
                el("span", `badge ${dev.esAdminPrincipal ? "badge-gold" : "badge-warn"}`, dev.esAdminPrincipal ? "Main admin" : "Admin"),
                el("span", "badge badge-off", `\u2026${dev.id.slice(-6)}`));
            if (dev.id === me) box.append(el("span", "badge badge-ok", "This device"));
            if (!dev.esAdminPrincipal && dev.id !== me) {
                const btn = el("button", "btn btn-small btn-warn", "Remove admin");
                btn.type = "button";
                btn.addEventListener("click", async () => {
                    const ok = await Dialog.confirm({ title: "Remove admin", tone: "danger", confirmLabel: "Remove admin", message: `Remove administrator rank from the device of "${dev.label || "Unnamed device"}"?` });
                    if (ok) await this.run(dev.id, false, dev.label || "Unnamed device");
                });
                box.append(btn);
            }
            row.append(box); list.append(row);
        });
    },

    /** Badges and the two Admin buttons follow the rank (role-badge text: MAIN ADMIN / ADMIN). */
    refreshChrome() {
        const admin = State.isHost === true, main = State.isPrincipal === true;
        [DOM.authHostBadge, DOM.lobbyHostBadge].forEach((badge) => {
            if (!badge) return;
            badge.hidden = !admin; badge.textContent = main ? "\u2605 MAIN ADMIN" : "\u2605 ADMIN";
        });
        DOM.btnOpenAdmin.hidden = !admin; DOM.btnOpenAdminLobby.hidden = !admin;
    },

    onRoles(e) {
        this.refreshChrome();
        if (!State.isHost) {                                          // lost admin rank (or left the room)
            Admin.unlocked = false;
            if (!DOM.adminModal.hidden) Admin.close();
            AdminCtl.clear();
        } else if (e.prevPrincipal !== State.isPrincipal) {           // main <-> secondary: rebuild what the panel offers
            AdminCtl.clear();
            if (Admin.unlocked && !DOM.adminModal.hidden) Admin.renderTable();
        }
        PubSub.emit("players-updated", Room.playersCache);            // re-runs every Host-only toggle (prize rows, Host Settings...)
        if (e.silent) return;                                         // first read when entering the room: no toast
        if (State.isHost && !e.prevAdmin) {
            Notify.success(State.isPrincipal ? "You are now a main administrator." : "You are now an administrator.");
            if (State.username) Z.start();                            // admin-only listeners (audit log) start now
        } else if (!State.isHost && e.prevAdmin) {
            Notify.warning("Your administrator rank was removed.");
        } else if (State.isPrincipal && !e.prevPrincipal) {
            Notify.success("You are now a main administrator.");
        } else if (!State.isPrincipal && e.prevPrincipal) {
            Notify.warning("You are no longer a main administrator.");
        }
    },

    onRegistry() {
        this.renderDevices();
        if (State.isHost && Admin.unlocked && !DOM.adminModal.hidden) Admin.renderTable();
    }
};

PubSub.on("roles-updated", (e) => RolesUI.onRoles(e || {}));
PubSub.on("roles-registry-updated", () => RolesUI.onRegistry());

const resolve0 = GameResolver.resolve.bind(GameResolver);

GameResolver.resolve = function (id, r) {
    if (Rig.on && Rig.target && r && Array.isArray(r.winners) && r.winners.includes(Rig.target)) Audit.log("rig", `Chosen winner "${Rig.target}" used in ${GameResolver.label(id)}`);
    return resolve0(id, r);
};

/* ---------- Host Settings tabs: Limits | Bank | Audit ---------- */
const ZAdmin = {
    log: [], q: null, filter: "all",
    games() { return [...document.querySelectorAll(".nav-menu-item[data-game]")].map((b) => b.dataset.game).filter((g, i, a) => a.indexOf(g) === i && !["draw", "wheel", "quiz", "tournament"].includes(g)); },
    render() { if (!State.isHost) return; this.limits(); this.bank(); this.audit(); },
    limits() {
        const box = $z("z-a-limits"); if (!box) return;
        box.innerHTML = `<h3>Maximum bet</h3><p class="mx-hint">Applied before any wager is accepted. Per-game values override the global limit.</p>
           <div class="px-row"><span>Global limit (all games)</span><span></span><input type="number" id="zl-g" min="1" value="${BetLimits.g}"></div>
           ${this.games().map((g) => `<div class="px-row"><span>${esc(GameResolver.label(g))}</span><span></span><input type="number" data-zl="${esc(g)}" min="1" placeholder="${BetLimits.g}" value="${BetLimits.games[g] || ""}"></div>`).join("")}
           <button type="button" class="btn btn-primary btn-block" id="zl-save" style="margin-top:.8rem">Save &amp; sync limits</button>
           <button type="button" class="btn btn-ghost btn-block" id="zl-reset">Reset to default (${fmt(BetLimits.DEF)})</button>`;
    },
    saveLimits(reset) {
        const g = reset ? BetLimits.DEF : Math.max(1, Math.round(Number($z("zl-g").value) || BetLimits.DEF)), games = {};
        if (!reset) document.querySelectorAll("[data-zl]").forEach((i) => { const v = Math.round(Number(i.value)); if (v > 0) games[i.dataset.zl] = v; });
        zref("lim").set({ g, games }).then(() => { Notify.success("Bet limits synced."); Audit.log("limit", reset ? "Bet limits reset to default" : `Bet limits updated (global ${fmt(g)}, ${Object.keys(games).length} overrides)`); });
    },
    bank() {
        const box = $z("z-a-bank"); if (!box || box.contains(document.activeElement) && document.activeElement.tagName === "INPUT") return;
        const c = Bank.cfg(), reqs = Object.keys(Bank.d.req || {}).filter((u) => Bank.d.req[u].st === "pending"), loans = Room.list().filter((p) => p.loan && p.loan.owed > 0);
        box.innerHTML = `<h3>Central Bank</h3><div class="z-bank"><div><small>Reserve</small><b>${fmt(Bank.res())}</b></div><div><small>Open loans</small><b>${fmt(loans.reduce((a, p) => a + p.loan.owed, 0))}</b></div></div>
           <div class="px-row"><span>Bank open</span><span></span><input type="checkbox" id="zb-on" ${c.on ? "checked" : ""}></div>
           <div class="px-row"><span>Max loan</span><span></span><input type="number" id="zb-max" min="1" value="${c.max}"></div>
           <div class="px-row"><span>Interest %</span><span></span><input type="number" id="zb-rate" min="0" max="100" value="${c.rate}"></div>
           <div class="px-row"><span>Auto-approve requests</span><span></span><input type="checkbox" id="zb-auto" ${c.auto ? "checked" : ""}></div>
           <div class="px-row"><span>Add to reserve</span><span></span><input type="number" id="zb-add" min="0" value="0"></div>
           <button type="button" class="btn btn-primary btn-block" id="zb-save">Save bank settings</button>
           <h3>Pending requests (${reqs.length})</h3>${reqs.map((u) => `<div class="px-row"><span>${esc(u)}</span><span>${fmt(Bank.d.req[u].amt)} chips</span><button type="button" class="btn btn-small btn-primary" data-ap="${esc(u)}">Approve</button><button type="button" class="btn btn-small btn-secondary" data-dn="${esc(u)}">Deny</button></div>`).join("") || '<p class="mx-hint">None.</p>'}
           <h3>Active loans</h3>${loans.map((p) => `<div class="px-row"><span>${esc(p.username)}</span><span>owes ${fmt(p.loan.owed)}</span></div>`).join("") || '<p class="mx-hint">None.</p>'}`;
    },
    saveBank() {
        const cfg = { on: $z("zb-on").checked, max: Math.max(1, Math.round(+$z("zb-max").value || 500)), rate: Math.min(100, Math.max(0, +$z("zb-rate").value || 0)), auto: $z("zb-auto").checked }, add = Math.max(0, Math.round(+$z("zb-add").value || 0));
        zref("bank/cfg").set(cfg); if (add) zref("bank/res").transaction((v) => (v == null ? Bank.RES0 : v) + add);
        Notify.success("Bank settings saved."); Audit.log("bank", `Bank settings saved (max ${fmt(cfg.max)}, ${cfg.rate}%${add ? ", reserve +" + fmt(add) : ""})`);
    },
    audit() {
        const box = $z("z-a-audit"); if (!box) return;
        const T = ["all", "bigwin", "rig", "mission", "loan", "spin", "limit", "tour", "bank", "achv", "kick", "force", "score", "config", "role"], rows = this.log.filter((r) => this.filter === "all" || r.type === this.filter).slice().reverse();
        box.innerHTML = `<h3>Room audit log</h3><div class="mx-tools"><select id="za-f">${T.map((t) => `<option ${t === this.filter ? "selected" : ""}>${t}</option>`).join("")}</select><button type="button" class="btn btn-ghost btn-small" id="za-clear">Clear log</button></div>
           <div class="z-log">${rows.map((r) => `<div class="z-lr t-${esc(r.type)}"><small>${new Date(r.ts || 0).toLocaleTimeString()}</small><b>${esc(r.type)}</b><span>${esc(r.u)}: ${esc(r.msg)}</span></div>`).join("") || '<p class="mx-hint">No events yet.</p>'}</div>`;
    },
    click(e) {
        const t = e.target;
        if (t.id === "zl-save") this.saveLimits(false); else if (t.id === "zl-reset") this.saveLimits(true); else if (t.id === "zb-save") this.saveBank();
        else if (t.dataset.ap) Bank.approve(t.dataset.ap); else if (t.dataset.dn) Bank.deny(t.dataset.dn);
        else if (t.id === "za-clear") Dialog.confirm({ title: "Clear audit log", message: "Clear the whole audit log?", confirmLabel: "Clear log", tone: "danger" }).then((ok) => { if (ok) zref("audit").remove(); });
    }
};

window.__zAdmin = () => { const a = $z("px-adm"); if (!a.dataset.z) { a.dataset.z = 1; a.addEventListener("click", (e) => ZAdmin.click(e)); a.addEventListener("change", (e) => { if (e.target.id === "za-f") { ZAdmin.filter = e.target.value; ZAdmin.audit(); } }); } ZAdmin.render(); };

const soc0 = { start: Social.start.bind(Social), stop: Social.stop.bind(Social) };

Social.start = function () { soc0.start(); Z.start(); Quiz.start(); Presence.start(); };

Social.stop = function () { soc0.stop(); Z.stop(); Quiz.stop(); Presence.stop(); AdminCtl.clear(); };

/* =========================================================================
   APP BOOTSTRAP — must register LAST (this is the last script of the page).
   DOMContentLoaded listeners run in registration order, exactly as in the original build:
   first the VIP widgets (daily-spin tabs, quick dice, tournaments), then init() from ui-audio.js.
   ========================================================================= */
document.addEventListener("DOMContentLoaded", () => { Rewards.init(); Dice.init(); Tour.init(); Quiz.init(); });

document.addEventListener("DOMContentLoaded", init);
