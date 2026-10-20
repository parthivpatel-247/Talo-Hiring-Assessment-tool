import { describe, it, expect } from 'vitest';
import { mapPool } from '../src/routes/admin';

describe('mapPool — bounded concurrency used for resume upload/parse', () => {
  it('preserves input order in the results regardless of completion order', async () => {
    // Later items finish FIRST (descending delay) — results must still be in order.
    const out = await mapPool([0, 1, 2, 3, 4], 3, async (n) => {
      await new Promise((r) => setTimeout(r, (5 - n) * 5));
      return n * 10;
    });
    expect(out).toEqual([0, 10, 20, 30, 40]);
  });

  it('never runs more than `limit` tasks at once', async () => {
    let inFlight = 0;
    let peak = 0;
    await mapPool(Array.from({ length: 20 }, (_, i) => i), 6, async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
    });
    expect(peak).toBeLessThanOrEqual(6);
    expect(peak).toBeGreaterThan(1); // actually ran concurrently, not serialized
  });

  it('runs every item exactly once', async () => {
    const seen: number[] = [];
    await mapPool([10, 20, 30], 2, async (n) => { seen.push(n); });
    expect(seen.sort((a, b) => a - b)).toEqual([10, 20, 30]);
  });

  it('handles an empty list and a limit larger than the list', async () => {
    expect(await mapPool([], 6, async (n) => n)).toEqual([]);
    expect(await mapPool([1, 2], 10, async (n) => n * 2)).toEqual([2, 4]);
  });
});
