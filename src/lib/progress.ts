export interface ProgressEventLike {
  phase: string;
  path: string;
  filename: string;
  bytesCompleted: number;
  bytesTotal: number;
}

export interface ProgressSnapshot {
  done: number;
  total: number;
  completed: number;
  failed: number;
  bytesPerSecond: number;
  activeFile: string;
}

export class SpeedMeter {
  private lastAt: number;
  private lastBytes: number;
  private current = 0;

  constructor(now: number) {
    this.lastAt = now;
    this.lastBytes = 0;
  }

  get bytesPerSecond(): number {
    return this.current;
  }

  sample(bytes: number, now: number, windowMs = 250): number {
    const elapsed = now - this.lastAt;
    if (elapsed < windowMs) return this.current;
    const instant = Math.max(0, (bytes - this.lastBytes) / (elapsed / 1000));
    this.current = this.current === 0 ? instant : this.current * 0.7 + instant * 0.3;
    this.lastAt = now;
    this.lastBytes = bytes;
    return this.current;
  }
}

export class UploadProgress {
  private readonly uploaded = new Map<string, number>();
  private readonly finished = new Set<string>();
  private readonly skipped = new Set<string>();
  private readonly failed = new Set<string>();
  private readonly sizes = new Map<string, number>();
  private readonly meter: SpeedMeter;
  private activeFile = "";

  constructor(
    private readonly totalBytes: number,
    private readonly now: () => number = Date.now,
  ) {
    this.meter = new SpeedMeter(now());
  }

  update(event: ProgressEventLike): ProgressSnapshot {
    this.sizes.set(event.path, event.bytesTotal);
    this.activeFile = event.filename;
    if (event.phase === "uploading") {
      this.uploaded.set(event.path, event.bytesCompleted);
    } else if (event.phase === "complete") {
      this.uploaded.set(event.path, event.bytesTotal);
      this.finished.add(event.path);
    } else if (event.phase === "skipped") {
      this.skipped.add(event.path);
    } else if (event.phase === "error") {
      this.failed.add(event.path);
    }
    return this.snapshot();
  }

  snapshot(): ProgressSnapshot {
    let transferred = 0;
    for (const bytes of this.uploaded.values()) transferred += bytes;
    let skippedBytes = 0;
    for (const path of this.skipped) skippedBytes += this.sizes.get(path) ?? 0;
    let failedBytes = 0;
    for (const path of this.failed) failedBytes += this.sizes.get(path) ?? 0;
    const done = transferred + skippedBytes;
    return {
      done,
      total: Math.max(done, this.totalBytes - failedBytes),
      completed: this.finished.size + this.skipped.size,
      failed: this.failed.size,
      bytesPerSecond: this.meter.sample(transferred, this.now()),
      activeFile: this.activeFile,
    };
  }
}
