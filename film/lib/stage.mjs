/** The recorder: a headed Chrome app window captured by FFmpeg, driven by Playwright.
 *
 * Adapted from the author's own film rig for an earlier project. Kept because
 * the hard-won parts are not obvious: forcing Chrome onto XWayland so x11grab
 * can see it, converging the window until the CSS viewport is exactly
 * FRAME/SCALE, and clamping the crop inside the window's real geometry.
 *
 * Why not Playwright's recordVideo: that path is hardcoded VP8 at ~1 Mbit/s and smears
 * the small monospace provenance chips the provenance rail depends on. FFmpeg x11grab at CRF 16
 * H.264 keeps them legible through YouTube's re-encode.
 *
 * The window opens in --app mode (no tabs, no omnibox) with the automation infobar
 * suppressed, and the capture is CROPPED to the measured page viewport — so the take is
 * pure product pixels at exactly the composition size, never upscaled.
 *
 * deviceScaleFactor 1.25 renders everything a quarter larger inside the same 1920x1080
 * physical frame — the shot-list's "bump display scale so provenance chips survive
 * video compression", enacted in the rig instead of left as an operator note.
 *
 * Playwright records the page, not the desktop, so three things a viewer reads as
 * "a person is driving this" are absent by default: a cursor in frame, eased mouse
 * travel, and smooth scroll. Each is added back here, so a take reads as choreography.
 */
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";

export const FRAME = { width: 1920, height: 1080 };
const SCALE = 1.25;

const CURSOR_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' +
  '<path d="M4 2l7 18 2.6-7.6L21 10z" fill="#fff" stroke="#0b0f14" stroke-width="1.3" stroke-linejoin="round"/></svg>';

/** Injected before any app script runs. The ring pulse marks clicks. */
const CURSOR_INIT = `
  (() => {
    const add = () => {
      if (document.getElementById("__canon_cursor")) return;
      const cur = document.createElement("div");
      cur.id = "__canon_cursor";
      cur.setAttribute("aria-hidden", "true");
      cur.style.cssText = "position:fixed;z-index:2147483647;pointer-events:none;width:22px;" +
        "height:22px;left:0;top:0;will-change:transform;filter:drop-shadow(0 2px 3px rgba(0,0,0,.5));" +
        "background:no-repeat center/contain url('data:image/svg+xml;utf8,${encodeURIComponent(CURSOR_SVG)}')";
      const ring = document.createElement("div");
      ring.id = "__canon_ring";
      ring.setAttribute("aria-hidden", "true");
      ring.style.cssText = "position:fixed;z-index:2147483646;pointer-events:none;width:38px;height:38px;" +
        "border-radius:50%;background:rgba(91,77,245,.45);left:0;top:0;opacity:0;will-change:transform";
      document.body.append(ring, cur);
      window.__canonAt = (x, y) => {
        cur.style.transform = "translate(" + x + "px," + y + "px)";
        ring.style.transform = "translate(" + (x - 8) + "px," + (y - 8) + "px) scale(.35)";
      };
      window.__canonPulse = () => {
        const t = ring.style.transform;
        ring.animate(
          [{ opacity: .8, transform: t }, { opacity: 0, transform: t.replace("scale(.35)", "scale(1.6)") }],
          { duration: 460, easing: "ease-out" });
      };
    };
    if (document.body) add();
    else document.addEventListener("DOMContentLoaded", add);
  })();
`;

const sh = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8" }).trim();

async function findWindow(className) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const ids = sh("xdotool", ["search", "--onlyvisible", "--class", className])
        .split(/\s+/).filter(Boolean);
      if (ids.length) return ids.at(-1);
    } catch {}
    await new Promise((r) => setTimeout(r, 120));
  }
  throw new Error(`no headed Chrome window with class ${className}`);
}

function startRecorder(windowId, crop, output) {
  const recorder = spawn("ffmpeg", [
    "-y", "-loglevel", "warning",
    "-f", "x11grab",
    "-draw_mouse", "0",
    "-framerate", "30",
    "-window_id", windowId,
    "-i", process.env.DISPLAY ?? ":0",
    // Crop to the measured viewport, then normalize to the frame — the scale is a
    // guard against 1-2px rounding from the device scale factor, not an upscale.
    "-vf", `crop=${crop.w}:${crop.h}:${crop.x}:${crop.y},scale=${FRAME.width}:${FRAME.height}:flags=lanczos`,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "16",
    "-pix_fmt", "yuv420p", "-movflags", "+faststart",
    output,
  ], { stdio: ["pipe", "ignore", "pipe"] });
  let stderr = "";
  const handle = { recorder, exited: null, stderr: () => stderr };
  recorder.stderr.on("data", (c) => { stderr += c.toString(); });
  recorder.stdin.on("error", () => {}); // EPIPE on a dead recorder is handled below
  recorder.on("close", (code) => { handle.exited = code ?? -1; });
  return handle;
}

async function stopRecorder(handle, dir) {
  // A recorder that died mid-take is the worst kind of silent failure: the
  // choreography keeps running and the "capture" has no final frame index. If
  // it already exited, say so loudly with its own stderr, not a generic hang —
  // and never await a close event that has already fired.
  if (handle.exited === null) {
    handle.recorder.stdin.write("q\n");
    await Promise.race([
      once(handle.recorder, "close"),
      new Promise((_, rej) => setTimeout(() => rej(new Error("ffmpeg did not stop within 15s")), 15_000)),
    ]);
  }
  writeFileSync(`${dir}/ffmpeg.log`, handle.stderr());
  if (handle.exited !== 0) {
    throw new Error(`ffmpeg exited ${handle.exited} mid-take:\n${handle.stderr().slice(-2000)}`);
  }
}

/** One recorded take: boots the app window, records url's viewport, runs fn(page, d),
 *  writes <dir>/capture.mp4 + beats.json. */
export async function stage(dir, url, fn, { className = "CanonFilm" } = {}) {
  mkdirSync(dir, { recursive: true });
  // A stale profile replays yesterday's localStorage into today's take.
  rmSync(`${dir}/browser-profile`, { recursive: true, force: true });
  const ctx = await chromium.launchPersistentContext(`${dir}/browser-profile`, {
    channel: "chrome",
    headless: false,
    viewport: null,
    reducedMotion: "no-preference",
    // Removing --enable-automation drops the "controlled by automated test software"
    // infobar, which would otherwise sit inside every frame.
    ignoreDefaultArgs: ["--enable-automation"],
    args: [
      "--ozone-platform=x11",
      `--class=${className}`,
      `--app=${url}`,
      `--window-size=${FRAME.width},${FRAME.height + 120}`,
      "--window-position=0,0",
      `--force-device-scale-factor=${SCALE}`,
      "--hide-scrollbars",
      "--no-first-run",
      "--no-default-browser-check",
    ],
  });
  await ctx.addInitScript(CURSOR_INIT);
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.waitForLoadState("domcontentloaded");
  const windowId = await findWindow(className);

  // Size the window so the CSS viewport is exactly FRAME/SCALE — then the physical
  // pixels under the crop are exactly FRAME. Measured, not assumed: app-mode chrome
  // height varies by Chrome version and WM.
  const wantCssW = Math.round(FRAME.width / SCALE);
  const wantCssH = Math.round(FRAME.height / SCALE);
  let crop = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const m = await page.evaluate(() => ({
      innerW: window.innerWidth, innerH: window.innerHeight,
      outerW: window.outerWidth, outerH: window.outerHeight,
      dpr: window.devicePixelRatio,
    }));
    if (m.innerW === wantCssW && m.innerH === wantCssH) {
      // Chrome's app window puts all its chrome above the viewport; side/bottom
      // borders are zero on this platform. Verified against extracted frames.
      const chromeTop = Math.round((m.outerH - m.innerH) * m.dpr);
      const chromeSide = Math.round(((m.outerW - m.innerW) / 2) * m.dpr);
      crop = {
        w: Math.round(m.innerW * m.dpr), h: Math.round(m.innerH * m.dpr),
        x: chromeSide, y: chromeTop,
      };
      break;
    }
    const growW = wantCssW - m.innerW;
    const growH = wantCssH - m.innerH;
    sh("xdotool", ["windowsize", windowId,
      String(Math.round(m.outerW * m.dpr) + Math.round(growW * m.dpr)),
      String(Math.round(m.outerH * m.dpr) + Math.round(growH * m.dpr))]);
    await page.waitForTimeout(350);
  }
  if (!crop) throw new Error("could not converge the window on the target viewport");
  sh("xdotool", ["windowmove", windowId, "0", "0"]);
  sh("xdotool", ["windowactivate", "--sync", windowId]);
  await page.waitForTimeout(300);

  // Clamp the crop inside the window's REAL physical geometry. A crop that
  // overruns the grab area by even one row kills ffmpeg instantly, and the
  // choreography would keep acting to a dead camera.
  const geo = sh("xdotool", ["getwindowgeometry", "--shell", windowId]);
  const winW = Number(geo.match(/^WIDTH=(\d+)$/m)?.[1] ?? 0);
  const winH = Number(geo.match(/^HEIGHT=(\d+)$/m)?.[1] ?? 0);
  if (winW && winH) {
    crop.x = Math.max(0, Math.min(crop.x, winW - 16));
    crop.y = Math.max(0, Math.min(crop.y, winH - 16));
    crop.w = Math.min(crop.w, winW - crop.x);
    crop.h = Math.min(crop.h, winH - crop.y);
  }

  const output = `${dir}/capture.mp4`;
  const rec = startRecorder(windowId, crop, output);
  const t0 = Date.now();
  const beats = [];
  const d = driver(page, { width: wantCssW, height: wantCssH });
  d.beat = (label) => {
    const t = (Date.now() - t0) / 1000;
    beats.push({ label, t: Math.round(t * 100) / 100 });
    console.log(`  beat ${label.padEnd(14)} ${t.toFixed(2)}s`);
  };
  const dump = () => writeFileSync(`${dir}/beats.json`, JSON.stringify(beats, null, 2) + "\n");

  try {
    await fn(page, d);
    d.beat("end");
    await page.waitForTimeout(250);
  } catch (err) {
    // A take is expensive to re-shoot blind: keep the frame it died on, and the
    // partial beat map that localizes where.
    await page.screenshot({ path: `${dir}/FAILED.png` }).catch(() => {});
    dump();
    await stopRecorder(rec, dir).catch((e) => console.error(String(e)));
    await ctx.close();
    throw err;
  }
  dump();
  await stopRecorder(rec, dir);
  await ctx.close();
  writeFileSync(`${dir}/capture.json`, JSON.stringify(
    { camera: "ffmpeg-x11-window", crop, scale: SCALE, frame: FRAME, url }, null, 2) + "\n");
}

function driver(page, viewport) {
  let cx = viewport.width / 2, cy = viewport.height * 0.62;
  const sync = () => page.evaluate(([x, y]) => window.__canonAt?.(x, y), [cx, cy]).catch(() => {});

  /** Ease the pointer over ~60fps steps; a straight jump reads as a cut. */
  async function glide(x, y, ms = 620) {
    const steps = Math.max(10, Math.round(ms / 16));
    const [x0, y0] = [cx, cy];
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      cx = x0 + (x - x0) * e;
      cy = y0 + (y - y0) * e;
      await page.mouse.move(cx, cy);
      await sync();
      await page.waitForTimeout(16);
    }
  }

  const d = {
    sync,
    glide,
    /** Bring the target on screen BEFORE aiming at it. boundingBox() is
     *  viewport-relative; a control below the fold yields a y the mouse can never
     *  reach, and the take only fails a minute later waiting on the click's effect. */
    async to(loc, ms = 620) {
      let box = await loc.boundingBox();
      if (!box || box.y < 56 || box.y + box.height > viewport.height - 32) {
        await loc.evaluate((el) => el.scrollIntoView({ behavior: "smooth", block: "center" }));
        await page.waitForTimeout(850);
        await sync();
        box = await loc.boundingBox();
      }
      if (!box) throw new Error("no box for locator");
      await glide(box.x + box.width / 2, box.y + box.height / 2, ms);
    },
    /** Raw press at the cursor's current position — for canvas targets and
     *  anything without a locator. */
    async click() {
      await page.evaluate(() => window.__canonPulse?.());
      await page.mouse.down();
      await page.waitForTimeout(75);
      await page.mouse.up();
    },
    /** Travel to a control and press it — the two-step a person performs.
     *
     *  The actual press goes through locator.click() rather than raw
     *  mouse.down/up. On a surface that re-renders while you aim at it — the
     *  arena bar re-lays out every tick as the status chip's width changes —
     *  a raw press can land in the gap the button just vacated, or straddle a
     *  re-render between down and up. Both leave the cursor hovering the
     *  control (label expands, looks pressed) while the handler never fires,
     *  which is a silent miss: the take rolls on and only dies a minute later
     *  waiting for what the click was supposed to cause. locator.click()
     *  waits for a stable box that actually receives events. The glide before
     *  it is what makes the press read as a person doing it. */
    async press(loc, { travel = 620, settle = 220, timeout = 15_000 } = {}) {
      await d.to(loc, travel);
      await page.waitForTimeout(settle);
      await page.evaluate(() => window.__canonPulse?.());
      await loc.click({ timeout });
    },
    /** Native smooth scroll; mouse.wheel jumps a whole page per notch. */
    async scrollTo(y, ms = 900) {
      await page.evaluate((top) => window.scrollTo({ top, behavior: "smooth" }), y);
      await page.waitForTimeout(ms);
      await sync();
    },
    async scrollToEl(loc, { ms = 1000 } = {}) {
      await loc.evaluate((el) => el.scrollIntoView({ behavior: "smooth", block: "center" }));
      await page.waitForTimeout(ms);
      await sync();
    },
    /** Type at a human cadence so the viewer can read along. */
    async type(text, delay = 42) {
      await page.keyboard.type(text, { delay });
    },
    wait: (ms) => page.waitForTimeout(ms),
  };
  return d;
}
