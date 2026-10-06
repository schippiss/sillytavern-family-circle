import { KEY, defaults, buildPrompt, readTasks, snapshotCircle, applyCircle } from './core.js';

const context = () => SillyTavern.getContext();
const settings = () => ({ ...defaults(), ...context().chatMetadata?.[KEY] });
const hasChat = () => Boolean(context().chatId);
let tab = 'people';
let lastFocus;
const archive = () => context().extensionSettings[KEY]?.archive || [];
function saveArchive(entries) {
    const ctx = context();
    ctx.extensionSettings[KEY] = { ...ctx.extensionSettings[KEY], archive: entries };
    ctx.saveSettingsDebounced();
}
const dialog = document.createElement('dialog');
dialog.id = 'fc-dialog';
dialog.setAttribute('aria-label', 'Близкие — семейная динамика');
document.body.append(dialog);
function el(tag, text, attrs = {}) {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    return node;
}
function button(text, action) {
    const node = el('button', text, { type: 'button' });
    node.addEventListener('click', action);
    return node;
}
function save(data) {
    if (!hasChat()) return;
    context().chatMetadata[KEY] = data;
    context().saveMetadataDebounced();
    updateFloat();
    context().setExtensionPrompt(KEY, '', 1, 1, false, 0);
}
function field(parent, title, value, change, { type = 'text', max = 450, min = 0, upper = 5 } = {}) {
    const label = el('label', title);
    const input = el(type === 'textarea' ? 'textarea' : 'input');
    if (type !== 'textarea') input.type = type;
    if (type === 'checkbox') input.checked = Boolean(value);
    else input.value = value;
    if (type === 'range') { input.min = min; input.max = upper; input.step = 1; }
    else input.maxLength = max;
    input.addEventListener('change', () => change(type === 'checkbox' ? input.checked : type === 'range' ? Number(input.value) : input.value));
    label.append(input);
    parent.append(label);
    return input;
}
function statusSelect(value, change) {
    const select = el('select', '', { 'aria-label': 'Статус договорённости' });
    for (const [key, label] of Object.entries({ pending: 'Ждёт ответа', agreed: 'Договорились', done: 'Выполнено', cancelled: 'Отменено' })) {
        const option = el('option', label, { value: key });
        select.append(option);
    }
    select.value = value;
    select.addEventListener('change', () => change(select.value));
    return select;
}
function render() {
    dialog.replaceChildren();
    const header = el('header');
    header.append(el('h2', 'Близкие'), button('Закрыть', () => dialog.close()));
    dialog.append(header);
    if (!hasChat()) { dialog.append(el('p', 'Сначала открой чат. Семья и встречи сохраняются отдельно для каждой истории.')); return; }
    const s = settings();
    const nav = el('nav', '', { 'aria-label': 'Разделы' });
    for (const [id, title] of [['people', 'Семья и друзья'], ['tasks', 'Дела и встречи'], ['archive', 'Архив близких'], ['settings', 'Настройки']]) {
        const b = button(title, () => { tab = id; render(); });
        b.setAttribute('aria-selected', String(tab === id));
        nav.append(b);
    }
    dialog.append(nav);
    if (tab === 'people') {
        field(dialog, 'Общие связи семьи и друзей', s.family, value => { s.family = value; save(s); }, { type: 'textarea', max: 600 });
        dialog.append(el('p', 'Кто кому приходится, кто с кем дружит, общие привычки и отношения. До 600 символов. Карточки — до 450 символов; максимум 12 близких. Этот состав принадлежит только открытому чату.', { class: 'fc-muted' }));
        for (const person of s.people) {
            const card = el('article');
            const grid = el('div', '', { class: 'fc-grid' });
            field(grid, 'Имя', person.name, v => { person.name = v; save(s); }, { max: 32 });
            field(grid, 'Кем приходится', person.relation, v => { person.relation = v; save(s); }, { max: 32 });
            card.append(grid);
            const kindLabel = el('label', 'Тип связи');
            const kind = el('select');
            kind.append(el('option', 'Родственник', { value: 'family' }), el('option', 'Друг / подруга', { value: 'friend' }));
            kind.value = person.kind || 'family';
            kind.addEventListener('change', () => { person.kind = kind.value; save(s); });
            kindLabel.append(kind); card.append(kindLabel);
            const description = field(card, 'Характер, отношения, привычки и собственная жизнь', person.description, v => { person.description = v; save(s); }, { type: 'textarea' });
            description.placeholder = 'Например: подруга со студенчества, сухой юмор, готовится к переезду. Поддерживает без сюсюканья, иногда хочет просто поболтать.';
            field(card, `Инициатива: ${person.frequency} / 5`, person.frequency, v => { person.frequency = v; save(s); render(); }, { type: 'range' });
            field(card, 'Участвует в текущей сцене', person.present, v => { person.present = v; save(s); }, { type: 'checkbox' });
            card.append(button('Убрать из близких', () => { s.people = s.people.filter(p => p.id !== person.id); save(s); render(); }));
            dialog.append(card);
        }
        const addPerson = kind => {
            s.people.push({ id: crypto.randomUUID(), kind, name: '', relation: kind === 'friend' ? 'друг / подруга' : '', description: '', frequency: 2, present: false });
            save(s); render();
        };
        const add = button('Добавить родственника', () => addPerson('family'));
        const addFriend = button('Добавить друга', () => addPerson('friend'));
        add.disabled = s.people.length >= 12;
        addFriend.disabled = add.disabled;
        dialog.append(add, addFriend);
    } else if (tab === 'archive') {
        dialog.append(el('p', 'Сохрани семью и друзей как отдельный набор для новых чатов и персон. В архив входят карточки и общие связи; поручения, история общения и участие в сцене не переносятся. Архив хранится в настройках твоего аккаунта SillyTavern.', { class: 'fc-muted' }));
        let title = '';
        const titleInput = field(dialog, 'Название сохранения', '', value => { title = value.trim(); }, { max: 80 });
        titleInput.placeholder = 'Например: близкие Анны — современность';
        const notice = el('p', '', { role: 'status' });
        dialog.append(button('Сохранить текущих близких', () => {
            title = titleInput.value.trim();
            if (!title || !s.people.some(p => p.name.trim())) { notice.textContent = 'Укажи название и добавь хотя бы одного близкого с именем.'; return; }
            saveArchive([...archive(), { id: crypto.randomUUID(), title, created: new Date().toISOString(), circle: snapshotCircle(s) }]);
            render();
        }), notice);
        if (!archive().length) dialog.append(el('p', 'Сохранений пока нет. Новый чат начинает с пустого состава.'));
        for (const entry of archive()) {
            const card = el('article');
            card.append(el('strong', entry.title), el('p', entry.circle.people.map(p => `${p.name} — ${p.relation}`).join('; ')));
            const preview = el('details');
            preview.append(el('summary', 'Посмотреть сохранение'), el('p', entry.circle.family));
            for (const p of entry.circle.people) preview.append(el('p', `${p.name}: ${p.description}`));
            card.append(preview);
            const actions = el('div', '', { class: 'fc-row' });
            actions.append(button('Использовать в этом чате…', () => {
                actions.replaceChildren(el('p', 'Заменить состав близких? Дела и настройки этого чата останутся. После загрузки проверь имена и отношения для выбранной персоны.'));
                actions.append(button('Заменить состав близких', () => {
                    save(applyCircle(settings(), entry.circle, () => crypto.randomUUID()));
                    tab = 'people'; render();
                }), button('Отмена', render));
            }), button('Удалить сохранение…', () => {
                actions.replaceChildren(el('p', 'Удалить только это сохранение из архива? Близкие в чатах останутся.'));
                actions.append(button('Удалить из архива', () => { saveArchive(archive().filter(x => x.id !== entry.id)); render(); }), button('Отмена', render));
            }));
            card.append(actions); dialog.append(card);
        }
    } else if (tab === 'tasks') {
        dialog.append(el('p', 'Только поручения и встречи. Звонки и переписка остаются в РП-чате.', { class: 'fc-muted' }));
        const tasks = readTasks(s.autoTasks ? context().chat : [], s.tasks);
        if (!tasks.length) dialog.append(el('p', 'Пока никаких договорённостей.'));
        for (const task of tasks) {
            const card = el('article');
            const update = () => { s.tasks = [...s.tasks.filter(t => t.id !== task.id), task]; save(s); };
            field(card, 'Договорённость', task.text, v => { task.text = v; update(); }, { max: 240 });
            card.append(statusSelect(task.status, v => { task.status = v; update(); }));
            dialog.append(card);
        }
        dialog.append(button('Добавить запись', () => {
            s.tasks.push({ id: crypto.randomUUID(), text: 'Новая договорённость', status: 'pending' });
            save(s); render();
        }));
    } else {
        field(dialog, 'Включить семейную динамику в этом чате', s.enabled, v => { s.enabled = v; save(s); }, { type: 'checkbox' });
        dialog.append(el('p', 'Выключение сразу убирает инструкцию расширения из следующих генераций. Карточки и архив сохраняются. Уже написанные в чате события остаются в истории.', { class: 'fc-muted' }));
        field(dialog, 'Показывать плавающие ладони', s.floating, v => { s.floating = v; save(s); }, { type: 'checkbox' });
        field(dialog, `Общая активность: ${s.activity} / 5`, s.activity, v => { s.activity = v; save(s); render(); }, { type: 'range' });
        dialog.append(el('p', '0 — только общение, начатое игроком. 1–5 — возможность нового контакта раз в 18 / 12 / 8 / 5 / 3 хода игрока. Модель может пропустить её. Это не часы внутри истории.', { class: 'fc-muted' }));
        field(dialog, 'Автоматически учитывать договорённости', s.autoTasks, v => { s.autoTasks = v; save(s); }, { type: 'checkbox' });
        dialog.append(el('p', 'Добавляет инструкцию и короткий скрытый комментарий при изменении договорённости. Отдельного запроса нет. Ручная правка имеет приоритет. Распознавание зависит от модели.', { class: 'fc-muted' }));
        field(dialog, `Бюджет текста: ${s.budget} символов`, s.budget, v => { s.budget = v; save(s); render(); }, { type: 'range', min: 3500, upper: 6000 });
        dialog.append(el('p', 'Символы не равны токенам. Число токенов зависит от модели и языка. Сначала сохраняются правила и состав семьи; подробности распределяются между актуальными карточками.', { class: 'fc-muted' }));
        const preview = el('details');
        preview.append(el('summary', 'Какой текст будет добавлен в контекст'));
        const prompt = buildPrompt(s, context().chat);
        preview.append(el('p', `${prompt.length} символов`), el('pre', prompt || 'Промпт пуст: расширение выключено или нет близких.'));
        dialog.append(preview);
    }
}
function open(section) { tab = section; lastFocus = document.activeElement; render(); if (!dialog.open) dialog.showModal(); }
dialog.addEventListener('close', () => lastFocus?.focus());
const floating = button('', () => open('tasks'));
floating.id = 'fc-float';
floating.title = 'Близкие: дела и встречи';
floating.setAttribute('aria-label', floating.title);
// Local vector: two open palms holding a small heart, no font or network dependency.
floating.innerHTML = '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 27H8L3 17V7a2 2 0 0 1 4 0v8l4 4-2-5a2 2 0 0 1 3-2l4 8v7M19 27h5l5-10V7a2 2 0 0 0-4 0v8l-4 4 2-5a2 2 0 0 0-3-2l-4 8"/><path d="M16 11s-5-3-5-6a2.7 2.7 0 0 1 5-1 2.7 2.7 0 0 1 5 1c0 3-5 6-5 6Z"/></svg>';
document.body.append(floating);
function updateFloat() { floating.hidden = !hasChat() || !settings().floating; }
function addMenu() {
    if (document.getElementById('fc-menu')) return;
    const menu = document.getElementById('extensionsMenu');
    if (!menu) return;
    const entry = button('Близкие · Семейная динамика', () => {
        open('people');
        if (globalThis.jQuery) globalThis.jQuery(menu).hide();
    });
    entry.id = 'fc-menu';
    entry.className = 'list-group-item flex-container flexGap5';
    menu.append(entry);
}
globalThis.familyCircleBeforeGenerate = async (_chat, _size, _abort, type) => {
    const ctx = context();
    ctx.setExtensionPrompt(KEY, '', 1, 1, false, 0);
    if (!hasChat() || ['quiet', 'impersonate'].includes(type)) return;
    // Use the full current branch, so retrying or swiping never advances the scheduler.
    ctx.setExtensionPrompt(KEY, buildPrompt(settings(), ctx.chat), 1, 1, false, 0);
};
const ctx = context();
ctx.eventSource.on(ctx.eventTypes.CHAT_CHANGED, () => {
    ctx.setExtensionPrompt(KEY, '', 1, 1, false, 0);
    if (dialog.open) dialog.close();
    updateFloat();
});
for (const key of ['MESSAGE_RECEIVED', 'MESSAGE_SWIPED', 'MESSAGE_DELETED', 'MESSAGE_EDITED']) {
    if (ctx.eventTypes[key]) ctx.eventSource.on(ctx.eventTypes[key], () => { if (dialog.open && tab === 'tasks') render(); });
}
addMenu();
if (ctx.eventTypes.APP_READY) ctx.eventSource.on(ctx.eventTypes.APP_READY, addMenu);
updateFloat();
