import { jiraEventHandler as coreJiraEventHandler, scheduledHandler as coreScheduledHandler } from './index.js';

// Internal-QA safety gate. Keep false until deployed V1 flows have been manually
// verified on the Nuvriqo test site. Manual simulator execution remains available.
export const AUTOMATIC_ROUTING_ENABLED = false;

export async function jiraEventHandler(event, context) {
  if (!AUTOMATIC_ROUTING_ENABLED) {
    console.log('Shift & Assignment Manager automatic routing is in QA safe mode; Jira event ignored.');
    return;
  }
  return coreJiraEventHandler(event, context);
}

export async function scheduledHandler(request, context) {
  if (!AUTOMATIC_ROUTING_ENABLED) {
    console.log('Shift & Assignment Manager automatic routing is in QA safe mode; scheduled evaluation skipped.');
    return;
  }
  return coreScheduledHandler(request, context);
}
