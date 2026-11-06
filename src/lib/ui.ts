const useColor = process.stdout.isTTY && !process.env.NO_COLOR;

const code = (open: number, close: number) => (text: string) => (useColor ? `\x1b[${open}m${text}\x1b[${close}m` : text);

export const bold = code(1, 22);
export const dim = code(2, 22);
export const red = code(31, 39);
export const green = code(32, 39);
export const yellow = code(33, 39);
export const blue = code(34, 39);
export const cyan = code(36, 39);

export function humanBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value.toFixed(index === 0 ? 0 : value >= 100 ? 0 : 1)} ${units[index]}`;
}

export function humanSpeed(bytesPerSecond: number): string {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return "0 B/s";
  return `${humanBytes(bytesPerSecond)}/s`;
}

export function humanDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0:00";
  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const mm = hours > 0 ? String(minutes).padStart(2, "0") : String(minutes);
  return `${hours > 0 ? `${hours}:` : ""}${mm}:${String(seconds).padStart(2, "0")}`;
}

export function table(rows: string[][], header?: string[]): string {
  const all = header ? [header, ...rows] : rows;
  const widths: number[] = [];
  for (const row of all) {
    row.forEach((cell, index) => {
      const width = visibleLength(cell);
      widths[index] = Math.max(widths[index] ?? 0, width);
    });
  }
  const render = (row: string[]): string =>
    row.map((cell, index) => cell + " ".repeat((widths[index] ?? 0) - visibleLength(cell))).join("  ").trimEnd();
  const lines: string[] = [];
  if (header) {
    lines.push(bold(render(header)));
    lines.push(dim(widths.map((width) => "-".repeat(width)).join("  ")));
  }
  for (const row of rows) lines.push(render(row));
  return lines.join("\n");
}

function visibleLength(text: string): number {
  return text.replace(/\x1b\[[0-9;]*m/g, "").length;
}

export function spinner(label: string): { stop: (message?: string) => void } {
  if (!process.stderr.isTTY) {
    process.stderr.write(`${label}\n`);
    return { stop: (message) => message && process.stderr.write(`${message}\n`) };
  }
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let index = 0;
  const timer = setInterval(() => {
    process.stderr.write(`\r${cyan(frames[index % frames.length]!)} ${label}`);
    index += 1;
  }, 80);
  return {
    stop: (message) => {
      clearInterval(timer);
      process.stderr.write(`\r\x1b[2K${message ?? label}\n`);
    },
  };
}

export function progressBar(done: number, total: number, width = 24): string {
  const ratio = total > 0 ? Math.min(1, done / total) : 0;
  const filled = Math.round(ratio * width);
  const bar = `${"█".repeat(filled)}${"░".repeat(width - filled)}`;
  const percent = String(Math.round(ratio * 100)).padStart(3);
  return `${cyan(bar)} ${percent}%`;
}

export interface ProgressLineOptions {
  done: number;
  total: number;
  bytesPerSecond: number;
  label?: string;
  width?: number;
}

export function progressLine(options: ProgressLineOptions): string {
  const { done, total, bytesPerSecond, label, width = 24 } = options;
  const parts = [
    progressBar(done, total, width),
    dim(`${humanBytes(done)}/${humanBytes(total)}`),
    cyan(humanSpeed(bytesPerSecond)),
  ];
  const remaining = Math.max(0, total - done);
  if (bytesPerSecond > 0 && remaining > 0) parts.push(dim(`ETA ${humanDuration((remaining / bytesPerSecond) * 1000)}`));
  if (label) parts.push(dim(label));
  return parts.join(" ");
}

export function fail(message: string): never {
  process.stderr.write(`${red("error")} ${message}\n`);
  process.exit(1);
}
