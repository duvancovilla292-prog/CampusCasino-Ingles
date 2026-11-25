/* CASINO CAMPUS — knockout tournaments.
   Classic <script> (not an ES module): top-level consts are shared with the other files
   through the page's global scope, so the load order in index.html matters. */
"use strict";

/* ---------- Knockout tournaments (host builds + reports; everyone watches live) ---------- */
const Tour = {
    d: null, pick: new Set(), game: "uno", prize: 0,
    GAMES: [["uno", "UNO"], ["parques", "Colombian Ludo"], ["dominoes", "Dominoes"], ["chess", "Chess"], ["checkers", "Chinese Checkers"], ["mastermind", "Color Code Breaker"], ["bullscows", "Picas y Fijas"], ["dice", "Quick Dice"]],
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
