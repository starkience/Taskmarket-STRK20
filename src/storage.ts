import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

// bridge-core persists its in-flight CCTP burn cursors in `localStorage`, and
// every read and write is wrapped in a try/catch that swallows failures. Node has
// no localStorage, so without this shim those reads return empty, every burn looks
// fresh, and a retried deposit burns real USDC a second time — the double-spend
// bridge-core's own comments warn about.
//
// Writes go straight to disk: a cursor held only in memory is lost in exactly the
// crash it exists to survive.
class FileStorage implements Storage {
  #file: string;
  #map: Record<string, string>;

  constructor(file: string) {
    this.#file = file;
    this.#map = this.#read();
  }

  #read(): Record<string, string> {
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.#file, "utf8"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, string>;
      }
    } catch {
      // Missing or corrupt file: start empty rather than refusing to run. A
      // corrupt cursor cannot be resumed off safely in any case.
    }
    return {};
  }

  #flush(): void {
    mkdirSync(dirname(this.#file), { recursive: true });
    writeFileSync(this.#file, JSON.stringify(this.#map), "utf8");
  }

  #refresh(): void {
    this.#map = this.#read();
  }

  get length(): number {
    this.#refresh();
    return Object.keys(this.#map).length;
  }

  key(index: number): string | null {
    this.#refresh();
    return Object.keys(this.#map)[index] ?? null;
  }

  getItem(key: string): string | null {
    // The dashboard and its action runner are separate Node processes. Reload
    // before reads so a cursor written by the child becomes visible on the next
    // dashboard poll instead of only after a server restart.
    this.#refresh();
    return Object.hasOwn(this.#map, key) ? (this.#map[key] as string) : null;
  }

  setItem(key: string, value: string): void {
    this.#refresh();
    this.#map[key] = String(value);
    this.#flush();
  }

  removeItem(key: string): void {
    this.#refresh();
    delete this.#map[key];
    this.#flush();
  }

  clear(): void {
    this.#map = {};
    this.#flush();
  }
}

// Must run before any bridge-core call that touches a cursor.
export function installFileStorage(file: string): () => void {
  const had = "localStorage" in globalThis;
  const previous = (globalThis as { localStorage?: Storage }).localStorage;
  (globalThis as { localStorage?: Storage }).localStorage = new FileStorage(file);

  return () => {
    if (had) {
      (globalThis as { localStorage?: Storage }).localStorage = previous;
    } else {
      delete (globalThis as { localStorage?: Storage }).localStorage;
    }
  };
}
