import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

export const SOURCE_ROOT = resolve(process.cwd(), "src");

export function sourceKey(absolute: string): string {
  return relative(SOURCE_ROOT, absolute).split("\\").join("/");
}

export function importsOf(absolute: string): string[] {
  const text = readFileSync(absolute, "utf8");
  const found: string[] = [];
  for (const match of text.matchAll(/\bfrom\s+"(\.{1,2}\/[^"]+)"/g)) {
    found.push(resolve(dirname(absolute), match[1]));
  }
  return found;
}

export function reachableFrom(entry: string): Set<string> {
  const seen = new Set<string>();
  const stack = [resolve(SOURCE_ROOT, entry)];

  while (stack.length > 0) {
    const file = stack.pop();
    if (file === undefined) {
      break;
    }
    const key = sourceKey(file);
    if (seen.has(key) || !existsSync(file)) {
      continue;
    }
    seen.add(key);
    for (const next of importsOf(file)) {
      stack.push(next);
    }
  }

  return seen;
}

export function readSource(relativePath: string): string {
  return readFileSync(resolve(SOURCE_ROOT, relativePath), "utf8");
}

export function directImportsOf(relativePath: string): string[] {
  return importsOf(resolve(SOURCE_ROOT, relativePath)).map(sourceKey);
}

export function sourceFiles(): string[] {
  const found: string[] = [];
  const stack = [SOURCE_ROOT];

  while (stack.length > 0) {
    const dir = stack.pop();
    if (dir === undefined) {
      break;
    }
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.name.endsWith(".ts")) {
        found.push(sourceKey(full));
      }
    }
  }

  return found.sort();
}
