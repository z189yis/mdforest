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
  fs.mkdirSync(localPath, { recursive: true });

  try {
    await onProgress("cloning");

    // Full clone to get all branches and history
    await execGit(["clone", remoteUrl, localPath]);

    // Fetch all branches
    await execGit(["fetch", "--all"], localPath);

    await onProgress("ready");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown clone error";
    await onProgress("error", message);
  }
}

function execGit(args: string[], cwd?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 300_000,
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
