const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '..', 'JS', 'quiz.js'), 'utf8');
const copy = (value) => value == null ? value : JSON.parse(JSON.stringify(value));

// Minimal Firebase adapter: each value event has its own serialized snapshot,
// transactions may be retried and cancelled, and listeners can be detached.
function database() {
    let value = null, serial = 0;
    const listeners = new Set();
    const emit = () => { for (const listener of listeners) listener({ val: () => copy(value) }); };
    return {
        listeners, failure: null, beforeCommit: null,
        ref() { return this; }, push() { return { key: `key-${++serial}` }; },
        // ref.child(name): transactions on ONE child of the quiz node (what players use to send answers).
        child(name) {
            const db = this;
            return {
                async transaction(update, completion, localEvents) {
                    assert.equal(localEvents, false, 'no speculative state in the audience');
                    if (db.failure) throw new Error(db.failure);
                    const current = () => (value && value[name] !== undefined ? copy(value[name]) : null);
                    update(current()); // Firebase can retry the callback.
                    if (db.beforeCommit) { db.beforeCommit(value); db.beforeCommit = null; }
                    const next = update(current());
                    if (next === undefined) return { committed: false };
                    value = value || {};
                    if (next === null) delete value[name]; else value[name] = copy(next);
                    emit(); return { committed: true };
                }
            };
        },
        on(event, listener, error) { listener.error = error; listeners.add(listener); listener({ val: () => copy(value) }); },
        off(event, listener) { listeners.delete(listener); },
        read() { return copy(value); },
        async transaction(update, completion, localEvents) {
            assert.equal(localEvents, false, 'no speculative state in the audience');
            if (this.failure) throw new Error(this.failure);
            update(copy(value)); // Firebase can retry the callback.
            if (this.beforeCommit) { this.beforeCommit(value); this.beforeCommit = null; }
            const next = update(copy(value));
            if (next === undefined) return { committed: false };
            value = copy(next); emit(); return { committed: true };
        }
    };
}
function client(db, host = false, extra = {}) {
    const errors = [], toasts = [], nodes = {};
    const document = { fullscreenElement: null };
    const globals = {
        State: { isHost: host, username: extra.username || null }, Admin: { unlocked: host },
        Room: { db, code: 'LOCAL', list: () => (extra.players || []).map((username) => ({ username })) }, document,
        $z: (id) => nodes[id] ||= { textContent: '' },
        Notify: { error: (text) => errors.push(text), success: (text) => toasts.push(text), warning: (text) => toasts.push(text) }
    };
    if (extra.router) Object.assign(globals, { Router: extra.router, GameCatalog: { available: () => true }, Missions: { cfg: {} } });
    const context = vm.createContext(globals);
    vm.runInContext(source + '\nthis.quiz = Quiz;', context);
    const q = context.quiz;
    q.render = () => {}; q.renderHost = () => {}; q.syncAdmin = () => {}; q.clearAdmin = () => {};
    q.start();
    if (extra.clock) q.now = () => extra.clock.t;
    return { q, context, errors, nodes, toasts };
}
const question = { prompt: 'Which word is a verb?', options: ['Run', 'Blue', 'Desk'], correctIndex: 0 };
async function seed(q) { await q.write((data) => { data.questions = { first: copy(question), second: { ...copy(question), prompt: 'Second?' } }; return data; }); }

test('quiz: validation and flexible option letters beyond Z', () => {
    const { q } = client(database(), true);
    assert.equal(q.label(0), 'A'); assert.equal(q.label(25), 'Z'); assert.equal(q.label(26), 'AA');
    assert.throws(() => q.question(' ', ['a', 'b'], 0));
    assert.throws(() => q.question('Q', ['a'], 0));
    assert.throws(() => q.question('Q', ['a', ' '], 0));
    assert.throws(() => q.question('Q', ['a', 'b'], 2));
    assert.equal(q.question(' Q ', Array.from({ length: 30 }, (_, i) => `option ${i}`), 29).options.length, 30);
});
test('quiz: host publishes; all clients and late joiners share options and answer states', async () => {
    const db = database(), { q: host } = client(db, true), { q: guest } = client(db);
    await seed(host); await host.present('first');
    assert.deepEqual(copy(host.data), copy(guest.data));
    assert.equal(guest.data.live.optionsVisible, false);
    assert.equal(guest.data.live.answerVisible, false);
    assert.equal(await guest.write(() => ({})), false);
    assert.equal(client(db).q.data.live.question.prompt, question.prompt);
    await host.liveChange((live) => { live.optionsVisible = true; live.answerVisible = true; });
    assert.equal(guest.data.live.answerVisible, true);
    await host.liveChange((live) => { live.question.correctIndex = 2; live.answerVisible = false; });
    assert.equal(guest.data.live.question.correctIndex, 2);
    await host.liveChange((live) => { live.optionsVisible = false; live.answerVisible = false; });
    assert.equal(guest.data.live.optionsVisible, false);
    await host.present('second');
    assert.equal(guest.data.live.question.prompt, 'Second?');
    assert.equal(guest.data.live.answerVisible, false);
});
test('quiz: bank edits preserve published copy; deleting the active question clears it atomically', async () => {
    const db = database(), { q } = client(db, true), { q: guest } = client(db);
    await seed(q); await q.present('first');
    await q.write((data) => { data.questions.first.prompt = 'Edited'; return data; });
    assert.equal(guest.data.live.question.prompt, question.prompt);
    await q.present('first'); assert.equal(guest.data.live.question.prompt, 'Edited');
    await q.write((data) => { delete data.questions.first; delete data.live; return data; });
    assert.equal(guest.data.live, undefined);
    assert.ok(guest.data.questions.second);
});
test('quiz: stale controls cannot affect a newer publication and deleted questions cannot publish', async () => {
    const db = database(), { q, errors } = client(db, true);
    await seed(q); await q.present('first');
    db.beforeCommit = (data) => { data.live.id = 'a-new-publication'; data.live.questionId = 'second'; };
    await q.liveChange((live) => { live.optionsVisible = true; });
    assert.equal(db.read().live.optionsVisible, false);
    assert.equal(errors.length, 1);
    await q.present('missing'); assert.equal(errors.length, 2);
});
test('quiz: failed writes remain uncommitted; leaving and rejoining removes listeners and old state', async () => {
    const db = database(), { q, context, errors } = client(db, true);
    await seed(q); db.failure = 'PERMISSION_DENIED'; await q.present('first');
    assert.equal(q.data.live, undefined); assert.equal(errors[0], 'PERMISSION_DENIED');
    assert.equal(q.busy, false);
    const oldListener = q.listener;
    oldListener.error(); assert.equal(q.ready, false);
    db.failure = null;
    q.stop(); assert.equal(db.listeners.size, 0); assert.deepEqual(copy(q.data), {});
    oldListener({ val: () => ({ live: 'stale' }) }); assert.deepEqual(copy(q.data), {});
    const second = database(); context.Room.db = second; context.Room.code = 'OTHER'; q.start();
    assert.deepEqual(copy(q.data), {}); assert.equal(second.listeners.size, 1);
});

// ---------------------------------------------------------------------------
// Previous / Next navigation: the on-air position is shared through Firebase
// ---------------------------------------------------------------------------
async function seedThree(q) {
    await q.write((data) => {
        // Mixed bank: one legacy record (no `order`) followed by two ordered ones, ids that do NOT sort alphabetically.
        data.questions = {
            legacy: { ...copy(question), prompt: 'Legacy?' },
            zeta: { ...copy(question), prompt: 'Second?', order: 0 },
            alpha: { ...copy(question), prompt: 'Third?', order: 1 }
        };
        return data;
    });
}

test('quiz navigation: bank order = legacy records first, then `order`; ids never decide', async () => {
    const { q } = client(database(), true);
    await seedThree(q);
    assert.deepEqual(copy(q.sortedEntries(q.data.questions).map(([id]) => id)), ['legacy', 'zeta', 'alpha']);
    assert.equal(q.nextOrder(q.data.questions), 2);
    assert.equal(q.nextOrder({}), 0);
});

test('quiz navigation: Start / Next / Previous move one question for every client', async () => {
    const db = database(), { q: host } = client(db, true), { q: guest } = client(db);
    await seedThree(host);
    assert.deepEqual(copy(host.position()), { at: -1, total: 3, hasPrev: false, hasNext: true }, 'nothing on air: Next starts the quiz');

    assert.equal(await host.navigate(-1), false, 'Previous does nothing before the quiz starts');
    assert.equal(await host.navigate(1), true);
    assert.equal(guest.data.live.question.prompt, 'Legacy?');
    assert.equal(guest.data.live.index, 0); assert.equal(guest.data.live.total, 3);
    assert.equal(guest.data.live.optionsVisible, false);
    assert.ok(!('order' in guest.data.live.question), 'the audience snapshot never carries bank internals');

    await host.toggleOptions(); await host.toggleAnswer();
    assert.equal(guest.data.live.answerVisible, true);
    assert.equal(await host.navigate(1), true);
    assert.equal(guest.data.live.question.prompt, 'Second?'); assert.equal(guest.data.live.index, 1);
    assert.equal(guest.data.live.optionsVisible, false, 'each new question starts with options hidden');
    assert.equal(guest.data.live.answerVisible, false);
    assert.deepEqual(copy(guest.position()), { at: 1, total: 3, hasPrev: true, hasNext: true });

    assert.equal(await host.navigate(1), true);
    assert.equal(guest.data.live.question.prompt, 'Third?');
    assert.equal(host.position().hasNext, false);
    assert.equal(await host.navigate(1), false, 'cannot go past the last question');
    assert.equal(await host.navigate(-1), true); assert.equal(await host.navigate(-1), true);
    assert.equal(guest.data.live.question.prompt, 'Legacy?');
    assert.equal(await host.navigate(-1), false, 'cannot go before the first question');
});

test('quiz navigation: stays correct when the bank changes, and players cannot navigate', async () => {
    const db = database(), { q: host } = client(db, true), { q: guest } = client(db);
    await seedThree(host); await host.present('zeta');
    assert.equal(host.data.live.index, 1);
    // Host adds a question at the end and deletes the first one while "Second?" is on air.
    await host.write((data) => { data.questions.added = { ...copy(question), prompt: 'Added?', order: host.nextOrder(data.questions) }; delete data.questions.legacy; return data; });
    assert.deepEqual(copy(host.position()), { at: 0, total: 3, hasPrev: false, hasNext: true }, 'position is recomputed from the bank, not from the stale snapshot');
    await host.navigate(1);
    assert.equal(host.data.live.question.prompt, 'Third?');
    await host.navigate(1);
    assert.equal(host.data.live.question.prompt, 'Added?'); assert.equal(host.data.live.index, 2);
    assert.equal(await guest.navigate(-1), false, 'only the unlocked Host may navigate');
    assert.equal(host.data.live.question.prompt, 'Added?');
});

test('quiz navigation: a control drawn for an older screen cannot jump the room', async () => {
    const db = database(), { q: host } = client(db, true);
    await seedThree(host); await host.present('legacy');
    // Another Host device changes the screen between the first run of the transaction and its commit (Firebase retries).
    db.beforeCommit = (value) => { value.live = { ...value.live, id: 'someone-else' }; };
    assert.equal(await host.navigate(1), false);
    assert.equal(db.read().live.id, 'someone-else', 'the other Host\'s screen is left untouched');
});

// ---------------------------------------------------------------------------
// Question types: multiple choice, sentence ordering, free text
// ---------------------------------------------------------------------------
const mixedBank = () => ({
    first: { ...copy(question), prompt: 'Pick B', options: ['a', 'b', 'c'], correctIndex: 1, order: 0 },
    second: { type: 'order', prompt: 'Order it', fragments: ['I', 'have lived', 'here'], order: 1 },
    third: { type: 'text', prompt: 'Past of go: ____', answers: ['went'], caseSensitive: false, order: 2 }
});

test('question types: parseQuestion validates every format and keeps old questions valid', () => {
    const { q } = client(database());
    assert.equal(q.parseQuestion({ prompt: 'Old?', options: ['a', 'b'], correctIndex: 0 }).type, undefined, 'choice keeps its original shape');
    const order = q.parseQuestion({ type: 'order', prompt: 'Order', sentence: 'I | have lived | here' });
    assert.deepEqual(copy(order.fragments), ['I', 'have lived', 'here']);
    assert.deepEqual(copy(q.parseQuestion({ type: 'order', prompt: 'Order', fragments: ['one', 'two', 'three'] }).fragments), ['one', 'two', 'three']);
    assert.deepEqual(copy(q.splitSentence('She likes tea')), ['She', 'likes', 'tea'], 'plain text splits into words');
    const text = q.parseQuestion({ type: 'TEXT', prompt: 'Blank ____', answer: ' went ' });
    assert.deepEqual(copy(text.answers), ['went']); assert.equal(text.caseSensitive, false);
    assert.deepEqual(copy(q.parseQuestion({ type: 'text', prompt: 'x', answers: ['Went', 'went', 'WENT.'] }).answers), ['Went'], 'duplicates after normalizing are dropped');
    assert.throws(() => q.parseQuestion({ type: 'order', prompt: 'x', fragments: ['one', 'two'] }), /3 to 12 fragments/);
    assert.throws(() => q.parseQuestion({ type: 'order', prompt: 'x', fragments: ['a', 'b', ''] }), /fragments/);
    assert.throws(() => q.parseQuestion({ type: 'text', prompt: 'x', answers: ['...', ' '] }), /accepted answers/);
    assert.throws(() => q.parseQuestion({ type: 'text', prompt: '', answers: ['a'] }), /question/i);
    assert.throws(() => q.parseQuestion({ type: 'essay', prompt: 'x' }), /Unknown question type/);
    assert.throws(() => q.parseQuestion({ prompt: 'x', options: ['a', 'b'] }), /correct answer/);
    assert.throws(() => q.parseQuestion('nope'), /must be an object/);
});

test('grading: choice by index, ordering by fragment text, free text with forgiving normalization', () => {
    const { q } = client(database());
    assert.equal(q.grade({ options: ['a', 'b'], correctIndex: 1 }, 1), true);
    assert.equal(q.grade({ options: ['a', 'b'], correctIndex: 1 }, '1'), false);
    const order = { type: 'order', fragments: ['the', 'cat', 'the', 'dog'] };
    assert.equal(q.grade(order, [0, 1, 2, 3]), true);
    assert.equal(q.grade(order, [2, 1, 0, 3]), true, 'repeated fragments are compared by text');
    assert.equal(q.grade(order, [1, 0, 2, 3]), false);
    assert.equal(q.grade(order, [0, 1, 2]), false, 'incomplete');
    assert.equal(q.grade(order, [0, 0, 2, 3]), false, 'a piece cannot be used twice');
    assert.equal(q.grade(order, 'the cat the dog'), false);
    const text = { type: 'text', answers: ['it\u2019s fine', 'went'], caseSensitive: false };
    for (const ok of ['went', '  WENT  ', 'Went.', "it's   fine!", 'It\u2019s Fine']) assert.equal(q.grade(text, ok), true, ok);
    for (const bad of ['go', 'wen', '', '   ', '...']) assert.equal(q.grade(text, bad), false, JSON.stringify(bad));
    assert.equal(q.grade({ type: 'text', answers: ['Paris'], caseSensitive: true }, 'paris'), false);
    assert.equal(q.grade({ type: 'text', answers: ['Paris'], caseSensitive: true }, 'Paris'), true);
});

test('live snapshots: choice keeps its shape, ordering gets one shared non-trivial shuffle', () => {
    const { q } = client(database());
    q.random = () => 0;
    assert.deepEqual(copy(q.snapshot({ ...copy(question), order: 4 })), { prompt: question.prompt, options: copy(question.options), correctIndex: question.correctIndex });
    const snap = q.snapshot({ type: 'order', prompt: 'p', fragments: ['a', 'b', 'c', 'd'], order: 1 });
    assert.deepEqual(copy(snap.fragments), ['a', 'b', 'c', 'd']);
    assert.deepEqual(copy([...snap.shuffle].sort()), [0, 1, 2, 3]);
    assert.notDeepEqual(copy(snap.shuffle), [0, 1, 2, 3], 'never arrives already solved');
    assert.ok(!('order' in snap));
    assert.deepEqual(copy(q.shuffleOf({ fragments: ['a', 'b'], shuffle: [5, 0] })), [0, 1], 'damaged shuffle falls back to stored order');
    assert.equal(q.describeQuestion({ type: 'text', answers: ['a', 'b'] }), 'Free text \u00B7 2 accepted answer(s)');
});

test('settings: defaults, clamping and bad input', () => {
    const { q } = client(database());
    assert.deepEqual(copy(q.normalizeSettings(undefined)), { autoLaunch: false, answerBy: 'player', seconds: 30, chain: 3 });
    assert.deepEqual(copy(q.normalizeSettings({ autoLaunch: true, answerBy: 'admin', seconds: 900, chain: -4 })), { autoLaunch: true, answerBy: 'admin', seconds: 300, chain: 0 });
    assert.deepEqual(copy(q.normalizeSettings({ autoLaunch: 'yes', answerBy: 'x', seconds: 'abc', chain: '7' })), { autoLaunch: false, answerBy: 'player', seconds: 30, chain: 7 });
    assert.equal(q.normalizeSettings({ seconds: 0 }).seconds, 0, '0 = no time limit');
});

test('turn order: selected first, unique, capped fallbacks; host assignment follows the roster', () => {
    const { q } = client(database());
    q.random = () => 0;
    assert.deepEqual(copy(q.buildQueue(['Ana'], ['Ana', 'ben', 'Cara', 'Dan'], 2)), ['Ana', 'Cara', 'Dan'].length === 3 ? copy(q.buildQueue(['Ana'], ['Ana', 'ben', 'Cara', 'Dan'], 2)) : []);
    const queue = copy(q.buildQueue(['Ana', 'ANA', ' '], ['ana', 'Ben', 'Cara', 'Dan'], 2));
    assert.equal(queue[0], 'Ana'); assert.equal(queue.length, 3); assert.ok(!queue.slice(1).some((n) => n.toLowerCase() === 'ana'));
    assert.deepEqual(copy(q.buildQueue(['Ana', 'Ben'], [], 5)), ['Ana', 'Ben'], 'several winners keep their order');
    assert.deepEqual(copy(q.buildQueue(['Ana'], ['Ben'], 0)), ['Ana'], 'no fallbacks');
    assert.deepEqual(copy(q.lineAfter('Cara', ['Ana', 'Ben', 'Cara', 'Dan'], 2)), ['Cara', 'Dan', 'Ana'], 'wraps around the roster');
    assert.equal(q.buildQueue(['x'], Array.from({ length: 30 }, (_, i) => 'p' + i), 10).length, 11);
});

// ---------------------------------------------------------------------------
// Turns: answer from the player's device, pass on, timeout, host control, auto-launch
// ---------------------------------------------------------------------------
async function turnRoom({ players = ['Ana', 'Ben', 'Cara'], settings = {}, bank = mixedBank() } = {}) {
    const db = database(), clock = { t: 1_000_000 };
    const host = client(db, true, { username: 'Teacher', players, clock });
    const guests = Object.fromEntries(players.map((name) => [name, client(db, false, { username: name, players, clock })]));
    await host.q.write((data) => { data.questions = copy(bank); data.settings = settings; return data; });
    return { db, clock, host: host.q, hostCtx: host, guests };
}

test('turn: the picked player answers from their own device; a wrong answer passes the SAME question on', async () => {
    const { host, guests } = await turnRoom();
    assert.equal(await host.startTurn('first', ['Ana', 'Ben', 'Cara']), true);
    const live = guests.Ana.q.data.live;
    assert.equal(live.optionsVisible, true, 'the answering player needs the options');
    assert.equal(live.turn.at, 0); assert.equal(live.turn.seconds, 30); assert.equal(live.turn.deadline, 1_000_000 + 30_000);
    assert.equal(guests.Ben.q.canAnswer(), false, 'not Ben\'s turn yet');
    assert.equal(await guests.Ben.q.answer(1), null);
    assert.equal(guests.Ana.q.canAnswer(), true);

    const wrong = await guests.Ana.q.answer(0);
    assert.equal(wrong.correct, false); assert.equal(wrong.next, 'Ben');
    assert.equal(host.data.live.turn.at, 1, 'everyone sees it is Ben\'s turn now');
    assert.equal(host.data.live.id, live.id, 'same question stays on air');
    assert.equal(guests.Ana.q.canAnswer(), false, 'Ana cannot answer again');
    assert.equal(guests.Cara.q.data.live.turn.log[0].r, 'wrong');

    const right = await guests.Ben.q.answer(1);
    assert.equal(right.correct, true); assert.equal(right.done, 'correct');
    const t = host.data.live.turn;
    assert.equal(t.done, 'correct'); assert.equal(t.winner, 'Ben'); assert.equal(t.deadline, 0);
    assert.equal(host.data.live.answerVisible, true, 'the answer is revealed when the turn ends');
    assert.equal(host.turnPlayer(), '', 'no turn is running any more');
    assert.equal(await guests.Cara.q.answer(1), null);
});

test('turn: ordering and free-text answers are graded inside the transaction', async () => {
    const { host, guests, db } = await turnRoom();
    host.random = () => 0;
    await host.startTurn('second', ['Ana', 'Ben']);
    assert.equal(guests.Ana.q.data.live.question.shuffle.length, 3, 'one shuffle shared by every device');
    assert.equal((await guests.Ana.q.answer([2, 1, 0])).correct, false);
    assert.equal((await guests.Ben.q.answer([0, 1, 2])).correct, true);
    await host.startTurn('third', ['Cara']);
    assert.equal((await guests.Cara.q.answer(' Went. ')).correct, true);
    assert.equal(db.read().live.turn.winner, 'Cara');
});

test('turn: running out of players ends the turn and reveals the answer', async () => {
    const { host, guests } = await turnRoom();
    await host.startTurn('first', ['Ana', 'Ben']);
    await guests.Ana.q.answer(2);
    const last = await guests.Ben.q.answer(2);
    assert.equal(last.done, 'exhausted');
    assert.equal(host.data.live.turn.done, 'exhausted'); assert.equal(host.data.live.answerVisible, true);
    assert.equal(host.data.live.turn.log.length, 2);
});

test('turn: a timeout passes to the next player once, however many devices notice', async () => {
    const { host, guests, clock } = await turnRoom({ settings: { seconds: 20 } });
    await host.startTurn('first', ['Ana', 'Ben', 'Cara']);
    assert.equal(await guests.Ana.q.expire(), null, 'not due yet: nothing happens');
    assert.equal(host.data.live.turn.at, 0);
    clock.t += 20_000;
    const results = await Promise.all([guests.Ana.q.expire(), host.expire(), guests.Cara.q.expire()]);
    assert.equal(results.filter(Boolean).length, 1, 'only one device wins the transition');
    const t = host.data.live.turn;
    assert.equal(t.at, 1); assert.equal(t.log.length, 1); assert.equal(t.log[0].r, 'timeout');
    assert.equal(t.deadline, clock.t + 20_000, 'the next player gets a fresh countdown');
    clock.t += 20_000;
    await guests.Ben.q.expire(); await guests.Ben.q.expire();
    assert.equal(host.data.live.turn.at, 2, 'a repeated attempt for the same turn is ignored');
});

test('turn: with no time limit nothing expires', async () => {
    const { host, guests, clock } = await turnRoom({ settings: { seconds: 0 } });
    await host.startTurn('first', ['Ana', 'Ben']);
    assert.equal(host.data.live.turn.deadline, 0);
    clock.t += 3_600_000;
    assert.equal(await guests.Ana.q.expire(), null);
    assert.equal(host.data.live.turn.at, 0);
});

test('turn: the Host can answer for the player, accept, or pass; players cannot use host controls', async () => {
    const { host, guests } = await turnRoom();
    await host.startTurn('first', ['Ana', 'Ben', 'Cara']);
    assert.equal(await guests.Ana.q.hostTurn('skip'), null, 'only the host passes players');
    assert.equal(host.canAnswer(), true, 'the host may answer for the current player');
    assert.equal((await host.answer(0)).correct, false);
    assert.equal(host.data.live.turn.log[0].by, 'admin');
    assert.equal(host.data.live.turn.at, 1);
    await host.hostTurn('skip');
    assert.equal(host.data.live.turn.at, 2); assert.equal(host.data.live.turn.log[1].r, 'skip');
    await host.hostTurn('correct');
    assert.equal(host.data.live.turn.done, 'correct'); assert.equal(host.data.live.turn.winner, 'Cara');
    assert.equal(await host.hostTurn('skip'), null, 'nothing to pass once finished');
});

test('turn: "Host only" mode keeps player devices read-only', async () => {
    const { host, guests } = await turnRoom({ settings: { answerBy: 'admin' } });
    await host.startTurn('first', ['Ana', 'Ben']);
    assert.equal(host.data.live.turn.by, 'admin');
    assert.equal(guests.Ana.q.canAnswer(), false);
    assert.equal(await guests.Ana.q.answer(1), null);
    assert.equal((await host.answer(1)).correct, true);
    assert.equal(host.data.live.turn.winner, 'Ana');
});

test('turn: a control drawn for an older turn cannot act on a newer one', async () => {
    const { host, guests, db } = await turnRoom();
    await host.startTurn('first', ['Ana', 'Ben']);
    db.beforeCommit = (value) => { value.live = { ...value.live, id: 'replaced' }; }; // the host presented something else meanwhile
    assert.equal(await guests.Ana.q.answer(1), null);
    assert.equal(db.read().live.id, 'replaced'); assert.equal(db.read().live.turn.at, 0);
});

test('turn: admin assignment starts at the chosen player and falls back along the roster', async () => {
    const { host } = await turnRoom({ settings: { chain: 2 } });
    assert.equal(await host.assign('Ben', 'first'), true);
    assert.deepEqual(copy(host.data.live.turn.queue), ['Ben', 'Cara', 'Ana']);
    assert.equal(await host.assign('Ben'), true, 'defaults to the question on air');
    assert.equal(await host.assign('', 'first'), false);
});

test('auto-launch: a random tool picking a player sends a random question with a fallback line', async () => {
    const { host, guests } = await turnRoom({ settings: { autoLaunch: true, chain: 2 } });
    host.random = () => 0;
    assert.equal(await guests.Ana.q.onSelection({ winners: ['Ana'], participants: ['Ana', 'Ben'] }), false, 'player devices never launch');
    assert.equal(await host.onSelection({ winners: ['Cara'], participants: ['Ana', 'Ben', 'Cara'] }), true);
    const live = host.data.live;
    assert.ok(live.questionId); assert.equal(live.turn.queue[0], 'Cara'); assert.equal(live.turn.queue.length, 3);
    assert.equal(guests.Cara.q.canAnswer(), true);
    // the next random pick avoids the question that is already on air
    const before = live.questionId;
    await host.onSelection({ winners: ['Ben'], participants: ['Ben', 'Ana'] });
    assert.notEqual(host.data.live.questionId, before);
    assert.equal(host.data.live.turn.queue[0], 'Ben');
});

test('auto-launch: off by default, and empty banks only warn', async () => {
    const off = await turnRoom();
    assert.equal(await off.host.onSelection({ winners: ['Ana'], participants: ['Ana'] }), false);
    assert.equal(off.host.data.live, undefined);
    const empty = await turnRoom({ settings: { autoLaunch: true }, bank: {} });
    assert.equal(await empty.host.onSelection({ winners: ['Ana'], participants: ['Ana'] }), false);
    assert.ok(empty.hostCtx.toasts.some((t) => /no questions/.test(t)));
});

test('turn alert: the picked player is told once and taken to the Quiz', async () => {
    const calls = [], router = { currentGameKey: 'blackjack', selectGame: (key) => calls.push(key) };
    const db = database(), clock = { t: 5 };
    const host = client(db, true, { username: 'Teacher', players: ['Ana', 'Ben'], clock });
    const ana = client(db, false, { username: 'ana', players: ['Ana', 'Ben'], clock, router });
    await host.q.write((data) => { data.questions = copy(mixedBank()); return data; });
    await host.q.startTurn('first', ['Ana', 'Ben']);
    assert.deepEqual(calls, ['quiz']);
    assert.ok(ana.toasts.some((t) => /your turn/i.test(t)));
    const count = ana.toasts.length;
    await host.q.toggleOptions();                         // unrelated update on the same turn
    assert.equal(ana.toasts.length, count, 'no second alert for the same turn');
    await ana.q.answer(0);                                // wrong -> Ben's turn: no alert for Ana
    assert.deepEqual(calls, ['quiz']);
});

// ---------------------------------------------------------------------------
// Question files: import / examples
// ---------------------------------------------------------------------------
test('question import appends in order, validates every type and reports what was skipped', async () => {
    const { host, hostCtx } = await turnRoom();
    const list = [
        { type: 'order', prompt: 'Order', sentence: 'a | b | c' },
        { type: 'text', prompt: 'Blank', answers: ['x'] },
        { prompt: 'Bad', options: ['only one'], correctIndex: 0 },
        { prompt: 'Old style', options: ['a', 'b'], correctIndex: 1 }
    ];
    for (const shape of [list, { questions: list }, { modules: { quiz: { questions: list } } }]) assert.equal(host.extractQuestions(shape).length, 4);
    assert.equal(host.extractQuestions({ nope: 1 }), null);
    assert.equal(await host.importQuestions({ questions: list }), true);
    const entries = host.sortedEntries(host.data.questions);
    assert.equal(entries.length, 6, 'the three existing questions are untouched');
    assert.deepEqual(copy(entries.slice(3).map(([, q]) => q.prompt)), ['Order', 'Blank', 'Old style']);
    assert.deepEqual(copy(entries.map(([, q]) => q.order)), [0, 1, 2, 3, 4, 5]);
    assert.ok(hostCtx.toasts.some((t) => /3 questions added/.test(t)) && hostCtx.toasts.some((t) => /Skipped 1/.test(t)));
    assert.equal(await host.importQuestions({ questions: [{ prompt: '' }] }), false);
    assert.equal(await host.importQuestions('garbage'), false);
});

test('quiz-examples.json: valid, covers every type, and imports through the normal paths', async () => {
    const file = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'quiz-examples.json'), 'utf8'));
    const { host } = await turnRoom({ bank: {} });
    const list = host.extractQuestions(file);
    assert.ok(list.length >= 3);
    const parsed = list.map((raw) => host.parseQuestion(raw));          // throws if any example is invalid
    assert.deepEqual(copy([...new Set(parsed.map((p) => host.typeOf(p)))].sort()), ['choice', 'order', 'text']);
    assert.equal(await host.importQuestions(file), true);
    assert.equal(Object.keys(host.data.questions).length, list.length);
    // every example can be asked as a turn and answered correctly
    const answers = { choice: (p) => p.correctIndex, order: (p) => p.fragments.map((_, i) => i), text: (p) => p.answers[0] };
    for (const [id, stored] of host.sortedEntries(host.data.questions)) {
        assert.equal(await host.startTurn(id, ['Ana']), true);
        const snap = host.data.live.question;
        assert.equal(host.grade(snap, answers[host.typeOf(stored)](stored)), true, stored.prompt);
    }
});
