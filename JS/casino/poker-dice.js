/* CASINO CAMPUS — 3D Poker Dice.
   Classic <script> (not an ES module): top-level consts are shared with the other files
   through the page's global scope, so the load order in index.html matters. */
"use strict";

/* =========================================================================
   6. OVERHAULED 3D POKER DICE ENGINE
   ========================================================================= */
const PokerDice = {
    FACES: ["A", "K", "Q", "J", "10", "9"],
    RANKS: [5, 4, 3, 2, 1, 0],
    /** Total return (stake included) for a winning hand; any other win pays WIN_PAYS. ~97.8% RTP with good play. */
    PAYS: { 7: 5, 6: 2 },
    WIN_PAYS: 1.9,

    playerDice: [0, 0, 0, 0, 0],
    dealerDice: [0, 0, 0, 0, 0],
    held: [false, false, false, false, false],
    state: "idle", // "idle", "rolled", "finished"
    betAmount: 10,

    $(id) { return document.getElementById(id); },

    init() {
        const btnRoll = this.$("btn-pd-roll");
        const btnReroll = this.$("btn-pd-reroll");
        const btnStand = this.$("btn-pd-stand");

        if (btnRoll) btnRoll.addEventListener("click", () => this.startRoll());
        if (btnReroll) btnReroll.addEventListener("click", () => this.reroll());
        if (btnStand) btnStand.addEventListener("click", () => this.stand());

        this.renderDiceUI();
    },

    randDie() { return Math.floor(Rng.float() * 6); },

    evalHand(dice) {
        const cnt = {};
        dice.forEach((x) => { cnt[x] = (cnt[x] || 0) + 1; });
        const grp = Object.entries(cnt).map(([f, n]) => [n, this.RANKS[Number(f)]]).sort((a, b) => b[0] - a[0] || b[1] - a[1]);
        const pat = grp.map((x) => x[0]).join("");
        const uniq = [...new Set(dice)].sort((a, b) => a - b);
        const straight = uniq.length === 5 && (uniq[4] - uniq[0] === 4);

        let cat = 0, name = "High Card";
        if (pat === "5") { cat = 7; name = "5 of a Kind"; }
        else if (pat === "41") { cat = 6; name = "4 of a Kind"; }
        else if (pat === "32") { cat = 5; name = "Full House"; }
        else if (straight) { cat = 4; name = "Straight"; }
        else if (pat === "311") { cat = 3; name = "3 of a Kind"; }
        else if (pat === "221") { cat = 2; name = "Two Pair"; }
        else if (pat === "2111") { cat = 1; name = "One Pair"; }

        const score = cat * 1e6 + grp.reduce((acc, x) => acc * 10 + x[1], 0);
        return { cat, name, score };
    },

    renderDiceUI() {
        const pRow = this.$("pd-dice-row");
        const dRow = this.$("pd-dealer-dice");
        if (!pRow || !dRow) return;

        pRow.textContent = "";
        this.playerDice.forEach((v, i) => {
            const cube = document.createElement("div");
            cube.className = `pd-cube rank-${this.FACES[v]}` + (this.held[i] ? " is-held" : "");
            const span = document.createElement("span");
            span.className = "pd-cube-val";
            span.textContent = this.state === "idle" ? "?" : this.FACES[v];
            cube.appendChild(span);

            if (this.state === "rolled") {
                cube.addEventListener("click", () => {
                    this.held[i] = !this.held[i];
                    Sound.click && Sound.click();
                    this.renderDiceUI();
                });
            }
            pRow.appendChild(cube);
        });

        dRow.textContent = "";
        this.dealerDice.forEach((v) => {
            const cube = document.createElement("div");
            cube.className = `pd-cube rank-${this.FACES[v]}`;
            const span = document.createElement("span");
            span.className = "pd-cube-val";
            span.textContent = this.state === "finished" ? this.FACES[v] : "?";
            cube.appendChild(span);
            dRow.appendChild(cube);
        });

        const pEval = this.state === "idle" ? { name: "--", cat: 0 } : this.evalHand(this.playerDice);
        const dEval = this.state !== "finished" ? { name: "--" } : this.evalHand(this.dealerDice);

        const pBadge = this.$("pd-hand-name");
        if (pBadge) pBadge.textContent = pEval.name;
        const dBadge = this.$("pd-dealer-hand-name");
        if (dBadge) dBadge.textContent = dEval.name;

        const paytable = this.$("pd-paytable");
        if (paytable) {
            paytable.querySelectorAll("span").forEach((sp) => {
                const c = Number(sp.dataset.cat);
                sp.classList.toggle("active", pEval.cat === c);
            });
        }
    },

    startRoll() {
        if (this.state !== "idle" && this.state !== "finished") return;
        const bet = Validate.parseBet(this.$("input-pd-bet"));
        if (bet === null) return;
        if (!BetLimits.ok("pokerdice", bet)) return;
        if (!State.canAfford(bet)) return Notify.error("You don't have enough chips.");

        State.debit(bet);
        this.betAmount = bet;
        this.held = [false, false, false, false, false];
        this.playerDice = [0, 1, 2, 3, 4].map(() => this.randDie());
        this.dealerDice = [0, 1, 2, 3, 4].map(() => this.randDie());

        this.state = "rolled";
        Sound.chip && Sound.chip();

        const btnRoll = this.$("btn-pd-roll");
        const btnReroll = this.$("btn-pd-reroll");
        const btnStand = this.$("btn-pd-stand");
        if (btnRoll) btnRoll.disabled = true;
        if (btnReroll) btnReroll.disabled = false;
        if (btnStand) btnStand.disabled = false;

        const pRow = this.$("pd-dice-row");
        if (pRow) pRow.querySelectorAll(".pd-cube").forEach((c) => c.classList.add("rolling"));

        window.setTimeout(() => {
            this.renderDiceUI();
        }, 400);
    },

    reroll() {
        if (this.state !== "rolled") return;
        this.playerDice = this.playerDice.map((v, i) => (this.held[i] ? v : this.randDie()));
        this.finishRound();
    },

    stand() {
        if (this.state !== "rolled") return;
        this.finishRound();
    },

    /** House rule: the House keeps a straight or better, otherwise holds its matched dice
     *  (or its single highest die) and rerolls the rest once, just like the player. */
    houseReroll() {
        const d = this.dealerDice;
        if (this.evalHand(d).cat >= 4) return;
        const cnt = {};
        d.forEach((x) => { cnt[x] = (cnt[x] || 0) + 1; });
        const paired = d.some((x) => cnt[x] >= 2);
        const bestAt = d.indexOf(Math.min(...d)); // face index 0 = Ace (highest)
        this.dealerDice = d.map((x, i) => ((paired ? cnt[x] >= 2 : i === bestAt) ? x : this.randDie()));
    },

    finishRound() {
        this.state = "finished";
        const btnRoll = this.$("btn-pd-roll");
        const btnReroll = this.$("btn-pd-reroll");
        const btnStand = this.$("btn-pd-stand");
        if (btnRoll) btnRoll.disabled = false;
        if (btnReroll) btnReroll.disabled = true;
        if (btnStand) btnStand.disabled = true;

        this.houseReroll();
        const pEval = this.evalHand(this.playerDice);
        const dEval = this.evalHand(this.dealerDice);

        this.renderDiceUI();

        const won = pEval.score > dEval.score;
        const tie = pEval.score === dEval.score;
        const pays = this.PAYS[pEval.cat] || this.WIN_PAYS;
        let payout = 0;

        if (won) {
            payout = Math.floor(this.betAmount * pays);
        } else if (tie) {
            payout = this.betAmount;
        }

        const resEl = this.$("pokerdice-result");
        if (resEl) {
            if (won) {
                resEl.textContent = `You won ${payout.toLocaleString("en-US")} chips! (${pEval.name} vs Dealer's ${dEval.name})`;
                Notify.success(`Poker Dice: won ${payout.toLocaleString("en-US")} chips.`);
                Sound.win && Sound.win();
                if (payout >= CONFIG.BIG_WIN_THRESHOLD) Effects.celebrate(`POKER DICE WIN! +${payout.toLocaleString("en-US")} chips`);
            } else if (tie) {
                resEl.textContent = `Push! (${pEval.name}). Bet returned.`;
                Notify.warning("Poker Dice: push.");
            } else {
                resEl.textContent = `Dealer won with ${dEval.name}. Lost ${this.betAmount.toLocaleString("en-US")} chips.`;
                Notify.error(`Poker Dice: lost ${this.betAmount.toLocaleString("en-US")} chips.`);
                Sound.lose && Sound.lose();
            }
        }

        resolveGameOutcome("pokerdice", { entries: [{ wager: this.betAmount, payout }] });
    }
};
