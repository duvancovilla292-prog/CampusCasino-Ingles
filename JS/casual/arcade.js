/* CASINO CAMPUS — Arcade progress and iframe games.
   Classic <script> (not an ES module): top-level consts are shared with the other files
   through the page's global scope, so the load order in index.html matters. */
"use strict";

/* =========================================================================
   ARCADE PROGRESS — saved by the APP in Firebase (the embedded games run on another domain, so
   they cannot report anything to us; we record what the app itself can observe).

   Firebase path:  rooms/<code>/players/<username>/arcade
     {
       last:   "<gameId>",            // last casual game opened
       lastAt: <server timestamp>,
       games: { "<gameId>": { plays: <n>, secs: <seconds played>, best: <score>, at: <server timestamp> } }
     }

   WHERE IT IS CALLED (all inside the Arcade module below):
     Arcade.open(id)       -> ArcadeProgress.start(id)      plays +1, last game, timestamps
     Arcade.unmount()      -> ArcadeProgress.stop()         adds the seconds of this session
     "pagehide" event      -> ArcadeProgress.stop()         best effort when the tab is closed
     "Save score" button   -> Arcade.submitScore() -> ArcadeProgress.saveScore(id, n)   keeps the best
   The score is SELF-REPORTED (the iframe cannot send it to the app). Everything is also read back from
   the live players cache, so it updates in real time and survives reloads and new devices.
   ========================================================================= */
const ArcadeProgress = {
    MIN_SECS: 3,                 // shorter sessions do not add play time
    MAX_SESSION_SECS: 4 * 3600,  // safety cap for a forgotten open tab
    session: null,               // { id, t0 } while a game is open

    /** Reference to the current player's arcade node, or null when not logged in / offline. */
    ref() { return Room.playersRef && State.username ? Room.playersRef.child(State.username).child("arcade") : null; },

    /** The player's saved progress from the live cache ({} when empty). */
    mine() { const p = State.username ? Room.get(State.username) : null; return (p && p.arcade) || {}; },
    gameStats(id) { return (this.mine().games || {})[id] || {}; },

    /** Call when a game is opened: plays +1 and remember it as the last game. */
    start(id) {
        this.stop();
        const r = this.ref();
        if (!r) return;
        this.session = { id, t0: Date.now() };
        r.child("games").child(id).child("plays").transaction((n) => (n || 0) + 1);
        r.update({ last: id, lastAt: TS(), ["games/" + id + "/at"]: TS() });
    },

    /** Call when the game is closed: adds this session's seconds to the game's total. */
    stop() {
        const s = this.session;
        this.session = null;
        const r = this.ref();
        if (!s || !r) return;
        const secs = Math.min(this.MAX_SESSION_SECS, Math.round((Date.now() - s.t0) / 1000));
        if (secs < this.MIN_SECS) return;
        r.child("games").child(s.id).child("secs").transaction((n) => (n || 0) + secs);
    },

    /** Saves a score for a game; only a higher score replaces the stored best. */
    saveScore(id, score) {
        const r = this.ref();
        score = Math.round(Number(score));
        if (!r || !Number.isFinite(score) || score < 0 || score > 1e9) return Promise.resolve(null);
        return r.child("games").child(id).child("best").transaction((b) => (b == null || score > b ? score : b));
    },

    fmtSecs(s) { return s >= 3600 ? (s / 3600).toFixed(1) + " h" : s >= 60 ? Math.round(s / 60) + " min" : s + " s"; },
    /** "Played 3x · 12 min · Best 1,200" (empty string when never played). */
    summary(id) {
        const g = this.gameStats(id);
        if (!g.plays) return "";
        const parts = ["Played " + g.plays + "\u00D7"];
        if (g.secs) parts.push(this.fmtSecs(g.secs));
        if (g.best != null) parts.push("Best " + Number(g.best).toLocaleString("en-US"));
        return parts.join(" \u00B7 ");
    }
};

/* =========================================================================
   ARCADE — Casual iframe games (Poki / CrazyGames style) managed by the Host

   * Players only SEE and PLAY the enabled games (one iframe at a time).
   * The Host (Admin.unlocked + State.isHost) gets a "Manage games" button. That button and the
     floating editor modal are built into the DOM only for the authenticated Host; for everyone
     else nothing exists in the page.
   * Hybrid persistence:
       - Realtime: rooms/<code>/arcade = { custom, games:{id:{...,order}}, ts, by } (live for all).
       - Repository: data/data.json is the default list (used while the Host has not edited the
         list in this room). The editor can Download the current list as data.json (replace the file
         in the repo) and Import a JSON file. GitHub Pages is static, so the page cannot write it.
   * Every iframe src is validated: https only and host in ALLOWED_HOSTS (edit the list to add
     providers). Text is inserted with textContent, never as raw HTML.
   ========================================================================= */
   const Arcade = {
    KEY: "arcade",
    SEED_URL: "data/data.json",
    ALLOWED_HOSTS: ["gamedistribution.com", "crazygames.com", "poki.com"],
    MAX_GAMES: 60,
    /**
     * GameDistribution only serves a game on sites it knows. The embedding site is declared with the
     * `gd_sdk_referrer_url` query parameter, which MUST be this exact GitHub Pages address; without it the
     * game shows "is not available here". parseSrc() writes it into every GameDistribution link (data.json,
     * Firebase, imports, the editor) and embedUrl() rebuilds it from the game ID at load time.
     */
    REFERRER_URL: "https://duvancovilla292-prog.github.io/CampusCasino-Ingles/",
    GD_HOST: "html5.gamedistribution.com",
    GD_PARAM: "gd_sdk_referrer_url",
    /**
     * iframe sandbox (declared once). It deliberately OMITS allow-top-navigation and allow-popups, so a game
     * script can never run `top.location = ...` / `window.parent.location = ...` or open other tabs: the
     * browser blocks it and the player stays inside the app. Set to "" to disable the sandbox completely
     * (not recommended).
     */
    SANDBOX: "allow-scripts allow-same-origin allow-forms allow-pointer-lock allow-modals allow-orientation-lock allow-presentation",
    /** Fallback when data/data.json cannot be fetched (e.g. page opened from file://). */
    DEFAULT_GAMES: [{
        id: "kick-the-buddy", title: "Kick The Buddy", icon: "\u{1F94A}",
        description: "Relax-and-play ragdoll sandbox.",
        src: "3785ca02d41845c389b09c5e1ff4ced7",   // a bare GameDistribution code is enough: parseSrc() builds the full URL
        width: 800, height: 600, enabled: true
    }, {
        // Titles are placeholders: rename them in the Arcade editor (or in data/data.json).
        id: "gd-3ae409", title: "GD Game 1", icon: "\u{1F3AE}", description: "Rename me in the Arcade editor.",
        src: "3ae409f702f64fab98743afbfdf211a1", width: 800, height: 600, enabled: true
    }, {
        id: "gd-0c89181", title: "GD Game 2", icon: "\u{1F3AE}", description: "Rename me in the Arcade editor.",
        src: "0c89181b9cfe4897afa41b0f94385da9", width: 800, height: 600, enabled: true
    }, {
        id: "gd-57820e9", title: "GD Game 3", icon: "\u{1F3AE}", description: "Rename me in the Arcade editor.",
        src: "57820e917cff42488d174341b8866760", width: 800, height: 600, enabled: true
    }],

    seed: null,          // list from data/data.json (or DEFAULT_GAMES)
    remote: null,        // list synced from Firebase (null = Host never saved a custom list)
    seedPromise: null,
    activeId: null,      // game currently mounted in the player
    editingId: null,     // game loaded in the editor form
    repoDirty: false,    // true after an edit until the Host downloads data.json
    f: null,             // editor form fields
    modal: null,         // floating editor overlay (exists only for the authenticated Host)
    onKey: null,         // Escape handler of the modal

    $(id) { return document.getElementById(id); },
    el(tag, cls, text) {
        const n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text != null) n.textContent = text;
        return n;
    },

    /* ---------------- parsing & validation ---------------- */

    /** Accepts a GameDistribution code, a URL, a pasted <iframe ...> snippet or a [url](url) link. */
    parseSrc(raw) {
        let s = String(raw || "").trim();
        const tag = s.match(/src\s*=\s*["']([^"']+)["']/i);
        if (tag) s = tag[1].trim();
        const md = s.match(/^\[[^\]]*\]\((.+)\)$/);
        if (md) s = md[1].trim();
        if (/^[a-f0-9]{32}$/i.test(s)) s = "https://html5.gamedistribution.com/" + s.toLowerCase() + "/";
        let u;
        try { u = new URL(s); } catch (e) { return null; }
        if (u.protocol !== "https:") return null;
        const h = u.hostname.toLowerCase();
        if (!this.ALLOWED_HOSTS.some((a) => h === a || h.endsWith("." + a))) return null;
        return h === this.GD_HOST ? this.withReferrer(u) : u.href;
    },

    /**
     * Canonical GameDistribution link: https://html5.gamedistribution.com/<GAME_ID>/?gd_sdk_referrer_url=<REFERRER_URL>
     * Any old or wrong referrer value is removed first (idempotent); other query parameters are kept and the
     * referrer is appended last, unencoded, exactly in the format the provider documents.
     */
    withReferrer(url) {
        const u = new URL(url.href);
        [...u.searchParams.keys()].filter((k) => k.toLowerCase() === this.GD_PARAM).forEach((k) => u.searchParams.delete(k));
        const rest = u.searchParams.toString();
        let path = u.pathname;
        if (!path.endsWith("/") && !/\.[a-z0-9]+$/i.test(path)) path += "/";  // .../GAME_ID -> .../GAME_ID/
        return u.origin + path + "?" + (rest ? rest + "&" : "") + this.GD_PARAM + "=" + this.REFERRER_URL;
    },

    /** The link without the referrer parameter (what the editor shows: short and readable). */
    cleanSrc(src) {
        try {
            const u = new URL(src);
            [...u.searchParams.keys()].filter((k) => k.toLowerCase() === this.GD_PARAM).forEach((k) => u.searchParams.delete(k));
            const rest = u.searchParams.toString();
            return u.origin + u.pathname + (rest ? "?" + rest : "");
        } catch (e) { return String(src || ""); }
    },
    clampInt(v, lo, hi, def) { v = Math.round(Number(v)); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def; },
    slug(t) { return String(t).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 36) || "game"; },
    uniqueId(base, taken) { let id = base || "game", n = 2; while (taken.has(id)) id = base + "-" + n++; return id; },

    /** Optional thumbnail URL: https and an allowed host (image CDNs such as img.gamedistribution.com). */
    parseThumb(raw) {
        let u;
        try { u = new URL(String(raw || "").trim()); } catch (e) { return ""; }
        if (u.protocol !== "https:") return "";
        const h = u.hostname.toLowerCase();
        return this.ALLOWED_HOSTS.some((a) => h === a || h.endsWith("." + a)) ? u.href : "";
    },
    /** Thumbnail for a game: its own `thumb`, else the GameDistribution pattern built from the game code, else "". */
    thumbFor(g) {
        if (g.thumb) return g.thumb;
        try {
            const u = new URL(g.src);
            if (u.hostname.toLowerCase() === "html5.gamedistribution.com") {
                const code = u.pathname.split("/").filter(Boolean)[0] || "";
                if (/^[a-f0-9]{32}$/i.test(code)) return "https://img.gamedistribution.com/" + code.toLowerCase() + "-512x512.jpg";
            }
        } catch (e) { /* no thumbnail available */ }
        return "";
    },
    /** Square thumbnail box. The emoji is always rendered underneath: if the image fails, it simply stays. */
    makeThumb(g, small) {
        const box = this.el("span", "arcade-thumb" + (small ? " is-small" : ""));
        box.appendChild(this.el("span", "arcade-emoji", g.icon));
        const url = this.thumbFor(g);
        if (url) {
            const img = document.createElement("img");
            img.alt = "";
            img.decoding = "async";
            img.addEventListener("load", () => box.classList.add("has-img"));
            img.addEventListener("error", () => img.remove()); // fallback: emoji stays visible
            img.src = url;
            box.appendChild(img);
        }
        return box;
    },

    /** Returns a clean game object or null when it is invalid. */
    normalize(g) {
        if (!g || typeof g !== "object") return null;
        const src = this.parseSrc(g.src || g.url || g.code);
        const title = String(g.title || "").replace(/\s+/g, " ").trim().slice(0, 40);
        if (!src || !title) return null;
        const icon = Array.from(String(g.icon || "").trim()).slice(0, 2).join("") || "\u{1F3AE}";
        return {
            id: String(g.id || "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 48),
            title, icon, src, thumb: this.parseThumb(g.thumb || g.image),
            description: String(g.description || "").trim().slice(0, 120),
            width: this.clampInt(g.width, 200, 2000, 800),
            height: this.clampInt(g.height, 200, 2000, 600),
            enabled: g.enabled !== false
        };
    },
    normalizeList(arr) {
        const out = [], taken = new Set();
        let skipped = 0;
        (Array.isArray(arr) ? arr : []).slice(0, this.MAX_GAMES).forEach((raw) => {
            const g = this.normalize(raw);
            if (!g) { skipped++; return; }
            g.id = this.uniqueId(g.id || this.slug(g.title), taken);
            taken.add(g.id);
            out.push(g);
        });
        return { list: out, skipped };
    },

    /** Current list: the room's custom list when it exists, otherwise data/data.json. */
    list() { return this.remote || this.seed || this.normalizeList(this.DEFAULT_GAMES).list; },

    /* ---------------- data sources ---------------- */

    /** Loads data/data.json once (or again when `force`). Falls back to DEFAULT_GAMES. */
    loadSeed(force) {
        if (this.seedPromise && !force) return this.seedPromise;
        this.seedPromise = fetch(this.SEED_URL, { cache: "no-store" })
            .then((r) => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
            .then((j) => this.normalizeList(Array.isArray(j) ? j : j && j.games).list)
            .catch(() => this.normalizeList(this.DEFAULT_GAMES).list)
            .then((list) => { this.seed = list; this.render(); return list; });
        return this.seedPromise;
    },

    /** Firebase listener (rooms/<code>/arcade). */
    onRemote(v) {
        this.remote = v && v.custom
            ? this.normalizeList(Object.values(v.games || {}).sort((a, b) => (a.order || 0) - (b.order || 0))).list
            : null;
        if (this.activeId && !this.list().some((g) => g.id === this.activeId && g.enabled)) {
            this.unmount();
            Notify.warning("The Host removed that game.");
        }
        this.render();
    },

    /* ---------------- player view ---------------- */

    render() {
        const box = this.$("arcade-list");
        if (!box) return;
        box.textContent = "";
        const games = this.list().filter((g) => g.enabled);
        const last = ArcadeProgress.mine().last; // highlighted card = last game this player opened
        this.sig = JSON.stringify(ArcadeProgress.mine());
        if (!games.length) box.appendChild(this.el("p", "bw-info", "No games available yet."));
        games.forEach((g) => {
            const card = this.el("button", "arcade-card");
            card.type = "button";
            card.append(this.makeThumb(g, false), this.el("strong", "", g.title));
            if (g.description) card.appendChild(this.el("small", "", g.description));
            const stats = ArcadeProgress.summary(g.id);
            if (stats) card.appendChild(this.el("small", "arcade-stats", stats));
            if (g.id === last) { card.classList.add("is-last"); card.title = "Last game you played"; }
            card.addEventListener("click", (e) => {
                e.preventDefault();   // never let the browser run a default action for this click
                e.stopPropagation();  // nothing else (menus, document listeners) should react to it
                this.open(g.id);
            });
            box.appendChild(card);
        });
        this.syncAdmin();
        this.renderEditorList();
    },

    /**
     * URL actually loaded in the iframe. For GameDistribution games it ALWAYS rebuilds the canonical link
     * from the game ID only, so whatever is stored (bare code, short URL, old referrer, extra params) is
     * ignored:
     * https://html5.gamedistribution.com/GAME_ID/?gd_sdk_referrer_url=https://duvancovilla292-prog.github.io/CampusCasino-Ingles/
     * Other allowed providers keep their validated URL. Returns "" when the stored link is not valid.
     */
    embedUrl(g) {
        const src = this.parseSrc(g && g.src);
        if (!src) return "";
        let u;
        try { u = new URL(src); } catch (e) { return ""; }
        if (u.hostname.toLowerCase() !== this.GD_HOST) return src;
        const id = u.pathname.split("/").filter(Boolean)[0] || "";
        if (!/^[a-f0-9]{32}$/i.test(id)) return "";
        return "https://" + this.GD_HOST + "/" + id.toLowerCase() + "/?" + this.GD_PARAM + "=" + this.REFERRER_URL;
    },

    /** Mounts the standard iframe inside a responsive 'stage' container (always in place, never navigating). */
    open(id) {
        const g = this.list().find((x) => x.id === id && x.enabled);
        if (!g) return;
        const url = this.embedUrl(g);
        if (!url) return Notify.error("This game link is not valid. Ask the host to fix it in the Arcade editor.");
        this.unmount();
        this.activeId = id;
        this.$("arcade-title").textContent = g.title;
        const stage = this.$("arcade-stage");
        stage.style.maxWidth = g.width + "px";
        stage.style.aspectRatio = g.width + " / " + g.height;
        const frame = document.createElement("iframe");
        if (this.SANDBOX) frame.setAttribute("sandbox", this.SANDBOX); // set BEFORE src: no top-navigation from the game
        frame.src = url;
        frame.setAttribute("width", "100%");              // the responsive stage (CSS aspect-ratio) sizes the frame
        frame.setAttribute("height", String(g.height));   // 600 by default
        frame.setAttribute("scrolling", "no");
        frame.setAttribute("frameborder", "0");
        frame.setAttribute("allowfullscreen", "");
        frame.setAttribute("allow", "autoplay; fullscreen");
        frame.title = g.title;
        stage.appendChild(frame);
        this.$("arcade-list").hidden = true;
        this.$("arcade-player").hidden = false;
        ArcadeProgress.start(id); // <-- persists plays / last game in Firebase
        this.updateBar();
    },

    /** Removes the iframe (stops the game and its audio) and shows the list again. */
    unmount() {
        ArcadeProgress.stop(); // <-- persists the seconds played in this session
        const stage = this.$("arcade-stage"), player = this.$("arcade-player"), list = this.$("arcade-list");
        if (stage) stage.textContent = "";
        if (player) player.hidden = true;
        if (list) list.hidden = false;
        this.activeId = null;
    },

    /** Shows the active game's best score and play stats under the game. */
    updateBar() {
        const out = this.$("arcade-best");
        if (!out) return;
        const g = this.activeId ? ArcadeProgress.gameStats(this.activeId) : {};
        out.textContent = g.best != null ? "Your best: " + Number(g.best).toLocaleString("en-US") : "No score saved yet";
    },
    /** Re-renders only when this player's saved progress changed (players-updated fires often). */
    refreshStats() {
        if (JSON.stringify(ArcadeProgress.mine()) === this.sig) return;
        this.render();
        this.updateBar();
    },
    /** "Save score" button: self-reported score for the open game. */
    submitScore() {
        const input = this.$("arcade-score");
        if (!input || !this.activeId) return;
        const v = Math.round(Number(input.value));
        if (!input.value || !Number.isFinite(v) || v < 0) return Notify.error("Enter a valid score.");
        ArcadeProgress.saveScore(this.activeId, v).then((r) => {
            if (!r) return Notify.error("Could not save the score.");
            input.value = "";
            Notify.success(r.committed && r.snapshot.val() === v ? "New best score saved!" : "Saved. Your best is still higher.");
            this.updateBar();
        }).catch(() => Notify.error("Could not save the score."));
    },

    onTab(key) {
        if (key === this.KEY) this.render();
        else this.unmount();
    },

    /** Clears per-room state when the player leaves the room. */
    reset() {
        this.unmount();
        this.remote = null;
        this.repoDirty = false;
        this.teardownAdmin();
    },

    /* ---------------- Host-only management ---------------- */

    adminAllowed() { return State.isHost === true && Admin.unlocked === true; },

    /** Builds the "Manage games" button and its floating modal ONLY for the authenticated Host. */
    syncAdmin() {
        const slot = this.$("arcade-admin-slot");
        if (!slot) return;
        if (!this.adminAllowed()) { this.teardownAdmin(); return; }
        if (!this.modal) this.buildAdmin(slot);
    },
    /** Removes the button and the modal from the DOM (not hidden: removed). */
    teardownAdmin() {
        const slot = this.$("arcade-admin-slot");
        if (slot) slot.textContent = "";
        if (this.onKey) { document.removeEventListener("keydown", this.onKey); this.onKey = null; }
        if (this.modal) { this.modal.remove(); this.modal = null; }
        this.editingId = null; this.f = null;
    },

    buildAdmin(slot) {
        const el = this.el.bind(this);
        const field = (label, input) => { const l = el("label", "ac-field"); l.append(el("span", "", label), input); return l; };
        const input = (type, max, ph) => { const i = el("input", "input-field"); i.type = type; if (max) i.maxLength = max; if (ph) i.placeholder = ph; return i; };
        const btn = (text, cls, fn) => { const b = el("button", cls, text); b.type = "button"; b.addEventListener("click", fn); return b; };
        slot.textContent = "";

        const open = btn("\u2699 Manage games", "btn btn-secondary", () => this.openEditor());
        open.id = "arcade-manage-btn";
        slot.appendChild(open);

        // Floating menu: same overlay / card classes as the Shop, Leaderboard and Admin modals.
        const overlay = el("div", "modal-overlay");
        overlay.id = "arcade-modal";
        overlay.hidden = true;
        const card = el("div", "modal arcade-modal");
        card.setAttribute("role", "dialog");
        card.setAttribute("aria-modal", "true");
        card.setAttribute("aria-labelledby", "arcade-modal-title");
        const close = btn("\u2715", "modal-close", () => this.closeEditor());
        close.setAttribute("aria-label", "Close");
        const title = el("h2", "", "\u{1F579} Manage casual games");
        title.id = "arcade-modal-title";
        card.append(close, title, el("p", "modal-subtitle", "Changes are live for everyone in the room."));

        // --- current list ---
        const listBox = el("div", "arcade-ed-list");
        listBox.id = "arcade-ed-list";
        card.appendChild(listBox);

        // --- add / edit form ---
        const f = this.f = {
            title: input("text", 40, "Game title"), icon: input("text", 4, "\u{1F3AE}"),
            src: input("text", 600, "GameDistribution code, URL or <iframe> snippet"),
            thumb: input("text", 600, "Optional: https image URL (auto for GameDistribution)"),
            desc: input("text", 120, "Short description (optional)"),
            w: input("number"), h: input("number")
        };
        f.w.value = 800; f.h.value = 600; f.w.min = f.h.min = 200; f.w.max = f.h.max = 2000;
        f.save = btn("Add game", "btn btn-primary", () => this.submitForm());
        f.cancel = btn("Cancel edit", "btn btn-secondary", () => this.resetForm());
        f.cancel.hidden = true;
        const grid = el("div", "ac-grid");
        grid.append(field("Title", f.title), field("Fallback emoji", f.icon), field("Code / URL / iframe", f.src),
            field("Thumbnail URL", f.thumb), field("Description", f.desc), field("Width", f.w), field("Height", f.h));
        const formActions = el("div", "arcade-actions");
        formActions.append(f.save, f.cancel);
        card.append(el("h4", "", "Add or edit a game"), grid, formActions,
            el("p", "mx-hint", "Allowed providers: " + this.ALLOWED_HOSTS.join(", ") + ". Only https links are accepted. If a thumbnail cannot load, the emoji is shown instead."));

        // --- repository tools ---
        const file = input("file");
        file.accept = "application/json,.json";
        file.hidden = true;
        file.addEventListener("change", () => { this.importJson(file.files[0]); file.value = ""; });
        const tools = el("div", "arcade-actions");
        tools.append(
            btn("\u2B07 Download data.json", "btn btn-secondary", () => this.exportJson()),
            btn("\u2B06 Import JSON", "btn btn-secondary", () => file.click()),
            btn("\u21BA Reset from repo data.json", "btn btn-secondary", () => this.resetFromRepo()),
            file
        );
        const warn = el("p", "arcade-repo-warn", "\u26A0 Changes are live in the room but NOT in the repository yet: download data.json and replace data/data.json in the repo.");
        warn.id = "arcade-repo-warn";
        warn.hidden = !this.repoDirty;
        card.append(el("h4", "", "Repository file (data/data.json)"), tools, warn);

        overlay.appendChild(card);
        overlay.addEventListener("click", (e) => { if (e.target === overlay) this.closeEditor(); });
        this.onKey = (e) => { if (e.key === "Escape" && !overlay.hidden) this.closeEditor(); };
        document.addEventListener("keydown", this.onKey);
        document.body.appendChild(overlay);
        this.modal = overlay;
    },
    openEditor() {
        if (!this.modal || !this.adminAllowed()) return;
        this.modal.hidden = false;
        this.renderEditorList();
    },
    closeEditor() { if (this.modal) Fx.closeModal(this.modal); },

    renderEditorList() {
        const box = this.$("arcade-ed-list");
        if (!box || !this.adminAllowed()) return;
        const el = this.el.bind(this), list = this.list();
        const btn = (text, title, fn, disabled) => { const b = el("button", "btn btn-small btn-secondary", text); b.type = "button"; b.title = title; b.disabled = !!disabled; b.addEventListener("click", fn); return b; };
        box.textContent = "";
        if (!list.length) box.appendChild(el("p", "bw-info", "The list is empty. Add a game below."));
        list.forEach((g, i) => {
            const row = el("div", "arcade-row" + (g.enabled ? "" : " is-off"));
            let host = ""; try { host = new URL(g.src).hostname; } catch (e) { /* ignore */ }
            const info = el("span", "arcade-row-info");
            info.append(el("span", "arcade-row-title", g.title + (g.enabled ? "" : " (hidden)")), el("span", "arcade-row-host", host));
            row.append(this.makeThumb(g, true), info);
            const acts = el("span", "arcade-row-actions");
            acts.append(
                btn("\u25B2", "Move up", () => this.move(g.id, -1), i === 0),
                btn("\u25BC", "Move down", () => this.move(g.id, 1), i === list.length - 1),
                btn("Edit", "Edit this game", () => this.edit(g.id)),
                btn(g.enabled ? "Hide" : "Show", "Show or hide for players", () => this.toggleGame(g.id)),
                btn("Delete", "Delete this game", () => this.removeGame(g.id))
            );
            row.appendChild(acts);
            box.appendChild(row);
        });
    },
    updateWarn() { const w = this.$("arcade-repo-warn"); if (w) w.hidden = !this.repoDirty; },

    /** Writes the full list to Firebase (everyone receives it instantly). */
    persist(list, what) {
        if (!this.adminAllowed()) return Promise.reject(new Error("not admin"));
        const ref = zref("arcade");
        if (!ref) { Notify.error("Not connected to a room."); return Promise.reject(new Error("no room")); }
        const games = {};
        list.forEach((g, i) => { games[g.id] = { ...g, order: i }; });
        return ref.set({ custom: true, games, ts: TS(), by: State.username || "host" })
            .then(() => {
                this.repoDirty = true; this.updateWarn();
                Audit.log("config", `Arcade: ${what} (${list.length} games)`);
                Notify.success(`${what}. Synced to the room.`);
            })
            .catch((e) => { Notify.error("Could not save the game list."); throw e; });
    },
    copyList() { return this.list().map((g) => ({ ...g })); },

    submitForm() {
        if (!this.adminAllowed() || !this.f) return;
        const f = this.f, list = this.copyList();
        if (!f.title.value.trim()) return Notify.error("Enter a title.");
        const src = this.parseSrc(f.src.value);
        if (!src) return Notify.error("Invalid source. Use a GameDistribution code or an https iframe URL (" + this.ALLOWED_HOSTS.join(", ") + ").");
        const thumb = f.thumb.value.trim() ? this.parseThumb(f.thumb.value) : "";
        if (f.thumb.value.trim() && !thumb) return Notify.error("Invalid thumbnail URL (https and an allowed host).");
        const data = { title: f.title.value, icon: f.icon.value, description: f.desc.value, src, thumb, width: f.w.value, height: f.h.value };
        let what;
        if (this.editingId) {
            const i = list.findIndex((g) => g.id === this.editingId);
            if (i < 0) return Notify.error("That game no longer exists.");
            list[i] = { ...this.normalize({ ...list[i], ...data }), id: this.editingId };
            what = "Updated " + list[i].title;
        } else {
            if (list.length >= this.MAX_GAMES) return Notify.error(`Maximum ${this.MAX_GAMES} games.`);
            const g = this.normalize(data);
            g.id = this.uniqueId(this.slug(g.title), new Set(list.map((x) => x.id)));
            list.push(g);
            what = "Added " + g.title;
        }
        this.persist(list, what).then(() => this.resetForm()).catch(() => {});
    },
    edit(id) {
        const g = this.list().find((x) => x.id === id);
        if (!g || !this.f) return;
        const f = this.f;
        this.editingId = id;
        f.title.value = g.title; f.icon.value = g.icon; f.src.value = this.cleanSrc(g.src); f.thumb.value = g.thumb || ""; f.desc.value = g.description;
        f.w.value = g.width; f.h.value = g.height;
        f.save.textContent = "Save changes"; f.cancel.hidden = false;
        f.title.focus({ preventScroll: true });
        f.title.scrollIntoView({ block: "center", behavior: "smooth" }); // reveal the form inside the modal on phones
    },
    resetForm() {
        const f = this.f;
        this.editingId = null;
        if (!f) return;
        f.title.value = f.icon.value = f.src.value = f.thumb.value = f.desc.value = "";
        f.w.value = 800; f.h.value = 600;
        f.save.textContent = "Add game"; f.cancel.hidden = true;
    },
    move(id, dir) {
        if (!this.adminAllowed()) return;
        const list = this.copyList(), i = list.findIndex((g) => g.id === id), j = i + dir;
        if (i < 0 || j < 0 || j >= list.length) return;
        [list[i], list[j]] = [list[j], list[i]];
        this.persist(list, "Reordered games").catch(() => {});
    },
    toggleGame(id) {
        if (!this.adminAllowed()) return;
        const list = this.copyList(), g = list.find((x) => x.id === id);
        if (!g) return;
        g.enabled = !g.enabled;
        this.persist(list, (g.enabled ? "Showed " : "Hid ") + g.title).catch(() => {});
    },
    async removeGame(id) {
        if (!this.adminAllowed()) return;
        const list = this.copyList(), g = list.find((x) => x.id === id);
        if (!g) return;
        // Dialog (admin-panel.js) replaces window.confirm: bottom sheet on phones.
        const ok = await Dialog.confirm({ title: "Delete game", tone: "danger", confirmLabel: "Delete", message: `Delete "${g.title}" from the list?` });
        if (!ok || !this.adminAllowed()) return;
        if (this.editingId === id) this.resetForm();
        this.persist(list.filter((x) => x.id !== id), "Deleted " + g.title).catch(() => {});
    },

    /** Downloads the current list as data.json (replace data/data.json in the repository). */
    exportJson() {
        if (!this.adminAllowed()) return;
        const games = this.list().map(({ id, title, icon, description, src, thumb, width, height, enabled }) => ({ id, title, icon, description, src, ...(thumb ? { thumb } : {}), width, height, enabled }));
        const json = JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), games }, null, 2) + "\n";
        const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
        const a = document.createElement("a");
        a.href = url; a.download = "data.json";
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        this.repoDirty = false; this.updateWarn();
        Notify.success("data.json downloaded. Replace data/data.json in your repository.");
    },
    importJson(file) {
        if (!file || !this.adminAllowed()) return;
        if (file.size > 512 * 1024) return Notify.error("File too large (max 512 KB).");
        const reader = new FileReader();
        reader.onload = async () => {
            let json;
            try { json = JSON.parse(String(reader.result)); } catch (e) { return Notify.error("That file is not valid JSON."); }
            const { list, skipped } = this.normalizeList(Array.isArray(json) ? json : json && json.games);
            if (!list.length) return Notify.error("No valid games found in that file.");
            const extra = skipped ? ` (${skipped} invalid skipped)` : "";
            const ok = await Dialog.confirm({ title: "Import games", confirmLabel: "Replace list", message: `Replace the current list with ${list.length} game(s)${extra}?` });
            if (!ok || !this.adminAllowed()) return;
            this.persist(list, "Imported " + list.length + " games").catch(() => {});
        };
        reader.readAsText(file);
    },
    /** Replaces the room's custom list with the one stored in the repository's data/data.json. */
    async resetFromRepo() {
        if (!this.adminAllowed()) return;
        const ok = await Dialog.confirm({ title: "Reset from data.json", tone: "danger", confirmLabel: "Replace list", message: "Replace the room's list with the repository's data/data.json?" });
        if (!ok || !this.adminAllowed()) return;
        this.loadSeed(true).then((list) => this.persist(list, "Reset from data.json").catch(() => {}));
    }
};

document.addEventListener("game-changed", (e) => Arcade.onTab(e.detail.gameKey));
PubSub.on("players-updated", () => Arcade.refreshStats());
window.addEventListener("pagehide", () => ArcadeProgress.stop()); // best effort when the tab is closed
document.addEventListener("click", (e) => {
    if (e.target.closest("#arcade-back")) Arcade.unmount();
    else if (e.target.closest("#arcade-score-save")) Arcade.submitScore();
    else if (e.target.closest("#arcade-full")) {
        const stage = Arcade.$("arcade-stage");
        if (stage && stage.requestFullscreen) stage.requestFullscreen().catch(() => {});
    }
});
{
    const start0 = Social.start, stop0 = Social.stop;
    Social.start = function () { start0.call(Social); Arcade.loadSeed(); };
    Social.stop = function () { stop0.call(Social); Arcade.reset(); };
}
