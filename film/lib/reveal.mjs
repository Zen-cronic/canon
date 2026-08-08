/** Slow reveal-scrolls for long content.
 *
 * A static hold on a table is dead air: the viewer finishes reading in two
 * seconds and then watches nothing for four. Creeping the page instead keeps
 * the frame alive and shows more rows than a single framing can hold, which is
 * the whole argument of the sweep and backlog sections — that there is more
 * here than the one question that demos well.
 */

/** Creep from the element's top through `distance` px over `ms`, in eased steps. */
export async function creep(page, d, loc, { distance = 520, ms = 4200, steps = 7 } = {}) {
  await loc.evaluate((el) => el.scrollIntoView({ behavior: "smooth", block: "start" }));
  await page.waitForTimeout(900);
  const start = await page.evaluate(() => window.scrollY);
  const dwell = Math.max(240, Math.round(ms / steps));
  for (let i = 1; i <= steps; i++) {
    await page.evaluate((top) => window.scrollTo({ top, behavior: "smooth" }), start + (distance * i) / steps);
    await page.waitForTimeout(dwell);
  }
  await d.sync();
}

/** Hold, but with the cursor drifting — stillness without deadness.
 *
 * The drift is derived from `nth`, never random: two runs of the same act must
 * produce the same take, or "re-run these commands to reproduce the video" is
 * a claim the rig cannot keep.
 */
export async function dwell(page, d, ms, nth = 0) {
  const half = Math.max(200, Math.round(ms / 2));
  await page.waitForTimeout(half);
  const x = 700 + ((nth * 137) % 320);
  const y = 460 + ((nth * 89) % 160);
  await d.glide(x, y, Math.min(700, half));
  await page.waitForTimeout(half);
}
