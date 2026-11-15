// Runs only in the exact owned desktop target. The original Codex UI continues
// to own its chats, composer, projects and permissions; no phone UI changes.
export function installWorkbenchView(config) {
  const previous = globalThis.__codexPlusWorkbench;
  if (previous?.nonce === config.nonce) return previous.status();
  previous?.dispose();
  const host = document.createElement('aside'); host.lang = 'zh-CN';
  host.setAttribute('aria-label', 'Smart Shadow 任务工作台');
  host.style.cssText = 'position:fixed;inset:48px 12px 12px auto;width:min(460px,calc(100vw - 24px));z-index:10000;pointer-events:none;';
  const root = host.attachShadow({mode: 'open'}), pending = new Map();
  const node = (tag, text, parent = root) => { const e = document.createElement(tag); if (text != null) e.textContent = text; parent.append(e); return e; };
  const style = node('style'); style.textContent = `
    :host{font:14px/1.5 system-ui;color:#212121;color-scheme:light dark}
    *{box-sizing:border-box}button,select{font:inherit;min-height:36px;padding:5px 10px;border:1px solid #9998;border-radius:7px;background:Canvas;color:CanvasText}
    button{cursor:pointer}button:disabled{cursor:default;opacity:.55}button:focus-visible,select:focus-visible,.scroll:focus-visible{outline:3px solid #2879dd;outline-offset:2px}
    .shell{pointer-events:auto;background:Canvas;color:CanvasText;border:1px solid #8886;border-radius:12px;box-shadow:0 4px 24px #0002;max-height:100%;overflow:auto}
    header{position:sticky;top:0;background:Canvas;z-index:2;padding:12px;border-bottom:1px solid #8885;display:flex;align-items:center;gap:8px}h2{font-size:16px;margin:0;flex:1}h3{font-size:15px;margin:14px 0 8px}
    .body{padding:12px}.row{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin-block:8px}select{max-width:100%}p{margin-block:8px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}
    .scroll{overflow:auto;max-height:35vh;container-type:inline-size}table{border-collapse:separate;border-spacing:0;width:100%}caption{text-align:start;font-weight:600;padding-block:6px}th,td{text-align:start;vertical-align:top;padding:6px;border-bottom:1px solid #8884}thead{position:sticky;top:0;background:Canvas}td:first-child{min-width:200px}td button{text-align:start;width:100%;border:0}a{color:LinkText}.error{color:#b03737}.muted{opacity:.75}.detail{border-top:1px solid #8885;margin-top:12px}
    @container(width < 360px){thead{display:none}table,tbody,tr,td{display:block}tr{border-bottom:1px solid #8885}td{border:0}td:nth-child(2)::before{content:'状态：'}td:first-child{min-width:0}}
  `;
  const shell = node('div'); shell.className = 'shell';
  const header = node('header', null, shell); node('h2', '任务工作台', header);
  const toggle = node('button', '收起', header); toggle.type = 'button'; toggle.setAttribute('aria-expanded', 'true');
  const body = node('div', null, shell); body.className = 'body';
  toggle.onclick = () => { body.hidden = !body.hidden; toggle.textContent = body.hidden ? '任务工作台' : '收起'; toggle.setAttribute('aria-expanded', String(!body.hidden)); };
  const filters = node('div', null, body); filters.className = 'row';
  node('label', '组织', filters).htmlFor = 'organization';
  const organization = node('select', null, filters); organization.id = 'organization';
  for (const name of ['felixlark', 'smart-shadow']) { const option = node('option', name, organization); option.value = name; }
  node('label', '仓库', filters).htmlFor = 'repository';
  const repository = node('select', null, filters); repository.id = 'repository';
  const initial = node('option', config.repository, repository); initial.value = config.repository;
  const controls = node('div', null, body); controls.className = 'row';
  const refresh = node('button', '刷新', controls); refresh.type = 'button';
  const moreRepos = node('button', '更多仓库', controls); moreRepos.type = 'button'; moreRepos.hidden = true;
  const notice = node('p', '正在读取正式任务来源…', body); notice.setAttribute('role', 'status');
  const scroll = node('div', null, body); scroll.className = 'scroll'; scroll.tabIndex = 0; scroll.setAttribute('role', 'region'); scroll.setAttribute('aria-label', '任务列表');
  const table = node('table', null, scroll); node('caption', 'GitHub 事项', table);
  const head = node('thead', null, table), headings = node('tr', null, head);
  for (const text of ['事项', '状态']) node('th', text, headings).scope = 'col';
  const rows = node('tbody', null, table), more = node('button', '更多事项', body); more.type = 'button'; more.hidden = true;
  const detail = node('section', null, body); detail.className = 'detail';
  let repoPage = null, issuePage = null, generation = 0, selection = 0, disposed = false, busy = false;
  const request = payload => new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID(); pending.set(requestId, {resolve, reject});
    try { globalThis[config.binding](JSON.stringify({version: 1, nonce: config.nonce, requestId, ...payload})); }
    catch { pending.delete(requestId); reject(Error('workbench_connection_unavailable')); }
  });
  function message(text, error = false) { notice.textContent = text; notice.className = error ? 'error' : 'muted'; }
  function describeError(error) {
    const http = /^workspace_http_(\d+)$/.exec(error.message)?.[1];
    if (http === '401' || http === '403' || error.message === 'workspace_human_session_required') return '本人身份未通过，请在 Mac 核对 Access 登录后刷新。';
    if (http && http !== '0') return `任务服务暂未完成读取（HTTP ${http}），请稍后刷新。`;
    if (error.message === 'workbench_action_unavailable') return '此会话尚不能由本机工作台打开。';
    return '任务服务连接或返回内容未能确认，请稍后刷新。';
  }
  async function perform(action) {
    if (busy || disposed) return;
    busy = true; refresh.disabled = organization.disabled = repository.disabled = more.disabled = moreRepos.disabled = true;
    try { await action(); } catch (error) { message(describeError(error), true); }
    finally { busy = false; refresh.disabled = organization.disabled = repository.disabled = more.disabled = moreRepos.disabled = false; }
  }
  async function issues(page = 1, current = generation) {
    const repo = repository.value;
    if (!repo) { rows.replaceChildren(); detail.replaceChildren(); selection++; message('请选择仓库；尚未列出时可读取更多仓库。'); return; }
    const value = await request({action: 'read', operation: 'issues', repository: repo, page});
    if (current !== generation || disposed) return;
    if (page === 1) { rows.replaceChildren(); detail.replaceChildren(); selection++; }
    for (const issue of value.items) {
      const row = node('tr', null, rows), cell = node('td', null, row);
      const button = node('button', `#${issue.number} ${issue.title}`, cell); button.type = 'button';
      button.onclick = () => perform(() => showIssue(repo, issue.number)); node('td', issue.state, row);
    }
    issuePage = value.next_page; more.hidden = issuePage === null;
    message(`已读取 ${rows.children.length} 项 · ${value.observed_at ?? '时间未知'}${issuePage !== null ? ' · 还有下一页' : ''}`);
  }
  async function repositories(page = 1) {
    const current = ++generation, selected = repository.value;
    const value = await request({action: 'read', operation: 'repositories', organization: organization.value, page});
    if (current !== generation || disposed) return;
    if (page === 1) {
      repository.replaceChildren(); const placeholder = node('option', '请选择仓库', repository); placeholder.value = '';
      // The current explicitly selected repository is not necessarily on this
      // catalog page. Preserve it; never silently read the first unrelated repo.
      if (selected.startsWith(organization.value + '/')) { const option = node('option', selected, repository); option.value = selected; }
    }
    for (const repo of value.items) if (![...repository.options].some(o => o.value === repo.full_name)) { const option = node('option', repo.full_name, repository); option.value = repo.full_name; }
    repository.value = [...repository.options].some(o => o.value === selected) ? selected : '';
    repoPage = value.next_page; moreRepos.hidden = repoPage === null;
    await issues(1, current);
  }
  async function showIssue(repo, number) {
    const current = ++selection;
    const value = await request({action: 'read', operation: 'issue', repository: repo, number});
    if (current !== selection || disposed) return;
    detail.replaceChildren(); node('h3', `#${number} ${value.issue.title}`, detail);
    const link = node('a', '在 GitHub 查看', detail); link.href = `https://github.com/${repo}/issues/${number}`; link.target = '_blank'; link.rel = 'noopener noreferrer';
    const source = node('details', null, detail); node('summary', '原案内容', source); node('pre', value.issue.body ?? '', source);
    const runs = node('div', null, detail); node('p', '正在读取实际执行回执…', runs);
    try {
      const result = await request({action: 'read', operation: 'coordination', repository: repo, number});
      if (current !== selection || disposed) return;
      runs.replaceChildren();
      const actions = result.coordination.actions;
      if (!actions.length) node('p', '尚未观察到 Run', runs);
      for (const action of actions) {
        node('p', `${action.state} · ${action.host_id} · Run ${action.run_id ?? '尚未观察到'}`, runs);
        if (action.thread_id && action.run_id) {
          const open = node('button', '打开原 Codex 会话', runs); open.type = 'button';
          open.onclick = () => perform(async () => { await request({action: 'open-thread', hostId: action.host_id, threadId: action.thread_id, runId: action.run_id}); });
        }
      }
    } catch (error) { if (current === selection) { runs.replaceChildren(); const p = node('p', `执行回执读取未完成：${describeError(error)}`, runs); p.className = 'error'; } }
  }
  refresh.onclick = () => perform(() => repositories());
  organization.onchange = () => perform(() => repositories());
  repository.onchange = () => perform(() => { generation++; return issues(); });
  moreRepos.onclick = () => perform(() => repositories(repoPage));
  more.onclick = () => perform(() => issues(issuePage));
  document.body.append(host);
  const api = {
    nonce: config.nonce,
    status: () => ({nonce: config.nonce, ready: host.isConnected}),
    resolve(id, result) { const waiter = pending.get(id); if (!waiter) return; pending.delete(id); result.ok ? waiter.resolve(result.value) : waiter.reject(Error(result.error)); },
    dispose() { disposed = true; host.remove(); for (const waiter of pending.values()) waiter.reject(Error('workbench_closed')); pending.clear(); },
  };
  globalThis.__codexPlusWorkbench = api;
  void perform(() => repositories());
  return api.status();
}
