// Unit tests for the Backup module (export shape, import validation, atomic update paths).
// Run from anywhere:  node --test tests/backup_test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
// Objects built inside the vm context have another Object.prototype: compare plain JSON copies.
const plain = (v) => JSON.parse(JSON.stringify(v));
const same = (a, b) => assert.deepEqual(plain(a), plain(b));
const read = (name) => fs.readFileSync(path.join(__dirname, '..', 'JS', name), 'utf8');

// Slice the Backup module out of admin-panel.js (it only touches the DOM inside UI methods).
const admin = read('admin-panel.js');
const begin = admin.indexOf('/* BACKUP:BEGIN'), end = admin.indexOf('/* BACKUP:END */');
assert.ok(begin > 0 && end > begin, 'BACKUP markers must exist in admin-panel.js');

function load() {
    const ctx = {
        console, JSON, Math, Number, Object, Array, String, Date, RegExp, Error,
        State: { username: 'host', roomCode: 'ROOM1' },
        TS: () => ({ '.sv': 'timestamp' }),
        SLOTS: ['avatar', 'frame', 'border', 'badge', 'title'],
        BetLimits: { DEF: 500 }, RoomCfg: { DEF: { turnSec: 45, rounds: 3, difficulty: 'normal' } },
        Missions: { QUESTS: [{ id: 'play3' }, { id: 'checkin' }] },
        // Same contract as Arcade.normalizeList: drops entries without title/src, caps the list.
        Arcade: {
            MAX_GAMES: 3,
            normalizeList(arr) {
                const list = []; let skipped = 0;
                arr.slice(0, 3).forEach((g) => { if (g && g.title && /^https:\/\/(poki|crazygames)\.com\//.test(g.src || '')) list.push({ id: String(g.id || g.title).toLowerCase(), title: g.title, icon: g.icon || '\u{1F3AE}', src: g.src, enabled: g.enabled !== false }); else skipped++; });
                return { list, skipped };
            },
            list: () => [], remote: null
        },
        Catalog: {
            key: (s, i) => s + ':' + i,
            norm(v) { const ok = ['avatar', 'frame', 'border', 'badge', 'title'].includes(v.slot) && /^[a-z0-9_-]{1,40}$/.test(String(v.id)) && v.name; return ok ? { slot: v.slot, id: v.id, name: String(v.name), price: Math.max(0, Number(v.price) || 0), rarity: v.rarity || 'common', icon: v.icon, svg: v.svg, custom: true } : null; }
        }
    };
    vm.createContext(ctx);
    // Real Quiz.question and real GameCatalog.categories.
    vm.runInContext(read('quiz.js') + '\nglobalThis.Quiz = Quiz;', ctx);
    vm.runInContext(read('game-catalog.js') + '\nglobalThis.GameCatalog = GameCatalog;', ctx);
    vm.runInContext(admin.slice(begin, end) + '\nglobalThis.Backup = Backup;', ctx);
    return ctx.Backup;
}

const sample = () => ({
    games: [{ id: 'g1', title: 'Game 1', icon: '\u{1F3AE}', src: 'https://poki.com/a', enabled: false }],
    custom: true,
    roomCode: 'ROOM1',
    quiz: {
        questions: { q1: { prompt: 'Capital of France?', options: ['Paris', 'Rome', 'Madrid'], correctIndex: 0 } },
        live: { id: 'tok', questionId: 'q1', optionsVisible: true, answerVisible: true, question: { prompt: 'Capital of France?', options: ['Paris', 'Rome', 'Madrid'], correctIndex: 0 } }
    },
    shop: { items: { 'badge:star': { slot: 'badge', id: 'star', name: 'Star', price: 50, icon: '\u2B50', by: 'x', ts: 1 } }, hidden: { 'avatar:fox': true, 'avatar:cat': false } },
    cfg: { roomName: 'Class A', bonusMult: 2, missionsOn: true, disabled: { uno: true, chess: false }, sectionsDisabled: { tools: true }, names: { uno: 'Cards' }, mDisabled: { play3: true }, rig: { on: true, t: 'Secret' } },
    adm: { turnSec: 30, rounds: 5, difficulty: 'hard' },
    lim: { g: 200, games: { slots: 50 } },
    bank: { on: true, max: 300, rate: 5, auto: false },
    players: { Ana: { username: 'Ana', balance: 120 } }
});

test('export packs every module and never leaks the secret rig switch', () => {
    const b = load(), out = b.build(sample());
    assert.equal(out.app, 'casino-campus'); assert.equal(out.schemaVersion, 2);
    same(Object.keys(out.modules).sort(), ['casualGames', 'players', 'quiz', 'room', 'store']);
    assert.equal(out.games.length, 1, 'top-level games alias keeps the file usable as the repo seed');
    assert.equal(out.modules.casualGames.games[0].enabled, false);
    same(out.modules.quiz.questions[0].options, ['Paris', 'Rome', 'Madrid']);
    assert.equal(out.modules.quiz.live.answerVisible, true);
    same(out.modules.store.hidden, ['avatar:fox']);
    same(out.modules.room.visibility.disabled, { uno: true });
    assert.ok(!JSON.stringify(out).includes('Secret'), 'rig target must not be exported');
});

test('round trip: export -> JSON -> validate -> atomic update paths', () => {
    const b = load(), file = JSON.parse(JSON.stringify(b.build(sample())));
    const { plan, skipped } = b.validate(file);
    same(skipped, { players: 0, games: 0, questions: 0, items: 0 });
    const u = b.toUpdates(plan);
    same(Object.keys(u).sort(), ['adm/cfg', 'arcade', 'bank/cfg', 'cfg/bonusMult', 'cfg/disabled', 'cfg/mDisabled', 'cfg/missionsOn', 'cfg/names', 'cfg/roomName', 'cfg/sectionsDisabled', 'lim', 'players/Ana', 'quiz/live', 'quiz/questions', 'shop/hidden', 'shop/items']);
    assert.ok(!Object.keys(u).some((k) => k.includes('rig')), 'cfg/rig is never written');
    assert.equal(u.arcade.custom, true); assert.equal(u.arcade.games.g1.order, 0);
    assert.equal(u['shop/items']['badge:star'].by, 'host');
    assert.equal(u['cfg/roomName'], 'Class A'); assert.equal(u['adm/cfg'].difficulty, 'hard');
    assert.equal(u['quiz/live'].questionId, 'q1'); assert.notEqual(u['quiz/live'].id, 'tok', 'live gets a fresh token');
    assert.equal(u['quiz/live'].answerVisible, true);
});

test('quiz: invalid questions are skipped, unsafe ids regenerated, live needs a valid question', () => {
    const b = load();
    const file = { modules: { quiz: {
        questions: [
            { id: 'a.b', prompt: 'Unsafe id?', options: ['x', 'y'], correctIndex: 1 },
            { id: 'bad', prompt: '', options: ['x', 'y'], correctIndex: 0 },
            { id: 'one', prompt: 'One option', options: ['x'], correctIndex: 0 },
            { id: 'ok', prompt: 'Fine', options: ['x', 'y'], correctIndex: 0 }
        ],
        live: { questionId: 'a.b', optionsVisible: false, answerVisible: true }
    } } };
    const { plan, skipped } = b.validate(file);
    assert.equal(skipped.questions, 2);
    const ids = Object.keys(plan.quiz.questions);
    assert.equal(ids.length, 2); assert.ok(!ids.includes('a.b')); assert.ok(ids.includes('ok'));
    assert.equal(plan.quiz.live.optionsVisible, false);
    assert.equal(plan.quiz.live.answerVisible, false, 'the answer cannot be visible while options are hidden');
    assert.ok(ids.includes(plan.quiz.live.questionId), 'live id follows the regenerated key');
    const gone = b.validate({ modules: { quiz: { questions: [], live: { questionId: 'nope', question: { prompt: '', options: [], correctIndex: 0 } } } } });
    assert.equal(gone.plan.quiz.live, null);
});

test('legacy files and bare game lists still import', () => {
    const b = load();
    same(Object.keys(b.validate({ exportedAt: 'x', roomCode: 'R', players: { Ana: { balance: 5 } } }).plan.players), ['Ana']);
    assert.equal(b.validate({ Ana: { balance: 5 }, Bo: { balance: 7 } }).plan.players.Bo.username, 'Bo');
    const seed = b.validate([{ title: 'Z', src: 'https://poki.com/z' }]);
    assert.equal(seed.plan.casualGames.length, 1);
    assert.equal(b.validate({ games: [{ title: 'Z', src: 'https://poki.com/z' }] }).plan.casualGames.length, 1);
});

test('players: unsafe keys / values are skipped and the node key wins over username', () => {
    const b = load();
    const { plan, skipped } = b.validate({ modules: { players: {
        'Ana': { username: 'Someone else', balance: 10 },
        'a.b': { balance: 1 }, 'ok': { balance: 1, nested: { 'bad/key': 1 } }, 'str': 'nope'
    } } });
    same(Object.keys(plan.players), ['Ana']); assert.equal(plan.players.Ana.username, 'Ana');
    assert.equal(skipped.players, 3);
});

test('room settings are clamped and restricted to known keys', () => {
    const b = load();
    const { plan } = b.validate({ modules: { room: {
        cfg: { roomName: ' '.repeat(3) + 'X'.repeat(60), bonusMult: 99, missionsOn: false, names: { uno: 'Cards', 'bad key!': 'x', chess: '' }, mDisabled: { play3: true, ghost: true } },
        visibility: { sectionsDisabled: { casual: true, nope: true }, disabled: { uno: true, ghost: true, chess: false } },
        settings: { turnSec: 1, rounds: 500, difficulty: 'insane' },
        limits: { g: -5, games: { slots: 50, 'bad key!': 10, craps: 0 } },
        bank: { on: false, max: 0, rate: 500, auto: true },
        rig: { on: true }
    } } });
    const r = plan.room;
    assert.equal(r.cfg.roomName.length, 40); assert.equal(r.cfg.bonusMult, 10); assert.equal(r.cfg.missionsOn, false);
    same(r.cfg.names, { uno: 'Cards' }); same(r.cfg.mDisabled, { play3: true });
    same(r.visibility.sectionsDisabled, { casual: true }); same(r.visibility.disabled, { uno: true });
    same(r.settings, { turnSec: 5, rounds: 20, difficulty: 'normal' });
    same(r.limits, { g: 1, games: { slots: 50 } });
    same(r.bank, { on: false, max: 1, rate: 100, auto: true });
    assert.ok(!('rig' in r));
});

test('rejects files that are not usable', () => {
    const b = load();
    assert.throws(() => b.validate(42), /JSON object/);
    assert.throws(() => b.validate({ app: 'other-app', modules: {} }), /not exported from Casino Campus/);
    assert.throws(() => b.validate({ schemaVersion: 99, modules: {} }), /newer version/);
    assert.throws(() => b.validate({}), /No importable data/);
    assert.throws(() => b.validate({ modules: { casualGames: { games: [{ title: 'x', src: 'https://evil.example/' }] } } }), /None of the entries/);
    assert.throws(() => b.validate({ modules: { quiz: 'text' } }), /quiz section/);
});

test('store: items are re-validated, keys recomputed, hidden list sanitized', () => {
    const b = load();
    const { plan, skipped } = b.validate({ modules: { store: {
        items: [{ slot: 'badge', id: 'star', name: 'Star', price: 5, icon: 'x' }, { slot: 'nope', id: 'x', name: 'Bad' }],
        hidden: ['avatar:fox', 'bad key', 'zzz:fox']
    } } });
    same(Object.keys(plan.store.items), ['badge:star']); assert.equal(skipped.items, 1);
    same(Object.keys(plan.store.hidden), ['avatar:fox']);
});

test('summary text lists every module and skipped counts', () => {
    const b = load(), { plan } = b.validate(JSON.parse(JSON.stringify(b.build(sample()))));
    const text = b.describe(plan).join('\n');
    for (const word of ['Casual games: 1', 'Quiz: 1 question', 'Store: 1', 'Room & admin settings', 'Players: 1']) assert.ok(text.includes(word), word);
    assert.equal(b.skippedText({ players: 0, games: 2, questions: 1, items: 0 }), 'Skipped invalid entries: 2 games, 1 question.');
    assert.equal(b.skippedText({ players: 0, games: 0, questions: 0, items: 0 }), '');
});

test('quiz order and the on-air position survive export -> import (Previous / Next keep working)', () => {
    const b = load();
    // Legacy record first, then ordered ones; ids deliberately do not sort in the same order.
    const raw = sample();
    raw.quiz = {
        questions: {
            zeta: { prompt: 'Second?', options: ['a', 'b'], correctIndex: 0, order: 0 },
            legacy: { prompt: 'First?', options: ['a', 'b'], correctIndex: 1 },
            alpha: { prompt: 'Third?', options: ['a', 'b'], correctIndex: 0, order: 1 }
        },
        live: { id: 'tok', questionId: 'zeta', index: 1, total: 3, optionsVisible: true, answerVisible: false, question: { prompt: 'Second?', options: ['a', 'b'], correctIndex: 0 } }
    };
    const file = JSON.parse(JSON.stringify(b.build(raw)));
    same(file.modules.quiz.questions.map((q) => q.prompt), ['First?', 'Second?', 'Third?']);
    assert.equal(file.modules.quiz.live.index, 1);

    const { plan } = b.validate(file);
    const stored = Object.entries(plan.quiz.questions).sort((x, y) => x[1].order - y[1].order);
    same(stored.map(([, q]) => q.prompt), ['First?', 'Second?', 'Third?']);
    same(stored.map(([, q]) => q.order), [0, 1, 2]);
    assert.equal(plan.quiz.live.index, 1);
    assert.equal(plan.quiz.live.total, 3);
    assert.equal(plan.quiz.live.question.prompt, 'Second?');
    assert.ok(!('order' in plan.quiz.live.question));
    assert.equal(plan.quiz.questions[plan.quiz.live.questionId].prompt, 'Second?');

    // Skipped (invalid) questions do not leave gaps in the order.
    file.modules.quiz.questions.splice(1, 1, { id: 'bad', prompt: '', options: ['a', 'b'], correctIndex: 0 });
    const gap = b.validate(file);
    same(Object.values(gap.plan.quiz.questions).map((q) => q.order).sort(), [0, 1]);
    assert.equal(gap.skipped.questions, 1);

    // id -> question maps (no array) are accepted and sorted like the app sorts them.
    const mapFile = { modules: { quiz: { questions: raw.quiz.questions } } };
    const fromMap = b.validate(mapFile).plan.quiz.questions;
    same(Object.values(fromMap).sort((x, y) => x.order - y.order).map((q) => q.prompt), ['First?', 'Second?', 'Third?']);
});
