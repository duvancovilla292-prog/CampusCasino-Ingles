# ♠ Casino Campus

An educational, **real-time multiplayer** casino and table-game simulator with virtual chips (zero real-money risk). It is built with plain HTML, CSS and JavaScript — no frameworks and no build step. Devices stay in sync through Firebase Realtime Database, so you do not need a backend of your own.

- **Look:** dark felt and gold, with a Day and a Night theme, for phones and desktops.
- **Stack:** HTML5, CSS3, JavaScript ES6+, Canvas 2D, Web Audio API and Firebase Realtime Database (`compat` SDK from Google's CDN).
- **Hosting:** any static host (GitHub Pages, Netlify, Firebase Hosting...).

---

## Table of contents

1. [Features](#features)
2. [Project structure](#project-structure)
3. [Quick start](#quick-start)
4. [Tests](#tests)
5. [How it is used](#how-it-is-used)
6. [Games](#games)
7. [Arcade (iframe games)](#arcade-iframe-games)
8. [Random selection tools](#random-selection-tools)
9. [Social and progress features](#social-and-progress-features)
10. [Administrator panel and Host settings](#administrator-panel-and-host-settings)
11. [Quiz / Live Questions](#quiz--live-questions)
12. [Day and Night themes](#day-and-night-themes)
13. [Architecture](#architecture)
14. [Firebase data model](#firebase-data-model)
15. [Configuration](#configuration)
16. [Security and Firebase rules](#security-and-firebase-rules)
17. [Compatibility and accessibility](#compatibility-and-accessibility)
18. [Troubleshooting](#troubleshooting)
19. [Extending the project](#extending-the-project)

---

## Features

- **Multiplayer rooms** with a 6-character code: one device creates the room (the Host) and everyone else joins with the code or a `?room=CODE` link.
- **Automatic Firebase connection:** the config is built into the code, so there is no setup screen.
- **Persistent players per room:** balances and stats are stored in Firebase and update live on every device.
- **20+ games** in three groups: casino games, casual & party games, and draw tools.
- **Arcade of iframe games** (Poki / CrazyGames style). The Host manages the list in real time, and it is backed up in `data/data.json`.
- **Shared tables** with a lobby and seats (Blackjack, Black Widow Poker, UNO, Colombian Ludo, Dominoes and more), optional stakes, and a bot opponent when you play alone.
- **Social and progress layer:** room chat and reactions, a community jackpot, a cosmetics shop, daily missions, a daily Lucky Spin, titles and achievements, and a Central Bank with emergency loans.
- **Knockout tournaments** that the whole room watches live.
- **Administrator panel** (Host only): player management, kicks, match control, manual score edits, live settings, bet limits, bank, audit log and backups.
- **Live leaderboard.**
- **Synthesized sound** with Web Audio (no audio files) and a mute button.
- **Celebration effects** for big wins, and toast notifications.

---

## Project structure

```
index.html
package.json          npm test / npm start
.github/workflows/    GitHub Actions: syntax check + unit tests on every push
CSS/
  main/               Base stylesheet, split into 10 files loaded in numeric order
    01-base.css                    Variables, buttons, forms, toasts, auth view, top panel
    02-classic-games.css           Blackjack, Roulette, Player Wheel, Slots, Hi-Lo
    03-screens-modals.css          Modals, responsive rules, room/setup screens, Lucky Draw
    04-upgrade-layers.css          Feedback fx, shop, chat, jackpot, VIP theme, card backs
    05-nav-tables-animations.css   Navigation menu, table lobbies, dealing/reel animations
    06-party-games.css             UNO, Colombian Ludo, Dominoes, strategy duels
    07-vip.css                     VIP styling (obsidian / brushed metal / gold)
    08-connect4-battleship-hangman.css
    09-baccarat-dice-keno.css
    10-admin-arcade-quiz.css       Admin controls, Arcade, Quiz, Admin panel v3
  fx.css              Animation layer (ambience, buttons, titles); loaded after CSS/main
  theme.css           Shared theme structure and Night Mode (Casino)
  theme-day.css       Day Mode (the morning after): light, calm palette
  home.css            Lobby Home page
data/
  data.json           Default Arcade game list (replace it with the one you download from the panel)
  quiz-examples.json  Sample questions loaded by the quiz's "Add examples" button
JS/
  theme.js            Day / Night switch (loaded in <head>, before the first paint)
  rng.js              Shared crypto-backed random source (Rng) used by every game
  firebase-sync.js    Firebase, Room, State, shared tables (Tables), Bank, room listeners
  game-catalog.js     Catalog of games and tools, navigation and visibility
  ui-audio.js         DOM, audio, UI, router, shop, chat, jackpot, missions, achievements, Lucky Spin
  casino/             Casino games, one file per game
    core.js           Shared card engine (CardFX), Deck and GameResolver — loaded first
    blackjack.js  baccarat.js  poker-dice.js  keno.js  roulette.js  slots.js  hilo.js
    craps-crash-wheel.js  black-widow.js  quick-dice.js
    init.js           Initialization and lifecycle hooks — loaded last
  casual/             Casual & party games, draw tools and tournaments, one file per game
    player-wheel.js  lucky-draw.js  uno.js
    party-tables.js   Shared Party table flow (needed by ludo.js and dominoes.js)
    ludo.js  dominoes.js
    strategy-duels.js Chess, Chinese Checkers, Connect Four, Battleship, Color Code Breaker, Bulls & Cows
    hangman.js  marble-race.js  tournaments.js  arcade.js
  quiz.js             Presentation quiz: question bank and shared state
  home.js             Lobby Home page (carousel, top winners, vault, featured games, rewards)
  top-menu.js         ☰ top-bar menu (Games with its categories, Leaderboard, Missions, Host Settings, Admin, Shop, Leave)
  admin-panel.js      Admin panel, Host settings, limits, audit and app bootstrap
tests/                Node unit tests (*.cjs)
```

The scripts are **classic scripts** (not ES modules) loaded with `defer` in the order listed in `index.html`. They share their top-level declarations through the page's global scope, so **order matters**: `rng.js` comes first, `casino/core.js` before the other casino games, `casual/party-tables.js` before `ludo.js` and `dominoes.js`, and `admin-panel.js` last because it needs everything else and runs the `DOMContentLoaded` bootstrap. The CSS files in `CSS/main/` are also loaded in order, so later files win ties in the cascade.

---

## Quick start

1. Serve the folder with any static server (`npm start`, or `python3 -m http.server 8080`) or push it to GitHub Pages, then open `index.html`.
2. You need an internet connection: the Firebase SDK loads from `gstatic.com`.
3. Click **Create Room** to start a room, or type a code and click **Join Room**.

There is no install or build step. If you open `index.html` straight from disk, make sure the `CSS/` and `JS/` folders keep those exact names (capital letters included).

---

## Tests

```bash
npm test
```

This runs every `tests/*.cjs` file with Node's built-in test runner (Node 22 or newer, no dependencies). The tests cover the Arcade link handling, backups, the deduction engines (Color Code Breaker, Bulls & Cows, Hangman), the navigation menu, the quiz (with an in-memory Realtime Database stand-in, so nothing is written to Firebase) and the random source. GitHub Actions runs the same suite, plus a syntax check of every JS file, on every push and pull request (`.github/workflows/tests.yml`).

---

## How it is used

### As the Host
1. On the first screen, click **Create Room**.
2. You get the **room code** and a **share link** (`?room=CODE`). Copy it with **Copy Link**.
3. Click **Continue to Lobby** to choose a player.

### As a guest
1. Type the room code (or open the shared link, which fills it in).
2. Click **Join Room**. If the code does not exist, you see an error.

### Choosing a player
- Pick an existing player from the list (it has a search box) or create a new one.
- Usernames: **3 to 16 characters**, letters, numbers, `_` and `-` only. Names must be unique within a room.
- Starting chips: **500, 1,000 (default), 2,500 or 5,000**.

### Home
Entering the lobby opens the **Home** page, also reachable from **☰ → 🏠 Home**. It has:

- A featured carousel (Blackjack, live tables, Lucky Draw and Quiz). Each button opens that game. It advances every 7 s, pauses on hover and stays still with "reduce motion".
- The room's **Top winners**, live, by net profit.
- The **Community vault**, with the same counter as the top bar.
- **Featured games** by category, and **Rewards**: Missions, Lucky Spin, VIP Shop and Bank. Game tiles the Host disables are hidden here too.

### Lobby
The top bar shows the room, player, balance, the Day / Night switch, sound, and a **☰** button. It opens **🎮 Games** (with the current game underneath), **Leaderboard**, **Daily Missions**, **Host Settings** and **Administrator Panel** (Host only), **Shop** and **Leave**. The menu closes when you pick an option, tap outside it or press Escape. It works with the keyboard: Down arrow opens it and the arrows move through the options. If there are missions to claim, the ☰ button shows a counter.

**Games** unfolds three categories (**Casino Games**, **Tools** and **Casual & Party Games**). Each one lists its games; picking one opens it and closes the menu. Categories and games the Host disables stay hidden.

---

## Games

### Casino (with chips)

| Game | Notes |
|---|---|
| **Blackjack** | Shared table with a lobby and up to 5 seats. Hit and Stand; the dealer draws to 17; aces count 11 or 1. Natural blackjack pays **×2.5**, a normal win ×2, a push returns the bet |
| **Baccarat** | Multiplayer rounds with a shared timer |
| **Poker Dice** | 3D dice. You can re-roll the dice you did not hold once; the house also re-rolls once, holding its pairs. Any win pays **×1.9**, four of a kind **×2** and five of a kind **×5**; a tie returns the bet |
| **VIP Keno** | Number draw |
| **Roulette** (0–36) | Bet on a number, colour or odd/even. Straight number **×36**; colour and odd/even **×2** (0 loses on odd/even) |
| **Slots** | 3 reels with 6 symbols. Three of a kind **×12**; two of a kind **×1.5** (95.8% theoretical return) |
| **Hi-Lo** | Guess whether the next card is higher or lower. A correct guess pays ×2; a tie returns the bet |
| **Craps, Crash, Money Wheel** | Chip games; the rules are explained on their screens |
| **Black Widow Poker** | Shared table with up to 6 seats and a 10-chip ante. Swap cards with "the Widow" in the middle, or call "I'm done here" to start the final cycle |

### Casual & party (optional stakes)

| Game | Players |
|---|---|
| **UNO** | Up to 6 |
| **Colombian Ludo**, **Dominoes**, **Chinese Checkers** | Up to 4 |
| **Chess**, **Connect Four**, **Battleship**, **Color Code Breaker**, **Bulls & Cows** | 2 |
| **Hangman** | Multiplayer |
| **Arcade Games** | External HTML5 games embedded in an `<iframe>` (Kick The Buddy by default). No chips; see the next section |
| **Marble Gravity Race** | The whole room; a marble race through a gravity maze |

Every table shares the same flow:

- One player **opens the table**, the others take a seat, and the table owner clicks **Start game now**.
- Each table has a minimum player count (UNO, Colombian Ludo and Dominoes need 2). If you are alone, the 2-player casual games offer the **Casino Bot** as an opponent.
- Casual table stakes use the chips **0, 10, 25, 50, 100 and 250**.
- If the owner leaves, another seated player can take over.
- If a player does not move on their turn, the others can **kick for inactivity** once the turn limit passes (45 seconds by default; the Host can change it).

General notes:
- Bets are validated: a whole number, greater than zero, not more than your balance, and within the room's **maximum bet limit**.
- A win of **250 chips** or more triggers the celebration animation (`BIG_WIN_THRESHOLD`).
- Each round updates the player's `gamesPlayed`, `totalWagered` and `netProfit`.
- At 0 chips you cannot bet: ask the Central Bank for a loan, or ask the Host to reset your balance.

### Color Code Breaker, Bulls & Cows and Hangman

- **Color Code Breaker / Bulls & Cows:** two players sit and start the match. Taking turns, each one enters the secret for their opponent and clicks **Lock secret for opponent**. Once both are locked, the guessing starts. The PIN may start with zero and needs four different digits; the colour code allows repeats. Guesses and hints are shared through Realtime Database transactions. The bot mode uses the same rules locally.
- **Hangman:** the player who controls the table chooses to set the secret word, types it and confirms. Only a confirmed write announces that the word is saved. The Word Master does not guess; the others take turns guessing letters or the whole word.
- Quick Dice and Knockout Tournament are no longer part of the catalog or the menu.

---

## Arcade (iframe games)

The **Arcade Games** tab (*Casual Games*). Players see a grid of games, open one and play it in a responsive container. Only one iframe is mounted at a time, and it is removed when you go back to the list, switch tabs or leave the room (so no sound keeps playing in the background). These games use no chips and do not affect stats.

Each game is rendered with the standard markup:

```html
<iframe
  src="https://html5.gamedistribution.com/GAME_CODE/"
  width="800"
  height="600"
  scrolling="no"
  frameborder="0"
  allowfullscreen>
</iframe>
```

So that no game can take the player out of the app, the iframe gets a **`sandbox`** attribute that does **not** include `allow-top-navigation` or `allow-popups` (the `Arcade.SANDBOX` constant). If a game's script tries `top.location = ...` or opens a new tab, the browser blocks it. GameDistribution games also get the `gd_sdk_referrer_url` parameter with your page's URL when they load (the `src` saved in `data.json` and Firebase stays clean).

The container uses `max-width` and `aspect-ratio` based on each game's width and height, so it fits phones and desktops. (Note: the valid attribute value is `scrolling="no"`, not `"none"`.)

### Thumbnails

Each game shows a square thumbnail in the list:

1. If the game has a `thumb` field (an https URL on an allowed host), that image is used.
2. Otherwise, GameDistribution games get one automatically: `https://img.gamedistribution.com/CODE-512x512.jpg`.
3. If there is no image, or it **fails to load**, the game's **emoji** shows instead. The emoji always sits under the image, so the UI never looks broken.

### Player progress (Firebase)

Embedded games run on the distributor's domain and cannot send anything to your app, so **the app** stores what it can observe, in `rooms/{code}/players/{username}/arcade`:

- **Last game opened** (`last`, `lastAt`): its card is highlighted in the list.
- **Per game** (`games/{id}`): times opened (`plays`), seconds played (`secs`), best score (`best`) and last time (`at`).
- The **score is self-reported**: under the game there is a *My score* field and a **Save score** button; only a higher score replaces the saved one.

This lives in `ArcadeProgress` (`JS/casual/arcade.js`) and is called from `Arcade.open()` (`start`), `Arcade.unmount()` and the `pagehide` event (`stop`), and from the score button (`saveScore`). The data is read from the live player cache, so it updates in real time and survives reloads and device changes.

### Managing games (authenticated Host only)

The **⚙ Manage games** button is added to the DOM **only** on the Host's device after the admin PIN has been entered. It opens a **modal** with the same look as the shop, leaderboard and admin panel: it closes with ✕, by tapping outside or with Escape, scrolls internally and is phone-friendly (44 px buttons, inputs that do not trigger zoom on iOS, one-column form). Other players get neither the button nor the modal; if the Host loses the admin session, both are removed. From the modal you can:

- **Add and edit** games: title, fallback emoji, description, width and height, optional thumbnail and source.
- **Reorder** (▲ ▼), **hide/show** and **delete** games.
- **Download `data.json`**, **Import JSON** and **Reset from repo data.json**.

The source field accepts a **GameDistribution code** (32 characters), an **https URL**, a pasted `<iframe ...>` snippet or a Markdown link `[url](url)`. For safety, only `https` URLs on the hosts in `Arcade.ALLOWED_HOSTS` (`gamedistribution.com`, `crazygames.com` and `poki.com`, subdomains included) are accepted. To add another provider, edit that list in `JS/casual/arcade.js`.

### Hybrid storage

| Layer | Where | Purpose |
|---|---|---|
| **Real time** | Firebase: `rooms/{code}/arcade` | Every Host change reaches all players in the room instantly |
| **Repository** | `data/data.json` | Default list, used until the Host edits the list in that room. If it cannot be read (for example, when the page is opened via `file://`), a built-in copy is used |

GitHub Pages is static and the page cannot write to the repository, so to make a change permanent:

1. Add or edit games in the editor (the room sees them right away).
2. Click **⬇ Download data.json**.
3. Replace `data/data.json` in your repository, commit, and wait for GitHub Pages to update.

While there are changes you have not downloaded, the editor shows an orange warning. File format:

```json
{
  "version": 1,
  "updatedAt": "2026-10-13T00:00:00.000Z",
  "games": [
    {
      "id": "kick-the-buddy",
      "title": "Kick The Buddy",
      "icon": "🥊",
      "description": "Relax-and-play ragdoll sandbox.",
      "src": "https://html5.gamedistribution.com/3785ca02d41845c389b09c5e1ff4ced7/",
      "thumb": "https://img.gamedistribution.com/3785ca02d41845c389b09c5e1ff4ced7-512x512.jpg",
      "width": 800,
      "height": 600,
      "enabled": true
    }
  ]
}
```

The file downloaded from the panel also includes `app`, `schemaVersion`, `exportedAt` and a `modules` block (quiz, shop, room and players); the Arcade only uses `games`.

The `src` is saved **without** the `gd_sdk_referrer_url` parameter (if you paste one, for example with `example.com`, it is removed on save); the real page URL is added when the iframe loads.

`thumb` is optional: GameDistribution games get one automatically.

On import, invalid games (empty title or a `src` that is not allowed) are skipped, and you are told how many. The limit is 60 games.

---

## Random selection tools

### Lucky Draw: pick 1 to 6 winners

Choose how many winners (1–6) and a mode, then click **Draw Winners**. Winners are chosen with an unbiased Fisher-Yates shuffle, and the animation then steers to them. If there are fewer players than requested winners, everyone available is drawn and you get a notice.

| Mode | Description |
|---|---|
| 🎰 **Slot Reels** | N vertical reels of names spin independently and stop one after another with a physical bounce |
| 🎱 **Bingo Blower** | A globe of balls that bounce and collide (2D canvas physics); a tube pulls out each winner's ball |
| 🃏 **Card Dealer** | A deck is shuffled, N cards are dealt and flipped automatically with a golden glow |
| 🔮 **Chip Laser** | Chips with names fall and spin; a laser locks onto each winner, who flies to the podium |
| 🏆 **1v1 Bracket** | Knockout bracket (up to 16 players, with byes). Winner 1 is the champion, 2 the runner-up, and so on |
| 🔵 **Plinko** | One ball per winner bounces through the pins into the slot with their name |
| 🎁 **Mystery Chests** | One chest per player (up to 24); a few open, then the winners' chests |
| 🧩 **Roles Matrix** | Gives each person picked a different role (Leader, Timekeeper, Note-taker, Presenter, Researcher, Checker); no chips |

Details:
- Winners appear on a numbered **podium** and are summarized in text at the end.
- The draw **only reads** the player list and runs **locally** on the device that starts it.
- During a draw the selectors are locked; **Reset** cancels and clears. Switching tabs also cancels the draw.
- It respects `prefers-reduced-motion`.

### Player Wheel

Spin a wheel whose slices are the room's players. When it lands on someone, you choose to keep them or remove them from the group. It uses no chips and does not write to the database.

### Tournaments

The Host builds a **knockout** bracket and reports the results; the rest of the room follows it live.

---

## Social and progress features

| Feature | Description |
|---|---|
| **Chat and reactions** | Room chat with an unread counter and quick reactions |
| **Community jackpot** | Shared room vault: 2% of every bet goes in, and it is split among active players when it fills |
| **Shop (Shop v2)** | Cosmetics in 5 categories: avatar, frame, border, badge and title. The Host can add custom items |
| **Daily missions** | Challenges by category (Casino, Casual, Wins, Bonus) with chip rewards |
| **Lucky Spin** | Daily reward spin (25 to 1,000 chips) |
| **Titles and achievements** | Unlocked by rounds played, wins, streaks and more |
| **Central Bank** | Chip reserve and **emergency loans** for players at 0 chips only. The Host approves or denies (or turns on auto-approval) and sets the maximum loan and interest. Defaults: 5,000 reserve, 500 maximum loan, 10% interest |

The **Rewards** panel groups Missions, Lucky Spin, Titles and Bank.

---

## Administrator panel and Host settings

The administrator panel opens only on the **device that created the room** (a `deviceId` stored in `localStorage` is compared with `meta.hostDeviceId`). It also asks for a **PIN** (`CONFIG.ADMIN_CODE`, default `admin123`). Until the PIN is correct, the advanced controls **are not built into the DOM**.

### Player management
- Totals: players, chips in circulation and rounds played.
- **Reset chips:** set a new balance for a player.
- **Kick:** remove a player. Their screen returns to the first screen with a notice, their seat is freed if the table is in the lobby, betting or finished, and their profile is deleted. You cannot kick yourself, and the player can rejoin with the room code.
- **Delete:** remove a player's profile.
- **Export / Import:** download or restore a JSON backup of the whole room, named `CasinoCampus_<ROOM>_<YYYY-MM-DD>.json`.
- **Delete all:** remove every player in the room.
- **Arcade:** after unlocking the panel, the Arcade Games tab shows **Manage games** (see [Arcade](#arcade-iframe-games)).

### Full match control
- **⚡ Force start current table:** starts the table of the game open behind the panel even if players are missing. You must be seated at that table while it is in the lobby; the Host takes over the table and skips the minimum player count for that start only.
- **Edit scores manually:** choose a player, an action (**Add**, **Subtract** or **Set to**) and an amount. It runs as a Firebase transaction, so it does not overwrite payouts arriving at the same time, and the balance never drops below 0. The player sees the change instantly.

### Live room settings
- **Seconds per turn (5–600)**, **Rounds (1–20)** and **Difficulty (Easy, Normal, Hard)**.
- Saved in `rooms/{code}/adm/cfg`; every client receives them instantly, and players get a notice.
- The turn time applies to Blackjack, Black Widow Poker, UNO, Colombian Ludo, Dominoes and Hangman.
- **Rounds** and **Difficulty** are shared with the whole room, but current games do not use them yet. Read them with `RoomCfg.get("rounds")` and `RoomCfg.get("difficulty")`.

### Games & sections
**Host Settings → Room → Games & sections** turns each game, or a whole category, on or off instantly. The states are stored in `rooms/{code}/cfg/disabled` and `rooms/{code}/cfg/sectionsDisabled`. A paused category keeps its per-game settings. Lucky Draw shortcuts are hidden too. With no games available, a pause message appears; turning one back on shows a game again.

### Host Settings
A tabbed control center:

| Tab | Purpose |
|---|---|
| **Room** | Room management, games & sections, and the **chosen winner (Rig)** options for draws and games that read it; every use is written to the audit log |
| **Shop** | Create and manage shop items |
| **Missions** | Manage missions and reset their progress |
| **Limits** | **Maximum bet limit**, global and per game (default 50,000) |
| **Bank** | Reserve, maximum loan, interest, auto-approval and pending requests |
| **Audit** | Room event log with a type filter (big wins, rig, missions, loans, spins, limits, tournaments, bank, achievements, kick, force, score and config) |

---

## Quiz / Live Questions

A group presentation tool in **Tools → Quiz / Live Questions**. Everyone joins the same room and opens the tool. Each user's navigation stays independent; the question, the options and the reveal are shared.

1. The Host opens the **Administrator Panel**, enters the PIN and finds the Quiz section.
2. Click **New question**, write the prompt, add or remove options and mark the correct answer. At least two options are required; letters are generated automatically (A…Z, AA…). Save, and repeat to build the room's question bank.
3. **Edit** changes the bank; **Delete** removes the question and, if it is live, takes it off the screen too. **Present** publishes a copy of the question with all options hidden, without touching the rest of the bank.
4. In the tool, **Reveal options / Hide options** shows or hides both the letters and the texts. **Reveal answer** highlights the solution with text and colour. Hiding the options also hides the solution again.
5. The correct answer of the live question can be changed from the admin panel; the change hides the solution again until it is revealed. The answer picker is in the panel so it never shows on the projector.
6. Use **Fullscreen** to project and **End question** to put the screen on standby. Do not project the bank editor.

`JS/quiz.js` is a classic script loaded before `admin-panel.js`. It listens to `rooms/{code}/quiz` while the session is active and removes its listener on exit. The node holds `questions/{pushId}: {prompt, options, correctIndex}` and `live: {id, questionId, question, optionsVisible, answerVisible}`. `question` is the published copy; saving changes to the bank does not change that copy until it is presented again. Writes use transactions without speculative local events; publishing, deleting and visibility changes arrive together. Devices that connect later receive the current state. A per-publication id stops a late control from being applied to a newer question.

The bank is stored per room in Firebase, with no build step or backend of its own, and works on GitHub Pages. Hidden options are not inserted into the public view, but they are still in the data the clients receive. As with the other controls, the PIN and the Host device protect the UI only: blocking outside writes needs Firebase Authentication and server-side security rules (see [Security](#security-and-firebase-rules)).

---

## Day and Night themes

The app has two moods of the same casino, chosen with the **☀️ Day Mode — Morning / 🌙 Night Mode — Casino** switch. It is on the room screen, on the player-selection screen and in the lobby's top bar.

- **Night Mode** (default): midnight blue, deep violet, metallic gold and magenta/red neon.
- **Day Mode**: the same casino in the morning, closed and quiet. A light, muted palette (beige, light grey, aged gold, champagne and soft charcoal), with the neon off and no glows, pulses or extra decoration. Tables and boards keep their dark felt, like a real table in daylight, and their text stays light.

How it works:

- `JS/theme.js` sets `data-theme="day"` or `data-theme="night"` on `<html>` before the first paint, so nothing flashes. It saves the choice in `localStorage` (`casinoCampus.theme.v1`) and syncs other tabs through the `storage` event.
- The change uses the View Transitions API (cross-fade). Without it, a short colour curtain is used. With `prefers-reduced-motion` the change is instant.
- `CSS/theme-day.css` holds only Day Mode (everything under `html[data-theme="day"]`), so Night Mode is unaffected.
- `CSS/theme.css` redefines the colour variables already used by `CSS/main/` (`--color-gold`, `--color-border`, `--color-felt`…) plus some `--vg-*` tokens (background, panels, borders, buttons, titles and particles). Components are written once and read those tokens.
- The switch is an accessible `radiogroup`: it works with click, touch and keyboard (arrows, Home and End) and marks the active mode with `aria-checked`.
- From another module: `Theme.get()`, `Theme.set("day" | "night")` and `Theme.toggle()`.

---

## Architecture

The code is organized as modules (object literals) spread over the files listed in [Project structure](#project-structure). Summary:

| File(s) | Main modules | Responsibility |
|---|---|---|
| `rng.js` | `Rng` | Crypto-backed random numbers (`Rng.float()`, `Rng.int(n)`, `Rng.pick(list)`) for every game |
| `firebase-sync.js` | `CONFIG`, `Room`, `PubSub`, `ConnectionStatus`, `State`, `Tables`, `Bank`, `Force`, `RoomCfg`, `Kick`, `Z` | Constants and Firebase, network layer (create/join room, listeners, player CRUD, scores), active session, shared table lobbies, bank and room listeners |
| `ui-audio.js` | `DOM`, `Sound`, `Effects`, `Notify`, `HUD`, `Validate`, `Router`, `AuthScreen`, `Leaderboard`, `Shop`, `Chat`, `Jackpot`, `Social`, `Missions`, `Rewards` | DOM cache, audio, celebrations, toasts, SPA navigation, room and player screens, shop, chat, missions, achievements and Lucky Spin |
| `casino/*.js` | `CardFX`, `Deck`, `GameResolver`, `Blackjack`, `Baccarat`, `Roulette`, `Slots`, `HiLo`, `BW`, `Keno`, `PokerDice` and more | Card engine and casino games |
| `casual/*.js` | `PlayerWheel`, `LuckyDraw`, `UNO`, `Party`, `PQ`, `DM`, `MarbleRace`, `Tour`, `Arcade` | Casual games, draws, tournaments and the iframe Arcade |
| `admin-panel.js` | `Admin`, `AdminCtl`, `Plus`, `Rig`, `BetLimits`, `Audit`, `ZAdmin` | Admin panel, Host settings, limits, audit and bootstrap |

Design principles:
- **Firebase is the single source of truth.** Balances are never stored locally; `players-updated` syncs your own balance live (for example, after an admin change).
- **Atomic payouts:** bets (`State.debit`), payouts and adjustments use transactions with deltas, so a win, a jackpot payout and an admin edit never overwrite each other.
- **One random source:** game outcomes use `Rng` (Web Crypto) instead of `Math.random()`. `Math.random()` is only used for purely visual effects and internal IDs.
- **No external dependencies** besides the Firebase SDK; audio is synthesized.
- **Safe DOM handling:** user text is inserted with `textContent` or escaped, never as raw HTML.
- **Views:** `view-setup` → `view-auth` → `view-lobby`, switched with the `hidden` attribute.

---

## Firebase data model

```
rooms/
  {ROOM_CODE}/
    meta/        hostDeviceId, createdAt, roomCode
    players/
      {username}/  username, balance, createdAt, updatedAt, deviceId,
                   stats/ { gamesPlayed, totalWagered, netProfit },
                   loan/  { p, owed, rate, ts }        (only with an active loan)
                   arcade/ { last, lastAt, games/{id}/{ plays, secs, best, at } }   (Arcade progress)
    bj, bw, bwstats, baccarat, uno, parques, dominoes, hangman,
    chess, checkers, mastermind, bullscows, connect4, battleship
                 tables: phase, owner, seats, max, turnAt, ... (match state)
    marble/current   marble race configuration
    tour             current tournament
    dice, rounds     synced rounds and payout claims
    jackpot, shop, chat, reactions
    cfg              missions, shop, chosen-winner and game visibility settings
    lim              bet limits { g, games }
    bank/            cfg, res (reserve), req/{username} (requests)
    audit            event log
    adm/cfg          live settings { turnSec, rounds, difficulty, ts }
    arcade           Arcade game list { custom, games/{id}/{title, icon, description, src, width, height, enabled, order}, ts, by }
    quiz             question bank and live question
    kicks/{username} kick signal { ts, by }
```

- Room codes use the alphabet `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (no ambiguous 0/O/1/I), and the code is checked to be free before the room is created.
- Balances are rounded and never drop below 0.
- `kicks/` signals are honoured only when recent (under 20 seconds); older ones are ignored.

---

## Configuration

### Firebase
The config is built into `CONFIG.FIREBASE_CONFIG` (in `JS/firebase-sync.js`):

```js
FIREBASE_CONFIG: Object.freeze({
  apiKey: "...",
  authDomain: "...",
  databaseURL: "...",
  projectId: "...",
  storageBucket: "...",
  messagingSenderId: "...",
  appId: "..."
})
```

To use your own project: create one in the Firebase console, enable **Realtime Database**, register a web app and replace the object with your `firebaseConfig`.

### Other constants

| Constant | Default | Description |
|---|---|---|
| `CONFIG.ADMIN_CODE` | `"admin123"` | Administrator panel PIN. **Change it before publishing** |
| `CONFIG.LEADERBOARD_LIMIT` | `15` | Players shown on the leaderboard |
| `CONFIG.BIG_WIN_THRESHOLD` | `250` | Minimum win for the celebration animation |
| `BetLimits.DEF` | `50000` | Default maximum bet (editable per room from the panel) |
| `RoomCfg.DEF` | `45 s`, `3`, `normal` | Default turn time, rounds and difficulty |

---

## Security and Firebase rules

The Firebase web config is public by design; what protects your data is the **database rules**. Keep in mind:

- In **test mode**, anyone can read and write every room.
- The admin PIN is in the source code and the Host check runs on the client. The panel controls (kick, force start, score edits, live settings) are only hidden by the UI: fine for a classroom, **not** real security. Someone with some know-how could write those nodes (`kicks/`, `adm/cfg`, `players/`) directly.
- Game outcomes are decided on each player's device. `Rng` makes them unpredictable, but a player who edits the page's JavaScript can still change their own results. Only a trusted server (for example, Cloud Functions) can prevent that.
- Secrets in Color Code Breaker, Bulls & Cows and Hangman are not shown to opponents in the UI, but they are in the state the clients download. The Hangman word encoding is not encryption.
- Iframe URLs are validated on the client (https and allowed hosts), but the `arcade/` node should also be protected by rules so only the Host can write it.
- With real rules, each player should only be able to write their own `players/{username}/arcade`.
- For more protection, add **Firebase Authentication** and tighten the rules: for example, only the Host can write `kicks/`, `adm/` and `lim/`, and `players/{username}/balance` is validated by type and range.
- Consider restricting the API key to your domain in the Google Cloud console.
- No real money is processed: all chips are virtual.

---

## Compatibility and accessibility

- Modern browsers with ES6+, Canvas 2D, Web Audio, Web Crypto and CSS `dvh` / `aspect-ratio` (recent Chrome, Edge, Firefox and Safari).
- Responsive layout with safe areas (`env(safe-area-inset-*)`) for phones with a notch.
- `aria` roles and regions (`role="alert"`, `aria-live`, `aria-pressed`) on forms, notifications, toggle buttons and results.
- `prefers-reduced-motion` reduces animations.

---

## Troubleshooting

| Problem | Likely cause and fix |
|---|---|
| "Could not reach Firebase" | Offline, or the SDK did not load (ad blocker, restricted network). Check the connection and reload |
| "Room not found" | Wrong code or the room does not exist. Confirm the code with the Host |
| Permission denied in the console | The Realtime Database rules block the operation. Check the rules |
| Opening a game redirects the page or opens a tab | The game's script is trying to escape the iframe. The `Arcade.SANDBOX` sandbox blocks it; open the console (F12) and look for *"Unsafe attempt to initiate navigation"* to confirm. If a game needs to open links, add `allow-popups` to that constant |
| An Arcade game does not load | The provider may block your domain or iframes. Try another game or check the domain settings in your GameDistribution account |
| "Invalid source" when adding a game | Use a GameDistribution code, an https URL or an `<iframe>` from an allowed host (`Arcade.ALLOWED_HOSTS`) |
| A thumbnail does not show | The game's emoji shows instead: the image failed to load or the provider has none at that pattern. Set another one in **Thumbnail URL** |
| I do not see Manage games | It only appears on the Host device after entering the admin PIN |
| The page loads without styles or scripts | The `CSS/main/*.css`, `JS/*.js`, `JS/casino/*.js` and `JS/casual/*.js` paths must exist with those exact names |
| The admin panel does not show | It only appears on the Host device; clearing local storage loses that identity |
| "Force start" does nothing | You must be seated at the open table of the game on screen, while it is in the lobby |
| A table does not start | Check the minimum player count and that everyone can cover the table's stake |
| No sound | Check the mute button; browsers require a user interaction first |
| Lucky Draw says "No players" | The room has no players yet |

---

## Extending the project

- **New casino game:** add a `<section class="game-section" data-game-section="...">`, a menu item with `data-game`, and a new file `JS/casino/<game>.js` with a module that has `init()`. Add its `<script>` tag in `index.html` after `casino/core.js` and before `casino/init.js`. Use `State.debit/credit` and `GameResolver` for balances and stats, and `Rng` for anything random.
- **New table game:** create `JS/casual/<game>.js`, reuse `Tables` (open, seats, lobby with `Tables.renderLobby`) and, for turns, read the limit with `RoomCfg.turnMs(45000)` to respect the Host's setting.
- **Reading live settings:** `RoomCfg.get("rounds")`, `RoomCfg.get("difficulty")` and the `PubSub.on("roomcfg-updated", fn)` event.
- **New draw mode:** add a `.draw-mode-btn` button with `data-draw-mode` and a `runXxx(names, winners, id)` method in `LuckyDraw` (`JS/casual/lucky-draw.js`). Use `this.frames(id, fn)` and `this.wait(ms, id)` so it can be cancelled, and `this.announce(name, rank)` to fill the podium.
- **New iframe game provider:** add its domain to `Arcade.ALLOWED_HOSTS` in `JS/casual/arcade.js`.
- **New admin controls:** add them inside `AdminCtl.build()` in `JS/admin-panel.js`, so they only exist in the DOM once the Host has unlocked the panel.
- **Styles:** colours and radii are CSS variables (`:root` in `CSS/main/01-base.css`, overridden per theme in `CSS/theme.css`).
- **Tests:** add a `tests/<name>_test.cjs` file; `npm test` picks it up automatically.

---

## Disclaimer

This project is for **educational and entertainment** purposes. Chips have no monetary value, and the app does not promote real-money gambling.
