import { execFile, spawn } from "child_process";
import { CommitEntry, Branch, DiffResult, DiffFile, DiffHunk, DiffLine } from "./types";

const TIMEOUT = 30_000;

function run(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile("git", args, { cwd, timeout: TIMEOUT, maxBuffer: 50 * 1024 * 1024 },
      (err, stdout) => {
        if (err) reject(err);
        else resolve(stdout);
      }
    );
    // Suppress stderr noise for valid cases like empty repos
    child.stderr?.on("data", () => {});
  });
}

export function runAsync(args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd, timeout: TIMEOUT, maxBuffer: 50 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) reject(new Error(stderr || err.message));
        else resolve({ stdout, stderr });
      }
    );
  });
}

export async function gitLogAll(repoPath: string, skip = 0, take = 200): Promise<CommitEntry[]> {
  try {
    const output = await run(
      ["log", "--all", `--skip=${skip}`, `-n${take}`, "--format=%H|%P|%an|%ae|%aI|%s|%D", "--topo-order"],
      repoPath
    );
    return parseLogOutput(output);
  } catch {
    return [];
  }
}

export async function gitCommitCount(repoPath: string): Promise<number> {
  try {
    const output = await run(["rev-list", "--count", "--all"], repoPath);
    return parseInt(output.trim(), 10) || 0;
  } catch {
    return 0;
  }
}

export async function gitLogBranch(
  repoPath: string,
  branch: string,
  skip: number,
  take: number
): Promise<CommitEntry[]> {
  const output = await run(
    ["log", branch, `--skip=${skip}`, `-n${take}`, "--format=%H|%P|%an|%ae|%aI|%s|%D", "--topo-order"],
    repoPath
  );
  return parseLogOutput(output);
}

function parseLogOutput(output: string): CommitEntry[] {
  if (!output.trim()) return [];
  const lines = output.trim().split("\n");
  return lines.map((line) => {
    const parts = line.split("|");
    const hash = parts[0] ?? "";
    const parentStr = parts[1] ?? "";
    const authorName = parts[2] ?? "Unknown";
    const authorEmail = parts[3] ?? "";
    const authorDate = parts[4] ?? "";
    const message = parts[5] ?? "";
    const refStr = parts[6] ?? "";

    const parentHashes = parentStr.trim() ? parentStr.trim().split(" ") : [];
    const isMerge = parentHashes.length > 1;

    // Parse refs: %D outputs like "HEAD -> main, origin/main, tag: v1.0"
    const refs: string[] = [];
    if (refStr.trim()) {
      refStr.split(",").forEach((ref) => {
        const trimmed = ref.trim();
        // Extract the actual branch/tag name
        const name = trimmed.replace(/^(HEAD\s*->\s*|tag:\s*)/, "").trim();
        if (name && !name.startsWith("origin/")) {
          refs.push(name);
        }
      });
    }

    return {
      hash,
      shortHash: hash.substring(0, 7),
      parentHashes,
      authorName,
      authorEmail,
      authorDate: new Date(authorDate),
      message,
      messageBody: "",
      refs,
      isMerge,
    };
  });
}

export async function gitShow(
  repoPath: string,
  hash: string
): Promise<{ commit: CommitEntry; diff: string }> {
  const output = await run(
    ["show", "--format=%H|%P|%an|%ae|%aI|%s%n%B", "-p", "-m", "--first-parent", hash],
    repoPath
  );
  return parseGitShow(output);
}

function parseGitShow(output: string): { commit: CommitEntry; diff: string } {
  const lines = output.split("\n");
  const sepIndex = lines.findIndex((l) => l.startsWith("diff --git"));

  const headerLines = sepIndex === -1 ? lines : lines.slice(0, sepIndex);
  const diffLines = sepIndex === -1 ? [] : lines.slice(sepIndex);

  const firstLine = headerLines[0] ?? "";
  const parts = firstLine.split("|");
  const hash = parts[0] ?? "";
  const parentStr = parts[1] ?? "";
  const authorName = parts[2] ?? "Unknown";
  const authorEmail = parts[3] ?? "";
  const authorDate = parts[4] ?? "";
  const subject = parts[5] ?? "";

  // Extract message body (everything after the subject, before diff)
  const bodyStart = 1;
  const messageBody = headerLines.slice(bodyStart).join("\n").trim();

  return {
    commit: {
      hash,
      shortHash: hash.substring(0, 7),
      parentHashes: parentStr.trim() ? parentStr.trim().split(" ") : [],
      authorName,
      authorEmail,
      authorDate: new Date(authorDate),
      message: subject,
      messageBody,
      refs: [],
      isMerge: false,
    },
    diff: diffLines.join("\n"),
  };
}

export function parseDiff(diffText: string): DiffResult {
  if (!diffText.trim()) return { files: [] };

  const files: DiffFile[] = [];
  const fileSections = diffText.split(/^(?=diff --git )/m).filter(Boolean);

  for (const section of fileSections) {
    const lines = section.split("\n");
    const headerLine = lines[0] ?? "";
    const pathMatch = headerLine.match(/diff --git a\/(.+) b\/(.+)/);

    if (!pathMatch) continue;

    const oldPath = pathMatch[1] === "/dev/null" ? undefined : pathMatch[1];
    const newPath = pathMatch[2] === "/dev/null" ? undefined : pathMatch[2];
    const path = newPath ?? oldPath ?? "";

    let status: DiffFile["status"] = "modified";
    if (!oldPath) status = "added";
    else if (!newPath) status = "deleted";
    else if (oldPath !== newPath) status = "renamed";

    const hunks: DiffHunk[] = [];
    let currentHunk: DiffHunk | null = null;

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith("@@")) {
        if (currentHunk) hunks.push(currentHunk);
        currentHunk = { header: line, lines: [] };
      } else if (currentHunk) {
        if (line.startsWith("+")) {
          currentHunk.lines.push({ type: "addition", content: line.substring(1) });
        } else if (line.startsWith("-")) {
          currentHunk.lines.push({ type: "deletion", content: line.substring(1) });
        } else {
          currentHunk.lines.push({ type: "context", content: line.substring(1) });
        }
      }
    }
    if (currentHunk) hunks.push(currentHunk);

    files.push({ path, oldPath, status, hunks });
  }

  return { files };
}

export async function gitBranches(repoPath: string): Promise<Branch[]> {
  try {
    const output = await run(
      ["branch", "-a", "--format=%(refname:short)|%(objectname:short)"],
      repoPath
    );
    return output
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [name, hash] = line.split("|");
        return { name: (name ?? "").replace(/^remotes\/origin\//, ""), hash: hash ?? "" };
      })
      .filter((b) => b.name && !b.name.includes("HEAD"));
  } catch {
    return [];
  }
}
