#!/usr/bin/env node
// Checks the links in the repository's Markdown files. A relative link must point at a file that
// exists, and an #anchor at a heading (GitHub's heading ids) or an id="…" in that file. Links to
// other sites are checked only with --external, so CI never fails on someone else's outage.
//   node scripts/check-links.mjs [--external]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const external = process.argv.includes('--external');
const SKIP_DIRS = new Set(['.git', 'node_modules', 'out', 'dist', 'coverage', '.vscode-test']);

function markdownFiles() {
  try {
    const listed = execFileSync(
      'git',
      ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '*.md'],
      {
        cwd: root,
        encoding: 'utf8',
      },
    );
    return listed.split('\0').filter((f) => f && fs.existsSync(path.join(root, f)));
  } catch {
    // Not a git checkout: walk the tree.
    const found = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
        const rel = path.join(dir, e.name);
        if (e.isDirectory() && !SKIP_DIRS.has(e.name)) walk(rel);
        else if (e.isFile() && e.name.endsWith('.md')) found.push(rel);
      }
    };
    walk('.');
    return found.map((f) => path.normalize(f));
  }
}

/** The text with code blocks and code spans blanked out, keeping every line where it was. */
function withoutCode(text) {
  let fence = null;
  return text
    .split('\n')
    .map((line) => {
      const m = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
      if (fence) {
        if (m && m[1][0] === fence[0] && m[1].length >= fence.length) fence = null;
        return '';
      }
      if (m) {
        fence = m[1];
        return '';
      }
      return line.replace(/(`+)(?:(?!\1).)+?\1/g, (s) => ' '.repeat(s.length));
    })
    .join('\n');
}

/** Every anchor a file offers: GitHub's ids for its headings, plus explicit id/name attributes. */
function anchorsOf(text) {
  const plain = withoutCode(text);
  const anchors = new Set();
  const seen = new Map();
  const add = (heading) => {
    const base = heading
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/<[^>]+>/g, '')
      .replace(/[*`]/g, '')
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, '')
      .replace(/ /g, '-');
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    anchors.add(n ? `${base}-${n}` : base);
  };
  const lines = plain.split('\n');
  lines.forEach((line, i) => {
    const atx = /^\s{0,3}#{1,6}\s+(.*?)(?:\s+#+)?\s*$/.exec(line);
    if (atx) add(atx[1]);
    else if (i > 0 && /^\s{0,3}(=+|-+)\s*$/.test(line) && /^\s{0,3}[^\s>*+\-|#]/.test(lines[i - 1])) {
      add(lines[i - 1]);
    }
  });
  for (const m of text.matchAll(/\b(?:id|name)\s*=\s*["']([^"']+)["']/g)) anchors.add(m[1]);
  return anchors;
}

/** [line, target] for every link and image: inline, reference definitions, and HTML src/href. */
function linksOf(text) {
  const out = [];
  withoutCode(text)
    .split('\n')
    .forEach((line, i) => {
      for (const m of line.matchAll(/\]\(\s*<?([^)\s>]*)>?(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g))
        out.push([i + 1, m[1]]);
      const def = /^\s{0,3}\[[^\]]+\]:\s*<?([^\s>]+)>?/.exec(line);
      if (def) out.push([i + 1, def[1]]);
      for (const m of line.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/g)) out.push([i + 1, m[1]]);
    });
  return out;
}

const files = markdownFiles();
const anchorCache = new Map();
const anchorsIn = (file) => {
  if (!anchorCache.has(file)) anchorCache.set(file, anchorsOf(fs.readFileSync(file, 'utf8')));
  return anchorCache.get(file);
};
const problems = [];
const urls = new Map(); // url → first place it appears
let checked = 0;

for (const file of files) {
  const abs = path.join(root, file);
  for (const [line, target] of linksOf(fs.readFileSync(abs, 'utf8'))) {
    const where = `${file}:${line}`;
    if (!target || /^(mailto|tel|vscode|command):/i.test(target)) continue;
    checked++;
    if (/^https?:\/\//i.test(target)) {
      if (!urls.has(target)) urls.set(target, where);
      continue;
    }
    if (target.startsWith('//')) {
      problems.push(`${where}: protocol-relative link ${target}; use https://`);
      continue;
    }
    const hash = target.indexOf('#');
    const rawPath = (hash >= 0 ? target.slice(0, hash) : target).split('?')[0];
    const anchor = hash >= 0 ? decodeURIComponent(target.slice(hash + 1)) : '';
    let dest = abs;
    if (rawPath) {
      const decoded = decodeURIComponent(rawPath);
      dest = decoded.startsWith('/') ? path.join(root, decoded) : path.resolve(path.dirname(abs), decoded);
      if (!dest.startsWith(root + path.sep) && dest !== root) {
        problems.push(`${where}: ${target} points outside the repository`);
        continue;
      }
      if (!fs.existsSync(dest)) {
        problems.push(`${where}: ${target}: no such file`);
        continue;
      }
    }
    if (anchor && dest.endsWith('.md') && !anchorsIn(dest).has(anchor)) {
      problems.push(`${where}: ${target}: no heading or id "${anchor}" in ${path.relative(root, dest)}`);
    }
  }
}

if (external) {
  const list = [...urls.entries()];
  const probe = async ([url, where]) => {
    const attempt = (method) =>
      fetch(url, {
        method,
        redirect: 'follow',
        signal: AbortSignal.timeout(15000),
        headers: { 'user-agent': 'many-hats-link-check' },
      });
    try {
      let res = await attempt('HEAD');
      if (res.status >= 400) res = await attempt('GET');
      if (res.status >= 400) problems.push(`${where}: ${url}: HTTP ${res.status}`);
    } catch (e) {
      problems.push(`${where}: ${url}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  for (let i = 0; i < list.length; i += 8) await Promise.all(list.slice(i, i + 8).map(probe));
}

for (const p of problems) console.error(p);
const extNote = external
  ? `, including ${urls.size} external`
  : `; ${urls.size} external skipped (--external checks them)`;
console.log(
  `${problems.length ? 'Broken links found' : 'Links OK'}: ${checked} links in ${files.length} Markdown files${extNote}.`,
);
process.exit(problems.length ? 1 : 0);
