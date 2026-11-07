/**
 * What in a Claude Code config folder belongs to one login, and what can be shared.
 *
 * Claude Code keeps everything for a login in one config folder (CLAUDE_CONFIG_DIR, ~/.claude by
 * default). Many Hats gives each extra account its own folder, then links every shared entry of
 * ~/.claude into it (conversations, settings, CLAUDE.md, skills, plugins, memory) so all accounts
 * see the same work. The entries below are never shared: they hold one login's identity, caches
 * tied to its plan or organization, or short-lived per-process state.
 */

/** Entries of ~/.claude that hold one login's data. */
const ACCOUNT_LOCAL = new Set([
  '.credentials.json', // the token file, where the Keychain isn't used
  '.cc-writes', // staging folder for Claude Code's atomic writes
  '.DS_Store',
  'backups', // backups of .claude.json
  'cache', // model catalog and similar: depends on plan and organization
  'telemetry', // this login's queued events
  'statsig', // feature-flag cache
  'mcp-needs-auth-cache.json', // claude.ai connectors belong to the account
]);

/**
 * Shared files that may be adopted into ~/.claude when they first appear in an account folder.
 * Any other new file stays with that login: Claude Code also creates short-lived per-login files.
 */
const ADOPTABLE_FILES = new Set([
  'CLAUDE.md',
  'settings.json',
  'settings.local.json',
  'history.jsonl',
  'keybindings.json',
]);

/** Whether an entry of a config folder belongs to one login and is never linked or adopted. */
export function isAccountLocal(name: string): boolean {
  return (
    name.startsWith('.') || // dot-files hold per-login state: identity, locks, markers, our own files
    ACCOUNT_LOCAL.has(name) ||
    name.startsWith('policy-limits.json') || // the organization's policy cache
    name.startsWith('remote-settings.json') || // the organization's managed settings
    name.endsWith('.lock')
  );
}

export function isAdoptableFile(name: string): boolean {
  return ADOPTABLE_FILES.has(name);
}

/** Top-level keys of .claude.json tied to one login: never copied into a new account. */
const ACCOUNT_BOUND_KEYS = new Set([
  'oauthAccount',
  'primaryApiKey',
  'customApiKeyResponses',
  'userID',
  'hasAvailableSubscription',
  'subscriptionNoticeCount',
  'penguinModeOrgEnabled',
  'claudeCodeFirstTokenDate',
  'claudeAiMcpEverConnected',
  'feedbackSurveyState',
  'numStartups',
  'firstStartTime',
  'announcementImpressions',
  'additionalModelOptionsAnsweredAt',
  'closedIssuesLastChecked',
]);

export function isAccountBoundKey(key: string): boolean {
  return ACCOUNT_BOUND_KEYS.has(key) || /cache/i.test(key);
}
