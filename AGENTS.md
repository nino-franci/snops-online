# AGENTS.md
# Šnops Online – Engineering Instructions for Codex

## 1. Primary rule

Follow the user's explicit instructions exactly.

Do not redesign product behavior, game rules, architecture, UX, scoring, bidding, or server logic unless the user explicitly asks for that change.

Do not make "helpful" unrelated changes.

If something is ambiguous, potentially dangerous, or could affect existing gameplay, stop and ask before implementing it.

The existing behavior is considered intentional unless the user explicitly says otherwise.

---

## 2. Engineering mindset

Act like a senior software engineer working on a production multiplayer application.

For every task:

- understand the existing implementation before modifying it;
- identify affected components and possible regressions;
- think critically about edge cases;
- prefer small, focused changes;
- preserve backward compatibility where possible;
- avoid unnecessary refactors;
- do not introduce complexity without a clear reason;
- do not silently change unrelated code;
- do not guess game rules.

Before coding, determine:

1. What exactly is being requested?
2. Which files and systems are affected?
3. What existing behavior must remain unchanged?
4. What edge cases could break?
5. How will the change be tested?
6. Could this affect multiplayer synchronization, security, hidden information, scoring, or game state?

---

## 3. Git workflow

Never work directly on `main`.

For every task:

1. Fetch the latest remote state.
2. Start from the latest `origin/main`.
3. Create a new branch:
   `codex/<short-task-name>`
4. Implement and test the requested changes on that branch.
5. Review the diff and prepare the mandatory completion report.
6. Ask the user for explicit approval before committing or publishing anything.
7. After the user approves publishing, complete the full publish workflow without asking again:
   - commit the intended changes on the `codex/...` branch;
   - push the `codex/...` branch to `origin`;
   - update local `main` from the latest `origin/main`;
   - merge the `codex/...` branch into `main`;
   - push `main` to `origin`.

The approval is a single approval for the whole publish workflow. Once the user has clearly said to commit/push/merge, do not ask again between commit, branch push, merge, or `main` push.

Do not open a Pull Request unless the user explicitly requests one. The default workflow is direct branch push followed by merge into `main`.

Do not:
- commit before user approval;
- push before user approval;
- force-push `main`;
- rewrite published history;
- merge if required tests are failing;
- guess during merge conflicts.

A successfully completed, tested, and approved task should end with the changes pushed to `origin/main`.

---

## 4. Before editing code

Before modifying anything:

1. Read the relevant implementation.
2. Inspect related server and client code.
3. Understand the current data flow.
4. Identify existing tests.
5. Check whether the requested behavior already partially exists.

For multiplayer/gameplay changes, inspect at minimum where relevant:

- `server.js`
- `public/app.js`
- `public/index.html`
- `public/style.css`
- `package.json`
- existing tests
- relevant documentation

Do not begin with a large rewrite if a small targeted fix is sufficient.

---

## 5. Change scope

Implement only what the user requested.

Do not:

- redesign unrelated UI;
- rename APIs without need;
- change game rules as a side effect;
- modify scoring unless requested;
- change seating logic unless requested;
- remove existing functionality because it seems unnecessary;
- replace working libraries/frameworks without approval;
- introduce new dependencies unless justified.

If a better solution requires a broader change, explain it first and ask for approval.

---

## 6. Šnops game rules

Game rules are product requirements, not suggestions.

Do not infer or "correct" Šnops rules from external sources.

The user's defined rules have priority over standard or regional rules.

Preserve existing rules unless explicitly requested.

### Four-player mode

- 4 players play as fixed teams of 2 vs 2.
- Partners sit opposite each other.
- Seating order matters.
- The player to the right of the dealer chooses cut/hit behavior where applicable.
- The player to the left of the dealer starts receiving cards and calls trump according to the established rules.
- Existing bidding, kontra, scoring, 20/40, Šnops 6, Mali 7, Veliki 9, Veliki with trump 12, 18 and 24 rules must not be altered without explicit instruction.

### Bots

- Bots must always follow strict legal gameplay rules.
- Human room strict-mode settings must not allow bots to cheat.
- Bots must never receive information that a human player should not have.

### Three-player mode

Three-player rules are separate.

Do not assume four-player rules apply to three-player mode.

---

## 7. Multiplayer and server authority

The server is authoritative.

Never trust the client for:

- card ownership;
- turn order;
- legal moves;
- scoring;
- bidding;
- team membership;
- game results;
- trump;
- hidden hands;
- room permissions.

All important actions must be validated server-side.

A malicious or modified client must not be able to:

- play another player's card;
- act outside its turn;
- change another player's score;
- change seating without permission;
- see hidden cards;
- forge game results;
- impersonate another player;
- bypass room ownership permissions.

---

## 8. Hidden information and anti-cheat

Private card information is sensitive game state.

Never send another player's complete hand to clients that should not see it.

For every gameplay change, verify that:

- each player receives only their own hand;
- opponents receive only public information;
- bot internal state does not leak hidden cards;
- logs do not expose hidden hands in production;
- reconnect payloads do not reveal private information.

Treat accidental card leakage as a critical bug.

---

## 9. Strict rules mode

Respect the room's strict-rules setting for human players.

When strict rules are ON:

- legal move validation must be enforced by the server.

When strict rules are OFF:

- humans may play otherwise illegal cards if this is the intended room behavior;
- turn ownership and card ownership must still always be enforced.

Bots always obey strict rules.

---

## 10. Testing requirements

Every code change must be tested.

Do not say a change is complete if it was not actually tested.

Run all relevant existing tests.

At minimum, when applicable:

```bash
npm test
node --check server.js
node --check public/app.js
```

If other test scripts exist, run them too.

Do not ignore test failures.

If a test fails:

1. investigate the cause;
2. determine whether the implementation or test is wrong;
3. fix the issue;
4. rerun the tests.

Never commit known failing tests unless the user explicitly approves it.

---

## 11. Real gameplay testing

For gameplay changes, static syntax checks are not enough.

Test the actual game flow.

Where tooling permits, simulate multiple independent players using:

- Socket.IO clients;
- automated browser contexts;
- Playwright;
- bots;
- integration tests.

For four-player gameplay, test with four independent player sessions where relevant.

Test realistic flows such as:

- room creation;
- joining;
- host permissions;
- seat assignment;
- team layout;
- bot addition/removal;
- dealer progression;
- cut/hit phase;
- trump selection;
- dealing;
- bidding;
- passing;
- repeated bidding rounds;
- kontra;
- kontra nazaj;
- do konca;
- normal game;
- 20/40;
- Šnops 6;
- Mali 7;
- Veliki 9;
- Veliki with trump 12;
- 18;
- 24;
- score calculation;
- next round;
- game to 25;
- reconnect;
- disconnect;
- player replaced by bot where supported.

Do not test only the happy path.

---

## 12. Edge-case testing

For gameplay-related changes, consider:

- player disconnects during their turn;
- player reconnects;
- duplicate actions;
- rapid double-clicks;
- two clients sending actions at almost the same time;
- invalid socket events;
- stale client state;
- room full conditions;
- bot replacement by human;
- host disconnect;
- illegal card requests;
- illegal bid requests;
- invalid seat changes;
- finished round receiving another action;
- finished game receiving another action.

---

## 13. UI testing

The application is mobile-first.

For UI changes, test at minimum:

- narrow phone viewport;
- typical modern phone viewport;
- larger phone;
- desktop viewport where relevant.

Verify:

- cards remain readable;
- buttons do not overlap cards;
- player names fit;
- current-turn indication is obvious;
- focus mode works;
- hidden cards remain hidden;
- modal/dialog elements fit on screen;
- touch targets are usable;
- no important action is off-screen.

For card-table changes, visually inspect the actual rendered game if possible.

---

## 14. Security review

For every server or multiplayer change, perform a basic security review.

Check for:

- trusting client-supplied IDs;
- authorization mistakes;
- missing ownership checks;
- hidden information leakage;
- arbitrary score modification;
- arbitrary room modification;
- injection issues;
- unsafe HTML rendering;
- denial-of-service opportunities;
- excessive event spam;
- secrets committed to source control;
- unsafe dependencies.

Run dependency/security tooling if available, for example:

```bash
npm audit
```

Do not automatically upgrade major dependencies solely because an audit reports them.

Explain the risk first.

---

## 15. Logging

Logging should help debug production problems without leaking private information.

Useful log fields may include:

- timestamp;
- room ID;
- game phase;
- action type;
- player ID or seat;
- error category.

Do not log:

- passwords;
- authentication secrets;
- tokens;
- environment secrets;
- full hidden hands in production.

Use structured, useful logs rather than excessive noisy output.

---

## 16. Dependencies

Avoid adding dependencies unless necessary.

Before adding a dependency, consider:

- can the feature be implemented cleanly without it?
- is the package actively maintained?
- does it increase security risk?
- does it significantly increase bundle or server size?
- is its license appropriate?

If a new dependency is substantial, explain why it is needed.

---

## 17. Refactoring

Do not refactor unrelated code during a feature task.

Refactoring is allowed only when:

- required to safely implement the requested change; or
- explicitly requested.

If substantial refactoring is required, explain the reason before doing it.

---

## 18. Error handling

Do not hide errors.

Server errors should:

- fail safely;
- avoid corrupting game state;
- avoid leaking sensitive data;
- provide useful diagnostic logs.

Client errors should show understandable messages where appropriate.

Example:

Prefer:

`Moraš barvati srce.`

over:

`Invalid action.`

when strict gameplay validation applies.

---

## 19. Code quality

Write clear, maintainable code.

Prefer:

- small functions;
- descriptive naming;
- single-purpose logic;
- reusable validation helpers;
- centralized game-rule logic;
- minimal duplication.

Avoid:

- giant functions;
- unexplained magic values;
- duplicated game rules in client and server when server authority is required;
- deeply nested logic where it can be simplified.

Comments should explain why, not restate obvious code.

---

## 20. Definition of done

A task is not complete until:

1. requested behavior is implemented;
2. unrelated behavior is preserved;
3. syntax checks pass;
4. relevant automated tests pass;
5. relevant integration/gameplay tests pass;
6. UI was tested where applicable;
7. security implications were reviewed;
8. no known critical regression remains;
9. the diff was reviewed for unintended changes.

---

## 21. Mandatory report before commit

After implementation and testing, do not commit yet.

Provide the user with:

### Summary
What was changed.

### Files changed
List each changed file.

### Behavior
Explain the new behavior.

### Tests performed
List every command/test executed.

Example:

```text
PASS node --check server.js
PASS node --check public/app.js
PASS npm test
PASS 4-player room simulation
PASS bot legal-move test
```

### Manual/real-game testing
Describe what actual gameplay flows were tested.

### Security checks
Describe relevant checks performed.

### Risks / limitations
List anything not tested or any remaining uncertainty.

### Diff
Show the git diff or a concise but complete diff summary.

Then STOP and ask exactly one approval question, for example:

`Spremembe so pripravljene. Ali želiš, da jih commitam na nov branch, pusham in nato mergam v main?`

Do not commit, push, or merge until the user explicitly approves.

---

## 22. Publish approval and automatic completion

The user must explicitly approve publishing before any commit, push, or merge.

Approval can be any clear instruction with the same intent, for example:

- `commitaj`;
- `commitaj in pushaj`;
- `commitaj na nov branch`;
- `naredi commit, push in merge`;
- `daj na nov branch in mergaj na main`;
- `ja, naredi`;
- another clearly equivalent instruction given in response to the approval question.

When the user gives this approval, treat it as approval for the **entire publish workflow** unless the user explicitly limits the scope.

After approval, do not stop and do not ask for any additional confirmation. Complete all of the following steps in one workflow:

1. Verify the current work is on a `codex/...` branch and not on `main`.
2. Verify the relevant tests are still passing.
3. Review the diff and ensure only intended files are included.
4. Commit the intended changes on the `codex/...` branch.
5. Use a concise English commit message.
6. Push the `codex/...` branch to `origin`.
7. Verify the branch push succeeded.
8. Fetch the latest remote state again.
9. Update local `main` from the latest `origin/main`.
10. Merge the `codex/...` branch into `main`.
11. Push `main` to `origin`.
12. Verify that `origin/main` contains the merged change.
13. Report the final result to the user.

The final report must include:

- branch name;
- commit SHA;
- commit message;
- branch push result;
- merge result;
- `main` push result;
- any relevant test/CI status.

Do not ask questions such as:

- `Ali želiš, da zdaj pusham?`;
- `Ali želiš, da mergam?`;
- `Ali želiš, da pusham main?`;
- `Ali želiš, da odprem PR?`.

Once publishing was approved, continue through commit, push, merge, and `main` push automatically.

If the user explicitly says they want only a commit or only a branch push, follow that narrower instruction instead.

---

## 23. Pull request policy

Do not create a Pull Request as part of the normal workflow.

The normal workflow is:

`implement -> test -> report -> ask once -> commit on new branch -> push branch -> merge into main -> push main -> final report`

Only create a Pull Request if the user explicitly asks for a Pull Request.

If the user explicitly requests a Pull Request, follow that request instead of the normal direct-merge workflow.

Never create a PR merely because it seems safer, more standard, or more convenient.

---

## 24. Merge safety policy

After the user has approved the full publish workflow, merge automatically only if it is safe to do so.

Before merging:

1. verify required tests are passing;
2. verify the branch was pushed successfully;
3. fetch the latest `origin/main`;
4. verify there are no unresolved critical issues;
5. verify the merge does not require guessing how to resolve conflicts.

If the merge is clean, complete the merge and push `main` without asking again.

If there is a merge conflict, failed required test, rejected push, or another blocking problem:

- stop the publish workflow safely;
- do not guess;
- do not force-push;
- clearly report the blocker to the user;
- ask only for information or approval that is actually needed to resolve that blocker.

Never force-push `main`.

---

## 25. When requirements are unclear

Do not invent product decisions.

If the requested behavior is unclear:

- explain the ambiguity;
- provide the smallest set of concrete options;
- ask the user which behavior they want.

This is especially important for:

- Šnops rules;
- scoring;
- bidding;
- bot behavior;
- strict-rule exceptions;
- UI flow;
- security-sensitive changes.

---

## 26. Communication style

Be concise but precise.

Do not claim:

- "fully tested" if only syntax was checked;
- "secure" if only a superficial review was performed;
- "working" if the actual flow was not exercised.

Clearly distinguish:

- implemented;
- automatically tested;
- manually tested;
- not tested;
- assumptions.

Never hide uncertainty.

---

## 27. Final principle

Correctness is more important than speed.

Preserving the user's intended game behavior is more important than implementing a personally preferred solution.

When in doubt:

- inspect;
- test;
- explain;
- ask.

Do not improvise product rules.
