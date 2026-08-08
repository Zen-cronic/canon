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

# 3. Voiceover: per-cue synthesis, beat-timed from the capture, gated against
#    overlaps. Needs ELEVENLABS_API_KEY + ELEVEN_VOICE_ID (a premade voice —
#    instantly-cloned voices need a paid tier). Prefer your own read? Record it
#    to film/takes/vo/override/<cue-id>.mp3 and it supersedes synthesis.
node film/vo.mjs --marks      # placement report, free
node film/vo.mjs --dry        # synthesize + fit report, no mux
node film/vo.mjs              # -> film/out/canon-final.mp4

# 4. Gate it before uploading.
node film/verify.mjs film/out/canon-final.mp4
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

- **Voiceover is synthesized per cue and content-addressed**, so editing one
  line re-synthesizes that line and nothing else. Cues are placed by `adelay` at
  marks derived from `beats.json`, and a line that would run into the next one
  is a hard refusal to mux, not a warning.
- **Two gates earned their keep on the first run.** `-c:v copy` rewrites the
  container, so faststart was lost on the mux until `verify.mjs` caught it from
  the bytes; and the first master measured **-21.8 LUFS**, which YouTube would
  not have boosted, so the mux now loudnorms to -16.
- **Timing is derived.** `assemble.mjs` measures each take and subtracts the
  seams. Nothing in the cut is a typed timestamp.
- **The window must stay unobstructed.** x11grab captures the window as
  composited; a notification popping over it is in the take.
- `takes/`, `out/` and `node_modules/` are ignored — footage is reproducible,
  not source. `endcard.html` is generated.
