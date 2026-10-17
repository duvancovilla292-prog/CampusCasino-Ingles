/* One catalog for navigation, room visibility and administrator controls. */
"use strict";
const GameCatalog = {
    categories: [
        { id: "casino", label: "Casino Games", games: ["blackjack", "baccarat", "pokerdice", "keno", "roulette", "slots", "hilo", "craps", "crash", "moneywheel", "blackwidow"] },
        { id: "tools", label: "Tools", games: ["draw", "wheel", "quiz"] },
        { id: "casual", label: "Casual & Party Games", games: ["uno", "parques", "dominoes", "chess", "checkers", "connect4", "battleship", "mastermind", "bullscows", "hangman", "arcade"] }
    ],
    label(key) {
        const item = document.querySelector(`#game-selector .nav-menu-item[data-game="${key}"]`);
        return item?.querySelector("span:nth-child(2)")?.textContent.trim() || key;
    },
    available(key, cfg) {
        if (key === "home") return true;   // the lobby home page is always reachable
        const category = this.categories.find((c) => c.games.includes(key));
        return !!category && !cfg.disabled?.[key] && !cfg.sectionsDisabled?.[category.id];
    },
    first(cfg) { return this.categories.flatMap((c) => c.games).find((key) => this.available(key, cfg)) || null; },
    apply(cfg) {
        document.querySelectorAll("#game-selector [data-game]").forEach((el) => {
            el.hidden = !this.available(el.dataset.game, cfg);
            if (el.hidden) el.removeAttribute("aria-current");
        });
        document.querySelectorAll("#game-selector [data-category]").forEach((el) => {
            const c = this.categories.find((c) => c.id === el.dataset.category);
            el.hidden = !c || !c.games.some((key) => this.available(key, cfg));
        });
        document.querySelectorAll(".nav-menu-chips").forEach((el) => { el.hidden = !this.available("draw", cfg); });
        const first = this.first(cfg);
        document.getElementById("games-empty").hidden = !!first;
        if (!this.available(Router.currentGameKey, cfg)) Router.selectGame(first);
        if (!first) {
            document.getElementById("nav-menu-current").textContent = "Games paused";
            document.getElementById("nav-menu-current-icon").textContent = "";
        }
    }
};
