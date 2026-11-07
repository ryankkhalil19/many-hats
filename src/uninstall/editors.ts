/**
 * Which editor an extension folder belongs to, and where that editor keeps its user settings.
 * Each VS Code-based editor installs extensions under ~/.<name>/extensions and keeps settings
 * under ~/Library/Application Support/<App>/User (macOS).
 */
import * as path from 'node:path';

/** ~/.<folder>/extensions → the editor's Application Support folder name. */
export const EDITORS: Record<string, string> = {
  '.vscode': 'Code',
  '.vscode-insiders': 'Code - Insiders',
  '.vscode-oss': 'VSCodium',
  '.cursor': 'Cursor',
  '.windsurf': 'Windsurf',
  '.windsurf-next': 'Windsurf - Next',
  '.antigravity': 'Antigravity',
  '.kiro': 'Kiro',
  '.trae': 'Trae',
  '.positron': 'Positron',
};

/**
 * The editor an extension's installed folder belongs to: …/.<folder>/extensions/<id>-<version>/…
 * @returns its Application Support folder name, or undefined if it's not a known editor
 */
export function editorOf(extensionFile: string, home: string): string | undefined {
  const rel = path.relative(home, extensionFile);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return undefined;
  const [dataFolder, extensions] = rel.split(path.sep);
  if (!dataFolder || extensions !== 'extensions') return undefined;
  return EDITORS[dataFolder];
}

/** The folder holding an editor's settings.json (and profiles/<id>/settings.json). */
export function userSettingsDir(app: string, home: string): string {
  return path.join(home, 'Library', 'Application Support', app, 'User');
}
