/** Where Claude Code keeps things inside a config folder. */
import * as path from 'node:path';

/** Claude Code's folder name for a project: every character but a letter or digit becomes "-". */
export function projectKey(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-');
}

/** The folder holding a project's transcripts: <config>/projects/<project key>. */
export function projectDir(claudeDir: string, cwd: string): string {
  return path.join(claudeDir, 'projects', projectKey(cwd));
}

/** One file per live Claude process: <config>/sessions/<pid>.json. */
export function liveSessionsDir(claudeDir: string): string {
  return path.join(claudeDir, 'sessions');
}

/** The file that holds a login's identity: <home>/.claude.json for ~/.claude, <config>/.claude.json otherwise. */
export function identityFile(configDir: string, isHomeDefault: boolean, home: string): string {
  return isHomeDefault ? path.join(home, '.claude.json') : path.join(configDir, '.claude.json');
}
