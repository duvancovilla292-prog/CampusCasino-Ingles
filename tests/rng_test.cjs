// Unit tests for the shared random source (JS/rng.js).
// Run from anywhere:  node --test tests/rng_test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'JS', 'rng.js'), 'utf8');
function load(globals) {
    const ctx = vm.createContext({ Math, ...globals });
    vm.runInContext(source + '\nthis.Rng = Rng;', ctx);
    return ctx.Rng;
}

test('uses crypto.getRandomValues when available and stays in [0, 1)', () => {
    let calls = 0;
    const Rng = load({ crypto: { getRandomValues(a) { calls += 1; for (let i = 0; i < a.length; i++) a[i] = (i * 2654435761) >>> 0; return a; } } });
    for (let i = 0; i < 1000; i++) { const v = Rng.float(); assert.ok(v >= 0 && v < 1, `out of range: ${v}`); }
    assert.ok(calls >= 1, 'crypto source was used');
    assert.ok(calls <= 5, 'values are buffered, not one crypto call per number');
});

test('falls back to Math.random without Web Crypto', () => {
    const Rng = load({});
    for (let i = 0; i < 100; i++) { const v = Rng.float(); assert.ok(v >= 0 && v < 1); }
});

test('int(n) covers 0..n-1 and pick() returns list members', () => {
    const Rng = load({ crypto: require('node:crypto').webcrypto });
    const seen = new Set();
    for (let i = 0; i < 2000; i++) { const v = Rng.int(6); assert.ok(Number.isInteger(v) && v >= 0 && v < 6); seen.add(v); }
    assert.equal(seen.size, 6, 'every face of a die shows up');
    const list = ['a', 'b', 'c'];
    for (let i = 0; i < 50; i++) assert.ok(list.includes(Rng.pick(list)));
});
