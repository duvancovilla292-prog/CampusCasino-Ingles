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
 * Live state shape:
 *   live = { id, questionId, question, index, total, optionsVisible, answerVisible }
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
            question: { prompt: q.prompt, options: this.optionList(q), correctIndex: q.correctIndex }, // never the `order` field
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

    /* ------------------------------ audience stage ------------------------------ */

    render() {
        const stage = $z("quiz-stage"), live = this.data.live, h = this.h.bind(this);
        stage.textContent = "";
        if (!live?.question) {
            this.lastStage = "";
            const empty = h("div", "quiz-empty");
            empty.append(
                h("div", "quiz-empty-icon", "?"),
                h("p", "quiz-waiting", "Next question coming up"),
                h("p", "quiz-sub", "The host is preparing the questions. Keep this screen open to follow along.")
            );
            stage.append(empty);
        } else {
            const q = live.question, options = this.optionList(q);
            // Entrance animation only when the visible state really changed (not on busy/ready re-renders).
            const stamp = `${live.id}:${live.optionsVisible}:${live.answerVisible}`;
            const animate = stamp !== this.lastStage; this.lastStage = stamp;
            const head = h("div", "quiz-head");
            head.append(
                h("span", "quiz-live-badge", "LIVE"),
                ...(Number.isInteger(live.index) && live.total > 0 ? [h("span", "quiz-phase", `Question ${live.index + 1} of ${live.total}`)] : []),
                h("span", `quiz-phase${live.optionsVisible ? " is-open" : ""}`, live.optionsVisible ? "Choose your answer" : "Question on air")
            );
            stage.append(head, h("h3", "quiz-prompt", q.prompt));

            if (!live.optionsVisible) {
                // Letters are shown, but the option text is NOT in the DOM until revealed.
                const masked = h("ol", "quiz-options is-masked");
                masked.setAttribute("aria-hidden", "true");
                options.forEach((_, index) => {
                    const item = h("li", "quiz-option is-masked");
                    item.append(h("span", "quiz-letter", this.label(index)), h("span", "quiz-mask"));
                    masked.append(item);
                });
                stage.append(masked, h("p", "quiz-hidden-message", "Think of your answer and say it out loud. The options will be revealed in a moment."));
            } else {
                const list = h("ol", `quiz-options${animate ? " is-entering" : ""}`);
                options.forEach((text, index) => {
                    const correct = live.answerVisible && index === q.correctIndex;
                    const state = live.answerVisible ? (correct ? " is-correct" : " is-dim") : "";
                    const item = h("li", `quiz-option${state}`);
                    item.style.setProperty("--i", String(index));
                    item.append(h("span", "quiz-letter", this.label(index)), h("span", "quiz-text", text));
                    if (correct) item.append(h("strong", "quiz-correct", "\u2713 Correct answer"));
                    list.append(item);
                });
                stage.append(list);
            }
        }
        this.renderHost();
    },

    /** Button factory; respects the ready/busy gate. `variant` = secondary | primary | danger | ghost. */
    button(text, action, disabled = false, variant = "secondary") {
        const button = this.h("button", `btn btn-${variant}`, text);
        button.type = "button";
        button.disabled = disabled || !this.ready || this.busy;
        button.addEventListener("click", action);
        return button;
    },

    /** Host dock under the stage: reveal / hide options, reveal answer, end question. */
    renderHost() {
        const root = $z("quiz-host"); root.textContent = ""; root.hidden = !this.allowed();
        if (!this.allowed()) return;
        const live = this.data.live;
        const manage = this.button("\u2699 Manage questions", () => Admin.open(), false, "ghost");
        const nav = this.position().total ? [this.navControls()] : [];
        if (!live?.question) { root.append(...nav, manage); return; }
        const toggle = this.button(live.optionsVisible ? "\uD83D\uDE48 Hide options" : "\uD83D\uDC41 Reveal options", () => this.toggleOptions(), false, live.optionsVisible ? "secondary" : "primary");
        toggle.setAttribute("aria-pressed", String(live.optionsVisible));
        const answer = this.button(live.answerVisible ? "Hide correct answer" : "\u2713 Reveal correct answer", () => this.toggleAnswer(), !live.optionsVisible, "secondary");
        answer.setAttribute("aria-pressed", String(live.answerVisible));
        const end = this.button("\u25A0 End question", () => this.endQuestion(), false, "danger");
        root.append(...nav, toggle, answer, end, manage);
    },

    /* ------------------------------ admin panel ------------------------------ */

    /** "On air" card inside the admin panel: mirrors the live controls + correct-answer picker. */
    renderAdminLive() {
        const root = $z("quiz-live-admin"), live = this.data.live, h = this.h.bind(this);
        root.textContent = "";
        if (!live?.question) {
            root.append(h("p", "qz-live-empty", "Nothing on air. Press Start, or Present on any question below."));
            if (this.position().total) root.append(this.navControls());
            return;
        }
        const top = h("div", "qz-live-top");
        top.append(h("span", "quiz-live-badge", "ON AIR"), h("strong", "qz-live-prompt", live.question.prompt));
        const controls = h("div", "qz-live-controls");
        controls.append(
            this.button(live.optionsVisible ? "Hide options" : "Reveal options", () => this.toggleOptions(), false, live.optionsVisible ? "secondary" : "primary"),
            this.button(live.answerVisible ? "Hide answer" : "Reveal answer", () => this.toggleAnswer(), !live.optionsVisible),
            this.button("End question", () => this.endQuestion(), false, "danger")
        );
        const label = h("label", "qz-field");
        label.append(h("span", "", "Correct answer (live)"));
        const select = h("select", "input-field");
        this.optionList(live.question).forEach((text, index) => {
            const option = h("option", "", `${this.label(index)}: ${text}`); option.value = String(index); select.append(option);
        });
        select.value = String(live.question.correctIndex);
        select.disabled = !this.ready || this.busy;
        select.addEventListener("change", () => {
            const index = Number(select.value);
            this.liveChange((value) => { value.question.correctIndex = index; value.answerVisible = false; });
        });
        label.append(select);
        root.append(top, this.navControls(), controls, label);
    },

    /** Hides and empties every Host-only element (logout, leaving the room, failed PIN...). */
    clearAdmin() {
        const root = $z("quiz-admin"); root.textContent = ""; root.hidden = true;
        $z("quiz-host").textContent = ""; $z("quiz-host").hidden = true; this.editing = null;
        const tabBadge = $z("badge-quiz");
        if (tabBadge) { tabBadge.textContent = "0"; if (tabBadge.classList) tabBadge.classList.remove("is-live"); }
    },

    /** Builds the admin shell once, then refreshes the bank / live card on every sync. */
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
                  <div id="quiz-live-admin" class="qz-live-card"></div>
                  <div class="qz-bank-head"><h4>Question bank <span id="quiz-count" class="qz-count">0</span></h4>
                    <button type="button" id="quiz-new" class="btn btn-primary">+ New question</button></div>
                  <div id="quiz-bank" class="quiz-bank"></div>
                  <form id="quiz-form" class="quiz-form" hidden novalidate>
                    <h4 id="quiz-form-title">New question</h4>
                    <label class="qz-field"><span>Question</span>
                      <textarea id="quiz-prompt-input" class="input-field" maxlength="2000" required rows="3" placeholder="Type the question students will see\u2026"></textarea>
                      <small id="quiz-prompt-count" class="qz-counter">0 / 2000</small></label>
                    <fieldset><legend>Options \u00B7 tap a letter to mark the correct answer</legend><div id="quiz-option-fields"></div></fieldset>
                    <button type="button" id="quiz-add-option" class="btn btn-secondary">+ Add option</button>
                    <p id="quiz-form-error" class="form-error" role="alert"></p>
                    <div class="qz-form-actions"><button class="btn btn-primary" type="submit">Save question</button><button class="btn btn-ghost" type="button" id="quiz-cancel">Cancel</button></div>
                  </form>
                </div>`;
            $z("quiz-new").onclick = () => this.edit(null);
            $z("quiz-cancel").onclick = () => { this.editing = null; $z("quiz-form").hidden = true; };
            $z("quiz-add-option").onclick = () => this.optionField("");
            $z("quiz-form").onsubmit = (event) => { event.preventDefault(); this.saveForm(); };
            $z("quiz-prompt-input").addEventListener("input", () => {
                $z("quiz-prompt-count").textContent = `${$z("quiz-prompt-input").value.length} / 2000`;
            });
        }
        const bank = $z("quiz-bank"), h = this.h.bind(this); bank.textContent = "";
        const entries = this.sortedEntries(this.data.questions); // same order Previous / Next use
        $z("quiz-count").textContent = String(entries.length);
        // Tab badge in the Administrator Panel: bank size, with a live dot while a question is on air.
        const tabBadge = $z("badge-quiz");
        if (tabBadge) { tabBadge.textContent = String(entries.length); if (tabBadge.classList) tabBadge.classList.toggle("is-live", !!this.data.live?.question); }
        if (!entries.length) bank.append(h("p", "qz-empty", this.ready ? "No questions yet. Create the first one." : "Loading questions\u2026"));
        entries.forEach(([id, question], position) => {
            const onAir = this.data.live?.questionId === id;
            const row = h("article", `quiz-bank-row${onAir ? " is-live" : ""}`);
            const info = h("div", "qz-row-info");
            const meta = this.optionList(question);
            info.append(
                h("span", "qz-row-num", String(position + 1)),
                h("div", "qz-row-text")
            );
            info.lastChild.append(
                h("strong", "", question.prompt),
                h("small", "", `${meta.length} options \u00B7 correct: ${this.label(question.correctIndex)}${onAir ? " \u00B7 ON AIR" : ""}`)
            );
            const actions = h("div", "qz-row-actions");
            actions.append(
                this.button("Present", async () => {
                    const presented = await this.present(id);
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
        $z("quiz-form").querySelectorAll("input, textarea, button, fieldset").forEach((input) => { input.disabled = !this.ready || this.busy; });
        this.relabelOptions();
        this.renderHost(); this.renderAdminLive();
    },

    /** Opens the editor for a bank question (id) or a blank one (null). */
    edit(id) {
        if (!this.allowed() || !this.ready || this.busy) return;
        const q = id ? this.data.questions?.[id] : { prompt: "", options: ["", ""], correctIndex: -1 };
        if (!q) return;
        this.editing = id;
        const form = $z("quiz-form");
        form.hidden = false; $z("quiz-form-error").textContent = "";
        $z("quiz-form-title").textContent = id ? "Edit question" : "New question";
        $z("quiz-prompt-input").value = q.prompt;
        $z("quiz-prompt-count").textContent = `${q.prompt.length} / 2000`;
        $z("quiz-option-fields").textContent = "";
        Object.values(q.options).forEach((text, index) => this.optionField(text, index === q.correctIndex));
        $z("quiz-prompt-input").focus({ preventScroll: true });
        if (form.scrollIntoView) form.scrollIntoView({ block: "nearest", behavior: "smooth" });
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

    /** Validates the form and writes the question to the bank (create or update). */
    async saveForm() {
        if (!this.allowed() || !this.ready || this.busy) return;
        const rows = [...$z("quiz-option-fields").children];
        let question;
        try {
            question = this.question($z("quiz-prompt-input").value, rows.map((row) => row.dom.input.value), rows.findIndex((row) => row.dom.radio.checked));
        } catch (error) { $z("quiz-form-error").textContent = error.message; return; }
        const ref = this.ref, editing = this.editing, id = editing || ref.push().key;
        const saved = await this.write((data) => {
            if (editing && !data.questions?.[id]) return; // deleted elsewhere while editing
            data.questions = data.questions || {};
            const previous = data.questions[id];
            // New questions go to the end of the bank; edits keep their place (legacy records stay unordered).
            const saved = { ...question };
            if (!previous) saved.order = this.nextOrder(data.questions);
            else if (Number.isFinite(previous.order)) saved.order = previous.order;
            data.questions[id] = saved;
            return data;
        });
        if (saved && this.ref === ref) {
            this.editing = null; $z("quiz-form").hidden = true; Notify.success("Question saved.");
        }
    }
};
