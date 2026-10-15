const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('JS/quiz.js', 'utf8');
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
function client(db, host = false) {
    const errors = [], nodes = {};
    const document = { fullscreenElement: null };
    const context = vm.createContext({
        State: { isHost: host }, Admin: { unlocked: host },
        Room: { db, code: 'LOCAL' }, document,
        $z: (id) => nodes[id] ||= { textContent: '' },
        Notify: { error: (text) => errors.push(text) }
    });
    vm.runInContext(source + '\nthis.quiz = Quiz;', context);
    const q = context.quiz;
    q.render = () => {}; q.renderHost = () => {}; q.syncAdmin = () => {}; q.clearAdmin = () => {};
    q.start();
    return { q, context, errors, nodes };
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
