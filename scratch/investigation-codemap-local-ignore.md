# Investigation: Local-Only Codemap Outputs

## Task
- Apply codemap local-only output policy in lootforge.
- Prevent CODEMAP files from being committed and causing merge conflicts.

## Plan
- Run codemap installer against lootforge with updated local-only behavior.
- Untrack CODEMAP outputs if already tracked.
- Commit only the intended policy files.

## Actions Applied
- Ran `/Users/sws/Code/codemap/scripts/install.sh /Users/sws/Code/lootforge`.
- Ensured local excludes include `CODEMAP.md` and `CODEMAP.paths`.
- Untracked `CODEMAP.md` / `CODEMAP.paths` from index if previously tracked.

## Verification
- Confirmed staged diff no longer includes codemap outputs.

## Verification
- `git status` shows `CODEMAP.md` and `CODEMAP.paths` removed from index and left local-only.
- `.git/info/exclude` contains local ignore entries for codemap outputs.
