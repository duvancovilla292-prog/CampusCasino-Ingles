// Unit tests for the Arcade (casual iframe games) link handling: GameDistribution referrer, validation, sandbox.
// Run from anywhere:  node --test tests/arcade_test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'JS', 'casual-games.js'), 'utf8');
const start = source.indexOf('const Arcade = {');
assert.ok(start > 0, 'Arcade must exist in casual-games.js');
// The object literal ends at the first "};" in column 0 (the file continues with bootstrap code afterwards).
const code = source.slice(start, source.indexOf('\n};', start) + 3);

function load() {
    const ctx = { URL, console, Array, Object, String, Number, Math, Set, Notify: { errors: [], error(m) { this.errors.push(m); } }, document: {} };
    vm.createContext(ctx);
    vm.runInContext(code + '\nglobalThis.Arcade = Arcade;', ctx);
    return ctx;
}
// Arrays created inside the vm context have another prototype: compare plain JSON copies.
const copy = (v) => JSON.parse(JSON.stringify(v));
const REF = 'https://duvancovilla292-prog.github.io/CampusCasino-Ingles/';
const canon = (id) => `https://html5.gamedistribution.com/${id}/?gd_sdk_referrer_url=${REF}`;
const NEW_IDS = ['3ae409f702f64fab98743afbfdf211a1', '0c89181b9cfe4897afa41b0f94385da9', '57820e917cff42488d174341b8866760'];

test('a bare GameDistribution code becomes the exact canonical URL (the three new ids included)', () => {
    const { Arcade } = load();
    for (const id of NEW_IDS) assert.equal(Arcade.parseSrc(id), canon(id));
    assert.equal(Arcade.parseSrc(NEW_IDS[0].toUpperCase()), canon(NEW_IDS[0]), 'codes are lower-cased');
    assert.equal(Arcade.REFERRER_URL, REF);
});

test('URLs, pasted <iframe> snippets and [text](url) links are all normalized', () => {
    const { Arcade } = load(), id = NEW_IDS[1];
    assert.equal(Arcade.parseSrc(`https://html5.gamedistribution.com/${id}/`), canon(id));
    assert.equal(Arcade.parseSrc(`https://html5.gamedistribution.com/${id}`), canon(id), 'missing trailing slash is added');
    assert.equal(Arcade.parseSrc(`<iframe src="https://html5.gamedistribution.com/${id}/" width="100%"></iframe>`), canon(id));
    assert.equal(Arcade.parseSrc(`[game](https://html5.gamedistribution.com/${id}/)`), canon(id));
    assert.equal(Arcade.parseSrc(`https://html5.gamedistribution.com/${id}/#fragment`), canon(id), 'fragments are dropped');
});

test('a missing, old or wrong referrer is replaced; other parameters are kept; the result is idempotent', () => {
    const { Arcade } = load(), id = NEW_IDS[2];
    const wrong = `https://html5.gamedistribution.com/${id}/?gd_sdk_referrer_url=https://example.com/&lang=en&GD_SDK_REFERRER_URL=https://evil.example/`;
    const fixed = Arcade.parseSrc(wrong);
    assert.equal(fixed, `https://html5.gamedistribution.com/${id}/?lang=en&gd_sdk_referrer_url=${REF}`);
    assert.equal((fixed.match(/gd_sdk_referrer_url/gi) || []).length, 1);
    assert.equal(Arcade.parseSrc(fixed), fixed, 'parsing a stored link again changes nothing');
    assert.equal(Arcade.parseSrc(canon(id)), canon(id));
});

test('only GameDistribution links get the parameter; other providers and bad links are handled as before', () => {
    const { Arcade } = load();
    assert.equal(Arcade.parseSrc('https://poki.com/en/g/game'), 'https://poki.com/en/g/game');
    assert.equal(Arcade.parseSrc('https://www.crazygames.com/embed/game'), 'https://www.crazygames.com/embed/game');
    assert.equal(Arcade.parseSrc('http://html5.gamedistribution.com/' + NEW_IDS[0] + '/'), null, 'https only');
    assert.equal(Arcade.parseSrc('https://evil.example/' + NEW_IDS[0] + '/'), null, 'host allow-list');
    assert.equal(Arcade.parseSrc('https://html5.gamedistribution.com.evil.example/x/'), null);
    assert.equal(Arcade.parseSrc('not a url'), null);
    assert.equal(Arcade.parseSrc(''), null);
});

test('normalizeList stores the canonical link for every game and survives a data.json round trip', () => {
    const { Arcade } = load();
    const raw = [
        { title: 'One', src: NEW_IDS[0] },
        { title: 'Two', src: `https://html5.gamedistribution.com/${NEW_IDS[1]}/?gd_sdk_referrer_url=https://old.example/` },
        { title: 'Three', url: NEW_IDS[2] },
        { title: 'Poki', src: 'https://poki.com/en/g/x' },
        { title: 'Bad', src: 'https://evil.example/x' }
    ];
    const { list, skipped } = Arcade.normalizeList(raw);
    assert.equal(skipped, 1);
    assert.deepEqual(copy(list.slice(0, 3).map((g) => g.src)), NEW_IDS.map(canon));
    assert.equal(list[3].src, 'https://poki.com/en/g/x');
    const again = Arcade.normalizeList(JSON.parse(JSON.stringify(list))).list;
    assert.deepEqual(copy(again.map((g) => g.src)), copy(list.map((g) => g.src)));
});

test('the fallback list contains the three new games with canonical links', () => {
    const { Arcade } = load();
    const srcs = Arcade.normalizeList(Arcade.DEFAULT_GAMES).list.map((g) => g.src);
    for (const id of NEW_IDS) assert.ok(srcs.includes(canon(id)), id);
    assert.ok(srcs.includes(canon('3785ca02d41845c389b09c5e1ff4ced7')));
});

test('embedUrl repairs links saved by older versions and thumbnails still work', () => {
    const { Arcade } = load(), id = NEW_IDS[0];
    assert.equal(Arcade.embedUrl({ src: `https://html5.gamedistribution.com/${id}/` }), canon(id), 'legacy: no parameter');
    assert.equal(Arcade.embedUrl({ src: `https://html5.gamedistribution.com/${id}/?gd_sdk_referrer_url=http://localhost:5500/` }), canon(id), 'legacy: wrong page URL');
    assert.equal(Arcade.embedUrl({ src: 'https://evil.example/x' }), '');
    assert.equal(Arcade.thumbFor({ src: canon(id) }), `https://img.gamedistribution.com/${id}-512x512.jpg`);
    assert.equal(Arcade.cleanSrc(canon(id)), `https://html5.gamedistribution.com/${id}/`, 'the editor shows the short link');
});

test('iframe sandbox never allows top navigation or popups', () => {
    const { Arcade } = load();
    assert.ok(/\ballow-scripts\b/.test(Arcade.SANDBOX));
    assert.ok(!/top-navigation|popups/.test(Arcade.SANDBOX));
});
