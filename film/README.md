# film — the demo video, rendered from source

The demo is not a screen recording somebody made once. It is a build: Playwright
drives the **real report** in a headed Chrome window, FFmpeg records that
window's viewport at CRF 16 H.264, and the takes are composited with xfade
seams. Re-running these commands reproduces the video — the same property canon
argues for about rulings.

Why FFmpeg rather than Playwright's own recorder: `recordVideo` is hardcoded
VP8 at ~1 Mbit/s and smears the monospace URNs in the provenance rail, which is
the evidence a judge grades criterion 1 on.

## The cut — 2:21

| take | on screen |
|---|---|
| act0 | the kill shot: `$7,951,811.55` struck through → `$7,121,844.95`, and the verdict line |
| act1 | evidence studio: **Play**, lineage neighbourhood resolves, `TRANSFORMED`/`COPY`/`SIBLING`, `RESOLVED` |
| act2 | what a name-matching / freshest-table / social-proof agent picks — then the priced gap |
| act3 | the governed write-back, and the one human click; receipts naming each transport; ask-twice |
| act4 | every contested subject in the catalog, the refusal backlog, downstream effect, and abstention |
| act5 | end card — repo · live URL · Apache-2.0 |

Full screenplay with VO lines and rubric allocation: [`RUN-OF-SHOW.md`](RUN-OF-SHOW.md).

## Rebuild

```bash
npm --prefix film install

# 1. Capture. Renders the report first (npm run demo) so the take can never
#    film stale numbers. Keep your hands off the machine — the window is
#    grabbed from the X server, so anything raised lands in frame.
./film/capture.sh 0 1 2 3 4 5

# 2. Composite. Durations are measured from the takes, never typed.
node film/assemble.mjs        # -> film/out/canon-demo.mp4 + timeline.json

# 3. Gate it before uploading.
node film/verify.mjs
```

Re-shoot one act and re-run `assemble.mjs`; the cut re-times itself.

## Layout

| path | what it is |
|---|---|
| `lib/stage.mjs` | the recorder: app-mode Chrome forced onto XWayland, FFmpeg window capture cropped to the measured viewport, injected cursor, eased pointer, click pulse, beat stamps → `beats.json` |
| `lib/reveal.mjs` | creep-scrolls and drifting holds — deterministic, never random |
| `act*.mjs` | choreography per take, against the real report |
| `make-endcard.mjs` | builds `endcard.html`, lifting the report's own embedded `@font-face` blocks so the card cannot drift from the cut |
| `assemble.mjs` | xfade composite + `timeline.json` (the one clock) |
| `verify.mjs` | ffprobe + byte-level gates, and the manual checklist |

## Notes

- **No voiceover yet.** `verify.mjs` reports the absent audio track rather than
  passing silently. The run-of-show carries the script; record it and mux, or
  ship captioned-silent — but choose, don't default.
- **Timing is derived.** `assemble.mjs` measures each take and subtracts the
  seams. Nothing in the cut is a typed timestamp.
- **The window must stay unobstructed.** x11grab captures the window as
  composited; a notification popping over it is in the take.
- `takes/`, `out/` and `node_modules/` are ignored — footage is reproducible,
  not source. `endcard.html` is generated.
