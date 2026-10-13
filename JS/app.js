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
        createPlayer(username, startingChips, seed) {
            const now = Date.now();
            const st = (seed && seed.stats) || {};
            return this.playersRef.child(username).transaction((current) => {
                if (current !== null) return; // abort — username already taken
                return {
                    username,
                    balance: startingChips,
                    createdAt: (seed && Number(seed.createdAt)) || now,
                    updatedAt: (seed && Number(seed.updatedAt)) || now,
                    deviceId: Storage.getDeviceId(),
                    stats: {
                        gamesPlayed: Number(st.gamesPlayed) || 0,
                        totalWagered: Number(st.totalWagered) || 0,
                        netProfit: Number(st.netProfit) || 0
                    }
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

        /**
         * Atomic, delta-based round settlement for ANY player. Unlike persistPlayer it never
         * writes an absolute balance, so it cannot clobber jackpot shares, pot payouts,
         * mission rewards or admin edits that landed in the meantime.
         */
        applyRound(username, d) {
            if (!this.playersRef || !username) return Promise.resolve();
            return this.playersRef.child(username).transaction((player) => {
                if (!player) return player; // null on a cold cache makes Firebase retry with the server value
                player.balance = Math.max(0, Math.round((player.balance || 0) + (d.balance || 0)));
                player.updatedAt = Date.now();
                player.stats = player.stats || { gamesPlayed: 0, totalWagered: 0, netProfit: 0 };
                player.stats.gamesPlayed = (player.stats.gamesPlayed || 0) + (d.gamesPlayed || 0);
                player.stats.totalWagered = (player.stats.totalWagered || 0) + (d.totalWagered || 0);
                player.stats.netProfit = (player.stats.netProfit || 0) + (d.netProfit || 0);
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
       11b. CARD FX — shared dealing engine (Blackjack, La Viuda Negra)
       Cards are queued while a table renders, then flushed once: each one glides from the shoe to its
       slot along a small arc (translate3d + rotate, GPU composited) in true dealing order, then turns over.
       ========================================================================= */
    const CardFX = {
        queue: [],
        until: 0,
        reduced() { return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches); },
        add(el, opts) { this.queue.push(Object.assign({ el, round: 0, ord: 0 }, opts)); },

        /** While a deal is in flight, postpone re-renders (they would rebuild the DOM and cancel the animation). */
        deferRender(owner) {
            const left = this.until - performance.now();
            if (left <= 0) return false;
            if (!owner._fxTimer) owner._fxTimer = window.setTimeout(() => { owner._fxTimer = null; owner.render(); }, left + 40);
            return true;
        },

        flush(origin, step) {
            const q = this.queue.splice(0);
            if (!q.length) return;
            step = step || 170;
            q.sort((a, b) => (a.round - b.round) || (a.ord - b.ord));   // round-robin: everyone's first card, then everyone's second...
            const o = origin && origin.getBoundingClientRect();
            let end = 0;
            q.forEach((it, k) => {
                const d = q.length > 1 ? k * step : 0;
                end = Math.max(end, d + (it.stay ? 450 : 1050));
                this.fly(it, o, d);
            });
            this.until = performance.now() + end;
        },

        fly(it, o, delay) {
            const el = it.el, reveal = it.reveal;
            if (this.reduced() || !el.animate) { if (reveal) reveal(); return; }
            const done = () => { el.style.zIndex = ""; el.style.willChange = ""; };
            const flip = () => {
                if (!reveal) { done(); return; }
                if (!it.flip) { reveal(); done(); return; }
                const P = "perspective(520px) ";
                const a1 = el.animate([{ transform: P + "rotateY(0deg)" }, { transform: P + "rotateY(90deg)" }], { duration: 130, easing: "ease-in", fill: "forwards" });
                a1.finished.then(() => {
                    reveal();
                    const a2 = el.animate([{ transform: P + "rotateY(-90deg)" }, { transform: P + "rotateY(0deg)" }], { duration: 170, easing: "ease-out", fill: "forwards" });
                    return a2.finished.then(() => { a1.cancel(); a2.cancel(); });
                }).then(done, done);
            };
            if (it.stay) { el.style.zIndex = "30"; window.setTimeout(flip, delay + 250); return; }

            const r = el.getBoundingClientRect();
            let dx = 0, dy = -90;
            if (o && o.width) { dx = o.left + o.width / 2 - (r.left + r.width / 2); dy = o.top + o.height / 2 - (r.top + r.height / 2); }
            const tilt = Math.random() * 14 - 7;
            el.style.zIndex = "30"; el.style.willChange = "transform, opacity";
            const slide = el.animate([
                { transform: `translate3d(${dx}px,${dy}px,0) rotate(${-tilt * 2}deg) scale(.72)`, opacity: 0, offset: 0 },
                { opacity: 1, offset: 0.1 },
                { transform: `translate3d(${dx * 0.4}px,${dy * 0.4 - 18}px,0) rotate(${tilt}deg) scale(1.08)`, opacity: 1, offset: 0.5 },
                { transform: "translate3d(0,0,0) rotate(0deg) scale(1)", opacity: 1, offset: 1 }
            ], { duration: 640, delay: delay, easing: "cubic-bezier(.2,.75,.25,1)", fill: "backwards" });
            window.setTimeout(() => Sound.card(), delay + 90);
            slide.finished.then(flip, flip);
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
       12b. TABLE LOBBIES (shared by Blackjack and Black Widow Poker)
       A table lives at rooms/<code>/<bj|bw> and always has:
         phase  "lobby" -> game phases -> back to "lobby"
         owner  the host who opened it (only the host can start the game)
         seats  { s0: "anna", s2: "leo" }  (seat slots, so players pick where to sit)
         max    seat count
       Seats survive between hands. Presence (onDisconnect) frees a seat only
       while nobody is mid-hand, so a backgrounded phone never drops a live hand.
       ========================================================================= */
    const Tables = {
        seatKeys(seats) { return Object.keys(seats || {}).sort((a, b) => parseInt(a.slice(1), 10) - parseInt(b.slice(1), 10)); },
        names(seats) { return this.seatKeys(seats).map((k) => seats[k]); },
        seatOf(seats, u) { return Object.keys(seats || {}).find((k) => seats[k] === u) || null; },
        isOpen(g) { const seats = (g && g.seats) || {}, k = Object.keys(seats); return !!(g && g.phase && k.length && k.every((x) => typeof seats[x] === "string")); }, // legacy {name:true} seat maps read as "no table"
        ownerHere(g) { return this.names(g.seats).includes(g.owner); },
        /** Host, or anyone once the host has left the table. */
        canDrive(g, me) { return g.owner === me || !this.ownerHere(g); },

        open(ref, me, max) {
            return ref.transaction((v) => {
                if (this.isOpen(v)) return; // somebody already opened this table
                return { phase: "lobby", owner: me, seats: { s0: me }, max, rot: 0, hid: Date.now(), turnAt: Date.now() };
            });
        },
        take(ref, me, key, phases) {
            return ref.transaction((v) => {
                if (!this.isOpen(v) || !phases.includes(v.phase)) return;
                if (this.seatOf(v.seats, me) || v.seats[key] || !(parseInt(key.slice(1), 10) < (v.max || 6))) return;
                v.seats[key] = me; return v;
            });
        },
        leave(ref, me) {
            return ref.transaction((v) => {
                if (!v || !v.seats) return v;
                const k = this.seatOf(v.seats, me); if (!k) return v;
                delete v.seats[k];
                const left = this.names(v.seats);
                if (!left.length) return null; // the last player out closes the table
                if (v.owner === me) v.owner = left[0];
                return v;
            });
        },
        claim(ref, me) {
            return ref.transaction((v) => {
                if (!this.isOpen(v) || !this.names(v.seats).includes(me) || this.ownerHere(v)) return;
                v.owner = me; return v;
            });
        },
        close(ref, me, isRoomHost, phases) {
            return ref.transaction((v) => {
                if (!v || !phases.includes(v.phase) || (v.owner !== me && !isRoomHost)) return;
                return null;
            });
        },
        /** Frees my seat on disconnect, but only while no hand is in progress. */
        presence(holder, ref, g, me) {
            const key = me && this.seatOf(g.seats, me), want = key && ["lobby", "bet", "done"].includes(g.phase) ? key : null;
            if (holder.armed === want) return;
            if (holder.armed) ref.child("seats/" + holder.armed).onDisconnect().cancel();
            if (want) ref.child("seats/" + want).onDisconnect().remove();
            holder.armed = want;
        },
        /** Small live badge on the game menu so people can see an open table. */
        badge(gameKey, g, max) {
            const item = document.querySelector('.nav-menu-item[data-game="' + gameKey + '"]'); if (!item) return;
            let b = item.querySelector(".nav-live");
            if (!this.isOpen(g)) { if (b) b.remove(); return; }
            if (!b) { b = document.createElement("span"); b.className = "nav-live"; item.appendChild(b); }
            b.textContent = (g.phase === "lobby" ? "Lobby " : "Live ") + this.names(g.seats).length + "/" + (g.max || max);
        },
        /** Toast when someone else opens a table while I'm not seated. */
        announce(holder, g, label) {
            const open = this.isOpen(g), me = State.username;
            if (holder.seen && open && !holder.wasOpen && g.phase === "lobby" && g.owner !== me && !this.seatOf(g.seats, me)) {
                Notify.success(`${g.owner} opened a ${label} table. Grab a seat!`);
            }
            holder.wasOpen = open; holder.seen = true;
        },

        /** Builds the pre-game lobby: seat slots, host controls and status text. */
        renderLobby(root, g, cfg) {
            const me = State.username, open = this.isOpen(g), seats = open ? g.seats : {}, names = this.names(seats), mine = this.seatOf(seats, me);
            const owner = open ? g.owner : null, ownerHere = open && names.includes(owner), isOwner = open && owner === me;
            const free = []; for (let i = 0; i < cfg.max; i += 1) if (!seats["s" + i]) free.push("s" + i);
            const mk = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };
            const btn = (label, cls, fn, disabled) => { const b = mk("button", "btn " + cls, label); b.type = "button"; b.disabled = !!disabled; b.addEventListener("click", fn); return b; };
            root.textContent = "";

            const head = mk("div", "tl-head");
            head.append(mk("h3", "tl-title", cfg.title), mk("span", "tl-pill" + (open ? " on" : ""), open ? `${names.length} of ${cfg.max} seated` : "No table open"));
            root.appendChild(head);

            if (!open) {
                root.appendChild(mk("p", "tl-msg", `Nobody has opened a ${cfg.game} table yet. Open one and everyone in this room can take a seat.`));
                const row = mk("div", "tl-actions");
                row.appendChild(btn("Open a table", "btn-primary", cfg.onOpen));
                root.appendChild(row); return;
            }

            const ring = mk("div", "tl-seats");
            for (let i = 0; i < cfg.max; i += 1) {
                const key = "s" + i, u = seats[key], slot = mk("div", "tl-seat " + (u ? "taken" : "open") + (u && u === me ? " mine" : ""));
                slot.appendChild(mk("span", "tl-avatar", u ? u.slice(0, 2).toUpperCase() : String(i + 1)));
                slot.appendChild(mk("span", "tl-name", u ? u + (u === me ? " (you)" : "") : "Open seat"));
                if (u && u === owner) slot.appendChild(mk("span", "tl-crown", "Host"));
                else if (u) slot.appendChild(mk("span", "tl-crown quiet", "Seated"));
                else if (!mine) slot.appendChild(btn("Sit here", "btn-secondary tl-sit", () => cfg.onTake(key)));
                ring.appendChild(slot);
            }
            root.appendChild(ring);

            let msg;
            if (!ownerHere) msg = mine ? "The host left the table. Take over as host to start the game." : "The host left the table. Take a seat to become the new host.";
            else if (isOwner) msg = names.length > 1 ? `${names.length} players seated. Start now, or wait for more to join.` : cfg.soloNote;
            else msg = `${owner} is hosting. The game starts when they press Start.`;
            const m = mk("p", "tl-msg", msg); m.setAttribute("aria-live", "polite"); root.appendChild(m);

            const row = mk("div", "tl-actions");
            if (isOwner) row.appendChild(btn("Start game now", "btn-primary", cfg.onStart, names.length < cfg.minStart));
            if (mine && !ownerHere) row.appendChild(btn("Become host", "btn-primary", cfg.onClaim));
            if (!mine && free.length) row.appendChild(btn("Take a seat", "btn-secondary", () => cfg.onTake(free[0])));
            if (mine) row.appendChild(btn("Leave table", "btn-ghost", cfg.onLeave));
            if (isOwner || State.isHost) row.appendChild(btn("Close table", "btn-ghost tl-close", cfg.onClose));
            root.appendChild(row);
        }
    };

    /* =========================================================================
       12b. UNIVERSAL GAME RESOLVER
       Every game / challenge / draw reports its outcome through ONE entry point:
  
         resolveGameOutcome(gameId, results)
  
       results (all fields optional, combine freely):
         roundId       unique id of this round (auto-generated when omitted; makes settlement idempotent)
         entries       [{ username?, wager, payout, credited? }]  per-player money result.
                       username defaults to the local player. `wager` was already debited when the bet
                       was placed; `payout` is the gross amount returned. credited:true means the payout
                       was already added to the balance by the game itself (e.g. Black Widow pot) so only
                       stats + vault fee are applied.
         winners       [username]  winners of a selection game (plinko, marble, bracket, wheel ...)
         prizePool     house-funded chips split equally between `winners` (remainder goes to rank 1)
         participants  [username]  everybody who took part (counts as a game played when chips move)
  
       For every affected player it updates balance, stats.gamesPlayed, stats.totalWagered and
       stats.netProfit with ONE atomic Firebase transaction (delta based, never an absolute overwrite).
       Payouts for players other than the local one are claimed once per round at rooms/<code>/rounds.
       ========================================================================= */
    const GameResolver = {
        MAX_PRIZE: 5000,
        settled: new Set(),
        LABELS: {
            blackjack: "Blackjack", roulette: "Roulette", slots: "Slots", hilo: "Hi-Lo", craps: "Craps", crash: "Crash",
            moneywheel: "Money Wheel", pokerdice: "Poker Dice", blackwidow: "Black Widow Poker", uno: "UNO", parques: "Parqués", dominoes: "Dominoes", chess: "Chess", checkers: "Chinese Checkers", mastermind: "Color Code Breaker", bullscows: "Picas y Fijas", wheel: "Player Wheel"
        },

        label(gameId) {
            if (this.LABELS[gameId]) return this.LABELS[gameId];
            if (String(gameId).startsWith("draw:")) return "Lucky Draw";
            return String(gameId);
        },

        int(v) { const n = Math.round(Number(v)); return Number.isFinite(n) && n > 0 ? n : 0; },
        safeKey(s) { return String(s).replace(/[.#$\[\]\/\s]/g, "_").slice(0, 120); },

        /** Turns any supported results shape into [{ username, wager, payout, credited }]. */
        normalize(results) {
            const r = results || {}, me = State.username, map = new Map();
            const add = (u, wager, payout, credited) => {
                if (!u) return;
                const e = map.get(u) || { username: u, wager: 0, payout: 0, credited: false };
                e.wager += wager; e.payout += payout; e.credited = e.credited || !!credited;
                map.set(u, e);
            };
            (Array.isArray(r.entries) ? r.entries : []).forEach((e) => add(e.username || me, this.int(e.wager), this.int(e.payout), e.credited));

            const winners = Array.isArray(r.winners) ? [...new Set(r.winners.filter(Boolean))] : [];
            const pool = Math.min(this.int(r.prizePool), this.MAX_PRIZE * 10);
            if (winners.length && pool > 0) {
                const share = Math.floor(pool / winners.length), rest = pool - share * winners.length;
                winners.forEach((u, i) => add(u, 0, share + (i === 0 ? rest : 0), false));
            }
            if (map.size && Array.isArray(r.participants)) r.participants.filter(Boolean).forEach((u) => add(u, 0, 0, false));
            return [...map.values()];
        },

        /** Host-only, house-funded prize. Returns 0 for non-hosts, selection-only draws and overridden draws. */
        readPrize(inputId, overridden) {
            const el = document.getElementById(inputId);
            const v = Math.min(this.MAX_PRIZE, this.int(el && el.value));
            if (!v || !State.isHost) return 0;
            if (overridden) { Notify.warning("Prize skipped for this draw."); return 0; }
            return v;
        },

        syncPrizeUi() {
            ["draw-prize-row", "wheel-prize-row"].forEach((id) => { const el = document.getElementById(id); if (el) el.hidden = !State.isHost; });
        },

        /** Settles the local player's own entry: instant HUD update + one atomic remote delta. */
        applyLocal(e) {
            const gross = e.credited ? 0 : e.payout;
            State.balance = Math.max(0, State.balance + gross);
            const fee = e.wager > 0 ? Jackpot.rake(e.wager) : 0; // 2% vault contribution (also deducted locally)
            HUD.update();
            return Room.applyRound(e.username, {
                balance: gross - fee, gamesPlayed: 1, totalWagered: e.wager, netProfit: e.payout - e.wager - fee
            });
        },

        /** Settles other players. Only the client whose claim commits pays, so a round can never pay twice. */
        async applyRemote(gameId, roundId, entries) {
            if (!Room.db || !Room.code || !Room.playersRef) return false;
            const claim = Room.db.ref(`rooms/${Room.code}/rounds/${this.safeKey(gameId + "_" + roundId)}`);
            const res = await claim.transaction((v) => (v ? undefined : {
                gameId, roundId, by: State.username, ts: Date.now(),
                entries: entries.map((e) => ({ u: e.username, w: e.wager, p: e.payout }))
            }));
            if (!res.committed) return false;
            await Promise.all(entries.map((e) => Room.applyRound(e.username, {
                balance: e.credited ? 0 : e.payout, gamesPlayed: 1, totalWagered: e.wager, netProfit: e.payout - e.wager
            })));
            return true;
        },

        resolve(gameId, results) {
            const r = results || {}, me = State.username;
            const roundId = String(r.roundId || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`);
            const key = gameId + ":" + roundId;
            if (!gameId || !me || this.settled.has(key)) return Promise.resolve(null);
            this.settled.add(key);

            const entries = this.normalize(r);
            const summary = { gameId, roundId, entries, ts: Date.now() };
            if (!entries.length) return Promise.resolve(summary); // selection-only round: nothing to settle

            const mine = entries.filter((e) => e.username === me), others = entries.filter((e) => e.username !== me);
            const localTasks = mine.map((e) => this.applyLocal(e));
            const remoteTask = others.length ? this.applyRemote(gameId, roundId, others) : Promise.resolve(false);
            PubSub.emit("round-resolved", summary);

            return Promise.all([...localTasks, remoteTask]).then((done) => {
                const paid = new Set(mine.map((e) => e.username));
                if (done[done.length - 1]) others.forEach((e) => paid.add(e.username));
                const awarded = entries.filter((e) => paid.has(e.username) && e.payout > 0 && e.wager === 0);
                if (awarded.length) {
                    const total = awarded.reduce((a, e) => a + e.payout, 0);
                    Notify.success(`${this.label(gameId)}: ${total.toLocaleString("en-US")} chips awarded to ${awarded.map((e) => e.username).join(", ")}.`);
                }
                return summary;
            }).catch((err) => { console.error("Round settlement failed", err); Notify.error("Could not save the round result."); return null; });
        }
    };
    /** The one function every mini-game calls when a round ends. */
    function resolveGameOutcome(gameId, results) { return GameResolver.resolve(gameId, results); }
    document.addEventListener("game-changed", () => GameResolver.syncPrizeUi());
    PubSub.on("players-updated", () => GameResolver.syncPrizeUi());

    /* =========================================================================
       13. BLACKJACK — multiplayer table vs the dealer, synced at rooms/<code>/bj
       Flow: lobby (host starts) -> bets -> deal -> clockwise turns -> dealer -> payouts -> next round.
       Cards are ints 0..51 (rank = c % 13, suit = c / 13), same encoding as Black Widow.
       Chips: a bet is debited when its transaction commits; a payout is claimed exactly
       once per player through rooms/<code>/bj/paid/<name>, so reloads never double-pay.
       ========================================================================= */
    const Blackjack = {
        MAX_SEATS: 5, IDLE_MS: 45000, NEXT_MS: 12000, DEAL_MS: 30000,
        R: "23456789TJQKA", S: ["\u2660", "\u2665", "\u2666", "\u2663"],
        ref: null, cb: null, tick: null, g: { phase: "lobby" }, pres: { armed: null }, ann: {}, claimed: {}, shown: {}, hid: null,
        $(id) { return document.getElementById(id); },
        isLive(g) { return g.phase === "play"; },

        init() {
            const on = (id, fn) => this.$(id).addEventListener("click", fn);
            on("btn-blackjack-bet", () => this.bet());
            on("btn-blackjack-hit", () => this.act("hit"));
            on("btn-blackjack-stand", () => this.act("stand"));
            on("btn-blackjack-double", () => this.act("double"));
            on("bj-deal", () => this.dealNow());
            on("bj-next", () => this.next());
            on("bj-lobby-back", () => this.backToLobby());
            on("bj-kick", () => this.kick());
            on("bj-leave", () => Tables.leave(this.ref, State.username));
            this.$("input-blackjack-bet").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); this.bet(); } });
        },
        start() {
            this.stop(); if (!Room.db || !Room.code) return;
            this.ref = Room.db.ref(`rooms/${Room.code}/bj`);
            this.cb = (s) => {
                const n = s.val() || { phase: "lobby" };
                if (n.hid !== this.g.hid) { this.shown = {}; this.hole = {}; }
                this.g = n;
                Tables.announce(this.ann, n, "Blackjack"); Tables.badge("blackjack", n, this.MAX_SEATS); Tables.presence(this.pres, this.ref, n, State.username);
                this.sync(); this.render();
            };
            this.ref.on("value", this.cb);
            this.tick = window.setInterval(() => { if (this.g.phase !== "lobby") this.renderControls(); }, 1000);
            this.render();
        },
        stop() {
            if (this.ref && this.cb) this.ref.off("value", this.cb);
            if (this.tick) window.clearInterval(this.tick);
            this.ref = this.cb = this.tick = null; this.g = { phase: "lobby" }; this.pres = { armed: null }; this.ann = {}; this.claimed = {}; this.shown = {}; this.hid = null;
            Tables.badge("blackjack", {}, this.MAX_SEATS);
        },

        /* --- cards & scoring --- */
        val(c) { const r = c % 13; return r === 12 ? 11 : r >= 8 ? 10 : r + 2; },
        score(hand) {
            let t = 0, a = 0;
            (hand || []).forEach((c) => { t += this.val(c); if (c % 13 === 12) a += 1; });
            while (t > 21 && a > 0) { t -= 10; a -= 1; }
            return t;
        },
        isNatural(hand) { return (hand || []).length === 2 && this.score(hand) === 21; },
        setFront(el, c) {
            const su = (c / 13) | 0, rk = this.R[c % 13];
            el.className = "card " + (su === 1 || su === 2 ? "card-red" : "card-black");
            el.textContent = (rk === "T" ? "10" : rk) + this.S[su];
        },
        /** meta: { round, ord, turnOver } — turnOver = the dealer's hole card being revealed in place (flip only, no travel). */
        renderCard(container, c, hidden, animate, meta) {
            const el = document.createElement("div");
            if (hidden) {
                el.className = "card card-back";
                container.appendChild(el);   // no face content is ever put in the DOM for a hidden card
                if (animate && meta && meta.travel) CardFX.add(el, Object.assign({ flip: false, reveal: null }, meta));
                return;
            }
            else if (animate || (meta && meta.turnOver)) { el.className = "card card-back"; }   // travels face-down, turns over on arrival
            else this.setFront(el, c);
            container.appendChild(el);
            if (hidden || !(animate || (meta && meta.turnOver))) return;
            CardFX.add(el, Object.assign({ flip: true, reveal: () => this.setFront(el, c), stay: !!(meta && meta.turnOver) }, meta));
        },
        /** holeHidden: only card #2 is face-down (dealer). allHidden: every card is face-down (other players' hands during a round). */
        fillHand(container, key, hand, holeHidden, allHidden) {
            const seen = this.shown[key] || 0; container.textContent = "";
            this.hole = this.hole || {};
            const was = this.hole[key];                       // false | "hole" | "all"
            (hand || []).forEach((c, i) => {
                const ord = key === "dealer" ? 999 : (this.seq = (this.seq || 0) + 1);
                const hid = !!allHidden || (!!holeHidden && i === 1);
                const turnOver = !hid && (was === "all" || (was === "hole" && i === 1));   // showdown: face-down cards flip over in place
                this.renderCard(container, c, hid, i >= seen, { round: i, ord, turnOver, travel: key !== "dealer" });
            });
            this.hole[key] = allHidden ? "all" : holeHidden ? "hole" : false;
            this.shown[key] = (hand || []).length;
        },

        /* --- table actions --- */
        openTable() { if (this.ref) Tables.open(this.ref, State.username, this.MAX_SEATS); },
        take(key) { if (this.ref) Tables.take(this.ref, State.username, key, ["lobby", "bet", "done"]); },
        start_() {
            const me = State.username; if (!this.ref) return;
            this.ref.transaction((v) => {
                if (!Tables.isOpen(v) || v.phase !== "lobby" || v.owner !== me) return;
                return { phase: "bet", owner: v.owner, seats: v.seats, max: v.max, rot: v.rot || 0, round: 1, hid: Date.now(), turnAt: Date.now(), last: "" };
            });
        },
        closeTable() { if (this.ref) Tables.close(this.ref, State.username, State.isHost, ["lobby", "done"]).then((r) => { if (!r.committed) Notify.warning("Finish the round before closing the table."); }); },
        backToLobby() {
            const me = State.username; if (!this.ref) return;
            this.ref.transaction((v) => {
                if (!Tables.isOpen(v) || v.owner !== me || v.phase !== "done") return;
                return { phase: "lobby", owner: v.owner, seats: v.seats, max: v.max, rot: v.rot || 0, hid: Date.now(), turnAt: Date.now() };
            });
        },
        leaveOk(g, me) { const inHand = (g.order || []).includes(me); return !(g.phase === "play" && inHand) && !(g.phase === "bet" && (g.bets || {})[me]); },

        /* --- betting & dealing --- */
        bet() {
            const me = State.username, g = this.g; if (!this.ref || !me) return;
            if (g.phase !== "bet" || !Tables.seatOf(g.seats, me) || (g.bets || {})[me]) return;
            const amount = Validate.parseBet(this.$("input-blackjack-bet")); if (amount === null) return;
            this.ref.transaction((v) => {
                if (!Tables.isOpen(v) || v.phase !== "bet") return;
                const names = Tables.names(v.seats); if (!names.includes(me)) return;
                v.bets = v.bets || {}; if (v.bets[me]) return;
                v.bets[me] = amount;
                return names.every((u) => v.bets[u]) ? this.deal(v) : v; // everyone is in: deal immediately
            }).then((r) => {
                if (!r.committed) return;
                const mineBet = ((r.snapshot.val() || {}).bets || {})[me];
                if (mineBet === amount) { State.debit(amount); Sound.click(); }
            }).catch(() => { });
        },
        dealNow() {
            const me = State.username; if (!this.ref) return;
            this.ref.transaction((v) => {
                if (!Tables.isOpen(v) || v.phase !== "bet" || !Object.keys(v.bets || {}).length) return;
                if (!Tables.canDrive(v, me) && Date.now() - (v.turnAt || 0) < this.DEAL_MS) return;
                return this.deal(v);
            });
        },
        /** Pure table-state transition: shuffles, deals two cards to every player who bet, and peeks for naturals. */
        deal(v) {
            const names = Tables.names(v.seats).filter((u) => (v.bets || {})[u]);
            const deck = Array.from({ length: 52 }, (_, i) => i);
            for (let i = 51; i > 0; i -= 1) { const j = Math.floor(Math.random() * (i + 1));[deck[i], deck[j]] = [deck[j], deck[i]]; }
            const hands = {}, st = {}, bets = {};
            names.forEach((u) => { hands[u] = [deck.pop(), deck.pop()]; st[u] = this.isNatural(hands[u]) ? "bj" : "play"; bets[u] = v.bets[u]; });
            const dealer = [deck.pop(), deck.pop()];
            Object.assign(v, { phase: "play", order: names, hands, st, bets, dealer, deck, up: 0, turnAt: Date.now(), last: "Cards dealt", res: null, paid: null });
            v.turn = names.findIndex((u) => st[u] === "play");
            return v.turn < 0 || this.isNatural(dealer) ? this.runDealer(v) : v;
        },
        /** Reveals the dealer, draws to 17 (stands on soft 17) and works out every payout. */
        runDealer(v) {
            v.up = 1;
            const contest = v.order.some((u) => v.st[u] === "stand");
            while (contest && this.score(v.dealer) < 17) v.dealer.push(v.deck.pop());
            const dt = this.score(v.dealer), dNat = this.isNatural(v.dealer), shares = {}, out = {};
            v.order.forEach((u) => {
                const bet = v.bets[u], pt = this.score(v.hands[u]);
                let s = 0, o = "lose";
                if (v.st[u] === "bust") o = "bust";
                else if (v.st[u] === "bj") { if (dNat) { s = bet; o = "push"; } else { s = Math.round(bet * 2.5); o = "blackjack"; } }
                else if (dNat) o = "lose";
                else if (dt > 21 || pt > dt) { s = bet * 2; o = "win"; }
                else if (pt === dt) { s = bet; o = "push"; }
                shares[u] = s; out[u] = o;
            });
            v.phase = "done"; v.turn = -1; v.turnAt = Date.now(); v.res = { shares, out, dealer: dt };
            return v;
        },
        next() {
            const me = State.username; if (!this.ref) return;
            this.ref.transaction((v) => {
                if (!Tables.isOpen(v) || v.phase !== "done") return;
                if (!Tables.canDrive(v, me) && Date.now() - (v.turnAt || 0) < this.NEXT_MS) return;
                return { phase: "bet", owner: v.owner, seats: v.seats, max: v.max, rot: v.rot || 0, round: (v.round || 1) + 1, hid: Date.now(), turnAt: Date.now(), last: "" };
            });
        },

        /* --- turn actions: hit / stand / double (first two cards only) --- */
        act(type, who) {
            const me = who || State.username, g = this.g; if (!this.ref || !me) return;
            if (type === "double" && !who && !BetLimits.ok("blackjack", ((g.bets || {})[me] || 0) * 2)) return;
            if (type === "double" && !who && !State.canAfford((g.bets || {})[me] || 0)) return Notify.error("You don't have enough chips to double down.");
            let extra = 0;
            this.ref.transaction((v) => {
                extra = 0;
                if (!v || v.phase !== "play" || v.order[v.turn] !== me) return;
                if (who && Date.now() - (v.turnAt || 0) < this.IDLE_MS) return;
                const hand = (v.hands[me] || []).slice();
                if (type === "hit") {
                    hand.push(v.deck.pop()); v.hands[me] = hand; const t = this.score(hand);
                    v.st[me] = t > 21 ? "bust" : t === 21 ? "stand" : "play"; v.last = `${me} hit`;
                } else if (type === "double") {
                    if (hand.length !== 2) return;
                    extra = v.bets[me]; v.bets[me] = extra * 2; hand.push(v.deck.pop()); v.hands[me] = hand;
                    v.st[me] = this.score(hand) > 21 ? "bust" : "stand"; v.last = `${me} doubled down`;
                } else if (type === "stand") { v.st[me] = "stand"; v.last = `${me} stood`; }
                else return;
                v.turnAt = Date.now();
                if (v.st[me] === "play") return v;
                const nx = v.order.findIndex((u, i) => i > v.turn && v.st[u] === "play");
                if (nx < 0) return this.runDealer(v);
                v.turn = nx; return v;
            }).then((r) => { if (r.committed && extra) State.debit(extra); }).catch(() => { });
        },
        kick() {
            const g = this.g, u = g.order && g.order[g.turn];
            if (!u || u === State.username || g.phase !== "play") return;
            if (Date.now() - (g.turnAt || 0) < this.IDLE_MS) return Notify.warning("Give them a little longer.");
            this.act("stand", u);
        },

        /* --- payouts: each player claims their own share once --- */
        sync() {
            const g = this.g, me = State.username;
            if (!me || g.phase !== "done" || !g.res || !(g.order || []).includes(me) || this.claimed[g.hid]) return;
            this.claimed[g.hid] = true;
            const share = (g.res.shares || {})[me] || 0, stake = (g.bets || {})[me] || 0, out = (g.res.out || {})[me];
            this.ref.child("paid/" + me).transaction((c) => (c ? undefined : Date.now())).then((r) => {
                if (!r.committed) return;
                resolveGameOutcome("blackjack", { roundId: g.hid + "-" + me, entries: [{ wager: stake, payout: share }] });
                const text = { blackjack: `Blackjack! You won ${share} chips.`, win: `You won ${share} chips.`, push: "Push. Your bet was returned.", lose: `Dealer wins. You lost ${stake} chips.`, bust: `You busted and lost ${stake} chips.` }[out];
                if (out === "blackjack" || out === "win") { Notify.success(text); Sound.win(); if (share >= CONFIG.BIG_WIN_THRESHOLD) Effects.celebrate(`${out === "blackjack" ? "BLACKJACK" : "YOU WON"}! +${share} chips`); }
                else if (out === "push") Notify.warning(text);
                else { Notify.error(text); Sound.lose(); }
            }).catch(() => { });
        },

        /* --- rendering --- */
        status(u) {
            const g = this.g, inHand = (g.order || []).includes(u), st = (g.st || {})[u], out = ((g.res || {}).out || {})[u];
            if (g.phase === "bet") return (g.bets || {})[u] ? "Bet placed" : "Betting";
            if (g.phase === "play") {
                if (!inHand) return "Sitting out";
                if (g.order[g.turn] === u) return "Playing";
                if (u !== State.username && (st === "bust" || st === "bj" || st === "stand")) return "Done";   // don't reveal bust / 21 to other players
                return { play: "Waiting", stand: "Stand", bust: "Bust", bj: "Blackjack" }[st] || "Waiting";
            }
            if (g.phase === "done") return !inHand ? "Sitting out" : ({ win: "Won", blackjack: "Blackjack", push: "Push", lose: "Lost", bust: "Bust" }[out] || "");
            return "Seated";
        },
        render() {
            if (CardFX.deferRender(this)) return;
            const g = this.g, lobby = !Tables.isOpen(g) || g.phase === "lobby";
            this.$("bj-lobby").hidden = !lobby; this.$("bj-live").hidden = lobby;
            if (lobby) {
                this.$("blackjack-result").textContent = "";
                Tables.renderLobby(this.$("bj-lobby"), g, {
                    title: "Blackjack table", game: "Blackjack", max: this.MAX_SEATS, minStart: 1,
                    soloNote: "Just you so far. Start now to play solo against the dealer, or wait for more players.",
                    onOpen: () => this.openTable(), onTake: (k) => this.take(k), onLeave: () => Tables.leave(this.ref, State.username),
                    onStart: () => this.start_(), onClose: () => this.closeTable(), onClaim: () => Tables.claim(this.ref, State.username)
                });
                return;
            }
            this.seq = 0;
            this.renderDealer(); this.renderSeats();
            CardFX.flush(document.getElementById("bj-shoe"), 190);
            this.renderControls();
        },
        renderDealer() {
            const g = this.g, el = this.$("dealer-cards"), sc = this.$("dealer-score"), has = (g.dealer || []).length > 0;
            if (!has) { el.textContent = ""; sc.textContent = "Dealing starts once bets are in"; return; }
            this.fillHand(el, "dealer", g.dealer, !g.up);
            sc.textContent = g.up ? `Score: ${this.score(g.dealer)}${this.score(g.dealer) > 21 ? " (bust)" : ""}` : `Showing: ${this.val(g.dealer[0])}`;
        },
        renderSeats() {
            const g = this.g, me = State.username, el = this.$("bj-seats"), live = g.phase === "play" || g.phase === "done";
            const seated = Tables.names(g.seats), list = live ? Array.from(new Set([...(g.order || []), ...seated])) : seated;
            el.textContent = "";
            list.forEach((u) => {
                const inHand = live && (g.order || []).includes(u), hand = (g.hands || {})[u] || [], out = ((g.res || {}).out || {})[u];
                const turn = g.phase === "play" && g.order[g.turn] === u;
                const d = document.createElement("div");
                d.className = "bj-seat" + (u === me ? " me" : "") + (turn ? " turn" : "") + (out === "win" || out === "blackjack" ? " win" : "") + (out === "lose" || out === "bust" ? " lose" : "") + (live && !inHand ? " out" : "");
                const n = document.createElement("div"); n.className = "bw-name"; n.append((turn ? "\u25B6 " : "") + u + (u === me ? " (you)" : ""));
                const tag = (t, cls) => { const s = document.createElement("span"); s.className = "bw-tag " + (cls || ""); s.textContent = t; n.appendChild(s); };
                if (u === g.owner) tag("Host");
                const status = this.status(u); if (status) tag(status, "st-" + status.toLowerCase().replace(/[^a-z]/g, ""));
                if (g.phase === "done" && inHand) { const sh = ((g.res || {}).shares || {})[u] || 0, b = (g.bets || {})[u] || 0; tag(sh - b >= 0 ? `+${sh - b}` : `${sh - b}`, sh - b > 0 ? "st-won" : sh - b < 0 ? "st-lost" : ""); }
                d.appendChild(n);
                const bet = (g.bets || {})[u]; if (bet) { const chip = document.createElement("div"); chip.className = "bj-bet"; chip.textContent = "Bet " + bet; d.appendChild(chip); }
                const row = document.createElement("div"); row.className = "card-row";
                const hideCards = g.phase === "play" && u !== me;    // only your own cards are visible until the showdown
                if (inHand) this.fillHand(row, "p:" + u, hand, false, hideCards);
                d.appendChild(row);
                if (inHand) {
                    const sc = document.createElement("span"); sc.className = "score-display"; const t = this.score(hand);
                    sc.textContent = hideCards ? `${hand.length} cards \u00B7 hidden` : (t > 21 ? "Bust " + t : "Score: " + t);
                    d.appendChild(sc);
                }
                el.appendChild(d);
            });
        },
        renderControls() {
            const g = this.g, me = State.username, names = Tables.names(g.seats), seated = names.includes(me), inHand = (g.order || []).includes(me);
            const who = g.phase === "play" ? g.order[g.turn] : null, myTurn = who === me, myBet = (g.bets || {})[me], hand = (g.hands || {})[me] || [];
            const total = Object.values(g.bets || {}).reduce((a, b) => a + b, 0), betsIn = Object.keys(g.bets || {}).length;
            this.$("bj-pot").textContent = "Bets " + total.toLocaleString("en-US");
            this.$("bj-phase").textContent = { bet: `Round ${g.round || 1} \u2014 place your bets`, play: `Round ${g.round || 1} \u2014 hands in play`, done: `Round ${g.round || 1} \u2014 complete` }[g.phase] || "Waiting for players";
            let msg;
            if (g.phase === "bet") msg = !seated ? "Take a seat to join the next hand." : myBet ? `Bet placed. Waiting for the others (${betsIn} of ${names.length} in).` : "Place your bet to get dealt in.";
            else if (g.phase === "play") msg = myTurn ? "Your turn: hit, stand or double down." : inHand ? `Waiting for ${who}\u2026` : `${who} is playing\u2026`;
            else { const o = ((g.res || {}).out || {})[me]; msg = o ? { blackjack: "Blackjack pays 3 to 2.", win: "You beat the dealer.", push: "Push.", lose: "The dealer wins this one.", bust: "You busted." }[o] : `Dealer finished with ${(g.res || {}).dealer}.`; }
            this.$("bj-status").textContent = msg;
            this.$("blackjack-result").textContent = g.phase === "done" && g.res ? `Dealer ${g.res.dealer > 21 ? "busts with " : "has "}${g.res.dealer}. ` + (g.order || []).map((u) => { const o = g.res.out[u], sh = g.res.shares[u] - g.bets[u]; return `${u}: ${o === "blackjack" ? "blackjack" : o}${sh ? ` (${sh > 0 ? "+" : ""}${sh})` : ""}`; }).join(" \u00B7 ") : (g.last || "");
            const canBet = g.phase === "bet" && seated && !myBet, inp = this.$("input-blackjack-bet");
            inp.disabled = !canBet; this.$("btn-blackjack-bet").disabled = !canBet;
            this.$("btn-blackjack-hit").disabled = !myTurn; this.$("btn-blackjack-stand").disabled = !myTurn;
            this.$("btn-blackjack-double").disabled = !(myTurn && hand.length === 2 && State.canAfford(myBet || 0));
            const drive = Tables.canDrive(g, me), dealWait = Math.ceil((this.DEAL_MS - (Date.now() - (g.turnAt || 0))) / 1000), nextWait = Math.ceil((this.NEXT_MS - (Date.now() - (g.turnAt || 0))) / 1000);
            const dl = this.$("bj-deal"); dl.hidden = !(g.phase === "bet" && seated && betsIn > 0 && betsIn < names.length); dl.disabled = !drive && dealWait > 0;
            dl.textContent = drive || dealWait <= 0 ? "Deal now" : `Deal now (${dealWait}s)`;
            const nx = this.$("bj-next"); nx.hidden = !(g.phase === "done" && seated); nx.disabled = !drive && nextWait > 0;
            nx.textContent = drive || nextWait <= 0 ? "Next round" : `Next round (${nextWait}s)`;
            this.$("bj-lobby-back").hidden = !(g.phase === "done" && g.owner === me);
            const wait = g.phase === "play" && inHand && !myTurn ? Math.ceil((this.IDLE_MS - (Date.now() - (g.turnAt || 0))) / 1000) : 0;
            const kick = this.$("bj-kick"); kick.hidden = !(g.phase === "play" && inHand && !myTurn); kick.disabled = wait > 0; kick.textContent = wait > 0 ? `Skip idle player (${wait}s)` : "Skip idle player";
            const lv = this.$("bj-leave"); lv.hidden = !seated; lv.disabled = !this.leaveOk(g, me);
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
            if (!BetLimits.ok("roulette", this.selectedChip)) return;
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
                DOM.rouletteResult.textContent = `Winning number ${winningNumber} (${colorLabels[winningColor]}). You won ${payout} chips!`;
                Notify.success(`Roulette: ${winningNumber} ${colorLabels[winningColor]}. Won ${payout} chips.`);
                Sound.win();
                if (payout >= CONFIG.BIG_WIN_THRESHOLD) Effects.celebrate(`STRAIGHT UP! +${payout} chips`);
            } else {
                DOM.rouletteResult.textContent = `Winning number ${winningNumber} (${colorLabels[winningColor]}). Lost ${bet} chips.`;
                Notify.error(`Roulette: ${winningNumber} ${colorLabels[winningColor]}. Lost ${bet} chips.`);
                Sound.lose();
            }

            resolveGameOutcome("roulette", { entries: [{ wager: bet, payout }] });
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
        spinId: 0,
        canvas: null,
        pendingWinner: null,

        init() {
            DOM.btnWheelSpin.addEventListener("click", () => this.spin());
            if (window.ResizeObserver) new ResizeObserver(() => this.draw()).observe(DOM.wheelContainer);
            else window.addEventListener("resize", () => this.draw());
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

        ensureCanvas() {
            if (this.canvas && this.canvas.isConnected) return;
            const cv = document.createElement("canvas");
            cv.className = "wheel-canvas";
            cv.setAttribute("aria-hidden", "true");
            DOM.wheelDial.appendChild(cv);
            DOM.wheelLabels.style.display = "none";
            DOM.wheelDial.style.transform = "";
            DOM.wheelPointer.style.transformOrigin = "50% 0";
            this.canvas = cv;
        },

        /** Re-rasterises the whole wheel every frame, so names stay razor-sharp while it turns (no rotated bitmaps). */
        draw(hi, flash) {
            this.ensureCanvas();
            const cv = this.canvas, size = Math.round(DOM.wheelDial.clientWidth - 12);
            if (size < 60) return;
            const dpr = Math.min(window.devicePixelRatio || 1, 2.5), px = Math.round(size * dpr);
            if (cv.width !== px) { cv.width = px; cv.height = px; }
            const ctx = cv.getContext("2d");
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, size, size);
            const css = getComputedStyle(document.documentElement);
            const c1 = css.getPropertyValue("--color-felt-light").trim() || "#0f6248";
            const c2 = css.getPropertyValue("--color-felt-dark").trim() || "#052d21";
            const cx = size / 2, R = size / 2 - 1, n = this.pool.length;
            if (n === 0) { ctx.fillStyle = c2; ctx.beginPath(); ctx.arc(cx, cx, R, 0, Math.PI * 2); ctx.fill(); return; }

            const slice = (Math.PI * 2) / n, rot = (this.rotation * Math.PI) / 180;
            const fs = Math.max(9, Math.min(15, R * 0.75 * slice * 0.7));
            const textR = R - 14, maxW = Math.max(30, textR - size * 0.15);
            ctx.font = `700 ${fs}px "Segoe UI", Arial, sans-serif`;
            ctx.textBaseline = "middle";
            for (let i = 0; i < n; i += 1) {
                const a0 = -Math.PI / 2 + rot + i * slice, a1 = a0 + slice;
                ctx.beginPath(); ctx.moveTo(cx, cx); ctx.arc(cx, cx, R, a0, a1); ctx.closePath();
                ctx.fillStyle = i % 2 === 0 ? c1 : c2; ctx.fill();
                if (i === hi) { ctx.fillStyle = `rgba(244,196,48,${0.25 + 0.55 * (flash || 0)})`; ctx.fill(); }
                ctx.lineWidth = 1; ctx.strokeStyle = "rgba(245,210,122,.35)"; ctx.stroke();
            }
            for (let i = 0; i < n; i += 1) {
                const am = -Math.PI / 2 + rot + i * slice + slice / 2;
                let label = this.pool[i];
                if (ctx.measureText(label).width > maxW) {
                    while (label.length > 1 && ctx.measureText(label + "\u2026").width > maxW) label = label.slice(0, -1);
                    label += "\u2026";
                }
                ctx.save(); ctx.translate(cx, cx); ctx.rotate(am); ctx.textAlign = "right";
                ctx.lineJoin = "round"; ctx.lineWidth = 3; ctx.strokeStyle = "rgba(0,0,0,.55)"; ctx.strokeText(label, textR, 0);
                ctx.fillStyle = i === hi ? "#fff3b0" : "#f6f1e0"; ctx.fillText(label, textR, 0);
                ctx.restore();
            }
            const g = ctx.createRadialGradient(cx, cx, R * 0.25, cx, cx, R);
            g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0,.38)");
            ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cx, R, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = "#e9c46a";
            for (let i = 0; n <= 60 && i < n; i += 1) {
                const a = -Math.PI / 2 + rot + i * slice;
                ctx.beginPath(); ctx.arc(cx + Math.cos(a) * (R - 4), cx + Math.sin(a) * (R - 4), 2.4, 0, Math.PI * 2); ctx.fill();
            }
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
            this.draw();
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
            Sound.click();

            const count = this.pool.length, slice = 360 / count;
            const winnerIndex = Rig.idx(this.pool, Math.floor(Math.random() * count));
            const jitter = (Math.random() - 0.5) * slice * 0.6;              // land anywhere inside the slice, not dead centre
            const currentMod = ((this.rotation % 360) + 360) % 360;
            const targetAngle = (((360 - (winnerIndex * slice + slice / 2 + jitter)) % 360) + 360) % 360;
            let delta = targetAngle - currentMod;
            if (delta <= 0) delta += 360;
            const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
            const from = this.rotation, to = from + 360 * (reduce ? 1 : 5) + delta, dur = reduce ? 900 : 4600;
            const id = ++this.spinId, t0 = performance.now();
            let lastIdx = -1, kick = 0, lastT = t0;

            const frame = (now) => {
                if (id !== this.spinId) return;
                const p = Math.min(1, (now - t0) / dur), q = 1 - p;
                const ramp = Math.min(1, p / 0.06);
                const soft = (1 - q * q * q * q * q) * (ramp * ramp * (3 - 2 * ramp));     // eased spin-up, long quintic brake
                this.rotation = from + (to - from) * soft;
                const mod = ((this.rotation % 360) + 360) % 360;
                const idx = Math.floor((((360 - mod) % 360)) / slice) % count;
                if (idx !== lastIdx) {
                    if (lastIdx !== -1) { kick = 1; if (p < 0.985) Sound.tone(520 + (idx % 4) * 60, 22, "triangle", 0.03); }
                    lastIdx = idx;
                }
                kick = Math.max(0, kick - (now - lastT) / 140); lastT = now;
                DOM.wheelPointer.style.transform = `translateX(-50%) rotate(${(-kick * 16).toFixed(2)}deg)`;
                this.draw();
                if (p < 1) { window.requestAnimationFrame(frame); return; }
                this.rotation = ((this.rotation % 360) + 360) % 360;
                DOM.wheelPointer.style.transform = "";
                const f0 = performance.now();
                const flashLoop = (t2) => {
                    if (id !== this.spinId) return;
                    const k = (t2 - f0) / 750;
                    this.draw(winnerIndex, 0.5 + 0.5 * Math.sin(k * Math.PI * 6));
                    if (k < 1) window.requestAnimationFrame(flashLoop); else this.resolveSpin(winnerIndex);
                };
                window.requestAnimationFrame(flashLoop);
            };
            window.requestAnimationFrame(frame);
        },

        resolveSpin(winnerIndex) {
            const winner = this.pool[winnerIndex];
            this.pendingWinner = winner;
            this.isSpinning = false;
            DOM.btnWheelRestart.disabled = false;
            DOM.btnWheelSpin.disabled = this.pool.length < 2;
            DOM.wheelResult.textContent = `The wheel landed on ${winner}.`;
            const prize = GameResolver.readPrize("wheel-prize", Rig.on && Rig.target === winner);
            resolveGameOutcome("wheel", { winners: [winner], participants: this.pool.slice(), prizePool: prize });
            Sound.win();
            this.draw(winnerIndex, 1);

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
        visible: [],   // [top, middle, bottom] symbols currently showing on each reel
        raf: 0,

        init() {
            DOM.btnSlotsSpin.addEventListener("click", () => this.spin());
            DOM.btnSlotsLever.addEventListener("click", () => this.spin());
            this.visible = DOM.reels.map(() => [this.randomSymbol(), this.randomSymbol(), this.randomSymbol()]);
            DOM.reels.forEach((reel, i) => this.paint(i, this.visible[i]));
        },

        randomSymbol() {
            return this.SYMBOLS[Math.floor(Math.random() * this.SYMBOLS.length)];
        },

        /** Replaces a reel's strip with exactly the given symbols (idle / landed state). */
        paint(i, symbols) {
            const strip = DOM.reels[i].querySelector(".sm-strip");
            strip.textContent = "";
            symbols.forEach((sym, k) => {
                const d = document.createElement("div");
                d.className = "sm-sym" + (k === 1 ? " is-mid" : "");
                d.textContent = sym;
                strip.appendChild(d);
            });
            strip.style.transform = "translate3d(0,0,0)";
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
            window.setTimeout(() => DOM.btnSlotsLever.classList.remove("lever-pulled"), 260);
            DOM.slotsResult.textContent = "";
            DOM.reels.forEach((r) => r.classList.remove("is-win", "is-locked"));
            Sound.click();

            const results = [this.randomSymbol(), this.randomSymbol(), this.randomSymbol()];
            this.animate(results).then(() => this.resolveSpin(bet, results));
        },

        /**
         * Vertical reel physics. Per reel: short wind-up pull, accelerate to cruise speed, brake with an
         * ease-out curve that overshoots the stop line, then a damped-spring bounce that locks the symbol in.
         * Speed drives a streak overlay (motion blur without CSS filters), so text is crisp whenever it is slow.
         */
        animate(results) {
            const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
            const H = DOM.reels[0].clientHeight / 3 || 76;
            const V0 = 1.9, ACC = 260, DEC = 760, OVER = H * 0.22, WIND = 150, SPRING = 480;
            DOM.reels[0].parentElement.classList.add("is-spinning");

            const reels = DOM.reels.map((reel, i) => {
                const strip = reel.querySelector(".sm-strip"), streak = reel.querySelector(".sm-streak");
                const cruise0 = (reduce ? 120 : 520 + i * 460);
                const decDist = V0 * DEC / 3, accDist = V0 * ACC / 2;
                const rows = Math.ceil((accDist + decDist + cruise0 * V0) / H);
                const F = rows * H, target = F + OVER;
                const cruise = Math.max(0, (target - accDist - decDist) / V0);
                // Strip: [pad][final top, mid, bottom][filler...][previous top, mid, bottom]
                const n = rows + 4, items = new Array(n);
                items[0] = this.randomSymbol();
                for (let k = 1; k < n - 3; k += 1) items[k] = this.randomSymbol();
                const fin = [this.randomSymbol(), results[i], this.randomSymbol()];
                items[1] = fin[0]; items[2] = fin[1]; items[3] = fin[2];
                this.visible[i].forEach((sym, k) => { items[n - 3 + k] = sym; });
                strip.textContent = "";
                items.forEach((sym, k) => {
                    const d = document.createElement("div");
                    d.className = "sm-sym" + (k === 2 ? " is-mid" : "");
                    d.textContent = sym;
                    strip.appendChild(d);
                });
                this.visible[i] = fin;
                return {
                    i, reel, strip, streak, F, target, base: (n - 3) * H, n, H, accDist, decDist, cruise,
                    tWind: WIND, tAcc: ACC, tDec: DEC, done: false, pos: 0, lastRow: -1
                };
            });

            const posAt = (r, t) => {
                if (t < r.tWind) return -14 * Math.sin((t / r.tWind) * Math.PI / 2);        // anticipation pull-back
                let u = t - r.tWind;
                const wound = -14;
                if (u < r.tAcc) return wound * (1 - u / r.tAcc) + V0 * u * u / (2 * r.tAcc);      // spin-up
                u -= r.tAcc;
                if (u < r.cruise) return r.accDist + V0 * u;                                  // cruise
                u -= r.cruise;
                const start = r.accDist + V0 * r.cruise;
                if (u < r.tDec) { const q = u / r.tDec; return start + r.decDist * (1 - Math.pow(1 - q, 3)); }   // brake past the line
                u -= r.tDec;
                const s = Math.min(1, u / SPRING);                                            // damped-spring lock-in
                return r.F + OVER * Math.exp(-5.2 * s) * Math.cos(9 * s) * (s >= 1 ? 0 : 1);
            };
            const endAt = (r) => r.tWind + r.tAcc + r.cruise + r.tDec + SPRING;

            return new Promise((resolve) => {
                const t0 = performance.now();
                let last = t0;
                const tick = (now) => {
                    const t = now - t0, dt = Math.max(1, now - last);
                    last = now;
                    let all = true;
                    reels.forEach((r) => {
                        if (r.done) return;
                        const te = endAt(r);
                        const pos = t >= te ? r.F : posAt(r, t);
                        const v = Math.abs(pos - r.pos) / dt;                                      // px per ms
                        r.pos = pos;
                        const y = Math.round((pos - r.base) * 100) / 100;
                        r.strip.style.transform = `translate3d(0,${y}px,0)`;
                        const sp = Math.min(1, Math.max(0, (v - 0.35) / 1.2));
                        r.streak.style.opacity = sp.toFixed(2);
                        r.strip.style.opacity = (1 - 0.35 * sp).toFixed(2);
                        const row = Math.floor(pos / r.H);
                        if (r.i === 0 && row !== r.lastRow && v > 0.3) { Sound.tick(row); }
                        r.lastRow = row;
                        if (t >= te) {
                            r.done = true;
                            r.strip.style.transform = `translate3d(0,${-(r.base - r.F)}px,0)`;
                            r.strip.style.opacity = "1"; r.streak.style.opacity = "0";
                            r.reel.classList.add("is-locked");
                            Sound.tone(150, 70, "triangle", 0.07);
                        } else all = false;
                    });
                    if (all) {
                        DOM.reels[0].parentElement.classList.remove("is-spinning");
                        // collapse each strip to the three landed symbols so the DOM stays tiny
                        reels.forEach((r) => this.paint(r.i, this.visible[r.i]));
                        resolve();
                    } else this.raf = window.requestAnimationFrame(tick);
                };
                this.raf = window.requestAnimationFrame(tick);
            });
        },

        resolveSpin(bet, results) {
            const [a, b, c] = results;
            let payout = 0;

            if (a === b && b === c) {
                payout = bet * 10;
            } else if (a === b || b === c || a === c) {
                payout = bet * 2;
            }

            if (payout > 0) {
                DOM.reels.forEach((reel, i) => {
                    const hit = (a === b && b === c) || results.filter((x) => x === results[i]).length > 1;
                    if (hit) reel.classList.add("is-win");
                });
                DOM.slotsResult.textContent = `${results.join(" ")} \u2014 Winning combination! You won ${payout} chips.`;
                Notify.success(`Slots: won ${payout} chips.`);
                Sound.win();
                if (a === b && b === c) Effects.celebrate(`JACKPOT! +${payout} chips`);
            } else {
                DOM.slotsResult.textContent = `${results.join(" ")} \u2014 No match. Lost ${bet} chips.`;
                Notify.error(`Slots: lost ${bet} chips.`);
                Sound.lose();
            }

            resolveGameOutcome("slots", { entries: [{ wager: bet, payout }] });
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

        /** Two-stage 3D flip: the card turns edge-on, the face is swapped while it is invisible, then it turns back. */
        flip(el, apply, ms = 210) {
            const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
            if (reduce || !el.animate) { apply(); return Promise.resolve(); }
            const T = (deg, sc) => `perspective(700px) rotateY(${deg}deg) scale(${sc})`;
            return new Promise((resolve) => {
                const a = el.animate([{ transform: T(0, 1) }, { transform: T(90, 1.06) }], { duration: ms, easing: "ease-in", fill: "forwards" });
                a.onfinish = () => {
                    apply();
                    const b = el.animate([{ transform: T(-90, 1.06) }, { transform: T(0, 1) }], { duration: ms * 1.15, easing: "cubic-bezier(.2,.8,.3,1.2)" });
                    a.cancel(); b.onfinish = () => resolve(); b.oncancel = () => resolve();
                };
                a.oncancel = () => resolve();
            });
        },
        setCardFace(el, card) {
            if (!card) { el.textContent = "?"; el.classList.add("hilo-card-hidden"); el.classList.remove("card-red", "card-black"); return; }
            el.textContent = `${card.rank}${card.suit}`;
            el.classList.remove("hilo-card-hidden");
            el.classList.toggle("card-red", Deck.isRedSuit(card.suit));
            el.classList.toggle("card-black", !Deck.isRedSuit(card.suit));
        },
        /** After the result has been shown: the new card slides into the "current" slot with a flip, the next slot flips face-down again. */
        advanceCard(nextCard) {
            const hold = (ms) => new Promise((r) => window.setTimeout(r, ms));
            return hold(900).then(() => Promise.all([
                this.flip(DOM.hiloCurrentCard, () => { this.currentCard = nextCard; this.setCardFace(DOM.hiloCurrentCard, nextCard); }),
                hold(120).then(() => this.flip(DOM.hiloNextCard, () => this.setCardFace(DOM.hiloNextCard, null)))
            ]));
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
            // flip the hidden card over, hold a beat so the player can read it, then resolve
            this.flip(DOM.hiloNextCard, () => this.setCardFace(DOM.hiloNextCard, nextCard), 230)
                .then(() => new Promise((r) => window.setTimeout(r, 350)))
                .then(() => this.resolveGuess(direction, bet, nextCard));
        },

        resolveGuess(direction, bet, nextCard) {
            const isHigher = nextCard.value > this.currentCard.value;
            const isLower = nextCard.value < this.currentCard.value;
            const guessedCorrectly = (direction === "higher" && isHigher) || (direction === "lower" && isLower);
            const directionLabel = direction === "higher" ? "higher" : "lower";
            let payout = 0;

            if (!isHigher && !isLower) {
                payout = bet;
                DOM.hiloResult.textContent = `Push on ${nextCard.rank}${nextCard.suit}. Bet returned.`;
                Notify.warning("Hi-Lo: push, bet returned.");
            } else if (guessedCorrectly) {
                payout = bet * 2;
                DOM.hiloResult.textContent = `Correct! ${nextCard.rank}${nextCard.suit} was ${directionLabel}. You won ${payout} chips.`;
                Notify.success(`Hi-Lo: won ${payout} chips.`);
                Sound.win();
                if (payout >= CONFIG.BIG_WIN_THRESHOLD) Effects.celebrate(`NICE CALL! +${payout} chips`);
            } else {
                DOM.hiloResult.textContent = `Wrong! ${nextCard.rank}${nextCard.suit} was not ${directionLabel}. Lost ${bet} chips.`;
                Notify.error(`Hi-Lo: lost ${bet} chips.`);
                Sound.lose();
            }

            resolveGameOutcome("hilo", { entries: [{ wager: bet, payout }] });
            this.advanceCard(nextCard).then(() => { this.isResolving = false; });
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
            if (Rig.on && out.includes(Rig.target)) { const r = out.filter((x) => x !== Rig.target); return [Rig.target, ...this.shuffle.call({ shuffle: null }, r)]; }
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

        /** Hands a finished selection round to the universal resolver (prize is house-funded, host only). */
        settleDraw(winners, participants, roundId, prizePool) {
            return resolveGameOutcome("draw:" + this.mode, { roundId, winners, participants, prizePool });
        },

        async start() {
            if (this.running) return;
            if (this.mode === "marble") { MarbleRace.hostStart(); return; }
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
            const prize = this.mode === "roles" ? 0 : GameResolver.readPrize("draw-prize", Rig.on && names.includes(Rig.target));
            const runner = { slots: this.runSlots, bingo: this.runBingo, cards: this.runCards, laser: this.runLaser, bracket: this.runBracket, plinko: this.runPlinko, chests: this.runChests, roles: this.runRoles }[this.mode];
            try {
                await runner.call(this, names, winners, id);
                this.logDraw(winners);
                this.settleDraw(winners, names, `${this.mode}-${id}-${Date.now().toString(36)}`, prize);
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
                const streak = this.mk("div", "reel-streak");
                reel.append(strip, streak, this.mk("div", "reel-window"));
                box.appendChild(reel);
                return { reel, strip, streak, winner, k, dist: (target - 1) * H, dur: 2400 + k * 650, done: false, lastRow: -1, prevY: 0 };
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
                        const ramp = Math.min(1, q / 0.08);
                        y = (r.dist + OVER) * (1 - Math.pow(1 - q, 4)) * (ramp * ramp * (3 - 2 * ramp));   // eased spin-up, long brake, small overshoot
                    } else {
                        const s = (p - A) / (1 - A);
                        y = r.dist + OVER * Math.exp(-4 * s) * Math.cos(10 * s);   // damped spring = physics bounce
                        r.reel.classList.remove("is-spinning");
                    }
                    y = Math.round(y * 100) / 100;
                    const vel = Math.abs(y - r.prevY) / Math.max(1, dt);          // px per ms
                    r.prevY = y;
                    const sp = r.done ? 0 : Math.min(1, Math.max(0, (vel - 0.3) / 1.1));
                    r.strip.style.transform = `translate3d(0,${-y}px,0)`;
                    r.streak.style.opacity = sp.toFixed(2);
                    r.strip.style.opacity = (1 - 0.4 * sp).toFixed(2);
                    const row = Math.floor(y / H);
                    if (r.k === 0 && row !== r.lastRow) { r.lastRow = row; Sound.tick(row); }
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
                card.animate([
                    { transform: `translate3d(${dx}px, ${dy}px, 0) rotate(-14deg) scale(.6)`, opacity: 0, offset: 0 },
                    { opacity: 1, offset: 0.12 },
                    { transform: `translate3d(${dx * 0.4}px, ${dy * 0.4 - 24}px, 0) rotate(6deg) scale(1.08)`, opacity: 1, offset: 0.55 },
                    { transform: "translate3d(0,0,0) rotate(0deg) scale(1)", opacity: 1, offset: 1 }
                ], { duration: 720, delay: i * 260, easing: "cubic-bezier(.2,.8,.25,1)", fill: "backwards" });
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
            return { key, sec, stage, ctl, res, bet, lab };
        };
        const btn = (label, cls = "btn btn-primary", fn) => { const b = mk("button", cls, label); b.type = "button"; if (fn) b.addEventListener("click", fn); return b; };

        const settle = (g, name, bet, payout, msg) => {
            resolveGameOutcome(g.key, { entries: [{ wager: bet, payout }] });
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
            const chips = Object.keys(bets).map((k) => { const b = btn("", "btn btn-game-select xg-chipbtn"); b.append(k + "x", mk("small", "", "0")); b.addEventListener("click", () => { if (spinning) return; const s = Validate.parseBet(g.bet); if (s === null) return; if (!BetLimits.ok("moneywheel", Object.values(bets).reduce((a, b) => a + b, 0) + s)) return; State.debit(s); bets[k] += s; b.lastChild.textContent = bets[k]; }); return b; });
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
        const MODE_LABEL = { slots: "Slot Reels", bingo: "Bingo Blower", cards: "Card Dealer", laser: "Chip Laser", bracket: "1v1 Bracket", plinko: "Plinko", marble: "Marble Race", chests: "Mystery Chests", roles: "Roles Matrix" };
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
                    const pool = shuffle(names).slice(0, 16);   // shuffle() keeps the chosen winner at index 0, so they are never cut
                    if (pool.length < 2) { winners.splice(0, winners.length, pool[0]); this.announce(pool[0], 0); return; }
                    const size = 2 ** Math.ceil(Math.log2(pool.length)), byes = size - pool.length, slots = []; let pi = 0;
                    for (let m = 0; m < size / 2; m += 1) slots.push(pool[pi++], m < byes ? null : pool[pi++]);
                    const rounds = [], losers = []; let cur = slots;
                    while (cur.length > 1) {
                        const nxt = [], ms = [];
                        for (let m = 0; m < cur.length / 2; m += 1) { const a = cur[2 * m], b = cur[2 * m + 1], rigged = Rig.on && (a === Rig.target || b === Rig.target), win = !b ? a : !a ? b : rigged ? Rig.target : Math.random() < 0.5 ? a : b; if (a && b) losers.push({ n: win === a ? b : a, r: rounds.length }); ms.push({ bye: !a || !b, win }); nxt.push(win); }
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
                    const queue = pool.slice(), chips = [], cnt = new Array(B).fill(0), landed = [], chosen = [], fav = (Rig.on && pool.includes(Rig.target)) ? Rig.target : null; let spawnT = 0, jolt = 0, idx = 0;
                    await this.frames(id, (dt) => {
                        spawnT += dt; if (queue.length && spawnT > 320) { spawnT = 0; const nm = queue.shift(); chips.push({ name: nm, x: rnd(w * 0.35, w * 0.65), y: 12, vx: rnd(-30, 30), vy: 0, r: 11, st: 0, color: this.CHIP_COLORS[idx++ % 5], bin: 0 }); }
                        for (let sub = 0; sub < 3; sub += 1) {
                            const s = dt / 3000;
                            chips.forEach((c) => {
                                if (c.st) return; c.vy += 1000 * s;
                                if (fav && c.name === fav && c.y > 40) c.vx += ((w / 2) - c.x) * 9 * s - c.vx * 1.6 * s;   // soft pull toward the centre bins: looks like luck, lands in the star zone
                                c.x += c.vx * s; c.y += c.vy * s;
                                if (c.x < c.r) { c.x = c.r; c.vx = Math.abs(c.vx) * 0.6; } if (c.x > w - c.r) { c.x = w - c.r; c.vx = -Math.abs(c.vx) * 0.6; }
                                pegs.forEach((p) => {
                                    const dx = c.x - p.x, dy = c.y - p.y, d = Math.hypot(dx, dy), min = c.r + 4;
                                    if (d < min && d > 0) { const nx = dx / d, ny = dy / d; c.x = p.x + nx * min; c.y = p.y + ny * min; const vn = c.vx * nx + c.vy * ny; if (vn < 0) { c.vx -= 1.55 * vn * nx; c.vy -= 1.55 * vn * ny; c.vx += rnd(-20, 20); p.f = 1; P.burst(p.x, p.y, 2, "#fff"); jolt = Math.max(jolt, 0.7); } }
                                });
                                if (c.y + c.r >= floorY) {
                                    c.st = 1; c.bin = Math.max(0, Math.min(B - 1, Math.floor(c.x / bw))); c.x = (c.bin + 0.5) * bw + rnd(-8, 8); c.y = h - 18 - cnt[c.bin] * 5; cnt[c.bin] += 1; landed.push(c);
                                    if (c.bin >= 2 && c.bin <= 4 && chosen.length < N && (!fav || chosen.includes(fav) || c.name === fav)) { chosen.push(c.name); this.announce(c.name, chosen.length - 1); P.burst(c.x, floorY, 24, "#f4c430"); jolt = 4; buzz(30); }
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
                    if (fav && !chosen.includes(fav)) { chosen.push(fav); this.announce(fav, 0); await this.wait(350, id); }
                    const rest = landed.filter((c) => !chosen.includes(c.name)).sort((a, b) => Math.abs(a.bin - 3) - Math.abs(b.bin - 3));
                    while (chosen.length < N && rest.length) { const c = rest.shift(); chosen.push(c.name); this.announce(c.name, chosen.length - 1); await this.wait(350, id); }
                    winners.splice(0, winners.length, ...chosen);
                },

                async runChests(names, winners, id) {
                    const N = winners.length, total = Math.min(24, Math.max(9, names.length, N)), contents = shuffle([...winners, ...new Array(total - N).fill(null)]);
                    const grid = mk("div", "chest-grid"); let found = 0; const order = [], fav = (Rig.on && winners.includes(Rig.target)) ? Rig.target : null;
                    contents.forEach((c0, ci) => {
                        const b = btn("🎁", "chest", () => {
                            if (b.classList.contains("open") || found >= N || id !== this.runId) return;
                            let c = contents[ci];
                            if (c && fav && found === 0 && c !== fav) { const j = contents.indexOf(fav); if (j >= 0) contents[j] = c; contents[ci] = fav; c = fav; }   // swap hidden contents before reveal
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
                    const base = winners.map((_, i) => ROLES[i] || "Member" + (i - ROLES.length + 1)), roles = (Rig.on && winners[0] === Rig.target) ? [base[0], ...shuffle(base.slice(1))] : shuffle(base);
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


    /* =========================================================================
       LA VIUDA NEGRA (Black Widow Poker) — real-time multiplayer, synced at rooms/<code>/bw
       Per-player stats live at rooms/<code>/bwstats so a new deal never wipes them.
       Flow: lobby (host starts) -> ante -> 5 cards each + 5-card "La Viuda" -> clockwise turns
             (pass / swap / fold / "Me hasta aqui") -> final cycle -> showdown -> next hand or back to lobby.
       Solo mode: with one player seated, they play the hand against "The House" (a hand that never acts).
       ========================================================================= */
    const HOUSE = "_house";
    const BW = {
        ANTE: 10, MAX_SEATS: 6, IDLE_MS: 45000, NEXT_MS: 12000,
        ref: null, cb: null, statsRef: null, statsCb: null, tick: null, pres: { armed: null }, ann: {},
        g: { phase: "lobby" }, stats: {}, hid: null, paid: 0, dealt: null, shown: null, faces: {}, sel: { h: null, w: null },
        CATS: ["High Card", "One Pair", "Two Pair", "Three of a Kind", "Straight", "Flush", "Full House", "Four of a Kind", "Straight Flush", "Royal Flush"],
        R: "23456789TJQKA", S: ["\u2660", "\u2665", "\u2666", "\u2663"],
        $(id) { return document.getElementById(id); },
        nm(u) { return u === HOUSE ? "The House" : u; },
        isLive(g) { return g.phase === "play" || g.phase === "final"; },
        isFirst(g, u) { return !(((g.played || {})[u] || 0) > 0); },
        /* La Viuda is "claimed" (g.up = 1) once somebody swaps all five. Until then, a player on their FIRST turn may still swap one card blind (hidden slot), swap all five, or pass. */
        canSwap1(g, u) { return this.isLive(g) && g.order[g.turn] === u && (!!g.up || this.isFirst(g, u)); },
        canSwapAll(g, u) { return this.isLive(g) && g.order[g.turn] === u && !g.up && this.isFirst(g, u); },
        store(key, val) {
            try { if (val === undefined) return window.sessionStorage.getItem(key); window.sessionStorage.setItem(key, val); } catch (e) { /* storage unavailable */ }
            return null;
        },
        init() {
            const on = (id, fn) => this.$(id).addEventListener("click", fn);
            on("bw-leave", () => this.leave());
            on("bw-deal", () => this.deal());
            on("bw-lobby-back", () => this.backToLobby());
            on("bw-pass", () => this.act("pass"));
            on("bw-swapall", () => this.act("swapall"));
            on("bw-swap1", () => this.act("swap1", { h: this.sel.h, w: this.sel.w }));
            on("bw-fold", () => this.act("fold"));
            on("bw-close", () => this.act("close"));
            on("bw-kick", () => this.kick());
            on("bw-result-close", () => this.closeResult());
            on("bw-result-deal", () => { this.closeResult(); this.deal(); });
            this.$("bw-result").addEventListener("click", (e) => { if (e.target === this.$("bw-result")) this.closeResult(); });
            document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !this.$("bw-result").hidden) this.closeResult(); });
        },
        start() {
            this.stop(); if (!Room.db || !Room.code) return;
            this.ref = Room.db.ref(`rooms/${Room.code}/bw`);
            this.statsRef = Room.db.ref(`rooms/${Room.code}/bwstats`);
            this.cb = (s) => {
                const n = s.val() || { phase: "lobby" };
                if (n.hid !== this.g.hid) { this.faces = {}; this.sel = { h: null, w: null }; }
                this.g = n;
                Tables.announce(this.ann, n, "Black Widow Poker"); Tables.badge("blackwidow", n, this.MAX_SEATS); Tables.presence(this.pres, this.ref, n, State.username);
                this.sync(); this.render();
            };
            this.statsCb = (s) => { this.stats = s.val() || {}; this.renderStats(); };
            this.ref.on("value", this.cb);
            this.statsRef.on("value", this.statsCb);
            this.tick = window.setInterval(() => { if (this.g.phase !== "lobby") this.renderControls(); }, 1000);
            this.render();
        },
        stop() {
            if (this.ref && this.cb) this.ref.off("value", this.cb);
            if (this.statsRef && this.statsCb) this.statsRef.off("value", this.statsCb);
            if (this.tick) window.clearInterval(this.tick);
            this.ref = this.cb = this.statsRef = this.statsCb = this.tick = null;
            this.g = { phase: "lobby" }; this.stats = {}; this.hid = null; this.shown = null; this.faces = {}; this.sel = { h: null, w: null }; this.pres = { armed: null }; this.ann = {};
            Tables.badge("blackwidow", {}, this.MAX_SEATS);
            const m = document.getElementById("bw-result"); if (m) m.hidden = true;
        },
        /* --- table & seats --- */
        canSit() { if (State.balance < this.ANTE) { Notify.error(`You need at least ${this.ANTE} chips to sit down.`); return false; } return true; },
        openTable() { if (this.ref && this.canSit()) Tables.open(this.ref, State.username, this.MAX_SEATS); },
        take(key) { if (this.ref && this.canSit()) Tables.take(this.ref, State.username, key, ["lobby", "done"]); },
        leave() {
            const me = State.username, g = this.g; if (!this.ref || !me) return;
            if (this.isLive(g) && (g.order || []).includes(me)) return Notify.warning("Finish the hand before leaving the table.");
            Tables.leave(this.ref, me);
        },
        closeTable() { if (this.ref) Tables.close(this.ref, State.username, State.isHost, ["lobby", "done"]).then((r) => { if (!r.committed) Notify.warning("Finish the hand before closing the table."); }); },
        backToLobby() {
            const me = State.username; if (!this.ref) return;
            this.ref.transaction((v) => {
                if (!Tables.isOpen(v) || v.owner !== me || v.phase !== "done") return;
                return { phase: "lobby", owner: v.owner, seats: v.seats, max: v.max, rot: v.rot || 0, hid: Date.now(), turnAt: Date.now() };
            });
        },
        /* --- deal: one shuffled 52-card deck, 5 cards per player, 5 face-down cards for La Viuda.
               Host starts the game; after a showdown any seated player can deal once the host has been idle a while.
               One seated player = solo hand against The House (5 extra cards, matched ante, never acts). --- */
        deal() {
            const me = State.username; if (!this.ref || !me) return;
            if (State.balance < this.ANTE) return Notify.error(`You need ${this.ANTE} chips for the ante.`);
            this.ref.transaction((v) => {
                if (!Tables.isOpen(v) || this.isLive(v)) return;
                const names = Tables.names(v.seats); if (!names.includes(me)) return;
                if (!Tables.canDrive(v, me) && !(v.phase === "done" && Date.now() - (v.turnAt || 0) >= this.NEXT_MS)) return;
                const solo = names.length === 1, rot = (v.rot || 0) + 1, order = names.map((_, i) => names[(i + rot) % names.length]);
                const deck = Array.from({ length: 52 }, (_, i) => i);
                for (let i = 51; i > 0; i -= 1) { const j = Math.floor(Math.random() * (i + 1));[deck[i], deck[j]] = [deck[j], deck[i]]; }
                const n = order.length * 5, hands = {}, ante = {}; order.forEach((u, i) => { hands[u] = deck.slice(i * 5, i * 5 + 5); ante[u] = this.ANTE; });
                if (solo) hands[HOUSE] = deck.slice(n + 5, n + 10);
                return {
                    seats: v.seats, owner: v.owner, max: v.max, rot, phase: "play", hid: Date.now(), order, hands, widow: deck.slice(n, n + 5), up: 0, house: solo ? 1 : 0,
                    in: ante, pot: (order.length + (solo ? 1 : 0)) * this.ANTE, turn: 0, played: { _: 0 }, fin: { _: 0 }, folded: { _: 0 }, closer: "", turnAt: Date.now(), last: "", res: null
                };
            });
        },
        /* --- turn actions: pass / swapall (first turn) / swap1 (needs La Viuda face-up) / fold / close ("Me hasta aqui") --- */
        act(type, p, who) {
            const me = who || State.username; if (!this.ref || !me) return;
            this.ref.transaction((v) => {
                if (!v || !this.isLive(v) || v.order[v.turn] !== me) return;
                if (who && Date.now() - (v.turnAt || 0) < this.IDLE_MS) return;
                v.played = v.played || {}; v.fin = v.fin || {}; v.folded = v.folded || {};
                const first = !((v.played[me] || 0) > 0), hand = v.hands[me].slice(), widow = v.widow.slice(); let note;
                if (type === "close") {
                    if (v.phase !== "play") return;
                    v.phase = "final"; v.closer = me; note = `${me} called \u201CMe hasta aqu\u00ED\u201D \u2014 final cycle begins`;
                } else if (type === "swapall") {
                    if (!first || v.up) return;            // only on your own first turn, and only while nobody has claimed La Viuda yet
                    v.fx = { id: Date.now() + "-" + Math.floor(Math.random() * 1e6), u: me, t: "all", was: 0, at: Date.now() };
                    v.hands[me] = widow; v.widow = hand; v.up = 1; note = `${me} swapped all five cards with La Viuda`;
                } else if (type === "swap1") {
                    const h = p && p.h, w = p && p.w;
                    if ((!v.up && !first) || !(h >= 0 && h < 5) || !(w >= 0 && w < 5)) return;
                    v.fx = { id: Date.now() + "-" + Math.floor(Math.random() * 1e6), u: me, t: "one", h, w, was: v.up ? 1 : 0, at: Date.now() };
                    const t = hand[h]; hand[h] = widow[w]; widow[w] = t; v.hands[me] = hand; v.widow = widow; note = v.up ? `${me} swapped one card with La Viuda` : `${me} swapped one card with a hidden La Viuda card`;
                } else if (type === "fold") {
                    v.folded[me] = 1; note = `${me} folded and forfeits the ante`;
                } else if (type === "pass") { note = `${me} passed`; } else return;
                v.played[me] = (v.played[me] || 0) + 1; v.last = note;
                if (type !== "close" && v.phase === "final") v.fin[me] = 1;
                const alive = v.order.filter((u) => !v.folded[u]);
                if (type === "fold" && (alive.length <= 1)) return this.finish(v); // everybody else folded (or the solo player folded to The House)
                let nxt = (v.turn + 1) % v.order.length;
                for (let k = 0; k < v.order.length && v.folded[v.order[nxt]]; k += 1) nxt = (nxt + 1) % v.order.length;
                if (v.phase === "final" && v.order[nxt] === v.closer) return this.finish(v);
                v.turn = nxt; v.turnAt = Date.now(); return v;
            }).then((r) => { this.settle(r); this.sel = { h: null, w: null }; }).catch(() => { });
        },
        kick() {
            const g = this.g, u = g.order && g.order[g.turn];
            if (!u || u === State.username || !this.isLive(g)) return;
            if (Date.now() - (g.turnAt || 0) < this.IDLE_MS) return Notify.warning("Give them a little longer.");
            this.act("pass", null, u);
        },
        /* --- showdown: best 5-card poker hand takes the pot, ties split it; folded hands are out; The House joins solo hands --- */
        finish(v) {
            const fold = v.folded || {}, live = v.order.filter((u) => !fold[u]), all = v.house ? live.concat(HOUSE) : live;
            const sc = all.map((u) => this.eval5(v.hands[u])), top = sc.reduce((a, b) => (this.cmp(a, b) >= 0 ? a : b));
            const winners = all.filter((u, i) => this.cmp(sc[i], top) === 0), pot = v.pot, each = Math.floor(pot / winners.length), shares = {}, cats = {}, cidx = {};
            winners.forEach((u, i) => { shares[u] = each + (i === 0 ? pot - each * winners.length : 0); });
            all.forEach((u, i) => { cats[u] = this.CATS[sc[i][0]]; cidx[u] = sc[i][0]; });
            v.order.forEach((u) => { if (fold[u]) { cats[u] = "Folded"; cidx[u] = 0; } });
            const byFold = v.house ? live.length === 0 : live.length <= 1;
            v.phase = "done"; v.turnAt = Date.now(); v.res = { winners, pot, best: byFold ? (v.house ? "The House by fold" : "Everyone else folded") : this.CATS[top[0]], cats, cidx, shares, byFold: byFold ? 1 : 0 };
            return v;
        },
        settle(r) {
            if (!r || !r.committed) return;
            const v = r.snapshot.val(); if (!v || v.phase !== "done" || !v.res) return;
            Object.keys(v.res.shares).filter((u) => u !== HOUSE).forEach((u) => Room.playersRef.child(u).child("balance").transaction((b) => (b == null ? b : b + v.res.shares[u])));
        },
        /* --- hand evaluation: [category, ...tiebreakers]; 0 High Card ... 9 Royal Flush (Ace plays high or low in straights) --- */
        eval5(cs) {
            const rk = cs.map((c) => c % 13).sort((a, b) => b - a), su = cs.map((c) => (c / 13) | 0), fl = su.every((s) => s === su[0]), cnt = {};
            rk.forEach((r) => { cnt[r] = (cnt[r] || 0) + 1; });
            const gr = Object.keys(cnt).map(Number).sort((a, b) => cnt[b] - cnt[a] || b - a), shape = gr.map((r) => cnt[r]).join("");
            const uniq = gr.length === 5, st = uniq && rk[0] - rk[4] === 4, wheel = uniq && rk.join() === "12,3,2,1,0", hi = wheel ? 3 : rk[0];
            let cat = 0;
            if (st || wheel) cat = fl ? (hi === 12 ? 9 : 8) : 4;
            else if (shape === "41") cat = 7; else if (shape === "32") cat = 6; else if (fl) cat = 5;
            else if (shape === "311") cat = 3; else if (shape === "221") cat = 2; else if (shape === "2111") cat = 1;
            return [cat, ...((st || wheel) ? [hi] : gr)];
        },
        cmp(a, b) { for (let i = 0; i < Math.max(a.length, b.length); i += 1) { const d = (a[i] || 0) - (b[i] || 0); if (d) return d; } return 0; },
        /* --- chips: ante is charged once per hand from the shared state (persisted per hand so a reload never double-charges) --- */
        sync() {
            const g = this.g, me = State.username;
            if (g.phase !== "done") this.closeResult();
            if (!me || !g.hid) return;
            if (this.hid !== g.hid) { this.hid = g.hid; this.paid = Number(this.store(`bw-paid-${Room.code}-${g.hid}-${me}`)) || 0; }
            const owed = ((g.in || {})[me] || 0) - this.paid;
            if (owed > 0) { State.debit(Math.min(owed, State.balance)); this.paid += owed; this.store(`bw-paid-${Room.code}-${g.hid}-${me}`, String(this.paid)); }
            if (g.phase !== "done" || !g.res) return;
            const doneKey = `bw-done-${Room.code}-${g.hid}-${me}`;
            if ((g.order || []).includes(me) && !this.store(doneKey)) {
                this.store(doneKey, "1");
                const share = (g.res.shares || {})[me] || 0, stake = this.paid, cat = ((g.res.cidx || {})[me]) || 0;
                resolveGameOutcome("blackwidow", { roundId: g.hid + "-" + me, entries: [{ wager: stake, payout: share, credited: true }] });
                if (this.statsRef) {
                    this.statsRef.child(me).transaction((s) => {
                        s = s || { hands: 0, wins: 0, net: 0, best: 0 };
                        s.hands = (s.hands || 0) + 1; if (share > 0) s.wins = (s.wins || 0) + 1;
                        s.net = (s.net || 0) + share - stake; s.best = Math.max(s.best || 0, cat); return s;
                    });
                }
                if (share > 0) { Effects.celebrate(`\u2660 ${g.res.best} \u2014 you win ${share}!`); this.sparkle(); Notify.success(`You won ${share} chips${g.res.byFold ? "." : " with " + g.res.cats[me] + "."}`); }
            }
            if (this.shown !== g.hid) {
                this.shown = g.hid;
                window.setTimeout(() => { if (this.g.hid === g.hid && this.g.phase === "done" && Router.currentGameKey === "blackwidow") this.openResult(); }, 1800);
            }
        },
        sparkle() {
            for (let i = 0; i < 36; i += 1) {
                const s = document.createElement("span"); s.className = "spark"; s.style.left = (30 + Math.random() * 40) + "vw"; s.style.top = (30 + Math.random() * 30) + "vh";
                s.style.setProperty("--sx", ((Math.random() - 0.5) * 320) + "px"); s.style.setProperty("--sy", ((Math.random() - 0.5) * 320) + "px");
                s.addEventListener("animationend", () => s.remove()); document.body.appendChild(s);
            }
        },
        /* --- cards: two faces so turning over is a real 3D flip; face content is only put in the DOM when the card is face-up --- */
        card(key, c, up) {
            const d = document.createElement("div"), inn = document.createElement("div"), f = document.createElement("div"), b = document.createElement("div");
            d.className = "bw-card"; d.dataset.k = key; inn.className = "bw-in"; f.className = "bw-face bw-front"; b.className = "bw-face bw-back";
            if (up && c >= 0) {
                const s = (c / 13) | 0, rk = this.R[c % 13], t = document.createElement("b"), i = document.createElement("i");
                t.textContent = rk === "T" ? "10" : rk; i.textContent = this.S[s]; f.append(t, i);
                if (s === 1 || s === 2) d.classList.add("red");
            }
            inn.append(f, b); d.appendChild(inn);
            const was = this.faces[key]; this.faces[key] = !!up;
            if (up && was === false) window.requestAnimationFrame(() => window.requestAnimationFrame(() => d.classList.add("up")));
            else if (up) d.classList.add("up");
            return d;
        },
        makePick(cd, kind, i, label) {
            cd.classList.add("pick"); if (this.sel[kind] === i) cd.classList.add("sel");
            cd.tabIndex = 0; cd.setAttribute("role", "button"); cd.setAttribute("aria-label", label); cd.setAttribute("aria-pressed", this.sel[kind] === i ? "true" : "false");
            const go = () => { this.sel[kind] = this.sel[kind] === i ? null : i; this.render(); };
            cd.addEventListener("click", go);
            cd.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
        },
        /* Gliding, flipping swap animation. g.fx is written together with the swap, so every client plays the same thing once.
           The real cards are already in their new places; we hide them, fly two clones along an arc and flip them as they cross. */
        lastFx: null, fxCount: 0,
        playSwapFx() {
            const g = this.g, fx = g.fx; if (!fx || !fx.id) return;
            const joinedLate = this.lastFx === null;
            if (fx.id === this.lastFx) return;
            this.lastFx = fx.id;
            if (joinedLate && Date.now() - (fx.at || 0) > 4000) return;   // joined mid-hand: don't replay an old swap
            if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
            const me = State.username, mine = fx.u === me, hand = g.hands[fx.u] || [], pairs = fx.t === "all" ? [0, 1, 2, 3, 4].map((i) => [i, i]) : [[fx.h, fx.w]];
            pairs.forEach(([h, w], n) => {
                const he = document.querySelector(`#bw-seats .bw-card[data-k="${fx.u}:${h}"]`), we = document.querySelector(`#bw-widow .bw-card[data-k="w${w}"]`);
                if (!he || !we) return;
                const hr = he.getBoundingClientRect(), wr = we.getBoundingClientRect(), delay = n * 90, dur = 760;
                // [element, from-rect, to-rect, card, starts face-up, ends face-up]
                const legs = [
                    [we, hr, wr, g.widow[w], mine, !!g.up],                    // my old card: hand -> widow
                    [he, wr, hr, hand[h], !!fx.was, mine]                       // widow card: widow -> hand
                ];
                legs.forEach(([real, from, to, c, fromUp, toUp], li) => {
                    if (c == null || c < 0) return;
                    real.style.visibility = "hidden";
                    const known = fromUp || toUp, fl = this.card("fx" + (this.fxCount += 1), c, known);
                    delete this.faces["fx" + this.fxCount];
                    fl.classList.remove("up", "pick", "sel", "deal"); if (fromUp) fl.classList.add("up");
                    const dx = to.left - from.left, dy = to.top - from.top, lift = Math.min(70, 24 + Math.abs(dy) * 0.18) * (li ? 1 : -1);
                    Object.assign(fl.style, { position: "fixed", left: from.left + "px", top: from.top + "px", width: from.width + "px", height: from.height + "px", margin: "0", zIndex: "400", pointerEvents: "none", transition: "none", willChange: "transform" });
                    fl.firstChild.style.transitionDuration = (dur * 0.7) + "ms"; fl.firstChild.style.transitionDelay = delay + 80 + "ms";
                    document.body.appendChild(fl);
                    const sx = to.width / from.width, sy = to.height / from.height;
                    const anim = fl.animate([
                        { transform: "translate(0,0) scale(1) rotate(0deg)", offset: 0 },
                        { transform: `translate(${dx * 0.5}px,${dy * 0.5 + lift}px) scale(1.22) rotate(${li ? 7 : -7}deg)`, offset: 0.5 },
                        { transform: `translate(${dx}px,${dy}px) scale(${sx},${sy}) rotate(0deg)`, offset: 1 }
                    ], { duration: dur, delay, easing: "cubic-bezier(.4,.1,.2,1)", fill: "both" });
                    if (fromUp !== toUp) window.requestAnimationFrame(() => window.requestAnimationFrame(() => fl.classList.toggle("up", toUp)));
                    const done = () => { fl.remove(); real.style.visibility = ""; };
                    anim.onfinish = done; anim.oncancel = done; window.setTimeout(done, dur + delay + 600);
                });
                Sound.click && Sound.click();
            });
        },
        describe(c) { const s = (c / 13) | 0, rk = this.R[c % 13]; return (rk === "T" ? "10" : rk) + this.S[s]; },
        dealFx(cd, round, ord) {
            const up = cd.classList.contains("up");
            if (up) cd.classList.remove("up");                       // deal face-down, then turn my own cards over on arrival
            CardFX.add(cd, { round, ord, flip: false, reveal: up ? () => cd.classList.add("up") : null });
        },
        render() {
            if (CardFX.deferRender(this)) return;
            const g = this.g, inHand = this.isLive(g) || (g.phase === "done" && !!g.res), lobby = !Tables.isOpen(g) || !inHand, fresh = this.dealt !== g.hid;
            this.$("bw-lobby").hidden = !lobby; this.$("bw-live").hidden = lobby;
            if (lobby) {
                Tables.renderLobby(this.$("bw-lobby"), g, {
                    title: "La Viuda Negra table", game: "Black Widow Poker", max: this.MAX_SEATS, minStart: 1,
                    soloNote: `Just you so far. Start now to play one hand against The House (ante ${this.ANTE}), or wait for more players.`,
                    onOpen: () => this.openTable(), onTake: (k) => this.take(k), onLeave: () => this.leave(),
                    onStart: () => this.deal(), onClose: () => this.closeTable(), onClaim: () => Tables.claim(this.ref, State.username)
                });
                this.dealt = g.hid; return;
            }
            this.seq = 0;
            this.renderWidow(fresh); this.renderSeats(fresh);
            CardFX.flush(document.getElementById("bw-deck"), 95);
            this.renderControls(); this.renderStats();
            this.dealt = g.hid;
            this.playSwapFx();
        },
        renderWidow(fresh) {
            const g = this.g, me = State.username, live = this.isLive(g), inHand = live || (g.phase === "done" && !!g.res);
            const wrap = this.$("bw-widow-wrap"), el = this.$("bw-widow"); wrap.hidden = !inHand; el.textContent = "";
            if (!inHand) return;
            const canPick = this.canSwap1(g, me), up = !!g.up;
            if (!canPick) this.sel.w = null;
            (g.widow || []).forEach((c, i) => {
                const cd = this.card("w" + i, c, up);
                if (fresh) this.dealFx(cd, 10 + i, 999);
                if (canPick) this.makePick(cd, "w", i, "La Viuda card " + (i + 1) + (up ? ": " + this.describe(c) : " (face-down)"));
                el.appendChild(cd);
            });
            this.$("bw-widow-label").textContent = up ? "La Viuda \u2014 face-up, swap one card at a time" : "La Viuda \u2014 face-down, still unclaimed (swap all five on your first turn, or blind-swap one card)";
        },
        renderSeats(fresh) {
            const g = this.g, me = State.username, el = this.$("bw-seats"), live = this.isLive(g), inHand = live || (g.phase === "done" && !!g.res);
            const names = inHand ? (g.order || []).slice() : Tables.names(g.seats), canPick = this.canSwap1(g, me), done = g.phase === "done", fold = g.folded || {};
            if (inHand && g.house) names.push(HOUSE);
            if (!canPick) this.sel.h = null;
            el.textContent = "";
            names.forEach((u) => {
                const won = done && g.res.winners.includes(u), house = u === HOUSE, folded = !!fold[u], turn = live && g.order[g.turn] === u, d = document.createElement("div");
                d.className = "bw-seat" + (u === me ? " me" : "") + (turn ? " turn" : "") + (won ? " win" : "") + (folded ? " out" : "");
                const n = document.createElement("div"); n.className = "bw-name"; n.append((turn ? "\u25B6 " : "") + this.nm(u) + (u === me ? " (you)" : ""));
                const tag = (t, cls) => { const s = document.createElement("span"); s.className = "bw-tag " + (cls || ""); s.textContent = t; n.appendChild(s); };
                if (u === g.owner) tag("Host");
                if (inHand) {
                    if (house) tag("solo opponent");
                    else {
                        if (folded) tag("Folded", "st-folded"); else if (turn) tag("Playing", "st-playing"); else if (!done) tag("Waiting", "st-waiting");
                        tag(`ante ${(g.in || {})[u] || 0}`);
                        if (g.closer === u) tag("Me hasta aqu\u00ED"); else if (g.phase === "final" && (g.fin || {})[u]) tag("last turn done");
                    }
                    if (done && g.res.cats[u] && !folded && !g.res.byFold) tag(g.res.cats[u]);
                    if (won) tag("+" + g.res.shares[u], "st-won");
                }
                d.appendChild(n);
                if (inHand) {
                    const h = document.createElement("div"), face = (u === me && !house) || (done && !folded && !g.res.byFold); h.className = "bw-hand";
                    (g.hands[u] || []).forEach((c, ci) => {
                        const cd = this.card(u + ":" + ci, c, face);
                        if (fresh) this.dealFx(cd, ci, this.seq = (this.seq || 0) + 1);
                        if (u === me && canPick) this.makePick(cd, "h", ci, "Your card " + (ci + 1) + ": " + this.describe(c));
                        h.appendChild(cd);
                    });
                    d.appendChild(h);
                }
                el.appendChild(d);
            });
        },
        renderControls() {
            const g = this.g, me = State.username, names = Tables.names(g.seats), seated = names.includes(me), live = this.isLive(g);
            const inHand = live || (g.phase === "done" && !!g.res), inOrder = inHand && (g.order || []).includes(me), who = live ? g.order[g.turn] : null, myTurn = who === me;
            const first = live && this.isFirst(g, me), final = g.phase === "final", folded = !!(g.folded || {})[me];
            this.$("bw-pot").textContent = "Pot " + (inHand ? g.pot : 0).toLocaleString("en-US");
            this.$("bw-phase").textContent = { play: "Open play", final: `Final cycle \u2014 ${g.closer} closed`, done: "Showdown" }[g.phase] || "Waiting for players";
            this.$("bw-log").textContent = inHand && g.last ? g.last : "";
            let msg;
            if (g.phase === "done" && g.res) {
                const w = g.res.winners.map((u) => this.nm(u));
                msg = g.res.byFold ? `${w[0]} takes ${g.res.pot} chips \u2014 ${g.res.best.toLowerCase()}.` : w.length > 1 ? `Split pot: ${w.join(" & ")} tie with ${g.res.best}.` : `${w[0]} wins ${g.res.pot} chips with ${g.res.best}.`;
            } else if (live && folded) msg = "You folded. Waiting for the showdown\u2026";
            else if (live && myTurn) {
                if (final) msg = first ? (g.up ? "Last chance \u2014 swap one card with La Viuda, pass, or fold." : "Last chance \u2014 swap all five, blind-swap one card, pass, or fold.") : (g.up ? "Last chance \u2014 swap one card with La Viuda, pass, or fold." : "Last chance \u2014 La Viuda is still hidden: pass or fold.");
                else if (first) msg = g.up ? "Your first turn \u2014 La Viuda is already taken. Tap one of your cards and one La Viuda card to swap, or pass, fold, or close." : "Your first turn \u2014 swap all five with La Viuda (nobody has taken it yet), tap a card of yours + a face-down La Viuda card for a single blind swap, pass, fold, or close.";
                else msg = g.up ? "Tap one of your cards and one La Viuda card, then confirm \u2014 or pass, fold, or close." : "La Viuda is still hidden \u2014 pass, fold, or call \u201CMe hasta aqu\u00ED\u201D.";
            } else if (live) msg = inOrder ? `Waiting for ${who}\u2026` : `${who} is playing\u2026`;
            else msg = "";
            this.$("bw-status").textContent = msg;
            const drive = Tables.canDrive(g, me), wait2 = Math.ceil((this.NEXT_MS - (Date.now() - (g.turnAt || 0))) / 1000);
            const deal = this.$("bw-deal"); deal.hidden = !(g.phase === "done" && seated); deal.disabled = !drive && wait2 > 0;
            deal.textContent = drive || wait2 <= 0 ? "Deal next hand" : `Deal next hand (${wait2}s)`;
            this.$("bw-lobby-back").hidden = !(g.phase === "done" && g.owner === me);
            this.$("bw-leave").hidden = !seated; this.$("bw-leave").disabled = live && inOrder;
            const acting = live && inOrder && !folded; this.$("bw-turn-actions").hidden = !acting;
            const can1 = this.canSwap1(g, me);
            this.$("bw-pass").disabled = !myTurn;
            this.$("bw-swapall").disabled = !this.canSwapAll(g, me); this.$("bw-swapall").hidden = !acting;
            const s1 = this.$("bw-swap1"); s1.disabled = !(can1 && this.sel.h !== null && this.sel.w !== null); s1.hidden = !acting;
            this.$("bw-fold").disabled = !myTurn; this.$("bw-fold").hidden = !acting;
            const cl = this.$("bw-close"); cl.disabled = !(myTurn && g.phase === "play"); cl.hidden = !acting || final;
            const wait = live && inOrder && !myTurn ? Math.ceil((this.IDLE_MS - (Date.now() - (g.turnAt || 0))) / 1000) : 0;
            const kick = this.$("bw-kick"); kick.hidden = !(live && inOrder && !myTurn);
            kick.disabled = wait > 0; kick.textContent = wait > 0 ? `Skip idle player (${wait}s)` : "Skip idle player";
        },
        renderStats() {
            const el = this.$("bw-stats"), rows = Object.keys(this.stats || {}).map((u) => ({ u, s: this.stats[u] })).sort((a, b) => (b.s.wins || 0) - (a.s.wins || 0) || (b.s.net || 0) - (a.s.net || 0));
            el.textContent = ""; el.hidden = !rows.length; if (!rows.length) return;
            const h = document.createElement("h3"); h.textContent = "Table stats"; el.appendChild(h);
            const t = document.createElement("table"), hd = t.createTHead().insertRow();
            ["Player", "Hands", "Wins", "Net chips", "Best hand"].forEach((x) => { const c = document.createElement("th"); c.textContent = x; hd.appendChild(c); });
            const tb = t.createTBody();
            rows.forEach(({ u, s }) => {
                const r = tb.insertRow(), net = s.net || 0;
                [u + (u === State.username ? " (you)" : ""), s.hands || 0, s.wins || 0, (net > 0 ? "+" : "") + net, this.CATS[s.best || 0]].forEach((x, i) => { const c = r.insertCell(); c.textContent = x; if (i === 3) c.className = net > 0 ? "pos" : net < 0 ? "neg" : ""; });
            });
            el.appendChild(t);
        },
        /* --- winner announcement overlay --- */
        openResult() {
            const g = this.g; if (!g.res || g.phase !== "done") return;
            const r = g.res, body = this.$("bw-result-body"), me = State.username, fold = g.folded || {};
            this.$("bw-result-title").textContent = r.winners.length > 1 ? "Split pot" : `${this.nm(r.winners[0])} wins`;
            this.$("bw-result-sub").textContent = `${r.best} \u00B7 pot ${r.pot} chips` + (g.closer ? ` \u00B7 closed by ${g.closer}` : "");
            body.textContent = "";
            const rows = (g.order || []).slice(); if (g.house) rows.push(HOUSE);
            rows.forEach((u) => {
                const won = r.winners.includes(u), folded = !!fold[u], row = document.createElement("div"); row.className = "bw-res-row" + (won ? " win" : "") + (folded ? " folded" : "");
                const nm = document.createElement("div"); nm.className = "bw-res-name"; nm.textContent = this.nm(u) + (u === me ? " (you)" : "");
                const cs = document.createElement("div"); cs.className = "bw-res-cards";
                if (!folded && !r.byFold) (g.hands[u] || []).forEach((c) => { const m = document.createElement("span"), s = (c / 13) | 0; m.className = "bw-mini" + (s === 1 || s === 2 ? " red" : ""); m.textContent = this.describe(c); cs.appendChild(m); });
                const ct = document.createElement("div"); ct.className = "bw-res-cat"; ct.textContent = (folded ? "Folded" : r.byFold ? (won ? "Last player standing" : "") : r.cats[u]) + (won ? ` \u00B7 +${r.shares[u]}` : "");
                row.append(nm, cs, ct); body.appendChild(row);
            });
            const seated = Tables.names(g.seats).includes(me); this.$("bw-result-deal").hidden = !(seated && Tables.canDrive(g, me)); this.$("bw-result").hidden = false; this.$("bw-result-close").focus({ preventScroll: true });
        },
        closeResult() { const m = this.$("bw-result"); if (m && !m.hidden) m.hidden = true; }
    };
    BW.init();
    { const s0 = Social.start, s1 = Social.stop; Social.start = function () { s0.call(Social); Blackjack.start(); BW.start(); }; Social.stop = function () { s1.call(Social); Blackjack.stop(); BW.stop(); }; }

    /* =========================================================================
       UNO (Casual & Party Games) — real-time multiplayer at rooms/<code>/uno
       Flow: lobby (host picks optional stake, starts) -> 7 cards each -> clockwise/counter-clockwise turns
             -> first empty hand wins the pot. Stake is charged to every seated player when the game starts.
       Rules: match colour/number, Skip, Reverse (acts as Skip with 2 players), Draw Two, Wild, Wild Draw Four
              (only when you hold no card of the current colour). Draw penalties STACK: Draw Two on Draw Two
              (or a Draw Four on it); Draw Four only on Draw Four. Draw one card: play it or keep it.
       ========================================================================= */
    const UNO = (() => {
        const CARDS = []; // id -> [colour 0-3 (4 = wild), value 0-9, 10 Skip, 11 Reverse, 12 Draw Two, 13 Wild, 14 Wild Draw Four]
        for (let c = 0; c < 4; c++) { CARDS.push([c, 0]); for (let v = 1; v < 13; v++) CARDS.push([c, v], [c, v]); }
        for (let i = 0; i < 4; i++) CARDS.push([4, 13]); for (let i = 0; i < 4; i++) CARDS.push([4, 14]);
        const CN = ["Red", "Yellow", "Green", "Blue", "Wild"], HEX = ["#d6372f", "#e8a900", "#1f9d57", "#2468c8"];
        const SYM = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "\u2298", "\u21C4", "+2", "\u2605", "+4"];
        const VN = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "Skip", "Reverse", "Draw Two", "Wild", "Wild Draw Four"];
        const $ = (id) => document.getElementById(id), mk = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };
        const sh = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[a[i], a[j]] = [a[j], a[i]]; } return a; };
        const nm = (id) => (CARDS[id][0] === 4 ? VN[CARDS[id][1]] : CN[CARDS[id][0]] + " " + VN[CARDS[id][1]]);
        const face = (id) => { const [c, v] = CARDS[id], d = mk("div", "uc c" + c), s = SYM[v]; d.append(mk("i", "a", s), mk("b", "", s), mk("i", "z", s)); d.setAttribute("aria-label", nm(id)); return d; };
        const back = () => mk("div", "uc bk");
        const ctr = (r, w) => ({ left: r.left + r.width / 2 - w / 2, top: r.top + r.height / 2 - w * 0.75, width: w, height: w * 1.5 });

        /* ---- rules engine: every function mutates the Firebase transaction value `g` ---- */
        const E = {
            fix(g) { g.deck = g.deck || []; g.disc = g.disc || []; g.idle = g.idle || {}; },
            adv(g, k) { const n = g.order.length; g.turn = (((g.turn + g.dir * k) % n) + n) % n; g.turnAt = Date.now(); g.drew = -1; },
            ok(g, id, h) {
                const [c, v] = CARDS[id], t = CARDS[g.disc[g.disc.length - 1]];
                if (g.pend) return g.pt === 12 ? v === 12 || v === 14 : v === 14;      // stacking: only a matching penalty card may answer
                if (v === 13) return true;
                if (v === 14) return h.every((x) => CARDS[x][0] !== g.col);              // Wild Draw Four only without the current colour
                return c === g.col || v === t[1];
            },
            take(g, u, n) {
                const h = g.hands[u]; let k = 0;
                for (; k < n; k++) { if (!g.deck.length) { if (g.disc.length < 2) break; const t = g.disc.pop(); g.deck = sh(g.disc); g.disc = [t]; } h.push(g.deck.pop()); }
                return k;
            },
            win(g, u, left) { g.phase = "done"; g.turnAt = Date.now(); g.res = { w: u, pot: g.pot || 0, left: left ? 1 : 0 }; return "win"; },
            play(g, u, id, col) {
                const h = g.hands[u], i = h.indexOf(id); if (i < 0 || (g.drew >= 0 && g.drew !== id) || !E.ok(g, id, h)) return false;
                const [c, v] = CARDS[id]; if (c === 4 && !(col >= 0 && col < 4)) return false;
                h.splice(i, 1); g.disc.push(id); g.col = c < 4 ? c : col;
                if (!h.length) return E.win(g, u);
                let k = 1;
                if (v === 10) k = 2;                                                     // Skip
                else if (v === 11) { g.dir *= -1; if (g.order.length === 2) k = 2; }     // Reverse (Skip with two players)
                else if (v === 12 || v === 14) { g.pend = (g.pend || 0) + (v === 12 ? 2 : 4); g.pt = v; }
                E.adv(g, k); return true;
            },
            draw(g, u) {
                if (g.pend) { const n = E.take(g, u, g.pend); g.pend = 0; g.pt = 0; E.adv(g, 1); return n; }  // eat the stacked penalty, lose the turn
                if (g.drew >= 0) return -1;
                const h = g.hands[u], n = E.take(g, u, 1);
                if (n && E.ok(g, h[h.length - 1], h)) g.drew = h[h.length - 1]; else E.adv(g, 1);
                return n;
            },
            leave(g, u) {
                const i = g.order.indexOf(u); if (i < 0) return false;
                g.deck.unshift(...(g.hands[u] || [])); delete g.hands[u]; g.order.splice(i, 1);
                if (g.order.length < 2) return E.win(g, g.order[0], 1);
                if (i < g.turn) g.turn--;
                else if (i === g.turn) { g.turn = g.dir > 0 ? g.turn % g.order.length : (g.turn - 1 + g.order.length) % g.order.length; g.drew = -1; g.turnAt = Date.now(); }
                return true;
            },
            deal(v) {
                const names = Tables.names(v.seats), rot = (v.rot || 0) + 1, order = names.map((_, i) => names[(i + rot) % names.length]), bet = v.bet || 0;
                const deck = sh(Array.from({ length: 108 }, (_, i) => i)), hands = {};
                order.forEach((u) => { hands[u] = deck.splice(-7); });
                let k = deck.length - 1; while (CARDS[deck[k]][1] > 12) k--;              // the starting card is never a Wild
                const first = deck.splice(k, 1)[0], fv = CARDS[first][1];
                const g = { seats: v.seats, owner: v.owner, max: v.max, rot, bet, phase: "play", hid: Date.now(), order, hands, deck, disc: [first], col: CARDS[first][0], turn: 0, dir: 1, pend: 0, pt: 0, drew: -1, in: {}, pot: bet * order.length, turnAt: Date.now(), last: "Match the top card by colour or number", fx: null, res: null };
                order.forEach((u) => { g.in[u] = bet; });
                if (fv >= 10) { if (fv === 11) g.dir = -1; if (fv === 12) E.take(g, order[0], 2); E.adv(g, 1); g.last = "Starting card: " + nm(first) + (fv === 11 ? " \u2014 play runs counter-clockwise" : fv === 12 ? ` \u2014 ${order[0]} draws 2 and is skipped` : ` \u2014 ${order[0]} is skipped`); }
                return g;
            }
        };

        const U = {
            MAX: 6, IDLE: 45000, STAKES: [0, 10, 25, 50, 100, 250],
            ref: null, cb: null, tick: null, pres: { armed: null }, ann: {}, g: { phase: "lobby" }, hid: null, paid: 0, dealt: null, lastFx: null, wild: null, rect: null, prev: new Set(),
            store(k, v) { try { if (v === undefined) return window.sessionStorage.getItem(k); window.sessionStorage.setItem(k, v); } catch (e) { /* storage unavailable */ } return null; },
            init() {
                const on = (id, fn) => $(id).addEventListener("click", fn);
                on("uno-pass", () => this.act("pass")); on("uno-kick", () => this.kick()); on("uno-leave", () => this.leave()); on("uno-again", () => this.again());
                on("uno-wild-x", () => { this.wild = null; $("uno-pick").hidden = true; });
                on("uno-deck", () => this.act("draw"));
                $("uno-deck").addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); this.act("draw"); } });
                $("uno-pick").querySelectorAll("[data-c]").forEach((b) => b.addEventListener("click", () => { const w = this.wild; this.wild = null; $("uno-pick").hidden = true; if (w != null) this.act("play", { id: w, col: +b.dataset.c }); }));
            },
            start() {
                this.stop(); if (!Room.db || !Room.code) return;
                this.ref = Room.db.ref(`rooms/${Room.code}/uno`);
                this.cb = (s) => {
                    const n = s.val() || { phase: "lobby" }; if (n.hid !== this.g.hid) this.wild = null; this.g = n;
                    Tables.announce(this.ann, n, "UNO"); Tables.badge("uno", n, this.MAX); Tables.presence(this.pres, this.ref, n, State.username);
                    this.sync(); this.render();
                };
                this.ref.on("value", this.cb);
                this.tick = window.setInterval(() => { if (this.g.phase === "play") this.controls(); }, 1000);
                this.render();
            },
            stop() {
                if (this.ref && this.cb) this.ref.off("value", this.cb);
                if (this.tick) window.clearInterval(this.tick);
                this.ref = this.cb = this.tick = null; this.g = { phase: "lobby" }; this.hid = this.dealt = this.lastFx = null; this.wild = null; this.pres = { armed: null }; this.ann = {}; this.prev = new Set();
                Tables.badge("uno", {}, this.MAX);
            },
            /* --- table, seats and optional stake --- */
            canSit() { const b = this.g.bet || 0; if (State.balance < b) { Notify.error(`You need ${b} chips to join this table's stake.`); return false; } return true; },
            openTable() { if (this.ref) Tables.open(this.ref, State.username, this.MAX); },
            take(k) { if (this.ref && this.canSit()) Tables.take(this.ref, State.username, k, ["lobby", "done"]); },
            closeTable() { if (this.ref) Tables.close(this.ref, State.username, State.isHost, ["lobby", "done"]).then((r) => { if (!r.committed) Notify.warning("Finish the match before closing the table."); }); },
            setBet(n) { if (n && !BetLimits.ok(Router.currentGameKey, n)) return; const me = State.username; if (this.ref) this.ref.transaction((v) => { if (!Tables.isOpen(v) || v.phase !== "lobby" || !Tables.canDrive(v, me)) return; v.bet = n; return v; }); },
            leave() {
                const me = State.username, g = this.g; if (!this.ref || !me) return;
                if (g.phase !== "play" || !(g.order || []).includes(me)) return Tables.leave(this.ref, me);
                if (!window.confirm("Leave the match? You forfeit your stake.")) return;
                this.ref.transaction((v) => {
                    if (!v || v.phase !== "play" || !v.order.includes(me)) return; E.fix(v); E.leave(v, me);
                    const k = Tables.seatOf(v.seats, me); if (k) delete v.seats[k];
                    if (v.owner === me) v.owner = Tables.names(v.seats)[0] || "";
                    v.fx = null; v.last = `${me} left the match`; return v;
                });
            },
            again() {
                const me = State.username; if (!this.ref) return;
                this.ref.transaction((v) => { if (!Tables.isOpen(v) || v.phase !== "done" || !Tables.canDrive(v, me)) return; return { phase: "lobby", owner: v.owner, seats: v.seats, max: v.max, rot: v.rot || 0, bet: v.bet || 0, hid: Date.now(), turnAt: Date.now() }; });
            },
            deal() {
                const me = State.username, g = this.g, bet = g.bet || 0; if (!this.ref) return; if (bet && !BetLimits.ok(Router.currentGameKey, bet)) return;
                const poor = Tables.names(g.seats).filter((u) => (u === me ? State.balance : ((Room.get(u) || {}).balance || 0)) < bet);
                if (poor.length) return Notify.error(`${poor.join(", ")} can't cover the ${bet}-chip stake.`);
                this.ref.transaction((v) => {
                    if (!Tables.isOpen(v) || v.phase !== "lobby" || !Tables.canDrive(v, me)) return;
                    const n = Tables.names(v.seats); if (n.length < 2 || !n.includes(me)) return;
                    return E.deal(v);
                });
            },
            /* --- turn actions: play (card + wild colour) / draw / pass (keep the drawn card) / auto (idle player) --- */
            act(type, p, who) {
                const me = State.username, u = who || me, g0 = this.g; if (!this.ref || !me || g0.phase !== "play" || (g0.order || [])[g0.turn] !== u) return;
                this.ref.transaction((v) => {
                    if (!v || v.phase !== "play" || v.order[v.turn] !== u) return; E.fix(v);
                    if (who && Date.now() - (v.turnAt || 0) < this.IDLE) return;
                    const id = Date.now() + "-" + Math.floor(Math.random() * 1e6); let note, r;
                    if (type === "play") {
                        if (!p || (r = E.play(v, u, p.id, p.col)) === false) return;
                        v.fx = { id, t: "p", u, c: p.id, at: Date.now() }; const x = CARDS[p.id][1];
                        note = `${u} played ${nm(p.id)}` + (CARDS[p.id][0] === 4 ? ` \u2014 colour is now ${CN[p.col]}` : "") + (r === "win" ? "" : v.pend ? ` \u2014 ${v.order[v.turn]} must stack or draw ${v.pend}` : x === 10 ? " \u2014 next player skipped" : x === 11 ? " \u2014 direction reversed" : "");
                    } else if (type === "draw") {
                        if ((r = E.draw(v, u)) < 0) return; v.fx = { id, t: "d", u, n: r, at: Date.now() }; note = `${u} drew ${r} card${r === 1 ? "" : "s"}`;
                    } else if (type === "pass") { if (v.drew < 0) return; E.adv(v, 1); note = `${u} kept the drawn card`; }
                    else if (type === "auto") {
                        v.idle[u] = (v.idle[u] || 0) + 1;
                        if (v.idle[u] >= 3) { r = E.leave(v, u); const k = Tables.seatOf(v.seats, u); if (k) delete v.seats[k]; if (v.owner === u) v.owner = Tables.names(v.seats)[0] || ""; v.fx = null; note = `${u} was removed for inactivity`; }
                        else { r = E.draw(v, u); if (v.drew >= 0) E.adv(v, 1); v.fx = { id, t: "d", u, n: Math.max(r, 0), at: Date.now() }; note = `${u} timed out`; }
                    } else return;
                    if (!who) v.idle[u] = 0; v.last = note; return v;
                }).catch(() => { });
            },
            kick() {
                const g = this.g, u = g.order && g.order[g.turn]; if (g.phase !== "play" || !u || u === State.username) return;
                if (Date.now() - (g.turnAt || 0) < this.IDLE) return Notify.warning("Give them a little longer.");
                this.act("auto", null, u);
            },
            pick(id, el) { this.rect = el.getBoundingClientRect(); if (CARDS[id][0] === 4) { this.wild = id; $("uno-pick").hidden = false; return; } this.act("play", { id }); },
            /* --- chips: stake charged once per match from shared state (persisted per match so a reload never double-charges); winner is paid the pot --- */
            sync() {
                const g = this.g, me = State.username; if (!me || !g.hid || !g.in) return;
                const pk = `uno-paid-${Room.code}-${g.hid}-${me}`;
                if (this.hid !== g.hid) { this.hid = g.hid; this.paid = Number(this.store(pk)) || 0; }
                const owed = (g.in[me] || 0) - this.paid;
                if (owed > 0) { State.debit(Math.min(owed, State.balance)); this.paid += owed; this.store(pk, String(this.paid)); }
                if (g.phase !== "done" || !g.res) return;
                const dk = `uno-done-${Room.code}-${g.hid}-${me}`; if (this.store(dk)) return; this.store(dk, "1");
                const won = g.res.w === me;
                if (this.paid > 0) resolveGameOutcome("uno", { roundId: g.hid + "-" + me, entries: [{ wager: this.paid, payout: won ? g.res.pot : 0 }] });
                if (won) { Effects.celebrate(`UNO! You win${g.res.pot ? " " + g.res.pot + " chips" : ""}!`); BW.sparkle(); Notify.success(g.res.pot ? `You won ${g.res.pot} chips!` : "You won the match!"); }
            },
            /* --- rendering --- */
            render() {
                if (CardFX.deferRender(this)) return;
                const g = this.g, live = g.phase === "play" || (g.phase === "done" && !!g.res), lobby = !Tables.isOpen(g) || !live;
                $("uno-lobby").hidden = !lobby; $("uno-live").hidden = lobby;
                if (lobby) {
                    Tables.renderLobby($("uno-lobby"), g, {
                        title: "UNO table", game: "UNO", max: this.MAX, minStart: 2, soloNote: "UNO needs at least 2 players. Wait for someone to take a seat.",
                        onOpen: () => this.openTable(), onTake: (k) => this.take(k), onLeave: () => this.leave(), onStart: () => this.deal(), onClose: () => this.closeTable(), onClaim: () => Tables.claim(this.ref, State.username)
                    });
                    this.betUi(); this.dealt = g.hid; return;
                }
                const fresh = this.dealt !== g.hid; this.table(fresh);
                CardFX.flush($("uno-deck"), 95); this.controls(); this.dealt = g.hid; this.playFx();
            },
            betUi() {
                const g = this.g; if (!Tables.isOpen(g)) return;
                const can = g.phase === "lobby" && Tables.canDrive(g, State.username), box = mk("div", "uno-bet"), row = mk("div", "tl-actions");
                box.appendChild(mk("p", "tl-msg", g.bet ? `Table stake: ${g.bet} chips each \u2014 the winner takes the pot. Charged when the game starts.` : "No stake set \u2014 friendly match. The host can pick an optional chip stake below."));
                this.STAKES.forEach((n) => { const b = mk("button", "btn " + ((g.bet || 0) === n ? "btn-primary" : "btn-secondary"), n ? String(n) : "No bet"); b.type = "button"; b.disabled = !can || n > BetLimits.max(Router.currentGameKey); b.addEventListener("click", () => this.setBet(n)); row.appendChild(b); });
                box.appendChild(row); $("uno-lobby").appendChild(box);
            },
            table(fresh) {
                const g = this.g, me = State.username, order = g.order || [], inGame = order.includes(me), live = g.phase === "play", who = live ? order[g.turn] : null, myTurn = live && inGame && who === me;
                const fx = g.fx && g.fx.id !== this.lastFx && Date.now() - g.fx.at < 4000 ? g.fx : null;
                const opps = $("uno-opps"); opps.textContent = "";
                order.filter((u) => u !== me).forEach((u) => {
                    const h = g.hands[u] || [], d = mk("div", "bw-seat uno-opp" + (u === who ? " turn" : "") + (g.res && g.res.w === u ? " win" : "")), fan = mk("div", "uno-fan");
                    d.dataset.u = u; d.appendChild(mk("div", "bw-name", (u === who ? "\u25B6 " : "") + u + " \u00B7 " + h.length + (h.length === 1 ? " card" : " cards")));
                    h.slice(0, 9).forEach(() => fan.appendChild(back())); d.appendChild(fan); opps.appendChild(d);
                });
                const dl = g.disc || [], disc = $("uno-disc"); disc.textContent = "";
                dl.slice(-4).forEach((id) => { const c = face(id); c.style.transform = `rotate(${((id * 37) % 25) - 12}deg)`; disc.appendChild(c); });
                disc.style.setProperty("--cc", HEX[g.col] || "transparent"); disc.setAttribute("aria-label", `Discard pile: ${nm(dl[dl.length - 1])}, current colour ${CN[g.col]}`);
                const dk = $("uno-deck"); dk.textContent = ""; for (let i = 0; i < 3; i++) { const c = back(); c.style.transform = `translate(${i * 2}px,${-i * 2}px)`; dk.appendChild(c); }
                dk.classList.toggle("can", myTurn && (!!g.pend || g.drew < 0));
                const hand = $("uno-hand"), mine = (g.hands[me] || []).slice().sort((a, b) => CARDS[a][0] - CARDS[b][0] || CARDS[a][1] - CARDS[b][1] || a - b);
                hand.textContent = ""; hand.hidden = !inGame; if (!inGame || !mine.length) this.wild = null;
                mine.forEach((id, i) => {
                    const c = face(id), can = myTurn && (g.drew < 0 || g.drew === id) && E.ok(g, id, g.hands[me]);
                    if (myTurn) c.classList.add(can ? "ok" : "no");
                    if (can) { c.tabIndex = 0; c.setAttribute("role", "button"); c.addEventListener("click", () => this.pick(id, c)); c.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); this.pick(id, c); } }); }
                    if (fresh) CardFX.add(c, { round: i, ord: 0 }); else if (fx && fx.t === "d" && fx.u === me && !this.prev.has(id)) CardFX.add(c, { round: i, ord: 0 });
                    hand.appendChild(c);
                });
                this.prev = new Set(mine); $("uno-pick").hidden = this.wild == null;
            },
            controls() {
                const g = this.g, me = State.username, order = g.order || [], inGame = order.includes(me), live = g.phase === "play", who = live ? order[g.turn] : null, my = live && inGame && who === me, seated = Tables.names(g.seats).includes(me);
                $("uno-pot").textContent = g.bet ? `Pot ${(g.pot || 0).toLocaleString("en-US")} \u00B7 stake ${g.bet}` : "Friendly match";
                $("uno-dir").classList.toggle("rev", g.dir < 0); $("uno-dir").title = g.dir < 0 ? "Counter-clockwise" : "Clockwise";
                let m = "";
                if (g.phase === "done" && g.res) m = g.res.left ? `${g.res.w} wins by default${g.res.pot ? " \u2014 " + g.res.pot + " chips" : ""}.` : `${g.res.w} played the last card and wins${g.res.pot ? " " + g.res.pot + " chips" : ""}!`;
                else if (my) m = g.pend ? `Stack a ${g.pt === 12 ? "Draw Two (or a Draw Four)" : "Draw Four"}, or tap the pile to draw ${g.pend}.` : g.drew >= 0 ? "Play the card you drew, or keep it." : "Play a highlighted card or tap the draw pile.";
                else if (live) m = `${who}'s turn\u2026`;
                $("uno-status").textContent = m; $("uno-log").textContent = g.last || "";
                $("uno-pass").hidden = !(my && g.drew >= 0);
                const wait = live && inGame && !my ? Math.ceil((this.IDLE - (Date.now() - (g.turnAt || 0))) / 1000) : 0, k = $("uno-kick");
                k.hidden = !(live && inGame && !my && seated); k.disabled = wait > 0; k.textContent = wait > 0 ? `Skip idle player (${wait}s)` : "Skip idle player";
                $("uno-leave").hidden = !(seated && (!live || inGame)); $("uno-leave").textContent = live ? "Forfeit match" : "Leave table";
                $("uno-again").hidden = !(g.phase === "done" && seated && Tables.canDrive(g, me));
            },
            /* --- animations: cards glide along an arc between the piles, hands and seats (deal/draw reuse CardFX) --- */
            fly(el, from, to, delay, dur) {
                const dx = to.left + to.width / 2 - (from.left + from.width / 2), dy = to.top + to.height / 2 - (from.top + from.height / 2), tilt = Math.random() * 20 - 10;
                el.style.setProperty("--uw", from.width + "px");
                Object.assign(el.style, { position: "fixed", left: from.left + "px", top: from.top + "px", margin: "0", zIndex: "400", pointerEvents: "none", willChange: "transform" }); document.body.appendChild(el);
                const a = el.animate([
                    { transform: "translate(0,0) scale(1) rotate(0deg)", offset: 0 },
                    { transform: `translate(${dx * 0.5}px,${dy * 0.5 - 34}px) scale(1.2) rotate(${tilt}deg)`, offset: 0.5 },
                    { transform: `translate(${dx}px,${dy}px) scale(${to.width / from.width}) rotate(${tilt / 2}deg)`, offset: 1 }
                ], { duration: dur, delay, easing: "cubic-bezier(.3,.1,.2,1)", fill: "both" });
                return new Promise((res) => { const d = () => { el.remove(); res(); }; a.onfinish = d; a.oncancel = d; window.setTimeout(d, dur + delay + 500); });
            },
            playFx() {
                const g = this.g, fx = g.fx; if (!fx || fx.id === this.lastFx) return;
                const late = this.lastFx === null; this.lastFx = fx.id;
                if ((late && Date.now() - fx.at > 4000) || CardFX.reduced() || Router.currentGameKey !== "uno") return;
                const me = State.username, dk = $("uno-deck").getBoundingClientRect(), dc = $("uno-disc").getBoundingClientRect();
                const seat = Array.from($("uno-opps").children).find((e) => e.dataset.u === fx.u), sr = seat ? seat.getBoundingClientRect() : null;
                Sound.tone(fx.t === "p" ? 440 : 330, 60, "triangle", 0.04);
                if (fx.t === "p") {
                    const from = fx.u === me ? this.rect : sr && ctr(sr, 44); if (!from) return;
                    const top = $("uno-disc").lastElementChild; if (top) top.style.visibility = "hidden";
                    this.fly(face(fx.c), from, dc, 0, 560).then(() => { if (top) top.style.visibility = ""; });
                } else if (fx.u !== me && sr) for (let i = 0; i < Math.min(fx.n || 0, 6); i++) this.fly(back(), dk, ctr(sr, 30), i * 120, 480);
            }
        };
        return U;
    })();
    UNO.init();
    { const s0 = Social.start, s1 = Social.stop; Social.start = function () { s0.call(Social); UNO.start(); }; Social.stop = function () { s1.call(Social); UNO.stop(); }; }

    /* =========================================================================
       PARQUÉS & DOMINOES (Casual & Party Games) — real-time multiplayer at rooms/<code>/parques and rooms/<code>/dominoes
       Both reuse the UNO table flow: shared lobby (host picks an optional stake, starts) -> match -> winner takes the pot.
       The rules engines mutate the Firebase transaction value `g`; clients only render shared state and animate `fx` records.
       Stake is charged to every seated player when the match starts (persisted per match, so a reload never double-charges).
       ========================================================================= */
    const pt$ = (s) => document.getElementById(s), ptMk = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };
    const PT_PIPS = [[], [4], [0, 8], [0, 4, 8], [0, 2, 6, 8], [0, 2, 4, 6, 8], [0, 2, 3, 5, 6, 8]];

    /** Shared table plumbing: lobby, seats, optional stake, turn actions, idle skip, forfeit, chip settlement. */
    const Party = (o) => {
        const el = (s) => pt$(o.p + "-" + s);
        return {
            MAX: o.max, IDLE: 45000, STAKES: [0, 10, 25, 50, 100, 250], E: o.E,
            ref: null, cb: null, tick: null, pres: { armed: null }, ann: {}, g: { phase: "lobby" }, hid: null, paid: 0, dealt: null, lastFx: null,
            store(k, v) { try { if (v === undefined) return window.sessionStorage.getItem(k); window.sessionStorage.setItem(k, v); } catch (e) { /* storage unavailable */ } return null; },
            init() { el("kick").addEventListener("click", () => this.kick()); el("leave").addEventListener("click", () => this.leave()); el("again").addEventListener("click", () => this.again()); this.setup(); },
            start() {
                this.stop(); if (!Room.db || !Room.code) return;
                this.ref = Room.db.ref(`rooms/${Room.code}/${o.node}`);
                this.cb = (s) => {
                    const n = s.val() || { phase: "lobby" }; if (n.hid !== this.g.hid) this.onNew(); this.g = n;
                    Tables.announce(this.ann, n, o.label); Tables.badge(o.key, n, this.MAX); Tables.presence(this.pres, this.ref, n, State.username);
                    this.sync(); this.render();
                };
                this.ref.on("value", this.cb);
                this.tick = window.setInterval(() => { if (this.g.phase === "play") this.controls(); }, 1000);
                this.render();
            },
            stop() {
                if (this.ref && this.cb) this.ref.off("value", this.cb);
                if (this.tick) window.clearInterval(this.tick);
                this.ref = this.cb = this.tick = null; this.g = { phase: "lobby" }; this.hid = this.dealt = this.lastFx = null; this.pres = { armed: null }; this.ann = {};
                this.onNew(); Tables.badge(o.key, {}, this.MAX);
            },
            /* --- table, seats and optional stake --- */
            canSit() { const b = this.g.bet || 0; if (State.balance < b) { Notify.error(`You need ${b} chips to join this table's stake.`); return false; } return true; },
            openTable() { if (this.ref) Tables.open(this.ref, State.username, this.MAX); },
            take(k) { if (this.ref && this.canSit()) Tables.take(this.ref, State.username, k, ["lobby", "done"]); },
            closeTable() { if (this.ref) Tables.close(this.ref, State.username, State.isHost, ["lobby", "done"]).then((r) => { if (!r.committed) Notify.warning("Finish the match before closing the table."); }); },
            setBet(n) { if (n && !BetLimits.ok(Router.currentGameKey, n)) return; const me = State.username; if (this.ref) this.ref.transaction((v) => { if (!Tables.isOpen(v) || v.phase !== "lobby" || !Tables.canDrive(v, me)) return; v.bet = n; return v; }); },
            leave() {
                const me = State.username, g = this.g; if (!this.ref || !me) return;
                if (g.phase !== "play" || !(g.order || []).includes(me)) return Tables.leave(this.ref, me);
                if (!window.confirm("Leave the match? You forfeit your stake.")) return;
                this.ref.transaction((v) => {
                    if (!v || v.phase !== "play" || !v.order.includes(me)) return;
                    o.E.leave(v, me);
                    const k = Tables.seatOf(v.seats, me); if (k) delete v.seats[k];
                    if (v.owner === me) v.owner = Tables.names(v.seats)[0] || "";
                    v.fx = null; v.last = `${me} left the match`; return v;
                });
            },
            again() {
                const me = State.username; if (!this.ref) return;
                this.ref.transaction((v) => { if (!Tables.isOpen(v) || v.phase !== "done" || !Tables.canDrive(v, me)) return; return { phase: "lobby", owner: v.owner, seats: v.seats, max: v.max, rot: v.rot || 0, bet: v.bet || 0, hid: Date.now(), turnAt: Date.now() }; });
            },
            deal() {
                const me = State.username, g = this.g, bet = g.bet || 0; if (!this.ref) return; if (bet && !BetLimits.ok(Router.currentGameKey, bet)) return;
                const poor = Tables.names(g.seats).filter((u) => (u === me ? State.balance : ((Room.get(u) || {}).balance || 0)) < bet);
                if (poor.length) return Notify.error(`${poor.join(", ")} can't cover the ${bet}-chip stake.`);
                this.ref.transaction((v) => {
                    if (!Tables.isOpen(v) || v.phase !== "lobby" || !Tables.canDrive(v, me)) return;
                    const n = Tables.names(v.seats); if (n.length < 2 || !n.includes(me)) return;
                    return o.E.deal(v);
                });
            },
            /* --- turn actions: the engine validates and applies them inside the transaction; `auto` plays for an idle player --- */
            act(type, p, who) {
                const me = State.username, u = who || me, g0 = this.g; if (!this.ref || !me || g0.phase !== "play" || (g0.order || [])[g0.turn] !== u) return;
                this.ref.transaction((v) => {
                    if (!v || v.phase !== "play" || v.order[v.turn] !== u) return; v.idle = v.idle || {};
                    if (who && Date.now() - (v.turnAt || 0) < this.IDLE) return;
                    const id = Date.now() + "-" + Math.floor(Math.random() * 1e6); let note;
                    if (type === "auto") {
                        v.idle[u] = (v.idle[u] || 0) + 1;
                        if (v.idle[u] >= 3) { o.E.leave(v, u); const k = Tables.seatOf(v.seats, u); if (k) delete v.seats[k]; if (v.owner === u) v.owner = Tables.names(v.seats)[0] || ""; v.fx = null; note = `${u} was removed for inactivity`; }
                        else note = o.E.auto(v, u, id) || `${u} timed out`;
                    } else { note = o.E.act(v, u, type, p, id); if (!note) return; }
                    if (!who) v.idle[u] = 0; v.last = note; return v;
                }).catch(() => { });
            },
            kick() {
                const g = this.g, u = g.order && g.order[g.turn]; if (g.phase !== "play" || !u || u === State.username) return;
                if (Date.now() - (g.turnAt || 0) < this.IDLE) return Notify.warning("Give them a little longer.");
                this.act("auto", null, u);
            },
            /* --- chips: stake charged once per match from shared state; the winner(s) split the pot --- */
            sync() {
                const g = this.g, me = State.username; if (!me || !g.hid || !g.in) return;
                const pk = `${o.key}-paid-${Room.code}-${g.hid}-${me}`;
                if (this.hid !== g.hid) { this.hid = g.hid; this.paid = Number(this.store(pk)) || 0; }
                const owed = (g.in[me] || 0) - this.paid;
                if (owed > 0) { State.debit(Math.min(owed, State.balance)); this.paid += owed; this.store(pk, String(this.paid)); }
                if (g.phase !== "done" || !g.res) return;
                const dk = `${o.key}-done-${Room.code}-${g.hid}-${me}`; if (this.store(dk)) return; this.store(dk, "1");
                const ws = g.res.ws || [], won = ws.includes(me), pot = g.res.pot || 0, share = won ? Math.floor(pot / ws.length) + (ws[0] === me ? pot % ws.length : 0) : 0;
                if (this.paid > 0) resolveGameOutcome(o.key, { roundId: g.hid + "-" + me, entries: [{ wager: this.paid, payout: share }] });
                if (won) { Effects.celebrate(`${o.label}! You win${share ? " " + share + " chips" : ""}!`); BW.sparkle(); Notify.success(share ? `You won ${share} chips!` : "You won the match!"); }
            },
            /* --- rendering --- */
            render() {
                if (CardFX.deferRender(this)) return;
                const g = this.g, live = g.phase === "play" || (g.phase === "done" && !!g.res), lobby = !Tables.isOpen(g) || !live;
                el("lobby").hidden = !lobby; el("live").hidden = lobby;
                if (lobby) {
                    Tables.renderLobby(el("lobby"), g, {
                        title: o.label + " table", game: o.label, max: this.MAX, minStart: 2, soloNote: `${o.label} needs at least 2 players. Wait for someone to take a seat.`,
                        onOpen: () => this.openTable(), onTake: (k) => this.take(k), onLeave: () => this.leave(), onStart: () => this.deal(), onClose: () => this.closeTable(), onClaim: () => Tables.claim(this.ref, State.username)
                    });
                    this.betUi(); this.dealt = g.hid; return;
                }
                const fresh = this.dealt !== g.hid; this.view(fresh); this.controls(); this.dealt = g.hid; this.playFx();
            },
            betUi() {
                const g = this.g; if (!Tables.isOpen(g)) return;
                const can = g.phase === "lobby" && Tables.canDrive(g, State.username), box = ptMk("div", "uno-bet"), row = ptMk("div", "tl-actions");
                box.appendChild(ptMk("p", "tl-msg", g.bet ? `Table stake: ${g.bet} chips each \u2014 the winner takes the pot. Charged when the game starts.` : "No stake set \u2014 friendly match. The host can pick an optional chip stake below."));
                this.STAKES.forEach((n) => { const b = ptMk("button", "btn " + ((g.bet || 0) === n ? "btn-primary" : "btn-secondary"), n ? String(n) : "No bet"); b.type = "button"; b.disabled = !can || n > BetLimits.max(Router.currentGameKey); b.addEventListener("click", () => this.setBet(n)); row.appendChild(b); });
                box.appendChild(row); el("lobby").appendChild(box);
            },
            /** Shared bottom controls: pot label, idle-skip countdown, forfeit/leave and "back to lobby". */
            common(my) {
                const g = this.g, me = State.username, order = g.order || [], inGame = order.includes(me), live = g.phase === "play", seated = Tables.names(g.seats).includes(me);
                el("pot").textContent = g.bet ? `Pot ${(g.pot || 0).toLocaleString("en-US")} \u00B7 stake ${g.bet}` : "Friendly match";
                const wait = live && inGame && !my ? Math.ceil((this.IDLE - (Date.now() - (g.turnAt || 0))) / 1000) : 0, k = el("kick");
                k.hidden = !(live && inGame && !my && seated); k.disabled = wait > 0; k.textContent = wait > 0 ? `Skip idle player (${wait}s)` : "Skip idle player";
                el("leave").hidden = !(seated && (!live || inGame)); el("leave").textContent = live ? "Forfeit match" : "Leave table";
                el("again").hidden = !(g.phase === "done" && seated && Tables.canDrive(g, me));
            }
        };
    };

    /* =========================================================================
       PARQUÉS — 4 tokens each, 68-square ring (an 18x18 grid perimeter), 7-square home lane, centre target.
       Progress per token: -1 base | 0..67 ring (0 = own entry square) | 68..74 home lane | 75 centre (exact roll needed).
       Rules: a 6 brings a token out (capturing a lone rival on the entry square); 6 / capture / reaching the centre = roll again;
              three sixes in a row lose the turn; landing on a lone rival off a safe square (entries + corners) sends it to base;
              two tokens of one colour on a square form a blockade that rivals can neither land on nor pass.
       ========================================================================= */
    const PQ = (() => {
        const CN = ["Ruby", "Gold", "Sapphire", "Emerald"];
        const rotN = (x, y, n) => { for (let i = 0; i < n; i++) { const t = x; x = 17 - y; y = t; } return [x, y]; };
        const trk = (i) => { const s = Math.floor(i / 17), p = i % 17; return s === 0 ? [p, 0] : s === 1 ? [17, p] : s === 2 ? [17 - p, 17] : [0, 17 - p]; };
        const fin = (c, k) => { let dx = -0.6 + 0.4 * k, dy = -0.75; for (let i = 0; i < c; i++) { const t = dx; dx = -dy; dy = t; } return [8.5 + dx, 8.5 + dy]; };
        const cell = (c, p, k) => (p < 0 ? rotN(2 + (k % 2) * 2, 2 + (k >> 1) * 2, c) : p <= 67 ? trk((17 * c + 8 + p) % 68) : p <= 74 ? rotN(8, p - 67, c) : fin(c, k));
        const pc = (v) => ((v + 0.5) / 18 * 100).toFixed(3) + "%";
        const place = (e, x, y) => { e.style.left = pc(x); e.style.top = pc(y); };

        /*E-START*/
        const E = {
            idx(c, p) { return (17 * c + 8 + p) % 68; },
            safe(i) { return i % 17 === 8 || i % 17 === 0; },
            at(g, i) { const r = []; g.order.forEach((w) => g.tok[w].forEach((p, k) => { if (p >= 0 && p <= 67 && E.idx(g.col[w], p) === i) r.push({ u: w, k }); })); return r; },
            wall(g, u, i) { const m = {}; E.at(g, i).forEach((t) => { if (t.u !== u) m[t.u] = (m[t.u] || 0) + 1; }); return Object.keys(m).some((w) => m[w] >= 2); },
            moves(g, u, d) {
                const c = g.col[u], out = [];
                g.tok[u].forEach((p, k) => {
                    if (p === 75) return;
                    if (p < 0) { if (d === 6 && !E.wall(g, u, E.idx(c, 0))) out.push(k); return; }
                    const np = p + d; if (np > 75) return;
                    for (let q = p + 1; q <= Math.min(np, 67); q++) if (E.wall(g, u, E.idx(c, q))) return;
                    out.push(k);
                });
                return out;
            },
            adv(g) { g.turn = (g.turn + 1) % g.order.length; g.ph = "roll"; g.six = 0; g.turnAt = Date.now(); },
            win(g, u, left) { g.phase = "done"; g.turnAt = Date.now(); g.res = { ws: [u], pot: g.pot || 0, left: left ? 1 : 0 }; return "win"; },
            roll(g, u) {
                const d = 1 + Math.floor(Math.random() * 6); g.die = d; g.turnAt = Date.now();
                if (d === 6 && (g.six = (g.six || 0) + 1) >= 3) { E.adv(g); return "triple"; }
                const m = E.moves(g, u, d);
                if (!m.length) { if (d === 6) g.ph = "roll"; else E.adv(g); return "none"; }
                g.ph = "move"; return m.length === 1 ? "one" : "pick";
            },
            move(g, u, k) {
                const c = g.col[u], p = g.tok[u][k], d = g.die, np = p < 0 ? 0 : p + d, cap = [];
                g.tok[u][k] = np;
                if (np <= 67) { const i = E.idx(c, np); if (np === 0 || !E.safe(i)) E.at(g, i).forEach((t) => { if (t.u !== u) cap.push({ u: t.u, k: t.k, i }); }); }
                cap.forEach((x) => { g.tok[x.u][x.k] = -1; });
                const mv = { k, from: p, to: np, cap };
                if (g.tok[u].every((x) => x === 75)) { E.win(g, u); return mv; }
                if (d === 6 || cap.length || np === 75) { g.ph = "roll"; g.turnAt = Date.now(); } else E.adv(g);
                return mv;
            },
            say(g, mv) {
                let s = mv.from < 0 ? "brings a token out of base" : `moves token ${mv.k + 1}`;
                if (mv.cap.length) s += ` and captures ${mv.cap.map((x) => x.u).join(", ")}`;
                if (mv.to === 75) s += " into the centre";
                if (g.phase === "done") s += " \u2014 all four tokens are home!";
                return s;
            },
            act(g, u, type, p, id) {
                let mv = null, d = null, t;
                if (type === "roll") {
                    if (g.ph !== "roll") return null;
                    const r = E.roll(g, u); d = g.die; t = `${u} rolled a ${d}`;
                    if (r === "triple") t += " \u2014 three sixes in a row, the turn is lost";
                    else if (r === "none") t += " \u2014 no legal move" + (d === 6 ? ", roll again" : "");
                    else if (r === "one") { mv = E.move(g, u, E.moves(g, u, d)[0]); t += " and " + E.say(g, mv); }
                    else t += " \u2014 choose a token";
                } else if (type === "move") {
                    if (g.ph !== "move" || !p || !E.moves(g, u, g.die).includes(+p.k)) return null;
                    mv = E.move(g, u, +p.k); t = `${u} ` + E.say(g, mv);
                } else return null;
                g.fx = { id, at: Date.now(), u, d, m: mv }; return t;
            },
            auto(g, u, id) {
                let t = null;
                if (g.ph === "roll") t = E.act(g, u, "roll", null, id);
                if (g.phase === "play" && g.order[g.turn] === u && g.ph === "move") { const k = E.moves(g, u, g.die).sort((a, b) => g.tok[u][b] - g.tok[u][a])[0]; t = E.act(g, u, "move", { k }, id) || t; }
                return t ? `${u} timed out \u2014 ${t}` : null;
            },
            leave(g, u) {
                const i = g.order.indexOf(u); if (i < 0) return false;
                g.order.splice(i, 1); delete g.tok[u]; delete g.col[u];
                if (g.order.length < 2) return E.win(g, g.order[0], 1);
                if (i < g.turn) g.turn--; else if (i === g.turn) { g.turn %= g.order.length; g.ph = "roll"; g.six = 0; g.turnAt = Date.now(); }
                return true;
            },
            deal(v) {
                const names = Tables.names(v.seats).slice(0, 4), rot = (v.rot || 0) + 1, order = names.map((_, i) => names[(i + rot) % names.length]), bet = v.bet || 0, n = order.length;
                const cols = n === 2 ? [0, 2] : [0, 1, 2, 3], col = {}, tok = {};
                order.forEach((u, i) => { col[u] = cols[i]; tok[u] = [-1, -1, -1, -1]; });
                const g = { seats: v.seats, owner: v.owner, max: v.max, rot, bet, phase: "play", hid: Date.now(), order, col, tok, turn: 0, ph: "roll", die: 0, six: 0, in: {}, pot: bet * n, turnAt: Date.now(), last: "Roll a 6 to bring a token out of base", fx: null, res: null };
                order.forEach((u) => { g.in[u] = bet; });
                return g;
            }
        };
        /*E-END*/

        const P = Object.assign(Party({ key: "parques", p: "pq", node: "parques", label: "Parqu\u00E9s", max: 4, E }), {
            onNew() { /* no pending local UI state */ },
            setup() {
                const b = pt$("pq-board"), add = (cls, x, y) => { const d = ptMk("div", cls); place(d, x, y); b.appendChild(d); };
                for (let c = 0; c < 4; c++) { add("pq-yard pk" + c, ...rotN(3, 3, c)); for (let k = 0; k < 4; k++) add("pq-slot pk" + c, ...cell(c, -1, k)); }
                add("pq-center", 8.5, 8.5);
                for (let i = 0; i < 68; i++) { const e = i % 17 === 8; add("pq-sq" + (e || i % 17 === 0 ? " safe" : "") + (e ? " entry pk" + (i - 8) / 17 : ""), ...trk(i)); }
                for (let c = 0; c < 4; c++) for (let j = 0; j < 7; j++) add("pq-sq lane pk" + c, ...rotN(8, 1 + j, c));
                b.appendChild(ptMk("div", "pq-tokens")).id = "pq-tokens";
                const d = pt$("pq-die"); for (let i = 0; i < 9; i++) d.appendChild(ptMk("i"));
                const roll = () => this.act("roll");
                pt$("pq-roll").addEventListener("click", roll); d.addEventListener("click", roll);
                d.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); roll(); } });
            },
            face(v) { Array.from(pt$("pq-die").children).forEach((c, i) => c.classList.toggle("on", PT_PIPS[v || 0].includes(i))); },
            view() {
                const g = this.g, me = State.username, order = g.order || [], inGame = order.includes(me), live = g.phase === "play", who = live ? order[g.turn] : null, myTurn = live && inGame && who === me;
                const legal = myTurn && g.ph === "move" ? E.moves(g, me, g.die) : [];
                const strip = pt$("pq-players"); strip.textContent = "";
                order.forEach((u) => {
                    const c = g.col[u], d = ptMk("div", `bw-seat pq-pl pk${c}` + (u === who ? " turn" : "") + (g.res && (g.res.ws || []).includes(u) ? " win" : ""));
                    d.appendChild(ptMk("div", "bw-name", (u === who ? "\u25B6 " : "") + u + (u === me ? " (you)" : "")));
                    d.appendChild(ptMk("div", "bw-info", `${CN[c]} \u00B7 ${g.tok[u].filter((x) => x === 75).length}/4 home`)); strip.appendChild(d);
                });
                const L = pt$("pq-tokens"); L.textContent = "";
                const items = []; order.forEach((u) => g.tok[u].forEach((p, k) => items.push({ u, k, p, c: g.col[u], xy: cell(g.col[u], p, k) })));
                const grp = {}; items.forEach((t) => { if (t.p >= 0 && t.p < 75) (grp[t.xy.join()] = grp[t.xy.join()] || []).push(t); });
                items.forEach((t) => {
                    const gp = grp[t.xy.join()], n = gp ? gp.length : 1, i = gp ? gp.indexOf(t) : 0, off = (i - (n - 1) / 2) * 0.34;
                    const wall = !!gp && t.p <= 67 && gp.filter((x) => x.u === t.u).length >= 2;
                    const e = ptMk("div", `pq-tok pk${t.c}` + (t.p === 75 ? " fin" : "") + (wall ? " wall" : "")); e.dataset.u = t.u; e.dataset.k = t.k;
                    place(e, t.xy[0] + off, t.xy[1] + off); e.setAttribute("aria-label", `${t.u}, ${CN[t.c]} token ${t.k + 1}`);
                    if (t.u === me && legal.includes(t.k)) {
                        e.classList.add("ok"); e.tabIndex = 0; e.setAttribute("role", "button");
                        const go = () => this.act("move", { k: t.k }); e.addEventListener("click", go);
                        e.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); go(); } });
                    }
                    L.appendChild(e);
                });
            },
            controls() {
                const g = this.g, me = State.username, order = g.order || [], inGame = order.includes(me), live = g.phase === "play", who = live ? order[g.turn] : null, my = live && inGame && who === me;
                const d = pt$("pq-die"); if (!d.classList.contains("rolling")) this.face(g.die || 0);
                d.classList.toggle("can", my && g.ph === "roll"); d.tabIndex = my && g.ph === "roll" ? 0 : -1;
                let m = "";
                if (g.phase === "done" && g.res) m = g.res.left ? `${g.res.ws[0]} wins by default${g.res.pot ? " \u2014 " + g.res.pot + " chips" : ""}.` : `${g.res.ws[0]} brings every token home and wins${g.res.pot ? " " + g.res.pot + " chips" : ""}!`;
                else if (my) m = g.ph === "roll" ? "Your turn \u2014 roll the dice." : `You rolled a ${g.die}. Tap a glowing token to move it.`;
                else if (live) m = `${who}'s turn\u2026`;
                pt$("pq-status").textContent = m; pt$("pq-log").textContent = g.last || "";
                pt$("pq-roll").hidden = !(my && g.ph === "roll"); this.common(my);
            },
            /* --- animations: the die tumbles, then the token hops square by square; captured tokens glide back to their base --- */
            rollAnim(v) {
                const d = pt$("pq-die"); d.classList.add("rolling"); let n = 0;
                const iv = window.setInterval(() => { this.face(1 + Math.floor(Math.random() * 6)); Sound.tone(300 + Math.random() * 200, 25, "square", 0.02); if (++n > 7) { window.clearInterval(iv); d.classList.remove("rolling"); this.face(v); } }, 90);
            },
            tokEl(u, k) { return Array.from(pt$("pq-tokens").children).find((e) => e.dataset.u === u && +e.dataset.k === k); },
            playFx() {
                const g = this.g, fx = g.fx; if (!fx || fx.id === this.lastFx) return;
                const late = this.lastFx === null; this.lastFx = fx.id;
                if ((late && Date.now() - fx.at > 4000) || CardFX.reduced() || Router.currentGameKey !== "parques") return;
                let t = 0; if (fx.d) { this.rollAnim(fx.d); t = 800; }
                const m = fx.m, c = g.col[fx.u], e = m && c != null ? this.tokEl(fx.u, m.k) : null;
                if (e) {
                    const pts = [cell(c, m.from, m.k)]; if (m.from < 0) pts.push(cell(c, 0, m.k)); else for (let q = m.from + 1; q <= m.to; q++) pts.push(cell(c, q, m.k));
                    const dur = Math.max(320, 150 * (pts.length - 1)), last = pts.length - 1;
                    const kf = pts.map((p, i) => ({ left: pc(p[0]), top: pc(p[1]), transform: `translate(-50%,-50%) scale(${i && i < last && i % 2 ? 1.22 : 1})` }));
                    kf[last].left = e.style.left; kf[last].top = e.style.top; kf[last].transform = "translate(-50%,-50%) scale(1)";
                    e.style.zIndex = "9"; const a = e.animate(kf, { duration: dur, delay: t, easing: "ease-in-out", fill: "backwards" }); a.onfinish = () => { e.style.zIndex = ""; };
                    pts.forEach((_, i) => { if (i) window.setTimeout(() => Sound.tone(380 + i * 24, 35, "triangle", 0.03), t + (dur / last) * i); });
                    (m.cap || []).forEach((x) => {
                        const ce = this.tokEl(x.u, x.k); if (!ce) return; const [cx, cy] = trk(x.i);
                        ce.animate([{ left: pc(cx), top: pc(cy) }, { left: ce.style.left, top: ce.style.top }], { duration: 600, delay: t + dur, easing: "ease-in", fill: "backwards" });
                        window.setTimeout(() => Sound.tone(150, 180, "sawtooth", 0.05), t + dur);
                    });
                    t += dur + ((m.cap || []).length ? 600 : 0);
                }
                CardFX.until = performance.now() + t + 200;
            }
        });
        return P;
    })();

    /* =========================================================================
       DOMINOES — double-six set (28 tiles), 7 tiles each (2-4 players), linear line with two open ends.
       Opening: the highest double (else the heaviest tile) is played first. A player with no playable tile draws from the
       boneyard (tap it); with an empty boneyard the turn passes automatically. First empty hand wins the pot; if every player
       is stuck the game is blocked and the lowest pip count wins (ties split the pot).
       The line is stored as oriented codes a*10+b (left value, right value) so every client renders the same board.
       ========================================================================= */
    const DM = (() => {
        const half = (n) => { const h = ptMk("div", "dh"); for (let i = 0; i < 9; i++) h.appendChild(ptMk("i", PT_PIPS[n].includes(i) ? "on" : "")); return h; };
        const tile = (a, b, cls, s) => { const d = ptMk("div", "dm " + cls); if (s) d.style.setProperty("--s", s + "px"); d.append(half(a), half(b)); d.setAttribute("aria-label", cls.includes("bk") ? "Hidden tile" : `Tile ${a}-${b}`); return d; };

        /*E-START*/
        const T = []; for (let a = 0; a <= 6; a++) for (let b = a; b <= 6; b++) T.push([a, b]);
        const E = {
            ends(g) { const c = g.ch || []; return c.length ? [Math.floor(c[0] / 10), c[c.length - 1] % 10] : null; },
            can(g, id) { const e = E.ends(g); if (!e) return id === g.open; const [a, b] = T[id]; return a === e[0] || b === e[0] || a === e[1] || b === e[1]; },
            ok(g, u) { return (g.hands[u] || []).filter((id) => E.can(g, id)); },
            sides(g, id) { const e = E.ends(g), [a, b] = T[id]; if (!e) return ["R"]; const l = a === e[0] || b === e[0], r = a === e[1] || b === e[1]; return l && r && e[0] !== e[1] ? ["L", "R"] : r ? ["R"] : l ? ["L"] : []; },
            pips(g, u) { return (g.hands[u] || []).reduce((s, id) => s + T[id][0] + T[id][1], 0); },
            adv(g) { g.turn = (g.turn + 1) % g.order.length; g.turnAt = Date.now(); },
            draw(g, u) { const y = g.yard || (g.yard = []); if (!y.length) return false; (g.hands[u] || (g.hands[u] = [])).push(y.pop()); return true; },
            starter(g) {
                let best = -1, id = 0, who = g.order[0];
                g.order.forEach((u) => (g.hands[u] || []).forEach((t) => { const [a, b] = T[t], s = a === b ? 100 + a : a + b + b / 10; if (s > best) { best = s; id = t; who = u; } }));
                return { id, u: who };
            },
            win(g, u, left) { const pips = {}; g.order.forEach((w) => { if (w !== u) pips[w] = E.pips(g, w); }); g.phase = "done"; g.turnAt = Date.now(); g.res = { ws: [u], pot: g.pot || 0, left: left ? 1 : 0, pips }; return "win"; },
            block(g) {
                const pips = {}; g.order.forEach((u) => { pips[u] = E.pips(g, u); });
                const low = Math.min(...g.order.map((u) => pips[u]));
                g.phase = "done"; g.turnAt = Date.now(); g.res = { ws: g.order.filter((u) => pips[u] === low), pot: g.pot || 0, blocked: 1, pips };
            },
            /** Auto-passes players who cannot move while the boneyard is empty; a full round of passes blocks the game. Returns who passed. */
            settle(g) {
                const out = [];
                for (let i = 0; i < 6 && g.phase === "play"; i++) {
                    const u = g.order[g.turn]; if (E.ok(g, u).length || (g.yard || []).length) break;
                    out.push(u); g.passes = (g.passes || 0) + 1;
                    if (g.passes >= g.order.length) { E.block(g); break; }
                    E.adv(g);
                }
                return out;
            },
            play(g, u, id, side) {
                const h = g.hands[u] || [], i = h.indexOf(id); if (i < 0 || !E.can(g, id)) return false;
                const [a, b] = T[id], ch = g.ch || (g.ch = []), e = E.ends(g);
                if (!e) ch.push(a * 10 + b);
                else if (side === "L" ? E.sides(g, id).includes("L") : !E.sides(g, id).includes("R")) { if (b === e[0]) ch.unshift(a * 10 + b); else ch.unshift(b * 10 + a); }
                else { if (a === e[1]) ch.push(a * 10 + b); else ch.push(b * 10 + a); }
                h.splice(i, 1); g.passes = 0;
                if (!h.length) E.win(g, u); else E.adv(g);
                return true;
            },
            act(g, u, type, p, id) {
                let t;
                if (type === "play") {
                    if (!p || !E.play(g, u, +p.id, p.side)) return null;
                    const [a, b] = T[+p.id]; t = `${u} played ${a}-${b}`; g.fx = { id, at: Date.now(), u, c: +p.id, s: p.side === "L" ? "L" : "R" };
                } else if (type === "draw") {
                    if (E.ok(g, u).length || !E.draw(g, u)) return null; t = `${u} drew from the boneyard`; g.fx = { id, at: Date.now(), u, d: 1 };
                } else return null;
                const ps = E.settle(g);
                if (g.phase === "done") t += g.res.blocked ? " \u2014 the game is blocked" : g.res.left ? "" : " \u2014 Domino!";
                else if (ps.length) t += ` \u2014 ${ps.join(", ")} had no move and passed`;
                return t;
            },
            auto(g, u, id) {
                while (!E.ok(g, u).length && (g.yard || []).length) E.draw(g, u);
                const ok = E.ok(g, u).sort((a, b) => T[b][0] + T[b][1] - T[a][0] - T[a][1]);
                if (ok.length) { const r = E.act(g, u, "play", { id: ok[0], side: E.sides(g, ok[0])[0] }, id); return r ? `${u} timed out \u2014 ${r}` : null; }
                const ps = E.settle(g); g.fx = null; return `${u} timed out` + (ps.length ? " and passed" : "");
            },
            leave(g, u) {
                const i = g.order.indexOf(u); if (i < 0) return false;
                g.yard = (g.yard || []).concat(g.hands[u] || []); delete g.hands[u]; g.order.splice(i, 1);
                if (g.order.length < 2) return E.win(g, g.order[0], 1);
                if (i < g.turn) g.turn--; else if (i === g.turn) { g.turn %= g.order.length; g.turnAt = Date.now(); }
                if (!(g.ch || []).length) { const s = E.starter(g); g.open = s.id; g.turn = g.order.indexOf(s.u); g.turnAt = Date.now(); }
                E.settle(g); return true;
            },
            deal(v) {
                const names = Tables.names(v.seats).slice(0, 4), rot = (v.rot || 0) + 1, order = names.map((_, i) => names[(i + rot) % names.length]), bet = v.bet || 0;
                const ids = Array.from({ length: 28 }, (_, i) => i); for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[ids[i], ids[j]] = [ids[j], ids[i]]; }
                const hands = {}; order.forEach((u) => { hands[u] = ids.splice(-7); });
                const g = { seats: v.seats, owner: v.owner, max: v.max, rot, bet, phase: "play", hid: Date.now(), order, hands, yard: ids, ch: [], passes: 0, in: {}, pot: bet * order.length, turnAt: Date.now(), fx: null, res: null, turn: 0, open: 0 };
                const s = E.starter(g); g.open = s.id; g.turn = order.indexOf(s.u); g.last = `${s.u} opens with ${T[s.id][0]}-${T[s.id][1]}`;
                order.forEach((u) => { g.in[u] = bet; });
                return g;
            }
        };
        /*E-END*/

        return Object.assign(Party({ key: "dominoes", p: "dm", node: "dominoes", label: "Dominoes", max: 4, E }), {
            pend: null, prev: new Set(),
            onNew() { this.pend = null; this.prev = new Set(); },
            setup() {
                const y = pt$("dm-yard"); y.addEventListener("click", () => this.drawTile());
                y.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); this.drawTile(); } });
                pt$("dm-pick-l").addEventListener("click", () => this.choose("L")); pt$("dm-pick-r").addEventListener("click", () => this.choose("R"));
                pt$("dm-pick-x").addEventListener("click", () => { this.pend = null; pt$("dm-pick").hidden = true; });
            },
            drawTile() { const g = this.g, me = State.username; if (g.phase === "play" && (g.order || [])[g.turn] === me && !E.ok(g, me).length && (g.yard || []).length) this.act("draw"); },
            choose(side) { const id = this.pend; this.pend = null; pt$("dm-pick").hidden = true; if (id != null) this.act("play", { id, side }); },
            pick(id) {
                const s = E.sides(this.g, id); if (s.length === 1) return this.act("play", { id, side: s[0] });
                const e = E.ends(this.g); this.pend = id; pt$("dm-pick-l").textContent = `Left end (${e[0]})`; pt$("dm-pick-r").textContent = `Right end (${e[1]})`; pt$("dm-pick").hidden = false;
            },
            view(fresh) {
                const g = this.g, me = State.username, order = g.order || [], inGame = order.includes(me), live = g.phase === "play", who = live ? order[g.turn] : null, my = live && inGame && who === me, done = g.phase === "done";
                const fx = g.fx && g.fx.id !== this.lastFx && Date.now() - g.fx.at < 4000 ? g.fx : null;
                const opps = pt$("dm-opps"); opps.textContent = "";
                order.filter((u) => u !== me).forEach((u) => {
                    const h = g.hands[u] || [], d = ptMk("div", "bw-seat dm-opp" + (u === who ? " turn" : "") + (g.res && (g.res.ws || []).includes(u) ? " win" : "")), fan = ptMk("div", "dm-fan");
                    d.appendChild(ptMk("div", "bw-name", (u === who ? "\u25B6 " : "") + u + " \u00B7 " + h.length + (h.length === 1 ? " tile" : " tiles")));
                    h.forEach((id) => fan.appendChild(done ? tile(T[id][0], T[id][1], "v", 16) : tile(0, 0, "v bk", 14))); d.appendChild(fan); opps.appendChild(d);
                });
                const ch = pt$("dm-chain"), code = g.ch || [], e = E.ends(g); ch.textContent = "";
                if (!code.length) ch.appendChild(ptMk("div", "dm-empty", live ? `Opening tile: ${T[g.open][0]}-${T[g.open][1]}` : ""));
                else {
                    ch.appendChild(ptMk("span", "dm-end", "\u25C0 " + e[0]));
                    code.forEach((c, i) => { const a = Math.floor(c / 10), b = c % 10, t = tile(a, b, a === b ? "v" : "h", 30); if (fx && fx.c != null && i === (fx.s === "L" ? 0 : code.length - 1)) t.classList.add("drop"); ch.appendChild(t); });
                    ch.appendChild(ptMk("span", "dm-end", e[1] + " \u25B6"));
                }
                const yl = (g.yard || []).length, yd = pt$("dm-yard"); yd.textContent = "";
                for (let i = 0; i < Math.min(3, yl); i++) yd.appendChild(tile(0, 0, "v bk"));
                yd.appendChild(ptMk("span", "dm-count", yl ? `Boneyard \u00B7 ${yl}` : "Boneyard empty"));
                yd.classList.toggle("can", my && !E.ok(g, me).length && yl > 0);
                const hand = pt$("dm-hand"), mine = (g.hands[me] || []).slice().sort((a, b) => a - b); hand.textContent = ""; hand.hidden = !inGame;
                mine.forEach((id, i) => {
                    const t = tile(T[id][0], T[id][1], "v", 38), can = my && E.can(g, id);
                    if (my) t.classList.add(can ? "ok" : "no");
                    if (can) { t.tabIndex = 0; t.setAttribute("role", "button"); t.addEventListener("click", () => this.pick(id)); t.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); this.pick(id); } }); }
                    if (fresh) { t.classList.add("drop"); t.style.animationDelay = i * 70 + "ms"; } else if (fx && fx.d && fx.u === me && !this.prev.has(id)) t.classList.add("drop");
                    hand.appendChild(t);
                });
                this.prev = new Set(mine); if (!my) this.pend = null; pt$("dm-pick").hidden = this.pend == null;
            },
            controls() {
                const g = this.g, me = State.username, order = g.order || [], inGame = order.includes(me), live = g.phase === "play", who = live ? order[g.turn] : null, my = live && inGame && who === me;
                const ok = my ? E.ok(g, me) : [], yl = (g.yard || []).length; let m = "";
                if (g.phase === "done" && g.res) {
                    const r = g.res, w = (r.ws || []).join(" & "), pot = r.pot ? ` \u2014 ${r.pot} chips${r.ws.length > 1 ? " split" : ""}` : "";
                    m = r.left ? `${w} wins by default${pot}.` : r.blocked ? `Blocked game \u2014 ${w} ${r.ws.length > 1 ? "tie" : "wins"} with the lowest count (${r.pips[r.ws[0]]} pips)${pot}.` : `${w} played the last tile \u2014 Domino!${pot}`;
                } else if (my) m = ok.length ? ((g.ch || []).length ? "Play a highlighted tile." : `Open with the ${T[g.open][0]}-${T[g.open][1]}.`) : yl ? "No playable tile \u2014 tap the boneyard to draw." : "No tiles to play \u2014 passing\u2026";
                else if (live) m = `${who}'s turn\u2026`;
                pt$("dm-status").textContent = m; pt$("dm-log").textContent = g.last || ""; this.common(my);
            },
            playFx() { const fx = this.g.fx; if (!fx || fx.id === this.lastFx) return; const late = this.lastFx === null; this.lastFx = fx.id; if (!(late && Date.now() - fx.at > 4000) && !CardFX.reduced()) { Sound.tone(fx.c != null ? 420 : 300, 60, "triangle", 0.04); CardFX.until = performance.now() + 600; } }
        });
    })();
    PQ.init(); DM.init();
    { const s0 = Social.start, s1 = Social.stop; Social.start = function () { s0.call(Social); PQ.start(); DM.start(); }; Social.stop = function () { s1.call(Social); PQ.stop(); DM.stop(); }; }

    /* =========================================================================
       STRATEGY DUELS (Casual & Party Games) — Chess, Chinese Checkers, Color Code Breaker, Picas y Fijas
       Real-time multiplayer at rooms/<code>/{chess,checkers,mastermind,bullscows} through the shared Party table flow
       (lobby -> optional stake -> match -> winner takes the pot), plus single-player matches against the Casino Bot:
       the bot sits at a LocalRef table that implements the Firebase transaction interface, so solo and online games run
       the exact same rules engines, stake handling and chip settlement.
       NOTE: the code-breaker secrets live in the shared match state (this is a serverless casual game, like the other tables).
       ========================================================================= */
    (() => {
        const BOT = "Casino Bot", $ = pt$, mk = ptMk;
        /*DE-START*/
        const rnd = (n) => Math.floor(Math.random() * n);
        const shuf = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1);[a[i], a[j]] = [a[j], a[i]]; } return a; };
        const finish = (g, ws, why, left) => { g.phase = "done"; g.turnAt = Date.now(); g.res = { ws, pot: g.pot || 0, why: why || "", left: left ? 1 : 0 }; };
        const mkGame = (v, n, extra) => {
            const names = Tables.names(v.seats).slice(0, n), rot = (v.rot || 0) + 1, order = names.map((_, i) => names[(i + rot) % names.length]), bet = v.bet || 0;
            const g = { seats: v.seats, owner: v.owner, max: v.max, rot, bet, phase: "play", hid: Date.now(), order, turn: 0, in: {}, pot: bet * order.length, turnAt: Date.now(), fx: null, res: null };
            order.forEach((u) => { g.in[u] = bet; });
            return Object.assign(g, extra(order, g));
        };
        const autoOf = (E) => (g, u, id) => { const m = E.ai(g, u), r = m && E.act(g, u, m.type, m.p, id); return r ? `${u} timed out \u2014 ${r}` : null; };
        const duelLeave = (g, u) => { const i = g.order.indexOf(u); if (i < 0) return false; g.order.splice(i, 1); finish(g, [g.order[0]], "opponent left", 1); return true; };

        /* ---------------------------------- CHESS ---------------------------------- */
        const CHE = (() => {
            const isW = (p) => p !== "." && p === p.toUpperCase();
            const N = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]], K = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
            const D = { B: K.filter((d) => d[0] && d[1]), R: K.filter((d) => !d[0] || !d[1]), Q: K };
            const VAL = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 }, sqn = (i) => "abcdefgh"[i & 7] + (8 - (i >> 3));
            const START = "rnbqkbnrpppppppp" + ".".repeat(32) + "PPPPPPPPRNBQKBNR";
            const att = (b, sq, w) => {
                const r = sq >> 3, c = sq & 7, at = (rr, cc) => (rr >= 0 && rr < 8 && cc >= 0 && cc < 8 ? b[rr * 8 + cc] : null);
                for (const dc of [-1, 1]) if (at(w ? r + 1 : r - 1, c + dc) === (w ? "P" : "p")) return true;
                for (const [a, d] of N) if (at(r + a, c + d) === (w ? "N" : "n")) return true;
                for (const [a, d] of K) {
                    if (at(r + a, c + d) === (w ? "K" : "k")) return true;
                    let rr = r + a, cc = c + d;
                    while (rr >= 0 && rr < 8 && cc >= 0 && cc < 8) { const p = b[rr * 8 + cc]; if (p !== ".") { const u = p.toUpperCase(); if (isW(p) === w && (u === "Q" || (a && d ? u === "B" : u === "R"))) return true; break; } rr += a; cc += d; }
                }
                return false;
            };
            const gen = (s) => {
                const b = s.b, w = s.t === "w", out = [];
                for (let i = 0; i < 64; i++) {
                    const p = b[i]; if (p === "." || isW(p) !== w) continue;
                    const r = i >> 3, c = i & 7, u = p.toUpperCase(), add = (t, x) => out.push(Object.assign({ f: i, t }, x || {}));
                    if (u === "P") {
                        const d = w ? -1 : 1, r1 = r + d, pr = w ? 0 : 7;
                        if (r1 < 0 || r1 > 7) continue;
                        const fwd = (t) => { if (t >> 3 === pr) ["Q", "R", "B", "N"].forEach((q) => add(t, { p: q })); else add(t); };
                        if (b[r1 * 8 + c] === ".") { fwd(r1 * 8 + c); if (r === (w ? 6 : 1) && b[(r + 2 * d) * 8 + c] === ".") add((r + 2 * d) * 8 + c); }
                        for (const dc of [-1, 1]) { const cc = c + dc; if (cc < 0 || cc > 7) continue; const t = r1 * 8 + cc; if (b[t] !== "." && isW(b[t]) !== w) fwd(t); else if (t === s.e) add(t, { ep: 1 }); }
                    } else if (u === "N" || u === "K") {
                        for (const [dr, dc] of u === "N" ? N : K) { const rr = r + dr, cc = c + dc; if (rr < 0 || rr > 7 || cc < 0 || cc > 7) continue; const t = rr * 8 + cc; if (b[t] === "." || isW(b[t]) !== w) add(t); }
                        const h = w ? 60 : 4, R = w ? "R" : "r";
                        if (u === "K" && i === h && !att(b, i, !w)) {
                            if (s.c.includes(w ? "K" : "k") && b[h + 1] === "." && b[h + 2] === "." && b[h + 3] === R && !att(b, h + 1, !w) && !att(b, h + 2, !w)) add(h + 2, { cs: 1 });
                            if (s.c.includes(w ? "Q" : "q") && b[h - 1] === "." && b[h - 2] === "." && b[h - 3] === "." && b[h - 4] === R && !att(b, h - 1, !w) && !att(b, h - 2, !w)) add(h - 2, { cs: -1 });
                        }
                    } else {
                        for (const [dr, dc] of D[u]) { let rr = r + dr, cc = c + dc; while (rr >= 0 && rr < 8 && cc >= 0 && cc < 8) { const t = rr * 8 + cc; if (b[t] === ".") add(t); else { if (isW(b[t]) !== w) add(t); break; } rr += dr; cc += dc; } }
                    }
                }
                return out;
            };
            const make = (s, m) => {
                const b = s.b.split(""), p = b[m.f], w = s.t === "w", u = p.toUpperCase(); let cap = b[m.t] !== ".", c = s.c;
                b[m.t] = m.p ? (w ? m.p : m.p.toLowerCase()) : p; b[m.f] = ".";
                if (m.ep) { b[m.t + (w ? 8 : -8)] = "."; cap = true; }
                if (m.cs) { const h = w ? 60 : 4; if (m.cs > 0) { b[h + 1] = b[h + 3]; b[h + 3] = "."; } else { b[h - 1] = b[h - 4]; b[h - 4] = "."; } }
                const rights = { 60: "KQ", 4: "kq", 63: "K", 56: "Q", 7: "k", 0: "q" };
                [m.f, m.t].forEach((q) => { if (rights[q]) for (const ch of rights[q]) c = c.replace(ch, ""); });
                return { b: b.join(""), t: w ? "b" : "w", c, e: u === "P" && Math.abs(m.t - m.f) === 16 ? (m.f + m.t) / 2 : -1, h: u === "P" || cap ? 0 : s.h + 1 };
            };
            const legal = (s) => { const w = s.t === "w"; return gen(s).filter((m) => { const n = make(s, m); return !att(n.b, n.b.indexOf(w ? "K" : "k"), !w); }); };
            const status = (s) => {
                const ms = legal(s), w = s.t === "w", ks = s.b.indexOf(w ? "K" : "k"), chk = ks >= 0 && att(s.b, ks, !w); let end = "";
                const rest = s.b.replace(/[.kK]/g, "");
                if (!ms.length) end = chk ? "mate" : "stalemate"; else if (s.h >= 100) end = "50-move rule"; else if (rest === "" || /^[nNbB]$/.test(rest)) end = "insufficient material";
                return { ms, chk, end };
            };
            const ev = (b) => {
                let sc = 0;
                for (let i = 0; i < 64; i++) {
                    const p = b[i]; if (p === ".") continue;
                    const w = isW(p), u = p.toLowerCase(), r = i >> 3, c = i & 7, cen = 3.5 - Math.max(Math.abs(r - 3.5), Math.abs(c - 3.5)); let v = VAL[u];
                    if (u === "n" || u === "b") v += cen * 8; else if (u === "p") v += (w ? 6 - r : r - 1) * 6 + cen * 2; else if (u === "q") v += cen * 3;
                    sc += w ? v : -v;
                }
                return sc;
            };
            const search = (s, d, a, bt) => {
                if (!d) return (s.t === "w" ? 1 : -1) * ev(s.b);
                const ms = gen(s).sort((x, y) => (VAL[s.b[y.t].toLowerCase()] || 0) - (VAL[s.b[x.t].toLowerCase()] || 0)); let best = -1e9;
                for (const m of ms) {
                    if (s.b[m.t].toLowerCase() === "k") return 1e5 + d;
                    const v = -search(make(s, m), d - 1, -bt, -a); if (v > best) { best = v; if (v > a) a = v; if (a >= bt) break; }
                }
                return ms.length ? best : 0;
            };
            const cs = (g) => ({ b: g.b, t: g.tn, c: g.cr, e: g.ep, h: g.hm });
            const E = {
                isW, sqn, cs, legal, status, att,
                ai(g) {
                    const s = cs(g), ms = legal(s); let best = null, bv = -1e9;
                    ms.forEach((m) => { const v = -search(make(s, m), 2, -1e9, 1e9) + Math.random() * 6; if (v > bv) { bv = v; best = m; } });
                    return best && { type: "move", p: { f: best.f, t: best.t, p: best.p } };
                },
                act(g, u, type, p, id) {
                    if (type !== "move" || !p) return null;
                    const s = cs(g), m = legal(s).find((x) => x.f === +p.f && x.t === +p.t && (!x.p || x.p === (p.p || "Q"))); if (!m) return null;
                    const cap = s.b[m.t] !== "." || m.ep ? 1 : 0, n = make(s, m), st = status(n);
                    Object.assign(g, { b: n.b, tn: n.t, cr: n.c, ep: n.e, hm: n.h, chk: st.chk ? 1 : 0, turn: n.t === "w" ? 0 : 1, turnAt: Date.now() });
                    g.fx = { id, at: Date.now(), u, f: m.f, t: m.t, cap, cs: m.cs || 0 };
                    let note = `${u}: ${sqn(m.f)}\u2192${sqn(m.t)}${m.p ? "=" + m.p : ""}`;
                    if (st.end === "mate") { finish(g, [u], "checkmate"); note += " \u2014 checkmate!"; }
                    else if (st.end) { finish(g, g.order.slice(), st.end); note += ` \u2014 draw (${st.end})`; }
                    else if (st.chk) note += " +";
                    return note;
                },
                leave: duelLeave,
                deal(v) { return mkGame(v, 2, () => ({ b: START, tn: "w", cr: "KQkq-", ep: -1, hm: 0, chk: 0 })); }
            };
            E.auto = autoOf(E);
            return E;
        })();

        /* ------------------------------- CHINESE CHECKERS ------------------------------- */
        const CCE = (() => {
            const CELLS = [], IDX = {};
            for (let x = -8; x <= 8; x++) for (let y = -8; y <= 8; y++) {
                const z = -x - y; if (Math.abs(z) > 8) continue;
                const hex = Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) <= 4;
                const tip = (x >= 5 && y >= -4 && z >= -4) || (x <= -5 && y <= 4 && z <= 4) || (y >= 5 && x >= -4 && z >= -4) || (y <= -5 && x <= 4 && z <= 4) || (z >= 5 && x >= -4 && y >= -4) || (z <= -5 && x <= 4 && y <= 4);
                if (hex || tip) { IDX[x + "," + y] = CELLS.length; CELLS.push([x, y, z]); }
            }
            const DIRS = [[1, -1], [-1, 1], [1, 0], [-1, 0], [0, 1], [0, -1]];
            const NB = CELLS.map(([x, y]) => DIRS.map(([a, b]) => { const j = IDX[(x + a) + "," + (y + b)]; return j == null ? -1 : j; }));
            /* ring order (clockwise from the top): -z, +x, -y, +z, -x, +y; the opposite corner is always +3 */
            const RING = [(c) => c[2] <= -5, (c) => c[0] >= 5, (c) => c[1] <= -5, (c) => c[2] >= 5, (c) => c[0] <= -5, (c) => c[1] >= 5];
            const CORNER = RING.map((f) => CELLS.map((c, i) => (f(c) ? i : -1)).filter((i) => i >= 0));
            const hd = (c, t) => (Math.abs(c[0] - t[0]) + Math.abs(c[1] - t[1]) + Math.abs(c[2] - t[2])) / 2;
            const occ = (g) => { const o = {}; g.order.forEach((u) => (g.pc[u] || []).forEach((i) => { o[i] = u; })); return o; };
            const reach = (g, f) => {
                const o = occ(g), res = {}; o[f] = null;
                NB[f].forEach((a) => { if (a >= 0 && !o[a]) res[a] = [f, a]; });
                const q = [f], seen = { [f]: [f] };
                while (q.length) {
                    const c = q.shift();
                    NB[c].forEach((a, k) => { if (a < 0 || !o[a]) return; const b = NB[a][k]; if (b < 0 || o[b] || seen[b]) return; seen[b] = seen[c].concat(b); q.push(b); if (!res[b]) res[b] = seen[b]; });
                }
                return res;
            };
            const won = (g, u) => { const t = CORNER[(g.cn[u] + 3) % 6], mine = g.pc[u].filter((i) => t.includes(i)).length; return mine === 10 || (mine >= 9 && t.every((i) => occ(g)[i] != null)); };
            const adv = (g) => {
                const n = g.order.length;
                for (let k = 0; k < n; k++) { g.turn = (g.turn + 1) % n; if (g.pc[g.order[g.turn]].some((f) => Object.keys(reach(g, f)).length)) break; }
                g.turnAt = Date.now();
            };
            const E = {
                CELLS, CORNER, reach,
                ai(g, u) {
                    const tgt = CORNER[(g.cn[u] + 3) % 6], ts = new Set(tgt), ap = tgt.reduce((a, i) => (hd(CELLS[i], [0, 0, 0]) > hd(CELLS[a], [0, 0, 0]) ? i : a), tgt[0]), d = (i) => hd(CELLS[i], CELLS[ap]); let best = null, bs = -1e9;
                    g.pc[u].forEach((f) => { const r = reach(g, f); for (const k in r) { const t = +k; let s = (d(f) - d(t)) * 10 + d(f) * 0.35 + Math.random() * 1.5; if (ts.has(t) && !ts.has(f)) s += 4; else if (ts.has(f) && !ts.has(t)) s -= 12; if (s > bs) { bs = s; best = { type: "move", p: { f, t } }; } } });
                    return best;
                },
                act(g, u, type, p, id) {
                    if (type !== "move" || !p || !g.pc[u].includes(+p.f)) return null;
                    const path = reach(g, +p.f)[+p.t]; if (!path) return null;
                    g.pc[u][g.pc[u].indexOf(+p.f)] = +p.t; g.fx = { id, at: Date.now(), u, path };
                    if (won(g, u)) { finish(g, [u], "all marbles home"); return `${u} moves every marble home!`; }
                    adv(g); return `${u} ${path.length > 2 ? "hops" : "steps"} (${path.length - 1} ${path.length > 2 ? "jumps" : "step"})`.replace("(1 jumps)", "(1 jump)");
                },
                leave(g, u) {
                    const i = g.order.indexOf(u); if (i < 0) return false;
                    g.order.splice(i, 1); delete g.pc[u]; delete g.cn[u];
                    if (g.order.length < 2) { finish(g, [g.order[0]], "opponents left", 1); return true; }
                    if (i < g.turn) g.turn--; else if (i === g.turn) { g.turn %= g.order.length; g.turnAt = Date.now(); }
                    return true;
                },
                deal(v) {
                    return mkGame(v, 4, (order) => {
                        const cs = order.length === 2 ? [0, 3] : order.length === 3 ? [0, 2, 4] : [0, 1, 3, 4], pc = {}, cn = {};
                        order.forEach((u, i) => { cn[u] = cs[i]; pc[u] = CORNER[cs[i]].slice(); });
                        return { pc, cn };
                    });
                }
            };
            E.auto = autoOf(E);
            return E;
        })();

        /* ----------------- CODE BREAKERS: Color Code (Mastermind) + Picas y Fijas (Bulls & Cows) ----------------- */
        const CDE = (cfg) => {
            const fb = (sec, gu) => {
                let ex = 0; const cs = {}, cg = {};
                for (let i = 0; i < cfg.len; i++) if (sec[i] === gu[i]) ex++; else { cs[sec[i]] = (cs[sec[i]] || 0) + 1; cg[gu[i]] = (cg[gu[i]] || 0) + 1; }
                let co = 0; for (const k in cg) co += Math.min(cg[k], cs[k] || 0);
                return [ex, co];
            };
            const valid = (c) => Array.isArray(c) && c.length === cfg.len && c.every((x) => Number.isInteger(x) && x >= 0 && x < cfg.sym) && (cfg.dup || new Set(c).size === c.length);
            const all = (() => { const out = []; const go = (a) => { if (a.length === cfg.len) return out.push(a.slice()); for (let s = 0; s < cfg.sym; s++) if (cfg.dup || !a.includes(s)) { a.push(s); go(a); a.pop(); } }; go([]); return out; })();
            const secret = () => (cfg.dup ? Array.from({ length: cfg.len }, () => rnd(cfg.sym)) : shuf(Array.from({ length: cfg.sym }, (_, i) => i)).slice(0, cfg.len));
            const E = {
                fb, valid,
                ai(g, u) {
                    const h = g.gs[u] || [], cands = all.filter((c) => h.every((x) => { const r = fb(c, x.c); return r[0] === x.e && r[1] === x.p; }));
                    const pick = h.length || !cfg.first ? cands[rnd(cands.length)] : cfg.first;
                    return { type: "guess", p: { c: pick || all[0] } };
                },
                act(g, u, type, p, id) {
                    if (type !== "guess" || !p || !valid(p.c)) return null;
                    g.gs = g.gs || {}; g.sv = g.sv || {}; const h = (g.gs[u] = g.gs[u] || []); if (h.length >= cfg.tries) return null;
                    const [ex, co] = fb(g.sec[u], p.c); h.push({ c: p.c.map(Number), e: ex, p: co });
                    g.fx = { id, at: Date.now(), u, n: h.length - 1, ex }; if (ex === cfg.len) g.sv[u] = h.length;
                    let note = `${u} guessed \u2014 ${ex} ${cfg.fija}, ${co} ${cfg.pica}`;
                    g.turn = (g.turn + 1) % g.order.length; g.turnAt = Date.now();
                    if (g.turn === 0) {
                        const ws = g.order.filter((x) => g.sv[x]);
                        if (ws.length) { finish(g, ws, "cracked"); note += ws.length > 1 ? " \u2014 both cracked the code!" : ` \u2014 ${ws[0]} cracked the code!`; }
                        else if (g.order.every((x) => (g.gs[x] || []).length >= cfg.tries)) { finish(g, g.order.slice(), "out of tries"); note += " \u2014 nobody cracked it"; }
                    }
                    return note;
                },
                leave: duelLeave,
                deal(v) { return mkGame(v, 2, (order) => { const sec = {}; order.forEach((u) => { sec[u] = secret(); }); return { sec, gs: {}, sv: {} }; }); }
            };
            E.auto = autoOf(E);
            return E;
        };
        const MME = CDE({ len: 4, sym: 6, dup: true, tries: 10, first: [0, 0, 1, 1], fija: "exact", pica: "colour-only" });
        const BCE = CDE({ len: 4, sym: 10, dup: false, tries: 10, fija: "fijas", pica: "picas" });
        /*DE-END*/

        /* ---- Local table: same interface as a Firebase ref, so solo AI matches reuse the whole Party flow (lobby, stake, chips) ---- */
        class LocalRef {
            constructor(v) { this.v = v; this.cbs = []; }
            snap() { const v = this.v == null ? null : JSON.parse(JSON.stringify(this.v)); return { val: () => v }; }
            on(e, cb) { this.cbs.push(cb); cb(this.snap()); }
            off(e, cb) { this.cbs = this.cbs.filter((c) => c !== cb); }
            child() { return { onDisconnect: () => ({ remove() { }, cancel() { } }) }; }
            transaction(fn) {
                const r = fn(this.snap().val()); if (r === undefined) return Promise.resolve({ committed: false });
                this.v = r; this.cbs.slice().forEach((c) => c(this.snap())); return Promise.resolve({ committed: true });
            }
        }

        /** Party table + optional single-player match against the Casino Bot (runs entirely in the browser). */
        const Duel = (o) => {
            const P = Party(o), B = { stop: P.stop, leave: P.leave, closeTable: P.closeTable, deal: P.deal, common: P.common, render: P.render, sync: P.sync }, el = (s) => $(o.p + "-" + s);
            return Object.assign(P, {
                local: false, aiT: 0, snd: null,
                stop() { B.stop.call(this); clearTimeout(this.aiT); this.local = false; },
                solo() {
                    const me = State.username; if (!me) return; this.stop(); this.local = true;
                    this.ref = new LocalRef({ phase: "lobby", owner: me, seats: { s0: me, s1: BOT }, max: 2, rot: 0, bet: 0, hid: Date.now(), turnAt: Date.now() });
                    this.cb = (s) => { const n = s.val() || { phase: "lobby" }; if (n.hid !== this.g.hid) this.onNew(); this.g = n; this.sync(); this.render(); this.think(); };
                    this.ref.on("value", this.cb);
                    this.tick = window.setInterval(() => { if (this.g.phase === "play") this.controls(); }, 1000);
                },
                deal() {
                    if (!this.local) return B.deal.call(this);
                    const bet = this.g.bet || 0; if (bet && !BetLimits.ok(Router.currentGameKey, bet)) return; if (State.balance < bet) return Notify.error(`You need ${bet} chips to cover the stake.`);
                    this.ref.transaction((v) => (v && v.phase === "lobby" ? o.E.deal(v) : undefined));
                },
                leave() {
                    if (!this.local) return B.leave.call(this);
                    const g = this.g, me = State.username;
                    if (g.phase === "play") {
                        if (!window.confirm("Forfeit the match? You lose your stake.")) return;
                        this.store(`${o.key}-done-${Room.code}-${g.hid}-${me}`, "1");
                        if (this.paid > 0) resolveGameOutcome(o.key, { roundId: g.hid + "-" + me, entries: [{ wager: this.paid, payout: 0 }] });
                        Sound.lose();
                    }
                    this.start();
                },
                closeTable() { if (this.local) this.start(); else B.closeTable.call(this); },
                /** Same chip settlement as every table game; a split pot (draw) settles quietly with no "you win" fanfare. */
                sync() {
                    const r = this.g.res; if (!(this.g.phase === "done" && r && r.ws.length > 1)) return B.sync.call(this);
                    const c = [Effects.celebrate, BW.sparkle, Notify.success]; Effects.celebrate = BW.sparkle = Notify.success = () => { };
                    try { B.sync.call(this); } finally { [Effects.celebrate, BW.sparkle, Notify.success] = c; }
                },
                /** The bot thinks for a moment, then plays inside a local transaction (same engine call a human move uses). */
                think() {
                    clearTimeout(this.aiT); const g = this.g;
                    if (!this.local || g.phase !== "play" || g.order[g.turn] !== BOT) return;
                    const hid = g.hid, turn = g.turn;
                    this.aiT = window.setTimeout(() => {
                        const c = this.g; if (c.hid !== hid || c.phase !== "play" || c.turn !== turn) return;
                        this.ref.transaction((v) => {
                            if (!v || v.phase !== "play" || v.order[v.turn] !== BOT) return;
                            const id = Date.now() + "-bot", m = o.E.ai(v, BOT); let note = m && o.E.act(v, BOT, m.type, m.p, id);
                            if (!note) note = o.E.auto(v, BOT, id); if (!note) return;
                            v.last = note; return v;
                        });
                    }, o.delay || 900);
                },
                common(my) {
                    B.common.call(this, my); const g = this.g, me = State.username, live = el("live"), r = g.res;
                    if (this.local) el("kick").hidden = true;
                    const out = g.phase === "done" && r ? ((r.ws || []).length > 1 ? "draw" : r.ws.includes(me) ? "win" : "lose") : "";
                    live.dataset.res = out;
                    if (out && this.snd !== g.hid && (g.order || []).includes(me)) { this.snd = g.hid; if (out === "lose") { Sound.lose(); Notify.warning("You lost this match."); } else if (out === "draw") Notify.success("Draw \u2014 stakes are split."); }
                },
                render() {
                    B.render.call(this); const g = this.g, lob = el("lobby");
                    if (this.local || lob.hidden || Tables.seatOf(g.seats || {}, State.username)) return;
                    const row = mk("div", "tl-actions"), b = mk("button", "btn btn-action", "\u{1F916} Play vs AI (single player)"); b.type = "button"; b.addEventListener("click", () => this.solo()); row.appendChild(b); lob.appendChild(row);
                }
            });
        };
        const resText = (g, label) => {
            const r = g.res, pot = r.pot ? ` \u2014 ${r.pot} chips${r.ws.length > 1 ? " split" : ""}` : "", w = r.ws.join(" & ");
            return r.left ? `${w} wins by default${pot}.` : r.ws.length > 1 ? `Draw (${r.why})${pot}.` : `${w} wins \u2014 ${r.why || label}${pot}!`;
        };
        const strip = (g, who, extra) => {
            const s = $(g.p + "-players"); s.textContent = "";
            (g.o.order || []).forEach((u, i) => {
                const d = mk("div", `bw-seat pq-pl pk${i}` + (u === who ? " turn" : "") + (g.o.res && g.o.res.ws.includes(u) ? " win" : ""));
                d.appendChild(mk("div", "bw-name", (u === who ? "\u25B6 " : "") + u + (u === State.username ? " (you)" : ""))); d.appendChild(mk("div", "bw-info", extra(u, i))); s.appendChild(d);
            });
        };
        const turnInfo = (g) => { const me = State.username, order = g.order || [], live = g.phase === "play", who = live ? order[g.turn] : null; return { me, order, live, who, my: live && who === me, inGame: order.includes(me) }; };

        /* ---------------------------------- CHESS ---------------------------------- */
        const GLYPH = { K: "\u265A", Q: "\u265B", R: "\u265C", B: "\u265D", N: "\u265E", P: "\u265F" };
        const CH = Duel({ key: "chess", p: "ch", node: "chess", label: "Chess", max: 2, E: CHE, delay: 650 });
        Object.assign(CH, {
            sel: null, pend: null,
            onNew() { this.sel = this.pend = null; if ($("ch-promo")) $("ch-promo").hidden = true; },
            setup() {
                $("ch-board").addEventListener("click", (e) => { const q = e.target.closest("[data-sq]"); if (q) this.click(+q.dataset.sq); });
                $("ch-promo").querySelectorAll("[data-p]").forEach((b) => b.addEventListener("click", () => { const d = this.pend; this.pend = this.sel = null; $("ch-promo").hidden = true; if (d) this.act("move", { f: d.f, t: d.t, p: b.dataset.p }); }));
                $("ch-promo-x").addEventListener("click", () => { this.pend = this.sel = null; $("ch-promo").hidden = true; this.view(); });
            },
            click(q) {
                const g = this.g, me = State.username; if (g.phase !== "play" || g.order[g.turn] !== me) return;
                const s = CHE.cs(g), p = s.b[q], ms = CHE.legal(s);
                if (this.sel != null) {
                    const c = ms.filter((m) => m.f === this.sel && m.t === q);
                    if (c.length) { if (c[0].p) { this.pend = { f: this.sel, t: q }; $("ch-promo").hidden = false; return; } const f = this.sel; this.sel = null; return this.act("move", { f, t: q }); }
                }
                this.sel = p !== "." && CHE.isW(p) === (g.order[0] === me) && ms.some((m) => m.f === q) ? q : null; this.view();
            },
            view() {
                const g = this.g, me = State.username, flip = g.order[1] === me, s = CHE.cs(g), { who, my } = turnInfo(g);
                const tg = this.sel != null ? CHE.legal(s).filter((m) => m.f === this.sel).map((m) => m.t) : [], fx = g.fx, ks = g.chk ? s.b.indexOf(s.t === "w" ? "K" : "k") : -1;
                strip({ p: "ch", o: g }, who, (u, i) => (i ? "\u265A Black" : "\u2654 White")); const b = $("ch-board"); b.textContent = "";
                for (let k = 0; k < 64; k++) {
                    const q = flip ? 63 - k : k, r = q >> 3, c = q & 7, p = s.b[q], sq = mk("div", "ch-sq " + ((r + c) & 1 ? "dk" : "lt")); sq.dataset.sq = q;
                    if (q === this.sel) sq.classList.add("sel"); if (tg.includes(q)) sq.classList.add(p === "." ? "tgt" : "cap"); if (fx && (fx.f === q || fx.t === q)) sq.classList.add("last"); if (q === ks) sq.classList.add("chk");
                    if (p !== ".") { const pc = mk("span", "pc " + (CHE.isW(p) ? "w" : "b"), GLYPH[p.toUpperCase()] + "\uFE0E"); pc.setAttribute("aria-label", p); sq.appendChild(pc); }
                    if ((k & 7) === 0) sq.appendChild(mk("i", "rk", String(8 - r))); if (k >> 3 === 7) sq.appendChild(mk("i", "fl", "abcdefgh"[c]));
                    b.appendChild(sq);
                }
                $("ch-promo").hidden = !this.pend;
            },
            controls() {
                const g = this.g, { who, my, live } = turnInfo(g); let m = "";
                if (g.phase === "done" && g.res) m = resText(g, "checkmate"); else if (my) m = g.chk ? "Check! Your move \u2014 protect your king." : "Your move \u2014 tap a piece, then a highlighted square."; else if (live) m = `${who} is thinking\u2026`;
                $("ch-status").textContent = m; $("ch-log").textContent = g.last || ""; this.common(my);
            },
            playFx() {
                const g = this.g, fx = g.fx; if (!fx || fx.id === this.lastFx) return; const late = this.lastFx === null; this.lastFx = fx.id;
                if ((late && Date.now() - fx.at > 4000) || CardFX.reduced() || Router.currentGameKey !== "chess") return;
                const b = $("ch-board"), flip = g.order[1] === State.username, sz = b.clientWidth / 8, d = (q) => (flip ? 63 - q : q);
                const glide = (from, to, z) => {
                    const e = b.querySelector(`[data-sq="${to}"] .pc`); if (!e) return; const a = d(from), c = d(to);
                    e.style.zIndex = z; e.animate([{ transform: `translate(${((a & 7) - (c & 7)) * sz}px,${((a >> 3) - (c >> 3)) * sz}px) scale(1.12)` }, { transform: "none" }], { duration: 420, easing: "cubic-bezier(.3,.7,.2,1)" }).onfinish = () => { e.style.zIndex = ""; };
                };
                glide(fx.f, fx.t, 6); if (fx.cs) glide(fx.cs > 0 ? fx.t + 1 : fx.t - 2, fx.t - fx.cs, 5);
                Sound.tone(fx.cap ? 170 : 420, fx.cap ? 170 : 60, fx.cap ? "sawtooth" : "triangle", 0.05); CardFX.until = performance.now() + 500;
            }
        });

        /* ------------------------------- CHINESE CHECKERS ------------------------------- */
        const CC = Duel({ key: "checkers", p: "cc", node: "checkers", label: "Chinese Checkers", max: 4, E: CCE, delay: 800 });
        const XY = CCE.CELLS.map(([x, , z]) => [x + z / 2, z * 0.8660254]), MX = [Math.min(...XY.map((a) => a[0])), Math.max(...XY.map((a) => a[0]))], MY = [Math.min(...XY.map((a) => a[1])), Math.max(...XY.map((a) => a[1]))];
        const cpos = (i) => [4 + ((XY[i][0] - MX[0]) / (MX[1] - MX[0])) * 92, 4 + ((XY[i][1] - MY[0]) / (MY[1] - MY[0])) * 92], cplace = (e, i) => { const [x, y] = cpos(i); e.style.left = x.toFixed(3) + "%"; e.style.top = y.toFixed(3) + "%"; };
        Object.assign(CC, {
            sel: null,
            onNew() { this.sel = null; },
            setup() {
                const b = $("cc-board"); b.style.aspectRatio = `${MX[1] - MX[0]} / ${MY[1] - MY[0]}`;
                CCE.CELLS.forEach((_, i) => { const h = mk("div", "cc-hole"); h.dataset.i = i; cplace(h, i); b.appendChild(h); });
                b.appendChild(mk("div", "cc-pcs")).id = "cc-pcs";
                b.addEventListener("click", (e) => {
                    const g = this.g, me = State.username, t = e.target.closest("[data-i]"); if (!t || g.phase !== "play" || g.order[g.turn] !== me) return; const i = +t.dataset.i;
                    if ((g.pc[me] || []).includes(i)) { this.sel = this.sel === i ? null : i; return this.view(); }
                    if (this.sel != null && t.classList.contains("hint")) { const f = this.sel; this.sel = null; this.act("move", { f, t: i }); }
                });
            },
            view() {
                const g = this.g, { me, order, who, my } = turnInfo(g), r = my && this.sel != null ? CCE.reach(g, this.sel) : {}, zone = {};
                strip({ p: "cc", o: g }, who, (u) => `${(g.pc[u] || []).filter((i) => CCE.CORNER[(g.cn[u] + 3) % 6].includes(i)).length}/10 home`);
                order.forEach((u, pi) => CCE.CORNER[g.cn[u]].forEach((i) => { zone[i] = pi; }));
                $("cc-board").querySelectorAll(".cc-hole").forEach((h, i) => { h.className = "cc-hole" + (zone[i] != null ? " z pk" + zone[i] : "") + (r[i] ? " hint" : ""); });
                const L = $("cc-pcs"); L.textContent = "";
                order.forEach((u, pi) => g.pc[u].forEach((i) => {
                    const e = mk("div", "cc-pc pk" + pi + (i === this.sel ? " sel" : "")); e.dataset.i = i; e.dataset.u = u; cplace(e, i);
                    if (u === me && my && g.phase === "play") { e.classList.add("ok"); e.setAttribute("role", "button"); e.tabIndex = 0; e.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); e.click(); } }); }
                    L.appendChild(e);
                }));
            },
            controls() {
                const g = this.g, { who, my, live } = turnInfo(g); let m = "";
                if (g.phase === "done" && g.res) m = resText(g, "all marbles home"); else if (my) m = this.sel == null ? "Your move \u2014 pick a marble, then a glowing hole. Chain jumps over any marble." : "Choose a glowing hole (steps or chained jumps)."; else if (live) m = `${who} is thinking\u2026`;
                $("cc-status").textContent = m; $("cc-log").textContent = g.last || ""; this.common(my);
            },
            playFx() {
                const g = this.g, fx = g.fx; if (!fx || fx.id === this.lastFx) return; const late = this.lastFx === null; this.lastFx = fx.id;
                if ((late && Date.now() - fx.at > 4000) || CardFX.reduced() || Router.currentGameKey !== "checkers") return;
                const e = $("cc-pcs").querySelector(`[data-i="${fx.path[fx.path.length - 1]}"]`); if (!e) return;
                const kf = fx.path.map((i, k) => { const [x, y] = cpos(i); return { left: x + "%", top: y + "%", transform: `translate(-50%,-50%) scale(${k && k < fx.path.length - 1 ? 1.25 : 1})` }; }), n = kf.length - 1;
                kf[n].left = e.style.left; kf[n].top = e.style.top; e.style.zIndex = "9";
                e.animate(kf, { duration: Math.max(300, 260 * n), easing: "ease-in-out" }).onfinish = () => { e.style.zIndex = ""; };
                fx.path.forEach((_, k) => { if (k) window.setTimeout(() => Sound.tone(380 + k * 40, 40, "triangle", 0.03), (260 * n / n) * k); }); CardFX.until = performance.now() + 260 * n + 100;
            }
        });

        /* --------------- CODE BREAKERS (shared UI): Color Code Breaker + Picas y Fijas --------------- */
        const codeUI = (G, cfg) => Object.assign(G, {
            cur: [],
            onNew() { this.cur = []; },
            setup() {
                const pal = $(cfg.p + "-pal");
                for (let v = 0; v < cfg.sym; v++) { const b = mk("button", cfg.kind === "col" ? `cd-peg c${v}` : "cd-key", cfg.kind === "col" ? "" : String(v)); b.type = "button"; b.dataset.v = v; b.setAttribute("aria-label", cfg.kind === "col" ? cfg.names[v] : "Digit " + v); b.addEventListener("click", () => this.push(v)); pal.appendChild(b); }
                $(cfg.p + "-back").addEventListener("click", () => { this.cur.pop(); this.cursor(); }); $(cfg.p + "-submit").addEventListener("click", () => { const c = this.cur.slice(); this.cur = []; this.act("guess", { c }); });
            },
            push(v) { const { my } = turnInfo(this.g); if (!my || this.cur.length >= cfg.len || (!cfg.dup && this.cur.includes(v))) return; this.cur.push(v); this.cursor(); },
            peg(v, cls) { return cfg.kind === "col" ? mk("span", `cd-peg sm c${v} ${cls || ""}`) : mk("span", "cd-dig " + (cls || ""), String(v)); },
            cursor() {
                const { my } = turnInfo(this.g), c = $(cfg.p + "-cur"); c.textContent = "";
                for (let i = 0; i < cfg.len; i++) { const s = this.cur[i] != null ? this.peg(this.cur[i], "fill") : mk("span", "cd-empty"); c.appendChild(s); }
                $(cfg.p + "-pal").querySelectorAll("button").forEach((b) => { b.disabled = !my || (!cfg.dup && this.cur.includes(+b.dataset.v)) || this.cur.length >= cfg.len; });
                $(cfg.p + "-submit").disabled = !my || this.cur.length !== cfg.len; $(cfg.p + "-back").disabled = !my || !this.cur.length; $(cfg.p + "-entry").hidden = !my;
            },
            view() {
                const g = this.g, { me, order, who } = turnInfo(g), fx = g.fx && g.fx.id !== this.lastFx && Date.now() - g.fx.at < 4000 ? g.fx : null, done = g.phase === "done", root = $(cfg.p + "-boards"); root.textContent = "";
                strip({ p: cfg.p, o: g }, who, (u) => `${(g.gs && g.gs[u] ? g.gs[u].length : 0)}/${cfg.tries} guesses`);
                (order.includes(me) ? [me].concat(order.filter((u) => u !== me)) : order).forEach((u) => {
                    const box = mk("div", "cd-board" + (u === me ? " mine" : "")), h = (g.gs && g.gs[u]) || [];
                    box.appendChild(mk("div", "bw-name", u === me ? "Your code attempts" : `${u}'s attempts`));
                    if (done && g.sec) { const r = mk("div", "cd-row secret"); r.appendChild(mk("span", "cd-n", "\u2605")); const s = mk("span", "cd-slots"); g.sec[u].forEach((v) => s.appendChild(this.peg(v, "fill"))); r.appendChild(s); r.appendChild(mk("span", "cd-fb", "secret")); box.appendChild(r); }
                    for (let i = 0; i < cfg.tries; i++) {
                        const x = h[i], row = mk("div", "cd-row" + (x ? " done" : "") + (fx && fx.u === u && fx.n === i ? " new" : "") + (x && x.e === cfg.len ? " cracked" : "")); row.appendChild(mk("span", "cd-n", String(i + 1)));
                        const s = mk("span", "cd-slots"); for (let k = 0; k < cfg.len; k++) s.appendChild(x ? this.peg(x.c[k], "fill") : mk("span", "cd-empty")); row.appendChild(s);
                        const pins = mk("span", "cd-pins"); for (let k = 0; k < cfg.len; k++) { const p = mk("i", x ? (k < x.e ? "k" : k < x.e + x.p ? "w" : "") : ""); p.style.animationDelay = k * 90 + "ms"; pins.appendChild(p); } row.appendChild(pins);
                        if (cfg.kind === "num") row.appendChild(mk("span", "cd-fb", x ? `${x.e}F \u00B7 ${x.p}P` : ""));
                        box.appendChild(row);
                    }
                    root.appendChild(box);
                });
                this.cursor();
            },
            controls() {
                const g = this.g, { who, my, live } = turnInfo(g); let m = "";
                if (g.phase === "done" && g.res) m = resText(g, "cracked the code"); else if (my) m = cfg.hint; else if (live) m = `${who} is thinking\u2026`;
                $(cfg.p + "-status").textContent = m; $(cfg.p + "-log").textContent = g.last || ""; this.common(my); this.cursor();
            },
            playFx() {
                const fx = this.g.fx; if (!fx || fx.id === this.lastFx) return; const late = this.lastFx === null; this.lastFx = fx.id;
                if ((late && Date.now() - fx.at > 4000) || CardFX.reduced()) return;
                Sound.tone(300 + fx.ex * 90, 90, "triangle", 0.04); if (fx.ex === cfg.len) window.setTimeout(() => Sound.win(), 150); CardFX.until = performance.now() + 400;
            }
        });
        const MM = codeUI(Duel({ key: "mastermind", p: "mm", node: "mastermind", label: "Color Code Breaker", max: 2, E: MME, delay: 1100 }), { p: "mm", kind: "col", len: 4, sym: 6, dup: true, tries: 10, names: ["Ruby", "Gold", "Emerald", "Sapphire", "Amethyst", "Silver"], hint: "Your turn \u2014 build a 4-colour code. Gold pin = right colour & place, silver pin = right colour, wrong place." });
        const BC = codeUI(Duel({ key: "bullscows", p: "bc", node: "bullscows", label: "Picas y Fijas", max: 2, E: BCE, delay: 1100 }), { p: "bc", kind: "num", len: 4, sym: 10, dup: false, tries: 10, hint: "Your turn \u2014 enter 4 different digits. Fija = right digit, right place. Pica = right digit, wrong place." });

        [CH, CC, MM, BC].forEach((G) => G.init());
        { const s0 = Social.start, s1 = Social.stop; Social.start = function () { s0.call(Social);[CH, CC, MM, BC].forEach((G) => G.start()); }; Social.stop = function () { s1.call(Social);[CH, CC, MM, BC].forEach((G) => G.stop()); }; }
        document.addEventListener("game-changed", (e) => { [["chess", CH], ["checkers", CC], ["mastermind", MM], ["bullscows", BC]].forEach(([k, G]) => { if (e.detail.gameKey !== k && G.local) G.start(); }); });
    })();

    /* =========================================================================
       MARBLE GRAVITY RACE — DETERMINISTIC PHYSICS CORE
       Every client (and the host's headless pre-run) executes this exact fixed-
       timestep simulation from the same {map, seed, racer count}. Only + - * /
       sqrt and floor are used (all bit-exact across engines) — no sin/cos/pow/
       hypot — so the marble that visibly crosses the line first IS the winner.
       ========================================================================= */
    const MarbleSim = (() => {
        const W = 480, H = 3400, FIN = 3270, DT = 1 / 120, MAXT = 7200, BR = 12, MAXR = 24, CELL = 64, COLS = 8, ROWS = 54;
        const TAU = 6.283185307179586, PI = 3.141592653589793, q = (x) => x * x;
        const rng = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
        const dsin = (x) => { x -= Math.floor(x / TAU) * TAU; if (x > PI) x -= TAU; const s = x * x; return x * (1 - s / 6 * (1 - s / 20 * (1 - s / 42 * (1 - s / 72 * (1 - s / 110 * (1 - s / 156)))))); };
        const dcos = (x) => dsin(x + PI / 2);
        const FX = { boost: 260, freeze: 150, slow: 360, giant: 480, shrink: 480 };
        const PU = {
            boost: { c: "#ff9f1c", d: "Speed boost for the collector" }, freeze: { c: "#7fd8ff", d: "Freezes the current leader" },
            slow: { c: "#7bd88f", d: "Slows the current leader" }, giant: { c: "#f5d27a", d: "Collector grows heavy and huge" },
            shrink: { c: "#c77dff", d: "Shrinks the current leader" }, catchup: { c: "#ff5d8f", d: "Rockets the last-place marble" }
        };

        const mkBuilder = (seed) => {
            const R = rng(seed), o = { R, pegs: [], bumps: [], segs: [], spins: [], bands: [] };
            o.peg = (x, y, r) => o.pegs.push({ x, y, r }); o.bump = (x, y, r) => o.bumps.push({ x, y, r });
            o.seg = (x1, y1, x2, y2) => o.segs.push({ x1, y1, x2, y2, a: Math.min(y1, y2) - 24, b: Math.max(y1, y2) + 24 });
            o.spin = (cx, cy, len, w, arms) => o.spins.push({ cx, cy, len, w, arms });
            o.band = (a, b) => o.bands.push([a, b]);
            o.grid = (y0, y1, sx, sy, r, jit, rv) => {
                let row = 0;
                for (let y = y0; y < y1; y += sy, row++) {
                    if (o.bands.some((b) => y > b[0] - 18 && y < b[1] + 18)) continue;
                    for (let x = (row % 2 ? sx : sx / 2); x < W - 10; x += sx) o.peg(x + (R() - 0.5) * (jit || 0), y + (R() - 0.5) * (jit || 0), r + (rv ? R() * rv : 0));
                }
            };
            return o;
        };

        const MAPS = {
            casino: {
                name: "Classic Casino", icon: "🎰", seed: 1101, g: 820, e: 0.55, bg: ["#0b1a12", "#1c0b0e"], peg: "#f5d27a", segc: "#c9a24a", spin: "#e0483e", bump: "#1e9b62", glow: false, deco: "chips",
                desc: "Chip pegs, golden funnels and spinning roulette blades.",
                pool: [["boost", "Hot Streak", "🔥"], ["freeze", "Cold Deck", "🧊"], ["giant", "High Roller", "💰"], ["catchup", "Lucky Seven", "🍀"], ["slow", "House Edge", "🏠"]],
                build(b) {
                    [720, 1500, 2280].forEach((y) => b.band(y - 10, y + 70));[1100, 1900, 2700].forEach((y) => b.band(y - 90, y + 90));
                    b.grid(240, 3080, 64, 66, 5, 4);
                    [720, 1500, 2280].forEach((y) => { b.seg(0, y, 185, y + 56); b.seg(W, y, 295, y + 56); });
                    [[1100, 240, 88], [1900, 140, 62], [1900, 340, 62], [2700, 240, 88]].forEach(([y, x, l], k) => b.spin(x, y, l, (k % 2 ? -1 : 1) * 1.7, 2));
                    [100, 240, 380].forEach((x) => b.bump(x, 2990, 17));
                }
            },
            cyber: {
                name: "Cyberpunk Neon", icon: "🌆", seed: 2202, g: 900, e: 0.6, bg: ["#07021a", "#001a24"], peg: "#39ffe0", segc: "#ff2fb3", spin: "#39ffe0", bump: "#a259ff", glow: true, deco: "grid",
                desc: "Laser rails zig-zag down a neon megacity with overclocked spinners.",
                pool: [["boost", "Overclock", "⚡"], ["freeze", "Stasis Field", "🧊"], ["slow", "Lag Spike", "📡"], ["shrink", "Nano Shrink", "🔬"], ["catchup", "Patch Update", "💾"]],
                build(b) {
                    b.grid(140, 280, 70, 50, 4, 0);
                    for (let k = 0, y = 300; y < 3050; y += 190, k++) {
                        if (k % 2 === 0) b.seg(0, y, W - 105, y + 62); else b.seg(W, y, 105, y + 62);
                        if (k % 3 === 1) b.spin(k % 2 ? 52 : 428, y + 132, 36, (k % 2 ? 1 : -1) * 3.2, 2);
                        if (k % 4 === 3) b.bump(k % 8 === 3 ? 60 : W - 60, y + 152, 13);
                    }
                    b.grid(3080, 3200, 80, 60, 5, 0);
                }
            },
            ruins: {
                name: "Ancient Ruins", icon: "🏛️", seed: 3303, g: 800, e: 0.5, bg: ["#241a0c", "#0f0a05"], peg: "#d9b46a", segc: "#a8875a", spin: "#c96f3b", bump: "#3aa6a0", glow: false, deco: "runes",
                desc: "Heavy stone pillars, crumbling ledges and slow temple blades.",
                pool: [["boost", "Tomb Wind", "🌪️"], ["freeze", "Curse of Stone", "🗿"], ["slow", "Sand Trap", "⏳"], ["giant", "Golden Idol", "🏺"], ["catchup", "Sun Blessing", "☀️"]],
                build(b) {
                    [900, 1650, 2400].forEach((y) => b.band(y - 10, y + 60));
                    b.grid(230, 3080, 100, 112, 15, 0);
                    [900, 1650, 2400].forEach((y) => { b.seg(0, y, 150, y + 46); b.seg(W, y, 330, y + 46); b.spin(240, y + 50, 48, 1.1, 2); });
                    [80, 400].forEach((x) => b.bump(x, 3000, 20));
                }
            },
            space: {
                name: "Space Galaxy", icon: "🪐", seed: 4404, g: 640, e: 0.7, bg: ["#050616", "#12062a"], peg: "#bcd0ff", segc: "#7d8cff", spin: "#ffd166", bump: "#ff7a59", glow: true, deco: "stars",
                desc: "Low gravity: asteroid fields, bouncy planets and orbiting satellites.",
                pool: [["boost", "Warp Drive", "🚀"], ["freeze", "Cryo Beam", "🛸"], ["slow", "Gravity Well", "🕳️"], ["shrink", "Shrink Ray", "🔭"], ["giant", "Supernova", "🌟"], ["catchup", "Nebula Assist", "🌌"]],
                build(b) {
                    const R = b.R, d2 = (x, y, c) => q(x - c.x) + q(y - c.y);
                    b.spin(240, 1000, 58, 1.9, 3); b.spin(140, 1900, 58, -1.9, 3); b.spin(350, 2700, 58, 1.9, 3);
                    const freeOf = (x, y, pad) => b.spins.every((s) => q(x - s.cx) + q(y - s.cy) > q(s.len + pad));
                    for (let i = 0; i < 9; i++) for (let t = 0; t < 40; t++) {
                        const x = 60 + R() * 360, y = 300 + i * 300 + R() * 120, r = 20 + R() * 10;
                        if (freeOf(x, y, r + 22) && b.bumps.every((p) => d2(x, y, p) > q(p.r + r + 80))) { b.bump(x, y, r); break; }
                    }
                    for (let t = 0; t < 320 && b.pegs.length < 118; t++) {
                        const x = 20 + R() * 440, y = 220 + R() * 2900, r = 4 + R() * 2;
                        if (freeOf(x, y, 24) && b.pegs.every((p) => d2(x, y, p) > 1936) && b.bumps.every((p) => d2(x, y, p) > q(p.r + 42))) b.peg(x, y, r);
                    }
                }
            },
            candy: {
                name: "Candy Land", icon: "🍭", seed: 5505, g: 780, e: 0.78, bg: ["#3a1236", "#1b0a2e"], peg: "#ff8fcf", segc: "#fff1a8", spin: "#5ee6c8", bump: "#ffb347", glow: false, deco: "sprinkles",
                desc: "Bouncy lollipops, candy-cane ramps and peppermint spinners.",
                pool: [["boost", "Sugar Rush", "🍬"], ["slow", "Gum Trap", "🫧"], ["giant", "Gummy Giant", "🧸"], ["shrink", "Sour Shrink", "🍋"], ["freeze", "Popsicle Freeze", "🍦"], ["catchup", "Sweet Comeback", "🍩"]],
                build(b) {
                    [800, 1700, 2600].forEach((y) => b.band(y - 10, y + 230));[1250, 2150].forEach((y) => b.band(y - 80, y + 80));
                    b.grid(230, 3080, 76, 80, 9, 6, 4);
                    [800, 1700, 2600].forEach((y) => { b.seg(0, y, 288, y + 72); b.seg(W, y + 150, 192, y + 222); });
                    b.spin(240, 1250, 52, 2.4, 3); b.spin(240, 2150, 52, -2.4, 3);
                }
            }
        };
        const MAP_IDS = Object.keys(MAPS);
        MAP_IDS.forEach((id) => { MAPS[id].icons = {}; MAPS[id].pool.forEach(([k, n, i]) => { MAPS[id].icons[k] = { n, i }; }); });

        const geoCache = {};
        const geo = (id) => {
            if (geoCache[id]) return geoCache[id];
            const b = mkBuilder(MAPS[id].seed); MAPS[id].build(b);
            const circles = [];
            b.pegs.forEach((p) => circles.push({ x: p.x, y: p.y, r: p.r, k: 0, id: circles.length }));
            b.bumps.forEach((p) => circles.push({ x: p.x, y: p.y, r: p.r, k: 1, id: circles.length }));
            const grid = Array.from({ length: COLS * ROWS }, () => []);
            circles.forEach((c) => grid[Math.min(ROWS - 1, Math.max(0, (c.y / CELL) | 0)) * COLS + Math.min(COLS - 1, Math.max(0, (c.x / CELL) | 0))].push(c));
            return (geoCache[id] = { circles, grid, segs: b.segs, spins: b.spins });
        };

        const segD2 = (x, y, s) => { const ex = s.x2 - s.x1, ey = s.y2 - s.y1; let u = ((x - s.x1) * ex + (y - s.y1) * ey) / (ex * ex + ey * ey); u = u < 0 ? 0 : u > 1 ? 1 : u; return q(x - s.x1 - ex * u) + q(y - s.y1 - ey * u); };

        class Sim {
            constructor(cfg) {
                const M = this.M = MAPS[cfg.map], G = this.G = geo(cfg.map), R = this.R = rng(cfg.seed >>> 0), n = this.n = cfg.racers.length;
                this.count = Math.min(cfg.count || 1, n); this.t = 0; this.doneT = -1; this.done = false; this.order = []; this.events = [];
                this.sa = G.spins.map(() => 0); this.tips = G.spins.map((s) => new Array(s.arms * 2).fill(0)); this.hit = new Int32Array(G.circles.length).fill(-99999);
                const slots = []; for (let i = 0; i < n; i++) slots.push(i);
                for (let i = n - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)), t = slots[i]; slots[i] = slots[j]; slots[j] = t; }
                const rows = n <= 14 ? 1 : 2, cols = Math.ceil(n / rows);
                this.marbles = new Array(n);
                slots.forEach((who, k) => {
                    const col = Math.floor(k / rows), ri = k % rows;
                    this.marbles[who] = { i: who, x: 36 + (W - 72) * ((col + 0.5 * ri + 0.25) / cols) + (R() - 0.5) * 3, y: 44 + ri * 28, vx: (R() - 0.5) * 40, vy: 0, r: BR, fin: -1, ft: 0, bt: 0, st: 0, gt: 0, sh: 0, still: 0 };
                });
                this.pups = [];
                const pool = M.pool, cnt = 16, clear = (x, y) => G.circles.every((c) => q(x - c.x) + q(y - c.y) > q(c.r + 28)) && G.segs.every((s) => segD2(x, y, s) > 900) && G.spins.every((s) => q(x - s.cx) + q(y - s.cy) > q(s.len + 34));
                for (let k = 0; k < cnt; k++) {
                    const y0 = 330 + k * (2650 / cnt);
                    for (let tr = 0; tr < 30; tr++) { const x = 40 + R() * 400, y = y0 + R() * 120; if (clear(x, y)) { this.pups.push({ x, y, kind: pool[Math.floor(R() * pool.length)][0], got: -1 }); break; } }
                }
            }

            col(m, x1, y1, x2, y2, th, w, ox, oy, e) {
                const ex = x2 - x1, ey = y2 - y1; let u = ((m.x - x1) * ex + (m.y - y1) * ey) / (ex * ex + ey * ey); u = u < 0 ? 0 : u > 1 ? 1 : u;
                const px = x1 + ex * u, py = y1 + ey * u, dx = m.x - px, dy = m.y - py, rr = m.r + th, d2 = dx * dx + dy * dy;
                if (d2 >= rr * rr) return;
                const d = Math.sqrt(d2) || 1e-4, nx = dx / d, ny = dy / d; m.x = px + nx * rr; m.y = py + ny * rr;
                const vn = (m.vx + w * (py - oy)) * nx + (m.vy - w * (px - ox)) * ny;
                if (vn < 0) { m.vx -= (1 + e) * vn * nx; m.vy -= (1 + e) * vn * ny; }
            }

            /** Effect application. Leader/last are evaluated on live positions at this exact step. */
            apply(kind, m) {
                let lead = null, last = null;
                for (const o of this.marbles) { if (o.fin >= 0) continue; if (o !== m && (!lead || o.y > lead.y)) lead = o; if (!last || o.y < last.y) last = o; }
                let tgt = m;
                if (kind === "boost") { m.bt = FX.boost; m.vy += 200; }
                else if (kind === "giant") m.gt = FX.giant;
                else if (kind === "freeze" && lead) { lead.ft = FX.freeze; tgt = lead; }
                else if (kind === "slow" && lead) { lead.st = FX.slow; tgt = lead; }
                else if (kind === "shrink" && lead) { lead.sh = FX.shrink; tgt = lead; }
                else if (kind === "catchup" && last) { last.bt = FX.boost; last.vy += 240; tgt = last; }
                this.events.push({ k: "pu", t: this.t, kind, who: m.i, tgt: tgt.i });
            }

            step() {
                const t = ++this.t, M = this.M, G = this.G, e = M.e, ms = this.marbles, n = this.n, crossers = [];
                for (let s = 0; s < G.spins.length; s++) {
                    const sp = G.spins[s], a = (this.sa[s] += sp.w * DT);
                    for (let k = 0; k < sp.arms; k++) { const an = a + k * TAU / sp.arms; this.tips[s][k * 2] = sp.cx + sp.len * dcos(an); this.tips[s][k * 2 + 1] = sp.cy + sp.len * dsin(an); }
                }
                for (let i = 0; i < n; i++) {
                    const m = ms[i], tr = BR * (m.gt > 0 ? 1.55 : 1) * (m.sh > 0 ? 0.62 : 1);
                    m.r += (tr - m.r) * 0.12;
                    if (m.ft > 0) { m.ft--; m.vx = 0; m.vy = 0; continue; }
                    if (m.bt > 0) m.bt--; if (m.st > 0) m.st--; if (m.gt > 0) m.gt--; if (m.sh > 0) m.sh--;
                    m.vy += (M.g * (m.bt > 0 ? 1.6 : 1) * (m.st > 0 ? 0.45 : 1) + (m.bt > 0 ? 260 : 0)) * DT;
                    if (m.st > 0) { m.vx *= 0.992; m.vy *= 0.992; }
                    if (m.vy > 820) m.vy = 820; if (m.vx > 620) m.vx = 620; else if (m.vx < -620) m.vx = -620;
                    const py = m.y; m.x += m.vx * DT; m.y += m.vy * DT;
                    if (m.fin < 0 && m.y >= FIN) { const f = (FIN - py) / (m.y - py); m.fin = t - 1 + (f < 0 ? 0 : f > 1 ? 1 : f); crossers.push(m); }
                    if (m.x < m.r) { m.x = m.r; m.vx = -m.vx * e; } else if (m.x > W - m.r) { m.x = W - m.r; m.vx = -m.vx * e; }
                    if (m.y > H - m.r) { m.y = H - m.r; m.vy = -m.vy * 0.3; m.vx *= 0.97; }
                    const cx = Math.min(COLS - 1, Math.max(0, (m.x / CELL) | 0)), cy = Math.min(ROWS - 1, Math.max(0, (m.y / CELL) | 0));
                    for (let gy = cy - 1; gy <= cy + 1; gy++) {
                        if (gy < 0 || gy >= ROWS) continue;
                        for (let gx = cx - 1; gx <= cx + 1; gx++) {
                            if (gx < 0 || gx >= COLS) continue;
                            const cell = G.grid[gy * COLS + gx];
                            for (let k = 0; k < cell.length; k++) {
                                const c = cell[k], dx = m.x - c.x, dy = m.y - c.y, rr = m.r + c.r, d2 = dx * dx + dy * dy;
                                if (d2 >= rr * rr) continue;
                                const d = Math.sqrt(d2) || 1e-4, nx = dx / d, ny = dy / d; m.x = c.x + nx * rr; m.y = c.y + ny * rr;
                                const vn = m.vx * nx + m.vy * ny;
                                if (vn < 0) { const b = c.k ? 1.95 : 1 + e; m.vx -= b * vn * nx; m.vy -= b * vn * ny; if (c.k) { m.vx += nx * 70; m.vy += ny * 70; } this.hit[c.id] = t; }
                            }
                        }
                    }
                    for (let s = 0; s < G.segs.length; s++) { const g = G.segs[s]; if (m.y < g.a || m.y > g.b) continue; this.col(m, g.x1, g.y1, g.x2, g.y2, 4, 0, 0, 0, e); }
                    for (let s = 0; s < G.spins.length; s++) {
                        const sp = G.spins[s]; if (Math.abs(m.y - sp.cy) > sp.len + m.r + 8) continue;
                        for (let k = 0; k < sp.arms; k++) this.col(m, sp.cx, sp.cy, this.tips[s][k * 2], this.tips[s][k * 2 + 1], 4, sp.w, sp.cx, sp.cy, e);
                    }
                    if (m.vx * m.vx + m.vy * m.vy < 36) { if (++m.still > 80) { m.vx += (this.R() - 0.5) * 300; m.vy -= 60; m.still = 0; } } else m.still = 0;
                }
                for (let i = 0; i < n; i++) {
                    const a = ms[i];
                    for (let j = i + 1; j < n; j++) {
                        const b = ms[j], dy = b.y - a.y, rr = a.r + b.r; if (dy > rr || dy < -rr) continue;
                        const dx = b.x - a.x; if (dx > rr || dx < -rr) continue;
                        const d2 = dx * dx + dy * dy; if (d2 >= rr * rr) continue;
                        const d = Math.sqrt(d2) || 1e-4, nx = dx / d, ny = dy / d, ov = rr - d;
                        const ma = a.r * a.r * (a.ft > 0 ? 1e4 : 1), mb = b.r * b.r * (b.ft > 0 ? 1e4 : 1), ia = 1 / ma, ib = 1 / mb, is = ia + ib;
                        a.x -= nx * ov * ia / is; a.y -= ny * ov * ia / is; b.x += nx * ov * ib / is; b.y += ny * ov * ib / is;
                        const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
                        if (rv < 0) { const imp = -1.55 * rv / is; a.vx -= imp * nx * ia; a.vy -= imp * ny * ia; b.vx += imp * nx * ib; b.vy += imp * ny * ib; }
                    }
                }
                for (let p = 0; p < this.pups.length; p++) {
                    const u = this.pups[p]; if (u.got >= 0) continue;
                    for (let i = 0; i < n; i++) { const m = ms[i]; if (m.fin >= 0 || m.y < u.y - 40 || m.y > u.y + 40) continue; if (q(m.x - u.x) + q(m.y - u.y) < q(m.r + 12)) { u.got = t; this.apply(u.kind, m); break; } }
                }
                if (crossers.length) {
                    crossers.sort((a, b) => a.fin - b.fin || a.i - b.i);
                    crossers.forEach((m) => { this.events.push({ k: "fin", t, i: m.i, rank: this.order.length }); this.order.push(m.i); });
                }
                if (!this.done && (this.order.length >= this.count || t >= MAXT)) {
                    if (this.order.length < this.count) {
                        ms.filter((m) => m.fin < 0).sort((a, b) => b.y - a.y || a.i - b.i).forEach((m) => { if (this.order.length < this.count) this.order.push(m.i); });
                    }
                    this.done = true; this.doneT = t;
                }
            }
            static run(cfg) { const s = new Sim(cfg); while (!s.done) s.step(); return s.order.slice(); }
        }
        return { Sim, MAPS, MAP_IDS, PU, geo, W, H, FIN, DT, BR, MAXR };
    })();

    /* =========================================================================
       MARBLE GRAVITY RACE — LIVE RENDERER, FIREBASE SYNC, MAP PICKER, HOST FATE
       Host publishes {map, seed, racers, startAt} to rooms/{code}/marble/current.
       Every device replays the identical deterministic simulation against the
       shared server clock, so all screens show the same race, frame for frame.
       ========================================================================= */
    const MarbleRace = (() => {
        const { Sim, MAPS, MAP_IDS, PU, geo, W, H, FIN, DT, BR, MAXR } = MarbleSim;
        const st = { off: 0, ref: null, offRef: null, cb: null, timer: null, lastId: null, pending: null, mapSel: "random", rigOn: false, rigTarget: "", imgs: new Map(), deco: {} };
        const now = () => Date.now() + st.off;
        const $ = (id) => document.getElementById(id);
        /** "Duvan Steven" -> "Duvan": keep only the first word, hard-cap very long single words. */
        const label = (name) => { const f = String(name || "").trim().split(/\s+/)[0] || "?"; return f.length > 10 ? f.slice(0, 9) + "\u2026" : f; };
        const hue = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = (Math.imul(h, 33) + s.charCodeAt(i)) | 0; return (h >>> 0) % 360; };
        const isUrl = (s) => /^(https?:|data:image)/.test(s || "");
        const img = (src) => { let i = st.imgs.get(src); if (!i) { i = new Image(); i.src = src; st.imgs.set(src, i); } return i; };
        const EMOJI = '"Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';

        const decoFor = (id) => {
            if (st.deco[id]) return st.deco[id];
            let a = MAPS[id].seed * 7 + 1; const r = () => { a = (a * 16807) % 2147483647; return a / 2147483647; };
            return (st.deco[id] = Array.from({ length: 170 }, () => ({ x: r() * W, y: r() * H, s: 0.5 + r(), k: Math.floor(r() * 6), p: r() * 6.28 })));
        };

        const drawDeco = (ctx, M, cam, vh, tm) => {
            const d = decoFor(M.id);
            ctx.save();
            if (M.deco === "grid") {
                ctx.strokeStyle = "rgba(57,255,224,.07)"; ctx.lineWidth = 1; ctx.beginPath();
                for (let x = 0; x <= W; x += 60) { ctx.moveTo(x, cam); ctx.lineTo(x, cam + vh); }
                for (let y = Math.floor(cam / 60) * 60; y < cam + vh; y += 60) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
                ctx.stroke();
            }
            d.forEach((o) => {
                if (o.y < cam - 30 || o.y > cam + vh + 30) return;
                if (M.deco === "chips") { ctx.strokeStyle = o.k % 2 ? "rgba(224,72,62,.10)" : "rgba(245,210,122,.09)"; ctx.lineWidth = 3; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.arc(o.x, o.y, 8 + o.s * 12, 0, 6.283); ctx.stroke(); ctx.setLineDash([]); }
                else if (M.deco === "stars") { ctx.fillStyle = `rgba(255,255,255,${0.25 + 0.35 * Math.abs(Math.sin(tm / 700 + o.p))})`; ctx.beginPath(); ctx.arc(o.x, o.y, o.s * 1.4, 0, 6.283); ctx.fill(); }
                else if (M.deco === "runes") { ctx.fillStyle = "rgba(217,180,106,.10)"; ctx.font = `${16 + o.s * 14}px serif`; ctx.fillText("☥☽△◇✦⚱"[o.k], o.x, o.y); }
                else if (M.deco === "sprinkles") { ctx.save(); ctx.translate(o.x, o.y); ctx.rotate(o.p); ctx.fillStyle = ["#ff8fcf", "#fff1a8", "#5ee6c8", "#ffb347", "#a5b4ff", "#ff6b6b"][o.k]; ctx.globalAlpha = 0.16; ctx.fillRect(-7 * o.s, -2, 14 * o.s, 4); ctx.restore(); }
                else if (M.deco === "grid") { ctx.fillStyle = o.k % 2 ? "rgba(255,47,179,.07)" : "rgba(57,255,224,.06)"; ctx.fillRect(o.x, o.y, 4 + o.s * 10, 22 + o.s * 30); }
            });
            ctx.restore();
        };

        const drawMarble = (ctx, m, R, hu, name, icon, rot, sc, crown) => {
            const r = m.r, x = m.x, y = m.y;
            ctx.save();
            if (m.bt > 0 || m.gt > 0 || m.st > 0 || m.sh > 0 || m.ft > 0) { ctx.shadowBlur = 16; ctx.shadowColor = m.ft > 0 ? "#7fd8ff" : m.bt > 0 ? "#ff9f1c" : m.gt > 0 ? "#f5d27a" : m.st > 0 ? "#7bd88f" : "#c77dff"; }
            const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.15, x, y, r);
            g.addColorStop(0, `hsl(${hu},80%,72%)`); g.addColorStop(1, `hsl(${hu},70%,32%)`);
            ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.fill(); ctx.shadowBlur = 0;
            ctx.strokeStyle = "rgba(255,255,255,.55)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, r - 1.5, rot, rot + 1.2); ctx.stroke();
            ctx.strokeStyle = "#e8c97a"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.stroke();
            ctx.fillStyle = "rgba(255,255,255,.22)"; ctx.beginPath(); ctx.arc(x, y, r * 0.66, 0, 6.283); ctx.fill();
            ctx.textAlign = "center"; ctx.textBaseline = "middle";
            if (isUrl(icon) && img(icon).complete && img(icon).naturalWidth) { ctx.save(); ctx.beginPath(); ctx.arc(x, y, r * 0.66, 0, 6.283); ctx.clip(); ctx.drawImage(img(icon), x - r * 0.66, y - r * 0.66, r * 1.32, r * 1.32); ctx.restore(); }
            else if (icon && !isUrl(icon)) { ctx.font = `${r * 1.05}px ${EMOJI}`; ctx.fillText(icon, x, y + r * 0.06); }
            else { ctx.fillStyle = "#fff"; ctx.font = `700 ${r * 0.85}px sans-serif`; ctx.fillText(name.slice(0, 2).toUpperCase(), x, y + 1); }
            if (m.ft > 0) { ctx.fillStyle = "rgba(160,225,255,.5)"; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.fill(); ctx.font = `${r}px ${EMOJI}`; ctx.fillText("❄️", x, y); }
            const fs = 11 / sc; ctx.font = `700 ${fs}px "Segoe UI",Arial,sans-serif`;
            const tw = ctx.measureText(name).width + 8 / sc, ly = y - r - 9 / sc;
            ctx.fillStyle = "rgba(8,8,10,.72)"; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x - tw / 2, ly - fs * 0.7, tw, fs * 1.4, fs * 0.7) : ctx.rect(x - tw / 2, ly - fs * 0.7, tw, fs * 1.4); ctx.fill();
            ctx.fillStyle = crown ? "#ffe08a" : "#f3e3b0"; ctx.fillText(name, x, ly + 0.5);
            if (crown) { ctx.font = `${13 / sc}px ${EMOJI}`; ctx.fillText("👑", x, ly - fs * 1.15); }
            ctx.restore();
        };

        /* ------------------------------ the race ------------------------------ */
        const race = async (cfg, id) => {
            const Lk = LuckyDraw, M = MAPS[cfg.map]; M.id = cfg.map;
            const G = geo(cfg.map), sim = new Sim(cfg), { ctx, w, h } = Lk.makeCanvas(560), sc = w / W, vh = h / sc;
            const names = cfg.racers.map((r) => label(r.n)), hues = cfg.racers.map((r) => hue(r.n)), rot = new Float32Array(sim.n), parts = [];
            const MEDAL = ["🥇", "🥈", "🥉", "🏅", "🏅", "🏅"];
            let cam = 0, evp = 0, banner = null, ticker = null, lastT = 0;
            const burst = (x, y, n, c, sp) => { for (let i = 0; i < n; i++) { const a = Math.random() * 6.283, v = (sp || 120) * (0.3 + Math.random()); parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 40, l: 1, c }); } };
            await Lk.frames(id, (dt, el) => {
                const tgt = Math.floor((now() - cfg.startAt) / (DT * 1000)); let steps = 0;
                while (sim.t < tgt && steps < 600 && !(sim.done && sim.t - sim.doneT > 300)) { sim.step(); steps++; }
                while (evp < sim.events.length) {
                    const ev = sim.events[evp++];
                    if (ev.k === "fin") {
                        if (ev.rank < sim.count) { Lk.announce(cfg.racers[ev.i].n, ev.rank); banner = { txt: `${MEDAL[ev.rank]} ${names[ev.i]}`, t: el }; }
                        burst(sim.marbles[ev.i].x, FIN, 26, "#f5d27a", 220);
                    } else {
                        const info = M.icons[ev.kind], mk = sim.marbles[ev.tgt];
                        ticker = { txt: `${info.i} ${info.n}! ${names[ev.who]}${ev.tgt !== ev.who ? " → " + names[ev.tgt] : ""}`, t: el, c: PU[ev.kind].c };
                        burst(mk.x, mk.y, 14, PU[ev.kind].c, 150);
                    }
                }
                let ly = 0; sim.marbles.forEach((m, i) => { if (m.y > ly) ly = m.y; rot[i] += m.vx * 0.016 / m.r; });
                const want = tgt < 0 ? 0 : Math.max(0, Math.min(H - vh, ly - vh * 0.42));
                cam += (want - cam) * (steps > 30 ? 1 : 0.14);
                const tm = performance.now();
                ctx.clearRect(0, 0, w, h); ctx.save(); ctx.scale(sc, sc); ctx.translate(0, -cam);
                const bg = ctx.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, M.bg[0]); bg.addColorStop(1, M.bg[1]);
                ctx.fillStyle = bg; ctx.fillRect(0, cam - 1, W, vh + 2);
                drawDeco(ctx, M, cam, vh, tm);
                ctx.strokeStyle = "rgba(232,201,122,.55)"; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(1, cam); ctx.lineTo(1, cam + vh); ctx.moveTo(W - 1, cam); ctx.lineTo(W - 1, cam + vh); ctx.stroke();
                ctx.font = '700 13px "Segoe UI",sans-serif'; ctx.textAlign = "center"; ctx.fillStyle = "rgba(232,201,122,.35)"; ctx.fillText(`${M.icon}  ${M.name.toUpperCase()}  ${M.icon}`, W / 2, 20);
                if (cam + vh > FIN - 10) { for (let i = 0; i < 24; i++) for (let j = 0; j < 2; j++) { ctx.fillStyle = (i + j) % 2 ? "#f5f0e0" : "#111"; ctx.fillRect(i * 20, FIN + j * 10, 20, 10); } ctx.fillStyle = "#f5d27a"; ctx.font = '700 20px "Palatino Linotype",Georgia,serif'; ctx.fillText("FINISH", W / 2, FIN + 44); }
                ctx.lineCap = "round"; if (M.glow) { ctx.shadowColor = M.segc; ctx.shadowBlur = 9; }
                ctx.strokeStyle = M.segc; ctx.lineWidth = 8; G.segs.forEach((s) => { if (s.b < cam || s.a > cam + vh) return; ctx.beginPath(); ctx.moveTo(s.x1, s.y1); ctx.lineTo(s.x2, s.y2); ctx.stroke(); });
                ctx.shadowColor = M.spin; ctx.strokeStyle = M.spin; ctx.lineWidth = 9;
                G.spins.forEach((sp, s) => { if (sp.cy + sp.len < cam || sp.cy - sp.len > cam + vh) return; ctx.beginPath(); for (let k = 0; k < sp.arms; k++) { ctx.moveTo(sp.cx, sp.cy); ctx.lineTo(sim.tips[s][k * 2] || sp.cx, sim.tips[s][k * 2 + 1] || sp.cy); } ctx.stroke(); ctx.fillStyle = "#e8c97a"; ctx.beginPath(); ctx.arc(sp.cx, sp.cy, 8, 0, 6.283); ctx.fill(); });
                ctx.shadowBlur = 0;
                G.circles.forEach((c) => {
                    if (c.y < cam - 40 || c.y > cam + vh + 40) return;
                    const flash = sim.t - sim.hit[c.id] < 14;
                    if (sim.hit[c.id] > lastT) burst(c.x, c.y, c.k ? 6 : 2, c.k ? M.bump : "#fff", 90);
                    if (c.k) { const g = ctx.createRadialGradient(c.x - c.r * 0.3, c.y - c.r * 0.3, 2, c.x, c.y, c.r); g.addColorStop(0, "#fff"); g.addColorStop(0.25, M.bump); g.addColorStop(1, "rgba(0,0,0,.6)"); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(c.x, c.y, c.r + (flash ? 3 : 0), 0, 6.283); ctx.fill(); ctx.strokeStyle = "#e8c97a"; ctx.lineWidth = 2; ctx.stroke(); }
                    else { ctx.fillStyle = flash ? "#fff" : M.peg; ctx.beginPath(); ctx.arc(c.x, c.y, c.r + (flash ? 1.5 : 0), 0, 6.283); ctx.fill(); ctx.strokeStyle = "rgba(0,0,0,.4)"; ctx.lineWidth = 1; ctx.stroke(); }
                });
                lastT = sim.t;
                sim.pups.forEach((u) => {
                    if (u.got >= 0 || u.y < cam - 30 || u.y > cam + vh + 30) return;
                    const bob = Math.sin(tm / 300 + u.x) * 2.5, pc = PU[u.kind].c;
                    ctx.fillStyle = pc + "44"; ctx.strokeStyle = pc; ctx.lineWidth = 2; ctx.shadowColor = pc; ctx.shadowBlur = 12; ctx.beginPath(); ctx.arc(u.x, u.y + bob, 13, 0, 6.283); ctx.fill(); ctx.stroke(); ctx.shadowBlur = 0;
                    ctx.font = `15px ${EMOJI}`; ctx.fillStyle = "#fff"; ctx.textBaseline = "middle"; ctx.fillText(M.icons[u.kind].i, u.x, u.y + bob + 1);
                });
                const rank = sim.marbles.slice().sort((a, b) => (a.fin >= 0 ? a.fin : 1e6 - a.y) - (b.fin >= 0 ? b.fin : 1e6 - b.y));
                sim.marbles.slice().sort((a, b) => a.y - b.y).forEach((m) => drawMarble(ctx, m, m.r, hues[m.i], names[m.i], cfg.racers[m.i].a || "", rot[m.i], sc, tgt >= 0 && rank[0] === m && m.fin < 0));
                for (let i = parts.length - 1; i >= 0; i--) { const p = parts[i]; p.l -= dt / 700; if (p.l <= 0) { parts.splice(i, 1); continue; } p.vy += 380 * dt / 1000; p.x += p.vx * dt / 1000; p.y += p.vy * dt / 1000; ctx.globalAlpha = p.l; ctx.fillStyle = p.c; ctx.fillRect(p.x - 2, p.y - 2, 4, 4); }
                ctx.globalAlpha = 1; ctx.restore();
                /* HUD (screen space) */
                ctx.textBaseline = "middle"; ctx.textAlign = "left"; ctx.font = '700 11px "Segoe UI",sans-serif';
                rank.slice(0, 3).forEach((m, k) => { ctx.fillStyle = "rgba(8,8,10,.62)"; ctx.fillRect(6, 6 + k * 18, 96, 16); ctx.fillStyle = "#e8c97a"; ctx.fillText(`${MEDAL[k]} ${names[m.i]}`, 10, 14 + k * 18, 88); });
                ctx.fillStyle = "rgba(232,201,122,.25)"; ctx.fillRect(w - 9, 12, 4, h - 24);
                sim.marbles.forEach((m) => { ctx.fillStyle = `hsl(${hues[m.i]},80%,60%)`; ctx.beginPath(); ctx.arc(w - 7, 12 + (h - 24) * Math.min(1, m.y / FIN), 3, 0, 6.283); ctx.fill(); });
                ctx.textAlign = "center";
                if (ticker && el - ticker.t < 2600) { ctx.globalAlpha = Math.min(1, (2600 - (el - ticker.t)) / 600); ctx.fillStyle = "rgba(8,8,10,.75)"; ctx.fillRect(w / 2 - 110, h - 40, 220, 24); ctx.fillStyle = ticker.c; ctx.font = '700 12px "Segoe UI",sans-serif'; ctx.fillText(ticker.txt, w / 2, h - 27, 210); ctx.globalAlpha = 1; }
                if (banner && el - banner.t < 2600) { ctx.globalAlpha = Math.min(1, (2600 - (el - banner.t)) / 500); ctx.font = '700 26px "Palatino Linotype",Georgia,serif'; ctx.fillStyle = "rgba(8,8,10,.7)"; ctx.fillRect(0, h / 2 - 28, w, 56); ctx.fillStyle = "#f5d27a"; ctx.fillText(banner.txt, w / 2, h / 2, w - 20); ctx.globalAlpha = 1; }
                if (tgt < 0 || tgt < 90) { const s = Math.ceil(-tgt * DT); ctx.fillStyle = "rgba(0,0,0,.35)"; ctx.fillRect(0, 0, w, h); ctx.fillStyle = "#f5d27a"; ctx.font = '700 84px "Palatino Linotype",Georgia,serif'; ctx.fillText(tgt < 0 ? (s > 3 ? "READY" : String(s)) : "GO!", w / 2, h / 2, w - 20); if (tgt < 0 && s > 3) { ctx.font = '600 14px "Segoe UI",sans-serif'; ctx.fillText(`${M.icon} ${M.name}`, w / 2, h / 2 + 52); } }
                return (sim.done && sim.t - sim.doneT > 300) || el > 140000;
            });
            return cfg.w && cfg.w.length ? cfg.w : sim.order.slice(0, sim.count).map((i) => cfg.racers[i].n);
        };

        const play = async (cfg) => {
            const Lk = LuckyDraw; Lk.runId += 1; const id = Lk.runId;
            Lk.running = true; Lk.mode = "marble"; Lk.syncButtons(); Lk.setBusy(true); api.syncPanel();
            Lk.el.podium.replaceChildren(); Lk.el.result.textContent = "";
            try {
                const winners = await race(cfg, id);
                Lk.logDraw(winners); Lk.settleDraw(winners, cfg.racers.map((x) => x.n), cfg.id, State.isHost ? (Number(cfg.prize) || 0) : 0); Lk.el.result.textContent = `\u{1F389} ${winners.length === 1 ? "Winner" : "Winners"}: ${winners.join(", ")}`; Sound.jackpot();
            } catch (err) { if (err !== Lk.CANCEL) { console.error(err); Notify.error("The marble race was interrupted."); } }
            finally { if (id === Lk.runId) { Lk.running = false; Lk.setBusy(false); Lk.updateInfo(); } }
        };

        /** Rig = honest seed selection: physics stays untouched, we just pick a start seed that produces the wanted winner. */
        const findSeed = async (cfg, target) => {
            let best = cfg.seed, bestPos = 1e9, yieldAt = performance.now() + 30;
            for (let k = 0; k < 400; k++) {
                const seed = (cfg.seed + Math.imul(k, 2654435761)) >>> 0, pos = Sim.run({ ...cfg, seed }).indexOf(target);
                if (pos === 0) return seed;
                if (pos > 0 && pos < bestPos) { bestPos = pos; best = seed; }
                if (performance.now() > yieldAt) { await new Promise((r) => setTimeout(r)); yieldAt = performance.now() + 30; }
            }
            return best;
        };

        const api = {
            async hostStart() {
                const Lk = LuckyDraw;
                if (!State.isHost) { Notify.warning("Only the host can launch the marble race \u2014 it will play live on your screen."); return; }
                if (!Room.db || !Room.code) { Notify.error("Not connected to a room."); return; }
                const names = Lk.names();
                if (names.length < 2) { Notify.warning("The marble race needs at least 2 players in the room."); return; }
                Lk.running = true; Lk.setBusy(true); Lk.el.result.textContent = "\u{1F52E} Preparing the track\u2026";
                try {
                    const map = st.mapSel === "random" ? MAP_IDS[Math.floor(Math.random() * MAP_IDS.length)] : st.mapSel;
                    const target = (Rig.on && names.includes(Rig.target)) ? Rig.target : null;
                    let pool = Lk.shuffle(names);
                    if (pool.length > MAXR) { pool = pool.slice(0, MAXR); if (target && !pool.includes(target)) pool[0] = target; pool = Lk.shuffle(pool); }
                    const racers = pool.map((n) => ({ n, a: Cosmetics.icon(n, "avatar") || "" }));
                    const cfg = { id: Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36), map, count: Math.min(Lk.count, racers.length), racers, seed: Math.floor(Math.random() * 4294967296) >>> 0 };
                    cfg.prize = GameResolver.readPrize("draw-prize", !!target);
                    if (target) cfg.seed = await findSeed(cfg, pool.indexOf(target));
                    cfg.w = Sim.run(cfg).slice(0, cfg.count).map((i) => racers[i].n);
                    cfg.startAt = now() + 5500;
                    Lk.running = false; Lk.setBusy(false); Lk.el.result.textContent = "";
                    await Room.db.ref(`rooms/${Room.code}/marble/current`).set(cfg);
                } catch (err) { console.error(err); Lk.running = false; Lk.setBusy(false); Lk.el.result.textContent = ""; Notify.error("Could not start the marble race."); }
            },

            onCfg(cfg) {
                if (!cfg || !cfg.id || !cfg.racers || cfg.id === st.lastId) return;
                st.lastId = cfg.id;
                if (now() - cfg.startAt > 100000) return;
                st.pending = cfg; this.adopt(true);
            },
            adopt(toast) {
                const c = st.pending; if (!c) return;
                if (now() > c.startAt + 95000) { st.pending = null; return; }
                if (Router.currentGameKey === "draw") { st.pending = null; play(c); }
                else if (toast) Notify.success("\u{1F52E} Marble race starting! Open Random Selection Tools \u2192 Marble Gravity Race to watch live.");
            },
            start() {
                if (!Room.db || !Room.code) return;
                this.stop(); st.lastId = null;
                st.offRef = Room.db.ref(".info/serverTimeOffset"); st.offRef.on("value", (s) => { st.off = s.val() || 0; });
                st.ref = Room.db.ref(`rooms/${Room.code}/marble/current`); st.cb = (s) => this.onCfg(s.val()); st.ref.on("value", st.cb);
                st.timer = setInterval(() => this.adopt(false), 1000);
            },
            stop() {
                if (st.ref && st.cb) st.ref.off("value", st.cb); if (st.offRef) st.offRef.off();
                if (st.timer) clearInterval(st.timer); st.ref = st.cb = st.offRef = st.timer = null; st.pending = null;
            },

            /* ------------------------------ selection UI ------------------------------ */
            renderDesc() {
                const el = $("marble-map-desc"); el.replaceChildren();
                const M = st.mapSel === "random" ? null : MAPS[st.mapSel];
                const p = document.createElement("p"); p.textContent = M ? `${M.icon} ${M.desc}` : "\u{1F3B2} A surprise track is chosen when the race starts."; el.append(p);
                if (M) { const row = document.createElement("div"); row.className = "marble-chips"; M.pool.forEach(([k, n, i]) => { const c = document.createElement("span"); c.className = "marble-chip"; c.style.borderColor = PU[k].c; c.textContent = `${i} ${n}`; c.title = PU[k].d; row.append(c); }); el.append(row); }
            },
            syncPanel() {
                $("marble-panel").hidden = LuckyDraw.mode !== "marble";
            },
            init() {
                const sel = $("marble-map");
                [["random", "\u{1F3B2} Random Map"], ...MAP_IDS.map((k) => [k, `${MAPS[k].icon} ${MAPS[k].name}`])].forEach(([v, t]) => { const o = document.createElement("option"); o.value = v; o.textContent = t; sel.append(o); });
                sel.addEventListener("change", () => { st.mapSel = sel.value; this.renderDesc(); });
                this.renderDesc(); this.syncPanel();
            }
        };
        return api;
    })();

    /* --- wire the marble race into Lucky Draw / navigation / room lifecycle --- */
    MarbleRace.init();
    Object.assign(LuckyDraw.IDLE, { marble: ["\u{1F52E}", "Every player drops as a marble through a themed gravity maze. First across the line wins."] });
    {
        const r0 = LuckyDraw.reset;
        LuckyDraw.reset = function () { r0.call(this); MarbleRace.syncPanel(); };
    }
    { const s0 = Social.start, s1 = Social.stop; Social.start = function () { s0.call(Social); MarbleRace.start(); MarbleRace.syncPanel(); }; Social.stop = function () { s1.call(Social); MarbleRace.stop(); }; }

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

    const Plus = (() => {
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

        /* ---------- Top-bar buttons ---------- */
        const anchor = DOM.btnOpenAdminLobby;
        anchor.before(mk(`<button type="button" id="btn-missions" class="btn btn-secondary" title="Daily Missions">\u{1F3AF}</button>`));
        anchor.before(mk(`<button type="button" id="btn-host-settings" class="btn btn-secondary" title="Host Settings" hidden>\u{1F39B}</button>`));
        $("btn-missions").onclick = () => { if (needsWatch()) watchQuests(); renderQuests(); mMiss.hidden = false; };
        $("btn-host-settings").onclick = () => { buildAdmin(); mAdm.hidden = false; };
        document.addEventListener("game-changed", () => { syncUi(); if (needsWatch()) watchQuests(); });

        return { cfg, syncRigUi };
    })();

    /* =========================================================================
       Z. VIP UPGRADE MODULE — bet limits, synth audio, audit log, daily spin,
       achievements, central bank, quick dice, knockout tournaments.
       Firebase nodes (rooms/<code>/): lim, audit, bank, dice, tour, players/<u>/{ach,spin,loan}
       ========================================================================= */
    const fmt = (n) => Number(n || 0).toLocaleString("en-US");
    const zref = (p) => (Room.db && Room.code ? Room.db.ref(`rooms/${Room.code}/${p}`) : null);
    const zday = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
    const $z = (id) => document.getElementById(id);
    const TS = () => window.firebase.database.ServerValue.TIMESTAMP;

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
    GameResolver.LABELS.dice = "Quick Dice"; GameResolver.LABELS.tournament = "Tournament";

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

    /* ---------- Central Bank (reserve + emergency loans, admin approves) ---------- */
    const Bank = {
        d: {}, RES0: 5000,
        cfg() { const c = this.d.cfg || {}; return { on: c.on !== false, max: c.max || 500, rate: c.rate == null ? 10 : c.rate, auto: !!c.auto }; },
        res() { return this.d.res == null ? this.RES0 : this.d.res; },
        loan() { const l = (Room.get(State.username) || {}).loan; return l && l.owed > 0 ? l.owed : 0; },
        mine() { return (this.d.req || {})[State.username] || null; },
        request(amt) {
            const c = this.cfg(); amt = Math.min(c.max, Math.max(1, Math.round(amt)));
            if (!c.on) return Notify.error("The Central Bank is closed.");
            if (State.balance > 0) return Notify.error("Emergency loans are only for players with 0 chips.");
            if (this.loan() > 0) return Notify.error("Repay your current loan first.");
            zref("bank/req/" + State.username).transaction((v) => (v && v.st === "pending" ? undefined : { amt, ts: Date.now(), st: "pending" }), (e, ok) => {
                if (!ok) return Notify.warning("You already have a pending request.");
                Audit.log("loan", `Requested emergency loan of ${fmt(amt)}`, amt); Notify.success("Request sent to the host.");
                if (c.auto) this.approve(State.username);
            }, false);
        },
        async approve(u) {
            const q = (this.d.req || {})[u], c = this.cfg(); if (!q || q.st !== "pending") return;
            const amt = Math.min(q.amt, c.max), owed = Math.ceil(amt * (1 + c.rate / 100));
            const r = await zref("bank/res").transaction((v) => { v = v == null ? this.RES0 : v; return v >= amt ? v - amt : undefined; });
            if (!r.committed) return Notify.error("The bank reserve is too low. Top it up in Admin \u2192 Bank.");
            const p = await Room.playersRef.child(u).transaction((p) => { if (!p || (p.loan && p.loan.owed > 0)) return; p.balance = (p.balance || 0) + amt; p.loan = { p: amt, owed, rate: c.rate, ts: Date.now() }; return p; });
            if (!p.committed) { zref("bank/res").transaction((v) => (v || 0) + amt); zref("bank/req/" + u).update({ st: "denied" }); return Notify.error(`${u} already has a loan.`); }
            zref("bank/req/" + u).update({ st: "approved" }); Audit.log("loan", `Loan to ${u}: ${fmt(amt)} chips, ${fmt(owed)} owed (${c.rate}%)`, amt);
        },
        deny(u) { zref("bank/req/" + u).update({ st: "denied" }); Audit.log("loan", `Denied loan request from ${u}`); },
        repay(amount, auto) {
            let paid = 0, cleared = false;
            Room.playersRef.child(State.username).transaction((p) => {
                paid = 0; cleared = false; if (!p || !p.loan || p.loan.owed <= 0) return;
                paid = Math.min(p.loan.owed, Math.round(amount), p.balance || 0); if (paid <= 0) return;
                p.balance -= paid; p.loan.owed -= paid; if (p.loan.owed <= 0) { delete p.loan; cleared = true; } return p;
            }, (e, ok) => {
                if (e || !ok || !paid) return;
                zref("bank/res").transaction((v) => (v == null ? Bank.RES0 : v) + paid);
                Notify.success(`${auto ? "Auto-repaid" : "Repaid"} ${fmt(paid)} chips${cleared ? " \u2014 loan cleared!" : ""}`);
                if (cleared) { Ach.bump({ repaid: 1 }); Audit.log("loan", "Loan fully repaid", paid); }
            }, false);
        }
    };

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

    /* ---------- Quick Dice: shared High/Low round (2d6) synced at rooms/<code>/dice ---------- */
    const Dice = {
        d: { st: "idle" }, off: 0, shown: null, timer: 0, anim: 0,
        SIDES: { l: ["Low 2\u20136", 2.2], s: ["Lucky 7", 5.5], h: ["High 8\u201312", 2.2] },
        now() { return Date.now() + this.off; },
        init() {
            $z("z-dice").innerHTML = `<div class="z-dice-stage"><div class="z-die" id="z-d1">\u2680</div><div class="z-die" id="z-d2">\u2681</div></div>
           <div class="z-dice-info"><b id="z-dice-st">Place a bet to start a round</b><small id="z-dice-bets"></small></div>
           <div class="blackjack-controls"><div class="form-group bet-group"><label for="z-dice-amt">Bet</label><input type="number" id="z-dice-amt" class="input-field input-bet" min="1" step="1" value="50"></div>
           <div class="action-buttons">${Object.keys(this.SIDES).map((k) => `<button type="button" class="btn btn-action" data-side="${k}">${this.SIDES[k][0]}<small> pays ${this.SIDES[k][1]}x</small></button>`).join("")}</div></div>
           <p id="z-dice-res" class="game-result" role="status"></p>`;
            $z("z-dice").addEventListener("click", (e) => { const b = e.target.closest("[data-side]"); if (b) this.bet(b.dataset.side); });
        },
        bet(side) {
            const me = State.username, amt = Validate.parseBet($z("z-dice-amt")); if (amt === null || !me) return;
            const r = zref("dice"); if (!r) return; let why = "";
            r.transaction((v) => {
                v = v || { st: "idle" }; const t = this.now(); why = "";
                if (v.st === "bet" && t > v.end) { why = "Betting is closed \u2014 rolling!"; return; }
                if (v.st === "done" && t < (v.doneAt || 0) + 4500) { why = "Next round opens in a moment."; return; }
                if (v.st !== "bet") v = { st: "bet", id: t + "-" + Math.random().toString(36).slice(2, 6), end: t + 9000, bets: {} };
                v.bets = v.bets || {}; if (v.bets[me]) { why = "You already bet this round."; return; }
                v.bets[me] = { s: side, a: amt }; return v;
            }, (e, ok) => { if (ok) { State.debit(amt); Sound.chip(); } else if (why) Notify.warning(why); }, false);
        },
        roll() {
            zref("dice").transaction((v) => {
                if (!v || v.st !== "bet" || this.now() < v.end) return;
                const a = 1 + Math.floor(Math.random() * 6), b = 1 + Math.floor(Math.random() * 6);
                v.st = "done"; v.d = [a, b]; v.doneAt = this.now(); return v;
            }, () => { }, false);
        },
        on(v) {
            this.d = v || { st: "idle" }; const g = this.d, me = State.username;
            if (g.st === "done" && this.shown !== g.id) { this.shown = g.id; this.reveal(g); }
            this.paint();
        },
        paint() {
            const g = this.d, st = $z("z-dice-st"), bt = $z("z-dice-bets"); if (!st) return;
            const list = Object.keys(g.bets || {}).map((u) => `${u}: ${this.SIDES[g.bets[u].s][0]} ${fmt(g.bets[u].a)}`);
            bt.textContent = list.join("  \u00B7  ");
            if (g.st === "bet") st.textContent = `Betting open \u2014 ${Math.max(0, Math.ceil((g.end - this.now()) / 1000))}s`;
            else if (g.st === "idle") st.textContent = "Place a bet to start a round";
        },
        reveal(g) {
            const f = "\u2680\u2681\u2682\u2683\u2684\u2685", [a, b] = g.d, t0 = Date.now();
            $z("z-dice-st").textContent = "Rolling\u2026"; clearInterval(this.anim);
            this.anim = window.setInterval(() => {
                const fin = Date.now() - t0 > 1100; $z("z-d1").textContent = f[(fin ? a : 1 + Math.floor(Math.random() * 6)) - 1]; $z("z-d2").textContent = f[(fin ? b : 1 + Math.floor(Math.random() * 6)) - 1]; Sound.tick(a + b);
                if (fin) { clearInterval(this.anim); this.settle(g); }
            }, 90);
        },
        settle(g) {
            const tot = g.d[0] + g.d[1], win = tot < 7 ? "l" : tot > 7 ? "h" : "s", me = State.username, my = (g.bets || {})[me];
            $z("z-dice-st").textContent = `Total ${tot} \u2192 ${this.SIDES[win][0]}`;
            if (!my) return;
            zref("dice/paid/" + me).transaction((v) => (v === g.id ? undefined : g.id), (e, ok) => {
                if (!ok) return; const won = my.s === win, pay = won ? Math.floor(my.a * this.SIDES[win][1]) : 0;
                resolveGameOutcome("dice", { roundId: g.id + "-" + me, entries: [{ wager: my.a, payout: pay }] });
                $z("z-dice-res").textContent = won ? `You won ${fmt(pay)} chips!` : `You lost ${fmt(my.a)} chips.`;
                if (won) { Sound.win(); Ach.bump({ dicew: 1 }); if (pay >= CONFIG.BIG_WIN_THRESHOLD) Effects.celebrate(`Quick Dice: +${fmt(pay)}`); } else Sound.lose();
            }, false);
        },
        tick() { if (this.d.st === "bet") { this.paint(); if (this.now() >= this.d.end) this.roll(); } }
    };

    /* ---------- Knockout tournaments (host builds + reports; everyone watches live) ---------- */
    const Tour = {
        d: null, pick: new Set(), game: "uno", prize: 0,
        GAMES: [["uno", "UNO"], ["parques", "Parqu\u00E9s"], ["dominoes", "Dominoes"], ["chess", "Chess"], ["checkers", "Chinese Checkers"], ["mastermind", "Color Code Breaker"], ["bullscows", "Picas y Fijas"], ["dice", "Quick Dice"]],
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

    /* ---------- Wiring: Firebase listeners per room ---------- */
    const Z = {
        offs: [], iv: 0,
        start() {
            this.stop(); if (!Room.db || !Room.code) return;
            const on = (r, fn) => { if (!r) return; r.on("value", (s) => fn(s.val())); this.offs.push(() => r.off()); };
            on(Room.db.ref(".info/serverTimeOffset"), (v) => { Dice.off = v || 0; });
            on(zref("lim"), (v) => { v = v || {}; BetLimits.g = v.g > 0 ? v.g : BetLimits.DEF; BetLimits.games = v.games || {}; ZAdmin.limits(); });
            on(zref("bank"), (v) => { Bank.d = v || {}; Rewards.render(false); ZAdmin.bank(); });
            on(zref("dice"), (v) => Dice.on(v));
            on(zref("tour"), (v) => Tour.on(v));
            if (State.isHost) { const q = zref("audit").limitToLast(200); q.on("value", (s) => { const o = s.val() || {}; ZAdmin.log = Object.keys(o).map((k) => o[k]); ZAdmin.audit(); }); this.offs.push(() => q.off()); }
            this.iv = window.setInterval(() => Dice.tick(), 400);
        },
        stop() { this.offs.forEach((f) => f()); this.offs = []; clearInterval(this.iv); Dice.shown = null; ZAdmin.log = []; }
    };
    const soc0 = { start: Social.start.bind(Social), stop: Social.stop.bind(Social) };
    Social.start = function () { soc0.start(); Z.start(); };
    Social.stop = function () { soc0.stop(); Z.stop(); };
    document.addEventListener("DOMContentLoaded", () => { Rewards.init(); Dice.init(); Tour.init(); });

    document.addEventListener("DOMContentLoaded", init);
})();