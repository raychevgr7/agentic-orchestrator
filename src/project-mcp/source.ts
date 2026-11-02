import { readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

const ignoredDirectories = new Set([".git", ".idea", ".next", "build", "dist", "node_modules", "target", "vendor"]);
const supportedExtensions = new Set([".go", ".java", ".js", ".jsx", ".py", ".rb", ".rs", ".ts", ".tsx"]);
const maximumFileBytes = 1_000_000;

export interface SourceMatch { path: string; line: number; snippet: string; }
export interface RelevantFile { path: string; score: number; matchedQueries: string[]; snippets: Array<{ line: number; text: string }>; }

export class ProjectSource {
  private readonly root: string;

  public constructor(root: string) {
    this.root = realpathSync(root);
  }

  public listTests(maxResults = 200): string[] {
    return this.files().filter(isTestFile).slice(0, maxResults).map((file) => this.relativePath(file));
  }

  public search(query: string, maxResults = 12): SourceMatch[] {
    const needle = normalizedQuery(query);
    const results: SourceMatch[] = [];
    for (const file of this.files()) {
      const lines = readFileSync(file, "utf8").split(/\r?\n/);
      for (let index = 0; index < lines.length; index += 1) {
        if (lines[index]!.toLowerCase().includes(needle)) {
          results.push({ path: this.relativePath(file), line: index + 1, snippet: lines[index]!.trim().slice(0, 600) });
          if (results.length >= maxResults) return results;
        }
      }
    }
    return results;
  }

  public findRelevantFiles(queries: string[], maxResults = 8): RelevantFile[] {
    const needles = [...new Set(queries.map(normalizedQuery))];
    return this.files().map((file) => {
      const path = this.relativePath(file);
      const lowerPath = path.toLowerCase();
      const lines = readFileSync(file, "utf8").split(/\r?\n/);
      const matchedQueries: string[] = [];
      const snippets: Array<{ line: number; text: string }> = [];
      let score = isTestFile(file) ? 2 : 0;
      for (const needle of needles) {
        let occurrences = lowerPath.includes(needle) ? 2 : 0;
        for (let index = 0; index < lines.length; index += 1) {
          if (lines[index]!.toLowerCase().includes(needle)) {
            occurrences += 1;
            if (snippets.length < 4) snippets.push({ line: index + 1, text: lines[index]!.trim().slice(0, 300) });
          }
        }
        if (occurrences > 0) {
          matchedQueries.push(needle);
          score += Math.min(occurrences, 4);
        }
      }
      return { path, score, matchedQueries, snippets };
    }).filter((file) => file.matchedQueries.length > 0)
      .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path))
      .slice(0, maxResults);
  }

  public readExcerpt(path: string, startLine = 1, maxLines = 120): { path: string; startLine: number; endLine: number; content: string } {
    const normalized = path.replace(/\\/g, "/");
    if (normalized.split("/").includes("..") || !supportedExtensions.has(extension(normalized))) {
      throw new Error("Only repository-relative supported source paths are allowed.");
    }
    const candidatePath = resolve(this.root, normalized);
    if (!isWithinRoot(this.root, candidatePath)) throw new Error("Source file is outside the configured project root.");
    const fullPath = realpathSync(candidatePath);
    if (!isWithinRoot(this.root, fullPath) || !statSync(fullPath).isFile()) throw new Error("Source file is outside the configured project root.");
    const lines = readFileSync(fullPath, "utf8").split(/\r?\n/);
    const start = Math.min(Math.max(startLine, 1), Math.max(lines.length, 1));
    const selected = lines.slice(start - 1, start - 1 + maxLines);
    return { path: normalized, startLine: start, endLine: start + selected.length - 1, content: selected.join("\n") };
  }

  private files(): string[] { return walk(this.root); }
  private relativePath(file: string): string { return relative(this.root, file).split(sep).join("/"); }
}

function walk(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (ignoredDirectories.has(entry.name)) continue;
    const fullPath = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(fullPath));
    else if (entry.isFile() && statSync(fullPath).size <= maximumFileBytes && supportedExtensions.has(extension(entry.name))) files.push(fullPath);
  }
  return files;
}

function normalizedQuery(query: string): string {
  const normalized = query.trim().toLowerCase();
  if (normalized.length < 2 || normalized.length > 100) throw new Error("Queries must contain between 2 and 100 characters.");
  return normalized;
}

function isTestFile(path: string): boolean { return /(?:^|\/)(?:test|tests|spec|__tests__)(?:\/|$)|\.(?:test|spec)\.[^.]+$/i.test(path); }
function extension(path: string): string { const index = path.lastIndexOf("."); return index < 0 ? "" : path.slice(index).toLowerCase(); }
function isWithinRoot(root: string, path: string): boolean { return path === root || path.startsWith(root + sep); }
