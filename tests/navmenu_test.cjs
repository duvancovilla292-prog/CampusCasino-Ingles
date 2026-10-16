// Unit tests for the content-based sizing of the games / tools dropdown (NavMenu in ui-audio.js).
// Run from anywhere:  node --test tests/navmenu_test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'JS', 'ui-audio.js'), 'utf8');
const start = source.indexOf('const NavMenu = {'), end = source.indexOf('function bindGameNavigation');
assert.ok(start > 0 && end > start, 'NavMenu must exist in ui-audio.js');

/** Tiny classList: add / remove / contains. */
const classList = (initial = []) => { const set = new Set(initial); return { add: (c) => set.add(c), remove: (c) => set.delete(c), contains: (c) => set.has(c) }; };

/**
 * Fake panel. `natural` is the content height (what `auto` resolves to); an explicit style.height wins,
 * exactly like layout does. `log` records every height assignment.
 */
function setup({ open = true, natural = 300, groups = [false, false, false], reduced = false } = {}) {
    const log = [], listeners = {}, timers = [];
    const panel = {
        style: {
            props: {}, transition: '', _h: '',
            setProperty(k, v) { this.props[k] = v; },
            get height() { return this._h; }, set height(v) { this._h = v; log.push(v); }
        },
        classList: classList(),
        get offsetHeight() { return this.style._h ? parseFloat(this.style._h) : panel.natural; },
        natural,
        addEventListener(t, f) { listeners[t] = f; }, removeEventListener(t) { delete listeners[t]; },
        querySelectorAll: () => groups.map((hidden) => ({ hidden }))
    };
    let emptyWrites = 0, emptyHidden = true;
    const empty = { get hidden() { return emptyHidden; }, set hidden(v) { emptyWrites++; emptyHidden = v; } };
    const ctx = {
        window: { matchMedia: () => ({ matches: reduced }) },
        requestAnimationFrame: (f) => { f(); return 1; },
        setTimeout: (f) => { timers.push(f); return timers.length; }, clearTimeout: () => {},
        MutationObserver: class {}, document: {}, DOM: {}, Router: {}, LuckyDraw: undefined, GameCatalog: {}, Missions: {}
    };
    vm.createContext(ctx);
    vm.runInContext(source.slice(start, end) + '\nglobalThis.NavMenu = NavMenu;', ctx);
    const nav = ctx.NavMenu;
    nav.panel = panel; nav.empty = empty; nav.root = { classList: classList(open ? ['is-open'] : []) };
    nav.lastHeight = natural;
    return { nav, panel, log, listeners, timers, get emptyWrites() { return emptyWrites; }, get emptyHidden() { return emptyHidden; } };
}

test('one column per visible category (1 to 3); the panel never keeps empty columns', () => {
    for (const [hiddenFlags, cols] of [[[false, false, false], '3'], [[false, true, false], '2'], [[true, true, false], '1']]) {
        const t = setup({ groups: hiddenFlags });
        t.nav.applyLayout();
        assert.equal(t.panel.style.props['--nav-cols'], cols);
        assert.equal(t.emptyHidden, true, 'no notice while something is visible');
    }
    const four = setup({ groups: [false, false, false, false] }); four.nav.applyLayout();
    assert.equal(four.panel.style.props['--nav-cols'], '3', 'capped at three columns');
});

test('when nothing is enabled a notice replaces the empty panel, and unchanged values are not rewritten', () => {
    const t = setup({ groups: [true, true, true] });
    t.nav.applyLayout();
    assert.equal(t.panel.style.props['--nav-cols'], '1');
    assert.equal(t.emptyHidden, false);
    const writes = t.emptyWrites;
    t.nav.applyLayout(); t.nav.applyLayout();
    assert.equal(t.emptyWrites, writes, 'no redundant writes (they would re-trigger the MutationObserver)');
});

test('open menu: height glides from the old value to the new natural one, then returns to auto', () => {
    const t = setup({ natural: 420 });
    t.nav.lastHeight = 420;
    t.panel.natural = 260;                       // two games were switched off: content is shorter now
    t.nav.refresh();
    assert.deepEqual(t.log, ['', '420px', '260px'], 'measure natural, pin the start height, then tween to the target');
    assert.ok(t.panel.classList.contains('is-resizing'));
    assert.equal(t.panel.style.transition, '', 'the stylesheet height transition is active during the tween');
    assert.equal(t.nav.lastHeight, 260);
    t.listeners.transitionend({ target: t.panel, propertyName: 'opacity' });
    assert.ok(t.panel.classList.contains('is-resizing'), 'other properties finishing do not end the tween');
    t.listeners.transitionend({ target: t.panel, propertyName: 'height' });
    assert.equal(t.panel.style.height, '', 'explicit height removed: auto again');
    assert.ok(!t.panel.classList.contains('is-resizing'));
});

test('the safety timer also ends the tween if no transitionend arrives', () => {
    const t = setup({ natural: 420 });
    t.panel.natural = 200; t.nav.refresh();
    assert.equal(t.timers.length, 1);
    t.timers[0]();
    assert.equal(t.panel.style.height, ''); assert.ok(!t.panel.classList.contains('is-resizing'));
});

test('no animation when closed, for reduced motion, or for sub-pixel changes', () => {
    const closed = setup({ open: false, natural: 420 });
    closed.panel.natural = 260; closed.nav.refresh();
    assert.deepEqual(closed.log, [], 'closed: nothing to animate');
    assert.equal(closed.nav.lastHeight, 260, 'the next opening starts from the fresh height');

    const reduced = setup({ natural: 420, reduced: true });
    reduced.panel.natural = 260; reduced.nav.refresh();
    assert.ok(!reduced.panel.classList.contains('is-resizing'));
    assert.equal(reduced.panel.style.height, ''); assert.equal(reduced.nav.lastHeight, 260);

    const same = setup({ natural: 300 });
    same.panel.natural = 300.4; same.nav.refresh();
    assert.ok(!same.panel.classList.contains('is-resizing'));
});

test('a change during a running tween starts from the current animated height', () => {
    const t = setup({ natural: 420 });
    t.panel.natural = 260; t.nav.refresh();      // first tween 420 -> 260 (explicit height "260px" is applied)
    t.panel.style._h = '330px';                  // pretend the animation is currently at 330px
    t.panel.natural = 500; t.log.length = 0;
    t.nav.refresh();
    assert.deepEqual(t.log, ['', '330px', '500px']);
});
