/* =========================================================================
   CASINO CAMPUS — UI, AUDIO, SHOP, MISSIONS & NAVIGATION
   DOM cache, Web Audio synthesised sound, win celebration effects, toasts, HUD, input validation,
   SPA router, setup / auth / leaderboard screens, cosmetics & Shop v2, room chat, community
   jackpot, Social start/stop chain, navigation menu, init(), daily missions engine + room cfg
   sync, achievements and the daily Lucky Spin / rewards.
   Load order: 2 of 5 — needs firebase-sync.js.
   Classic <script> (not an ES module): top-level const / function declarations are shared
   between the five files through the page's global lexical scope, so the cross-module
   references of the original single-closure build keep working unchanged.
   ========================================================================= */
"use strict";

/* Shared formatting / DOM helpers (used by every module). */
const fmt = (n) => Number(n || 0).toLocaleString("en-US");
const $z = (id) => document.getElementById(id);

/* =========================================================================
   5. DOM CACHE
   ========================================================================= */
const DOM = {
    // Views
    viewSetup: document.getElementById("view-setup"),
    viewAuth: document.getElementById("view-auth"),
    viewLobby: document.getElementById("view-lobby"),

    // Setup / room connection
    hostError: document.getElementById("host-error"),
    btnCreateRoom: document.getElementById("btn-create-room"),
    hostRoomResult: document.getElementById("host-room-result"),
    createdRoomCode: document.getElementById("created-room-code"),
    hostLinkRow: document.getElementById("host-link-row"),
    hostShareLink: document.getElementById("host-share-link"),
    btnCopyLink: document.getElementById("btn-copy-link"),
    btnHostContinue: document.getElementById("btn-host-continue"),
    inputRoomCode: document.getElementById("input-room-code"),
    joinError: document.getElementById("join-error"),
    btnJoinRoom: document.getElementById("btn-join-room"),
    connectionDot: document.getElementById("connection-dot"),
    connectionStatusText: document.getElementById("connection-status-text"),

    // Auth / player selection
    authRoomCode: document.getElementById("auth-room-code"),
    authRoomCodeFooter: document.getElementById("auth-room-code-footer"),
    authHostBadge: document.getElementById("auth-host-badge"),
    playersGrid: document.getElementById("players-grid"),
    playersEmpty: document.getElementById("players-empty"),
    playersCount: document.getElementById("players-count"),
    inputPlayerSearch: document.getElementById("input-player-search"),
    btnLeaveRoom: document.getElementById("btn-leave-room"),

    // Login form (new player)
    loginForm: document.getElementById("login-form"),
    inputUsername: document.getElementById("input-username"),
    selectStartingChips: document.getElementById("select-starting-chips"),
    loginError: document.getElementById("login-error"),

    // HUD / top panel
    displayRoomCode: document.getElementById("display-room-code"),
    displayAvatar: document.getElementById("display-avatar"),
    displayUsername: document.getElementById("display-username"),
    displayBalance: document.getElementById("display-balance"),
    lobbyHostBadge: document.getElementById("lobby-host-badge"),
    gameSelector: document.getElementById("game-selector"),
    btnLogout: document.getElementById("btn-logout"),
    btnSoundToggle: document.getElementById("btn-sound-toggle"),

    // Notifications & effects
    notificationList: document.getElementById("notification-list"),
    celebrationOverlay: document.getElementById("celebration-overlay"),

    // Leaderboard
    btnOpenLeaderboard: document.getElementById("btn-open-leaderboard"),
    btnOpenLeaderboardAuth: document.getElementById("btn-open-leaderboard-auth"),
    leaderboardModal: document.getElementById("leaderboard-modal"),
    btnLeaderboardClose: document.getElementById("btn-leaderboard-close"),
    leaderboardList: document.getElementById("leaderboard-list"),

    // Admin panel
    btnOpenAdmin: document.getElementById("btn-open-admin"),
    btnOpenAdminLobby: document.getElementById("btn-open-admin-lobby"),
    adminModal: document.getElementById("admin-modal"),
    btnAdminClose: document.getElementById("btn-admin-close"),
    adminLock: document.getElementById("admin-lock"),
    adminContent: document.getElementById("admin-content"),
    inputAdminCode: document.getElementById("input-admin-code"),
    adminLockError: document.getElementById("admin-lock-error"),
    btnAdminUnlock: document.getElementById("btn-admin-unlock"),
    adminTotalPlayers: document.getElementById("admin-total-players"),
    adminTotalChips: document.getElementById("admin-total-chips"),
    adminTotalRounds: document.getElementById("admin-total-rounds"),
    adminTableBody: document.getElementById("admin-table-body"),
    btnAdminExport: document.getElementById("btn-admin-export"),
    inputAdminImport: document.getElementById("input-admin-import"),
    btnAdminResetAll: document.getElementById("btn-admin-reset-all"),

    // Game sections
    gameSections: document.querySelectorAll(".game-section"),

    // Blackjack
    dealerCards: document.getElementById("dealer-cards"),
    dealerScore: document.getElementById("dealer-score"),
    inputBlackjackBet: document.getElementById("input-blackjack-bet"),
    btnBlackjackHit: document.getElementById("btn-blackjack-hit"),
    btnBlackjackStand: document.getElementById("btn-blackjack-stand"),
    blackjackResult: document.getElementById("blackjack-result"),

    // Roulette
    rouletteWheel: document.getElementById("roulette-wheel"),
    rouletteNumbers: document.getElementById("roulette-numbers"),
    chipPanel: document.getElementById("chip-panel"),
    inputRouletteBet: document.getElementById("input-roulette-bet"),
    btnRouletteSpin: document.getElementById("btn-roulette-spin"),
    btnRouletteClear: document.getElementById("btn-roulette-clear"),
    rouletteResult: document.getElementById("roulette-result"),

    // Player Wheel
    wheelContainer: document.getElementById("wheel-container"),
    wheelDial: document.getElementById("wheel-dial"),
    wheelLabels: document.getElementById("wheel-labels"),
    wheelPointer: document.getElementById("wheel-pointer"),
    wheelEmptyState: document.getElementById("wheel-empty-state"),
    btnWheelSpin: document.getElementById("btn-wheel-spin"),
    btnWheelRestart: document.getElementById("btn-wheel-restart"),
    wheelPoolCount: document.getElementById("wheel-pool-count"),
    wheelPoolList: document.getElementById("wheel-pool-list"),
    wheelResult: document.getElementById("wheel-result"),
    wheelWinnerModal: document.getElementById("wheel-winner-modal"),
    wheelWinnerName: document.getElementById("wheel-winner-name"),
    btnWheelRemove: document.getElementById("btn-wheel-remove"),
    btnWheelKeep: document.getElementById("btn-wheel-keep"),
    wheelResumeModal: document.getElementById("wheel-resume-modal"),
    wheelResumeSubtitle: document.getElementById("wheel-resume-subtitle"),
    btnWheelResumeRestart: document.getElementById("btn-wheel-resume-restart"),
    btnWheelResumeContinue: document.getElementById("btn-wheel-resume-continue"),

    // Slots
    reels: [
        document.getElementById("reel-1"),
        document.getElementById("reel-2"),
        document.getElementById("reel-3")
    ],
    inputSlotsBet: document.getElementById("input-slots-bet"),
    btnSlotsSpin: document.getElementById("btn-slots-spin"),
    btnSlotsLever: document.getElementById("btn-slots-lever"),
    slotsResult: document.getElementById("slots-result"),

    // Hi-Lo
    hiloCurrentCard: document.getElementById("hilo-current-card"),
    hiloNextCard: document.getElementById("hilo-next-card"),
    inputHiloBet: document.getElementById("input-hilo-bet"),
    btnHiloHigher: document.getElementById("btn-hilo-higher"),
    btnHiloLower: document.getElementById("btn-hilo-lower"),
    hiloResult: document.getElementById("hilo-result")
};

/* =========================================================================
   6. SOUND (Web Audio beeps, no external files)
   ========================================================================= */
const Sound = {
    ctx: null,
    enabled: true,

    init() {
        const settings = DeviceStore.loadSettings();
        this.enabled = settings.soundEnabled !== false;
        this.updateToggleUI();
    },

    ensureContext() {
        if (!this.ctx) {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (AudioCtx) this.ctx = new AudioCtx();
        }
        return this.ctx;
    },

    tone(freq, durationMs, type = "sine", volume = 0.08) {
        if (!this.enabled) return;
        const ctx = this.ensureContext();
        if (!ctx) return;
        const oscillator = ctx.createOscillator();
        const gain = ctx.createGain();
        oscillator.type = type;
        oscillator.frequency.value = freq;
        gain.gain.value = volume;
        oscillator.connect(gain);
        gain.connect(ctx.destination);
        oscillator.start();
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + durationMs / 1000);
        oscillator.stop(ctx.currentTime + durationMs / 1000);
    },

    win() { this.tone(660, 120); window.setTimeout(() => this.tone(880, 160), 110); },
    lose() { this.tone(180, 220, "sawtooth", 0.06); },
    click() { this.tone(440, 60, "square", 0.04); },
    jackpot() {
        [523, 659, 784, 1046].forEach((freq, i) => {
            window.setTimeout(() => this.tone(freq, 180), i * 110);
        });
    },

    toggle() {
        this.enabled = !this.enabled;
        DeviceStore.saveSettings({ soundEnabled: this.enabled });
        this.updateToggleUI();
    },

    updateToggleUI() {
        DOM.btnSoundToggle.textContent = this.enabled ? "\u{1F50A}" : "\u{1F507}";
        DOM.btnSoundToggle.setAttribute("aria-pressed", String(this.enabled));
    }
};

/* =========================================================================
   7. EFFECTS (celebration overlay for big wins)
   ========================================================================= */
const Effects = {
    celebrate(message) {
        Sound.jackpot();
        const banner = document.createElement("div");
        banner.className = "celebration-banner";
        banner.textContent = message;
        DOM.celebrationOverlay.appendChild(banner);
        DOM.celebrationOverlay.classList.add("is-active");

        window.setTimeout(() => {
            banner.classList.add("celebration-banner-exit");
            banner.addEventListener("animationend", () => {
                banner.remove();
                if (!DOM.celebrationOverlay.children.length) {
                    DOM.celebrationOverlay.classList.remove("is-active");
                }
            }, { once: true });
        }, 1400);
    },

    pulseBalance() {
        DOM.displayBalance.classList.remove("balance-pulse");
        // Force reflow so the animation restarts on consecutive clicks.
        void DOM.displayBalance.offsetWidth;
        DOM.displayBalance.classList.add("balance-pulse");
    }
};

/* =========================================================================
   8. NOTIFICATION SYSTEM (floating toasts)
   ========================================================================= */
const Notify = {
    TYPES: { SUCCESS: "toast-success", ERROR: "toast-error", WARNING: "toast-warning" },
    AUTO_DISMISS_MS: 3500,

    show(message, type = Notify.TYPES.WARNING) {
        const item = document.createElement("li");
        item.className = `toast ${type}`;
        item.textContent = message;
        DOM.notificationList.appendChild(item);

        window.setTimeout(() => {
            item.classList.add("toast-exit");
            item.addEventListener("animationend", () => item.remove(), { once: true });
        }, Notify.AUTO_DISMISS_MS);
    },

    success(message) { this.show(message, this.TYPES.SUCCESS); },
    error(message) { this.show(message, this.TYPES.ERROR); },
    warning(message) { this.show(message, this.TYPES.WARNING); }
};

/* =========================================================================
   9. HUD (user / balance, synced across the whole app)
   ========================================================================= */
const HUD = {
    update() {
        DOM.displayUsername.textContent = State.username || "--";
        DOM.displayBalance.textContent = State.balance.toLocaleString("en-US");
        DOM.displayRoomCode.textContent = State.roomCode || "------";
        DOM.lobbyHostBadge.hidden = !State.isHost;
        Cosmetics.applyHud();
        Effects.pulseBalance();
    }
};

/* =========================================================================
   10. INPUT SANITIZATION / VALIDATION HELPERS
   ========================================================================= */
const Validate = {
    sanitizeUsername(rawValue) {
        return String(rawValue).trim().replace(/[^A-Za-z0-9_-]/g, "");
    },

    isValidUsername(value) {
        return /^[A-Za-z0-9_-]{3,16}$/.test(value);
    },

    parseBet(inputEl) {
        const rawValue = String(inputEl.value).trim();
        const amount = Number.parseInt(rawValue, 10);

        if (rawValue === "" || Number.isNaN(amount)) {
            Notify.error("Enter a valid numeric bet.");
            return null;
        }
        if (amount <= 0) {
            Notify.error("The bet must be greater than zero.");
            return null;
        }
        if (!BetLimits.ok(Router.currentGameKey, amount)) return null;
        if (!State.canAfford(amount)) {
            Notify.error("You don't have enough chips for that bet.");
            return null;
        }
        return amount;
    }
};

/* =========================================================================
   11. VIEW / ROUTER CONTROLLER (SPA navigation)
   ========================================================================= */
const Router = {
    showSetup() {
        DOM.viewLobby.hidden = true;
        DOM.viewAuth.hidden = true;
        DOM.viewSetup.hidden = false;
    },

    showAuth() {
        DOM.viewSetup.hidden = true;
        DOM.viewLobby.hidden = true;
        DOM.viewAuth.hidden = false;
        DOM.authRoomCode.textContent = State.roomCode || "------";
        DOM.authRoomCodeFooter.textContent = State.roomCode || "------";
        DOM.authHostBadge.hidden = !State.isHost;
        DOM.btnOpenAdmin.hidden = !State.isHost;
        AuthScreen.render();
    },

    showLobby() {
        DOM.viewSetup.hidden = true;
        DOM.viewAuth.hidden = true;
        DOM.viewLobby.hidden = false;
        DOM.btnOpenAdminLobby.hidden = !State.isHost;
        HUD.update();
        Social.start();
        this.selectGame("blackjack");
    },

    currentGameKey: null,

    selectGame(gameKey) {
        const previousKey = this.currentGameKey;

        DOM.gameSections.forEach((section) => {
            section.hidden = section.dataset.gameSection !== gameKey;
        });

        DOM.gameSelector.querySelectorAll(".btn-game-select").forEach((btn) => {
            btn.setAttribute("aria-pressed", String(btn.dataset.game === gameKey));
        });

        this.currentGameKey = gameKey;
        document.dispatchEvent(new CustomEvent("game-changed", { detail: { gameKey } }));

        // Entering the Player Wheel section (from a different section, or for
        // the first time) is when we decide whether to auto-populate the pool
        // or ask the player whether to resume their previous pool.
        if (gameKey === "wheel" && previousKey !== "wheel") {
            PlayerWheel.onEnter();
        }

        if (previousKey === "draw" && gameKey !== "draw") LuckyDraw.reset();
        if (gameKey === "draw" && previousKey !== "draw") LuckyDraw.onEnter();
    }
};

/* =========================================================================
   17. SETUP SCREEN (Create room / Join by code)
   ========================================================================= */
const SetupScreen = {
    init() {
        ConnectionStatus.init(DOM.connectionDot, DOM.connectionStatusText);

        DOM.btnCreateRoom.addEventListener("click", () => this.handleCreateRoom());
        DOM.btnHostContinue.addEventListener("click", () => Router.showAuth());
        DOM.btnCopyLink.addEventListener("click", () => this.copyLink());
        DOM.btnJoinRoom.addEventListener("click", () => this.handleJoinRoom());
        DOM.inputRoomCode.addEventListener("keydown", (event) => {
            if (event.key === "Enter") this.handleJoinRoom();
        });
        DOM.inputRoomCode.addEventListener("input", () => {
            DOM.inputRoomCode.value = DOM.inputRoomCode.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
        });

        this.ensureConnected();

        const { room } = LinkUtils.readParams();
        if (room) {
            DOM.inputRoomCode.value = room;
            DOM.inputRoomCode.focus();
        }
    },

    /** Connects to the hardcoded Firebase project (once). */
    ensureConnected() {
        if (Room.isConfigured()) return true;
        try {
            Room.connect(CONFIG.FIREBASE_CONFIG);
            return true;
        } catch (err) {
            console.error(err);
            return false;
        }
    },

    async handleCreateRoom() {
        DOM.hostError.textContent = "";
        if (!this.ensureConnected()) {
            DOM.hostError.textContent = "Could not reach Firebase. Check your internet connection and reload.";
            return;
        }

        DOM.btnCreateRoom.disabled = true;
        DOM.btnCreateRoom.textContent = "Creating\u2026";

        try {
            const code = await Room.createRoom();
            State.roomCode = code;
            State.isHost = true;

            DOM.createdRoomCode.textContent = code;
            DOM.hostRoomResult.hidden = false;
            DOM.hostShareLink.value = LinkUtils.buildShareLink(code);
            DOM.hostLinkRow.hidden = false;
            DOM.btnHostContinue.hidden = false;
            Notify.success(`Room ${code} created. You are the Host.`);
        } catch (err) {
            console.error(err);
            DOM.hostError.textContent = err.message || "Could not create the room. Please try again.";
        } finally {
            DOM.btnCreateRoom.disabled = false;
            DOM.btnCreateRoom.textContent = "Create Room";
        }
    },

    copyLink() {
        DOM.hostShareLink.select();
        try {
            navigator.clipboard?.writeText(DOM.hostShareLink.value);
            Notify.success("Link copied to clipboard.");
        } catch (err) {
            document.execCommand("copy");
        }
    },

    async handleJoinRoom() {
        DOM.joinError.textContent = "";
        const code = String(DOM.inputRoomCode.value || "").trim().toUpperCase();
        if (!code) {
            DOM.joinError.textContent = "Enter a room code.";
            return;
        }
        if (!this.ensureConnected()) {
            DOM.joinError.textContent = "Could not reach Firebase. Check your internet connection and reload.";
            return;
        }

        DOM.btnJoinRoom.disabled = true;
        DOM.btnJoinRoom.textContent = "Joining\u2026";

        try {
            const meta = await Room.joinRoom(code);
            State.roomCode = Room.code;
            State.isHost = meta.hostDeviceId === DeviceStore.getDeviceId();
            Notify.success(`Connected to room ${Room.code}.`);
            Router.showAuth();
        } catch (err) {
            console.error(err);
            DOM.joinError.textContent = err.message || "Could not join that room.";
        } finally {
            DOM.btnJoinRoom.disabled = false;
            DOM.btnJoinRoom.textContent = "Join Room";
        }
    }
};

/* =========================================================================
   18. AUTH SCREEN (player selection / creation inside a room)
   ========================================================================= */
const AuthScreen = {
    searchTerm: "",
    searchRaf: 0,

    /** Lowercase + strip accents so "andres" matches "Andrés", "penaloza" matches "PEÑALOZA". */
    normalize(value) {
        return String(value == null ? "" : value)
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
            .trim();
    },

    init() {
        DOM.loginForm.addEventListener("submit", (event) => this.handleCreatePlayer(event));
        const onSearch = () => {
            this.searchTerm = this.normalize(DOM.inputPlayerSearch.value);
            // Coalesce rapid keystrokes into one paint-aligned update.
            if (this.searchRaf) cancelAnimationFrame(this.searchRaf);
            this.searchRaf = requestAnimationFrame(() => {
                this.searchRaf = 0;
                this.applyFilter();
            });
        };
        DOM.inputPlayerSearch.addEventListener("input", onSearch);
        DOM.inputPlayerSearch.addEventListener("search", onSearch); // native "x" clear button
        DOM.btnLeaveRoom.addEventListener("click", () => this.leaveRoom());
        PubSub.on("players-updated", () => {
            if (!DOM.viewAuth.hidden) this.render();
        });
    },

    /** Rebuilds the roster from room data, then applies the current search term. */
    render() {
        const allPlayers = Room.list()
            .filter((p) => p && p.username)
            .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

        DOM.playersCount.textContent = String(allPlayers.length);
        DOM.playersGrid.textContent = "";
        const frag = document.createDocumentFragment();
        allPlayers.forEach((player) => {
            const card = this.buildPlayerCard(player);
            card.dataset.search = this.normalize(player.username);
            frag.appendChild(card);
        });
        DOM.playersGrid.appendChild(frag);

        // Re-sync the term from the input (it may have been typed before the list loaded).
        this.searchTerm = this.normalize(DOM.inputPlayerSearch.value);
        this.applyFilter(allPlayers.length);
    },

    /** Toggles card visibility only (no DOM rebuild) so typing stays instant. */
    applyFilter(total) {
        const cards = DOM.playersGrid.children;
        const count = typeof total === "number" ? total : cards.length;
        const term = this.searchTerm;
        let visible = 0;
        for (let i = 0; i < cards.length; i += 1) {
            const match = !term || (cards[i].dataset.search || "").includes(term);
            cards[i].hidden = !match;
            if (match) visible += 1;
        }
        DOM.playersEmpty.hidden = visible > 0;
        DOM.playersEmpty.textContent = (count > 0 && visible === 0)
            ? "No players match your search."
            : "No players have joined this room yet. Create the first profile on the right \u2192";
    },

    buildPlayerCard(player) {
        const card = document.createElement("article");
        card.className = "player-card";
        card.setAttribute("role", "listitem");

        const avatar = document.createElement("span");
        avatar.className = "player-avatar";
        avatar.textContent = player.username.slice(0, 2).toUpperCase();

        const info = document.createElement("div");
        info.className = "player-info";
        const nameEl = document.createElement("span");
        nameEl.className = "player-name";
        nameEl.textContent = player.username; ZT(nameEl, player);
        const balanceEl = document.createElement("span");
        balanceEl.className = "player-balance";
        balanceEl.textContent = `${(player.balance || 0).toLocaleString("en-US")} chips`;
        info.append(nameEl, balanceEl);

        const actions = document.createElement("div");
        actions.className = "player-actions";

        const continueBtn = document.createElement("button");
        continueBtn.type = "button";
        continueBtn.className = "btn btn-small btn-primary";
        continueBtn.textContent = "Enter";
        continueBtn.addEventListener("click", () => this.loginAs(player.username));

        actions.append(continueBtn);
        card.append(avatar, info, actions);
        return card;
    },

    loginAs(username) {
        const player = Room.get(username);
        if (!player) {
            Notify.error("That player no longer exists in this room.");
            this.render();
            return;
        }
        State.username = player.username;
        State.balance = player.balance || 0;
        HUD.update();
        Router.showLobby();
        Notify.success(`Welcome back, ${player.username}.`);
    },

    handleCreatePlayer(event) {
        event.preventDefault();

        const cleanUsername = Validate.sanitizeUsername(DOM.inputUsername.value);

        if (!Validate.isValidUsername(cleanUsername)) {
            DOM.loginError.textContent = "Username must be 3-16 letters, numbers, hyphens or underscores.";
            return;
        }

        if (Room.exists(cleanUsername)) {
            DOM.loginError.textContent = "A player with that name already exists in this room. Pick another, or enter from the list.";
            return;
        }

        DOM.loginError.textContent = "";
        const startingChips = Number.parseInt(DOM.selectStartingChips.value, 10);
        const submitBtn = DOM.loginForm.querySelector("#btn-login-submit");
        submitBtn.disabled = true;

        Room.createPlayer(cleanUsername, startingChips)
            .then((result) => {
                submitBtn.disabled = false;
                if (!result.committed) {
                    DOM.loginError.textContent = "That username was just taken by someone else. Try another.";
                    return;
                }
                State.username = cleanUsername;
                State.balance = startingChips;
                HUD.update();

                DOM.loginForm.reset();
                Router.showLobby();
                Notify.success(`Welcome to Casino Campus, ${cleanUsername}!`);
            })
            .catch((err) => {
                submitBtn.disabled = false;
                console.error(err);
                DOM.loginError.textContent = "Could not create the player. Check your connection and try again.";
            });
    },

    leaveRoom() {
        Room.disconnect();
        State.reset();
        State.roomCode = "";
        State.isHost = false;
        Admin.unlocked = false;
        Router.showSetup();
    }
};

/* =========================================================================
   19. LEADERBOARD
   ========================================================================= */
const Leaderboard = {
    init() {
        DOM.btnOpenLeaderboard.addEventListener("click", () => this.open());
        DOM.btnOpenLeaderboardAuth.addEventListener("click", () => this.open());
        DOM.btnLeaderboardClose.addEventListener("click", () => this.close());
        DOM.leaderboardModal.addEventListener("click", (event) => {
            if (event.target === DOM.leaderboardModal) this.close();
        });
        PubSub.on("players-updated", () => {
            if (!DOM.leaderboardModal.hidden) this.renderList();
        });
    },

    open() {
        this.renderList();
        DOM.leaderboardModal.hidden = false;
    },

    renderList() {
        const ranked = Room.list()
            .sort((a, b) => (b.balance || 0) - (a.balance || 0))
            .slice(0, CONFIG.LEADERBOARD_LIMIT);

        DOM.leaderboardList.innerHTML = "";

        if (ranked.length === 0) {
            const empty = document.createElement("li");
            empty.className = "leaderboard-empty";
            empty.textContent = "No players registered yet.";
            DOM.leaderboardList.appendChild(empty);
        } else {
            ranked.forEach((player, index) => {
                const item = document.createElement("li");
                item.className = "leaderboard-item";
                if (player.username === State.username) item.classList.add("is-current-player");

                const rank = document.createElement("span");
                rank.className = "leaderboard-rank";
                rank.textContent = ["\u{1F947}", "\u{1F948}", "\u{1F949}"][index] || `#${index + 1}`;

                const name = document.createElement("span");
                name.className = "leaderboard-name";
                name.textContent = player.username; ZT(name, player);

                const balance = document.createElement("span");
                balance.className = "leaderboard-balance";
                balance.textContent = `${(player.balance || 0).toLocaleString("en-US")} chips`;

                item.append(rank, name, balance);
                DOM.leaderboardList.appendChild(item);
            });
        }
    },

    close() {
        DOM.leaderboardModal.hidden = true;
    }
};

/* =========================================================================
   21. LOGIN / LOGOUT FLOW
   ========================================================================= */
function handleLogout() {
    Social.stop();
    State.reset();
    HUD.update();
    Router.showAuth();
}

/* =========================================================================
   22. APP BOOTSTRAP
   ========================================================================= */
/* =========================================================================
   21c. SHOP v2, ROOM CHAT + REACTIONS, COMMUNITY JACKPOT VAULT
   Everything lives under rooms/{code}/... in the same hardcoded Firebase DB:
     shop/items/{slot:id}   host-added items (incl. sanitized raw SVG)
     shop/hidden/{slot:id}  items the host removed from sale (kept for owners)
     players/{u}/cosmetics  owned + equipped items (atomic purchases)
   ========================================================================= */
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const $id = (id) => document.getElementById(id);

/* ---------- Raw-SVG sanitizer (admin SVG is synced to every client) ----------
   Defense in depth: (1) parse as XML and keep only a whitelist of graphic elements,
   (2) strip event handlers / external references, (3) always render through <img src="data:...">,
   which browsers sandbox (no scripts, no network) even if something slipped through. */
const Svg = (() => {
    const OK = new Set(("svg g defs path circle ellipse rect line polyline polygon text tspan lineargradient radialgradient stop clippath mask pattern use title desc symbol " +
        "filter fegaussianblur fecolormatrix feoffset femerge femergenode feflood fecomposite animate animatetransform").split(" "));
    const BAD = /javascript:|vbscript:|data:|expression\s*\(|@import|<script/i;
    const MAX_LEN = 12000, MAX_NODES = 400, cache = new Map();

    function scrub(node) {
        Array.from(node.childNodes).forEach((ch) => {
            if (ch.nodeType === 8) { node.removeChild(ch); return; }          // comments
            if (ch.nodeType !== 1) return;                                     // text stays
            const name = ch.localName.toLowerCase();
            if (!OK.has(name)) { node.removeChild(ch); return; }
            if (name === "animate" && /href/i.test(ch.getAttribute("attributeName") || "")) { node.removeChild(ch); return; }
            Array.from(ch.attributes).forEach((a) => {
                const n = a.name.toLowerCase(), v = a.value;
                if (n.startsWith("on") || BAD.test(v) || !/^[a-z_:][-\w:.]*$/i.test(a.name)) { ch.removeAttribute(a.name); return; }
                if ((n === "href" || n === "xlink:href") && !v.trim().startsWith("#")) { ch.removeAttribute(a.name); return; }
                if (/url\(\s*['"]?\s*(?!#)/i.test(v)) ch.removeAttribute(a.name);
            });
            scrub(ch);
        });
    }

    function run(raw) {
        let src = raw.replace(/<\?xml[^>]*\?>/gi, "").replace(/<!DOCTYPE[^>]*>/gi, "").replace(/<!--[\s\S]*?-->/g, "").trim();
        if (!/^<svg[\s>]/i.test(src)) return null;
        if (!/<svg[^>]*\sxmlns\s*=/i.test(src)) src = src.replace(/^<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
        if (/xlink:/i.test(src) && !/xmlns:xlink/i.test(src)) src = src.replace(/^<svg/i, '<svg xmlns:xlink="http://www.w3.org/1999/xlink"');
        const doc = new DOMParser().parseFromString(src, "image/svg+xml");
        const root = doc.documentElement;
        if (!root || root.localName !== "svg" || doc.getElementsByTagName("parsererror").length) return null;
        scrub(root);
        Array.from(root.attributes).forEach((a) => { if (a.name.toLowerCase() === "width" || a.name.toLowerCase() === "height" || a.name.toLowerCase() === "style") root.removeAttribute(a.name); });
        if (!root.getAttribute("viewBox")) root.setAttribute("viewBox", "0 0 100 100");
        if (root.getElementsByTagName("*").length > MAX_NODES) return null;
        return new XMLSerializer().serializeToString(root);
    }

    return {
        MAX_LEN,
        /** Returns a sanitized SVG string, or null when the input is not acceptable SVG. */
        clean(raw) {
            raw = String(raw || "").trim();
            if (!raw || raw.length > MAX_LEN) return null;
            if (cache.has(raw)) return cache.get(raw);
            let out = null;
            try { out = run(raw); } catch (e) { out = null; }
            if (cache.size > 300) cache.clear();
            cache.set(raw, out);
            return out;
        },
        url(clean) { return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(clean); }
    };
})();

/* ---------- Catalog definitions ---------- */
const SLOTS = ["avatar", "frame", "border", "badge", "title"];

const SLOT_LABEL = { avatar: "Avatars", frame: "Custom Frames", border: "Glow Borders", badge: "Chat Badges", title: "Titles" };

const SLOT_ONE = { avatar: "Avatar", frame: "Frame", border: "Border", badge: "Badge", title: "Title" };

const RARITY = { common: "Common", rare: "Rare", epic: "Epic", legendary: "Legendary" };

const rarityOf = (p) => (p >= 1000 ? "legendary" : p >= 600 ? "epic" : p >= 300 ? "rare" : "common");

const GOLD_DEFS = '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff3b0"/><stop offset=".5" stop-color="#f4c430"/><stop offset="1" stop-color="#9a6b08"/></linearGradient></defs>';

const SV = (inner) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${inner}</svg>`;

const ring = (n, fn) => Array.from({ length: n }, (_, i) => fn(i)).join("");

const star = (pts, ro, ri) => Array.from({ length: pts * 2 }, (_, i) => { const a = (Math.PI * i) / pts - Math.PI / 2, r = i % 2 ? ri : ro; return `${(50 + r * Math.cos(a)).toFixed(1)},${(50 + r * Math.sin(a)).toFixed(1)}`; }).join(" ");

const SVG_LIB = {
    chip: SV(`<defs><radialGradient id="g" cx=".4" cy=".35" r=".7"><stop offset="0" stop-color="#ffe9a0"/><stop offset=".55" stop-color="#e9c46a"/><stop offset="1" stop-color="#8a5d06"/></radialGradient></defs><circle cx="50" cy="50" r="48" fill="url(#g)"/><circle cx="50" cy="50" r="38" fill="none" stroke="#fff6cf" stroke-width="3.5" stroke-dasharray="9 7"/><circle cx="50" cy="50" r="27" fill="#14171c"/><text x="50" y="61" text-anchor="middle" font-size="32" font-family="Georgia,serif" font-weight="700" fill="#f4c430">$</text>`),
    ace: SV(`${GOLD_DEFS}<circle cx="50" cy="50" r="48" fill="#0b0d11" stroke="url(#g)" stroke-width="3"/><path d="M50 18C50 18 22 42 22 58C22 68 31 73 39 70C42 69 44 67 45 65C44 72 42 78 36 82L64 82C58 78 56 72 55 65C56 67 58 69 61 70C69 73 78 68 78 58C78 42 50 18 50 18Z" fill="url(#g)"/>`),
    gem: SV(`<defs><linearGradient id="a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d9b3ff"/><stop offset="1" stop-color="#5b2bb8"/></linearGradient></defs><circle cx="50" cy="50" r="48" fill="#120d1f"/><polygon points="50,16 80,40 50,86 20,40" fill="url(#a)" stroke="#f4c430" stroke-width="2.5"/><polyline points="20,40 80,40 50,16 36,40 50,86 64,40 50,16" fill="none" stroke="#fff3b0" stroke-width="1.6" stroke-opacity=".8"/>`),
    seven: SV(`<defs><radialGradient id="r" cx=".4" cy=".3" r=".8"><stop offset="0" stop-color="#ff6a5e"/><stop offset="1" stop-color="#7d1410"/></radialGradient></defs><circle cx="50" cy="50" r="48" fill="url(#r)" stroke="#f4c430" stroke-width="3"/><text x="50" y="70" text-anchor="middle" font-size="62" font-family="Georgia,serif" font-weight="900" fill="#ffe9a0" stroke="#7d1410" stroke-width="1.5">7</text>`),
    seal: SV(`${GOLD_DEFS}<polygon points="${star(14, 48, 40)}" fill="url(#g)"/><circle cx="50" cy="50" r="30" fill="#14171c"/><text x="50" y="58" text-anchor="middle" font-size="22" font-family="Georgia,serif" font-weight="800" fill="#f4c430">VIP</text>`),
    deco: SV(`${GOLD_DEFS}<circle cx="50" cy="50" r="41" fill="none" stroke="url(#g)" stroke-width="4"/><circle cx="50" cy="50" r="46.5" fill="none" stroke="url(#g)" stroke-width="1.2"/><g fill="url(#g)">${ring(8, (i) => `<path d="M50 0L54.5 5L50 10L45.5 5Z" transform="rotate(${i * 45} 50 50)"/>`)}</g>`),
    laurel: SV(`<defs><linearGradient id="l" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#9be58f"/><stop offset="1" stop-color="#2b8a4b"/></linearGradient></defs><g fill="url(#l)">${ring(8, (i) => { const a = 200 + i * 17; return `<ellipse cx="50" cy="7" rx="3.4" ry="8" transform="rotate(${a} 50 50) rotate(32 50 7)"/><ellipse cx="50" cy="7" rx="3.4" ry="8" transform="rotate(${360 - a} 50 50) rotate(-32 50 7)"/>`; })}</g><circle cx="50" cy="50" r="38" fill="none" stroke="#f4c430" stroke-width="1.4" stroke-opacity=".8"/>`),
    neon: SV(`<defs><filter id="b" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="2.4"/></filter></defs><g><circle cx="50" cy="50" r="42" fill="none" stroke="#22ffd0" stroke-width="5" filter="url(#b)"/><circle cx="50" cy="50" r="42" fill="none" stroke="#c9fff2" stroke-width="1.8"/><circle cx="50" cy="50" r="46.5" fill="none" stroke="#ff3df2" stroke-width="1.6"/><animate attributeName="opacity" values="1;.55;1" dur="2.2s" repeatCount="indefinite"/></g>`),
    crown: SV(`${GOLD_DEFS}<circle cx="50" cy="56" r="39" fill="none" stroke="url(#g)" stroke-width="4.5"/><path d="M28 24L33 6L42 17L50 2L58 17L67 6L72 24Z" fill="url(#g)" stroke="#8a5d06" stroke-width="1"/><circle cx="33" cy="6" r="2.2" fill="#e0483e"/><circle cx="50" cy="2.5" r="2.2" fill="#4aa3ff"/><circle cx="67" cy="6" r="2.2" fill="#2ecc8f"/>`),
    sunburst: SV(`${GOLD_DEFS}<g><g fill="url(#g)">${ring(24, (i) => `<path d="M50 1L52.4 12L47.6 12Z" transform="rotate(${i * 15} 50 50)"/>`)}</g><animateTransform attributeName="transform" type="rotate" from="0 50 50" to="360 50 50" dur="24s" repeatCount="indefinite"/></g><circle cx="50" cy="50" r="38" fill="none" stroke="url(#g)" stroke-width="2.4"/>`),
    chain: SV(`${GOLD_DEFS}<circle cx="50" cy="50" r="42" fill="none" stroke="url(#g)" stroke-width="5.5" stroke-dasharray="7 3.5"/><circle cx="50" cy="50" r="37" fill="none" stroke="#f4c430" stroke-width="1" stroke-opacity=".7"/>`)
};

const BUILTIN = [];

const B = (slot, id, name, price, icon, x) => BUILTIN.push(Object.assign({ slot, id, name, price, icon: icon || "", rarity: rarityOf(price), builtin: true }, x || {}));

/* Avatars */
B("avatar", "cat", "Alley Cat", 250, "\u{1F431}"); B("avatar", "fox", "Fox", 300, "\u{1F98A}"); B("avatar", "owl", "Night Owl", 300, "\u{1F989}");

B("avatar", "panda", "Panda", 350, "\u{1F43C}"); B("avatar", "ghost", "Ghost", 400, "\u{1F47B}"); B("avatar", "robot", "Robot", 450, "\u{1F916}");

B("avatar", "wolf", "Lone Wolf", 500, "\u{1F43A}"); B("avatar", "ninja", "Ninja", 550, "\u{1F977}"); B("avatar", "dragon", "Dragon", 600, "\u{1F409}");

B("avatar", "alien", "Visitor", 650, "\u{1F47D}"); B("avatar", "tiger", "Tiger", 650, "\u{1F42F}"); B("avatar", "lion", "Lion", 700, "\u{1F981}");

B("avatar", "wizard", "Wizard", 750, "\u{1F9D9}"); B("avatar", "unicorn", "Unicorn", 800, "\u{1F984}"); B("avatar", "shark", "Card Shark", 850, "\u{1F988}");

B("avatar", "astro", "Astronaut", 900, "\u{1F9D1}\u200D\u{1F680}"); B("avatar", "chip", "Gold Chip", 900, "\u{1F4B0}", { svg: SVG_LIB.chip });

B("avatar", "seven", "Lucky Seven", 1000, "7", { svg: SVG_LIB.seven }); B("avatar", "crown", "Crown", 1000, "\u{1F451}");

B("avatar", "ace", "Obsidian Ace", 1100, "\u2660", { svg: SVG_LIB.ace }); B("avatar", "gem", "Royal Gem", 1400, "\u{1F48E}", { svg: SVG_LIB.gem });

/* Frames (SVG overlays) */
B("frame", "chain", "Gold Chain", 400, "\u26D3", { svg: SVG_LIB.chain }); B("frame", "deco", "Art Deco Gold", 500, "\u{1F3DB}", { svg: SVG_LIB.deco });

B("frame", "laurel", "Laurel Wreath", 700, "\u{1F33F}", { svg: SVG_LIB.laurel }); B("frame", "neon", "Neon Pulse", 800, "\u{1F4A0}", { svg: SVG_LIB.neon });

B("frame", "crownf", "Royal Crown", 1200, "\u{1F451}", { svg: SVG_LIB.crown }); B("frame", "sunburst", "Sunburst", 1500, "\u2600", { svg: SVG_LIB.sunburst });

/* Borders */
B("border", "gold", "Gold Border", 250, "\u{1F7E1}", { css: "bd-gold", color: "#f4c430" }); B("border", "emerald", "Emerald Border", 400, "\u{1F7E2}", { css: "bd-emerald", color: "#2ecc8f" });

B("border", "sapphire", "Sapphire Border", 450, "\u{1F535}", { color: "#3b82f6" }); B("border", "ruby", "Ruby Border", 500, "\u{1F534}", { css: "bd-ruby", color: "#e0483e" });

B("border", "amethyst", "Amethyst Border", 550, "\u{1F7E3}", { color: "#a855f7" }); B("border", "platinum", "Platinum Border", 650, "\u26AA", { color: "#dfe6ee" });

B("border", "mint", "Neon Mint Border", 700, "\u{1F4A0}", { color: "#22ffd0" }); B("border", "aurora", "Aurora Border", 1000, "\u{1F308}", { css: "bd-aurora", color: "#7a6bff" });

/* Badges */
B("badge", "cherry", "Cherry", 150, "\u{1F352}"); B("badge", "dice", "Lucky Dice", 180, "\u{1F3B2}"); B("badge", "roller", "High Roller", 200, "\u2660\uFE0F");

B("badge", "heart", "Heart", 220, "\u2764\uFE0F"); B("badge", "lucky", "Lucky", 350, "\u{1F340}"); B("badge", "fire", "On Fire", 400, "\u{1F525}");

B("badge", "star", "Star", 450, "\u2B50"); B("badge", "skull", "Bad Beat", 480, "\u{1F480}"); B("badge", "bolt", "Lightning", 500, "\u26A1");

B("badge", "rocket", "To the Moon", 600, "\u{1F680}"); B("badge", "money", "Money Bag", 650, "\u{1F4B0}"); B("badge", "diamond", "Diamond", 700, "\u{1F48E}");

B("badge", "trophy", "Trophy", 900, "\u{1F3C6}"); B("badge", "seal", "VIP Seal", 1100, "\u2605", { svg: SVG_LIB.seal });

/* Titles */
B("title", "rookie", "Rookie", 100, "\u{1F331}", { color: "#9be58f" }); B("title", "gambler", "The Gambler", 150, "\u{1F3B0}"); B("title", "shark", "Card Shark", 350, "\u{1F988}", { color: "#7be0ff" });

B("title", "charm", "Lucky Charm", 400, "\u{1F340}", { color: "#2ecc8f" }); B("title", "pokerface", "Poker Face", 450, "\u{1F610}"); B("title", "nemesis", "Dealer's Nemesis", 600, "\u2694\uFE0F", { color: "#ff8c84" });

B("title", "hunter", "Jackpot Hunter", 700, "\u{1F3AF}", { color: "#f4c430" }); B("title", "whale", "The Whale", 800, "\u{1F40B}", { color: "#4aa3ff" });

B("title", "baron", "Chip Baron", 1100, "\u{1F3A9}", { color: "#e9c46a" }); B("title", "legend", "Campus Legend", 1500, "\u{1F451}", { color: "#f4c430" });

const Catalog = {
    raw: {}, hidden: {}, map: new Map(), ref: null, cb: null,
    key: (slot, id) => slot + ":" + id,
    /** Validates a host-written item (anyone could write to the DB, so nothing is trusted). */
    norm(v) {
        if (!v || typeof v !== "object") return null;
        const slot = String(v.slot || ""), id = String(v.id || ""), name = String(v.name || "").trim().slice(0, 32);
        if (!SLOTS.includes(slot) || !/^[a-z0-9_-]{1,40}$/.test(id) || !name) return null;
        const price = Math.max(0, Math.min(1000000, Math.round(Number(v.price) || 0)));
        const it = { slot, id, name, price, icon: String(v.icon || "").slice(0, 8), rarity: RARITY[v.rarity] ? v.rarity : rarityOf(price), custom: true };
        if (v.svg) { const s = Svg.clean(v.svg); if (s) it.svg = s; }
        if (/^#[0-9a-f]{6}$/i.test(String(v.color || ""))) it.color = v.color;
        if (slot === "frame" && !it.svg) return null;
        if (slot !== "frame" && slot !== "border" && !it.svg && !it.icon && slot !== "title") return null;
        return it;
    },
    rebuild() {
        const m = new Map();
        BUILTIN.forEach((i) => m.set(this.key(i.slot, i.id), i));
        Object.keys(this.raw).forEach((k) => { const it = this.norm(this.raw[k]); if (it) m.set(this.key(it.slot, it.id), it); });
        this.map = m;
    },
    find(slot, id) { return (slot && id && this.map.get(this.key(slot, id))) || null; },
    byKey(k) { return this.map.get(k) || null; },
    isListed(slot, id) { return !!this.find(slot, id) && !this.hidden[this.key(slot, id)]; },
    listed(slot) { return [...this.map.values()].filter((i) => (!slot || i.slot === slot) && !this.hidden[this.key(i.slot, i.id)]).sort((a, b) => a.price - b.price || a.name.localeCompare(b.name)); },
    all() { return [...this.map.values()].sort((a, b) => SLOTS.indexOf(a.slot) - SLOTS.indexOf(b.slot) || a.price - b.price); },
    start() {
        this.stop();
        if (!Room.db || !Room.code) return;
        this.ref = Room.db.ref(`rooms/${Room.code}/shop`);
        this.cb = (s) => { const v = s.val() || {}; this.raw = v.items || {}; this.hidden = v.hidden || {}; this.rebuild(); PubSub.emit("shop-updated"); };
        this.ref.on("value", this.cb);
    },
    stop() {
        if (this.ref && this.cb) this.ref.off("value", this.cb);
        this.ref = this.cb = null; this.raw = {}; this.hidden = {}; this.rebuild();
    }
};

Catalog.rebuild();

/* ---------- FX: confetti canvas, glowing reward popup, modal close transition ---------- */
const Fx = (() => {
    const reduced = () => !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    const COLORS = ["#f4c430", "#e9c46a", "#fff3b0", "#2ecc8f", "#e0483e", "#7be0ff", "#ffffff", "#b46bff"];
    let canvas = null, ctx = null, parts = [], raf = 0, last = 0, dpr = 1;

    const size = () => { if (!canvas) return; dpr = Math.min(2, window.devicePixelRatio || 1); canvas.width = Math.floor(innerWidth * dpr); canvas.height = Math.floor(innerHeight * dpr); };
    const ensure = () => {
        if (canvas) return;
        canvas = document.createElement("canvas"); canvas.id = "cx-confetti"; canvas.setAttribute("aria-hidden", "true");
        document.body.appendChild(canvas); ctx = canvas.getContext("2d"); size();
        window.addEventListener("resize", size);
    };
    const frame = (t) => {
        const dt = Math.min(2.2, (t - (last || t)) / 16.67); last = t;
        ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.scale(dpr, dpr);
        parts = parts.filter((p) => p.age < p.max && p.y < innerHeight + 40);
        parts.forEach((p) => {
            p.age += dt; p.vx *= Math.pow(p.drag, dt); p.vy = p.vy * Math.pow(p.drag, dt) + p.g * dt;
            p.x += p.vx * dt + Math.sin(p.age * 0.12 + p.tilt) * p.sway; p.y += p.vy * dt; p.rot += p.vr * dt;
            const fade = p.age > p.max * 0.72 ? 1 - (p.age - p.max * 0.72) / (p.max * 0.28) : 1;
            ctx.save(); ctx.globalAlpha = Math.max(0, fade); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.color;
            if (p.shape === "c") { ctx.shadowColor = p.color; ctx.shadowBlur = 8; ctx.beginPath(); ctx.arc(0, 0, p.w * 0.45, 0, 6.2832); ctx.fill(); }
            else { ctx.scale(1, Math.abs(Math.cos(p.age * 0.15 + p.tilt)) * 0.9 + 0.1); ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); }
            ctx.restore();
        });
        if (parts.length) raf = requestAnimationFrame(frame); else { raf = 0; last = 0; ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height); }
    };

    /** Confetti cannon. angle = firing direction in radians (default straight up). */
    function confetti(o) {
        o = o || {}; ensure();
        const n = reduced() ? Math.min(14, o.count || 90) : Math.min(o.count || 90, 220);
        const x = o.x == null ? innerWidth / 2 : o.x, y = o.y == null ? innerHeight * 0.6 : o.y, angle = o.angle == null ? -Math.PI / 2 : o.angle;
        const spread = o.spread == null ? 1.1 : o.spread, power = o.power || 11, colors = o.colors || COLORS;
        for (let i = 0; i < n && parts.length < 520; i += 1) {
            const a = angle + (Math.random() - 0.5) * spread * 2, v = power * (0.45 + Math.random() * 0.75);
            parts.push({
                x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 0.26 + Math.random() * 0.12, drag: 0.987, w: 5 + Math.random() * 7, h: 3 + Math.random() * 6,
                rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.35, tilt: Math.random() * 6.28, sway: Math.random() * 0.6, shape: Math.random() < (o.coins ? 0.8 : 0.28) ? "c" : "r",
                color: colors[(Math.random() * colors.length) | 0], age: 0, max: 100 + Math.random() * 80
            });
        }
        if (!raf) raf = requestAnimationFrame(frame);
    }
    /** Big celebration: two side cannons + a centre burst + a short shower. */
    function celebrate(o) {
        o = o || {}; const colors = o.colors;
        confetti({ x: 0, y: innerHeight * 0.85, angle: -Math.PI / 3.1, count: 70, power: 15, colors });
        confetti({ x: innerWidth, y: innerHeight * 0.85, angle: -Math.PI + Math.PI / 3.1, count: 70, power: 15, colors });
        window.setTimeout(() => confetti({ x: innerWidth / 2, y: innerHeight * 0.45, spread: 3.14, count: 90, power: 9, colors }), 220);
        if (!reduced()) for (let i = 0; i < 6; i += 1) window.setTimeout(() => confetti({ x: Math.random() * innerWidth, y: -10, angle: Math.PI / 2, spread: 0.5, count: 16, power: 3, colors }), 400 + i * 160);
    }
    /** Gold coin pop from an element (mission claim buttons). */
    function coinsFrom(el) {
        const r = el && el.getBoundingClientRect ? el.getBoundingClientRect() : null;
        confetti({ x: r ? r.left + r.width / 2 : innerWidth / 2, y: r ? r.top + r.height / 2 : innerHeight / 2, spread: 1.6, count: 46, power: 10, coins: true, colors: ["#f4c430", "#e9c46a", "#fff3b0", "#b8860b"] });
    }

    /* Reward popup (queued so back-to-back rewards never stack on top of each other). */
    const queue = []; let showing = false;
    function popup(o) { queue.push(o); if (!showing) next(); }
    function next() {
        const o = queue.shift();
        if (!o) { showing = false; return; }
        showing = true;
        const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
        const layer = el("div", "cx-pop-layer"), card = el("div", "cx-pop");
        layer.setAttribute("role", "dialog"); layer.setAttribute("aria-modal", "true");
        if (o.rarityColor) card.style.setProperty("--rc", o.rarityColor);
        const hero = el("div", "cx-pop-hero");
        if (o.node) hero.appendChild(o.node); else hero.textContent = o.icon || "\u{1F3C6}";
        const h = el("h3", "", o.name || ""), p = el("p", "", o.sub || "");
        card.append(el("span", "cx-ribbon", o.ribbon || "UNLOCKED"), hero, h, p);
        let amt = null;
        if (o.amount != null) { amt = el("div", "cx-amount", "+0"); amt.appendChild(el("small", "", "CHIPS")); card.appendChild(amt); }
        const actions = el("div", "cx-pop-actions");
        let closed = false;
        const close = () => { if (closed) return; closed = true; document.removeEventListener("keydown", onKey); layer.classList.add("out"); window.setTimeout(() => { layer.remove(); next(); }, reduced() ? 0 : 260); };
        const onKey = (e) => { if (e.key === "Escape" || e.key === "Enter") close(); };
        (o.actions || []).forEach((a) => { const b = el("button", "btn " + (a.primary ? "btn-primary" : "btn-secondary"), a.label); b.type = "button"; b.addEventListener("click", () => { try { a.onClick && a.onClick(); } finally { close(); } }); actions.appendChild(b); });
        const ok = el("button", "btn " + ((o.actions || []).length ? "btn-ghost" : "btn-primary"), o.okLabel || "Awesome!"); ok.type = "button"; ok.addEventListener("click", close); actions.appendChild(ok);
        card.appendChild(actions); layer.appendChild(card); document.body.appendChild(layer);
        layer.addEventListener("click", (e) => { if (e.target === layer) close(); });
        document.addEventListener("keydown", onKey);
        ok.focus({ preventScroll: true });
        if (amt) {
            const total = Math.round(o.amount), t0 = performance.now(), dur = reduced() ? 1 : 1100;
            const tick = (t) => { const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3); amt.firstChild.textContent = "+" + Math.round(total * e).toLocaleString("en-US") + " "; if (k < 1 && !closed) requestAnimationFrame(tick); };
            amt.firstChild.textContent = "+0 "; requestAnimationFrame(tick);
        }
    }

    /** Animated modal close (opening is animated purely by CSS when [hidden] is removed). */
    function closeModal(m) {
        if (!m || m.hidden) return;
        if (reduced()) { m.hidden = true; return; }
        m.classList.add("cx-closing");
        window.setTimeout(() => { m.hidden = true; m.classList.remove("cx-closing"); }, 200);
    }
    return { confetti, celebrate, coinsFrom, popup, closeModal, reduced };
})();

/* ---------- Cosmetics: ownership, rendering, atomic purchases ---------- */
const Cosmetics = {
    of(username) { return (Room.get(username) || {}).cosmetics || {}; },
    owns(username, slot, id) { const c = this.of(username); return !!(c.owned && c.owned[`${slot}:${id}`]); },
    equipped(username, slot) { return Catalog.find(slot, this.of(username)[slot]); },
    /** Plain-text glyph (used by canvases / marble race / chat fallback). */
    icon(username, slot) { const i = this.equipped(username, slot); return i ? (i.icon || "\u2605") : ""; },
    /** Chat helper: key of an equipped item only when it needs SVG rendering. */
    svgKey(username, slot) { const i = this.equipped(username, slot); return i && i.svg ? Catalog.key(slot, i.id) : null; },
    /** DOM node for an avatar/badge/frame item: <img> for SVG items, plain text otherwise. */
    node(item, cls) {
        if (item.svg) { const im = document.createElement("img"); im.className = "cx-svg" + (cls ? " " + cls : ""); im.src = Svg.url(item.svg); im.alt = ""; im.draggable = false; return im; }
        const s = document.createElement("span"); if (cls) s.className = cls; s.textContent = item.icon || "\u2605"; return s;
    },
    initials() { return (State.username || "??").slice(0, 2).toUpperCase(); },
    /** Shop / admin / popup preview of any item. */
    preview(item, big) {
        const wrap = document.createElement("div"); wrap.className = "cx-pv" + (big ? " big" : "");
        const circle = (content) => { const c = document.createElement("div"); c.className = "cx-pv-circle" + (big ? " big" : ""); if (content) c.appendChild(content); return c; };
        const mine = this.equipped(State.username, "avatar");
        const sample = () => (mine ? this.node(mine) : document.createTextNode(this.initials()));
        if (item.slot === "avatar") wrap.appendChild(circle(this.node(item)));
        else if (item.slot === "frame") { wrap.appendChild(circle(sample())); const f = this.node(item, "cx-frame"); wrap.appendChild(f); }
        else if (item.slot === "border") { const c = circle(sample()); if (item.css === "bd-aurora") c.classList.add("bd-aurora"); else if (item.color) c.style.boxShadow = `0 0 0 3px ${item.color}, 0 0 14px ${item.color}99`; wrap.appendChild(c); }
        else if (item.slot === "badge") { wrap.classList.add("sq"); wrap.appendChild(this.node(item)); }
        else { wrap.classList.add("title-pv"); const t = document.createElement("span"); t.className = "cx-title"; t.textContent = `${item.icon || ""} ${item.name}`.trim(); if (item.color) { t.style.color = item.color; t.style.borderColor = item.color + "88"; } wrap.appendChild(t); }
        return wrap;
    },
    applyHud() {
        const av = $id("display-avatar"), bd = $id("display-badge");
        if (!av || !bd) return;
        let tl = $id("display-title");
        if (!tl) { tl = document.createElement("span"); tl.id = "display-title"; tl.className = "cx-title"; tl.hidden = true; bd.after(tl); }
        if (!State.username) { av.textContent = "--"; av.className = "top-panel-avatar"; av.style.boxShadow = ""; av.dataset.sig = ""; bd.hidden = true; tl.hidden = true; return; }
        const c = this.of(State.username), a = Catalog.find("avatar", c.avatar), b = Catalog.find("border", c.border), g = Catalog.find("badge", c.badge), f = Catalog.find("frame", c.frame), t = Catalog.find("title", c.title);
        const sig = [State.username, ...[a, b, g, f, t].map((i) => (i ? i.slot + i.id + (i.svg ? i.svg.length : "") + i.icon + (i.color || "") : "-"))].join("|");
        if (av.dataset.sig === sig) return;
        av.dataset.sig = sig;
        av.className = "top-panel-avatar cx-av" + (a ? " has-av" : "") + (b && b.css ? " " + b.css : "");
        av.style.boxShadow = b && !b.css && b.color ? `0 0 0 3px ${b.color}, 0 0 14px ${b.color}99` : "";
        const inner = document.createElement("span"); inner.className = "cx-av-in";
        if (a) inner.appendChild(this.node(a)); else inner.textContent = this.initials();
        av.replaceChildren(inner);
        if (f && f.svg) av.appendChild(this.node(f, "cx-frame"));
        bd.hidden = !g; bd.replaceChildren(g ? this.node(g) : "");
        tl.hidden = !t; tl.textContent = t ? `${t.icon || ""} ${t.name}`.trim() : ""; tl.style.color = (t && t.color) || ""; tl.style.borderColor = t && t.color ? t.color + "88" : "";
    },
    busy: false,
    async buy(slot, id) {
        const item = Catalog.find(slot, id), u = State.username;
        if (!item || !u || !Room.playersRef || this.busy) return;
        if (!Catalog.isListed(slot, id)) { Notify.error("This item was removed from the shop."); return; }
        const key = `${slot}:${id}`; let reason = "";
        this.busy = true;
        try {
            /* One atomic transaction: balance check + chip deduction + unlock + auto-equip. */
            const res = await Room.playersRef.child(u).transaction((p) => {
                if (!p) return p;
                const c = (p.cosmetics = p.cosmetics || {}); c.owned = c.owned || {};
                if (c.owned[key]) { reason = "owned"; return; }
                if ((p.balance || 0) < item.price) { reason = "funds"; return; }
                reason = "";
                p.balance = (p.balance || 0) - item.price; c.owned[key] = true; c[slot] = id; p.updatedAt = Date.now();
                return p;
            });
            if (!res.committed) { Notify.error(reason === "owned" ? "You already own this item." : "Not enough chips for this item."); return; }
            Sound.jackpot();
            Fx.celebrate({ colors: item.rarity === "legendary" ? ["#f4c430", "#fff3b0", "#e9c46a", "#ffffff"] : undefined });
            Fx.popup({
                ribbon: "ITEM UNLOCKED", name: item.name, sub: `${RARITY[item.rarity]} ${SLOT_ONE[item.slot]} \u00B7 equipped`, node: this.preview(item, true),
                rarityColor: `var(--rc-${item.rarity})`, okLabel: "Awesome!"
            });
            PubSub.emit("shop-purchase", item);
        } catch (err) { console.error("Purchase failed", err); Notify.error("Purchase failed. Please try again."); }
        finally { this.busy = false; }
    },
    equip(slot, id) {
        if (!State.username || !Room.playersRef) return;
        if (id && !this.owns(State.username, slot, id)) return;
        Room.playersRef.child(State.username).child("cosmetics").child(slot).set(id || null);
    }
};

const Shop = {
    tab: "all", animate: true,
    init() {
        const modal = $id("shop-modal");
        $id("btn-open-shop").addEventListener("click", () => { this.animate = true; modal.hidden = false; this.render(); });
        $id("btn-shop-close").addEventListener("click", () => Fx.closeModal(modal));
        modal.addEventListener("click", (e) => { if (e.target === modal) Fx.closeModal(modal); });
        document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !modal.hidden && !document.querySelector(".cx-pop-layer")) Fx.closeModal(modal); });
        $id("shop-tabs").addEventListener("click", (e) => { const b = e.target.closest("[data-tab]"); if (!b) return; this.tab = b.dataset.tab; this.animate = true; this.render(); });
        PubSub.on("players-updated", () => { Cosmetics.applyHud(); if (!modal.hidden) this.render(); });
        PubSub.on("shop-updated", () => { Cosmetics.applyHud(); if (!modal.hidden) this.render(); });
    },
    start() { Catalog.start(); },
    stop() { Catalog.stop(); },
    card(item, i) {
        const u = State.username, c = Cosmetics.of(u), owned = Cosmetics.owns(u, item.slot, item.id), on = c[item.slot] === item.id, can = State.balance >= item.price;
        const d = document.createElement("div"); d.className = `cx-card r-${item.rarity}` + (on ? " is-eq" : ""); d.style.setProperty("--i", Math.min(i, 24));
        const rar = document.createElement("span"); rar.className = "cx-rar"; rar.textContent = RARITY[item.rarity];
        const nm = document.createElement("div"); nm.className = "cx-name"; nm.textContent = item.name;
        const bt = document.createElement("button"); bt.type = "button"; bt.className = "btn cx-btn " + (owned ? "btn-secondary" : "btn-primary");
        d.append(rar);
        if (owned) { const ow = document.createElement("span"); ow.className = "cx-own"; ow.textContent = "\u2713"; d.append(ow); }
        d.append(Cosmetics.preview(item), nm);
        if (!owned) {
            const price = document.createElement("span"); price.className = "cx-price"; price.textContent = item.price.toLocaleString("en-US");
            bt.appendChild(price); bt.disabled = !can; bt.addEventListener("click", () => Cosmetics.buy(item.slot, item.id));
            d.append(bt);
            if (!can) { const need = document.createElement("div"); need.className = "cx-need"; need.textContent = `Need ${(item.price - State.balance).toLocaleString("en-US")} more`; d.append(need); }
        } else {
            bt.textContent = on ? "Unequip" : "Equip"; bt.addEventListener("click", () => Cosmetics.equip(item.slot, on ? null : item.id)); d.append(bt);
        }
        return d;
    },
    render() {
        const body = $id("shop-body"), tabs = $id("shop-tabs");
        $id("shop-balance").textContent = State.balance.toLocaleString("en-US");
        tabs.textContent = "";
        [["all", "All"], ...SLOTS.map((s) => [s, SLOT_LABEL[s]])].forEach(([k, label]) => {
            const b = document.createElement("button"); b.type = "button"; b.className = "cx-tab"; b.dataset.tab = k; b.textContent = label; b.setAttribute("aria-pressed", String(this.tab === k)); tabs.appendChild(b);
        });
        const sc = $id("shop-modal").querySelector(".modal"), keepScroll = sc ? sc.scrollTop : 0;
        body.textContent = "";
        const slots = this.tab === "all" ? SLOTS : [this.tab];
        let any = false, idx = 0;
        slots.forEach((slot) => {
            const items = Catalog.listed(slot);
            if (!items.length) return;
            any = true;
            if (this.tab === "all") { const h = document.createElement("div"); h.className = "cx-sec-title"; h.textContent = SLOT_LABEL[slot]; body.appendChild(h); }
            const g = document.createElement("div"); g.className = "cx-grid" + (this.animate ? " cx-anim" : "");
            items.forEach((it) => g.appendChild(this.card(it, idx++)));
            body.appendChild(g);
        });
        if (!any) { const e = document.createElement("div"); e.className = "cx-empty"; e.textContent = "Nothing on sale here right now. Check back soon!"; body.appendChild(e); }
        this.animate = false;
        if (sc) sc.scrollTop = keepScroll;
    }
};

const Chat = {
    open: false, unread: 0, last: 0, chatQ: null, reactQ: null, chatRef: null, reactRef: null,
    $(id) { return document.getElementById(id); },
    init() {
        const toggle = (v, refocus) => this.setOpen(v, refocus);
        const header = this.$("top-panel");
        this.syncLayout();
        if (window.ResizeObserver && header) new ResizeObserver(() => this.syncLayout()).observe(header);
        window.addEventListener("resize", () => this.syncLayout());
        window.addEventListener("orientationchange", () => this.syncLayout());
        document.addEventListener("keydown", (e) => { if (e.key === "Escape" && this.open) toggle(false, true); });
        this.$("btn-chat-toggle").addEventListener("click", () => toggle(!this.open));
        this.$("btn-chat-close").addEventListener("click", () => toggle(false, true));
        this.$("btn-chat-send").addEventListener("click", () => this.send());
        this.$("chat-input").addEventListener("keydown", (e) => { if (e.key === "Enter") this.send(); });
        this.$("react-bar").querySelectorAll("[data-react]").forEach((b) => b.addEventListener("click", () => this.react(b.dataset.react)));
    },
    /* Publish the sticky header's height so the docked panel always starts right below it. */
    syncLayout() {
        const header = this.$("top-panel");
        const h = header && header.offsetParent !== null ? Math.ceil(header.getBoundingClientRect().height) : 0;
        document.documentElement.style.setProperty("--topbar-h", h + "px");
    },
    setOpen(v, refocus) {
        this.open = !!v;
        this.$("chat-panel").hidden = !this.open;
        const view = this.$("view-lobby"); if (view) view.classList.toggle("chat-open", this.open);
        this.$("btn-chat-toggle").setAttribute("aria-expanded", String(this.open));
        this.syncLayout();
        if (this.open) { this.unread = 0; this.badge(); this.$("chat-input").focus({ preventScroll: true }); this.scroll(); }
        else if (refocus) this.$("btn-chat-toggle").focus({ preventScroll: true });
    },
    badge() { const u = this.$("chat-unread"); u.hidden = !this.unread; u.textContent = String(this.unread); },
    scroll() { const l = this.$("chat-log"); l.scrollTop = l.scrollHeight; },
    start() {
        this.stop();
        if (!Room.db || !Room.code) return;
        const base = Room.db.ref(`rooms/${Room.code}`);
        this.chatRef = base.child("chat"); this.reactRef = base.child("reactions");
        this.$("chat-log").textContent = "";
        this.chatQ = this.chatRef.limitToLast(60);
        this.chatQ.on("child_added", (s) => this.addMsg(s.val()));
        let live = false;
        this.reactQ = this.reactRef.limitToLast(1);
        this.reactQ.on("child_added", (s) => { const v = s.val(); if (live && v && v.e) this.float(v.e); });
        this.reactQ.once("value").then(() => { live = true; });
    },
    stop() {
        if (this.chatQ) this.chatQ.off(); if (this.reactQ) this.reactQ.off();
        this.chatQ = this.reactQ = this.chatRef = this.reactRef = null;
        if (this.open) this.setOpen(false);
    },
    addMsg(m) {
        if (!m || !m.t) return;
        const d = document.createElement("div"); d.className = "chat-msg" + (m.u === State.username ? " mine" : "");
        const u = document.createElement("b"); u.className = "mu";
        const ai = m.ak && Catalog.byKey(m.ak), bi = m.bk && Catalog.byKey(m.bk);
        if (ai && ai.svg) u.append(Cosmetics.node(ai, "cx-chat-ic"), " "); else if (m.a) u.append(m.a + " ");
        u.append(m.u);
        if (bi && bi.svg) u.append(" ", Cosmetics.node(bi, "cx-chat-ic")); else if (m.b) u.append(" " + m.b);
        if (m.tt) { const tt = document.createElement("i"); tt.className = "cx-chat-title"; tt.textContent = m.tt; u.append(" ", tt); }
        const t = document.createElement("span"); t.textContent = m.t;
        d.append(u, t);
        const log = this.$("chat-log"); log.appendChild(d);
        while (log.children.length > 100) log.removeChild(log.firstChild);
        if (this.open) this.scroll(); else if (m.u !== State.username) { this.unread += 1; this.badge(); }
    },
    send() {
        const inp = this.$("chat-input"), t = inp.value.trim().slice(0, 200), now = Date.now();
        if (!t || !this.chatRef || !State.username || now - this.last < 600) return;
        this.last = now; inp.value = "";
        this.chatRef.push({ u: State.username, t, a: Cosmetics.icon(State.username, "avatar"), b: Cosmetics.icon(State.username, "badge"), ak: Cosmetics.svgKey(State.username, "avatar"), bk: Cosmetics.svgKey(State.username, "badge"), tt: (Cosmetics.equipped(State.username, "title") || {}).name || null, ts: window.firebase.database.ServerValue.TIMESTAMP });
    },
    react(e) {
        const now = Date.now();
        if (!this.reactRef || now - this.last < 350) return;
        this.last = now;
        const r = this.reactRef.push({ e, u: State.username, ts: window.firebase.database.ServerValue.TIMESTAMP });
        window.setTimeout(() => r.remove().catch(() => { }), 8000);
    },
    float(e) {
        const layer = this.$("react-layer");
        if (layer.children.length > 40) return;
        const n = document.createElement("span"); n.className = "float-react"; n.textContent = e;
        n.style.left = (8 + Math.random() * 84) + "%"; n.style.setProperty("--dx", ((Math.random() - 0.5) * 120) + "px");
        n.addEventListener("animationend", () => n.remove()); layer.appendChild(n);
    }
};

const Jackpot = {
    RATE: 0.02, TARGET: 500, ref: null, pool: 0, ready: false, lastId: null, paying: false, cb: null,
    start() {
        this.stop();
        if (!Room.db || !Room.code) return;
        this.ref = Room.db.ref(`rooms/${Room.code}/jackpot`);
        document.getElementById("jp-target").textContent = String(this.TARGET);
        this.cb = (s) => {
            const v = s.val() || {}, ev = v.lastWin;
            this.pool = v.pool || 0; this.render();
            if (ev && ev.id !== this.lastId) { if (this.ready) this.flash(ev); this.lastId = ev.id; }
            this.ready = true;
            if (this.pool >= this.TARGET) this.payout();
        };
        this.ref.on("value", this.cb);
    },
    stop() { if (this.ref && this.cb) this.ref.off("value", this.cb); this.ref = this.cb = null; this.ready = false; this.lastId = null; this.pool = 0; this.render(); },
    render() {
        const f = document.getElementById("jp-fill"), a = document.getElementById("jp-amount");
        if (f) f.style.width = Math.min(100, (this.pool / this.TARGET) * 100) + "%";
        if (a) a.textContent = this.pool.toLocaleString("en-US");
    },
    /** Takes the vault fee out of the wager's player (only if affordable) and adds it to the pool. */
    rake(wager) {
        const fee = Math.max(1, Math.round((Number(wager) || 0) * this.RATE));
        if (!this.ref || State.balance < fee) return 0;
        State.balance -= fee; HUD.update();
        this.ref.child("pool").transaction((p) => (p || 0) + fee);
        return fee;
    },
    /** Race-safe: only the client whose transaction commits pays winners. */
    async payout() {
        if (this.paying || !this.ref) return;
        this.paying = true;
        try {
            const cutoff = Date.now() - 10 * 60 * 1000;
            const winners = Room.list().filter((p) => (p.updatedAt || 0) >= cutoff).map((p) => p.username);
            if (!winners.length) return;
            const id = Date.now() + "-" + Math.random().toString(36).slice(2, 7);
            const res = await this.ref.transaction((v) => {
                if (!v || (v.pool || 0) < this.TARGET) return;
                return { pool: 0, lastWin: { id, amount: v.pool, winners, ts: Date.now() } };
            });
            if (!res.committed) return;
            const share = Math.floor(res.snapshot.val().lastWin.amount / winners.length);
            winners.forEach((u) => Room.playersRef.child(u).child("balance").transaction((b) => (b == null ? b : b + share)));
        } finally { this.paying = false; }
    },
    flash(ev) {
        const share = Math.floor(ev.amount / (ev.winners || [1]).length), f = document.getElementById("jp-flash");
        f.classList.remove("is-on"); void f.offsetWidth; f.classList.add("is-on");
        Effects.celebrate(`\u{1F48E} VAULT OPENED! ${ev.amount} chips shared`);
        for (let i = 0; i < 14; i += 1) window.setTimeout(() => Chat.float("\u{1F48E}"), i * 120);
        if ((ev.winners || []).includes(State.username)) Notify.success(`Vault payout: +${share} chips for you!`);
    }
};

const Social = {
    init() { Shop.init(); Chat.init(); },
    start() { Shop.start(); Chat.start(); Jackpot.start(); },
    stop() { Chat.stop(); Jackpot.stop(); Shop.stop(); }
};

/**
 * App-style dropdown navigation. Items carry data-game (section key) and an
 * optional data-draw-mode, so Lucky Draw modes double as direct shortcuts.
 */
const NavMenu = {
    DRAW_EXTRA: ["bracket", "plinko", "marble", "chests", "roles"],
    init() {
        this.root = DOM.gameSelector;
        this.trigger = document.getElementById("nav-menu-trigger");
        this.panel = document.getElementById("nav-menu-panel");
        this.items = Array.from(this.panel.querySelectorAll("[data-game]"));

        this.trigger.addEventListener("click", () => this.toggle());
        this.items.forEach((el) => el.addEventListener("click", () => this.pick(el)));
        document.addEventListener("click", (e) => { if (!this.root.contains(e.target)) this.close(); });
        this.root.addEventListener("focusout", (e) => { if (e.relatedTarget && !this.root.contains(e.relatedTarget)) this.close(); });
        this.root.addEventListener("keydown", (e) => this.onKey(e));
        document.addEventListener("game-changed", () => this.sync());
        document.querySelectorAll(".draw-mode-btn").forEach((b) => b.addEventListener("click", () => setTimeout(() => this.sync(), 0)));
        this.sync();
    },
    get isOpen() { return this.root.classList.contains("is-open"); },
    toggle() { this.isOpen ? this.close() : this.open(); },
    open() {
        this.root.classList.add("is-open");
        this.trigger.setAttribute("aria-expanded", "true");
        const start = this.panel.querySelector('[aria-current="true"]') || this.items[0];
        requestAnimationFrame(() => start && start.focus({ preventScroll: true }));
    },
    close(refocus) {
        if (!this.isOpen) return;
        this.root.classList.remove("is-open");
        this.trigger.setAttribute("aria-expanded", "false");
        if (refocus) this.trigger.focus({ preventScroll: true });
    },
    pick(el) {
        const game = el.dataset.game, mode = el.dataset.drawMode;
        Router.selectGame(game);
        if (game === "draw" && mode) {
            const b = document.querySelector('.draw-mode-btn[data-draw-mode="' + mode + '"]');
            if (b) b.click();
        }
        this.sync();
        this.close(true);
    },
    onKey(e) {
        if (e.key === "Escape" && this.isOpen) { e.preventDefault(); e.stopPropagation(); this.close(true); return; }
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
        if (!this.isOpen) { if (e.target === this.trigger && e.key !== "Home" && e.key !== "End") { e.preventDefault(); this.open(); } return; }
        e.preventDefault();
        const i = this.items.indexOf(document.activeElement);
        let n = e.key === "ArrowDown" ? i + 1 : e.key === "ArrowUp" ? i - 1 : e.key === "Home" ? 0 : this.items.length - 1;
        n = (n + this.items.length) % this.items.length;
        this.items[n].focus();
    },
    sync() {
        const game = Router.currentGameKey;
        const mode = typeof LuckyDraw !== "undefined" ? LuckyDraw.mode : null;
        const extra = this.DRAW_EXTRA.includes(mode);
        let current = null;
        this.items.forEach((el) => {
            const isChip = el.classList.contains("nav-menu-chip");
            const m = el.dataset.drawMode;
            let on = false;
            if (el.dataset.game === game) {
                if (game !== "draw") on = true;
                else if (isChip || this.DRAW_EXTRA.includes(m)) on = m === mode;
                else on = !extra; // main Lucky Draw entry covers the 4 visual modes
            }
            if (on) el.setAttribute("aria-current", "true"); else el.removeAttribute("aria-current");
            if (on && !isChip) current = el;
        });
        if (current) {
            document.getElementById("nav-menu-current").textContent = Array.from(current.childNodes).filter((n) => !(n.classList && n.classList.contains("nav-live"))).map((n) => n.textContent).join("").trim();
            document.getElementById("nav-menu-current-icon").textContent = current.querySelector(".nav-menu-icon").textContent;
        }
    }
};

function bindGameNavigation() {
    NavMenu.init();
}

/**
 * Keeps the active player's own balance in sync with the room in real
 * time — this is what lets an Administrator Panel action (or another of
 * that player's own devices) update a player's HUD live, without them
 * having to do anything.
 */
function bindRemoteBalanceSync() {
    PubSub.on("players-updated", (players) => {
        if (!State.username) return;
        const remote = players[State.username];
        if (!remote) return;
        const remoteBalance = remote.balance || 0;
        if (remoteBalance !== State.balance) {
            State.applyingRemoteUpdate = true;
            State.balance = remoteBalance;
            HUD.update();
            State.applyingRemoteUpdate = false;
        }
    });
}

function init() {
    Sound.init();

    DOM.btnLogout.addEventListener("click", handleLogout);
    DOM.btnSoundToggle.addEventListener("click", () => Sound.toggle());
    bindGameNavigation();
    bindRemoteBalanceSync();

    SetupScreen.init();
    AuthScreen.init();
    Leaderboard.init();
    Admin.init();

    Blackjack.init();
    Roulette.init();
    PlayerWheel.init();
    LuckyDraw.init();
    Slots.init();
    HiLo.init();
    Extra.init();
    Social.init();

    Router.showSetup();
    HUD.update();
}

/* =========================================================================
   DAILY MISSIONS ENGINE + ROOM CONFIG SYNC  (player-facing half of the former "Plus" module)
   Owns: mission definitions, per-player progress transactions, the Missions modal, the
   rooms/<code>/cfg listener (room name, bonus multiplier, disabled games / missions, rig flag)
   and the Missions button in the top bar.
   The Host Settings half lives in admin-panel.js and plugs in through `hooks`.
   ========================================================================= */
const Missions = (() => {
    /* Late-bound hooks, filled in by admin-panel.js (Host Settings) once it has loaded. */
    const hooks = { adminRefresh() { }, syncUi() { } };
    const adminRefresh = () => hooks.adminRefresh();
    const syncUi = () => hooks.syncUi();

        /* Data-driven missions. metric: rounds | wins | profit | wager | bigbet | bigwin | streak | shop | checkin.
           games (optional) limits a mission to specific game ids ("draw" also matches "draw:slots", etc.). */
        const QUESTS = [
            { id: "checkin", cat: "bonus", icon: "\u{1F4C5}", text: "Daily check-in: open the casino lobby", goal: 1, reward: 50, metric: "checkin" },
            { id: "shopper", cat: "bonus", icon: "\u{1F6CD}\uFE0F", text: "Buy any item from the Shop", goal: 1, reward: 200, metric: "shop" },
            { id: "play3", cat: "casino", icon: "\u{1F3B2}", text: "Play 3 rounds of any game", goal: 3, reward: 150, metric: "rounds" },
            { id: "play10", cat: "casino", icon: "\u{1F525}", text: "Play 10 rounds of any game", goal: 10, reward: 400, metric: "rounds" },
            { id: "bj", cat: "casino", icon: "\u2660\uFE0F", text: "Play a round of Blackjack", goal: 1, reward: 100, metric: "rounds", games: ["blackjack"] },
            { id: "bjwin", cat: "casino", icon: "\u{1F0CF}", text: "Win 2 Blackjack hands", goal: 2, reward: 250, metric: "wins", games: ["blackjack"] },
            { id: "slots3", cat: "casino", icon: "\u{1F3B0}", text: "Spin the Slots 3 times", goal: 3, reward: 150, metric: "rounds", games: ["slots"] },
            { id: "roulette3", cat: "casino", icon: "\u{1F534}", text: "Play 3 rounds of Roulette", goal: 3, reward: 150, metric: "rounds", games: ["roulette"] },
            { id: "spin", cat: "casino", icon: "\u{1F3A1}", text: "Spin a wheel, reels or roulette", goal: 1, reward: 100, metric: "rounds", games: ["wheel", "roulette", "slots", "moneywheel"] },
            { id: "spin5", cat: "casino", icon: "\u{1F300}", text: "Spin wheels, reels or roulette 5 times", goal: 5, reward: 300, metric: "rounds", games: ["wheel", "roulette", "slots", "moneywheel"] },
            { id: "dice", cat: "casino", icon: "\u{1F3AF}", text: "Play 2 rounds of Craps, Crash or Poker Dice", goal: 2, reward: 150, metric: "rounds", games: ["craps", "crash", "pokerdice"] },
            { id: "hilo", cat: "casino", icon: "\u{1F500}", text: "Play Hi-Lo 3 times", goal: 3, reward: 150, metric: "rounds", games: ["hilo"] },
            { id: "poker", cat: "casino", icon: "\u{1F577}\uFE0F", text: "Play a Black Widow Poker hand", goal: 1, reward: 200, metric: "rounds", games: ["blackwidow"] },
            { id: "casual", cat: "casual", icon: "\u{1F3B4}", text: "Play a round of any Casual \u0026 Party game", goal: 1, reward: 150, metric: "rounds", games: ["uno", "parques", "dominoes", "chess", "checkers", "mastermind", "bullscows"] },
            { id: "casualwin", cat: "casual", icon: "\u{1F3C5}", text: "Win a round of any Casual \u0026 Party game", goal: 1, reward: 300, metric: "wins", games: ["uno", "parques", "dominoes", "chess", "checkers", "mastermind", "bullscows"] },
            { id: "win", cat: "wins", icon: "\u{1F4B0}", text: "Win 500 chips in total", goal: 500, reward: 250, metric: "profit" },
            { id: "win2000", cat: "wins", icon: "\u{1F3C6}", text: "Win 2,000 chips in total", goal: 2000, reward: 600, metric: "profit" },
            { id: "bigwin", cat: "wins", icon: "\u{1F48E}", text: "Win 400+ chips profit in a single round", goal: 1, reward: 350, metric: "bigwin", min: 400 },
            { id: "streak3", cat: "wins", icon: "\u26A1", text: "Win 3 rounds in a row", goal: 3, reward: 300, metric: "streak" },
            { id: "bigbet", cat: "wins", icon: "\u{1F40B}", text: "Place a single bet of 200+ chips", goal: 1, reward: 150, metric: "bigbet", min: 200 },
            { id: "wager1000", cat: "wins", icon: "\u{1F4C8}", text: "Wager 1,000 chips in total", goal: 1000, reward: 300, metric: "wager" }
        ];
        const cfg = { roomName: "", bonusMult: 1, missionsOn: true, disabled: {}, names: {}, mDisabled: {} };
        const day = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };  // local calendar day
        const $ = (id) => document.getElementById(id);
        const qRef = () => Room.playersRef.child(State.username + "/quests/" + day());
        let qState = { p: {}, c: {} }, qOff = null;
        const mk = (html) => { const d = document.createElement("div"); d.innerHTML = html; return d.firstElementChild; };

        const css = document.createElement("style");
        css.textContent = `
       .px-modal{position:fixed;inset:0;z-index:300;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.75);padding:1rem}
       .px-modal[hidden]{display:none}
       .px-card{width:min(560px,100%);max-height:88vh;overflow:auto;padding:1.25rem;border-radius:var(--radius-lg);border:1px solid rgba(245,210,122,.4);background:linear-gradient(160deg,#141920,#090b0e);box-shadow:0 26px 60px rgba(0,0,0,.7),0 0 34px rgba(233,196,106,.14)}
       .px-card h2{margin:0 0 .8rem;color:var(--color-gold-strong)}
       .px-card h3{margin:1.1rem 0 .4rem;color:var(--color-gold);font-size:.95rem;letter-spacing:.06em;text-transform:uppercase}
       .px-row{display:flex;align-items:center;gap:.6rem;padding:.55rem .7rem;margin:.3rem 0;border:1px solid var(--color-border);border-radius:var(--radius-sm);background:rgba(255,255,255,.03)}
       .px-row>span:nth-child(2){flex:1}
       .px-row.done{border-color:var(--color-gold-dark)}
       .px-bar{height:5px;border-radius:9px;background:#222;overflow:hidden;margin-top:4px}
       .px-bar i{display:block;height:100%;background:linear-gradient(90deg,var(--color-gold-dark),var(--color-gold-strong))}
       .px-card input[type=text],.px-card input[type=number],.px-card select{background:#0d1015;color:var(--color-text);border:1px solid var(--color-border);border-radius:6px;padding:.4rem .6rem;font:inherit;max-width:100%}
       .px-load{margin-top:.6rem}`;
        document.head.appendChild(css);

        const modal = (id, inner) => { const m = mk(`<div class="px-modal" id="${id}" hidden><div class="px-card">${inner}</div></div>`); m.addEventListener("click", (e) => { if (e.target === m || e.target.dataset.close) Fx.closeModal(m); }); document.body.appendChild(m); return m; };
        const mMiss = modal("px-missions", `<h2>\u{1F3AF} Daily Missions</h2><div id="px-qhead"></div><div id="px-qlist"></div><button class="btn btn-ghost btn-block" data-close="1" style="margin-top:1rem">Close</button>`);
        const mAdm = modal("px-admin", `<h2>\u2699 Host Settings</h2><div id="px-adm"></div><button class="btn btn-ghost btn-block" data-close="1" style="margin-top:1rem">Close</button>`);

        /* ---------- Room config sync (Firebase: rooms/{code}/cfg) ---------- */
        const pushCfg = () => Room.db && Room.code && Room.db.ref(`rooms/${Room.code}/cfg`).set({ ...cfg, rig: { on: Rig.on, t: Rig.target } });
        const applyCfg = (v) => {
            v = v || {};
            Object.assign(cfg, { roomName: v.roomName || "", bonusMult: v.bonusMult || 1, missionsOn: v.missionsOn !== false, disabled: v.disabled || {}, names: v.names || {}, mDisabled: v.mDisabled || {} });
            Rig.on = !!(v.rig && v.rig.on); Rig.target = (v.rig && v.rig.t) || "";
            document.querySelectorAll(".nav-menu-item[data-game]").forEach((b) => { b.hidden = !!cfg.disabled[b.dataset.game]; });
            $("btn-missions").hidden = !cfg.missionsOn;
            if (cfg.roomName) document.title = cfg.roomName + " \u2014 Casino Campus";
            if (cfg.disabled[Router.currentGameKey]) Router.selectGame("blackjack");
            renderQuests(); adminRefresh();
        };
        const origAttach = Room.attachListeners.bind(Room);
        Room.attachListeners = function () {
            origAttach();
            if (this.cfgRef) this.cfgRef.off();
            this.cfgRef = this.db.ref(`rooms/${this.code}/cfg`);
            this.cfgRef.on("value", (s) => { applyCfg(s.val()); syncUi(); });
        };
        const origSelect = Router.selectGame.bind(Router);
        Router.selectGame = function (k) {
            if (cfg.disabled[k] && !State.isHost) { Notify.warning("This game is disabled by the host."); return; }
            origSelect(k);
        };

        /* ---------- Daily missions ---------- */
        const CATS = { all: "All", casino: "Casino", casual: "Casual", wins: "Wins", bonus: "Bonus" };
        const Q = (id) => QUESTS.find((q) => q.id === id);
        const enabled = (id) => cfg.missionsOn && !cfg.mDisabled[id];
        let filter = "all", claiming = false, watchedDay = "", watchedUser = "", watchedRoom = "", prevState = null;
        const flashIds = new Set();
        const rw = (q) => Math.round(q.reward * cfg.bonusMult);
        const prog = (q) => Math.min(q.goal, Number((qState.p || {})[q.id]) || 0);
        const isDone = (q) => prog(q) >= q.goal;
        const isClaimed = (q) => !!(qState.c || {})[q.id];
        const claimable = () => QUESTS.filter((q) => enabled(q.id) && isDone(q) && !isClaimed(q));

        /** One atomic transaction on today's node; `fn(q, add)` mutates it, nothing is written when nothing changed. */
        const track = (fn) => {
            if (!cfg.missionsOn || !State.username || !Room.playersRef) return;
            qRef().transaction((q) => {
                q = q || {}; q.p = q.p || {};
                const before = JSON.stringify(q);
                fn(q, (id, n) => { if (enabled(id) && n > 0) q.p[id] = (Number(q.p[id]) || 0) + n; });
                return JSON.stringify(q) === before ? undefined : q;
            }, undefined, false);
        };
        PubSub.on("round-resolved", ({ gameId, entries }) => {
            const e = (entries || []).find((x) => x.username === State.username && x.wager > 0);
            if (!e) return;
            const profit = e.payout - e.wager, won = profit > 0, lost = e.payout < e.wager;
            track((q, add) => {
                QUESTS.forEach((m) => {
                    if (m.games && !m.games.some((g) => gameId === g || String(gameId).indexOf(g + ":") === 0)) return;
                    switch (m.metric) {
                        case "rounds": add(m.id, 1); break;
                        case "wins": if (won) add(m.id, 1); break;
                        case "profit": if (won) add(m.id, profit); break;
                        case "wager": add(m.id, e.wager); break;
                        case "bigbet": if (e.wager >= m.min) add(m.id, 1); break;
                        case "bigwin": if (profit >= m.min) add(m.id, 1); break;
                        case "streak":
                            if (!enabled(m.id)) break;
                            if (won) { q.s = (q.s || 0) + 1; q.p[m.id] = Math.max(Number(q.p[m.id]) || 0, q.s); } else if (lost) q.s = 0;
                            break;
                        default: break;
                    }
                });
            });
        });
        PubSub.on("shop-purchase", () => track((q, add) => QUESTS.filter((m) => m.metric === "shop").forEach((m) => add(m.id, 1))));
        const checkIn = () => track((q, add) => { if (!q.p.checkin) QUESTS.filter((m) => m.metric === "checkin").forEach((m) => add(m.id, 1)); });

        const resetIn = () => { const n = new Date(), m = new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1), s = Math.max(0, Math.floor((m - n) / 60000)); return `${Math.floor(s / 60)}h ${s % 60}m`; };
        const updateMissionBadge = () => { const b = $("btn-missions"); if (!b) return; const n = claimable().length; if (n) b.dataset.n = String(n); else delete b.dataset.n; };
        const renderQuests = () => {
            updateMissionBadge();
            const list = $("px-qlist"), head = $("px-qhead");
            if (!list || !head) return;
            const pool = QUESTS.filter((q) => enabled(q.id) || isClaimed(q)), got = pool.filter(isClaimed).length, ready = claimable();
            const pct = pool.length ? Math.round((got / pool.length) * 100) : 0, sum = ready.reduce((a, q) => a + rw(q), 0);
            head.innerHTML = `<div class="mx-sum"><div class="mx-ring" style="--pct:${pct}"><span>${got}/${pool.length}</span></div>
               <div class="mx-sum-text"><b>${cfg.missionsOn ? "Today's missions" : "Missions are paused by the host"}</b><small>Resets in ${resetIn()}${cfg.bonusMult !== 1 ? " \u00B7 rewards x" + cfg.bonusMult : ""}</small></div>
               <button type="button" class="btn btn-primary btn-small" data-all="1" ${ready.length ? "" : "disabled"}>Claim all${ready.length ? " (+" + sum.toLocaleString("en-US") + ")" : ""}</button></div>
               <div class="mx-chips">${Object.keys(CATS).map((k) => `<button type="button" class="mx-chip" data-cat="${k}" aria-pressed="${filter === k}">${CATS[k]}</button>`).join("")}</div>`;
            list.innerHTML = QUESTS.filter((q) => filter === "all" || q.cat === filter).map((q) => {
                const p = prog(q), done = isDone(q), claimed = isClaimed(q), off = !enabled(q.id) && !claimed;
                const cls = (off ? "off" : claimed ? "claimed" : done ? "ready" : "") + (flashIds.has(q.id) ? " flash" : "");
                const btn = claimed ? `<button type="button" class="btn btn-secondary mx-btn" disabled>Claimed \u2713</button>`
                    : off ? `<button type="button" class="btn btn-secondary mx-btn" disabled>\u{1F512} Paused</button>`
                        : `<button type="button" class="btn ${done ? "btn-primary ready" : "btn-secondary"} mx-btn" data-claim="${q.id}" ${done ? "" : "disabled"}>${done ? "Claim " : ""}+${rw(q)}</button>`;
                return `<div class="mx-row ${cls}" data-id="${q.id}"><span class="mx-ic">${q.icon}</span><div class="mx-body"><div class="mx-t">${q.text}</div>
                 <div class="mx-bar"><i style="width:${(p / q.goal) * 100}%"></i></div><small>${p.toLocaleString("en-US")} / ${q.goal.toLocaleString("en-US")}${off ? " \u00B7 disabled by host" : ""}</small></div>${btn}</div>`;
            }).join("");
            flashIds.clear();
        };

        /** Atomic check-and-claim: progress, disabled state and "already claimed" are all verified inside the transaction. */
        const claim = (ids, src) => {
            if (claiming || !State.username || !Room.playersRef || !ids.length) return;
            claiming = true; let got = [];
            qRef().transaction((q) => {
                got = []; q = q || {}; q.p = q.p || {}; q.c = q.c || {};
                ids.forEach((id) => { const m = Q(id); if (!m || !enabled(id) || q.c[id] || (Number(q.p[id]) || 0) < m.goal) return; q.c[id] = true; got.push(id); });
                return got.length ? q : undefined;
            }, (err, ok) => {
                claiming = false;
                if (err || !ok || !got.length) { Notify.warning("Nothing to claim right now."); return; }
                const total = got.reduce((a, id) => a + rw(Q(id)), 0), one = got.length === 1 ? Q(got[0]) : null;
                got.forEach((id) => flashIds.add(id));
                Audit.log("mission", `Claimed ${got.length} mission reward(s)`, total); Room.applyRound(State.username, { balance: total });      // atomic delta, never overwrites concurrent balance changes
                Sound.jackpot(); Fx.coinsFrom(src);
                if (got.length > 1) Fx.celebrate();
                window.setTimeout(() => Fx.popup({ ribbon: got.length > 1 ? "MISSIONS COMPLETE" : "MISSION COMPLETE", icon: one ? one.icon : "\u{1F3C6}", name: one ? one.text : `${got.length} rewards claimed`, sub: "Reward added to your balance", amount: total, okLabel: "Collect" }), 260);
                renderQuests();
            }, false);
        };
        mMiss.addEventListener("click", (e) => {
            const t = e.target.closest("[data-claim],[data-all],[data-cat]");
            if (!t || t.disabled) return;
            if (t.dataset.cat) { filter = t.dataset.cat; renderQuests(); }
            else if (t.dataset.all) claim(claimable().map((q) => q.id), t);
            else claim([t.dataset.claim], t);
        });
        const watchQuests = () => {
            if (qOff) { qOff(); qOff = null; }
            if (!State.username || !Room.playersRef) return;
            watchedDay = day(); watchedUser = State.username; watchedRoom = Room.code; prevState = null;
            const r = qRef(), cb = r.on("value", (s) => {
                const next = s.val() || {}; next.p = next.p || {}; next.c = next.c || {};
                if (prevState && QUESTS.some((q) => (Number(prevState.p[q.id]) || 0) > (Number(next.p[q.id]) || 0) || (prevState.c[q.id] && !next.c[q.id]))) Notify.warning("The host reset some of your daily missions.");
                prevState = qState = next; renderQuests();
            });
            qOff = () => r.off("value", cb);
            checkIn();
        };
        const needsWatch = () => !qOff || watchedUser !== State.username || watchedRoom !== Room.code || watchedDay !== day();

    /* ---------- Top-bar button: Daily Missions ---------- */
    const anchor = DOM.btnOpenAdminLobby;
    anchor.before(mk(`<button type="button" id="btn-missions" class="btn btn-secondary" title="Daily Missions">\u{1F3AF}</button>`));
    $("btn-missions").onclick = () => { if (needsWatch()) watchQuests(); renderQuests(); mMiss.hidden = false; };

    return { hooks, cfg, QUESTS, $, mk, day, mMiss, mAdm, pushCfg, CATS, Q, claim, enabled, needsWatch, watchQuests, renderQuests };
})();

/* ---------- Synthesized audio (Web Audio oscillators + filtered noise; no files) ---------- */
Sound.tone = function (f, ms, type = "sine", v = 0.08) {
    if (!this.enabled) return; const c = this.ensureContext(); if (!c) return;
    if (c.state === "suspended") c.resume();
    const o = c.createOscillator(), g = c.createGain(), t = c.currentTime;
    o.type = type; o.frequency.setValueAtTime(f, t); g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
    o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + ms / 1000 + 0.02);
};

Sound.noise = function (ms, f, v = 0.05) {
    if (!this.enabled) return; const c = this.ensureContext(); if (!c) return;
    const n = (c.sampleRate * ms / 1000) | 0, b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const s = c.createBufferSource(), fl = c.createBiquadFilter(), g = c.createGain();
    fl.type = "bandpass"; fl.frequency.value = f; g.gain.value = v; s.buffer = b; s.connect(fl); fl.connect(g); g.connect(c.destination); s.start();
};

Sound.chip = function () { this.tone(1900, 35, "square", 0.03); window.setTimeout(() => this.tone(1250, 70, "triangle", 0.05), 28); };

Sound.card = function () { this.noise(90, 2400, 0.07); };

Sound.tick = function (i) { this.tone(880 + ((i || 0) % 6) * 45, 22, "square", 0.02); };

Sound.fanfare = function () { [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => window.setTimeout(() => { this.tone(f, 220, "triangle", 0.07); this.tone(f / 2, 220, "sine", 0.05); }, i * 120)); };

Sound.click = Sound.chip; Sound.jackpot = Sound.fanfare;

document.addEventListener("pointerdown", () => { const c = Sound.enabled && Sound.ensureContext(); if (c && c.state === "suspended") c.resume(); });

/* ---------- Achievements ---------- */
const ACH = [
    { id: "first", n: "Rookie", i: "\u{1F39F}\uFE0F", t: "Play your first round", c: "rounds", g: 1 },
    { id: "reg", n: "Regular", i: "\u{1F3B2}", t: "Play 50 rounds", c: "rounds", g: 50 },
    { id: "vet", n: "Veteran", i: "\u{1F396}\uFE0F", t: "Play 250 rounds", c: "rounds", g: 250 },
    { id: "w10", n: "Winner", i: "\u{1F3C6}", t: "Win 10 rounds", c: "wins", g: 10 },
    { id: "w50", n: "Hot Hand", i: "\u{1F525}", t: "Win 50 rounds", c: "wins", g: 50 },
    { id: "big", n: "Whale", i: "\u{1F40B}", t: "Win 1,000+ chips profit in one round", c: "big", g: 1 },
    { id: "str5", n: "Streak King", i: "\u26A1", t: "Win 5 rounds in a row", c: "streak", g: 5 },
    { id: "spin3", n: "Lucky Charm", i: "\u{1F340}", t: "Use the Daily Spin 3 times", c: "spins", g: 3 },
    { id: "dice", n: "Dice Master", i: "\u{1F3AF}", t: "Win 10 Quick Dice rounds", c: "dicew", g: 10 },
    { id: "champ", n: "Champion", i: "\u{1F451}", t: "Win a knockout tournament", c: "champ", g: 1 },
    { id: "debt", n: "Debt Free", i: "\u{1F3E6}", t: "Fully repay an emergency loan", c: "repaid", g: 1 }
];

const achTitle = (p) => { const a = p && p.ach; if (!a || !a.t || !(a.u && a.u[a.t])) return ""; const d = ACH.find((x) => x.id === a.t); return d ? d.i + " " + d.n : ""; };

function ZT(el, p) { const t = achTitle(p); if (!t) return; const s = document.createElement("i"); s.className = "z-title"; s.textContent = t; el.append(" ", s); }

const Ach = {
    bump(add, max) {
        if (!Room.playersRef || !State.username) return; let fresh = [];
        Room.playersRef.child(State.username + "/ach").transaction((a) => {
            a = a || {}; a.c = a.c || {}; a.u = a.u || {}; fresh = [];
            Object.keys(add || {}).forEach((k) => { a.c[k] = (a.c[k] || 0) + add[k]; });
            Object.keys(max || {}).forEach((k) => { a.c[k] = Math.max(a.c[k] || 0, max[k]); });
            ACH.forEach((d) => { if (!a.u[d.id] && (a.c[d.c] || 0) >= d.g) { a.u[d.id] = Date.now(); fresh.push(d); } });
            if (fresh.length && !a.t) a.t = fresh[0].id;
            return a;
        }, (err, ok) => { if (!err && ok) fresh.forEach((d) => { Notify.success(`Achievement unlocked: ${d.i} ${d.n}`); Sound.fanfare(); Audit.log("achv", `Unlocked "${d.n}"`); }); }, false);
    }
};

PubSub.on("round-resolved", ({ entries }) => {
    const e = (entries || []).find((x) => x.username === State.username && x.wager > 0); if (!e) return;
    const profit = e.payout - e.wager, won = profit > 0, me = Room.get(State.username) || {}, cs = ((me.ach || {}).c || {}).cs || 0;
    Ach.bump({ rounds: 1, wins: won ? 1 : 0, big: profit >= Audit.BIG ? 1 : 0 }, { streak: won ? cs + 1 : 0 });
    Room.playersRef.child(State.username + "/ach/c/cs").set(won ? cs + 1 : e.payout < e.wager ? 0 : cs);
    if (profit >= Audit.BIG) Audit.log("bigwin", `Won ${fmt(profit)} chips profit`, profit);
    if (won && Bank.loan() > 0) Bank.repay(Math.floor(profit * 0.3), true);
});

/* ---------- Rewards panel: Missions | Lucky Spin | Achievements | Bank ---------- */
const SEG = [25, 50, 75, 100, 150, 250, 500, 1000], WT = [24, 22, 18, 14, 10, 7, 4, 1];

const Rewards = {
    tab: "missions", spinning: false,
    init() {
        const card = document.querySelector("#px-missions .px-card"), h = card.querySelector("h2"), head = $z("px-qhead");
        h.textContent = "\u{1F3AF} Daily Missions & Rewards";
        const tabs = document.createElement("div"); tabs.className = "mx-tabs"; tabs.id = "z-tabs";
        tabs.innerHTML = [["missions", "Missions"], ["spin", "Lucky Spin"], ["ach", "Titles"], ["bank", "Bank"]].map(([k, l]) => `<button type="button" class="mx-tab" data-z="${k}">${l}</button>`).join("");
        h.after(tabs);
        const pane = document.createElement("div"); pane.id = "z-pane"; pane.hidden = true; $z("px-qlist").after(pane);
        tabs.addEventListener("click", (e) => { const b = e.target.closest("[data-z]"); if (b) { this.tab = b.dataset.z; this.render(true); } });
        pane.addEventListener("click", (e) => this.click(e));
        $z("btn-missions").addEventListener("click", () => this.render(true));
        PubSub.on("players-updated", () => this.render(false));
        this.render(true);
    },
    render(full) {
        const m = this.tab === "missions", pane = $z("z-pane"); if (!pane) return;
        $z("px-qhead").hidden = !m; $z("px-qlist").hidden = !m; pane.hidden = m;
        $z("z-tabs").querySelectorAll("[data-z]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.z === this.tab)));
        if (m || $z("px-missions").hidden) return;
        if (this.tab === "spin") this.spinUi(full); else if (this.tab === "ach") this.achUi(); else this.bankUi();
    },
    me() { return Room.get(State.username) || {}; },
    spun() { return (this.me().spin || {})[zday()]; },
    spinUi(full) {
        const pane = $z("z-pane");
        if (!$z("z-wheel") || full && !this.spinning) {
            const cols = SEG.map((_, i) => `${i % 2 ? "#6b4b0a" : "#161a22"} ${i * 45}deg ${(i + 1) * 45}deg`).join(",");
            pane.innerHTML = `<div class="z-wheel-wrap"><i class="z-ptr"></i><div id="z-wheel" class="z-wheel" style="background:conic-gradient(${cols})">${SEG.map((v, i) => `<span style="transform:translate(-50%,-50%) rotate(${i * 45 + 22.5}deg) translateY(-86px)">${v}</span>`).join("")}<b class="z-hub">\u{1F451}</b></div></div>
             <button type="button" class="btn btn-primary btn-block" id="z-spin-go"></button><p class="mx-hint" id="z-spin-msg" style="text-align:center"></p>`;
        }
        const done = this.spun(), b = $z("z-spin-go");
        b.disabled = !!done || this.spinning; b.textContent = done ? "Come back tomorrow" : "Spin the wheel (free daily)";
        $z("z-spin-msg").textContent = done ? `Today's prize: ${fmt(done.p)} chips` : "One free spin per day. Prizes from 25 to 1,000 chips.";
    },
    spin() {
        if (this.spinning || this.spun() || !State.username) return;
        let r = Math.random() * 100, idx = 0; for (; idx < SEG.length - 1; idx++) { if ((r -= WT[idx]) < 0) break; }
        const prize = SEG[idx]; this.spinning = true; $z("z-spin-go").disabled = true;
        Room.playersRef.child(State.username + "/spin/" + zday()).transaction((v) => (v ? undefined : { p: prize, ts: Date.now() }), (e, ok) => {
            if (e || !ok) { this.spinning = false; return Notify.warning("You already spun today."); }
            Room.applyRound(State.username, { balance: prize });
            const w = $z("z-wheel"), turn = 360 * 6 - (idx * 45 + 22.5);
            w.style.transition = "transform 4.6s cubic-bezier(.12,.62,.1,1)"; w.style.transform = `rotate(${turn}deg)`;
            for (let k = 0; k < 18; k++) window.setTimeout(() => Sound.tick(k), 150 + 4400 * (1 - Math.pow(1 - k / 18, 2)));
            window.setTimeout(() => {
                this.spinning = false; Sound.fanfare(); Fx.celebrate(); Notify.success(`Daily Spin: +${fmt(prize)} chips!`);
                Ach.bump({ spins: 1 }); if (prize >= 500) Audit.log("spin", `Won ${fmt(prize)} on the Daily Spin`, prize); this.render(false);
            }, 4800);
        }, false);
    },
    achUi() {
        const a = this.me().ach || {}, c = a.c || {}, u = a.u || {};
        $z("z-pane").innerHTML = `<p class="mx-hint">Unlock achievements, then tap one to wear it as your title in room lists.</p>` + ACH.map((d) => {
            const got = !!u[d.id], p = Math.min(d.g, c[d.c] || 0);
            return `<div class="px-row ${got ? "done" : ""}"><span>${d.i}</span><span><b>${d.n}</b><br><small>${d.t} \u00B7 ${fmt(p)}/${fmt(d.g)}</small><div class="px-bar"><i style="width:${p / d.g * 100}%"></i></div></span>${got ? `<button type="button" class="btn btn-small ${a.t === d.id ? "btn-primary" : "btn-secondary"}" data-title="${d.id}">${a.t === d.id ? "Worn" : "Wear"}</button>` : "<small>\u{1F512}</small>"}</div>`;
        }).join("");
    },
    bankUi() {
        const c = Bank.cfg(), q = Bank.mine(), owed = Bank.loan(), pend = q && q.st === "pending";
        const opts = [100, 250, c.max].filter((v, i, s) => v <= c.max && s.indexOf(v) === i);
        $z("z-pane").innerHTML = `<div class="z-bank"><div><small>Bank reserve</small><b>${fmt(Bank.res())}</b></div><div><small>Interest</small><b>${c.rate}%</b></div><div><small>You owe</small><b>${fmt(owed)}</b></div></div>
           <p class="mx-hint">${c.on ? `Out of chips? Request a small emergency loan (max ${fmt(c.max)}). The host approves it; 30% of your winnings repay it automatically.` : "The Central Bank is currently closed."}</p>
           ${q ? `<div class="px-row"><span>\u{1F4DD}</span><span>Last request: ${fmt(q.amt)} chips \u2014 <b>${q.st}</b></span></div>` : ""}
           ${owed ? `<button type="button" class="btn btn-secondary btn-block" data-repay="1">Repay now (${fmt(Math.min(owed, State.balance))})</button>` : ""}
           ${c.on && !owed && !pend ? `<div class="mx-tools"><select id="z-loan-amt">${opts.map((v) => `<option>${v}</option>`).join("")}</select><button type="button" class="btn btn-primary" data-loan="1" ${State.balance > 0 ? "disabled" : ""}>${State.balance > 0 ? "Only at 0 chips" : "Request loan"}</button></div>` : ""}`;
    },
    click(e) {
        const t = e.target.closest("button"); if (!t || t.disabled) return;
        if (t.id === "z-spin-go") this.spin();
        else if (t.dataset.title) Room.playersRef.child(State.username + "/ach/t").set(t.dataset.title);
        else if (t.dataset.loan) Bank.request(Number($z("z-loan-amt").value));
        else if (t.dataset.repay) Bank.repay(Bank.loan());
    }
};
