// Polls Azure DevOps for the signed-in user's open pull requests across every project in an org,
// and (when a project + team are set) their backlog items in that team's current sprint.
// Auth: AZURE_DEVOPS_PAT if set (needs Code: Read), otherwise an Azure CLI token (`az login`).
import { execFile } from 'node:child_process';

const ADO_RESOURCE = '499b84ac-1321-427f-aa17-267ca6aba798'; // Azure DevOps app id, for az tokens
const API = 'api-version=7.1';

export class AzDoPrs {
  constructor({ org, tenant, project, team, intervalMs = 60_000 }) {
    this.base = `https://dev.azure.com/${encodeURIComponent(org)}`;
    this.org = org;
    this.tenant = tenant;
    this.project = project;
    this.team = team;
    this.intervalMs = intervalMs;
    this.state = { org, prs: [], error: null, sprint: null, fetchedAt: 0 };
    this.token = null;
    this.userId = null;
  }

  start() {
    this.refresh();
    setInterval(() => this.refresh(), this.intervalMs);
  }

  snapshot() { return this.state; }

  async auth() {
    const pat = process.env.AZURE_DEVOPS_PAT;
    if (pat) return `Basic ${Buffer.from(`:${pat}`).toString('base64')}`;
    if (this.token && this.token.expires - Date.now() > 5 * 60_000) return `Bearer ${this.token.value}`;
    const args = ['account', 'get-access-token', '--resource', ADO_RESOURCE, '-o', 'json'];
    if (this.tenant) args.push('--tenant', this.tenant);
    const out = await new Promise((resolve, reject) => execFile('az', args, { timeout: 30_000 }, (err, stdout, stderr) => {
      if (err) reject(new Error(err.code === 'ENOENT'
        ? 'Azure CLI not found. Install it or set AZURE_DEVOPS_PAT.'
        : `az can't get an Azure DevOps token (${(stderr || err.message).match(/AADSTS\d+|ERROR: [^.\n]*/)?.[0] ?? 'unknown error'}). Run az login --tenant <ADO tenant> and set --ado-tenant, or set AZURE_DEVOPS_PAT.`));
      else resolve(stdout);
    }));
    const t = JSON.parse(out);
    this.token = { value: t.accessToken, expires: t.expires_on ? t.expires_on * 1000 : Date.parse(t.expiresOn) };
    return `Bearer ${this.token.value}`;
  }

  async get(path, version = API, init = {}) {
    const res = await fetch(`${this.base}/${path}${path.includes('?') ? '&' : '?'}${version}`, {
      ...init,
      headers: { Authorization: await this.auth(), Accept: 'application/json', ...init.headers },
      redirect: 'manual', // ADO redirects to a sign-in page instead of returning 401
    });
    if (res.status === 401 || res.status === 203 || (res.status >= 300 && res.status < 400)) {
      this.token = null;
      throw new Error(`Azure DevOps rejected the credentials for ${this.org}`);
    }
    if (!res.ok) {
      const msg = await res.json().then((b) => b.message, () => '');
      throw new Error(`Azure DevOps ${res.status} on ${path.split('?')[0]}${msg ? `: ${msg}` : ''}`);
    }
    return res.json();
  }

  post(path, body) {
    return this.get(path, API, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
  }

  async refresh() {
    const [prs, sprint] = await Promise.all([
      this.refreshPrs().then((items) => ({ items }), (e) => ({ error: e.message })),
      this.team ? this.refreshSprint().catch((e) => ({ error: e.message })) : null,
    ]);
    this.state = {
      org: this.org,
      prs: prs.items ?? this.state.prs,
      error: prs.error ?? null,
      sprint: sprint && (sprint.error ? { ...this.state.sprint, error: sprint.error } : sprint),
      fetchedAt: Date.now(),
    };
  }

  async me() {
    if (!this.userId) this.userId = (await this.get('_apis/connectionData', `${API}-preview`)).authenticatedUser.id;
    return this.userId;
  }

  async refreshPrs() {
    const userId = await this.me();
    const projects = (await this.get('_apis/projects?$top=500')).value;
    const lists = await Promise.all(projects.map((p) => this.get(
      `${encodeURIComponent(p.id)}/_apis/git/pullrequests?searchCriteria.status=active&searchCriteria.creatorId=${userId}&$top=100`,
    ).then((r) => r.value).catch(() => [])));
    return lists.flat().map((pr) => ({
      id: pr.pullRequestId,
      title: pr.title,
      repo: pr.repository.name,
      project: pr.repository.project.name,
      source: pr.sourceRefName.replace('refs/heads/', ''),
      target: pr.targetRefName.replace('refs/heads/', ''),
      draft: !!pr.isDraft,
      createdAt: Date.parse(pr.creationDate),
      mergeStatus: pr.mergeStatus,
      // vote: 10 approved, 5 approved w/ suggestions, 0 none, -5 waiting, -10 rejected
      approvals: pr.reviewers.filter((r) => r.vote >= 5).length,
      rejected: pr.reviewers.some((r) => r.vote === -10),
      waiting: pr.reviewers.some((r) => r.vote === -5),
      reviewers: pr.reviewers.filter((r) => !r.isContainer).length,
      url: `${this.base}/${encodeURIComponent(pr.repository.project.name)}/_git/${encodeURIComponent(pr.repository.name)}/pullrequest/${pr.pullRequestId}`,
    })).sort((a, b) => b.createdAt - a.createdAt);
  }

  // Backlog items (stories/bugs) assigned to me in the team's current iteration.
  async refreshSprint() {
    const team = `${encodeURIComponent(this.project)}/${encodeURIComponent(this.team)}`;
    const iter = (await this.get(`${team}/_apis/work/teamsettings/iterations?$timeframe=current`)).value[0];
    if (!iter) return { name: null, stories: [], error: `No current iteration for ${this.team}` };
    const path = iter.path.replace(/'/g, "''");
    const wiql = await this.post(`${team}/_apis/wit/wiql`, {
      query: `SELECT [System.Id] FROM WorkItems WHERE [System.IterationPath] = '${path}' AND [System.AssignedTo] = @Me
        AND [System.WorkItemType] IN GROUP 'Microsoft.RequirementCategory' AND [System.State] <> 'Removed' ORDER BY [Microsoft.VSTS.Common.BacklogPriority]`,
    });
    const ids = wiql.workItems.map((w) => w.id).slice(0, 200);
    const fields = ['System.Title', 'System.State', 'System.WorkItemType', 'System.BoardColumn', 'System.Tags',
      'Microsoft.VSTS.Scheduling.StoryPoints', 'System.ChangedDate'];
    const items = ids.length
      ? (await this.get(`${encodeURIComponent(this.project)}/_apis/wit/workitems?ids=${ids.join(',')}&fields=${fields.join(',')}`)).value
      : [];
    const order = new Map(ids.map((id, i) => [id, i]));
    const columns = await this.get(`${team}/_apis/work/boards/Stories/columns`)
      .then((r) => r.value.map((c) => c.name), () => []);
    return {
      columns,
      name: iter.name,
      path: iter.path,
      start: Date.parse(iter.attributes.startDate),
      end: Date.parse(iter.attributes.finishDate),
      boardUrl: `${this.base}/${encodeURIComponent(this.project)}/_boards/board/t/${encodeURIComponent(this.team)}/Stories?System.IterationPath=%40currentIteration`,
      stories: items.map((w) => ({
        id: w.id,
        title: w.fields['System.Title'],
        state: w.fields['System.State'],
        type: w.fields['System.WorkItemType'],
        column: w.fields['System.BoardColumn'] || w.fields['System.State'],
        points: w.fields['Microsoft.VSTS.Scheduling.StoryPoints'] ?? null,
        tags: w.fields['System.Tags'] ? w.fields['System.Tags'].split(';').map((t) => t.trim()) : [],
        changedAt: Date.parse(w.fields['System.ChangedDate']),
        url: `${this.base}/${encodeURIComponent(this.project)}/_workitems/edit/${w.id}`,
      })).sort((a, b) => order.get(a.id) - order.get(b.id)),
      error: null,
    };
  }
}
