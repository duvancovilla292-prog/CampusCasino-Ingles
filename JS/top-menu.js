/* =========================================================================
   CASINO CAMPUS — TOP BAR HAMBURGER MENU
   The room actions (Juegos, Leaderboard, Daily Missions, Host Settings, Admin,
   Shop, Leave) live inside #tp-menu-panel and open from the ☰ button.
   - "Juegos" is the games selector (#game-selector, driven by NavMenu in
     ui-audio.js). Inside the menu it unfolds in place, and each category
     (Casino Games, Tools, Casual & Party Games) is a sub-option that unfolds
     its own games.
   - Other modules keep inserting their buttons before #btn-open-admin-lobby, so
     they land in the panel without any change to their code.
   - Icon-only buttons get a visible text label inside the menu (from `title`).
   - The ☰ button shows the sum of the badges inside (e.g. claimable missions).
   - Disclosure pattern: aria-expanded on the toggle; closes on Escape, on a click
     outside, and after choosing an option. Works with mouse, touch and keyboard.
   Load order: after admin-panel.js (classic deferred script, no globals required).
   ========================================================================= */
"use strict";

const TopMenu = (() => {
    const toggle = document.getElementById("btn-tp-menu");
    const panel = document.getElementById("tp-menu-panel");
    if (!toggle || !panel) return null;

    const games = document.getElementById("game-selector");
    const gamesTrigger = document.getElementById("nav-menu-trigger");
    const gamesPanel = document.getElementById("nav-menu-panel");
    const visible = (el) => !el.hidden && !el.disabled && el.offsetParent !== null;
    /** Top-level options: "Juegos" plus the action buttons. */
    const items = () => [gamesTrigger, ...panel.querySelectorAll(":scope > button")].filter((b) => b && visible(b));
    const closeGames = () => { if (typeof NavMenu !== "undefined" && NavMenu.root) NavMenu.close(); };

    /* ---------- categories as sub-options ---------- */
    function buildCategories() {
        if (!gamesPanel) return;
        gamesPanel.querySelectorAll(".nav-menu-group").forEach((group, i) => {
            const h = group.querySelector(".nav-menu-heading");
            if (!h || h.querySelector(".nav-cat-toggle")) return;
            const id = group.id || (group.id = "nav-cat-group-" + i);
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "nav-cat-toggle";
            btn.setAttribute("aria-expanded", "false");
            btn.setAttribute("aria-controls", id);
            while (h.firstChild) btn.appendChild(h.firstChild);    // keeps the title and its <small> caption
            const chev = document.createElement("span");
            chev.className = "nav-cat-chevron";
            chev.setAttribute("aria-hidden", "true");
            chev.textContent = "\u203A";
            btn.appendChild(chev);
            h.appendChild(btn);
            group.classList.add("is-collapsed");
            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                const open = group.classList.toggle("is-collapsed") === false;
                btn.setAttribute("aria-expanded", open ? "true" : "false");
            });
        });
    }

    function collapseCategories() {
        if (!gamesPanel) return;
        gamesPanel.querySelectorAll(".nav-menu-group").forEach((g) => {
            g.classList.add("is-collapsed");
            const b = g.querySelector(".nav-cat-toggle");
            if (b) b.setAttribute("aria-expanded", "false");
        });
    }

    // Arrow keys inside "Juegos" move through the categories and the games that are showing
    // (handled here, before NavMenu, which only knows the flat list of games).
    if (gamesPanel) gamesPanel.addEventListener("keydown", (e) => {
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
        const list = Array.from(gamesPanel.querySelectorAll(".nav-cat-toggle, [data-game]")).filter(visible);
        if (!list.length) return;
        e.preventDefault();
        e.stopPropagation();
        const i = list.indexOf(document.activeElement);
        const n = e.key === "Home" ? 0 : e.key === "End" ? list.length - 1 : (i + (e.key === "ArrowDown" ? 1 : -1) + list.length) % list.length;
        list[n].focus();
    }, true);

    /** Adds a text label to icon-only buttons, using their title. */
    function label(btn) {
        if (btn.querySelector(".tp-menu-label")) return;
        const text = (btn.getAttribute("title") || "").trim();
        if (!text || /[A-Za-z]{3}/.test(btn.textContent)) return; // already has a readable label
        const span = document.createElement("span");
        span.className = "tp-menu-label";
        span.textContent = text;
        btn.appendChild(span);
    }

    /** Mirrors the badges of the hidden buttons on the ☰ toggle. */
    function syncBadge() {
        const n = Array.from(panel.querySelectorAll("[data-n]"))
            .filter((b) => !b.hidden)
            .reduce((sum, b) => sum + (parseInt(b.getAttribute("data-n"), 10) || 0), 0);
        if (n > 0) toggle.setAttribute("data-n", n > 99 ? "99+" : String(n));
        else toggle.removeAttribute("data-n");
        const verb = panel.hidden ? "Open menu" : "Close menu";
        toggle.setAttribute("aria-label", n > 0 ? `${verb} (${n} pending)` : verb);
    }

    function open(focusFirst) {
        panel.hidden = false;
        toggle.setAttribute("aria-expanded", "true");
        syncBadge();
        if (focusFirst) {
            const first = items()[0];
            if (first) first.focus();
        }
    }

    function close(returnFocus) {
        if (panel.hidden) return;
        closeGames();
        collapseCategories();
        panel.hidden = true;
        toggle.setAttribute("aria-expanded", "false");
        syncBadge();
        if (returnFocus) toggle.focus();
    }

    toggle.addEventListener("click", () => (panel.hidden ? open(false) : close(false)));

    // Keyboard: ArrowDown on the toggle opens the menu and focuses the first option.
    toggle.addEventListener("keydown", (e) => {
        if (e.key === "ArrowDown" && panel.hidden) {
            e.preventDefault();
            open(true);
        }
    });

    panel.addEventListener("keydown", (e) => {
        if (games && games.contains(e.target) && e.target !== gamesTrigger) return; // NavMenu / categories handle these
        if (e.target === gamesTrigger && e.key !== "Escape" && games.classList.contains("is-open")) return;
        const list = items(), i = list.indexOf(document.activeElement);
        if (e.key === "Escape") { e.preventDefault(); close(true); }
        else if (e.key === "ArrowDown") { e.preventDefault(); list[(i + 1) % list.length].focus(); }
        else if (e.key === "ArrowUp") { e.preventDefault(); list[(i - 1 + list.length) % list.length].focus(); }
        else if (e.key === "Home") { e.preventDefault(); list[0].focus(); }
        else if (e.key === "End") { e.preventDefault(); list[list.length - 1].focus(); }
    });

    // Choosing an option runs its own handler first (bubbling order), then the menu folds away.
    // "Juegos" and the categories only unfold; picking a game closes everything.
    panel.addEventListener("click", (e) => {
        const b = e.target.closest("button");
        if (!b || b === gamesTrigger || b.classList.contains("nav-cat-toggle")) return;
        close(!!b.closest("#game-selector"));
    });

    // Click or tap outside, or Escape anywhere, closes it.
    document.addEventListener("pointerdown", (e) => {
        if (!panel.hidden && !e.target.closest(".tp-menu")) close(false);
    });
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && !panel.hidden) close(true);
    });

    // Leaving the lobby (or the view being hidden) never leaves the menu open.
    const lobby = document.getElementById("view-lobby");
    if (lobby) new MutationObserver(() => { if (lobby.hidden) close(false); }).observe(lobby, { attributes: true, attributeFilter: ["hidden"] });

    // Buttons added later by other modules, and badge / visibility changes.
    new MutationObserver((records) => {
        records.forEach((r) => r.addedNodes.forEach((n) => { if (n.nodeType === 1 && n.matches("button") && n.parentNode === panel) label(n); }));
        syncBadge();
    }).observe(panel, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-n", "hidden"] });

    panel.querySelectorAll(":scope > button").forEach(label);
    buildCategories();
    syncBadge();

    return { open, close };
})();
