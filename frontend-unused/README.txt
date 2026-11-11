FRONTEND ARCHIVE (read-only reference, not built or deployed)
==============================================================

The live site is built from ../dia-shoppe-frontend/ (Cloudflare deploys the
main branch). Nothing in this folder is part of that build.

active-frontend-backup/dia-shoppe-frontend/
    Exact snapshot of the live frontend before the revamp:
    commit dedd44a (2026-08-20, "Footer contact details come from business.js"),
    the tip of main when the revamp started.

previous-frontend/dia-shoppe-frontend/
    The earliest committed frontend: commit 274547c (2026-07-22, "Initial
    commit"). Investigation of the full Git history (main and
    dev/financial-state-machine) found no separate, older frontend: every
    commit edits this same folder. The redesign worked on in early October
    2026 was never committed (commit a823e80 notes "working-tree redesign
    edits are untouched and uncommitted"), so it cannot be recovered from Git.

Restore either one with:  git show <commit>:dia-shoppe-frontend/<path>
or by copying the folder back. To run one locally, copy it elsewhere, then
npm install and npm run dev inside it.
