/* =========================================================================
   CASINO CAMPUS — APPLICATION SCRIPT
   Vanilla JavaScript (ES6+). No local backend, no Node.js server, no
   dedicated hosting required — this file can be opened directly or served
   from any static host (e.g. GitHub Pages).

   MULTIPLAYER ARCHITECTURE
   One device creates a "Room" (becoming its Host/Administrator) backed by
   a Firebase Realtime Database project whose config is hardcoded in this
   file (no configuration screens, no server code of any kind is written or
   run by this app). Other devices join that room with
   a room code or shared link and see the same players, balances and
   leaderboard update live. Only the device that created the room keeps
   access to the Administrator Panel; everyone else only sees the player
   lobby and game tables.
   ========================================================================= */
"use strict";

(() => {

    /* =========================================================================
       0. CONFIG
       ========================================================================= */
    const CONFIG = {
        SETTINGS_KEY: "casinoCampus.settings.v1",
        // Hardcoded Firebase project: every user connects automatically.
        FIREBASE_CONFIG: Object.freeze({
            apiKey: "AIzaSyDPkX9ivTDeeuPl_PU2c9jWGnuJQO2vPOg",
            authDomain: "campuscasino-1f8d2.firebaseapp.com",
            databaseURL: "https://campuscasino-1f8d2-default-rtdb.firebaseio.com",
            projectId: "campuscasino-1f8d2",
            storageBucket: "campuscasino-1f8d2.firebasestorage.app",
            messagingSenderId: "235148370786",
            appId: "1:235148370786:web:341f36c2fb69eea46fc23b"
        }),
        DEVICE_ID_KEY: "casinoCampus.deviceId.v1",
        ADMIN_CODE: "admin123",       // Change this code to re-lock the Administrator Panel
        LEADERBOARD_LIMIT: 15,
        BIG_WIN_THRESHOLD: 250        // Minimum payout (chips) that triggers the celebration
    };

    /* =========================================================================
       1. LOCAL DEVICE / SETTINGS STORAGE
       Only used for: this device's identity (to prove Host ownership) and
       the sound toggle.
       No player data or balances are ever stored locally — the Realtime
       Database room is always the single source of truth.
       ========================================================================= */
    const Storage = {
        getDeviceId() {
            try {
                let id = window.localStorage.getItem(CONFIG.DEVICE_ID_KEY);
                if (!id) {
                    id = "dev-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
                    window.localStorage.setItem(CONFIG.DEVICE_ID_KEY, id);
                }
                return id;
            } catch (err) {
                // Storage unavailable (private mode, etc.) — fall back to a session-only id.
                if (!window.__casinoCampusSessionDeviceId) {
                    window.__casinoCampusSessionDeviceId = "dev-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
                }
                return window.__casinoCampusSessionDeviceId;
            }
        },


        loadSettings() {
            try {
                const raw = window.localStorage.getItem(CONFIG.SETTINGS_KEY);
                return raw ? JSON.parse(raw) : { soundEnabled: true };
            } catch (err) {
                return { soundEnabled: true };
            }
        },

        saveSettings(settings) {
            try {
                window.localStorage.setItem(CONFIG.SETTINGS_KEY, JSON.stringify(settings));
            } catch (err) {
                console.error("Storage.saveSettings error:", err);
            }
        }
    };

    /* =========================================================================
       2. URL / CONFIG ENCODING HELPERS (for shareable join links)
       ========================================================================= */
    const LinkUtils = {
        readParams() {
            const room = new URLSearchParams(window.location.search).get("room");
            return { room: room ? room.toUpperCase().replace(/[^A-Z0-9]/g, "") : null };
        },

        buildShareLink(roomCode) {
            const url = new URL(window.location.href);
            url.search = "";
            url.hash = "";
            url.searchParams.set("room", roomCode);
            return url.toString();
        }
    };

    /* =========================================================================
       3. NETWORK / ROOM LAYER (Firebase Realtime Database)
       This is the only synchronization layer in the app. It replaces the
       single-device localStorage player list from earlier versions with a
       shared, real-time "rooms/{code}" node that every connected browser
       reads and writes to directly (peer devices never talk to each other
       or to any server code we host — Firebase's managed backend is the
       whole "backend").
       ========================================================================= */
    const Room = {
        app: null,
        db: null,
        code: null,
        metaRef: null,
        playersRef: null,
        playersCache: {},
        listenersBound: false,
        onPlayersChange: null,

        isConfigured() {
            return !!this.db;
        },

        /** Initializes (or re-initializes) the Firebase app with the given config. */
        connect(configObj) {
            if (!window.firebase) {
                throw new Error("Firebase SDK failed to load. Check your internet connection.");
            }
            if (this.app) {
                try { this.app.delete(); } catch (err) { /* ignore */ }
                this.app = null;
            }
            this.app = window.firebase.initializeApp(configObj, "casinoCampus-" + Date.now());
            this.db = this.app.database();
            ConnectionStatus.bind(this.db);
            return this.db;
        },

        generateRoomCode() {
            const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous 0/O/1/I
            let code = "";
            for (let i = 0; i < 6; i += 1) {
                code += chars[Math.floor(Math.random() * chars.length)];
            }
            return code;
        },

        /** Creates a brand-new room and marks this device as its Host. */
        async createRoom() {
            let code = null;
            for (let attempt = 0; attempt < 6; attempt += 1) {
                const candidate = this.generateRoomCode();
                const snap = await this.db.ref(`rooms/${candidate}/meta`).once("value");
                if (!snap.exists()) {
                    code = candidate;
                    break;
                }
            }
            if (!code) throw new Error("Could not generate a free room code. Please try again.");

            const deviceId = Storage.getDeviceId();
            await this.db.ref(`rooms/${code}/meta`).set({
                hostDeviceId: deviceId,
                createdAt: window.firebase.database.ServerValue.TIMESTAMP,
                roomCode: code
            });

            this.code = code;
            this.attachListeners();
            return code;
        },

        /** Joins an existing room by code. Returns the room's meta object. */
        async joinRoom(code) {
            const normalized = String(code).trim().toUpperCase();
            const snap = await this.db.ref(`rooms/${normalized}/meta`).once("value");
            if (!snap.exists()) {
                throw new Error("Room not found. Double-check the code with your host.");
            }
            this.code = normalized;
            this.attachListeners();
            return snap.val();
        },

        attachListeners() {
            this.detachListeners();
            this.metaRef = this.db.ref(`rooms/${this.code}/meta`);
            this.playersRef = this.db.ref(`rooms/${this.code}/players`);
            this.onPlayersChange = (snap) => {
                this.playersCache = snap.val() || {};
                PubSub.emit("players-updated", this.playersCache);
            };
            this.playersRef.on("value", this.onPlayersChange);
            this.listenersBound = true;
        },

        detachListeners() {
            if (this.playersRef && this.onPlayersChange) {
                this.playersRef.off("value", this.onPlayersChange);
            }
            this.metaRef = null;
            this.playersRef = null;
            this.playersCache = {};
            this.listenersBound = false;
        },

        disconnect() {
            this.detachListeners();
            this.code = null;
            if (this.app) {
                try { this.app.delete(); } catch (err) { /* ignore */ }
            }
            this.app = null;
            this.db = null;
            ConnectionStatus.setOffline();
        },

        list() {
            return Object.values(this.playersCache);
        },

        get(username) {
            return this.playersCache[username] || null;
        },

        exists(username) {
            return Object.prototype.hasOwnProperty.call(this.playersCache, username);
        },

        /** Atomically creates a player if the username is free in this room. */
        createPlayer(username, startingChips) {
            const now = Date.now();
            return this.playersRef.child(username).transaction((current) => {
                if (current !== null) return; // abort — username already taken
                return {
                    username,
                    balance: startingChips,
                    createdAt: now,
                    updatedAt: now,
                    deviceId: Storage.getDeviceId(),
                    stats: { gamesPlayed: 0, totalWagered: 0, netProfit: 0 }
                };
            });
        },

        /** Persists an absolute balance plus an optional incremental stats patch. */
        persistPlayer(username, balance, statsPatch) {
            if (!this.playersRef) return Promise.resolve();
            return this.playersRef.child(username).transaction((player) => {
                if (!player) return player;
                player.balance = Math.max(0, Math.round(balance));
                player.updatedAt = Date.now();
                if (statsPatch) {
                    player.stats = player.stats || { gamesPlayed: 0, totalWagered: 0, netProfit: 0 };
                    player.stats.gamesPlayed = (player.stats.gamesPlayed || 0) + (statsPatch.gamesPlayed || 0);
                    player.stats.totalWagered = (player.stats.totalWagered || 0) + (statsPatch.totalWagered || 0);
                    player.stats.netProfit = (player.stats.netProfit || 0) + (statsPatch.netProfit || 0);
                }
                return player;
            });
        },

        setBalance(username, balance) {
            if (!this.playersRef) return Promise.resolve();
            return this.playersRef.child(username).update({ balance: Math.max(0, Math.round(balance)), updatedAt: Date.now() });
        },

        deletePlayer(username) {
            if (!this.playersRef) return Promise.resolve();
            return this.playersRef.child(username).remove();
        },

        deleteAllPlayers() {
            if (!this.playersRef) return Promise.resolve();
            return this.playersRef.remove();
        },

        importPlayers(playersObj) {
            if (!this.playersRef) return Promise.resolve();
            return this.playersRef.update(playersObj);
        }
    };

    /** Minimal event bus used to decouple the Room listener from UI modules. */
    const PubSub = {
        handlers: {},
        on(event, fn) {
            (this.handlers[event] = this.handlers[event] || []).push(fn);
        },
        emit(event, payload) {
            (this.handlers[event] || []).forEach((fn) => fn(payload));
        }
    };

    const ConnectionStatus = {
        dotEl: null,
        textEl: null,

        init(dotEl, textEl) {
            this.dotEl = dotEl;
            this.textEl = textEl;
        },

        bind(db) {
            db.ref(".info/connected").on("value", (snap) => {
                if (snap.val() === true) this.setOnline();
                else this.setOffline();
            });
        },

        setOnline() {
            if (!this.dotEl) return;
            this.dotEl.classList.add("is-online");
            this.textEl.textContent = "Connected to Firebase";
        },

        setOffline() {
            if (!this.dotEl) return;
            this.dotEl.classList.remove("is-online");
            this.textEl.textContent = "Not connected";
        }
    };

    /* =========================================================================
       4. GLOBAL STATE (active session in this browser tab)
       ========================================================================= */
    const State = {
        username: "",
        balance: 0,
        roomCode: "",
        isHost: false,
        applyingRemoteUpdate: false,

        setBalance(newBalance, { persist = true } = {}) {
            this.balance = Math.max(0, Math.round(newBalance));
            HUD.update();
            if (persist && this.username && !this.applyingRemoteUpdate) {
                Room.persistPlayer(this.username, this.balance);
            }
        },

        canAfford(amount) {
            return Number.isFinite(amount) && amount > 0 && amount <= this.balance;
        },

        debit(amount) {
            this.setBalance(this.balance - amount);
        },

        credit(amount) {
            this.setBalance(this.balance + amount);
        },

        /** Records the outcome of a round for this player's room-wide stats. */
        recordRound(wager, payout) {
            if (!this.username) return;
            const fee = Jackpot.rake(wager); // 2% vault contribution, taken from the player
            Room.persistPlayer(this.username, this.balance, {
                gamesPlayed: 1,
                totalWagered: wager,
                netProfit: payout - wager - fee
            });
        },

        reset() {
            this.username = "";
            this.balance = 0;
        }
    };

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
        playerCards: document.getElementById("player-cards"),
        playerScore: document.getElementById("player-score"),
        inputBlackjackBet: document.getElementById("input-blackjack-bet"),
        btnBlackjackDeal: document.getElementById("btn-blackjack-deal"),
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
        reelSymbols: [
            document.getElementById("reel-1-symbol"),
            document.getElementById("reel-2-symbol"),
            document.getElementById("reel-3-symbol")
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
            const settings = Storage.loadSettings();
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
            Storage.saveSettings({ soundEnabled: this.enabled });
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
            DOM.displayAvatar.textContent = State.username ? State.username.slice(0, 2).toUpperCase() : "--";
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
       12. CARD / DECK UTILITIES (shared by Blackjack and Hi-Lo)
       ========================================================================= */
    const Deck = {
        SUITS: ["\u2660", "\u2665", "\u2666", "\u2663"],
        RANKS: ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"],

        createShuffled() {
            const deck = [];
            for (const suit of this.SUITS) {
                for (const rank of this.RANKS) {
                    deck.push({ rank, suit });
                }
            }
            for (let i = deck.length - 1; i > 0; i -= 1) {
                const j = Math.floor(Math.random() * (i + 1));
                [deck[i], deck[j]] = [deck[j], deck[i]];
            }
            return deck;
        },

        isRedSuit(suit) {
            return suit === "\u2665" || suit === "\u2666";
        },

        numericValue(rank) {
            if (rank === "A") return 14;
            if (rank === "K") return 13;
            if (rank === "Q") return 12;
            if (rank === "J") return 11;
            return Number.parseInt(rank, 10);
        }
    };

    /* =========================================================================
       13. BLACKJACK
       ========================================================================= */
    const Blackjack = {
        deck: [],
        playerHand: [],
        dealerHand: [],
        bet: 0,
        roundActive: false,

        init() {
            DOM.btnBlackjackDeal.addEventListener("click", () => this.deal());
            DOM.btnBlackjackHit.addEventListener("click", () => this.hit());
            DOM.btnBlackjackStand.addEventListener("click", () => this.stand());
        },

        score(hand) {
            let total = 0;
            let aceCount = 0;

            for (const card of hand) {
                if (card.rank === "A") {
                    total += 11;
                    aceCount += 1;
                } else if (["K", "Q", "J"].includes(card.rank)) {
                    total += 10;
                } else {
                    total += Number.parseInt(card.rank, 10);
                }
            }
            while (total > 21 && aceCount > 0) {
                total -= 10;
                aceCount -= 1;
            }
            return total;
        },

        renderCard(container, card, isNew) {
            const cardEl = document.createElement("div");
            cardEl.className = "card" + (isNew ? " card-deal-in" : "");
            cardEl.textContent = `${card.rank}${card.suit}`;
            cardEl.classList.add(Deck.isRedSuit(card.suit) ? "card-red" : "card-black");
            container.appendChild(cardEl);
        },

        renderHiddenCard(container) {
            const cardEl = document.createElement("div");
            cardEl.className = "card card-back card-deal-in";
            container.appendChild(cardEl);
        },

        renderHands(hideDealerHole) {
            DOM.playerCards.innerHTML = "";
            DOM.dealerCards.innerHTML = "";

            this.playerHand.forEach((card) => this.renderCard(DOM.playerCards, card, false));
            DOM.playerScore.textContent = `Score: ${this.score(this.playerHand)}`;

            this.dealerHand.forEach((card, index) => {
                if (hideDealerHole && index === 1) {
                    this.renderHiddenCard(DOM.dealerCards);
                } else {
                    this.renderCard(DOM.dealerCards, card, false);
                }
            });
            DOM.dealerScore.textContent = hideDealerHole ? "Score: ?" : `Score: ${this.score(this.dealerHand)}`;
        },

        setControlsDuringRound(inRound) {
            DOM.btnBlackjackDeal.disabled = inRound;
            DOM.btnBlackjackHit.disabled = !inRound;
            DOM.btnBlackjackStand.disabled = !inRound;
            DOM.inputBlackjackBet.disabled = inRound;
        },

        deal() {
            if (this.roundActive) return;

            const bet = Validate.parseBet(DOM.inputBlackjackBet);
            if (bet === null) return;

            this.bet = bet;
            State.debit(bet);
            Sound.click();

            this.deck = Deck.createShuffled();
            this.playerHand = [this.deck.pop(), this.deck.pop()];
            this.dealerHand = [this.deck.pop(), this.deck.pop()];
            this.roundActive = true;

            DOM.blackjackResult.textContent = "";
            this.renderHands(true);
            this.setControlsDuringRound(true);

            if (this.score(this.playerHand) === 21) {
                this.stand();
            }
        },

        hit() {
            if (!this.roundActive) return;

            this.playerHand.push(this.deck.pop());
            const playerTotal = this.score(this.playerHand);
            this.renderHands(true);

            if (playerTotal > 21) {
                this.finishRound("bust");
            }
        },

        stand() {
            if (!this.roundActive) return;

            while (this.score(this.dealerHand) < 17) {
                this.dealerHand.push(this.deck.pop());
            }
            this.renderHands(false);
            this.finishRound("compare");
        },

        finishRound(outcomeType) {
            const playerTotal = this.score(this.playerHand);
            const dealerTotal = this.score(this.dealerHand);
            const isNaturalBlackjack = playerTotal === 21 && this.playerHand.length === 2;

            this.renderHands(false);
            this.setControlsDuringRound(false);
            this.roundActive = false;

            let payout = 0;

            if (outcomeType === "bust") {
                DOM.blackjackResult.textContent = `You busted. Lost ${this.bet} chips.`;
                Notify.error(`Blackjack: busted with ${playerTotal}. Lost ${this.bet} chips.`);
                Sound.lose();
            } else if (isNaturalBlackjack) {
                payout = Math.round(this.bet * 2.5);
                State.credit(payout);
                DOM.blackjackResult.textContent = `Blackjack! You won ${payout} chips.`;
                Notify.success(`Natural blackjack! Won ${payout} chips.`);
                Sound.win();
                if (payout >= CONFIG.BIG_WIN_THRESHOLD) Effects.celebrate(`BLACKJACK! +${payout} chips`);
            } else if (dealerTotal > 21 || playerTotal > dealerTotal) {
                payout = this.bet * 2;
                State.credit(payout);
                DOM.blackjackResult.textContent = `You won! ${playerTotal} vs ${dealerTotal}. Won ${payout} chips.`;
                Notify.success(`Blackjack won. Payout: ${payout} chips.`);
                Sound.win();
                if (payout >= CONFIG.BIG_WIN_THRESHOLD) Effects.celebrate(`YOU WON! +${payout} chips`);
            } else if (playerTotal === dealerTotal) {
                payout = this.bet;
                State.credit(payout);
                DOM.blackjackResult.textContent = `Push. Both have ${playerTotal}. Bet returned.`;
                Notify.warning("Blackjack: push, bet returned.");
            } else {
                DOM.blackjackResult.textContent = `Dealer wins, ${dealerTotal} vs ${playerTotal}. Lost ${this.bet} chips.`;
                Notify.error(`Blackjack lost: ${this.bet} chips.`);
                Sound.lose();
            }

            State.recordRound(this.bet, payout);
        }
    };

    /* =========================================================================
       14. ROULETTE
       ========================================================================= */
    const Roulette = {
        RED_NUMBERS: new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]),
        selectedChip: 10,
        selection: null,
        isSpinning: false,
        wheelRotation: 0,

        // Standard European wheel order, clockwise, starting at 0.
        WHEEL_ORDER: [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10,
            5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26],

        init() {
            this.buildWheel();
            this.buildNumberBoard();
            this.bindChipButtons();
            this.bindOutsideBets();
            DOM.btnRouletteSpin.addEventListener("click", () => this.spin());
            DOM.btnRouletteClear.addEventListener("click", () => this.clearSelection());
            this.updateBetDisplay();
        },

        /* Draws the wheel as SVG. Slot i is centred at i * step degrees clockwise
           from 12 o'clock when the wheel is unrotated, so the green 0 sits under
           the pointer at rest. Every European number (0-36) is printed in its pocket. */
        buildWheel() {
            const NS = "http://www.w3.org/2000/svg";
            const count = this.WHEEL_ORDER.length, step = 360 / count, cx = 100, cy = 100;
            const pt = (deg, r) => {
                const rad = (deg * Math.PI) / 180;
                return [(cx + r * Math.sin(rad)).toFixed(3), (cy - r * Math.cos(rad)).toFixed(3)];
            };
            const el = (name, attrs) => {
                const n = document.createElementNS(NS, name);
                Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, v));
                return n;
            };
            const svg = el("svg", { viewBox: "0 0 200 200", class: "roulette-wheel-svg", "aria-hidden": "true" });
            svg.appendChild(el("circle", { cx, cy, r: 100, fill: "#b8860b" }));
            const R1 = 95, R0 = 52;
            this.WHEEL_ORDER.forEach((number, i) => {
                const [ax, ay] = pt((i - 0.5) * step, R1), [bx, by] = pt((i + 0.5) * step, R1);
                const [cx2, cy2] = pt((i + 0.5) * step, R0), [dx, dy] = pt((i - 0.5) * step, R0);
                svg.appendChild(el("path", {
                    d: `M ${dx} ${dy} L ${ax} ${ay} A ${R1} ${R1} 0 0 1 ${bx} ${by} L ${cx2} ${cy2} A ${R0} ${R0} 0 0 0 ${dx} ${dy} Z`,
                    class: `rw-slice rw-${this.colorOf(number)}`, "data-n": String(number)
                }));
                const label = el("text", { x: cx, y: cy - 81, transform: `rotate(${(i * step).toFixed(4)} ${cx} ${cy})`, class: "rw-label" });
                label.textContent = String(number);
                svg.appendChild(label);
            });
            svg.appendChild(el("circle", { cx, cy, r: R0 - 2, fill: "#1a130a", stroke: "#e9c46a", "stroke-width": 2 }));
            svg.appendChild(el("circle", { cx, cy, r: 9, fill: "#e9c46a" }));
            DOM.rouletteWheel.textContent = "";
            DOM.rouletteWheel.appendChild(svg);
        },

        /* Reads the pocket that is under the top pointer for a given rotation. This
           is the single source of truth: the payout uses this number, so the
           picture and the result cannot disagree. */
        numberAtPointer(rotation) {
            const count = this.WHEEL_ORDER.length, step = 360 / count;
            const a = (((-rotation) % 360) + 360) % 360;
            return this.WHEEL_ORDER[Math.round(a / step) % count];
        },

        animateTo(from, to, ms, done) {
            const t0 = performance.now(), el = DOM.rouletteWheel;
            const tick = (now) => {
                const p = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - p, 4);
                this.wheelRotation = p < 1 ? from + (to - from) * e : to;
                el.style.transform = `rotate(${this.wheelRotation}deg)`;
                if (p < 1) window.requestAnimationFrame(tick); else done();
            };
            window.requestAnimationFrame(tick);
        },

        colorOf(number) {
            if (number === 0) return "green";
            return this.RED_NUMBERS.has(number) ? "red" : "black";
        },

        buildNumberBoard() {
            for (let number = 0; number <= 36; number += 1) {
                const cell = document.createElement("button");
                cell.type = "button";
                cell.className = "roulette-number-cell";
                cell.textContent = String(number);
                cell.dataset.number = String(number);

                const color = this.colorOf(number);
                if (color === "red") cell.classList.add("is-red");
                if (color === "black") cell.classList.add("is-black");

                cell.addEventListener("click", () => this.selectBet({ type: "number", value: number }, cell));
                DOM.rouletteNumbers.appendChild(cell);
            }
        },

        bindChipButtons() {
            const chipButtons = DOM.chipPanel.querySelectorAll(".chip-btn");
            chipButtons.forEach((chip) => {
                chip.addEventListener("click", () => {
                    chipButtons.forEach((c) => c.classList.remove("is-selected"));
                    chip.classList.add("is-selected");
                    this.selectedChip = Number.parseInt(chip.dataset.chipValue, 10);
                    this.updateBetDisplay();
                    Sound.click();
                });
            });
            chipButtons[0]?.classList.add("is-selected");
        },

        bindOutsideBets() {
            document.querySelectorAll(".roulette-color-bet").forEach((btn) => {
                btn.addEventListener("click", () => this.selectBet({ type: "color", value: btn.dataset.color }, btn));
            });
            document.querySelectorAll(".roulette-parity-bet").forEach((btn) => {
                btn.addEventListener("click", () => this.selectBet({ type: "parity", value: btn.dataset.parity }, btn));
            });
        },

        selectBet(selection, element) {
            if (this.isSpinning) return;

            document.querySelectorAll(".roulette-number-cell.is-selected").forEach((el) => el.classList.remove("is-selected"));
            document.querySelectorAll(".roulette-color-bet.is-active, .roulette-parity-bet.is-active")
                .forEach((el) => el.classList.remove("is-active"));

            element.classList.add(element.classList.contains("roulette-number-cell") ? "is-selected" : "is-active");
            this.selection = selection;
            this.updateBetDisplay();
            Sound.click();
        },

        clearSelection() {
            if (this.isSpinning) return;
            this.selection = null;
            document.querySelectorAll(".roulette-number-cell.is-selected").forEach((el) => el.classList.remove("is-selected"));
            document.querySelectorAll(".roulette-color-bet.is-active, .roulette-parity-bet.is-active")
                .forEach((el) => el.classList.remove("is-active"));
            this.updateBetDisplay();
            DOM.rouletteResult.textContent = "";
        },

        updateBetDisplay() {
            if (!this.selection) {
                DOM.inputRouletteBet.value = `Selection: none (chip ${this.selectedChip})`;
                return;
            }
            const labels = { number: "number", color: "color", parity: "parity" };
            DOM.inputRouletteBet.value = `${labels[this.selection.type]}: ${this.selection.value} \u2014 chip ${this.selectedChip}`;
        },

        spin() {
            if (this.isSpinning) return;
            if (!this.selection) { Notify.error("Choose a number, color or parity before spinning."); return; }
            if (!State.canAfford(this.selectedChip)) { Notify.error("You don't have enough chips for that bet."); return; }

            State.debit(this.selectedChip);
            this.isSpinning = true;
            DOM.btnRouletteSpin.disabled = true;
            DOM.rouletteResult.textContent = "";
            DOM.rouletteWheel.querySelectorAll(".rw-win").forEach((n) => n.classList.remove("rw-win"));

            // Choose the slot, then rotate so that slot's centre (+ small jitter that
            // stays inside the pocket) ends exactly under the pointer.
            const count = this.WHEEL_ORDER.length, step = 360 / count;
            const slotIndex = Math.floor(Math.random() * count);
            const jitter = (Math.random() - 0.5) * step * 0.6;
            const cur = ((this.wheelRotation % 360) + 360) % 360;
            const target = (((-(slotIndex * step + jitter)) % 360) + 360) % 360;
            const delta = (((target - cur) % 360) + 360) % 360;
            const from = this.wheelRotation, to = from + 360 * 5 + delta;
            const reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
            const winningNumber = this.numberAtPointer(to);

            this.animateTo(from, to, reduced ? 500 : 4600, () => {
                DOM.rouletteWheel.querySelector(`[data-n="${winningNumber}"]`)?.classList.add("rw-win");
                this.resolveSpin(winningNumber);
            });
        },

        resolveSpin(winningNumber) {
            const winningColor = this.colorOf(winningNumber);
            const bet = this.selectedChip;
            let payout = 0;

            if (this.selection.type === "number" && this.selection.value === winningNumber) {
                payout = bet * 36;
            } else if (this.selection.type === "color" && this.selection.value === winningColor) {
                payout = bet * 2;
            } else if (this.selection.type === "parity" && winningNumber !== 0) {
                const isEven = winningNumber % 2 === 0;
                if ((this.selection.value === "even" && isEven) || (this.selection.value === "odd" && !isEven)) {
                    payout = bet * 2;
                }
            }

            const colorLabels = { red: "red", black: "black", green: "green" };

            if (payout > 0) {
                State.credit(payout);
                DOM.rouletteResult.textContent = `Winning number ${winningNumber} (${colorLabels[winningColor]}). You won ${payout} chips!`;
                Notify.success(`Roulette: ${winningNumber} ${colorLabels[winningColor]}. Won ${payout} chips.`);
                Sound.win();
                if (payout >= CONFIG.BIG_WIN_THRESHOLD) Effects.celebrate(`STRAIGHT UP! +${payout} chips`);
            } else {
                DOM.rouletteResult.textContent = `Winning number ${winningNumber} (${colorLabels[winningColor]}). Lost ${bet} chips.`;
                Notify.error(`Roulette: ${winningNumber} ${colorLabels[winningColor]}. Lost ${bet} chips.`);
                Sound.lose();
            }

            State.recordRound(bet, payout);
            this.isSpinning = false;
            DOM.btnRouletteSpin.disabled = false;
        }
    };

    /* =========================================================================
       14.5 PLAYER WHEEL (multiplayer name-elimination roulette)
       A separate game from the number/color Roulette above: the wheel's
       slices are the room's own players, pulled live from Firebase via
       Room.list(). Spinning never touches the database — it only affects
       an in-memory pool for the current browser tab. Winners can optionally
       be dropped from that in-memory pool for subsequent spins, but they
       always remain full room members.
       ========================================================================= */
    const PlayerWheel = {
        pool: [],            // usernames currently active in this tab's wheel pool
        hasSession: false,   // whether a wheel session has already been started
        isSpinning: false,
        rotation: 0,
        pendingWinner: null,

        init() {
            DOM.btnWheelSpin.addEventListener("click", () => this.spin());
            DOM.btnWheelRestart.addEventListener("click", () => this.restartPool());

            DOM.btnWheelRemove.addEventListener("click", () => this.resolveWinner(true));
            DOM.btnWheelKeep.addEventListener("click", () => this.resolveWinner(false));

            DOM.btnWheelResumeRestart.addEventListener("click", () => this.handleResumeChoice("restart"));
            DOM.btnWheelResumeContinue.addEventListener("click", () => this.handleResumeChoice("continue"));

            // If the Host deletes a player from the room entirely while the wheel
            // is idle, quietly drop them from the pool too (never the reverse —
            // removing someone from the pool must never touch the room roster).
            PubSub.on("players-updated", () => {
                if (!this.hasSession || this.isSpinning) return;
                const roomUsernames = new Set(Room.list().map((p) => p.username));
                const before = this.pool.length;
                this.pool = this.pool.filter((name) => roomUsernames.has(name));
                if (this.pool.length !== before && Router.currentGameKey === "wheel") {
                    this.render();
                }
            });
        },

        /** Called by the Router each time the Player Wheel section is opened. */
        onEnter() {
            if (!this.hasSession) {
                this.startFreshPool();
                DOM.wheelResult.textContent = "";
                this.render();
                return;
            }
            // Returning to the wheel later in the same session — ask first,
            // rather than silently resetting or silently resuming.
            this.openResumeModal();
        },

        startFreshPool() {
            this.pool = Room.list().map((p) => p.username);
            this.hasSession = true;
        },

        restartPool() {
            if (this.isSpinning) return;
            this.startFreshPool();
            DOM.wheelResult.textContent = "";
            this.render();
            Notify.success("Wheel pool reset to all current room players.");
        },

        openResumeModal() {
            const count = this.pool.length;
            DOM.wheelResumeSubtitle.textContent = count > 0
                ? `You left the wheel earlier with ${count} player${count === 1 ? "" : "s"} still in the pool. Continue where you left off, or restart with everyone currently in the room?`
                : "Your previous pool was empty. Restart with everyone currently in the room, or continue with an empty pool.";
            DOM.wheelResumeModal.hidden = false;
        },

        handleResumeChoice(choice) {
            DOM.wheelResumeModal.hidden = true;
            if (choice === "restart") {
                this.startFreshPool();
                Notify.success("Wheel pool reset to all current room players.");
            } else {
                // Continue with the prior pool, only dropping anyone who has since
                // left the room entirely (the pool must never outlive the roster).
                const roomUsernames = new Set(Room.list().map((p) => p.username));
                this.pool = this.pool.filter((name) => roomUsernames.has(name));
            }
            DOM.wheelResult.textContent = "";
            this.render();
        },

        render() {
            const count = this.pool.length;

            DOM.wheelPoolCount.textContent = `${count} player${count === 1 ? "" : "s"} in the pool`;
            DOM.wheelPoolList.innerHTML = "";
            this.pool.forEach((name) => {
                const chip = document.createElement("li");
                chip.className = "wheel-pool-chip";
                chip.textContent = name;
                DOM.wheelPoolList.appendChild(chip);
            });

            DOM.wheelEmptyState.hidden = count > 0;
            DOM.btnWheelSpin.disabled = count < 2;

            DOM.wheelLabels.innerHTML = "";
            if (count === 0) {
                DOM.wheelDial.style.background = "var(--color-felt-dark)";
                return;
            }

            const sliceAngle = 360 / count;
            const stops = [];
            for (let i = 0; i < count; i += 1) {
                const start = i * sliceAngle;
                const end = start + sliceAngle;
                const color = i % 2 === 0 ? "var(--color-felt-light)" : "var(--color-felt-dark)";
                stops.push(`${color} ${start}deg ${end}deg`);
            }
            DOM.wheelDial.style.background = `conic-gradient(${stops.join(", ")})`;

            const radius = DOM.wheelContainer.clientWidth
                ? DOM.wheelContainer.clientWidth / 2 - 16
                : 130;

            // Scale the font down a bit as the pool grows so more names stay legible.
            const fontSizePx = count > 26 ? 10 : count > 18 ? 11 : count > 10 ? 12 : 13;

            this.pool.forEach((name, i) => {
                const angle = i * sliceAngle + sliceAngle / 2; // clockwise from 12 o'clock
                const label = document.createElement("div");
                label.className = "wheel-label";
                label.textContent = name;
                label.style.width = `${radius}px`;
                label.style.fontSize = `${fontSizePx}px`;
                // Pivoting at the label's own left-center (which sits exactly on the
                // wheel's center via top/left:50%) means a single rotate() places
                // each name along its own spoke with no risk of the flip/mirror
                // artifacts a rotate+translate+counter-rotate chain can produce.
                label.style.transform = `rotate(${angle - 90}deg)`;
                DOM.wheelLabels.appendChild(label);
            });
        },

        spin() {
            if (this.isSpinning) return;
            if (this.pool.length < 2) {
                Notify.error("Add at least two players to the pool before spinning.");
                return;
            }

            this.isSpinning = true;
            this.pendingWinner = null;
            DOM.btnWheelSpin.disabled = true;
            DOM.btnWheelRestart.disabled = true;
            DOM.wheelResult.textContent = "";
            DOM.wheelPointer.classList.add("is-spinning");
            Sound.click();

            const count = this.pool.length;
            const sliceAngle = 360 / count;
            const winnerIndex = Math.floor(Math.random() * count);

            // Land the pointer (fixed at the top, 0deg) on the middle of the
            // winning slice, plus several full turns for a smooth, satisfying spin.
            const currentMod = ((this.rotation % 360) + 360) % 360;
            const targetAngle = (360 - (winnerIndex * sliceAngle + sliceAngle / 2)) % 360;
            let delta = targetAngle - currentMod;
            if (delta <= 0) delta += 360;
            this.rotation += 1440 + delta;
            DOM.wheelDial.style.transform = `rotate(${this.rotation}deg)`;

            window.setTimeout(() => this.resolveSpin(winnerIndex), 3200);
        },

        resolveSpin(winnerIndex) {
            const winner = this.pool[winnerIndex];
            this.pendingWinner = winner;
            this.isSpinning = false;
            DOM.btnWheelRestart.disabled = false;
            DOM.wheelPointer.classList.remove("is-spinning");
            DOM.wheelResult.textContent = `The wheel landed on ${winner}.`;
            Sound.win();

            DOM.wheelWinnerName.textContent = winner;
            DOM.wheelWinnerModal.hidden = false;
        },

        /** Applies the Keep/Remove choice from the winner modal. Removal only
         *  ever touches this.pool (the in-tab spin pool) — it never calls
         *  Room.deletePlayer or otherwise reaches the Firebase player list. */
        resolveWinner(remove) {
            DOM.wheelWinnerModal.hidden = true;
            if (this.pendingWinner && remove) {
                this.pool = this.pool.filter((name) => name !== this.pendingWinner);
                Notify.warning(`${this.pendingWinner} was removed from the wheel pool (still a room member).`);
            } else if (this.pendingWinner) {
                Notify.success(`${this.pendingWinner} stays in the wheel pool.`);
            }
            this.pendingWinner = null;
            this.render();
        }
    };

    /* =========================================================================
       15. SLOT MACHINE
       ========================================================================= */
    const Slots = {
        SYMBOLS: ["\u{1F352}", "\u{1F34B}", "\u{1F514}", "\u2B50", "7\uFE0F\u20E3", "\u{1F347}"],
        isSpinning: false,

        init() {
            DOM.btnSlotsSpin.addEventListener("click", () => this.spin());
            DOM.btnSlotsLever.addEventListener("click", () => this.spin());
        },

        randomSymbol() {
            return this.SYMBOLS[Math.floor(Math.random() * this.SYMBOLS.length)];
        },

        spin() {
            if (this.isSpinning) return;

            const bet = Validate.parseBet(DOM.inputSlotsBet);
            if (bet === null) return;

            State.debit(bet);
            this.isSpinning = true;
            DOM.btnSlotsSpin.disabled = true;
            DOM.btnSlotsLever.disabled = true;
            DOM.btnSlotsLever.classList.add("lever-pulled");
            DOM.slotsResult.textContent = "";
            DOM.reels.forEach((reel) => reel.classList.add("is-spinning"));

            window.setTimeout(() => this.resolveSpin(bet), 700);
        },

        resolveSpin(bet) {
            const results = [this.randomSymbol(), this.randomSymbol(), this.randomSymbol()];

            DOM.reels.forEach((reel) => reel.classList.remove("is-spinning"));
            DOM.btnSlotsLever.classList.remove("lever-pulled");
            results.forEach((symbol, index) => {
                DOM.reelSymbols[index].textContent = symbol;
            });

            const [a, b, c] = results;
            let payout = 0;

            if (a === b && b === c) {
                payout = bet * 10;
            } else if (a === b || b === c || a === c) {
                payout = bet * 2;
            }

            if (payout > 0) {
                State.credit(payout);
                DOM.slotsResult.textContent = `${results.join(" ")} \u2014 Winning combination! You won ${payout} chips.`;
                Notify.success(`Slots: won ${payout} chips.`);
                Sound.win();
                if (a === b && b === c) Effects.celebrate(`JACKPOT! +${payout} chips`);
            } else {
                DOM.slotsResult.textContent = `${results.join(" ")} \u2014 No match. Lost ${bet} chips.`;
                Notify.error(`Slots: lost ${bet} chips.`);
                Sound.lose();
            }

            State.recordRound(bet, payout);
            this.isSpinning = false;
            DOM.btnSlotsSpin.disabled = false;
            DOM.btnSlotsLever.disabled = false;
        }
    };

    /* =========================================================================
       16. HI-LO
       ========================================================================= */
    const HiLo = {
        currentCard: null,
        isResolving: false,

        init() {
            this.currentCard = this.drawCard();
            this.renderCurrentCard();
            DOM.btnHiloHigher.addEventListener("click", () => this.guess("higher"));
            DOM.btnHiloLower.addEventListener("click", () => this.guess("lower"));
        },

        drawCard() {
            const rank = Deck.RANKS[Math.floor(Math.random() * Deck.RANKS.length)];
            const suit = Deck.SUITS[Math.floor(Math.random() * Deck.SUITS.length)];
            return { rank, suit, value: Deck.numericValue(rank) };
        },

        renderCurrentCard() {
            DOM.hiloCurrentCard.textContent = `${this.currentCard.rank}${this.currentCard.suit}`;
            DOM.hiloCurrentCard.classList.toggle("card-red", Deck.isRedSuit(this.currentCard.suit));
            DOM.hiloCurrentCard.classList.toggle("card-black", !Deck.isRedSuit(this.currentCard.suit));
            DOM.hiloNextCard.textContent = "?";
            DOM.hiloNextCard.classList.add("hilo-card-hidden");
            DOM.hiloNextCard.classList.remove("card-red", "card-black");
        },

        guess(direction) {
            if (this.isResolving) return;

            const bet = Validate.parseBet(DOM.inputHiloBet);
            if (bet === null) return;

            State.debit(bet);
            this.isResolving = true;
            DOM.hiloResult.textContent = "";

            const nextCard = this.drawCard();
            DOM.hiloNextCard.textContent = `${nextCard.rank}${nextCard.suit}`;
            DOM.hiloNextCard.classList.toggle("card-red", Deck.isRedSuit(nextCard.suit));
            DOM.hiloNextCard.classList.toggle("card-black", !Deck.isRedSuit(nextCard.suit));
            DOM.hiloNextCard.classList.remove("hilo-card-hidden");

            window.setTimeout(() => this.resolveGuess(direction, bet, nextCard), 500);
        },

        resolveGuess(direction, bet, nextCard) {
            const isHigher = nextCard.value > this.currentCard.value;
            const isLower = nextCard.value < this.currentCard.value;
            const guessedCorrectly = (direction === "higher" && isHigher) || (direction === "lower" && isLower);
            const directionLabel = direction === "higher" ? "higher" : "lower";
            let payout = 0;

            if (!isHigher && !isLower) {
                payout = bet;
                State.credit(payout);
                DOM.hiloResult.textContent = `Push on ${nextCard.rank}${nextCard.suit}. Bet returned.`;
                Notify.warning("Hi-Lo: push, bet returned.");
            } else if (guessedCorrectly) {
                payout = bet * 2;
                State.credit(payout);
                DOM.hiloResult.textContent = `Correct! ${nextCard.rank}${nextCard.suit} was ${directionLabel}. You won ${payout} chips.`;
                Notify.success(`Hi-Lo: won ${payout} chips.`);
                Sound.win();
                if (payout >= CONFIG.BIG_WIN_THRESHOLD) Effects.celebrate(`NICE CALL! +${payout} chips`);
            } else {
                DOM.hiloResult.textContent = `Wrong! ${nextCard.rank}${nextCard.suit} was not ${directionLabel}. Lost ${bet} chips.`;
                Notify.error(`Hi-Lo: lost ${bet} chips.`);
                Sound.lose();
            }

            State.recordRound(bet, payout);
            this.currentCard = nextCard;
            this.renderCurrentCard();
            this.isResolving = false;
        }
    };

    /* =========================================================================
       16b. LUCKY DRAW (pick 1-6 winners from the room's live player list)
       Four visual modes. Winners are chosen up-front with an unbiased shuffle
       and the animation is then steered to them. Nothing here writes to the
       database: a draw only reads Room.list().
       ========================================================================= */
    const LuckyDraw = {
        count: 3,
        mode: "slots",
        running: false,
        runId: 0,
        el: {},
        CANCEL: Symbol("cancel"),
        CHIP_COLORS: ["#c0392b", "#1f2933", "#1e7a4c", "#b8860b", "#2b5c9e"],
        IDLE: {
            slots: ["\u{1F3B0}", "Vertical reels spin and brake one by one."],
            bingo: ["\u{1F3B1}", "Spheres tumble in the blower and the tube picks the winners."],
            cards: ["\u{1F0CF}", "The deck is shuffled, then winning cards are dealt and flipped."],
            laser: ["\u{1F52E}", "Chips swirl while a laser pulses to lock in each winner."]
        },

        init() {
            const $ = (id) => document.getElementById(id);
            this.el = {
                stage: $("draw-stage"), podium: $("draw-podium"), result: $("draw-result"),
                start: $("btn-draw-start"), reset: $("btn-draw-reset"), info: $("draw-player-count")
            };
            this.countBtns = Array.from(document.querySelectorAll(".draw-count-btn"));
            this.modeBtns = Array.from(document.querySelectorAll(".draw-mode-btn"));

            this.countBtns.forEach((btn) => btn.addEventListener("click", () => {
                if (this.running) return;
                this.count = Number(btn.dataset.count);
                this.syncButtons();
            }));
            this.modeBtns.forEach((btn) => btn.addEventListener("click", () => {
                if (this.running) return;
                this.mode = btn.dataset.drawMode;
                this.syncButtons();
                this.reset();
            }));
            this.el.start.addEventListener("click", () => this.start());
            this.el.reset.addEventListener("click", () => this.reset());
            PubSub.on("players-updated", () => { if (!this.running) this.updateInfo(); });

            this.syncButtons();
            this.reset();
        },

        /* ----------------------------- helpers ----------------------------- */
        names() { return Room.list().map((p) => p.username).filter(Boolean); },

        shuffle(list) {
            const out = list.slice();
            for (let i = out.length - 1; i > 0; i -= 1) {
                const j = Math.floor(Math.random() * (i + 1));
                [out[i], out[j]] = [out[j], out[i]];
            }
            return out;
        },

        mk(tag, cls, text) {
            const node = document.createElement(tag);
            if (cls) node.className = cls;
            if (text != null) node.textContent = text;
            return node;
        },

        short(name, max = 11) { return name.length > max ? name.slice(0, max - 1) + "\u2026" : name; },

        async wait(ms, id) {
            await new Promise((resolve) => window.setTimeout(resolve, ms));
            if (id !== this.runId) throw this.CANCEL;
        },

        /** rAF loop; fn(dt, elapsed) returns true when finished. Rejects if cancelled. */
        frames(id, fn) {
            return new Promise((resolve, reject) => {
                const t0 = performance.now();
                let last = t0;
                const tick = (now) => {
                    if (id !== this.runId) { reject(this.CANCEL); return; }
                    const dt = Math.min(now - last, 50);
                    last = now;
                    if (fn(dt, now - t0)) { resolve(); return; }
                    window.requestAnimationFrame(tick);
                };
                window.requestAnimationFrame(tick);
            });
        },

        makeCanvas(h) {
            const w = Math.max(260, Math.min(this.el.stage.clientWidth - 32, 480));
            const dpr = window.devicePixelRatio || 1;
            const canvas = document.createElement("canvas");
            canvas.className = "draw-canvas";
            canvas.width = Math.round(w * dpr);
            canvas.height = Math.round(h * dpr);
            canvas.style.width = w + "px";
            canvas.style.height = h + "px";
            const ctx = canvas.getContext("2d");
            ctx.scale(dpr, dpr);
            this.el.stage.replaceChildren(canvas);
            return { ctx, w, h };
        },

        drawChip(ctx, x, y, r, name, color, glow) {
            ctx.save();
            if (glow) { ctx.shadowColor = "#f4c430"; ctx.shadowBlur = 20; }
            ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
            ctx.shadowBlur = 0;
            const lw = Math.max(3, r * 0.22);
            ctx.lineWidth = lw; ctx.strokeStyle = "rgba(255,255,255,.9)"; ctx.setLineDash([r * 0.35, r * 0.3]);
            ctx.beginPath(); ctx.arc(x, y, r - lw / 2, 0, Math.PI * 2); ctx.stroke();
            ctx.setLineDash([]);
            ctx.beginPath(); ctx.arc(x, y, r * 0.68, 0, Math.PI * 2);
            ctx.fillStyle = "rgba(0,0,0,.3)"; ctx.fill();
            ctx.lineWidth = 1.5; ctx.strokeStyle = "rgba(255,255,255,.55)"; ctx.stroke();
            ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
            ctx.font = `700 ${Math.max(8, r * 0.4)}px "Segoe UI", Arial, sans-serif`;
            ctx.fillText(this.short(name), x, y, r * 1.25);
            ctx.restore();
        },

        /* ------------------------------ state ------------------------------ */
        syncButtons() {
            this.countBtns.forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.count) === this.count)));
            this.modeBtns.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.drawMode === this.mode)));
        },

        setBusy(busy) {
            this.countBtns.concat(this.modeBtns).forEach((b) => { b.disabled = busy; });
            this.el.start.disabled = busy || this.names().length === 0;
        },

        updateInfo() {
            const n = this.names().length;
            this.el.info.textContent = n ? `${n} player${n === 1 ? "" : "s"} in the pool` : "No players in this room yet.";
            this.el.start.disabled = this.running || n === 0;
        },

        renderIdle() {
            const [icon, text] = this.IDLE[this.mode];
            const box = this.mk("div", "draw-idle");
            box.append(this.mk("div", "draw-idle-icon", icon), this.mk("p", "", text));
            this.el.stage.replaceChildren(box);
        },

        onEnter() { if (!this.running) this.updateInfo(); },

        reset() {
            this.runId += 1;
            this.running = false;
            this.setBusy(false);
            this.el.podium.replaceChildren();
            this.el.result.textContent = "";
            this.renderIdle();
            this.updateInfo();
        },

        announce(name, rank) {
            const item = this.mk("div", "podium-item");
            item.setAttribute("role", "listitem");
            item.append(this.mk("span", "podium-rank", String(rank + 1)), this.mk("span", "podium-name", name));
            this.el.podium.appendChild(item);
            Sound.win();
        },

        async start() {
            if (this.running) return;
            const names = this.names();
            if (!names.length) { Notify.error("No players in this room yet."); return; }
            const n = Math.min(this.count, names.length);
            if (n < this.count) Notify.warning(`Only ${names.length} player(s) available \u2014 drawing ${n}.`);

            this.runId += 1;
            const id = this.runId;
            this.running = true;
            this.setBusy(true);
            this.el.podium.replaceChildren();
            this.el.result.textContent = "";

            const winners = this.shuffle(names).slice(0, n);
            const runner = { slots: this.runSlots, bingo: this.runBingo, cards: this.runCards, laser: this.runLaser, bracket: this.runBracket, plinko: this.runPlinko, chests: this.runChests, roles: this.runRoles }[this.mode];
            try {
                await runner.call(this, names, winners, id);
                this.logDraw(winners);
                this.el.result.textContent = `\u{1F389} ${n === 1 ? "Winner" : "Winners"}: ${winners.join(", ")}`;
                Sound.jackpot();
            } catch (err) {
                if (err !== this.CANCEL) { console.error(err); Notify.error("The draw was interrupted."); }
            } finally {
                if (id === this.runId) { this.running = false; this.setBusy(false); this.updateInfo(); }
            }
        },

        /* ------------------- MODE 1: NAME SLOT MACHINE ------------------- */
        async runSlots(names, winners, id) {
            const H = 52;
            const box = this.mk("div", "reels");
            const reels = winners.map((winner, k) => {
                const target = 22 + k * 5;
                const reel = this.mk("div", "reel is-spinning");
                const strip = this.mk("div", "reel-strip");
                for (let i = 0; i < target + 4; i += 1) {
                    strip.appendChild(this.mk("div", "reel-item", i === target ? winner : names[Math.floor(Math.random() * names.length)]));
                }
                reel.append(strip, this.mk("div", "reel-window"));
                box.appendChild(reel);
                return { reel, strip, winner, k, dist: (target - 1) * H, dur: 2400 + k * 650, done: false, lastRow: -1 };
            });
            this.el.stage.replaceChildren(box);

            const OVER = 26, A = 0.8;
            await this.frames(id, (dt, t) => {
                let all = true;
                reels.forEach((r) => {
                    if (r.done) return;
                    const p = t / r.dur;
                    let y;
                    if (p >= 1) {
                        y = r.dist;
                        r.done = true;
                        r.reel.classList.remove("is-spinning");
                        r.reel.classList.add("is-done");
                        this.announce(r.winner, r.k);
                    } else if (p < A) {
                        const q = p / A;
                        y = (r.dist + OVER) * (1 - Math.pow(1 - q, 4));   // fast spin, long brake, small overshoot
                    } else {
                        const s = (p - A) / (1 - A);
                        y = r.dist + OVER * Math.exp(-4 * s) * Math.cos(10 * s);   // damped spring = physics bounce
                        r.reel.classList.remove("is-spinning");
                    }
                    r.strip.style.transform = `translate3d(0,${-y}px,0)`;
                    const row = Math.floor(y / H);
                    if (r.k === 0 && row !== r.lastRow) { r.lastRow = row; Sound.tone(260 + (row % 5) * 40, 30, "square", 0.02); }
                    if (!r.done) all = false;
                });
                return all;
            });
        },

        /* ------------------ MODE 2: SPHERE LOTTERY / BINGO ------------------ */
        async runBingo(names, winners, id) {
            const { ctx, w, h } = this.makeCanvas(420);
            const R = Math.min(w / 2 - 8, (h - 56) / 2), cx = w / 2, cy = h - R - 6;
            const mouthY = cy - R, tubeTop = 8;
            const r = Math.max(11, Math.min(26, R * Math.sqrt(0.38 / names.length)));
            const gap = Math.asin(Math.min(0.9, (r + 5) / R));
            const palette = ["#e0483e", "#f4c430", "#2e8b57", "#e8e8e8", "#3b6fb6"];
            const balls = this.shuffle(names).map((name, i) => {
                const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * (R - r - 4);
                return { name, x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d, vx: (Math.random() - 0.5) * 200, vy: (Math.random() - 0.5) * 200, color: palette[i % palette.length], mode: "free" };
            });

            const step = (dt, blow) => {
                const s = dt / 1000;
                const free = balls.filter((b) => b.mode === "free");
                free.forEach((b) => {
                    b.vy += 420 * s;
                    if (b.y > cy + R * 0.2) b.vy -= blow * 1500 * s;          // air jet from the bottom
                    b.vx += (Math.random() - 0.5) * blow * 1200 * s;
                    const sp = Math.hypot(b.vx, b.vy);
                    if (sp > 620) { b.vx *= 620 / sp; b.vy *= 620 / sp; }
                    b.x += b.vx * s; b.y += b.vy * s;
                });
                for (let i = 0; i < free.length; i += 1) {
                    const a = free[i];
                    const dx = a.x - cx, dy = a.y - cy, d = Math.hypot(dx, dy) || 1;
                    if (d > R - r) {
                        const nx = dx / d, ny = dy / d;
                        a.x = cx + nx * (R - r); a.y = cy + ny * (R - r);
                        const vn = a.vx * nx + a.vy * ny;
                        if (vn > 0) { a.vx -= 1.85 * vn * nx; a.vy -= 1.85 * vn * ny; }
                    }
                    for (let j = i + 1; j < free.length; j += 1) {
                        const b = free[j];
                        const ex = b.x - a.x, ey = b.y - a.y, dist = Math.hypot(ex, ey) || 0.01;
                        if (dist < 2 * r) {
                            const nx = ex / dist, ny = ey / dist, ov = (2 * r - dist) / 2;
                            a.x -= nx * ov; a.y -= ny * ov; b.x += nx * ov; b.y += ny * ov;
                            const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
                            if (rel < 0) { const imp = -rel * 0.9; a.vx -= imp * nx; a.vy -= imp * ny; b.vx += imp * nx; b.vy += imp * ny; }
                        }
                    }
                }
            };

            const drawBall = (b) => {
                ctx.beginPath(); ctx.arc(b.x, b.y, r, 0, Math.PI * 2); ctx.fillStyle = b.color; ctx.fill();
                const g = ctx.createRadialGradient(b.x - r * 0.35, b.y - r * 0.35, r * 0.1, b.x, b.y, r);
                g.addColorStop(0, "rgba(255,255,255,.75)"); g.addColorStop(0.4, "rgba(255,255,255,0)"); g.addColorStop(1, "rgba(0,0,0,.35)");
                ctx.fillStyle = g; ctx.fill();
                ctx.beginPath(); ctx.arc(b.x, b.y, r * 0.68, 0, Math.PI * 2); ctx.fillStyle = "rgba(255,255,255,.92)"; ctx.fill();
                ctx.fillStyle = "#14171c"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
                ctx.font = `700 ${Math.max(8, r * 0.4)}px "Segoe UI", Arial, sans-serif`;
                ctx.fillText(this.short(b.name, 9), b.x, b.y, r * 1.2);
            };

            const draw = (banner) => {
                ctx.clearRect(0, 0, w, h);
                ctx.lineWidth = 3; ctx.strokeStyle = "rgba(233,196,106,.85)";
                ctx.beginPath();
                ctx.moveTo(cx - r - 5, mouthY); ctx.lineTo(cx - r - 5, tubeTop);
                ctx.moveTo(cx + r + 5, mouthY); ctx.lineTo(cx + r + 5, tubeTop);
                ctx.stroke();
                const g = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.3, R * 0.1, cx, cy, R);
                g.addColorStop(0, "rgba(255,255,255,.14)"); g.addColorStop(1, "rgba(255,255,255,.03)");
                ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
                ctx.lineWidth = 4; ctx.strokeStyle = "#b8860b";
                ctx.beginPath(); ctx.arc(cx, cy, R, -Math.PI / 2 + gap, Math.PI * 1.5 - gap); ctx.stroke();
                balls.forEach(drawBall);
                if (banner) {
                    ctx.save();
                    ctx.fillStyle = "#f4c430"; ctx.shadowColor = "rgba(244,196,48,.8)"; ctx.shadowBlur = 12;
                    ctx.textAlign = "left"; ctx.textBaseline = "middle";
                    ctx.font = '700 20px "Segoe UI", Arial, sans-serif';
                    const x = cx + r + 16;
                    ctx.fillText("\u2605 " + banner, x, tubeTop + 18, Math.max(60, w - x - 8));
                    ctx.restore();
                }
            };

            let blow = 0.5;
            for (let k = 0; k < winners.length; k += 1) {
                const ball = balls.find((b) => b.name === winners[k]);
                let phase = "blow", pt = 0, banner = null;
                await this.frames(id, (dt) => {
                    pt += dt;
                    if (phase === "blow") {
                        blow = 1;
                        if (Math.floor(pt / 130) !== Math.floor((pt - dt) / 130)) Sound.tone(200 + Math.random() * 220, 40, "triangle", 0.03);
                        if (pt > 1700) { phase = "pull"; pt = 0; ball.mode = "pull"; blow = 0.5; }
                    } else if (phase === "pull") {
                        const dx = cx - ball.x, dy = mouthY + r - ball.y, d = Math.hypot(dx, dy);
                        if (d < 6) { phase = "tube"; pt = 0; ball.x = cx; }
                        else { const sp = 240 * dt / 1000; ball.x += (dx / d) * Math.min(sp, d); ball.y += (dy / d) * Math.min(sp, d); }
                    } else if (phase === "tube") {
                        ball.y -= 200 * dt / 1000;
                        if (ball.y <= tubeTop + r + 2) { ball.y = tubeTop + r + 2; phase = "show"; pt = 0; banner = winners[k]; ball.mode = "show"; this.announce(winners[k], k); }
                    } else if (pt > 1100) {
                        return true;
                    }
                    step(dt, blow);
                    draw(banner);
                    return false;
                });
                balls.splice(balls.indexOf(ball), 1);
            }
        },

        /* ---------------------- MODE 3: CARD DEALER ---------------------- */
        async runCards(names, winners, id) {
            const area = this.mk("div", "deal-area");
            const deck = this.mk("div", "deck");
            const shown = Math.min(names.length, 14);
            for (let i = 0; i < shown; i += 1) {
                const mini = this.mk("div", "deck-card");
                mini.style.setProperty("--i", String(i));
                mini.style.transform = `translate(${i * 1.5}px, ${-i * 1.5}px)`;
                mini.style.animationDelay = `${(i % 5) * 60}ms`;
                deck.appendChild(mini);
            }
            const row = this.mk("div", "deal-row");
            area.append(this.mk("p", "deal-label", `${names.length} player card${names.length === 1 ? "" : "s"} in the deck`), deck, row);
            this.el.stage.replaceChildren(area);

            deck.classList.add("is-shuffling");
            for (let i = 0; i < 8; i += 1) { Sound.tone(300 + Math.random() * 200, 40, "square", 0.025); await this.wait(220, id); }
            deck.classList.remove("is-shuffling");

            const suits = Deck.SUITS;
            const cards = winners.map((winner, k) => {
                const card = this.mk("div", "deal-card");
                const inner = this.mk("div", "deal-inner");
                const back = this.mk("div", "deal-face deal-back", "\u2660");
                const front = this.mk("div", "deal-face deal-front");
                const suit = suits[Math.floor(Math.random() * suits.length)];
                const red = suit === "\u2665" || suit === "\u2666";
                front.classList.toggle("is-red", red);
                front.append(this.mk("span", "deal-suit", suit), this.mk("span", "deal-name", winner), this.mk("span", "deal-tag", "WINNER"));
                inner.append(back, front);
                card.appendChild(inner);
                row.appendChild(card);
                return card;
            });

            const dr = deck.getBoundingClientRect();
            cards.forEach((card, i) => {
                const cr = card.getBoundingClientRect();
                const dx = dr.left + dr.width / 2 - (cr.left + cr.width / 2);
                const dy = dr.top + dr.height / 2 - (cr.top + cr.height / 2);
                card.animate(
                    [{ transform: `translate(${dx}px, ${dy}px) rotate(-10deg) scale(.6)` }, { transform: "none" }],
                    { duration: 650, delay: i * 260, easing: "cubic-bezier(.2,.9,.3,1)", fill: "backwards" }
                );
                window.setTimeout(() => { if (id === this.runId) Sound.click(); }, i * 260 + 200);
            });
            await this.wait(cards.length * 260 + 700, id);

            for (let i = 0; i < cards.length; i += 1) {
                await this.wait(i === cards.length - 1 && cards.length > 1 ? 1100 : 650, id);
                cards[i].classList.add("is-flipped");
                await this.wait(450, id);
                cards[i].classList.add("is-winner");
                this.announce(winners[i], i);
            }
            await this.wait(500, id);
        },

        /* ------------------ MODE 4: CHIP RAIN / LASER PULSE ------------------ */
        async runLaser(names, winners, id) {
            const { ctx, w, h } = this.makeCanvas(440);
            const cx = w / 2, cy = h * 0.42, RX = w / 2 - 34, RY = h * 0.34;
            const r = Math.max(13, Math.min(27, Math.min(RX, RY) * Math.sqrt(0.5 / names.length) * 1.5));
            const slotR = Math.max(14, Math.min(26, (w - 30) / (2 * winners.length) - 6));
            const slotY = h - slotR - 24;
            const slotX = (k) => 20 + (w - 40) * (k + 0.5) / winners.length;
            const src = { x: cx, y: 8 };
            const chips = this.shuffle(names).map((name, i) => ({
                name, a: Math.random() * Math.PI * 2, ro: 0.25 + Math.random() * 0.7, dir: Math.random() < 0.5 ? -1 : 1,
                w0: 0.7 + Math.random() * 0.8, color: this.CHIP_COLORS[i % this.CHIP_COLORS.length],
                delay: Math.random() * 700, mode: "orbit", x: cx, y: -60, slot: -1
            }));
            let time = 0;

            const beam = (tx, ty, flash) => {
                ctx.save();
                ctx.globalCompositeOperation = "lighter";
                const g = ctx.createLinearGradient(src.x, src.y, tx, ty);
                g.addColorStop(0, `rgba(255,240,170,${0.5 + flash * 0.4})`); g.addColorStop(1, "rgba(255,200,60,.08)");
                ctx.fillStyle = g;
                const ang = Math.atan2(ty - src.y, tx - src.x) + Math.PI / 2, half = r * (0.9 + flash);
                ctx.beginPath();
                ctx.moveTo(src.x - 2, src.y); ctx.lineTo(src.x + 2, src.y);
                ctx.lineTo(tx + Math.cos(ang) * half, ty + Math.sin(ang) * half);
                ctx.lineTo(tx - Math.cos(ang) * half, ty - Math.sin(ang) * half);
                ctx.closePath(); ctx.fill();
                const sg = ctx.createRadialGradient(tx, ty, 0, tx, ty, r * 2.2);
                sg.addColorStop(0, `rgba(255,240,170,${0.5 + flash * 0.35})`); sg.addColorStop(1, "rgba(255,240,170,0)");
                ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(tx, ty, r * 2.2, 0, Math.PI * 2); ctx.fill();
                ctx.restore();
                ctx.fillStyle = "#f4c430"; ctx.beginPath(); ctx.arc(src.x, src.y, 6, 0, Math.PI * 2); ctx.fill();
            };

            const render = (dt, target, flash, ring) => {
                time += dt;
                ctx.clearRect(0, 0, w, h);
                for (let k = 0; k < winners.length; k += 1) {
                    ctx.save(); ctx.setLineDash([5, 5]); ctx.lineWidth = 2; ctx.strokeStyle = "rgba(233,196,106,.5)";
                    ctx.beginPath(); ctx.arc(slotX(k), slotY, slotR, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
                }
                chips.forEach((c) => {
                    if (c.mode === "orbit") {
                        c.a += c.dir * c.w0 / (0.45 + c.ro) * dt / 1000;
                        const e = Math.min(1, Math.max(0, (time - c.delay) / 750));
                        c.x = cx + Math.cos(c.a) * c.ro * RX;
                        c.y = cy + Math.sin(c.a) * c.ro * RY * 0.9 - Math.pow(1 - e, 3) * (h + 60);   // chip rain intro
                        this.drawChip(ctx, c.x, c.y, r, c.name, c.color, false);
                    } else if (c.mode === "fly") {
                        this.drawChip(ctx, c.x, c.y, r + (slotR - r) * c.p, c.name, c.color, true);
                    } else {
                        this.drawChip(ctx, slotX(c.slot), slotY, slotR, c.name, c.color, true);
                    }
                });
                if (target) {
                    beam(target.x, target.y, flash);
                    if (ring) {
                        ctx.save(); ctx.lineWidth = 3; ctx.strokeStyle = "#f4c430"; ctx.shadowColor = "#f4c430"; ctx.shadowBlur = 16;
                        ctx.beginPath(); ctx.arc(target.x, target.y, r + 5, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
                    }
                }
            };

            await this.frames(id, (dt, t) => { render(dt, null, 0, false); return t > 1300; });   // let the rain settle

            const PULSE = 280, LOCK = 750, FLY = 850;
            for (let k = 0; k < winners.length; k += 1) {
                const wc = chips.find((c) => c.name === winners[k]);
                const decoys = this.shuffle(chips.filter((c) => c !== wc && c.mode === "orbit")).slice(0, 5);
                const seq = decoys.concat(wc), scan = seq.length * PULSE;
                let lastIdx = -1, locked = false;
                await this.frames(id, (dt, t) => {
                    if (t < scan) {
                        const idx = Math.floor(t / PULSE), ph = (t % PULSE) / PULSE;
                        if (idx !== lastIdx) { lastIdx = idx; Sound.tone(500 + idx * 90, 70, "sawtooth", 0.03); }
                        render(dt, seq[idx], ph < 0.25 ? (1 - ph / 0.25) * 0.6 : 0, false);
                    } else if (t < scan + LOCK) {
                        if (!locked) { locked = true; Sound.tone(880, 220, "triangle", 0.06); }
                        render(dt, wc, 0.5 + 0.5 * Math.sin((t - scan) / 60), true);
                    } else {
                        const p = Math.min(1, (t - scan - LOCK) / FLY), e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
                        if (wc.mode !== "fly") { wc.mode = "fly"; wc.fx = wc.x; wc.fy = wc.y; }
                        wc.p = e;
                        wc.x = wc.fx + (slotX(k) - wc.fx) * e;
                        wc.y = wc.fy + (slotY - wc.fy) * e - Math.sin(p * Math.PI) * 40;
                        render(dt, null, 0, false);
                        if (p >= 1) { wc.mode = "slot"; wc.slot = k; this.announce(winners[k], k); return true; }
                    }
                    return false;
                });
                await this.frames(id, (dt, t) => { render(dt, null, 0, false); return t > 300; });
            }
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
                State.isHost = meta.hostDeviceId === Storage.getDeviceId();
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

        init() {
            DOM.loginForm.addEventListener("submit", (event) => this.handleCreatePlayer(event));
            DOM.inputPlayerSearch.addEventListener("input", (event) => {
                this.searchTerm = event.target.value.trim().toLowerCase();
                this.render();
            });
            DOM.btnLeaveRoom.addEventListener("click", () => this.leaveRoom());
            PubSub.on("players-updated", () => {
                if (!DOM.viewAuth.hidden) this.render();
            });
        },

        render() {
            const allPlayers = Room.list().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
            const filtered = this.searchTerm
                ? allPlayers.filter((p) => p.username.toLowerCase().includes(this.searchTerm))
                : allPlayers;

            DOM.playersCount.textContent = String(allPlayers.length);
            DOM.playersGrid.innerHTML = "";
            DOM.playersEmpty.hidden = allPlayers.length > 0;
            DOM.playersEmpty.textContent = (allPlayers.length > 0 && filtered.length === 0)
                ? "No players match your search."
                : "No players have joined this room yet. Create the first profile on the right \u2192";

            filtered.forEach((player) => {
                DOM.playersGrid.appendChild(this.buildPlayerCard(player));
            });
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
            nameEl.textContent = player.username;
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
                    name.textContent = player.username;

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
       21. LOGIN / LOGOUT FLOW
       ========================================================================= */
    function handleLogout() {
        Social.stop();
        State.reset();
        HUD.update();
        Router.showAuth();
    }

    /* =========================================================================
       21b. EXTRA — feedback FX, new casino games, new Lucky Draw modes
       ========================================================================= */
    const Extra = (() => {
        const $ = (s) => document.querySelector(s);
        const mk = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };
        const rnd = (a, b) => a + Math.random() * (b - a);
        const pick = (a) => a[Math.floor(Math.random() * a.length)];
        const shuffle = (a) => LuckyDraw.shuffle(a);
        const RM = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        const buzz = (ms) => { if (!RM) try { navigator.vibrate && navigator.vibrate(ms); } catch (e) { /* unsupported */ } };
        const shake = (el, ms = 25) => { if (RM) return; el.classList.remove("fx-shake"); void el.offsetWidth; el.classList.add("fx-shake"); buzz(ms); };

        /** DOM spark burst inside a position:relative host. */
        const domBurst = (host, x, y, n = 14) => {
            if (RM) return;
            for (let i = 0; i < n; i += 1) {
                const s = mk("i", "fx-spark"); s.style.left = x + "px"; s.style.top = y + "px"; host.append(s);
                const a = rnd(0, 6.283), d = rnd(30, 95);
                s.animate([{ transform: "translate(0,0) scale(1)", opacity: 1 }, { transform: `translate(${Math.cos(a) * d}px,${Math.sin(a) * d + 20}px) scale(.2)`, opacity: 0 }],
                    { duration: rnd(450, 800), easing: "cubic-bezier(.2,.8,.4,1)" }).onfinish = () => s.remove();
            }
        };

        /** Canvas particle system. */
        class Particles {
            constructor() { this.list = []; }
            burst(x, y, n = 16, color = "#f4c430") {
                for (let i = 0; i < n; i += 1) { const a = rnd(0, 6.283), s = rnd(60, 260); this.list.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 60, life: 1, color, r: rnd(1.5, 3.5) }); }
            }
            draw(ctx, dt) {
                const s = dt / 1000;
                this.list = this.list.filter((p) => (p.life -= s * 1.6) > 0);
                this.list.forEach((p) => { p.vy += 500 * s; p.x += p.vx * s; p.y += p.vy * s; ctx.globalAlpha = Math.max(0, p.life); ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.283); ctx.fill(); });
                ctx.globalAlpha = 1;
            }
            get active() { return this.list.length > 0; }
        }

        const canvas = (host, w, h) => {
            const c = mk("canvas", "xg-canvas"), d = window.devicePixelRatio || 1;
            c.width = w * d; c.height = h * d; c.style.maxWidth = w + "px"; c.style.aspectRatio = `${w}/${h}`;
            const ctx = c.getContext("2d"); ctx.scale(d, d); host.replaceChildren(c);
            return { c, ctx, w, h };
        };
        const loop = (fn) => {
            let last = performance.now(), on = true;
            const t = (now) => { if (!on) return; const dt = Math.min(now - last, 40); last = now; if (fn(dt, now) === false) { on = false; return; } requestAnimationFrame(t); };
            requestAnimationFrame(t);
            return () => { on = false; };
        };
        const felt = (ctx, w, h) => { ctx.fillStyle = "#0b3d2e"; ctx.fillRect(0, 0, w, h); };

        const shell = (key, title, hint) => {
            const sec = $("#game-" + key);
            const p = mk("p", "modal-subtitle", hint); p.style.textAlign = "center";
            const stage = mk("div", "xg-stage"), ctl = mk("div", "xg-controls"), res = mk("p", "game-result");
            res.setAttribute("role", "status"); res.setAttribute("aria-live", "polite");
            const bet = mk("input", "xg-bet"); bet.type = "number"; bet.min = 1; bet.value = 10; bet.setAttribute("aria-label", "Bet amount");
            const lab = mk("label", "xg-bet-label", "Bet"); lab.append(bet);
            sec.append(mk("h2", "", title), p, stage, ctl, res);
            return { sec, stage, ctl, res, bet, lab };
        };
        const btn = (label, cls = "btn btn-primary", fn) => { const b = mk("button", cls, label); b.type = "button"; if (fn) b.addEventListener("click", fn); return b; };

        const settle = (g, name, bet, payout, msg) => {
            if (payout > 0) State.credit(payout);
            State.recordRound(bet, payout);
            const net = payout - bet;
            g.res.textContent = `${msg} ${net > 0 ? "You won " + payout + " chips." : net === 0 ? "Bet returned." : "Lost " + bet + " chips."}`;
            if (net > 0) { Notify.success(`${name}: won ${payout} chips.`); Sound.win(); if (payout >= CONFIG.BIG_WIN_THRESHOLD) Effects.celebrate(`${name.toUpperCase()}! +${payout} chips`); }
            else if (net < 0) { Notify.error(`${name}: lost ${bet} chips.`); Sound.lose(); } else Notify.warning(`${name}: push.`);
        };

        /* ------------------------------ CRAPS ------------------------------ */
        const PIPS = { 1: [[0, 0]], 2: [[-1, -1], [1, 1]], 3: [[-1, -1], [0, 0], [1, 1]], 4: [[-1, -1], [1, -1], [-1, 1], [1, 1]], 5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]], 6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]] };
        const drawDie = (ctx, x, y, size, rot, face, lift) => {
            ctx.save(); ctx.fillStyle = "rgba(0,0,0,.35)"; ctx.beginPath(); ctx.ellipse(x, y + size * 0.62, size * (0.5 - lift * 0.1), size * 0.12, 0, 0, 6.283); ctx.fill(); ctx.restore();
            ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.fillStyle = "#f7f2e6"; ctx.strokeStyle = "#b8860b"; ctx.lineWidth = 3;
            ctx.beginPath(); ctx.roundRect(-size / 2, -size / 2, size, size, 10); ctx.fill(); ctx.stroke();
            ctx.fillStyle = "#14171c"; PIPS[face].forEach(([px, py]) => { ctx.beginPath(); ctx.arc(px * size * 0.26, py * size * 0.26, size * 0.075, 0, 6.283); ctx.fill(); });
            ctx.restore();
        };
        const craps = () => {
            const g = shell("craps", "Craps / Dice Betting", "Pick a total (2–12) or an outcome, then roll. 7 loses High/Low.");
            const PAY = { 2: 30, 3: 15, 4: 10, 5: 8, 6: 6, 7: 5, 8: 6, 9: 8, 10: 10, 11: 15, 12: 30 };
            const types = [...Object.keys(PAY).map((n) => ({ label: n, mult: PAY[n], win: (t) => t === Number(n) })),
            { label: "Even", mult: 2, win: (t) => t % 2 === 0 }, { label: "Odd", mult: 2, win: (t) => t % 2 === 1 },
            { label: "Low 2-6", mult: 2, win: (t) => t < 7 }, { label: "High 8-12", mult: 2, win: (t) => t > 7 }];
            let sel = types[5], busy = false; const bs = [];
            const cv = canvas(g.stage, 360, 200); const { ctx, w, h } = cv, P = new Particles();
            const still = (a, b) => { felt(ctx, w, h); drawDie(ctx, 110, h - 50, 64, 0, a, 0); drawDie(ctx, 250, h - 50, 64, 0, b, 0); };
            still(3, 4);
            const grid = mk("div", "xg-controls");
            types.forEach((t) => { const b = btn("", "btn btn-game-select xg-chipbtn"); b.append(t.label, Object.assign(mk("small"), { textContent: t.mult + "x" })); b.setAttribute("aria-pressed", String(t === sel)); b.addEventListener("click", () => { if (busy) return; sel = t; bs.forEach((x, i) => x.setAttribute("aria-pressed", String(types[i] === t))); }); bs.push(b); grid.append(b); });
            const go = btn("🎲 Roll Dice", "btn btn-primary", () => {
                if (busy) return; const bet = Validate.parseBet(g.bet); if (bet === null) return;
                State.debit(bet); busy = true; go.disabled = true; g.res.textContent = "";
                const fin = [1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)];
                const dice = [0, 1].map((i) => ({ x: 110 + i * 140, y: -40 - i * 30, vy: 0, rot: rnd(0, 6), vr: rnd(-12, 12), face: 1 + Math.floor(Math.random() * 6), n: 0, done: false, fin: fin[i] }));
                const floor = h - 50;
                loop((dt) => {
                    const s = dt / 1000; felt(ctx, w, h);
                    dice.forEach((d) => {
                        if (!d.done) {
                            d.vy += 1800 * s; d.y += d.vy * s; d.rot += d.vr * s;
                            if (d.y > floor) {
                                d.y = floor; d.vy *= -0.55; d.vr *= 0.6; d.n += 1; P.burst(d.x, floor + 28, 8, "#fff");
                                if (d.n === 1) shake(g.stage, 30);
                                if (d.n >= 3 || Math.abs(d.vy) < 120) { d.done = true; d.vy = 0; d.rot = 0; d.face = d.fin; } else d.face = 1 + Math.floor(Math.random() * 6);
                            } else if (Math.random() < 0.25) d.face = 1 + Math.floor(Math.random() * 6);
                        }
                        drawDie(ctx, d.x, d.y, 64, d.rot, d.face, Math.max(0, (floor - d.y) / 200));
                    });
                    P.draw(ctx, dt);
                    if (dice.every((d) => d.done) && !P.active) {
                        const tot = fin[0] + fin[1], win = sel.win(tot);
                        settle(g, "Craps", bet, win ? bet * sel.mult : 0, `Rolled ${fin[0]} + ${fin[1]} = ${tot}.`);
                        busy = false; go.disabled = false; return false;
                    }
                });
            });
            g.ctl.append(g.lab, go); g.ctl.before(grid);
        };

        /* ------------------------------- CRASH ------------------------------ */
        const crash = () => {
            const g = shell("crash", "Crash / The Rocket", "The multiplier climbs from 1.00x. Cash out before the rocket explodes!");
            const { ctx, w, h } = canvas(g.stage, 360, 240), P = new Particles();
            let run = false, bet = 0, m = 1, t = 0, cashed = 0, crashAt = 2, exploded = false, jolt = 0;
            const out = btn("💰 Cash Out", "btn btn-secondary"), go = btn("🚀 Launch");
            out.disabled = true;
            const pos = (tt, xm, ym) => [30 + (tt / xm) * (w - 50), h - 24 - ((Math.exp(0.18 * tt) - 1) / (ym - 1)) * (h - 50)];
            const frame = (dt) => {
                if (run && !exploded) {
                    t += dt / 1000; m = Math.exp(0.18 * t);
                    if (m >= crashAt) {
                        m = crashAt; exploded = true; const [x, y] = pos(t, Math.max(6, t * 1.15), Math.max(2, m * 1.25));
                        P.burst(x, y, 40, "#e0483e"); P.burst(x, y, 30, "#f4c430"); jolt = 6; buzz(80); shake(g.stage, 80);
                        if (!cashed) settle(g, "Crash", bet, 0, `💥 Crashed at ${m.toFixed(2)}x.`);
                        else g.res.textContent += ` (Rocket crashed at ${m.toFixed(2)}x)`;
                        out.disabled = true;
                    }
                }
                const xm = Math.max(6, t * 1.15), ym = Math.max(2, m * 1.25);
                ctx.save(); felt(ctx, w, h);
                if (jolt > 0.2) { ctx.translate(rnd(-jolt, jolt), rnd(-jolt, jolt)); jolt *= 0.85; }
                ctx.strokeStyle = "#f4c430"; ctx.lineWidth = 3; ctx.beginPath();
                for (let i = 0; i <= 40; i += 1) { const [x, y] = pos(t * i / 40, xm, ym); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
                ctx.stroke();
                const [rx, ry] = pos(t, xm, ym); ctx.font = "28px serif"; ctx.textAlign = "center"; ctx.fillText(exploded ? "💥" : "🚀", rx, ry);
                ctx.fillStyle = exploded ? "#e0483e" : cashed ? "#2e8b57" : "#eef2f5"; ctx.font = "700 44px sans-serif"; ctx.fillText(m.toFixed(2) + "x", w / 2, h / 2);
                if (cashed) { ctx.font = "600 15px sans-serif"; ctx.fillText(`Cashed out @ ${cashed.toFixed(2)}x`, w / 2, h / 2 + 26); }
                P.draw(ctx, dt); ctx.restore();
                if (exploded && !P.active) { run = false; go.disabled = false; return false; }
            };
            go.addEventListener("click", () => {
                if (run) return; const b = Validate.parseBet(g.bet); if (b === null) return;
                State.debit(b); bet = b; run = true; exploded = false; cashed = 0; t = 0; m = 1; g.res.textContent = "";
                crashAt = Math.min(100, Math.max(1, Math.floor(96 / (1 - Math.random())) / 100));
                go.disabled = true; out.disabled = false; loop(frame);
            });
            out.addEventListener("click", () => {
                if (!run || exploded || cashed) return; cashed = m; out.disabled = true;
                const payout = Math.floor(bet * m); const [x, y] = pos(t, Math.max(6, t * 1.15), Math.max(2, m * 1.25));
                P.burst(x, y, 24, "#2e8b57"); shake(g.stage, 20);
                settle(g, "Crash", bet, payout, `Cashed out at ${m.toFixed(2)}x.`);
            });
            frame(0); g.ctl.append(g.lab, go, out);
        };

        /* ---------------------------- POKER DICE ---------------------------- */
        const FACES = ["A", "K", "Q", "J", "10", "9"];
        const evalHand = (v) => {
            const c = {}; v.forEach((x) => { c[x] = (c[x] || 0) + 1; });
            const grp = Object.entries(c).map(([f, n]) => [n, 6 - Number(f)]).sort((a, b) => b[0] - a[0] || b[1] - a[1]);
            const pat = grp.map((x) => x[0]).join(""), u = [...new Set(v)].sort((a, b) => a - b);
            const straight = u.length === 5 && u[4] - u[0] === 4;
            const [cat, name] = pat === "5" ? [7, "Five of a Kind"] : pat === "41" ? [6, "Four of a Kind"] : pat === "32" ? [5, "Full House"] : straight ? [4, "Straight"] : pat === "311" ? [3, "Three of a Kind"] : pat === "221" ? [2, "Two Pair"] : pat === "2111" ? [1, "One Pair"] : [0, "High Card"];
            return { cat, name, score: cat * 1e6 + grp.reduce((a, x) => a * 10 + x[1], 0) };
        };
        const pokerDice = () => {
            const g = shell("pokerdice", "Poker Dice", "Roll 5 dice, hold what you like, reroll once, and beat the dealer's hand. Full House or better pays 3x.");
            const row = mk("div", "pd-row"), dealer = mk("div", "pd-dealer"); g.stage.style.flexDirection = "column"; g.stage.style.gap = "0.75rem"; g.stage.append(row, dealer);
            let vals = [], held = [false, false, false, false, false], phase = "idle", bet = 0;
            const dice = [0, 1, 2, 3, 4].map((i) => { const d = btn("?", "pd-die"); d.addEventListener("click", () => { if (phase !== "rolled") return; held[i] = !held[i]; d.classList.toggle("is-held", held[i]); }); row.append(d); return d; });
            const r6 = () => Math.floor(Math.random() * 6);
            const paint = (changed) => dice.forEach((d, i) => { d.textContent = FACES[vals[i]]; d.classList.toggle("is-held", held[i]); if (changed.includes(i)) { d.classList.remove("pd-roll"); void d.offsetWidth; d.classList.add("pd-roll"); } });
            const deal = btn("🎲 Roll", "btn btn-primary", () => {
                if (phase !== "idle") return; const b = Validate.parseBet(g.bet); if (b === null) return;
                State.debit(b); bet = b; vals = [0, 1, 2, 3, 4].map(r6); held = held.map(() => false); phase = "rolled"; g.res.textContent = ""; dealer.textContent = "";
                paint([0, 1, 2, 3, 4]); buzz(20); again.disabled = stand.disabled = false; deal.disabled = true;
            });
            const finish = () => {
                phase = "idle"; again.disabled = stand.disabled = true; deal.disabled = false;
                let dv = [0, 1, 2, 3, 4].map(r6); const cnt = {}; dv.forEach((x) => { cnt[x] = (cnt[x] || 0) + 1; });
                const top = Number(Object.entries(cnt).sort((a, b) => b[1] - a[1])[0][0]); dv = dv.map((x) => (cnt[top] > 1 && x !== top ? r6() : x));
                const me = evalHand(vals), dl = evalHand(dv);
                dealer.replaceChildren(document.createTextNode(`Dealer: ${dl.name} `), ...dv.map((x) => mk("span", "pd-die", FACES[x])));
                const win = me.score > dl.score, tie = me.score === dl.score;
                if (win) { domBurst(g.stage, g.stage.clientWidth / 2, 40, 18); shake(g.stage, 25); }
                settle(g, "Poker Dice", bet, win ? bet * (me.cat >= 5 ? 3 : 2) : tie ? bet : 0, `You: ${me.name} vs Dealer: ${dl.name}.`);
            };
            const again = btn("🔁 Reroll Unheld", "btn btn-secondary", () => { if (phase !== "rolled") return; const ch = []; vals = vals.map((v, i) => { if (held[i]) return v; ch.push(i); return r6(); }); paint(ch); buzz(20); window.setTimeout(finish, 500); phase = "wait"; });
            const stand = btn("✋ Stand", "btn btn-secondary", () => { if (phase === "rolled") finish(); });
            again.disabled = stand.disabled = true; g.ctl.append(g.lab, deal, again, stand);
            vals = [0, 1, 2, 3, 4]; paint([]); dice.forEach((d) => { d.textContent = "?"; });
        };

        /* ---------------------------- MONEY WHEEL --------------------------- */
        const moneyWheel = () => {
            const g = shell("moneywheel", "Money Wheel", "Stake chips on one or more multipliers, then spin. A hit pays stake × (multiplier + 1).");
            const SL = [1, 2, 1, 5, 1, 2, 1, 10, 1, 2, 1, 5, 1, 20, 1, 2, 1, 5, 1, 2, 1, 10, 1, 2], A = 6.283185307 / SL.length;
            const COL = { 1: "#2b5c9e", 2: "#1e7a4c", 5: "#b8860b", 10: "#a8302a", 20: "#7b3fa0" };
            const { ctx, w, h } = canvas(g.stage, 300, 340), P = new Particles();
            const bets = { 1: 0, 2: 0, 5: 0, 10: 0, 20: 0 }; let th = 0, spinning = false, jolt = 0;
            const draw = (dt = 16) => {
                ctx.save(); felt(ctx, w, h); if (jolt > 0.2) { ctx.translate(rnd(-jolt, jolt), rnd(-jolt, jolt)); jolt *= 0.8; }
                ctx.translate(w / 2, 175); ctx.rotate(th);
                SL.forEach((v, i) => { ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, 135, i * A, (i + 1) * A); ctx.fillStyle = COL[v]; ctx.globalAlpha = i % 2 ? 0.85 : 1; ctx.fill(); ctx.globalAlpha = 1; ctx.strokeStyle = "#f7f2e6"; ctx.lineWidth = 1.5; ctx.stroke(); ctx.save(); ctx.rotate((i + 0.5) * A); ctx.fillStyle = "#fff"; ctx.font = "700 13px sans-serif"; ctx.textAlign = "right"; ctx.fillText(v + "x", 125, 5); ctx.restore(); });
                ctx.beginPath(); ctx.arc(0, 0, 18, 0, 6.283); ctx.fillStyle = "#f4c430"; ctx.fill(); ctx.restore();
                ctx.save(); ctx.fillStyle = "#e0483e"; ctx.beginPath(); ctx.moveTo(w / 2 - 12, 4); ctx.lineTo(w / 2 + 12, 4); ctx.lineTo(w / 2, 46); ctx.fill(); P.draw(ctx, dt); ctx.restore();
            };
            draw();
            const idx = () => Math.floor((((-1.5707963 - th) / A) % SL.length + SL.length) % SL.length);
            const chips = Object.keys(bets).map((k) => { const b = btn("", "btn btn-game-select xg-chipbtn"); b.append(k + "x", mk("small", "", "0")); b.addEventListener("click", () => { if (spinning) return; const s = Validate.parseBet(g.bet); if (s === null) return; State.debit(s); bets[k] += s; b.lastChild.textContent = bets[k]; }); return b; });
            const spin = btn("🎡 Spin", "btn btn-primary", () => {
                if (spinning) return; const total = Object.values(bets).reduce((a, b) => a + b, 0);
                if (!total) { Notify.error("Place a stake on at least one multiplier."); return; }
                spinning = true; spin.disabled = true; g.res.textContent = "";
                const target = Math.floor(Math.random() * SL.length), th0 = th, dur = 4500;
                const th1 = -1.5707963 - (target + rnd(0.2, 0.8)) * A - 6.283185307 * 6; let t0 = null, lastI = idx();
                loop((dt, now) => {
                    t0 = t0 || now; const p = Math.min(1, (now - t0) / dur), e = 1 - (1 - p) ** 3; th = th0 + (th1 - th0) * e;
                    const i = idx(); if (i !== lastI) { lastI = i; P.burst(w / 2, 46, 3, "#fff"); jolt = 1.2; buzz(6); }
                    draw(dt);
                    if (p >= 1) {
                        const v = SL[idx()], payout = bets[v] * (v + 1);
                        P.burst(w / 2, 46, 30, "#f4c430"); shake(g.stage, 40);
                        settle(g, "Money Wheel", total, payout, `Wheel landed on ${v}x.`);
                        Object.keys(bets).forEach((k, n) => { bets[k] = 0; chips[n].lastChild.textContent = "0"; });
                        spinning = false; spin.disabled = false; return false;
                    }
                });
            });
            g.ctl.append(g.lab); chips.forEach((c) => g.ctl.append(c)); g.ctl.append(spin);
        };

        /* ------------------- LUCKY DRAW: history + fx + modes ------------------ */
        const MODE_LABEL = { slots: "Slot Reels", bingo: "Bingo Blower", cards: "Card Dealer", laser: "Chip Laser", bracket: "1v1 Bracket", plinko: "Plinko", chests: "Mystery Chests", roles: "Roles Matrix" };
        const ROLES = ["Leader", "Speaker", "Evaluator", "Writer", "Timekeeper", "Reporter"];
        const installDraw = () => {
            const history = [], listEl = $("#draw-history-list");
            const renderHistory = () => {
                listEl.replaceChildren();
                if (!history.length) { listEl.append(mk("li", "draw-history-empty", "No draws yet this session.")); return; }
                history.forEach((h) => { const li = mk("li"); li.append(mk("time", "", h.time), document.createTextNode(`${h.mode}: ${h.names.join(", ")}`)); listEl.append(li); });
            };
            $("#btn-history-clear").addEventListener("click", () => { history.length = 0; renderHistory(); });
            const origAnnounce = LuckyDraw.announce;
            Object.assign(LuckyDraw.IDLE, { bracket: ["🏆", "Random 1v1 knockout matches until a champion emerges."], plinko: ["🔵", "Named chips drop through pegs into the golden selection bins."], chests: ["🎁", "Tap the chests to reveal the selected players."], roles: ["🧩", "Winners are matched with team roles by a slot matrix."] });
            Object.assign(LuckyDraw, {
                logDraw(names) { history.unshift({ time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), mode: MODE_LABEL[this.mode], names: names.slice() }); if (history.length > 15) history.pop(); renderHistory(); },
                /* Contact feedback: every time a name lands in a selection zone, burst + shake + vibrate. */
                announce(name, rank) {
                    origAnnounce.call(this, name, rank);
                    const s = this.el.stage, r = s.getBoundingClientRect(), k = rank || 0;
                    domBurst(s, r.width / 2 + (k % 3 - 1) * 50, this.mode === "bingo" ? 40 : r.height - 70, 16); shake(s, 30);
                },

                async runBracket(names, winners, id) {
                    const pool = shuffle(names).slice(0, 16);
                    if (pool.length < 2) { winners.splice(0, winners.length, pool[0]); this.announce(pool[0], 0); return; }
                    const size = 2 ** Math.ceil(Math.log2(pool.length)), byes = size - pool.length, slots = []; let pi = 0;
                    for (let m = 0; m < size / 2; m += 1) slots.push(pool[pi++], m < byes ? null : pool[pi++]);
                    const rounds = [], losers = []; let cur = slots;
                    while (cur.length > 1) {
                        const nxt = [], ms = [];
                        for (let m = 0; m < cur.length / 2; m += 1) { const a = cur[2 * m], b = cur[2 * m + 1], win = !b ? a : !a ? b : Math.random() < 0.5 ? a : b; if (a && b) losers.push({ n: win === a ? b : a, r: rounds.length }); ms.push({ bye: !a || !b, win }); nxt.push(win); }
                        rounds.push(ms); cur = nxt;
                    }
                    const place = [cur[0], ...losers.sort((x, y) => y.r - x.r).map((l) => l.n)];
                    const show = [slots]; rounds.forEach((r) => show.push(new Array(r.length).fill(null)));
                    const { ctx, w, h } = this.makeCanvas(420), R = show.length, cw = (w - 8) / R, P = new Particles(); let hi = null, jolt = 0;
                    const stop = loop((dt) => {
                        ctx.save(); felt(ctx, w, h); if (jolt > 0.2) { ctx.translate(rnd(-jolt, jolt), rnd(-jolt, jolt)); jolt *= 0.85; }
                        show.forEach((col, r) => col.forEach((nm, i) => {
                            const ch = h / col.length, x = 4 + r * cw, bw = cw - 8, bh = Math.min(26, ch - 6), y = (i + 0.5) * ch - bh / 2, on = hi && ((hi.r === r && (i >> 1) === hi.m) || (hi.r + 1 === r && i === hi.m && nm));
                            ctx.fillStyle = r === R - 1 && nm ? "#f4c430" : nm ? "#12523f" : "rgba(0,0,0,.25)"; ctx.strokeStyle = on ? "#f4c430" : "#2a3542"; ctx.lineWidth = on ? 3 : 1;
                            ctx.beginPath(); ctx.roundRect(x, y, bw, bh, 6); ctx.fill(); ctx.stroke();
                            ctx.fillStyle = r === R - 1 && nm ? "#10151a" : nm ? "#fff" : "#6b7785"; ctx.font = `600 ${Math.max(9, Math.min(12, bw / 7))}px sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
                            ctx.fillText(nm ? this.short(nm, Math.max(4, Math.floor(bw / 7))) : r === 0 ? "BYE" : "?", x + bw / 2, y + bh / 2);
                        }));
                        P.draw(ctx, dt); ctx.restore();
                    });
                    try {
                        for (let r = 0; r < rounds.length; r += 1) {
                            for (let m = 0; m < rounds[r].length; m += 1) {
                                const mt = rounds[r][m]; hi = { r, m };
                                if (!mt.bye) await this.wait(700, id);
                                show[r + 1][m] = mt.win;
                                if (!mt.bye) { P.burst(4 + (r + 1) * cw + cw / 2, (m + 0.5) * (h / show[r + 1].length), 14, "#f4c430"); jolt = 3.5; buzz(15); Sound.win(); }
                            }
                            await this.wait(300, id);
                        }
                        hi = null; await this.wait(500, id);
                    } finally { stop(); }
                    winners.splice(0, winners.length, ...place.slice(0, winners.length));
                    for (let k = 0; k < winners.length; k += 1) { this.announce(winners[k], k); await this.wait(350, id); }
                },

                async runPlinko(names, winners, id) {
                    const pool = shuffle(names).slice(0, 20), { ctx, w, h } = this.makeCanvas(460), P = new Particles();
                    const B = 7, bw = w / B, floorY = h - 46, pegs = [], N = winners.length;
                    for (let r = 0; r < 8; r += 1) { const y = 70 + r * ((floorY - 110) / 7); for (let i = 0; i <= B; i += 1) { const x = (i + (r % 2 ? 0.5 : 0)) * bw; if (x <= w) pegs.push({ x, y, f: 0 }); } }
                    const queue = pool.slice(), chips = [], cnt = new Array(B).fill(0), landed = [], chosen = []; let spawnT = 0, jolt = 0, idx = 0;
                    await this.frames(id, (dt) => {
                        spawnT += dt; if (queue.length && spawnT > 320) { spawnT = 0; const nm = queue.shift(); chips.push({ name: nm, x: rnd(w * 0.35, w * 0.65), y: 12, vx: rnd(-30, 30), vy: 0, r: 11, st: 0, color: this.CHIP_COLORS[idx++ % 5], bin: 0 }); }
                        for (let sub = 0; sub < 3; sub += 1) {
                            const s = dt / 3000;
                            chips.forEach((c) => {
                                if (c.st) return; c.vy += 1000 * s; c.x += c.vx * s; c.y += c.vy * s;
                                if (c.x < c.r) { c.x = c.r; c.vx = Math.abs(c.vx) * 0.6; } if (c.x > w - c.r) { c.x = w - c.r; c.vx = -Math.abs(c.vx) * 0.6; }
                                pegs.forEach((p) => {
                                    const dx = c.x - p.x, dy = c.y - p.y, d = Math.hypot(dx, dy), min = c.r + 4;
                                    if (d < min && d > 0) { const nx = dx / d, ny = dy / d; c.x = p.x + nx * min; c.y = p.y + ny * min; const vn = c.vx * nx + c.vy * ny; if (vn < 0) { c.vx -= 1.55 * vn * nx; c.vy -= 1.55 * vn * ny; c.vx += rnd(-20, 20); p.f = 1; P.burst(p.x, p.y, 2, "#fff"); jolt = Math.max(jolt, 0.7); } }
                                });
                                if (c.y + c.r >= floorY) {
                                    c.st = 1; c.bin = Math.max(0, Math.min(B - 1, Math.floor(c.x / bw))); c.x = (c.bin + 0.5) * bw + rnd(-8, 8); c.y = h - 18 - cnt[c.bin] * 5; cnt[c.bin] += 1; landed.push(c);
                                    if (c.bin >= 2 && c.bin <= 4 && chosen.length < N) { chosen.push(c.name); this.announce(c.name, chosen.length - 1); P.burst(c.x, floorY, 24, "#f4c430"); jolt = 4; buzz(30); }
                                }
                            });
                        }
                        ctx.save(); felt(ctx, w, h); if (jolt > 0.15) { ctx.translate(rnd(-jolt, jolt), rnd(-jolt, jolt)); jolt *= 0.85; }
                        for (let i = 0; i < B; i += 1) { ctx.fillStyle = i >= 2 && i <= 4 ? "rgba(244,196,48,.22)" : "rgba(0,0,0,.25)"; ctx.fillRect(i * bw, floorY, bw, h - floorY); ctx.fillStyle = "#e9c46a"; ctx.font = "16px sans-serif"; ctx.textAlign = "center"; ctx.fillText(i >= 2 && i <= 4 ? "★" : "·", (i + 0.5) * bw, floorY + 16); ctx.strokeStyle = "#b8860b"; ctx.beginPath(); ctx.moveTo(i * bw, floorY); ctx.lineTo(i * bw, h); ctx.stroke(); }
                        pegs.forEach((p) => { p.f = Math.max(0, p.f - dt / 200); ctx.fillStyle = p.f > 0 ? "#f4c430" : "#cfd8dc"; ctx.beginPath(); ctx.arc(p.x, p.y, 4 + p.f * 2, 0, 6.283); ctx.fill(); });
                        chips.forEach((c) => this.drawChip(ctx, c.x, c.y, c.r, c.name, c.color, c.st && c.bin >= 2 && c.bin <= 4));
                        P.draw(ctx, dt); ctx.restore();
                        return landed.length === pool.length && !P.active;
                    });
                    const rest = landed.filter((c) => !chosen.includes(c.name)).sort((a, b) => Math.abs(a.bin - 3) - Math.abs(b.bin - 3));
                    while (chosen.length < N && rest.length) { const c = rest.shift(); chosen.push(c.name); this.announce(c.name, chosen.length - 1); await this.wait(350, id); }
                    winners.splice(0, winners.length, ...chosen);
                },

                async runChests(names, winners, id) {
                    const N = winners.length, total = Math.min(24, Math.max(9, names.length, N)), contents = shuffle([...winners, ...new Array(total - N).fill(null)]);
                    const grid = mk("div", "chest-grid"); let found = 0; const order = [];
                    contents.forEach((c) => {
                        const b = btn("🎁", "chest", () => {
                            if (b.classList.contains("open") || found >= N || id !== this.runId) return;
                            b.classList.add("open"); const r = b.getBoundingClientRect(), g = grid.getBoundingClientRect();
                            if (c) { b.classList.add("win"); b.textContent = c; found += 1; order.push(c); this.announce(c, found - 1); domBurst(grid, r.left - g.left + r.width / 2, r.top - g.top + r.height / 2, 18); }
                            else { b.textContent = "🍀"; domBurst(grid, r.left - g.left + r.width / 2, r.top - g.top + r.height / 2, 5); buzz(10); }
                        });
                        b.setAttribute("aria-label", "Mystery chest"); grid.append(b);
                    });
                    this.el.stage.replaceChildren(grid); Notify.warning(`Tap the chests — ${N} hide a winner.`);
                    while (found < N) await this.wait(200, id);
                    winners.splice(0, winners.length, ...order);
                },

                async runRoles(names, winners, id) {
                    const roles = shuffle(winners.map((_, i) => ROLES[i] || "Member" + (i - ROLES.length + 1)));
                    const mat = mk("div", "roles-matrix"), rows = winners.map(() => { const row = mk("div", "roles-row"), a = mk("div", "roles-cell", "???"), b = mk("div", "roles-cell", "—"); row.append(a, b); mat.append(row); return { a, b }; });
                    this.el.stage.replaceChildren(mat);
                    for (let k = 0; k < winners.length; k += 1) {
                        rows[k].a.textContent = winners[k]; this.announce(winners[k], k);
                        let d = 40; const end = performance.now() + 1100;
                        while (performance.now() < end) { rows[k].b.textContent = pick(ROLES); await this.wait(d, id); d *= 1.12; }
                        rows[k].b.textContent = roles[k]; rows[k].a.classList.add("landed"); rows[k].b.classList.add("landed");
                        const r = rows[k].b.getBoundingClientRect(), s = mat.getBoundingClientRect(); domBurst(this.el.stage, r.left - this.el.stage.getBoundingClientRect().left + r.width / 2, r.top - this.el.stage.getBoundingClientRect().top + r.height / 2, 14);
                        const pod = this.el.podium.children[k]; if (pod) pod.append(mk("span", "podium-role", "· " + roles[k]));
                        void s; await this.wait(300, id);
                    }
                }
            });
        };

        return { init() { craps(); crash(); pokerDice(); moneyWheel(); installDraw(); } };
    })();

    /* =========================================================================
       22. APP BOOTSTRAP
       ========================================================================= */
    /* =========================================================================
       21c. SHOP, ROOM CHAT + REACTIONS, COMMUNITY JACKPOT VAULT
       All three live under rooms/{code}/... in the same hardcoded Firebase DB.
       ========================================================================= */
    const CATALOG = {
        avatar: [
            { id: "fox", icon: "\u{1F98A}", name: "Fox", price: 300 }, { id: "robot", icon: "\u{1F916}", name: "Robot", price: 450 },
            { id: "dragon", icon: "\u{1F409}", name: "Dragon", price: 600 }, { id: "unicorn", icon: "\u{1F984}", name: "Unicorn", price: 800 },
            { id: "crown", icon: "\u{1F451}", name: "Crown", price: 1000 }
        ],
        border: [
            { id: "gold", icon: "\u{1F7E1}", name: "Gold Border", price: 250, css: "bd-gold" },
            { id: "emerald", icon: "\u{1F7E2}", name: "Emerald Border", price: 400, css: "bd-emerald" },
            { id: "ruby", icon: "\u{1F534}", name: "Ruby Border", price: 500, css: "bd-ruby" }
        ],
        badge: [
            { id: "roller", icon: "\u2660\uFE0F", name: "High Roller", price: 200 }, { id: "lucky", icon: "\u{1F340}", name: "Lucky", price: 350 },
            { id: "diamond", icon: "\u{1F48E}", name: "Diamond", price: 700 }
        ]
    };
    const SLOT_LABEL = { avatar: "Avatars", border: "Gold & Colored Borders", badge: "Chat Badges" };
    const findItem = (slot, id) => (CATALOG[slot] || []).find((i) => i.id === id) || null;

    const Cosmetics = {
        of(username) { return (Room.get(username) || {}).cosmetics || {}; },
        owns(username, slot, id) { const c = this.of(username); return !!(c.owned && c.owned[`${slot}:${id}`]); },
        icon(username, slot) { const i = findItem(slot, this.of(username)[slot]); return i ? i.icon : ""; },
        applyHud() {
            const av = document.getElementById("display-avatar"), bd = document.getElementById("display-badge");
            if (!av || !State.username) return;
            const c = this.of(State.username), a = findItem("avatar", c.avatar), b = findItem("border", c.border), g = findItem("badge", c.badge);
            av.textContent = a ? a.icon : State.username.slice(0, 2).toUpperCase();
            av.className = "top-panel-avatar" + (b ? " " + b.css : "");
            bd.hidden = !g; bd.textContent = g ? g.icon : "";
        },
        async buy(slot, id) {
            const item = findItem(slot, id), u = State.username;
            if (!item || !u || !Room.playersRef) return;
            const res = await Room.playersRef.child(u).transaction((p) => {
                if (!p) return p;
                const c = (p.cosmetics = p.cosmetics || {}); c.owned = c.owned || {};
                if (c.owned[`${slot}:${id}`] || (p.balance || 0) < item.price) return;
                p.balance -= item.price; c.owned[`${slot}:${id}`] = true; c[slot] = id; p.updatedAt = Date.now();
                return p;
            });
            if (res.committed) { Sound.win(); Notify.success(`Unlocked ${item.name}!`); } else Notify.error("Not enough chips, or already owned.");
        },
        equip(slot, id) {
            if (!State.username || !Room.playersRef) return;
            if (id && !this.owns(State.username, slot, id)) return;
            Room.playersRef.child(State.username).child("cosmetics").child(slot).set(id || null);
        }
    };

    const Shop = {
        init() {
            const modal = document.getElementById("shop-modal");
            document.getElementById("btn-open-shop").addEventListener("click", () => { modal.hidden = false; this.render(); });
            document.getElementById("btn-shop-close").addEventListener("click", () => { modal.hidden = true; });
            modal.addEventListener("click", (e) => { if (e.target === modal) modal.hidden = true; });
            PubSub.on("players-updated", () => { Cosmetics.applyHud(); if (!modal.hidden) this.render(); });
        },
        render() {
            const body = document.getElementById("shop-body"), c = Cosmetics.of(State.username);
            document.getElementById("shop-balance").textContent = State.balance.toLocaleString("en-US");
            body.textContent = "";
            Object.keys(CATALOG).forEach((slot) => {
                const sec = document.createElement("div"); sec.className = "shop-section";
                const h = document.createElement("h3"); h.textContent = SLOT_LABEL[slot]; sec.appendChild(h);
                CATALOG[slot].forEach((item) => {
                    const owned = Cosmetics.owns(State.username, slot, item.id), on = c[slot] === item.id;
                    const row = document.createElement("div"); row.className = "shop-item";
                    const ic = document.createElement("span"); ic.className = "si-icon"; ic.textContent = item.icon;
                    const nm = document.createElement("span"); nm.className = "si-name"; nm.textContent = item.name;
                    const bt = document.createElement("button"); bt.type = "button"; bt.className = "btn btn-small " + (owned ? "btn-secondary" : "btn-primary");
                    if (!owned) { bt.textContent = `${item.price} chips`; bt.disabled = !State.canAfford(item.price); bt.addEventListener("click", () => Cosmetics.buy(slot, item.id)); }
                    else { bt.textContent = on ? "Unequip" : "Equip"; bt.addEventListener("click", () => Cosmetics.equip(slot, on ? null : item.id)); }
                    row.append(ic, nm, bt); sec.appendChild(row);
                });
                body.appendChild(sec);
            });
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
            const u = document.createElement("b"); u.className = "mu"; u.textContent = `${m.a || ""} ${m.u}${m.b ? " " + m.b : ""}`.trim();
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
            this.chatRef.push({ u: State.username, t, a: Cosmetics.icon(State.username, "avatar"), b: Cosmetics.icon(State.username, "badge"), ts: window.firebase.database.ServerValue.TIMESTAMP });
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
        start() { Chat.start(); Jackpot.start(); },
        stop() { Chat.stop(); Jackpot.stop(); }
    };


    /* =========================================================================
       BLACK WIDOW POKER — player vs player, synced at rooms/<code>/bw
       ========================================================================= */
    const BW = {
        SB: 5, BB: 10, RAISE: 10, MAX_RAISES: 3, MAX_SEATS: 6, MAX_DRAW: 3, IDLE_MS: 45000,
        ref: null, cb: null, tick: null, g: { phase: "lobby" }, hid: null, paid: 0, dealt: null, sel: new Set(),
        CATS: ["High card", "Pair", "Two pair", "Three of a kind", "Straight", "Flush", "Full house", "Four of a kind", "Straight flush", "Five of a kind"],
        PHASES: { bet1: "Betting round 1", draw: "Card exchange", bet2: "Betting round 2", done: "Showdown" },
        R: "23456789TJQKA", S: ["\u2660", "\u2665", "\u2666", "\u2663"], WILD: 10,
        $(id) { return document.getElementById(id); },
        isActive(g) { return g.phase === "bet1" || g.phase === "draw" || g.phase === "bet2"; },
        isBet(g) { return g.phase === "bet1" || g.phase === "bet2"; },
        store(key, val) {
            try { if (val === undefined) return window.sessionStorage.getItem(key); window.sessionStorage.setItem(key, val); } catch (e) { /* storage unavailable */ }
            return null;
        },
        init() {
            const on = (id, fn) => this.$(id).addEventListener("click", fn);
            on("bw-join", () => this.join());
            on("bw-leave", () => this.leave());
            on("bw-deal", () => this.deal());
            on("bw-fold", () => this.act("fold"));
            on("bw-call", () => this.act("call"));
            on("bw-raise", () => this.act("raise"));
            on("bw-draw", () => this.exchange());
            on("bw-kick", () => this.kick());
        },
        start() {
            this.stop(); if (!Room.db || !Room.code) return;
            this.ref = Room.db.ref(`rooms/${Room.code}/bw`);
            this.cb = (s) => { this.g = s.val() || { phase: "lobby" }; this.sync(); this.render(); };
            this.ref.on("value", this.cb);
            this.tick = window.setInterval(() => { if (this.isActive(this.g)) this.renderControls(); }, 1000);
        },
        stop() {
            if (this.ref && this.cb) this.ref.off("value", this.cb);
            if (this.tick) window.clearInterval(this.tick);
            this.ref = this.cb = this.tick = null; this.g = { phase: "lobby" }; this.hid = null; this.sel.clear();
        },
        /* --- seats --- */
        join() {
            const me = State.username; if (!this.ref || !me) return;
            if (this.isActive(this.g)) return Notify.warning("Wait for the current hand to finish.");
            this.ref.child("seats").transaction((s) => {
                s = s || {}; if (s[me]) return s;
                if (Object.keys(s).length >= this.MAX_SEATS) return;
                s[me] = true; return s;
            });
        },
        leave() {
            const me = State.username, g = this.g; if (!this.ref || !me) return;
            if (this.isActive(g) && (g.order || []).includes(me) && !(g.folded || {})[me]) return Notify.warning("Fold or finish the hand before leaving.");
            this.ref.child("seats/" + me).remove();
        },
        /* --- deal: 5 cards each from one shuffled deck; the rest stays in the shared state for the exchange --- */
        deal() {
            if (!this.ref) return;
            this.ref.transaction((v) => {
                v = v || {}; const names = Object.keys(v.seats || {});
                if (this.isActive(v) || names.length < 2) return;
                const rot = (v.rot || 0) + 1, order = names.map((_, i) => names[(i + rot) % names.length]);
                const deck = Array.from({ length: 52 }, (_, i) => i);
                for (let i = 51; i > 0; i -= 1) { const j = Math.floor(Math.random() * (i + 1));[deck[i], deck[j]] = [deck[j], deck[i]]; }
                const hands = {}; order.forEach((u, i) => { hands[u] = deck.slice(i * 5, i * 5 + 5); });
                return {
                    seats: v.seats, rot, phase: "bet1", hid: Date.now(), order, hands, deck, dpos: order.length * 5,
                    in: { [order[0]]: this.SB, [order[1]]: this.BB }, cur: this.BB, raises: 0, turn: 2 % order.length,
                    acted: { _: 0 }, folded: { _: 0 }, drawn: { _: 0 }, turnAt: Date.now(), res: null
                };
            });
        },
        nextAlive(v, from) { let t = from; do { t = (t + 1) % v.order.length; } while (v.folded[v.order[t]]); return t; },
        firstAlive(v) { let t = 0; while (v.folded[v.order[t]]) t += 1; return t; },
        /* --- betting: fold / check-call / raise (fixed step, capped) --- */
        act(type, who) {
            const me = who || State.username; if (!this.ref || !me) return;
            if (!who) {
                const g = this.g, toCall = (g.cur || 0) - ((g.in || {})[me] || 0), need = type === "raise" ? toCall + this.RAISE : type === "call" ? toCall : 0;
                if (need > State.balance) return Notify.error("Not enough chips for that action.");
            }
            this.ref.transaction((v) => {
                if (!v || !this.isBet(v) || v.order[v.turn] !== me) return;
                if (who && Date.now() - (v.turnAt || 0) < this.IDLE_MS) return;
                v.in = v.in || {}; v.folded = v.folded || {}; v.acted = v.acted || {};
                if (type === "fold") v.folded[me] = 1;
                else if (type === "raise") {
                    if ((v.raises || 0) >= this.MAX_RAISES) return;
                    v.cur += this.RAISE; v.raises = (v.raises || 0) + 1; v.in[me] = v.cur; v.acted = { [me]: 1 };
                } else { v.in[me] = v.cur; v.acted[me] = 1; }
                return this.advance(v);
            }).then((r) => this.settle(r)).catch(() => { });
        },
        advance(v) {
            const alive = v.order.filter((u) => !v.folded[u]);
            if (alive.length === 1) return this.finish(v, alive);
            if (!alive.every((u) => v.acted[u] && (v.in[u] || 0) === v.cur)) { v.turn = this.nextAlive(v, v.turn); v.turnAt = Date.now(); return v; }
            if (v.phase === "bet2") return this.finish(v, alive);
            v.phase = "draw"; v.drawn = { _: 0 }; v.turn = this.firstAlive(v); v.turnAt = Date.now(); return v;
        },
        /* --- exchange: each live player, in turn, swaps up to 3 cards (or stands pat) --- */
        exchange(who) {
            const me = who || State.username, idxs = who ? [] : [...this.sel].sort((a, b) => a - b); if (!this.ref || !me) return;
            this.ref.transaction((v) => {
                if (!v || v.phase !== "draw" || v.order[v.turn] !== me) return;
                if (who && Date.now() - (v.turnAt || 0) < this.IDLE_MS) return;
                v.drawn = v.drawn || {}; v.folded = v.folded || {};
                const hand = v.hands[me].slice(), k = Math.min(idxs.length, this.MAX_DRAW);
                for (let i = 0; i < k; i += 1) { hand[idxs[i]] = v.deck[v.dpos]; v.dpos += 1; }
                v.hands[me] = hand; v.drawn[me] = k;
                const alive = v.order.filter((u) => !v.folded[u]);
                if (alive.every((u) => v.drawn[u] !== undefined)) { v.phase = "bet2"; v.acted = { _: 0 }; v.raises = 0; v.turn = this.firstAlive(v); }
                else v.turn = this.nextAlive(v, v.turn);
                v.turnAt = Date.now(); return v;
            }).then(() => this.sel.clear()).catch(() => { });
        },
        kick() {
            const g = this.g, u = g.order && g.order[g.turn];
            if (!u || u === State.username || !this.isActive(g)) return;
            if (Date.now() - (g.turnAt || 0) < this.IDLE_MS) return Notify.warning("Give them a little longer.");
            if (g.phase === "draw") this.exchange(u); else this.act("fold", u);
        },
        finish(v, alive) {
            const pot = v.order.reduce((a, u) => a + (v.in[u] || 0), 0), cats = {};
            let winners = alive, best = "Everyone else folded";
            if (alive.length > 1) {
                const sc = alive.map((u) => this.best(v.hands[u])), top = sc.reduce((a, b) => (this.cmp(a, b) >= 0 ? a : b));
                winners = alive.filter((u, i) => this.cmp(sc[i], top) === 0); best = this.CATS[top[0]];
                alive.forEach((u, i) => { cats[u] = this.CATS[sc[i][0]]; });
            }
            const each = Math.floor(pot / winners.length), shares = {};
            winners.forEach((u, i) => { shares[u] = each + (i === 0 ? pot - each * winners.length : 0); });
            v.phase = "done"; v.res = { winners, pot, best, cats, shares, show: alive.length > 1 ? 1 : 0 }; return v;
        },
        settle(r) {
            if (!r || !r.committed) return;
            const v = r.snapshot.val(); if (!v || v.phase !== "done" || !v.res) return;
            Object.keys(v.res.shares).forEach((u) => Room.playersRef.child(u).child("balance").transaction((b) => (b == null ? b : b + v.res.shares[u])));
        },
        /* --- hand evaluation (Queen of Spades = wild: tries all 52 substitutions, duplicates allowed so five of a kind exists) --- */
        eval5(cs) {
            const rk = cs.map((c) => c % 13).sort((a, b) => b - a), fl = cs.every((c) => ((c / 13) | 0) === ((cs[0] / 13) | 0)), cnt = {};
            rk.forEach((r) => { cnt[r] = (cnt[r] || 0) + 1; });
            const gr = Object.keys(cnt).map(Number).sort((a, b) => cnt[b] - cnt[a] || b - a), shape = gr.map((r) => cnt[r]).join("");
            const uniq = new Set(rk).size === 5, st = uniq && rk[0] - rk[4] === 4, wheel = uniq && rk.join() === "12,3,2,1,0", hi = wheel ? 3 : rk[0];
            let cat = 0;
            if (shape === "5") cat = 9; else if (st || wheel) cat = fl ? 8 : 4; else if (shape === "41") cat = 7; else if (shape === "32") cat = 6;
            else if (fl) cat = 5; else if (shape === "311") cat = 3; else if (shape === "221") cat = 2; else if (shape === "2111") cat = 1;
            return [cat, ...((st || wheel) ? [hi] : gr)];
        },
        best(hand) {
            const w = hand.indexOf(this.WILD); if (w < 0) return this.eval5(hand);
            let top = null;
            for (let c = 0; c < 52; c += 1) { const h = hand.slice(); h[w] = c; const s = this.eval5(h); if (!top || this.cmp(s, top) > 0) top = s; }
            return top;
        },
        cmp(a, b) { for (let i = 0; i < Math.max(a.length, b.length); i += 1) { const d = (a[i] || 0) - (b[i] || 0); if (d) return d; } return 0; },
        /* --- chips: pay blinds/calls as they appear in the shared state (persisted per hand so a reload never double-charges) --- */
        sync() {
            const g = this.g, me = State.username; if (!me || !g.hid) return;
            if (this.hid !== g.hid) { this.hid = g.hid; this.paid = Number(this.store(`bw-paid-${Room.code}-${g.hid}-${me}`)) || 0; this.sel.clear(); }
            const owed = ((g.in || {})[me] || 0) - this.paid;
            if (owed > 0) { State.debit(Math.min(owed, State.balance)); this.paid += owed; this.store(`bw-paid-${Room.code}-${g.hid}-${me}`, String(this.paid)); }
            const doneKey = `bw-done-${Room.code}-${g.hid}-${me}`;
            if (g.phase === "done" && g.res && (g.order || []).includes(me) && !this.store(doneKey)) {
                this.store(doneKey, "1");
                const share = (g.res.shares || {})[me] || 0, stake = this.paid;
                window.setTimeout(() => State.recordRound(stake, share), 1500);
                if (share > 0) { Effects.celebrate(`\u2660 ${g.res.best} \u2014 you win ${share}!`); this.sparkle(); Notify.success(`You won ${share} chips.`); }
            }
        },
        sparkle() {
            for (let i = 0; i < 36; i += 1) {
                const s = document.createElement("span"); s.className = "spark"; s.style.left = (30 + Math.random() * 40) + "vw"; s.style.top = (30 + Math.random() * 30) + "vh";
                s.style.setProperty("--sx", ((Math.random() - 0.5) * 320) + "px"); s.style.setProperty("--sy", ((Math.random() - 0.5) * 320) + "px");
                s.addEventListener("animationend", () => s.remove()); document.body.appendChild(s);
            }
        },
        card(c, hidden) {
            const d = document.createElement("div"); d.className = "bw-card";
            if (hidden) { d.classList.add("back"); return d; }
            const s = (c / 13) | 0, rk = this.R[c % 13], b = document.createElement("b"), i = document.createElement("i");
            b.textContent = rk === "T" ? "10" : rk; i.textContent = this.S[s]; d.append(b, i);
            if (s === 1 || s === 2) d.classList.add("red");
            if (c === this.WILD) d.classList.add("wild");
            return d;
        },
        toggle(ci) {
            if (this.sel.has(ci)) this.sel.delete(ci);
            else if (this.sel.size < this.MAX_DRAW) this.sel.add(ci);
            else Notify.warning(`You can swap up to ${this.MAX_DRAW} cards.`);
            this.render();
        },
        render() { this.renderSeats(); this.renderControls(); },
        renderSeats() {
            const g = this.g, me = State.username, el = this.$("bw-seats"), active = this.isActive(g), inHand = active || (g.phase === "done" && !!g.res);
            const names = inHand ? g.order : Object.keys(g.seats || {}), canPick = g.phase === "draw" && g.order[g.turn] === me, fresh = this.dealt !== g.hid;
            if (!canPick) this.sel.clear();
            el.textContent = "";
            names.forEach((u, i) => {
                const folded = inHand && !!(g.folded || {})[u], won = g.phase === "done" && g.res.winners.includes(u), d = document.createElement("div");
                d.className = "bw-seat" + (u === me ? " me" : "") + (active && g.order[g.turn] === u ? " turn" : "") + (folded ? " out" : "") + (won ? " win" : "");
                const n = document.createElement("div"); n.className = "bw-name"; n.append(u + (u === me ? " (you)" : ""));
                const tag = (t) => { const s = document.createElement("span"); s.className = "bw-tag"; s.textContent = t; n.appendChild(s); };
                if (inHand) {
                    tag(`in ${(g.in || {})[u] || 0}`); if (i === 0) tag("SB"); if (i === 1) tag("BB"); if (folded) tag("folded");
                    const dr = (g.drawn || {})[u]; if (dr !== undefined && g.phase !== "bet1") tag(dr ? `swapped ${dr}` : "stood pat");
                    const cat = ((g.res || {}).cats || {})[u]; if (g.phase === "done" && cat) tag(cat);
                }
                d.appendChild(n);
                if (inHand) {
                    const h = document.createElement("div"), face = u === me || (g.phase === "done" && g.res.show && !folded); h.className = "bw-hand";
                    (g.hands[u] || []).forEach((c, ci) => {
                        const cd = this.card(c, !face);
                        if (fresh) { cd.classList.add("deal"); cd.style.animationDelay = (ci * 60) + "ms"; }
                        if (u === me && canPick) { cd.classList.add("pick"); if (this.sel.has(ci)) cd.classList.add("sel"); cd.addEventListener("click", () => this.toggle(ci)); }
                        h.appendChild(cd);
                    });
                    d.appendChild(h);
                }
                el.appendChild(d);
            });
            this.dealt = g.hid;
        },
        renderControls() {
            const g = this.g, me = State.username, seats = g.seats || {}, seated = !!seats[me], nSeats = Object.keys(seats).length, active = this.isActive(g);
            const inHand = active || (g.phase === "done" && !!g.res), who = active ? g.order[g.turn] : null, myTurn = who === me, betting = this.isBet(g);
            const toCall = active ? Math.max(0, (g.cur || 0) - ((g.in || {})[me] || 0)) : 0, iFolded = active && !!(g.folded || {})[me];
            const pot = inHand ? g.order.reduce((a, u) => a + ((g.in || {})[u] || 0), 0) : 0;
            this.$("bw-pot").textContent = "Pot " + pot.toLocaleString("en-US");
            this.$("bw-phase").textContent = this.PHASES[g.phase] || "Waiting for players";
            let msg;
            if (g.phase === "done" && g.res) msg = `${g.res.winners.join(", ")} won ${g.res.pot} with ${g.res.best}. Deal again when ready.`;
            else if (iFolded) msg = `You folded. Waiting for ${who}\u2026`;
            else if (betting) msg = myTurn ? `Your turn \u2014 ${toCall ? "call " + toCall : "check"}, raise or fold.` : `Waiting for ${who}\u2026`;
            else if (g.phase === "draw") msg = myTurn ? `Tap up to ${this.MAX_DRAW} cards to swap, then confirm \u2014 or stand pat.` : `${who} is choosing cards\u2026`;
            else msg = nSeats >= 2 ? `${nSeats} seated. Press Deal hand to start.` : `${nSeats} seated. Two players needed to deal.`;
            this.$("bw-status").textContent = msg;
            const join = this.$("bw-join"); join.hidden = seated; join.disabled = active || nSeats >= this.MAX_SEATS;
            this.$("bw-leave").hidden = !seated;
            const deal = this.$("bw-deal"); deal.disabled = active || nSeats < 2 || !seated; deal.textContent = g.phase === "done" ? "Deal next hand" : "Deal hand";
            const canBet = betting && myTurn, capped = (g.raises || 0) >= this.MAX_RAISES;
            this.$("bw-fold").disabled = !canBet;
            this.$("bw-call").disabled = !canBet || toCall > State.balance; this.$("bw-call").textContent = toCall ? `Call ${toCall}` : "Check";
            this.$("bw-raise").disabled = !canBet || capped || toCall + this.RAISE > State.balance; this.$("bw-raise").textContent = capped ? "Raise cap" : `Raise ${this.RAISE}`;
            const dr = this.$("bw-draw"); dr.hidden = g.phase !== "draw" || !seated; dr.disabled = !(g.phase === "draw" && myTurn);
            dr.textContent = this.sel.size ? `Exchange ${this.sel.size} card${this.sel.size > 1 ? "s" : ""}` : "Stand pat";
            this.$("bw-kick").hidden = !(active && seated && !myTurn && Date.now() - (g.turnAt || 0) > this.IDLE_MS);
        }
    };
    BW.init();
    { const s0 = Social.start, s1 = Social.stop; Social.start = function () { s0.call(Social); BW.start(); }; Social.stop = function () { s1.call(Social); BW.stop(); }; }

    function bindGameNavigation() {
        DOM.gameSelector.querySelectorAll(".btn-game-select").forEach((btn) => {
            btn.addEventListener("click", () => Router.selectGame(btn.dataset.game));
        });
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

    document.addEventListener("DOMContentLoaded", init);
})();