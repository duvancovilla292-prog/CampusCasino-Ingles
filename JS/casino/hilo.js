/* CASINO CAMPUS — Hi-Lo.
   Classic <script> (not an ES module): top-level consts are shared with the other files
   through the page's global scope, so the load order in index.html matters. */
"use strict";

/* =========================================================================
   10. HI-LO
   ========================================================================= */
const HiLo = {
    currentCard: null,
    isResolving: false,

    init() {
        this.currentCard = this.drawCard();
        this.renderCurrentCard();
        if (DOM.btnHiloHigher) DOM.btnHiloHigher.addEventListener("click", () => this.guess("higher"));
        if (DOM.btnHiloLower) DOM.btnHiloLower.addEventListener("click", () => this.guess("lower"));
    },

    flip(el, apply, ms = 210) {
        const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        if (reduce || !el || !el.animate) { apply(); return Promise.resolve(); }
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
        if (!el) return;
        if (!card) { el.textContent = "?"; el.classList.add("hilo-card-hidden"); el.classList.remove("card-red", "card-black"); return; }
        el.textContent = `${card.rank}${card.suit}`;
        el.classList.remove("hilo-card-hidden");
        el.classList.toggle("card-red", Deck.isRedSuit(card.suit));
        el.classList.toggle("card-black", !Deck.isRedSuit(card.suit));
    },
    advanceCard(nextCard) {
        const hold = (ms) => new Promise((r) => window.setTimeout(r, ms));
        return hold(900).then(() => Promise.all([
            this.flip(DOM.hiloCurrentCard, () => { this.currentCard = nextCard; this.setCardFace(DOM.hiloCurrentCard, nextCard); }),
            hold(120).then(() => this.flip(DOM.hiloNextCard, () => this.setCardFace(DOM.hiloNextCard, null)))
        ]));
    },

    drawCard() {
        const rank = Deck.RANKS[Math.floor(Rng.float() * Deck.RANKS.length)];
        const suit = Deck.SUITS[Math.floor(Rng.float() * Deck.SUITS.length)];
        return { rank, suit, value: Deck.numericValue(rank) };
    },

    renderCurrentCard() {
        if (!DOM.hiloCurrentCard) return;
        DOM.hiloCurrentCard.textContent = `${this.currentCard.rank}${this.currentCard.suit}`;
        DOM.hiloCurrentCard.classList.toggle("card-red", Deck.isRedSuit(this.currentCard.suit));
        DOM.hiloCurrentCard.classList.toggle("card-black", !Deck.isRedSuit(this.currentCard.suit));
        if (DOM.hiloNextCard) {
            DOM.hiloNextCard.textContent = "?";
            DOM.hiloNextCard.classList.add("hilo-card-hidden");
            DOM.hiloNextCard.classList.remove("card-red", "card-black");
        }
    },

    guess(direction) {
        if (this.isResolving) return;
        const bet = Validate.parseBet(DOM.inputHiloBet);
        if (bet === null) return;

        State.debit(bet);
        this.isResolving = true;
        if (DOM.hiloResult) DOM.hiloResult.textContent = "";

        const nextCard = this.drawCard();
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

        if (DOM.hiloResult) {
            if (!isHigher && !isLower) {
                payout = bet;
                DOM.hiloResult.textContent = `Push on ${nextCard.rank}${nextCard.suit}. Bet returned.`;
                Notify.warning("Hi-Lo: push.");
            } else if (guessedCorrectly) {
                payout = bet * 2;
                DOM.hiloResult.textContent = `Correct! ${nextCard.rank}${nextCard.suit} was ${directionLabel}. You won ${payout} chips.`;
                Notify.success(`Hi-Lo: won ${payout} chips.`);
                Sound.win && Sound.win();
                if (payout >= CONFIG.BIG_WIN_THRESHOLD) Effects.celebrate(`NICE CALL! +${payout} chips`);
            } else {
                DOM.hiloResult.textContent = `Wrong! ${nextCard.rank}${nextCard.suit} was not ${directionLabel}. Lost ${bet} chips.`;
                Notify.error(`Hi-Lo: lost ${bet} chips.`);
                Sound.lose && Sound.lose();
            }
        }

        resolveGameOutcome("hilo", { entries: [{ wager: bet, payout }] });
        this.advanceCard(nextCard).then(() => { this.isResolving = false; });
    }
};
