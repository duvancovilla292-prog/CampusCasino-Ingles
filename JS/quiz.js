/* Shared classroom quiz. Classic script, loaded before admin-panel.js.
 * UI permissions follow AdminCtl; server enforcement requires Firebase Auth/rules.
 * Bank edits never change the published snapshot until Presentar is pressed.
 */
"use strict";
const Quiz = {
    ref: null, listener: null, data: {}, ready: false, busy: false, editing: null,
    allowed() { return State.isHost === true && Admin.unlocked === true; },
    label(index) {
        let value = index + 1, label = "";
        while (value > 0) { value--; label = String.fromCharCode(65 + value % 26) + label; value = Math.floor(value / 26); }
        return label;
    },
    question(prompt, options, correctIndex) {
        prompt = String(prompt || "").trim();
        options = options.map((text) => String(text).trim());
        if (!prompt || prompt.length > 2000) throw new Error("Escribe un enunciado de hasta 2000 caracteres.");
        if (options.length < 2 || options.some((text) => !text || text.length > 500)) {
            throw new Error("Agrega al menos dos opciones, con 1 a 500 caracteres cada una.");
        }
        if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= options.length) {
            throw new Error("Selecciona la respuesta correcta.");
        }
        return { prompt, options, correctIndex };
    },
    init() {
        $z("quiz-fullscreen").addEventListener("click", async () => {
            try {
                if (document.fullscreenElement) await document.exitFullscreen();
                else await $z("game-quiz").requestFullscreen();
            } catch (_) { Notify.error("Este navegador no permite pantalla completa."); }
        });
        document.addEventListener("fullscreenchange", () => {
            $z("quiz-fullscreen").textContent = document.fullscreenElement ? "Salir de pantalla completa" : "Pantalla completa";
        });
        document.addEventListener("game-changed", () => {
            if (Router.currentGameKey !== "quiz" && document.fullscreenElement === $z("game-quiz")) {
                document.exitFullscreen().catch(() => {});
            }
        });
    },
    start() {
        this.stop();
        if (!Room.db || !Room.code) return;
        this.ref = Room.db.ref(`rooms/${Room.code}/quiz`);
        const ref = this.ref;
        this.listener = (snapshot) => {
            if (this.ref !== ref) return;
            this.data = snapshot.val() || {};
            this.ready = true;
            $z("quiz-connection").textContent = "En vivo · compartido con esta sala";
            this.render(); this.syncAdmin();
        };
        ref.on("value", this.listener, () => {
            if (this.ref !== ref) return;
            this.ready = false;
            $z("quiz-connection").textContent = "No se pudo leer el quiz. Revisa los permisos y vuelve a entrar a la sala.";
            this.render(); this.syncAdmin();
        });
    },
    stop() {
        if (this.ref && this.listener) this.ref.off("value", this.listener);
        this.ref = this.listener = null;
        this.data = {}; this.ready = false; this.busy = false;
        this.clearAdmin(); this.render();
        $z("quiz-connection").textContent = "Conectando el quiz…";
        if (document.fullscreenElement === $z("game-quiz")) document.exitFullscreen().catch(() => {});
    },
    async write(change) {
        if (!this.allowed() || !this.ref || !this.ready || this.busy) return false;
        const ref = this.ref;
        this.busy = true; this.renderHost(); this.syncAdmin();
        try {
            // Transactions serialize bank and presentation changes, including deletion.
            const result = await ref.transaction((data) => change(data || {}), undefined, false);
            if (this.ref !== ref) return false;
            if (!result.committed) throw new Error("La pregunta cambió. Revisa el estado actual e inténtalo de nuevo.");
            return true;
        } catch (error) {
            if (this.ref === ref) Notify.error(error.message || "No se pudo guardar el quiz.");
            return false;
        } finally {
            if (this.ref === ref) { this.busy = false; this.render(); this.syncAdmin(); }
        }
    },
    async present(id) {
        const token = this.ref?.push().key;
        return this.write((data) => {
            const question = data.questions?.[id];
            if (!question) return;
            data.live = { id: token, questionId: id, question, optionsVisible: false, answerVisible: false };
            return data;
        });
    },
    async liveChange(change) {
        const token = this.data.live?.id;
        if (!token) return;
        await this.write((data) => {
            if (data.live?.id !== token) return;
            change(data.live); return data;
        });
    },
    render() {
        const stage = $z("quiz-stage"), live = this.data.live;
        stage.textContent = "";
        const el = (tag, text, cls) => { const node = document.createElement(tag); node.textContent = text; if (cls) node.className = cls; return node; };
        if (!live?.question) {
            stage.append(el("p", "La próxima pregunta está por llegar", "quiz-waiting"), el("p", "El administrador prepara las preguntas. Abre esta herramienta en cada dispositivo para seguir la presentación."));
        } else {
            const q = live.question;
            stage.append(el("p", live.optionsVisible ? "ELIGE TU RESPUESTA" : "PREGUNTA AL AIRE", "quiz-eyebrow"), el("h3", q.prompt, "quiz-prompt"));
            if (!live.optionsVisible) {
                stage.append(el("p", "Piensa tu respuesta y compártela en voz alta. Las opciones se revelarán en un momento.", "quiz-hidden-message"));
            } else {
                const list = el("ol", "", "quiz-options");
                Object.values(q.options || {}).forEach((text, index) => {
                    const correct = live.answerVisible && index === q.correctIndex;
                    const item = el("li", "", `quiz-option${correct ? " is-correct" : ""}`);
                    item.append(el("span", this.label(index), "quiz-letter"), el("span", text));
                    if (correct) item.append(el("strong", "✓ Correcta", "quiz-correct"));
                    list.append(item);
                });
                stage.append(list);
            }
        }
        this.renderHost();
    },
    button(text, action, disabled = false) {
        const button = document.createElement("button");
        button.type = "button"; button.className = "btn btn-secondary"; button.textContent = text;
        button.disabled = disabled || !this.ready || this.busy;
        button.addEventListener("click", action); return button;
    },
    renderHost() {
        const root = $z("quiz-host"); root.textContent = ""; root.hidden = !this.allowed();
        if (!this.allowed()) return;
        root.append(this.button("Administrar preguntas", () => Admin.open()));
        const live = this.data.live;
        if (!live?.question) return;
        const toggle = this.button(live.optionsVisible ? "Ocultar respuestas" : "Mostrar respuestas", () => this.liveChange((value) => {
            value.optionsVisible = !value.optionsVisible;
            if (!value.optionsVisible) value.answerVisible = false;
        }));
        toggle.setAttribute("aria-pressed", String(live.optionsVisible)); root.append(toggle);
        root.append(this.button(live.answerVisible ? "Ocultar correcta" : "Revelar correcta", () => this.liveChange((value) => { value.answerVisible = !value.answerVisible; }), !live.optionsVisible));
        root.append(this.button("Terminar pregunta", () => this.write((data) => {
            if (data.live?.id !== live.id) return;
            delete data.live; return data;
        })));
    },
    renderAdminLive() {
        const root = $z("quiz-live-admin"); root.textContent = "";
        const live = this.data.live;
        if (!live?.question) return;
        const label = document.createElement("label"); label.textContent = "Respuesta correcta: ";
        const select = document.createElement("select"); select.className = "input-field";
        Object.values(live.question.options || {}).forEach((text, index) => {
            const option = document.createElement("option"); option.value = index; option.textContent = `${this.label(index)}: ${text}`; select.append(option);
        });
        select.value = live.question.correctIndex;
        select.disabled = !this.ready || this.busy;
        select.addEventListener("change", () => {
            const index = Number(select.value);
            this.liveChange((value) => { value.question.correctIndex = index; value.answerVisible = false; });
        });
        label.append(select); root.append(label);
    },
    clearAdmin() {
        const root = $z("quiz-admin"); root.textContent = ""; root.hidden = true;
        $z("quiz-host").textContent = ""; $z("quiz-host").hidden = true; this.editing = null;
    },
    syncAdmin() {
        if (!this.allowed()) { this.clearAdmin(); return; }
        const root = $z("quiz-admin"); root.hidden = false;
        if (!root.firstChild) {
            root.innerHTML = `<h3>Quiz / Preguntas Interactivas</h3>
                <p class="form-help">Edita el banco y pulsa Presentar. Cada pregunta comienza con sus opciones ocultas. Editar el banco no cambia la pregunta al aire.</p>
                <div id="quiz-live-admin" class="quiz-host"></div>
                <div id="quiz-bank" class="quiz-bank"></div>
                <button type="button" id="quiz-new" class="btn btn-secondary">Nueva pregunta</button>
                <form id="quiz-form" class="quiz-form" hidden>
                  <label>Enunciado<textarea id="quiz-prompt-input" class="input-field" maxlength="2000" required rows="3"></textarea></label>
                  <fieldset><legend>Opciones · marca la correcta</legend><div id="quiz-option-fields"></div></fieldset>
                  <button type="button" id="quiz-add-option" class="btn btn-secondary">Agregar opción</button>
                  <p id="quiz-form-error" class="form-error" role="alert"></p>
                  <div class="quiz-toolbar"><button class="btn btn-primary" type="submit">Guardar pregunta</button><button class="btn btn-ghost" type="button" id="quiz-cancel">Cancelar</button></div>
                </form>`;
            $z("quiz-new").onclick = () => this.edit(null);
            $z("quiz-cancel").onclick = () => { this.editing = null; $z("quiz-form").hidden = true; };
            $z("quiz-add-option").onclick = () => this.optionField("");
            $z("quiz-form").onsubmit = (event) => { event.preventDefault(); this.saveForm(); };
        }
        const bank = $z("quiz-bank"); bank.textContent = "";
        const entries = Object.entries(this.data.questions || {});
        if (!entries.length) bank.textContent = this.ready ? "Aún no hay preguntas. Crea la primera." : "Cargando preguntas…";
        entries.forEach(([id, question]) => {
            const row = document.createElement("div"); row.className = "quiz-bank-row";
            const title = document.createElement("strong"); title.textContent = question.prompt;
            row.append(title, this.button("Editar", () => this.edit(id)), this.button("Presentar", async () => {
                const presented = await this.present(id);
                if (presented && this.ref && this.data.live?.questionId === id && GameCatalog.available("quiz", Missions.cfg)) { Admin.close(); Router.selectGame("quiz"); }
            }), this.button("Eliminar", async () => {
                if (!window.confirm("¿Eliminar esta pregunta? Si está al aire, también se retirará de la pantalla.")) return;
                const removed = await this.write((data) => {
                    if (!data.questions?.[id]) return;
                    delete data.questions[id];
                    if (data.live?.questionId === id) delete data.live;
                    return data;
                });
                if (removed && this.editing === id) { this.editing = null; $z("quiz-form").hidden = true; }
            })); bank.append(row);
        });
        $z("quiz-new").disabled = !this.ready || this.busy;
        $z("quiz-form").querySelectorAll("input, textarea, button, fieldset").forEach((input) => { input.disabled = !this.ready || this.busy; });
        this.relabelOptions();
        this.renderHost(); this.renderAdminLive();
    },
    edit(id) {
        if (!this.allowed() || !this.ready || this.busy) return;
        const q = id ? this.data.questions?.[id] : { prompt: "", options: ["", ""], correctIndex: 0 };
        if (!q) return;
        this.editing = id;
        $z("quiz-form").hidden = false; $z("quiz-form-error").textContent = "";
        $z("quiz-prompt-input").value = q.prompt; $z("quiz-option-fields").textContent = "";
        Object.values(q.options).forEach((text, index) => this.optionField(text, index === q.correctIndex));
        $z("quiz-prompt-input").focus();
    },
    optionField(text, checked = false) {
        const root = $z("quiz-option-fields"), row = document.createElement("div"); row.className = "quiz-option-field";
        const radio = document.createElement("input"); radio.type = "radio"; radio.name = "quiz-correct"; radio.checked = checked;
        const input = document.createElement("input"); input.type = "text"; input.className = "input-field"; input.maxLength = 500; input.required = true; input.value = text;
        const remove = document.createElement("button"); remove.type = "button"; remove.className = "btn btn-ghost"; remove.textContent = "Quitar";
        remove.onclick = () => { row.remove(); this.relabelOptions(); };
        row.append(radio, input, remove); root.append(row); this.relabelOptions();
    },
    relabelOptions() {
        const rows = [...$z("quiz-option-fields").children];
        rows.forEach((row, index) => {
            const label = this.label(index);
            row.children[0].setAttribute("aria-label", `Opción ${label} correcta`);
            row.children[1].setAttribute("aria-label", `Texto de la opción ${label}`);
            row.children[1].placeholder = `Opción ${label}`;
            row.children[2].setAttribute("aria-label", `Quitar opción ${label}`);
            row.children[2].disabled = this.busy || !this.ready || rows.length <= 2;
        });
    },
    async saveForm() {
        if (!this.allowed() || !this.ready || this.busy) return;
        const rows = [...$z("quiz-option-fields").children];
        let question;
        try {
            question = this.question($z("quiz-prompt-input").value, rows.map((row) => row.children[1].value), rows.findIndex((row) => row.children[0].checked));
        } catch (error) { $z("quiz-form-error").textContent = error.message; return; }
        const ref = this.ref, editing = this.editing, id = editing || ref.push().key;
        const saved = await this.write((data) => {
            if (editing && !data.questions?.[id]) return;
            data.questions = data.questions || {}; data.questions[id] = question; return data;
        });
        if (saved && this.ref === ref) {
            this.editing = null; $z("quiz-form").hidden = true; Notify.success("Pregunta guardada.");
        }
    }
};
