import {execFile} from 'node:child_process';

const origin = 'https://smartshadow.ai';
export function workspacePath(request) {
  const page = request.page ?? 1;
  if (!Number.isSafeInteger(page) || page < 1) throw Error('invalid_workspace_request');
  if (request.operation === 'repositories') {
    if (!['felixlark', 'smart-shadow'].includes(request.organization)) throw Error('invalid_workspace_request');
    return `/api/v2/event-workspace/repositories?${new URLSearchParams({organization: request.organization, page})}`;
  }
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(request.repository ?? '') || request.repository.split('/').some(p => ['.', '..'].includes(p))) throw Error('invalid_workspace_request');
  const query = new URLSearchParams({repository: request.repository});
  if (request.operation === 'issues') { query.set('page', page); return `/api/v2/event-workspace/issues?${query}`; }
  if (!['issue', 'coordination'].includes(request.operation) || !Number.isSafeInteger(request.number) || request.number < 1) throw Error('invalid_workspace_request');
  return `/api/v2/event-workspace/issues/${request.number}${request.operation === 'coordination' ? '/coordination' : ''}?${query}`;
}

// Official Access client owns its credentials. Never read or export its token,
// cookie store, auth URL or stderr. No shell, redirects, caller URL or headers.
export class TaskWorkspaceClient {
  constructor(execute = execFile) { this.execute = execute; this.children = new Set(); }
  readJSON(path) {
    return new Promise((resolve, reject) => {
      const child = this.execute('/opt/homebrew/bin/cloudflared', ['access', 'curl', origin + path,
        '--silent', '--show-error', '--header', `Origin: ${origin}`, '--write-out', '\n%{http_code}'],
      {encoding: 'utf8', maxBuffer: Infinity}, (error, stdout) => {
        this.children.delete(child);
        if (error) { reject(Error('workspace_transport_unavailable')); return; }
        const boundary = stdout.lastIndexOf('\n'), code = Number(stdout.slice(boundary + 1));
        if (code !== 200) { reject(Error(`workspace_http_${Number.isInteger(code) ? code : 'unknown'}`)); return; }
        let value; try { value = JSON.parse(stdout.slice(0, boundary)); } catch { reject(Error('workspace_auth_or_response_unavailable')); return; }
        resolve(value);
      });
      this.children.add(child);
    });
  }
  async read(request) {
    const path = workspacePath(request);
    const session = await this.readJSON('/api/v2/session');
    if (session.status !== 'ok' || session.authentication !== 'cloudflare_access' || typeof session.subject !== 'string' || !session.subject) throw Error('workspace_human_session_required');
    const value = await this.readJSON(path);
    if (['repositories', 'issues'].includes(request.operation)) {
      if (!Array.isArray(value.items) || !(value.next_page === null || Number.isSafeInteger(value.next_page) && value.next_page > (request.page ?? 1))) throw Error('workspace_response_invalid');
    } else if (request.operation === 'issue') {
      if (value.issue?.repository !== request.repository || value.issue?.number !== request.number) throw Error('workspace_response_scope_changed');
    } else if (!Array.isArray(value.coordination?.actions)) throw Error('workspace_response_invalid');
    return value;
  }
  close() { for (const child of this.children) child.kill(); }
}
