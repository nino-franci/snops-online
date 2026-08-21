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
4. Implement and test the requested changes.
5. If all required tests pass:
   - commit the intended changes;
   - push the `codex/...` branch to `origin`;
   - update local `main` from the latest `origin/main`;
   - merge the `codex/...` branch into `main`;
   - push `main` to `origin`.

Do not open Pull Requests unless explicitly requested.

Do not:
- force-push `main`;
- rewrite published history;
- merge if required tests are failing;
- guess during merge conflicts.

A successfully completed and tested task should end with the changes pushed to `origin/main`.

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

Then STOP.

Ask:

`Ali želiš, da commitam in pusham ta branch?`

Do not proceed until the user explicitly approves.

---

## Completion summary and approval

When a task is finished, do not commit, push, merge, or open a Pull Request automatically.

First prepare a short executive summary that is suitable to be read aloud to the user.

The summary must clearly state:

- what was changed;
- which files were changed;
- what automated tests were run;
- what real gameplay or UI flows were tested;
- which tests passed;
- which tests failed, if any;
- what could not be tested;
- any remaining risks, limitations, or uncertainties;
- whether the change is ready to commit and push.

Keep this summary concise, clear, and non-technical enough to understand by voice.

Then show the relevant git diff or a concise diff summary.

After that, STOP and explicitly ask:

"Spremembe so pripravljene. Ali želiš, da jih commitam in pusham?"

Do not continue until the user gives explicit approval.

If the user approves, commit and push only the current `codex/...` branch.

If there are failed tests, unresolved risks, or uncertainty about the requested behavior, clearly say so and do not recommend pushing until the issue is resolved.

---

## 22. Commit and push approval

Only after explicit approval:

1. verify you are not on `main`;
2. verify tests are still passing;
3. commit on the current `codex/...` branch;
4. use a concise English commit message;
5. push only the current branch;
6. report:
   - branch name;
   - commit SHA;
   - commit message;
   - push result.

Then STOP.

Do not open or merge a PR unless requested.

---

## 23. Pull request policy

If the user asks to open a Pull Request:

1. open a PR from the current `codex/...` branch to `main`;
2. provide a professional PR description containing:
   - summary;
   - implementation details;
   - tests;
   - security considerations;
   - known limitations.

Do not merge automatically.

After opening the PR, ask:

`Ali želiš, da mergam PR v main?`

---

## 24. Merge policy

Never merge without explicit approval.

Before merging:

1. verify CI/test status;
2. verify the PR is targeting `main`;
3. verify there are no unresolved critical issues;
4. report the final status.

Only merge if the user explicitly says to do so.

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
