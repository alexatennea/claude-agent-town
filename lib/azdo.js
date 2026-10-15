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
    this.doneCache = new Map(); // work item id -> { changedAt, doneAt }
    this.intervalMs = intervalMs;
    this.state = { org, prs: [], reviews: [], error: null, sprint: null, fetchedAt: 0 };
    this.token = null;
    this.userId = null;
  }

  start() { this.refresh(); }

  setIntervalMs(ms) {
    this.intervalMs = ms;
    this.schedule();
  }

  schedule() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.refresh(), this.intervalMs);
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

  // One fetch at a time; a refresh asked for mid-fetch shares the running one. Each run reschedules the next.
  refresh() {
    this.running ??= this.fetchAll().finally(() => { this.running = null; this.schedule(); });
    return this.running;
  }

  async fetchAll() {
    const [prs, sprint] = await Promise.all([
      this.refreshPrs().catch((e) => ({ error: e.message })),
      this.team ? this.refreshSprint().catch((e) => ({ error: e.message })) : null,
    ]);
    this.state = {
      org: this.org,
      prs: prs.mine ?? this.state.prs,
      reviews: prs.reviews ?? this.state.reviews,
      error: prs.error ?? null,
      sprint: sprint && (sprint.error ? { ...this.state.sprint, error: sprint.error } : sprint),
      fetchedAt: Date.now(),
    };
  }

  async me() {
    if (!this.userId) this.userId = (await this.get('_apis/connectionData', `${API}-preview`)).authenticatedUser.id;
    return this.userId;
  }

  // Active PRs I created, and active non-draft PRs where I'm named as a reviewer (not via a group).
  async refreshPrs() {
    const userId = await this.me();
    const projects = (await this.get('_apis/projects?$top=500')).value;
    const search = (criteria) => Promise.all(projects.map((p) => this.get(
      `${encodeURIComponent(p.id)}/_apis/git/pullrequests?searchCriteria.status=active&searchCriteria.${criteria}=${userId}&$top=100`,
    ).then((r) => r.value).catch(() => []))).then((l) => l.flat().map((pr) => this.pr(pr, userId)).sort((a, b) => b.createdAt - a.createdAt));
    const [mine, reviews] = await Promise.all([search('creatorId'), search('reviewerId')]);
    return { mine, reviews: reviews.filter((pr) => !pr.draft && pr.authorId !== userId) };
  }

  pr(pr, userId) {
    const me = pr.reviewers.find((r) => r.id === userId);
    return {
      id: pr.pullRequestId,
      title: pr.title,
      repo: pr.repository.name,
      project: pr.repository.project.name,
      source: pr.sourceRefName.replace('refs/heads/', ''),
      target: pr.targetRefName.replace('refs/heads/', ''),
      author: pr.createdBy.displayName,
      authorId: pr.createdBy.id,
      draft: !!pr.isDraft,
      createdAt: Date.parse(pr.creationDate),
      mergeStatus: pr.mergeStatus,
      // vote: 10 approved, 5 approved w/ suggestions, 0 none, -5 waiting, -10 rejected
      approvals: pr.reviewers.filter((r) => r.vote >= 5).length,
      rejected: pr.reviewers.some((r) => r.vote === -10),
      waiting: pr.reviewers.some((r) => r.vote === -5),
      reviewers: pr.reviewers.filter((r) => !r.isContainer).length,
      myVote: me ? me.vote : null,
      iAmRequired: !!me?.isRequired,
      url: `${this.base}/${encodeURIComponent(pr.repository.project.name)}/_git/${encodeURIComponent(pr.repository.name)}/pullrequest/${pr.pullRequestId}`,
    };
  }

  // Backlog items (stories/bugs/spikes) on the team's board in the current iteration; `stories` is the
  // subset assigned to me, `team` is everyone's.
  async refreshSprint() {
    const team = `${encodeURIComponent(this.project)}/${encodeURIComponent(this.team)}`;
    const iter = (await this.get(`${team}/_apis/work/teamsettings/iterations?$timeframe=current`)).value[0];
    if (!iter) return { name: null, stories: [], team: [], error: `No current iteration for ${this.team}` };
    const q = (s) => `'${s.replace(/'/g, "''")}'`;
    const areas = (await this.get(`${team}/_apis/work/teamsettings/teamfieldvalues`)).values
      .map((v) => `[System.AreaPath] ${v.includeChildren ? 'UNDER' : '='} ${q(v.value)}`).join(' OR ');
    const where = `[System.IterationPath] = ${q(iter.path)} AND (${areas})
      AND [System.WorkItemType] IN GROUP 'Microsoft.RequirementCategory' AND [System.State] <> 'Removed'`;
    const order = 'ORDER BY [Microsoft.VSTS.Common.BacklogPriority]';
    const [all, mine, columns] = await Promise.all([
      this.post(`${team}/_apis/wit/wiql`, { query: `SELECT [System.Id] FROM WorkItems WHERE ${where} ${order}` }),
      this.post(`${team}/_apis/wit/wiql`, { query: `SELECT [System.Id] FROM WorkItems WHERE ${where} AND [System.AssignedTo] = @Me ${order}` }),
      this.get(`${team}/_apis/work/boards/Stories/columns`).then((r) => r.value, () => []),
    ]);
    const ids = all.workItems.map((w) => w.id);
    const fields = ['System.Title', 'System.State', 'System.WorkItemType', 'System.BoardColumn', 'System.Tags',
      'System.AssignedTo', 'Microsoft.VSTS.Scheduling.StoryPoints', 'System.ChangedDate'];
    const batches = [];
    for (let i = 0; i < ids.length; i += 200) batches.push(ids.slice(i, i + 200)); // API limit per call
    const raw = (await Promise.all(batches.map((b) => this.get(
      `${encodeURIComponent(this.project)}/_apis/wit/workitems?ids=${b.join(',')}&fields=${fields.join(',')}`,
    ).then((r) => r.value)))).flat();
    const rank = new Map(ids.map((id, i) => [id, i]));
    const bucketOf = new Map(columns.map((c) => [c.name, bucket(c)]));
    const items = raw.map((w) => {
      const f = w.fields;
      // System.BoardColumn can be blank or come from another team's board; fall back to the column this type's state maps to.
      const column = (columns.some((c) => c.name === f['System.BoardColumn']) && f['System.BoardColumn'])
        || columns.find((c) => c.stateMappings?.[f['System.WorkItemType']] === f['System.State'])?.name
        || f['System.State'];
      return {
        id: w.id,
        title: f['System.Title'],
        state: f['System.State'],
        type: f['System.WorkItemType'],
        column,
        bucket: bucketOf.get(column) ?? bucket({ name: column }),
        assignee: f['System.AssignedTo'] ? { name: f['System.AssignedTo'].displayName, id: f['System.AssignedTo'].id } : null,
        points: f['Microsoft.VSTS.Scheduling.StoryPoints'] ?? null,
        tags: f['System.Tags'] ? f['System.Tags'].split(';').map((t) => t.trim()) : [],
        changedAt: Date.parse(f['System.ChangedDate']),
        url: `${this.base}/${encodeURIComponent(this.project)}/_workitems/edit/${w.id}`,
      };
    }).sort((a, b) => rank.get(a.id) - rank.get(b.id));
    await this.addDoneDates(items, columns);
    const mineIds = new Set(mine.workItems.map((w) => w.id));
    return {
      columns: columns.map((c) => c.name),
      name: iter.name,
      path: iter.path,
      start: Date.parse(iter.attributes.startDate),
      end: Date.parse(iter.attributes.finishDate),
      boardUrl: `${this.base}/${encodeURIComponent(this.project)}/_boards/board/t/${encodeURIComponent(this.team)}/Stories?System.IterationPath=%40currentIteration`,
      stories: items.filter((i) => mineIds.has(i.id)),
      team: items,
      error: null,
    };
  }

  // When did each done item last move into a done state? Read from its update history, cached until it changes again.
  async addDoneDates(items, columns) {
    const doneStates = {}; // work item type -> Set of states that sit in a done column
    for (const c of columns) {
      if (bucket(c) !== 'done') continue;
      for (const [type, state] of Object.entries(c.stateMappings ?? {})) (doneStates[type] ??= new Set()).add(state);
    }
    const isDoneState = (type, state) => doneStates[type]?.has(state) ?? /closed|done|resolved/i.test(state);
    await Promise.all(items.filter((i) => i.bucket === 'done').map(async (i) => {
      const hit = this.doneCache.get(i.id);
      if (hit?.changedAt === i.changedAt) { i.doneAt = hit.doneAt; return; }
      const updates = await this.get(`${encodeURIComponent(this.project)}/_apis/wit/workItems/${i.id}/updates?$top=500`)
        .then((r) => r.value, () => []);
      let state = null, doneAt = null;
      for (const u of updates) {
        const next = u.fields?.['System.State']?.newValue;
        if (!next) continue;
        if (isDoneState(i.type, next) && !(state && isDoneState(i.type, state))) doneAt = Date.parse(u.fields['System.ChangedDate']?.newValue ?? u.revisedDate);
        state = next;
      }
      i.doneAt = doneAt ?? i.changedAt;
      this.doneCache.set(i.id, { changedAt: i.changedAt, doneAt: i.doneAt });
    }));
  }
}

// Delivery stage for a board column: awaiting → blocked → progress → test → done. Board columns are
// team-specific, so this goes by column type first, then by name.
export function bucket({ name, columnType }) {
  if (columnType === 'incoming') return 'awaiting';
  if (columnType === 'outgoing') return 'done';
  if (/hold|block/i.test(name)) return 'blocked';
  if (/backlog|new|to ?do|sprint ready|ready for dev/i.test(name)) return 'awaiting';
  if (/merge|release|done|closed|resolved/i.test(name)) return 'done';
  if (/qa|test|deploy|verif/i.test(name)) return 'test';
  return 'progress';
}
