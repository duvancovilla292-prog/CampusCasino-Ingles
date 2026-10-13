/* =========================================================================
   CASINO CAMPUS — FIREBASE SYNC & SESSION STATE
   Firebase initialisation, Room layer (create / join / list players, balances, leaderboard
   cache, presence), PubSub + connection status, global session State, device storage, shareable
   links, shared table lobbies (Tables), Central Bank (loans) and the Z room listeners
   (bet limits, bank, dice, tournaments, audit) under rooms/<code>/...
   Load order: 1 of 5 — no dependency on the other files at load time.
   Classic <script> (not an ES module): top-level const / function declarations are shared
   between the five files through the page's global lexical scope, so the cross-module
   references of the original single-closure build keep working unchanged.
   ========================================================================= */
"use strict";

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
const DeviceStore = {
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
            console.error("DeviceStore.saveSettings error:", err);
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

        const deviceId = DeviceStore.getDeviceId();
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
                deviceId: DeviceStore.getDeviceId(),
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

/* Room-scoped Firebase helpers shared by every module. */
const zref = (p) => (Room.db && Room.code ? Room.db.ref(`rooms/${Room.code}/${p}`) : null);
const zday = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
const TS = () => window.firebase.database.ServerValue.TIMESTAMP;

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
