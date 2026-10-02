import api, { route } from '@forge/api';

export function jiraClient(actor = 'user') {
  return actor === 'app' ? api.asApp() : api.asUser();
}

export async function getIssue(issueKey, actor = 'user') {
  const res = await jiraClient(actor).requestJira(route`/rest/api/3/issue/${issueKey}`);
  if (!res.ok) throw new Error(`Unable to load ${issueKey} (${res.status})`);
  return res.json();
}

// Enhanced JQL search. The legacy /rest/api/3/search endpoint has been removed by Atlassian.
export async function searchIssueKeys(jql, actor = 'app', max = 100) {
  const keys = [];
  let nextPageToken;
  do {
    const pageSize = Math.min(100, max - keys.length);
    const res = nextPageToken
      ? await jiraClient(actor).requestJira(route`/rest/api/3/search/jql?jql=${jql}&maxResults=${pageSize}&fields=assignee&nextPageToken=${nextPageToken}`)
      : await jiraClient(actor).requestJira(route`/rest/api/3/search/jql?jql=${jql}&maxResults=${pageSize}&fields=assignee`);
    if (!res.ok) throw new Error(`Unable to search Jira (${res.status})`);
    const body = await res.json();
    keys.push(...(body.issues || []).map(issue => issue.key || issue.id).filter(Boolean));
    nextPageToken = body.isLast === false ? body.nextPageToken : undefined;
  } while (nextPageToken && keys.length < max);
  return keys;
}

export async function countIssues(jql, actor = 'user') {
  const res = await jiraClient(actor).requestJira(route`/rest/api/3/search/approximate-count`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ jql })
  });
  if (!res.ok) throw new Error(`Unable to count Jira issues (${res.status})`);
  const body = await res.json();
  return Number(body.count) || 0;
}

export function quoteJql(value = '') {
  return `"${String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}
