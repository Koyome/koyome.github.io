/* ============================================================
   check-private-pages.js — refuse to let owner-only pages ship.

   docs/ IS the GitHub Pages root. Anything left in it is published
   the moment the repo is pushed. The visitor roll shows real people's
   IP addresses and locations; the journal was removed for the same
   reason. .gitignore covers the normal case, but .gitignore is a
   convention, not a lock: `git add -f`, a careless `git add docs/`,
   or a tool that stages everything will sail straight past it.

   So this is the check that says no out loud. Run it before any push:

       node tools/check-private-pages.js

   It inspects what git would actually publish, not what the working
   tree happens to contain — that is the only view that matters.

   Exit 0 = safe to push. Exit 1 = something private is staged.
   ============================================================ */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

/* Every path that must never appear in a commit. Keep this list and
   .gitignore in step — this file is the one that gets checked. */
const FORBIDDEN = [
  /* the visitor log — real addresses of real people */
  'docs/visits.html',
  'docs/js/visits.js',
  /* the theatre around the roll (code rain, wire, scope, event log) —
     only visits.html loads it, same owner-only rule */
  'docs/js/visits-fx.js',
  'docs/css/visits.css',
  'docs/data/visits.json',
  'docs/data/visits-hidden.json',
  'docs/data/geo-cache.json',
  /* the retired journal */
  'docs/journal.html',
  'docs/js/journal.js',
  'docs/data/journal.json',
  /* Rem — owner-only, and the portrait is not ours to redistribute.
     puppet.js and mood.js were missing from this list while being
     referenced only by rem.html: .gitignore was in step but the guard
     was not, which is the one combination this file exists to catch. */
  'docs/rem.html',
  'docs/js/rem.js',
  'docs/js/puppet.js',
  'docs/js/mood.js',
  'docs/js/kurisu-lines.js',
  'docs/js/kurisu-pool.js',
  'docs/js/kurisu-voice.js',
  'docs/js/steinsgate-kb.js',
  'docs/css/rem.css',
  /* the runtime those load — only rem.html asks for it, and it is
     third-party code we are not redistributing */
  'docs/vendor/live2d/live2d.min.js',
  'docs/vendor/live2d/live2dcubismcore.min.js',
  'docs/vendor/live2d/pixi.min.js',
  'docs/vendor/live2d/index.min.js',
];

/* also flag these anywhere in the tree, whatever their path */
const FORBIDDEN_BASENAMES = [
  'visits.json', 'visits-hidden.json', 'geo-cache.json',
  'sb-key.txt', 'geo-key.txt',
];

function git(args) {
  try {
    return execSync('git ' + args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch (_) {
    return null;
  }
}

let bad = 0;

/* --- 1. what is actually tracked right now --- */
const tracked = (git('ls-files') || '').split('\n').filter(Boolean);
tracked.forEach((f) => {
  if (FORBIDDEN.includes(f)) {
    console.log('FAIL  tracked in git: ' + f + '   ← remove with: git rm --cached ' + f);
    bad++;
  }
});

/* --- 2. what a commit right now would publish --- */
/* `git add -A` is what everyone actually types; dry-run it and look
   at what it picks up. Files that .gitignore already covers never
   appear here, which is exactly the point. */
const staged = (git('add -A --dry-run') || '')
  .split('\n')
  .map((l) => l.replace(/^(add|remove)\s+/i, '').trim().replace(/^'|'$/g, ''))
  .filter(Boolean);

staged.forEach((f) => {
  if (FORBIDDEN.includes(f)) {
    console.log('FAIL  would be published by the next commit: ' + f);
    bad++;
  }
});

/* --- 3. the secret files, wherever they live --- */
const all = tracked.concat(staged);
all.forEach((f) => {
  const base = f.split(/[\\/]/).pop();
  if (FORBIDDEN_BASENAMES.includes(base) && !FORBIDDEN.includes(f)) {
    console.log('FAIL  secret file would ship: ' + f);
    bad++;
  }
});

/* --- 4. and the reassuring part ---
   Only paths that actually exist are counted: the retired journal's
   three files are gone, and `git check-ignore` reports nothing for a
   path that is not there — so counting them turned a clean result
   into "15/18 looks fine", which is exactly the kind of number that
   teaches a reader to stop reading it. */
const present = FORBIDDEN.filter((f) => fs.existsSync(path.join(__dirname, '..', f)));
const ignored = (git('check-ignore ' + present.join(' ')) || '')
  .split('\n').filter(Boolean).length;

if (bad === 0) {
  console.log('ok   no owner-only page is tracked or staged');
  console.log('ok   ' + ignored + '/' + present.length +
    ' private paths on disk are .gitignore’d (local copies kept)');
  console.log('ok   next commit publishes ' + staged.filter((f) => !/^docs\/data\/visits/.test(f)).length + ' file(s)');
  console.log('\nSAFE TO PUSH — the public site will not contain any visitor record.');
} else {
  console.log('\n' + bad + ' PROBLEM(S). Do NOT push until they are fixed.');
}
process.exit(bad ? 1 : 0);