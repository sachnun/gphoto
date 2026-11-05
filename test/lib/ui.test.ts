import { describe, expect, test } from "bun:test";
import { humanBytes, humanDuration, progressBar, table } from "../../src/lib/ui.ts";
import { aliases, int, str } from "../../src/cli/command.ts";

describe("humanBytes", () => {
  test("formats common sizes", () => {
    expect(humanBytes(0)).toBe("0 B");
    expect(humanBytes(512)).toBe("512 B");
    expect(humanBytes(1024)).toBe("1.0 KB");
    expect(humanBytes(1536)).toBe("1.5 KB");
    expect(humanBytes(1024 ** 3)).toBe("1.0 GB");
    expect(humanBytes(1024 ** 4)).toBe("1.0 TB");
  });

  test("formats large values without decimals", () => {
    expect(humanBytes(150 * 1024 ** 2)).toBe("150 MB");
  });

  test("guards against invalid input", () => {
    expect(humanBytes(-5)).toBe("0 B");
    expect(humanBytes(Number.NaN)).toBe("0 B");
  });
});

describe("humanDuration", () => {
  test("formats minutes and seconds", () => {
    expect(humanDuration(0)).toBe("0:00");
    expect(humanDuration(30_000)).toBe("0:30");
    expect(humanDuration(90_000)).toBe("1:30");
  });

  test("formats hours", () => {
    expect(humanDuration(3_725_000)).toBe("1:02:05");
  });

  test("guards against invalid input", () => {
    expect(humanDuration(-1)).toBe("0:00");
    expect(humanDuration(Number.POSITIVE_INFINITY)).toBe("0:00");
  });
});

describe("progressBar", () => {
  test("renders empty and full bars", () => {
    expect(progressBar(0, 100, 4)).toContain("░░░░");
    expect(progressBar(100, 100, 4)).toContain("████");
    expect(progressBar(50, 100, 4)).toContain("██░░");
  });

  test("handles a zero total", () => {
    expect(progressBar(10, 0, 4)).toContain("0%");
  });
});

describe("table", () => {
  test("pads columns to the widest cell", () => {
    const rendered = table([["a", "bb"], ["ccc", "d"]], ["h1", "h2"]);
    const lines = rendered.split("\n");
    expect(lines[0]).toContain("h1");
    expect(lines[1]).toContain("--");
    expect(lines[2]).toContain("a  ");
    expect(lines[3]).toContain("ccc");
  });

  test("omits the header when not provided", () => {
    expect(table([["only"]]).split("\n")).toHaveLength(1);
  });

  test("ignores ANSI codes when measuring width", () => {
    const rendered = table([["\x1b[32mab\x1b[39m", "x"], ["abcd", "y"]]);
    const visible = rendered.split("\n")[0]!.replace(/\x1b\[[0-9;]*m/g, "");
    expect(visible).toBe("ab    x");
  });
});

describe("cli value helpers", () => {
  test("str returns only non empty strings", () => {
    expect(str("x")).toBe("x");
    expect(str("")).toBeUndefined();
    expect(str(1)).toBeUndefined();
    expect(str(true)).toBeUndefined();
    expect(str(undefined)).toBeUndefined();
  });

  test("int parses finite numbers", () => {
    expect(int("42")).toBe(42);
    expect(int("4.5")).toBe(4.5);
    expect(int("abc")).toBeUndefined();
    expect(int(undefined)).toBeUndefined();
  });

  test("aliases normalizes to an array", () => {
    expect(aliases("a")).toEqual(["a"]);
    expect(aliases(["a", "b"])).toEqual(["a", "b"]);
    expect(aliases(undefined)).toEqual([]);
  });
});
