/**
 * Removing Many Hats' process-wrapper setting from an editor's settings files, keeping every
 * comment and all formatting (settings.json is JSON with comments).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { applyEdits, modify, parse, type ParseError } from 'jsonc-parser';
import { writeFileAtomic } from '../infra/atomicFile';
import { readDirOrEmpty, statOrUndefined } from '../infra/fsx';

export const WRAPPER_KEY = 'claudeCode.claudeProcessWrapper';

/** settings.json and every profile's settings.json in an editor's User folder. */
export function settingsFiles(userDir: string): string[] {
  const files = [path.join(userDir, 'settings.json')];
  const profiles = path.join(userDir, 'profiles');
  for (const id of readDirOrEmpty(profiles)) files.push(path.join(profiles, id, 'settings.json'));
  return files.filter((f) => statOrUndefined(f)?.isFile());
}

/**
 * Text without the wrapper setting, if it's set to one of `ours`; undefined if there's nothing to
 * change (or the file isn't valid JSONC, which is then left exactly as it is).
 */
export function withoutWrapper(text: string, ours: readonly string[]): string | undefined {
  const errors: ParseError[] = [];
  const root = parse(text, errors, { allowTrailingComma: true, disallowComments: false }) as unknown;
  if (errors.length || typeof root !== 'object' || root === null) return undefined;
  const value = (root as Record<string, unknown>)[WRAPPER_KEY];
  if (typeof value !== 'string' || !ours.includes(value)) return undefined;
  const indent = /\n(\t| +)"/.exec(text)?.[1];
  const edits = modify(text, [WRAPPER_KEY], undefined, {
    formattingOptions: {
      insertSpaces: indent !== '\t',
      tabSize: indent && indent !== '\t' ? indent.length : 4,
      eol: text.includes('\r\n') ? '\r\n' : '\n',
    },
  });
  return applyEdits(text, edits);
}

/** Remove the setting from one file if it points at Many Hats. @returns whether the file changed */
export function removeWrapperFrom(file: string, ours: readonly string[]): boolean {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return false;
  }
  const next = withoutWrapper(text, ours);
  if (next === undefined || next === text) return false;
  const mode = statOrUndefined(file)?.mode ?? 0o644;
  writeFileAtomic(file, next, { mode: mode & 0o777 });
  return true;
}
