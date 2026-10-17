/* =========================================================================
   CASINO CAMPUS — LOBBY HOME PAGE (#game-home)
   The landing page of the lobby: a carousel of highlights, the room's top
   winners, the Community Vault, featured games and the rewards.
   - Everything is wired to features that already exist: [data-go] buttons open a
     game through the games menu (NavMenu), [data-action] buttons open Missions,
     Lucky Spin, Shop or Bank through their own buttons.
   - Game tiles follow the games menu: a game the Host disables is hidden here too.
   - Live data comes from the room (players list) and the vault counter.
   Load order: after admin-panel.js (uses Router, Room, PubSub, GameCatalog, Missions).
   ========================================================================= */
"use strict";

const Home = (() => {
    const root = document.getElementById("game-home");
    if (!root) return null;
    const $ = (id) => document.getElementById(id);
    const navItem = (key) => document.querySelector(`#nav-menu-panel [data-game="${key}"]:not([data-draw-mode])`);
    const reducedMotion = () => !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

    /* ---------- opening games ---------- */
    /** Opens a game exactly as picking it in the games menu would (respects disabled games). */
    function go(key) {
        const item = navItem(key);
        if (!item || item.hidden) {
            if (typeof Notify !== "undefined") Notify.warning("That game is paused by the host right now.");
            return;
        }
        item.click();
        window.scrollTo({ top: 0, behavior: reducedMotion() ? "auto" : "smooth" });
    }

    root.addEventListener("click", (e) => {
        const b = e.target.closest("[data-go]");
        if (b && root.contains(b)) go(b.getAttribute("data-go"));
    });

    /** Tiles and slide buttons mirror the games menu: hidden there, hidden here. */
    function syncAvailability() {
        root.querySelectorAll("[data-go]").forEach((b) => {
            const item = navItem(b.getAttribute("data-go"));
            const off = !item || item.hidden;
            if (b.classList.contains("home-tile")) b.hidden = off;
            else b.disabled = off;
        });
        root.querySelectorAll(".home-cat").forEach((cat) => {
            cat.hidden = !cat.querySelector(".home-tile:not([hidden])");
        });
    }

    /* ---------- rewards (Missions / Lucky Spin / Shop / Bank) ---------- */
    const ACTIONS = {
        missions: () => $("btn-missions"),
        spin: () => $("btn-missions"),
        bank: () => $("btn-missions"),
        shop: () => $("btn-open-shop")
    };

    root.addEventListener("click", (e) => {
        const b = e.target.closest("[data-action]");
        if (!b) return;
        const act = b.getAttribute("data-action"), opener = ACTIONS[act] && ACTIONS[act]();
        if (!opener) return;
        opener.click();
        if (act === "spin" || act === "bank") {
            // the Rewards panel opens on its Missions tab; switch to the requested one
            window.setTimeout(() => {
                const tab = document.querySelector(`#px-missions [data-z="${act}"]`);
                if (tab) tab.click();
            }, 0);
        }
    });

    /** A reward card is hidden when its button is (e.g. the Host switched missions off). */
    function syncPromos() {
        root.querySelectorAll(".home-promo").forEach((card) => {
            const opener = ACTIONS[card.getAttribute("data-promo")] && ACTIONS[card.getAttribute("data-promo")]();
            card.hidden = !opener || opener.hidden;
        });
    }

    /* ---------- carousel ---------- */
    const slides = Array.from(root.querySelectorAll(".home-slide"));
    const dots = Array.from(root.querySelectorAll("[data-dot]"));
    const hero = root.querySelector(".home-hero");
    let index = 0, timer = 0, paused = false;
    const AUTO_MS = 7000;

    function show(i) {
        index = (i + slides.length) % slides.length;
        slides.forEach((s, k) => {
            const on = k === index;
            s.hidden = !on;
            s.classList.toggle("is-active", on);
        });
        dots.forEach((d, k) => {
            if (k === index) d.setAttribute("aria-current", "true");
            else d.removeAttribute("aria-current");
        });
    }

    function schedule() {
        window.clearTimeout(timer);
        if (paused || reducedMotion() || root.hidden) return;
        timer = window.setTimeout(() => { show(index + 1); schedule(); }, AUTO_MS);
    }

    root.querySelector(".home-prev").addEventListener("click", () => { show(index - 1); schedule(); });
    root.querySelector(".home-next").addEventListener("click", () => { show(index + 1); schedule(); });
    dots.forEach((d) => d.addEventListener("click", () => { show(Number(d.getAttribute("data-dot"))); schedule(); }));
    hero.addEventListener("keydown", (e) => {
        if (e.key === "ArrowLeft") { show(index - 1); schedule(); }
        else if (e.key === "ArrowRight") { show(index + 1); schedule(); }
    });
    // pause while the user is reading or interacting with the carousel
    const pause = (v) => { paused = v; schedule(); };
    hero.addEventListener("mouseenter", () => pause(true));
    hero.addEventListener("mouseleave", () => pause(false));
    hero.addEventListener("focusin", () => pause(true));
    hero.addEventListener("focusout", (e) => { if (!hero.contains(e.relatedTarget)) pause(false); });

    /* ---------- live room data ---------- */
    const fmtChips = (n) => Number(n || 0).toLocaleString("en-US");

    function renderWinners() {
        const list = $("home-winners");
        if (!list || typeof Room === "undefined") return;
        const top = Room.list()
            .filter((p) => p && p.username && p.stats && Number(p.stats.netProfit) > 0)
            .sort((a, b) => b.stats.netProfit - a.stats.netProfit)
            .slice(0, 3);
        list.replaceChildren();
        if (!top.length) {
            const li = document.createElement("li");
            li.className = "home-winners-empty";
            li.textContent = "Aún no hay ganadores. ¡Sé el primero!";
            list.appendChild(li);
            return;
        }
        top.forEach((p, i) => {
            const li = document.createElement("li");
            const medal = document.createElement("span");
            medal.className = "home-medal";
            medal.setAttribute("aria-hidden", "true");
            medal.textContent = ["\u{1F947}", "\u{1F948}", "\u{1F949}"][i];
            const name = document.createElement("span");
            name.className = "home-winner-name";
            name.textContent = p.username;
            const amount = document.createElement("b");
            amount.textContent = "+" + fmtChips(p.stats.netProfit);
            li.append(medal, name, amount);
            list.appendChild(li);
        });
    }

    /** Copies the vault counter of the top bar (kept up to date by the Jackpot module). */
    function renderVault() {
        const amount = Number(($("jp-amount") || {}).textContent ? $("jp-amount").textContent.replace(/[^\d]/g, "") : 0);
        const target = Number(($("jp-target") || {}).textContent ? $("jp-target").textContent.replace(/[^\d]/g, "") : 500) || 500;
        $("home-vault-amount").textContent = fmtChips(amount);
        $("home-vault-target").textContent = fmtChips(target);
        $("home-vault-fill").style.width = Math.min(100, (amount / target) * 100) + "%";
    }

    /* ---------- lifecycle ---------- */
    function onEnter() {
        syncAvailability();
        syncPromos();
        renderWinners();
        renderVault();
        schedule();
        // the games menu shows where you are (after NavMenu has synced on the same event)
        window.setTimeout(() => {
            const cur = $("nav-menu-current"), icon = $("nav-menu-current-icon");
            if (Router.currentGameKey !== "home") return;
            if (cur) cur.textContent = "Inicio";
            if (icon) icon.textContent = "\u{1F3E0}";
        }, 0);
    }

    document.addEventListener("game-changed", (e) => {
        if (e.detail && e.detail.gameKey === "home") onEnter();
        else window.clearTimeout(timer);
    });
    if (typeof PubSub !== "undefined") PubSub.on("players-updated", () => { if (!root.hidden) renderWinners(); });

    // games paused / resumed by the Host, missions switched on / off, vault counter changes
    const navPanel = $("nav-menu-panel");
    if (navPanel) new MutationObserver(syncAvailability).observe(navPanel, { subtree: true, attributes: true, attributeFilter: ["hidden"] });
    const tpPanel = $("tp-menu-panel");
    if (tpPanel) new MutationObserver(syncPromos).observe(tpPanel, { subtree: true, childList: true, attributes: true, attributeFilter: ["hidden"] });
    const jp = $("jp-amount");
    if (jp) new MutationObserver(renderVault).observe(jp, { childList: true, characterData: true, subtree: true });

    // "🏠 Inicio" in the ☰ menu
    const homeBtn = $("btn-home");
    if (homeBtn) homeBtn.addEventListener("click", () => { if (typeof Router !== "undefined") Router.selectGame("home"); });

    show(0);
    syncAvailability();
    syncPromos();

    return { go, show, onEnter };
})();
