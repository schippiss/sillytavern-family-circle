import test from 'node:test';
import assert from 'node:assert/strict';
import { defaults, buildPrompt, readTasks, RULES, snapshotCircle, applyCircle } from '../core.js';
const person = { name: 'Нина', relation: 'бабушка', description: 'Ласковая, любит открытки.', frequency: 2 };
const setup = () => ({ ...defaults(), enabled: true, people: [{ ...person }] });
const turns = n => Array.from({ length: n }, () => ({ is_user: true, mes: 'Продолжаю прогулку.' }));
test('Disabled extension adds no tokens', () => assert.equal(buildPrompt(defaults(), turns(12)), ''));
test('Low activity is deterministic across retries and only opens an opportunity', () => {
    const s = setup();
    assert.match(buildPrompt(s, turns(11)), /Do not initiate a new remote contact/);
    assert.match(buildPrompt(s, turns(12)), /Optional new contact opportunity: Нина/);
    assert.equal(buildPrompt(s, turns(12)), buildPrompt(s, turns(12)));
    s.activity = 0;
    assert.doesNotMatch(buildPrompt(s, turns(12)), /Optional new contact opportunity/);
});
test('Ongoing and present relatives retain descriptions between opportunities', () => {
    assert.match(buildPrompt(setup(), [{ mes: 'Нина звонит.' }]), /Ласковая/);
    const s = setup(); s.people[0].present = true;
    assert.match(buildPrompt(s, []), /Ласковая/);
    s.people[0].present = false;
    assert.doesNotMatch(buildPrompt(s, []), /Ласковая/);
});
test('Full family fits budget without cutting rules or dropping identities', () => {
    const s = setup(); s.family = 'я'.repeat(600); s.autoTasks = true;
    s.people = Array.from({ length: 12 }, (_, i) => ({ ...person, kind: 'friend', name: String(i).padEnd(32, 'я'), relation: 'я'.repeat(32), description: 'я'.repeat(450), present: true }));
    const prompt = buildPrompt(s, []);
    assert.ok(prompt.length <= s.budget, `${prompt.length} > ${s.budget}`);
    assert.ok(prompt.startsWith(RULES));
    for (const p of s.people) assert.ok(prompt.includes(p.name));
});
test('Archive is a detached reusable circle, without source chat state', () => {
    const source = setup();
    source.people[0].kind = 'friend'; source.people[0].present = true;
    source.family = 'Друзья со школы'; source.tasks = [{ id: 'old', text: 'Старое дело', status: 'agreed' }];
    const snapshot = snapshotCircle(source);
    assert.deepEqual(Object.keys(snapshot).sort(), ['family', 'people']);
    assert.equal(snapshot.people[0].present, undefined);
    const next = defaults();
    const loaded = applyCircle(next, snapshot, () => 'new-id');
    assert.equal(loaded.enabled, false);
    assert.deepEqual(loaded.tasks, []);
    assert.equal(loaded.people[0].present, false);
    assert.equal(loaded.people[0].kind, 'friend');
    assert.equal(loaded.people[0].id, 'new-id');
    loaded.people[0].description = 'Другая история';
    assert.equal(snapshot.people[0].description, person.description);
    assert.equal(source.people[0].description, person.description);
    assert.deepEqual(next.people, []);
});
test('Loading a circle preserves destination preferences and arrangements', () => {
    const target = { ...defaults(), enabled: true, activity: 4, tasks: [{ id: 'here', text: 'Дело этого чата' }] };
    const result = applyCircle(target, snapshotCircle(setup()), () => 'id');
    assert.equal(result.enabled, true);
    assert.equal(result.activity, 4);
    assert.deepEqual(result.tasks, target.tasks);
});
test('Friend participates in contact selection, with independent-life instruction', () => {
    const s = setup(); s.people[0].kind = 'friend';
    const prompt = buildPrompt(s, turns(12));
    assert.match(prompt, /Optional new contact opportunity: Нина/);
    assert.match(prompt, /Friends have their own lives/);
    assert.match(prompt, /friend;/);
    s.enabled = false;
    assert.equal(buildPrompt(s, turns(12)), '');
});
test('Task memory follows current branch, validates output, and respects manual correction', () => {
    const msg = (status, text = 'Ужин') => ({ mes: `<!--FC:${JSON.stringify({ id: 'dinner', text, status })}-->` });
    assert.equal(readTasks([msg('pending'), msg('agreed')])[0].status, 'agreed');
    assert.equal(readTasks([msg('pending')])[0].status, 'pending');
    assert.deepEqual(readTasks([{ ...msg('agreed'), is_user: true }, msg('bogus'), { mes: '<!--FC:{bad}-->' }]), []);
    assert.equal(readTasks([msg('agreed')], [{ id: 'dinner', text: 'Другой ужин', status: 'cancelled' }])[0].status, 'cancelled');
});
