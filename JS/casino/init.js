/* CASINO CAMPUS — initialization and lifecycle hooks.
   Classic <script> (not an ES module): top-level consts are shared with the other files
   through the page's global scope, so the load order in index.html matters. */
"use strict";

/* =========================================================================
   14. INITIALIZATION & LIFECYCLE HOOKS
   ========================================================================= */
Blackjack.init();
Baccarat.init();
PokerDice.init();
Keno.init();
BW.init();
Dice.init();
Extra.init();

if (typeof Social !== "undefined" && Social) {
    const s0 = Social.start, s1 = Social.stop;
    Social.start = function () {
        if (s0) s0.call(Social);
        Blackjack.start();
        Baccarat.start();
        BW.start();
    };
    Social.stop = function () {
        if (s1) s1.call(Social);
        Blackjack.stop();
        Baccarat.stop();
        BW.stop();
    };
}
