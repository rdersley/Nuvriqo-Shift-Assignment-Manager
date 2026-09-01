import { jiraEventHandler as coreJiraEventHandler, scheduledHandler as coreScheduledHandler } from './index.js';
import { getAutomaticRoutingEnabled } from './routingSettings.js';

async function automaticRoutingEnabled() {
  try {
    return await getAutomaticRoutingEnabled();
  } catch (error) {
    console.error('Unable to read automatic routing setting; failing closed.', error);
    return false;
  }
}

export async function jiraEventHandler(event, context) {
  if (!(await automaticRoutingEnabled())) {
    console.log('Shift & Assignment Manager automatic routing is OFF; Jira event ignored.');
    return;
  }
  return coreJiraEventHandler(event, context);
}

export async function scheduledHandler(request, context) {
  if (!(await automaticRoutingEnabled())) {
    console.log('Shift & Assignment Manager automatic routing is OFF; scheduled evaluation skipped.');
    return;
  }
  return coreScheduledHandler(request, context);
}
