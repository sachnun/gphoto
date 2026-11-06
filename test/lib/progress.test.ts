import { describe, expect, test } from "bun:test";
import { SpeedMeter, UploadProgress } from "../../src/lib/progress.ts";
import { progressLine } from "../../src/lib/ui.ts";

describe("SpeedMeter", () => {
  test("reports zero before the first sample window", () => {
    const meter = new SpeedMeter(1000);
    expect(meter.sample(500, 1050)).toBe(0);
    expect(meter.bytesPerSecond).toBe(0);
  });

  test("computes bytes per second after the window", () => {
    const meter = new SpeedMeter(1000);
    expect(meter.sample(500_000, 1500)).toBeCloseTo(1_000_000, 0);
  });

  test("smooths later samples", () => {
    const meter = new SpeedMeter(0);
    meter.sample(1_000_000, 1000);
    const smoothed = meter.sample(1_000_000, 2000);
    expect(smoothed).toBeLessThan(1_000_000);
    expect(smoothed).toBeGreaterThan(0);
  });
});

describe("UploadProgress", () => {
  test("tracks uploaded bytes and completion counts", () => {
    const progress = new UploadProgress(300, () => 0);
    expect(progress.update({ phase: "uploading", path: "/a", filename: "a.jpg", bytesCompleted: 100, bytesTotal: 100 })).toMatchObject({
      done: 100,
      total: 300,
      completed: 0,
    });
    const snapshot = progress.update({ phase: "complete", path: "/a", filename: "a.jpg", bytesCompleted: 100, bytesTotal: 100 });
    expect(snapshot.done).toBe(100);
    expect(snapshot.completed).toBe(1);
  });

  test("counts skipped files as done and failures as removed", () => {
    const progress = new UploadProgress(500, () => 0);
    progress.update({ phase: "skipped", path: "/a", filename: "a.jpg", bytesCompleted: 200, bytesTotal: 200 });
    const snapshot = progress.update({ phase: "error", path: "/b", filename: "b.jpg", bytesCompleted: 0, bytesTotal: 300 });
    expect(snapshot.done).toBe(200);
    expect(snapshot.total).toBe(200);
    expect(snapshot.failed).toBe(1);
  });

  test("never reports done above the total", () => {
    const progress = new UploadProgress(100, () => 0);
    const snapshot = progress.update({ phase: "uploading", path: "/a", filename: "a.jpg", bytesCompleted: 500, bytesTotal: 100 });
    expect(snapshot.done).toBe(500);
    expect(snapshot.total).toBe(500);
  });
});

describe("progressLine", () => {
  test("renders bar, bytes, speed and ETA", () => {
    const line = progressLine({ done: 50, total: 100, bytesPerSecond: 25, width: 4 });
    expect(line).toContain("50%");
    expect(line).toContain("50 B/100 B");
    expect(line).toContain("25 B/s");
    expect(line).toContain("ETA 0:02");
  });

  test("omits the ETA once complete", () => {
    const line = progressLine({ done: 100, total: 100, bytesPerSecond: 25, width: 4 });
    expect(line).not.toContain("ETA");
  });

  test("renders a label when provided", () => {
    expect(progressLine({ done: 0, total: 0, bytesPerSecond: 0, label: "a.jpg" })).toContain("a.jpg");
  });
});
