import { spawn } from "child_process";
import path from "path";
import fs from "fs";

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data", "repos");

export function getRepoPath(repoId: string): string {
  return path.join(DATA_DIR, repoId);
}

export async function cloneRepo(
  repoId: string,
  remoteUrl: string,
  onProgress: (status: string, error?: string) => Promise<void>
): Promise<void> {
  const localPath = getRepoPath(repoId);

  // Clean up stale directory if it exists from a previous failed clone
  if (fs.existsSync(localPath)) {
    fs.rmSync(localPath, { recursive: true, force: true });
  }

  // Ensure parent directory exists (e.g. data/repos/)
  const parentDir = path.dirname(localPath);
  fs.mkdirSync(parentDir, { recursive: true });

  try {
    await onProgress("cloning");

    // git clone creates the target directory — must NOT exist beforehand
    await execGit(["clone", "--no-tags", remoteUrl, localPath]);

    // Fetch all branches
    await execGit(["fetch", "--all"], localPath);

    await onProgress("ready");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown clone error";
    console.error(`[clone] Failed for repo ${repoId}: ${message}`);
    await onProgress("error", message);
  }
}

function execGit(args: string[], cwd?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 300_000, // 5 minutes
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",  // Disable password prompts that would hang forever
        GCM_INTERACTIVE: "Never",   // Disable Git Credential Manager interactive mode
      },
    });

    let stderr = "";

    child.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr || `git exited with code ${code}`));
    });

    child.on("error", (err) => {
      reject(new Error(`Failed to spawn git: ${err.message}`));
    });
  });
}

export async function deleteRepoDir(repoId: string): Promise<void> {
  const localPath = getRepoPath(repoId);
  if (fs.existsSync(localPath)) {
    fs.rmSync(localPath, { recursive: true, force: true });
  }
}
