const constants = { PROJECT_ORDER: 'project-order' };
const data = await fetch('scenario-data.json').then(response => response.json());
const nativeClock = { Kr: (get, key) => get('recency', key), RD: 'updated', qM: 'status' };
function nativeOrder({ groups, projectOrder }) {
  return projectOrder.map(id => groups.find(group => group.projectId === id));
}
function nativeThreads({ getRecencyAt, items, sortMode }) {
  return sortMode === 'updated_at' ? [...items].sort((a, b) => getRecencyAt(b) - getRecencyAt(a)) : items;
}
function model(input) {
  const get = (selector, key) => selector === 'status' ? input.statuses?.[key] ?? 'idle' : selector === 'updated' ? input.updatedTimestamps?.[key] ?? input.timestamps[key] : input.timestamps[key];
  const getRecencyAt = key => nativeClock.Kr(get, key);
  const orderByKey = { [constants.PROJECT_ORDER]: input.order };
  let groups = nativeOrder({ groups: input.groups, projectOrder: orderByKey[constants.PROJECT_ORDER] });
  groups = groups.map(group => {
    const threadKeys = nativeThreads({ getRecencyAt, items: group.threadKeys, sortMode: 'updated_at' });
    return { ...group, threadKeys };
  });
  return { projectGroups: groups, navigationThreadKeys: groups.flatMap(group => group.threadKeys) };
}
function nativeLayout(entries, options) {
  const projects = entries.filter(entry => entry.kind === 'project' && !entry.pinned && !entry.custom);
  return { projectKeys: options.projectOrder.filter(key => projects.some(entry => entry.key === key)),
    pinnedKeys: entries.filter(entry => entry.pinned).map(entry => entry.key),
    customKeys: entries.filter(entry => entry.custom).map(entry => entry.key) };
}
function sidebar(input, result) {
  const layoutInput = { projectEntries: result.projectGroups.map(group => ({ key: group.projectId, kind: 'project' })),
    options: { projectOrder: input.order } };
  const otherEntries = [{ key: 'pinned-project', kind: 'project', pinned: true }, { key: 'custom-project', kind: 'project', custom: true }];
  const layout = nativeLayout([...layoutInput.projectEntries, ...otherEntries.filter(entry => entry.kind === 'project')],
    { ...layoutInput.options, getCollapsedAttention: entry => entry.attentionState, pinnedOrder: ['pinned-project'] });
  return { layout };
}
function render(input) {
  const result = model(input);
  const { layout } = sidebar(input, result);
  const navigation = layout.projectKeys.flatMap(key => result.projectGroups.find(group => group.projectId === key).threadKeys);
  document.querySelector('#projects').replaceChildren(...layout.projectKeys.map(key => {
    const item = document.createElement('li');
    item.textContent = key;
    item.dataset.projectId = key;
    return item;
  }));
  globalThis.fixtureResult = { order: layout.projectKeys, navigation, pinned: layout.pinnedKeys, custom: layout.customKeys,
    adapted: globalThis.__codexPlusProjectOrder?.protocol === 8 };
}
globalThis.fixtureUpdate = name => render(data[name]);
render(data.initial);
