#!/usr/bin/env node
// Checks a generated human-docs tree against the repository it claims to describe.
//
//   node code-to-human-docs/validate.mjs [docsDir] [repoRoot]
//
// Defaults: docsDir=docs/human-docs, repoRoot=cwd
// Exit 0 = clean, 1 = failures found, 2 = could not run.
//
// Four checks:
//   PATHS    every repo-ish path in an inline `code span` exists on disk
//   TREES    every leaf of every ASCII directory tree exists on disk
//   LINKS    every relative markdown link resolves to a real file
//   ORPHANS  every page in the docs tree is reachable from README.md
// Plus COVERAGE, reported as a warning only: top-level source dirs nobody mentions.

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname, relative, sep } from 'node:path';

const docsDir = resolve(process.argv[2] ?? 'docs/human-docs');
const repoRoot = resolve(process.argv[3] ?? '.');

if (!existsSync(docsDir)) {
  console.error(`could not run: docs dir not found: ${docsDir}`);
  process.exit(2);
}

const IGNORED_DIRS = new Set([
  '.git', 'node_modules', 'dist', 'build', 'target', 'vendor', '.venv', 'venv',
  '__pycache__', '.next', '.nuxt', 'coverage', '.pytest_cache', '.mypy_cache',
  '.idea', '.vscode', 'docs',
]);

const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|rb|java|kt|swift|php|cs|sql|prisma|proto|toml|ya?ml|json|md|sh|env|lock|cfg|ini|gradle|tf)$/i;

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (IGNORED_DIRS.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const pages = walk(docsDir).filter((p) => p.endsWith('.md'));
if (pages.length === 0) {
  console.error(`could not run: no .md pages under ${docsDir}`);
  process.exit(2);
}

const failures = [];
const warnings = [];
const mentioned = new Set();
let checkedPaths = 0;
let checkedLinks = 0;

const fail = (page, line, kind, msg) =>
  failures.push({ page: rel(page), line, kind, msg });
const rel = (p) => relative(repoRoot, p).split(sep).join('/');

function existsInRepo(p) {
  const abs = resolve(repoRoot, p);
  // stay inside the repo — a doc claiming ../../etc/passwd is a failure, not a pass
  if (!abs.startsWith(repoRoot)) return false;
  return existsSync(abs);
}

// A backticked token counts as a path claim only if it is unambiguously one.
// Everything rejected here is a command, a route, a package name, or an identifier.
function isPathClaim(tok) {
  if (!tok || tok.length > 200) return false;
  if (/\s/.test(tok)) return false;                 // commands, prose
  if (/^(https?:|mailto:|#|\$|-{1,2}|@|\/)/.test(tok)) return false; // urls, flags, scopes, routes
  if (/[()<>{}|,'"`!?=;]/.test(tok)) return false;  // calls, globs-with-braces, types
  if (/^[A-Z][A-Za-z0-9]*$/.test(tok)) return false; // ClassName
  if (/^[a-z][a-zA-Z0-9]*$/.test(tok)) return false; // bareWord / varName
  if (/^\d/.test(tok)) return false;                // versions
  return tok.includes('/') || SOURCE_EXT.test(tok);
}

// Docs legitimately name a file relative to a directory the sentence just
// established — "create `main.py` and `service.py` under src/ccat_compute/<name>".
// A bare filename is therefore checked by basename anywhere in the repo: a real
// filename passes, a typo does not.
let basenamesCache = null;
function repoBasenames() {
  if (basenamesCache) return basenamesCache;
  basenamesCache = new Set();
  for (const f of walk(repoRoot)) basenamesCache.add(f.split(sep).pop());
  return basenamesCache;
}

function claimResolves(tok) {
  if (tok.includes('/')) return existsInRepo(tok);
  return repoBasenames().has(tok);
}

// Trim a path claim down to something checkable: strip globs, line refs, trailing punctuation.
function normalizeClaim(tok) {
  return tok
    .replace(/[:#][\w.-]*$/, '')      // file.py:42, file.md#anchor
    .replace(/\/?\*{1,2}$/, '')        // src/**  src/*
    .replace(/[.,:;]+$/, '')
    .replace(/\/$/, '');
}

// ---- per-page checks -------------------------------------------------------

for (const page of pages) {
  const raw = readFileSync(page, 'utf8');
  const lines = raw.split(/\r?\n/);

  let inFence = false;
  let fenceLang = '';
  let fenceStart = 0;
  let fenceBuf = [];

  lines.forEach((text, i) => {
    const lineNo = i + 1;
    const fenceMatch = text.match(/^\s*```(\S*)/);

    if (fenceMatch) {
      if (!inFence) {
        inFence = true;
        fenceLang = fenceMatch[1];
        fenceStart = lineNo;
        fenceBuf = [];
      } else {
        inFence = false;
        checkTree(page, fenceBuf, fenceStart, fenceLang);
      }
      return;
    }
    if (inFence) {
      fenceBuf.push(text);
      return;
    }

    // PATHS — inline code spans outside fences
    for (const m of text.matchAll(/`([^`\n]+)`/g)) {
      const tok = normalizeClaim(m[1].trim());
      if (!isPathClaim(tok)) continue;
      checkedPaths++;
      mentioned.add(tok.split('/')[0]);
      if (!claimResolves(tok)) {
        const hint = tok.includes('/') ? '' : ' (no file with this name anywhere in the repo)';
        fail(page, lineNo, 'PATHS', `no such path: ${tok}${hint}`);
      }
    }

    // LINKS — relative markdown links
    for (const m of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const href = m[1].trim();
      if (/^(https?:|mailto:|#)/.test(href)) continue;
      checkedLinks++;
      const target = href.split('#')[0];
      if (!target) continue;
      const abs = resolve(dirname(page), target);
      if (!existsSync(abs)) fail(page, lineNo, 'LINKS', `broken link: ${href}`);
    }
  });

  if (inFence) warnings.push(`${rel(page)}: unclosed code fence opened at line ${fenceStart}`);
}

// TREES — ASCII directory trees. Rebuild each leaf path from indentation and check it.
function checkTree(page, buf, startLine, lang) {
  if (lang && !/^(text|tree|plain)$/i.test(lang)) return;
  if (!buf.some((l) => l.includes('├──') || l.includes('└──'))) return;
  // Box-drawing diagrams reuse ├── and └── as box edges. Only a real tree is
  // checkable, and only a box diagram has top corners — that is the tell.
  if (buf.some((l) => /[┌┐┬►▼]/.test(l))) return;

  const stack = [];
  let base = '';

  buf.forEach((text, i) => {
    const lineNo = startLine + i + 1;
    const conn = Math.max(text.indexOf('├──'), text.indexOf('└──'));

    if (conn === -1) {
      const root = text.trim().replace(/\s{2,}.*$/, '');
      // a bare root line like "src/" or "." sets the base for everything below
      if (root && !root.startsWith('#') && /^[\w.@][\w.@/-]*\/?$/.test(root)) {
        base = root === '.' ? '' : root.replace(/\/$/, '');
        stack.length = 0;
      }
      return;
    }

    const depth = Math.floor(conn / 4);
    // name runs to the comment gutter (two or more spaces) or end of line
    let name = text.slice(conn + 3).replace(/\s{2,}.*$/, '').trim();
    if (!name) return;
    const isDir = name.endsWith('/');
    name = name.replace(/\/$/, '');
    if (/[()<>|,]/.test(name) || /\s/.test(name)) return; // "(generated)", "… others"

    stack.length = depth;
    stack[depth] = name;

    const p = [base, ...stack.slice(0, depth + 1)].filter(Boolean).join('/');
    checkedPaths++;
    mentioned.add(p.split('/')[0]);
    if (!existsInRepo(p)) {
      fail(page, lineNo, 'TREES', `tree lists ${isDir ? 'directory' : 'file'} that does not exist: ${p}`);
    }
  });
}

// ORPHANS — every page reachable from README.md
const readme = join(docsDir, 'README.md');
if (!existsSync(readme)) {
  failures.push({ page: rel(readme), line: 0, kind: 'ORPHANS', msg: 'docs tree has no README.md entry point' });
} else {
  const reachable = new Set([resolve(readme)]);
  const queue = [resolve(readme)];
  while (queue.length) {
    const cur = queue.pop();
    const body = readFileSync(cur, 'utf8');
    for (const m of body.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const href = m[1].trim();
      if (/^(https?:|mailto:|#)/.test(href)) continue;
      const abs = resolve(dirname(cur), href.split('#')[0]);
      if (abs.endsWith('.md') && existsSync(abs) && !reachable.has(abs)) {
        reachable.add(abs);
        queue.push(abs);
      }
    }
  }
  for (const p of pages) {
    if (!reachable.has(resolve(p))) {
      fail(p, 0, 'ORPHANS', 'page is not linked from README.md (reader can never reach it)');
    }
  }
}

// COVERAGE — warning only. Top-level source dirs the docs never name.
// Checked against the full prose too, not just path claims: naming a directory
// in a sentence ("`tests` was not read for this pass") is coverage, and a
// deliberate omission stated in the docs should not keep warning.
const allText = pages.map((p) => readFileSync(p, 'utf8')).join('\n');
for (const e of readdirSync(repoRoot, { withFileTypes: true })) {
  if (!e.isDirectory() || IGNORED_DIRS.has(e.name) || e.name.startsWith('.')) continue;
  const files = walk(join(repoRoot, e.name));
  if (files.length === 0) continue;
  const named =
    mentioned.has(e.name) ||
    new RegExp(`(^|[^\\w./-])${e.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\w.-]|$)`).test(allText);
  if (!named) {
    warnings.push(`COVERAGE: \`${e.name}/\` (${files.length} files) is never mentioned in the docs`);
  }
}

// ---- report ----------------------------------------------------------------

console.log(`docs: ${rel(docsDir)}  pages: ${pages.length}  path claims: ${checkedPaths}  links: ${checkedLinks}`);

if (warnings.length) {
  console.log(`\nwarnings (${warnings.length}):`);
  for (const w of warnings) console.log(`  ! ${w}`);
}

if (failures.length === 0) {
  console.log('\nPASS — every path, tree entry and link checks out.');
  process.exit(0);
}

console.log(`\nFAIL — ${failures.length} problem(s):`);
const byKind = {};
for (const f of failures) (byKind[f.kind] ??= []).push(f);
for (const kind of Object.keys(byKind).sort()) {
  console.log(`\n  ${kind} (${byKind[kind].length})`);
  for (const f of byKind[kind]) {
    console.log(`    ${f.page}${f.line ? ':' + f.line : ''}  ${f.msg}`);
  }
}
process.exit(1);
