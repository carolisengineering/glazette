# Glazette

## Workflow

### Reviews when a plan is fully implemented

When the last task of an implementation plan (or of a PR's slice of the plan) is done, and
before `superpowers:finishing-a-development-branch` or opening a PR:

1. Run `/security-review` on the branch.
2. Run `/code-review high` on the branch.
3. Fix real findings, re-run tests, and commit the fixes. If a finding is a judgment call
   or out of scope, ask Carol instead of silently skipping it.

This happens in addition to the per-task reviews that subagent-driven development already does.
A fix after a review doesn't trigger a second full round unless the fix is substantial.

## PR descriptions

Keep them short. Describe only what this PR contains: no links to the plan, no task numbers,
no preview of later PRs, no account of how the work was done.

Write in plain English. No file paths, function names, type names or other code references.
Say what something does, not what it's called in the code. The one exception: a name the
reader has to type or find to complete a pre-merge step, such as a secret's name.

Open with one sentence saying what the PR does. Then use these sections in this order, and
leave out any section that would be empty:

- **Changes**: what the PR adds or changes, one short bullet per area.
- **Notable Behavior**: behavior a user or a future developer could be surprised by.
  Not a restatement of the changes.
- **Product Decisions**: product calls made while building this PR, one line each.
- **Pre-Merge Steps**: only actions someone must take before merging. Known gaps and
  follow-up work don't belong here.
- **Verification**: what was checked and the result, in plain words (for example, "All 35
  tests pass. Lint, type check and build are clean."). Don't list the code or security
  reviews.
