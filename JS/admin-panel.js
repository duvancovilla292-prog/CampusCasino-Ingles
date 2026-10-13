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
   20. ADMINISTRATOR PANEL (Host-only)
   ========================================================================= */
const Admin = {
    unlocked: false,

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
        PubSub.on("players-updated", () => {
            if (this.unlocked && !DOM.adminModal.hidden) this.renderTable();
        });
    },

    open() {
        // Defense in depth: even if the button were somehow revealed, only the
        // device that created this room may unlock the panel.
        if (!State.isHost) {
            Notify.error("Only this room's Host device can open the Administrator Panel.");
            return;
        }
        DOM.adminModal.hidden = false;
        DOM.inputAdminCode.value = "";
        DOM.adminLockError.textContent = "";
        if (this.unlocked) {
            DOM.adminLock.hidden = true;
            DOM.adminContent.hidden = false;
            this.renderTable();
        } else {
            DOM.adminLock.hidden = false;
            DOM.adminContent.hidden = true;
            DOM.inputAdminCode.focus();
        }
    },

    close() {
        DOM.adminModal.hidden = true;
    },

    tryUnlock() {
        if (DOM.inputAdminCode.value === CONFIG.ADMIN_CODE) {
            this.unlocked = true;
            DOM.adminLock.hidden = true;
            DOM.adminContent.hidden = false;
            this.renderTable();
        } else {
            DOM.adminLockError.textContent = "Incorrect PIN.";
        }
    },

    renderTable() {
        const players = Room.list().sort((a, b) => (b.balance || 0) - (a.balance || 0));
        let totalChips = 0;
        let totalRounds = 0;

        DOM.adminTableBody.innerHTML = "";

        players.forEach((player) => {
            totalChips += player.balance || 0;
            totalRounds += player.stats?.gamesPlayed || 0;

            const row = document.createElement("tr");

            const nameCell = document.createElement("td");
            nameCell.textContent = player.username;

            const balanceCell = document.createElement("td");
            balanceCell.textContent = (player.balance || 0).toLocaleString("en-US");

            const roundsCell = document.createElement("td");
            roundsCell.textContent = String(player.stats?.gamesPlayed || 0);

            const netCell = document.createElement("td");
            const net = player.stats?.netProfit || 0;
            netCell.textContent = `${net >= 0 ? "+" : ""}${net.toLocaleString("en-US")}`;
            netCell.classList.add(net >= 0 ? "net-positive" : "net-negative");

            const actionsCell = document.createElement("td");
            const resetBtn = document.createElement("button");
            resetBtn.type = "button";
            resetBtn.className = "btn btn-small btn-secondary";
            resetBtn.textContent = "Reset chips";
            resetBtn.addEventListener("click", () => this.resetPlayerBalance(player.username));

            const deleteBtn = document.createElement("button");
            deleteBtn.type = "button";
            deleteBtn.className = "btn btn-small btn-danger";
            deleteBtn.textContent = "Delete";
            deleteBtn.addEventListener("click", () => this.deletePlayer(player.username));

            actionsCell.append(resetBtn, deleteBtn);
            row.append(nameCell, balanceCell, roundsCell, netCell, actionsCell);
            DOM.adminTableBody.appendChild(row);
        });

        DOM.adminTotalPlayers.textContent = String(players.length);
        DOM.adminTotalChips.textContent = totalChips.toLocaleString("en-US");
        DOM.adminTotalRounds.textContent = String(totalRounds);
    },

    resetPlayerBalance(username) {
        const player = Room.get(username);
        if (!player) return;
        const amount = window.prompt(`New chip balance for "${username}":`, "1000");
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
        });
    },

    deletePlayer(username) {
        const confirmed = window.confirm(`Permanently delete "${username}"?`);
        if (!confirmed) return;
        Room.deletePlayer(username).then(() => {
            if (State.username === username) {
                handleLogout();
            }
            this.renderTable();
            Notify.warning(`Player "${username}" deleted.`);
        });
    },

    exportData() {
        const payload = {
            exportedAt: new Date().toISOString(),
            roomCode: State.roomCode,
            players: Room.playersCache
        };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `casino-campus-backup-${Date.now()}.json`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        Notify.success("Backup exported.");
    },

    importData(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = () => {
            try {
                const parsed = JSON.parse(String(reader.result));
                const incoming = parsed.players && typeof parsed.players === "object" ? parsed.players : parsed;
                if (!incoming || typeof incoming !== "object") throw new Error("Invalid format");

                Room.importPlayers(incoming).then(() => {
                    this.renderTable();
                    Notify.success("Backup imported successfully.");
                });
            } catch (err) {
                Notify.error("That file doesn't have a valid format.");
            }
        };
        reader.readAsText(file);
        event.target.value = "";
    },

    resetAll() {
        const confirmed = window.confirm("This will delete ALL players saved in this room. Continue?");
        if (!confirmed) return;
        Room.deleteAllPlayers().then(() => {
            this.renderTable();
            Notify.warning("All players were deleted.");
            handleLogout();
        });
    }
};

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
            const ns = names(), games = [...document.querySelectorAll(".nav-menu-item[data-game]")].map((b) => b.dataset.game).filter((g, i, a) => a.indexOf(g) === i);
            box.innerHTML = `
               <h3>Room</h3><div class="px-row"><span>Name</span><span><input type="text" id="pxa-name" value="${esc(cfg.roomName)}" maxlength="30" placeholder="Campus VIP Table"></span></div>
               <div class="px-row"><span>Daily bonus multiplier</span><span><input type="number" id="pxa-mult" min="0" max="10" step="0.5" value="${cfg.bonusMult}"></span></div>
               <div class="px-row"><span>Daily missions (master switch)</span><span></span><input type="checkbox" id="pxa-miss" ${cfg.missionsOn ? "checked" : ""}></div>
               <h3>Games</h3>${games.map((g) => `<div class="px-row"><span>${esc(g)}</span><span></span><input type="checkbox" data-game="${esc(g)}" ${cfg.disabled[g] ? "" : "checked"}></div>`).join("")}
               <h3>Secret winner (all random tools)</h3>
               <div class="px-row"><span>Enabled</span><span><select id="pxa-rt"><option value="">\u2014</option>${ns.map((n) => `<option ${n === Rig.target ? "selected" : ""}>${esc(n)}</option>`).join("")}</select></span><input type="checkbox" id="pxa-rig" ${Rig.on ? "checked" : ""}></div>
               <h3>Display names</h3>${ns.map((n) => `<div class="px-row"><span>${esc(n)}</span><span><input type="text" data-dn="${esc(n)}" value="${esc(cfg.names[n] || "")}" placeholder="${esc(n)}" maxlength="24"></span></div>`).join("")}
               <button type="button" class="btn btn-primary btn-block" id="pxa-save" style="margin-top:1rem">Save &amp; sync</button>`;
        };
        const saveRoom = () => {
            cfg.roomName = $("pxa-name").value.trim(); cfg.bonusMult = Math.max(0, +$("pxa-mult").value || 1); cfg.missionsOn = $("pxa-miss").checked;
            cfg.disabled = {}; document.querySelectorAll("#pxa-room [data-game]").forEach((c) => { if (!c.checked) cfg.disabled[c.dataset.game] = true; });
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
                if (!window.confirm(`Permanently delete "${it ? it.name : key}"?\nPlayers who own it will lose its look. Use Remove instead to keep their copies.`)) return;
                ref.update({ ["items/" + key]: null, ["hidden/" + key]: null }).then(() => Notify.success("Item deleted."));
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
        const doReset = () => {
            if (!Room.playersRef) return;
            const users = resetScope === "all" ? names() : [...resetSel].filter((u) => Room.exists(u));
            if (!users.length) { Notify.warning("Select at least one player."); return; }
            const id = $("mx-mission").value, m = id === "*" ? null : Q(id), d = day(), whole = id === "*" && $("mx-hist").checked;
            const who = resetScope === "all" ? `ALL ${users.length} players` : `${users.length} selected player${users.length > 1 ? "s" : ""}`;
            if (!window.confirm(`Reset ${m ? `"${m.text}"` : whole ? "ALL missions and history" : "ALL of today's missions"} for ${who}?`)) return;
            const upd = {};
            users.forEach((u) => {
                if (!m) upd[whole ? `${u}/quests` : `${u}/quests/${d}`] = null;
                else { upd[`${u}/quests/${d}/p/${m.id}`] = null; upd[`${u}/quests/${d}/c/${m.id}`] = null; if (m.metric === "streak") upd[`${u}/quests/${d}/s`] = null; }
            });
            Room.playersRef.update(upd).then(() => Notify.success(`Missions reset for ${who}.`)).catch(() => Notify.error("Reset failed."));
        };

        const adminRefresh = () => {
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

const resolve0 = GameResolver.resolve.bind(GameResolver);

GameResolver.resolve = function (id, r) {
    if (Rig.on && Rig.target && r && Array.isArray(r.winners) && r.winners.includes(Rig.target)) Audit.log("rig", `Chosen winner "${Rig.target}" used in ${GameResolver.label(id)}`);
    return resolve0(id, r);
};

/* ---------- Host Settings tabs: Limits | Bank | Audit ---------- */
const ZAdmin = {
    log: [], q: null, filter: "all",
    games() { return [...document.querySelectorAll(".nav-menu-item[data-game]")].map((b) => b.dataset.game).filter((g, i, a) => a.indexOf(g) === i && !["draw", "wheel", "tournament"].includes(g)); },
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
        const T = ["all", "bigwin", "rig", "mission", "loan", "spin", "limit", "tour", "bank", "achv"], rows = this.log.filter((r) => this.filter === "all" || r.type === this.filter).slice().reverse();
        box.innerHTML = `<h3>Room audit log</h3><div class="mx-tools"><select id="za-f">${T.map((t) => `<option ${t === this.filter ? "selected" : ""}>${t}</option>`).join("")}</select><button type="button" class="btn btn-ghost btn-small" id="za-clear">Clear log</button></div>
           <div class="z-log">${rows.map((r) => `<div class="z-lr t-${esc(r.type)}"><small>${new Date(r.ts || 0).toLocaleTimeString()}</small><b>${esc(r.type)}</b><span>${esc(r.u)}: ${esc(r.msg)}</span></div>`).join("") || '<p class="mx-hint">No events yet.</p>'}</div>`;
    },
    click(e) {
        const t = e.target;
        if (t.id === "zl-save") this.saveLimits(false); else if (t.id === "zl-reset") this.saveLimits(true); else if (t.id === "zb-save") this.saveBank();
        else if (t.dataset.ap) Bank.approve(t.dataset.ap); else if (t.dataset.dn) Bank.deny(t.dataset.dn);
        else if (t.id === "za-clear" && window.confirm("Clear the whole audit log?")) zref("audit").remove();
    }
};

window.__zAdmin = () => { const a = $z("px-adm"); if (!a.dataset.z) { a.dataset.z = 1; a.addEventListener("click", (e) => ZAdmin.click(e)); a.addEventListener("change", (e) => { if (e.target.id === "za-f") { ZAdmin.filter = e.target.value; ZAdmin.audit(); } }); } ZAdmin.render(); };

const soc0 = { start: Social.start.bind(Social), stop: Social.stop.bind(Social) };

Social.start = function () { soc0.start(); Z.start(); };

Social.stop = function () { soc0.stop(); Z.stop(); };

/* =========================================================================
   APP BOOTSTRAP — must register LAST (this is the last script of the page).
   DOMContentLoaded listeners run in registration order, exactly as in the original build:
   first the VIP widgets (daily-spin tabs, quick dice, tournaments), then init() from ui-audio.js.
   ========================================================================= */
document.addEventListener("DOMContentLoaded", () => { Rewards.init(); Dice.init(); Tour.init(); });

document.addEventListener("DOMContentLoaded", init);
