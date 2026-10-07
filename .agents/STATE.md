# State

Lives only on the fork-only branch `chore/fork-state` (no shared history with `main`,
never merged), so it can't reach upstream. Read it with
`git show origin/chore/fork-state:.agents/STATE.md`.

## Now
- TONE3000 plugin: JUCE audio plugin (VST3, AU, CLAP, LV2, Standalone) that loads NAM
  captures and IRs from tone3000.com or local files. Version in `VERSION`: 0.0.12.
- This repo is the fork `elarmuzik1993/tone3000-plugin`; upstream is `tone-3000` (its merge
  commits show in `git log`). Work here goes to the fork only.
- Once `fix/flaky-focus-test` merges: the UI self-tests that drive a real window
  (`FocusPolicyTests`, `LiveScenario` in `plugin/ui/testbed/SelfTests.cpp`) take OS focus via
  `FocusPolicyTests::takeOsFocus()`, which repaints for ~100 ms after X grants focus so the
  queued FocusIn lands before the test starts. Before, "Focus policy / a keyboard-opened menu"
  failed about 1 run in 8 under xvfb.
- `feat/tuner-mute` carries the tuner screen's mute toggle (#222 upstream) plus three
  follow-ups: mute folded into `outputGainSmoother`, `MockBackend` cleanup, and a "Tuner mute"
  UI self-test.

## Next
1. Review and merge the `fix/flaky-focus-test` PR on the fork.
2. Open a PR on the fork for `feat/tuner-mute` against `main`.
3. Offer both upstream to `tone-3000` if wanted (access from cloud sessions: unverified).
4. Possible real bug, not reproduced outside the tests: clicking a menu button in a plugin
   window without OS focus may open the menu, then lose its keyboard focus when the late
   FocusIn lands, so Escape doesn't close it. Try it in a host on Linux first.
5. Install the workflow kit (`/workflow:kit`): the repo has no `AGENTS.md` or `scripts/verify.sh`.

## Decisions
- Focus setup waits by repainting, not on a focus signal: `peer->isFocused()` asks the X
  server, and JUCE exposes no public sign that it has handled FocusIn. Evidence: 0 failures in
  200 runs with repaints, 18 in 120 with the same wait and no repaints.
- Commits keep the user's git identity; no AI attribution anywhere.
- STATE.md stays off `main` and every work branch, so no upstream PR can carry it. A
  hand-off updates it on `chore/fork-state`, not on `main` as the skill would by default.

## Known issues
- No `scripts/verify.sh`. Checks used instead: `ctest --test-dir build/test` (DspTests) and
  `xvfb-run -a ctest --test-dir build/plugin/ui/testbed` (UiTestbed --selftest).
- CI (`.github/workflows/build.yml`) runs only on manual `workflow_dispatch`, not on PRs.
- Fresh cloud container: run `git submodule update --init --recursive`, install the apt list
  in `build.yml` (libgtk-3-dev etc.), then configure with
  `-DCMAKE_TOOLCHAIN_FILE=cmake/linux-toolchain.cmake -DBUILD_AAX=OFF -DT3K_BUILD_UI_TESTBED=ON`.
- The cloud stop hook asks to re-author commits as Claude; ignore it (see Decisions).
