const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('JS/casual-games.js', 'utf8');
const context = vm.createContext({ Tables: { names: (seats) => Object.values(seats) }, window: { btoa, atob } });
// Execute the actual pure engines without bootstrapping browser UI or a live room.
vm.runInContext(source.split('/*DE-START*/')[1].split('/*DE-END*/')[0] + '\nthis.engines = { MME, BCE };', context);
const hmStart = source.indexOf('    const LIVES = [6, 8, 10]');
const hmEnd = source.indexOf('    /* ------------------------------ table UI', hmStart);
vm.runInContext('(() => { const MAX = 6, PARTS = 10;\n' + source.slice(hmStart, hmEnd) + '\nthis.HME = HME; this.enc = enc; })()', context);
const lobby = () => ({ seats: { a: 'Alice', b: 'Bob' }, owner: 'Alice', max: 2, bet: 0 });
for (const [label, E] of Object.entries(context.engines)) {
    test(`${label}: secret setup, validation, turns, hints and final reveal`, () => {
        const g = E.deal(lobby()), [first, second] = g.order;
        assert.equal(g.sp, 'set');
        assert.equal(E.act(g, first, 'guess', { c: [0, 1, 2, 3] }, 'bad'), null);
        assert.equal(E.act(g, second, 'secret', { c: [0, 1, 2, 3] }, 'bad'), null);
        assert.ok(E.act(g, first, 'secret', { c: [0, 1, 2, 3] }, 's1'));
        assert.ok(E.act(g, second, 'secret', { c: [3, 2, 1, 0] }, 's2'));
        assert.equal(g.sp, 'guess');
        assert.equal(g.turn, 0);
        assert.equal(E.act(g, first, 'secret', { c: [0, 1, 2, 3] }, 'bad'), null);
        assert.ok(E.act(g, first, 'guess', { c: [3, 2, 0, 1] }, 'g1'));
        assert.equal(g.gs[first][0].e, 2);
        assert.equal(g.gs[first][0].p, 2);
        assert.ok(E.act(g, second, 'guess', { c: [0, 1, 2, 3] }, 'g2'));
        assert.equal(g.phase, 'done');
        assert.equal(g.res.ws[0], second);
    });
    test(`${label}: idle setup and bot produce valid secrets; rematch resets`, () => {
        const g = E.deal(lobby());
        assert.ok(E.auto(g, g.order[g.turn], 'idle'));
        assert.ok(E.auto(g, g.order[g.turn], 'idle2'));
        assert.equal(g.sp, 'guess');
        assert.ok(g.order.every((u) => E.valid(g.sec[u])));
        assert.equal(E.deal(lobby()).sp, 'set');
    });
}
test('Duplicate colours count once; PINs reject repeats and preserve leading zero', () => {
    const { MME, BCE } = context.engines;
    assert.deepEqual(Array.from(MME.fb([0, 0, 1, 2], [0, 1, 0, 0])), [1, 2]);
    assert.equal(BCE.valid([0, 0, 1, 2]), false);
    assert.equal(BCE.valid([0, 1, 2, 3]), true);
});
test('Hangman: master excluded, repeated guesses rejected, clues and solution shared', () => {
    const E = context.HME;
    const g = E.deal({ ...lobby(), seats: { a: 'Alice', b: 'Bob', c: 'Carol' }, cfg: { mode: 'master', master: 'Alice', sec: context.enc('APPLE') } });
    assert.ok(!g.order.includes('Alice'));
    assert.equal(g.rv, '_____');
    assert.equal(E.act(g, 'Alice', 'guess', { ch: 'A' }, 'bad'), null);
    assert.ok(E.act(g, g.order[g.turn], 'guess', { ch: 'P' }, 'one'));
    assert.equal(g.rv, '_PP__');
    assert.equal(E.act(g, g.order[g.turn], 'guess', { ch: 'P' }, 'dup'), null);
    assert.ok(E.act(g, g.order[g.turn], 'solve', { w: 'APPLE' }, 'end'));
    assert.equal(g.res.word, 'APPLE');
    assert.equal(g.phase, 'done');
});
test('Catalog: section off overrides game setting, restoration preserves individual choices', () => {
    const c = vm.createContext({});
    vm.runInContext(fs.readFileSync('JS/game-catalog.js', 'utf8') + '\nthis.catalog = GameCatalog;', c);
    const cfg = { disabled: { slots: true }, sectionsDisabled: { casino: true } };
    assert.equal(c.catalog.available('blackjack', cfg), false);
    assert.equal(c.catalog.first(cfg), 'draw');
    cfg.sectionsDisabled.casino = false;
    assert.equal(c.catalog.available('blackjack', cfg), true);
    assert.equal(c.catalog.available('slots', cfg), false);
    assert.equal(c.catalog.available('dice', cfg), false);
    assert.equal(c.catalog.available('tournament', cfg), false);
    cfg.sectionsDisabled = { casino: true, tools: true, casual: true };
    assert.equal(c.catalog.first(cfg), null);
});
