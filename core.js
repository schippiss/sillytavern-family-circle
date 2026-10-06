export const KEY = 'family_circle';
export const defaults = () => ({ enabled: false, floating: true, activity: 2, budget: 3500, family: '', people: [], tasks: [], autoTasks: false });
// Snapshots deliberately contain no chat history, arrangements or scene flags.
export function snapshotCircle(settings) {
    return {
        family: String(settings.family || '').slice(0, 600),
        people: settings.people.slice(0, 12).map(p => ({
            name: String(p.name || '').slice(0, 32),
            relation: String(p.relation || '').slice(0, 32),
            kind: p.kind === 'friend' ? 'friend' : 'family',
            description: String(p.description || '').slice(0, 450),
            frequency: Math.max(0, Math.min(5, Math.round(Number(p.frequency) || 0))),
        })),
    };
}
export function applyCircle(settings, snapshot, makeId) {
    const clean = snapshotCircle(snapshot);
    return { ...settings, family: clean.family, people: clean.people.map(p => ({ ...p, id: makeId(), present: false })) };
}
export const RULES = `Family roleplay rules: Relatives know their established family ties, but only know events they witnessed or were explicitly told about. Narrative/lorebook knowledge is not shared knowledge; never invent offscreen disclosure to justify it. Choose natural contact reasons from personality and relationships. New contact is optional, never a quota. Do not initiate calls, messages or visits during intimacy or interrupt urgent/dramatic scenes. No repeated reminders, piled-up greetings or multiple new contacts per reply. Recurring habits follow story time, not message count. Continue existing conversations naturally across turns, responding to the user's actual words; allow warmth, humor, small news and graceful pauses. Never supply the user's words, acceptance of a call, decisions or hang-up. Write a normal RP post but stop where the user's answer is needed; never simulate both sides. Respect the channel: voice calls convey sound, not gestures; bystanders hear only the user's side unless speakerphone is established. Do not force a subplot or a task from every contact.`;
export function readTasks(chat, manual = []) {
    const tasks = new Map();
    for (const message of chat) {
        if (message.is_user || message.is_system) continue;
        for (const match of String(message.mes || '').matchAll(/<!--FC:(\{[^]*?\})\s*-->/g)) {
            if (match[1].length > 1800) continue;
            try {
                const data = JSON.parse(match[1]);
                if (typeof data.id !== 'string' || !/^[a-z0-9_-]{1,40}$/i.test(data.id)) continue;
                if (typeof data.text !== 'string' || !data.text.trim() || data.text.length > 240) continue;
                if (!['pending', 'agreed', 'done', 'cancelled'].includes(data.status)) continue;
                tasks.set(data.id, { id: data.id, text: data.text, status: data.status });
            } catch { /* Ignore malformed model output. */ }
        }
    }
    for (const task of manual) tasks.set(task.id, task);
    return [...tasks.values()];
}
export function buildPrompt(settings, chat) {
    if (!settings.enabled || !settings.people.length) return '';
    const turns = chat.filter(m => m.is_user).length;
    const activity = Math.max(0, Math.min(5, Number(settings.activity) || 0));
    const interval = [0, 18, 12, 8, 5, 3][activity];
    const opportunity = interval > 0 && turns > 0 && turns % interval === 0;
    const recent = chat.slice(-4).map(m => m.mes || '').join('\n').toLocaleLowerCase();
    const present = settings.people.filter(p => p.name && (p.present || recent.includes(p.name.toLocaleLowerCase())));
    const pool = settings.people.filter(p => p.name && Number(p.frequency) > 0);
    const weighted = pool.flatMap(p => Array(Math.min(5, Math.max(1, Number(p.frequency)))).fill(p));
    const candidate = opportunity && weighted.length ? weighted[(Math.floor(turns / interval) - 1) % weighted.length] : null;
    const selected = [...new Set([...present, ...(candidate ? [candidate] : [])])];
    const lines = [RULES, 'These rules apply equally to friends. Friends have their own lives, concerns, boundaries and distinct voices. Use shared history only when established; develop mutual conversation, not generic check-ins or constant favors. The relationship descriptions refer to the current user persona.', candidate ? `Optional new contact opportunity: ${candidate.name}. Skip if inappropriate. If a conversation with a close person is already ongoing, continue it without starting another contact.` : 'Do not initiate a new remote contact this turn. Continue ongoing interactions with close people and respond to user-initiated contact normally.'];
    if (settings.family.trim()) lines.push(`Family and friendship background: ${settings.family.trim()}`);
    // Reserve identity space for everyone before adding optional descriptions.
    lines.push('Close people: ' + settings.people.map(p => `${p.name} (${p.kind === 'friend' ? 'friend; ' : ''}${p.relation})`).join('; '));
    const limit = Math.max(3500, Number(settings.budget) || 3500);
    if (settings.autoTasks) lines.push('Only when an arrangement with family or friends actually changes, append one hidden HTML comment: <!--FC:{"id":"stable_short_id","text":"brief arrangement in chat language","status":"pending"}-->. Reuse id for updates. Status: pending/agreed/done/cancelled. Never assume user consent. No comment when nothing changes.');
    const tasks = readTasks(chat, settings.tasks).filter(t => !['done', 'cancelled'].includes(t.status)).slice(-6);
    for (const task of settings.autoTasks ? tasks : []) {
        const line = `Arrangement ${task.id}: ${task.text} [${task.status}]`;
        if (lines.join('\n').length + line.length + 1 <= limit) lines.push(line);
    }
    for (const [index, person] of selected.entries()) {
        const room = Math.floor((limit - lines.join('\n').length) / (selected.length - index)) - person.name.length - 3;
        if (room > 20) lines.push(`${person.name}: ${person.description.slice(0, Math.min(450, room))}`);
    }
    // UI limits ensure the core + roster fits; never silently cut behavior rules.
    return lines.join('\n');
}
