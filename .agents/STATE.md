# State

Lives only on the fork-only branch `chore/fork-state` (no shared history with `main`, never
merged), so it can't reach upstream. Read it with `git show origin/chore/fork-state:.agents/STATE.md`.

## Now
- TONE3000 plugin: JUCE audio plugin (VST3, AU, CLAP, LV2, Standalone) that loads NAM captures
  and IRs from tone3000.com or local files. `VERSION` on `main`: 0.0.12. This repo is the fork
  `elarmuzik1993/tone3000-plugin`; work branches start from `main` and go upstream as fork PRs.
- `feat/tuner-mute` (2 commits): a speaker toggle on the tuner screen fades the output to silence
  while the tuner is open; `prepareToPlay` starts the output gain at 0 while muted, so a rate or
  buffer change can't blast sound through. Plus its UI self-test. Upstream: #227 (`Closes #222`).
- `fix/flaky-focus-test`: UI self-tests that drive a real window repaint ~100 ms after X grants
  focus, so the queued FocusIn lands first ("Focus policy / a keyboard-opened menu" failed ~1 run
  in 8 under xvfb before).
- `fix/clap-validate-path`: `validate-plugin.sh` tests the `.clap` with `-e`, not `-d` (it is one
  file on Linux and Windows, so the CLAP check never ran there).

## Next
1. Answer review on #227. Close fork PR #5 (`feat/tuner-mute` against the fork's `main`); #227 replaces it.
2. Review and merge `fix/flaky-focus-test` on the fork; decide whether to offer it and
   `fix/clap-validate-path` upstream (#227's description links both).
3. Fix LV2 on Linux in `validate-plugin.sh`: a relative `LV2_PATH` that lilv rejects and lv2lint
   segfaults on (seen 2026-10-05, not rechecked).
4. Possible real bug, seen only in tests: a menu opened in a plugin window without OS focus may
   lose keyboard focus when the late FocusIn lands, so Escape won't close it. Try a Linux host.
5. Workflow kit: `AGENTS.md` and `scripts/verify.sh` can't sit on `main` (every PR branches from
   it). Decide where they live: this branch, or local-only files.

## Decisions
- Focus setup waits by repainting, not on a focus signal: `peer->isFocused()` asks the X server
  and JUCE exposes no public FocusIn-handled signal. 0 failures in 200 runs with repaints, 18 in 120 without.
- Commits keep the user's identity, never AI attribution. STATE.md stays here, off `main` and every
  work branch, so no upstream PR carries it; a hand-off updates it here.
- Upstream PR bodies link fork PRs as `elarmuzik1993/tone3000-plugin#N`; a bare `#N` upstream is another PR.

## Known issues
- No `scripts/verify.sh`. Checks: `./script/test-dsp.sh` (DspTests, Release `build/`) and
  `xvfb-run -a ctest --test-dir build/plugin/ui/testbed` (needs `-DT3K_BUILD_UI_TESTBED=ON`).
- Signing: the Linux laptop signs with a GPG key whose only email is boris.miscenco@gmail.com; any
  other committer email shows Unverified. Cloud commits show Unverified too (key unknown to GitHub).
- `gh pr edit` fails (Projects classic); use `gh api -X PATCH repos/<o>/<r>/pulls/<n> -F body=@file`.
- CI (`.github/workflows/build.yml`) runs only on manual `workflow_dispatch`, not on PRs.
- Fresh cloud container: `git submodule update --init --recursive`, the apt list in `build.yml`, then
  `-DCMAKE_TOOLCHAIN_FILE=cmake/linux-toolchain.cmake -DBUILD_AAX=OFF -DT3K_BUILD_UI_TESTBED=ON`.
- The cloud stop hook asks to re-author commits as Claude; ignore it (see Decisions).
