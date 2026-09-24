# Build Conventions

Rules learned the hard way on this codebase. Read this before touching `jsons/main.js` or
adding a build step. Each one exists because it already cost real time.

---

## 1. No module-level `const` that references a later-declared `const`

`main.js` is a single large module, and `const` is in the temporal dead zone until its
declaration line runs. A module-level `const` that composes a constant declared *below* it
throws `ReferenceError: Cannot access 'X' before initialization` **during module load**, and
that is far more damaging than it sounds:

- Everything declared after the throwing line never executes, so **every `ipcMain.handle`
  below it is never registered**.
- The app still starts. The window opens, the renderer bundle loads and runs, the UI looks
  healthy.
- Every `invoke()` instead fails with `No handler registered for 'X'`.
- The symptom therefore looks like a **stale Electron process or a stale build**, not like a
  crash, and hours can go into chasing the wrong thing.

This actually happened: `BIA_SYSTEM_CHAT` was an eager `const` at line 602 composing
`OUTLINE_STYLE_CONTRACT` at line 1179. Three packaged test suites went red with
"No handler registered" and the fix was to make the composition lazy.

**Rules**

- If a string needs to compose a later constant, make it a **function** and build it on
  first use:

  ```js
  let _cached = null;
  function biaSystemChat() {
    if (_cached === null) _cached = `${OUTLINE_STYLE_CONTRACT}\n\n...`;
    return _cached;
  }
  ```

- Or move the dependency above its consumer. Prefer the function - it survives future
  refactors that move things around.
- Never rely on declaration order "being fine" in a 100k-character file.

## 2. Test hooks must use `Object.defineProperty` with a string key

A hook that exists to be called from the packaged test suites (`window.__x`) must survive
production minification.

This was written as `;(window as unknown as { __x?: T }).__x = value` and **the minifier
dropped it** - the bundle contained every other new string but not the hook, so the gate
failed while the code was demonstrably correct.

```js
// Correct: string key cannot be mangled, defineProperty cannot be treated as dead code.
Object.defineProperty(window, '__sanitizeBia', { value: sanitizeBia, configurable: true })
```

The hook must also be justified in a comment: what it exposes, and why that grants no
capability the page does not already have.

## 3. Run the handler-registry probe first

`scratch/gates/handler_registry_probe.js` invokes every required channel with an empty
payload and fails if any answers `No handler registered`. That string is the fingerprint of
convention 1.

Run it **before** any other gate. It turns a mysterious suite-wide failure into a named
diagnosis in seconds.

**Reserved entries must verify the input path before the channel.**

The probe keeps a reserved list for channels whose Part has not shipped: reported, never
failed. That placeholder has a trap. A reserved entry is probed by calling its bridge method
- and if that method does not exist yet, the call throws
`window.seniorPartner.x is not a function`, which does **not** contain
`No handler registered`. The channel would report `[BUILT]` while being entirely absent, and
the placeholder would become a liability: it would affirm a channel that does not exist.

So every reserved entry names its bridge method, and the probe checks
`typeof window.seniorPartner?.<fn> === 'function'` **before** probing the channel. No method
means `[PENDING]`, no probe - and the entry promotes itself to an assertion the moment the
Part lands, with no edit needed.

The general rule for any "not asserted yet" gate: **verify the input path exists before
asserting on the output**, or a missing dependency reads as a pass.

## 4. Verify the artifact, not the symptom

Several bugs in this project presented as something else:

| Symptom | Actual cause |
|---|---|
| "No handler registered" everywhere | module-load TDZ crash (convention 1) |
| Gates pass, then fail, then pass | a verifier aborting on a stale UI marker string |
| Component renders unstyled | Tailwind never scanned the new file (vite root ≠ source root) |
| `.exe` behaves like an old build | distribution aborted before copying anything |

The discipline that catches all of these: **compare artifact bytes against source state**
before believing a test result. Read the shipped `app.asar` and confirm the strings and
hashes you expect are inside it.

## 5. The build entry point is `build_release.cmd`

It gates in this order, and each stage stops the next:

1. `tsc --noEmit` - source against itself. Cheapest check available; it caught the
   `{ url }` vs `{ playlistUrl }` mismatch instantly while the packaged build shipped anyway.
2. `vite build`
3. shipped-CSS guard (`check_chipgroup_classes.js`) - every class the component uses must
   exist in the built stylesheet
4. `sync_stage.js` - **the repack reads the staging tree, not `jsons/`**
5. `repack_asar.js`
6. `distribute_asar.js`

Never run steps 5-6 without 4. `sync_stage.js` also carries the app version from
`jsons/package.json` into the staged manifest, which is what `app.getVersion()` reads.

## 6. Freshness markers live in one file

`scratch/ui_markers.json` holds the strings that must exist in the shipped renderer bundle.
Add markers there, not inline in a verifier - a marker that a legitimate refactor removes
will abort the distribution, and the abort names the missing markers. Parts 1, 3 and 4 each
added some; one file keeps that reviewable.

## 7. Version coherence is asserted

The zip filename, the `.app`'s `Info.plist` (`CFBundleShortVersionString` *and*
`CFBundleVersion`), and `jsons/package.json` (which becomes the packed manifest, and so
`app.getVersion()`) must all agree. `verify_mac_zip.js` compares all three and fails if they
diverge. These are written by three different steps and drifted silently once before.

## 8. Timestamped comments record *why*, and the cost

Where a fix exists because of a specific failure, the comment says what broke and what it
looked like - not just what the code now does. Several of these bugs were only diagnosed
quickly because an earlier comment explained a previous, similar failure.

## 9. Tests must not share state with production, and must not infer readiness

Tests must run against an **isolated state root or a run-unique namespace**. Assertions on
absolute counts or ordered history are valid only when the fixture starts from known-empty
state. Readiness checks must depend on a **guaranteed-present DOM signal**, never on timing,
layout, or inferred readiness from downstream assertions.

Both halves of this were learned from the Part 4 gate, which failed twice for fixture
reasons while the product was correct:

- **Absolute counts vs. a stateful store.** The gate appended turns to the real
  `~/Documents/Bianna_Law/...` path. An append-only store accumulates, so "exactly two turn
  headings recorded" passed on the first run and failed on the second. The right fix was not
  to relax the assertion to "both markers present" - that would have quietly deleted a check
  that will matter later. The fix was isolation: the main process honours `SLP_CHAT_ROOT`,
  the fixture points the app at a temp directory, and the assertion stays load-bearing.
- **Timing-dependent readiness.** The gate waited for the Assistant rail with
  `document.querySelector('aside') && innerText.includes('Quick Actions')`, which is layout
  and text dependent. When it failed, the natural temptation was to note that the *following*
  assertions found the buttons and passed - but that is deleting a check, not fixing one.
  The rail and its buttons now carry `data-testid`, and readiness waits on the testid.

**The distinction to hold on to:** if a fixture is wrong, fix the fixture. If a check is
flaky, find the real signal. "The next assertion proves it anyway" is how a gate rots into a
formality.

**Corollary for stateful stores:** any feature that persists to the user's real filesystem
should read an environment-variable override for its root, so it can be tested without
touching user data. `SLP_CHAT_ROOT` is the pattern; use it for the next one rather than
inventing a second mechanism.

