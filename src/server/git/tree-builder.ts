import { CommitEntry, GitTree, GitTreeNode, GitTreeEdge } from "./types";

const ROW_HEIGHT = 48;
const COL_WIDTH = 28;
const COL_MARGIN = 8;

export function buildGitTree(entries: CommitEntry[]): GitTree {
  if (entries.length === 0) {
    return { nodes: [], edges: [], totalHeight: 0, totalWidth: 0, maxColumn: 0 };
  }

  // Assign columns using a simple branch-tracking algorithm
  const hashToIndex = new Map<string, number>();
  entries.forEach((e, i) => hashToIndex.set(e.hash, i));

  const columns = new Map<string, number>();
  const branchColors = new Map<string, number>();
  // Active branches: set of parent hashes that are still "open"
  const activeBranches: string[] = [];
  let nextColor = 0;

  // First pass: assign column indices
  // We track which "column" each commit occupies based on active branches
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];

    // Remove this commit from active branches (it's being "closed")
    const activeIdx = activeBranches.indexOf(entry.hash);
    if (activeIdx !== -1) {
      activeBranches.splice(activeIdx, 1);
    }

    // Assign column: use the first available column, or create a new one
    let col = 0;
    // If this commit has parents, place it in one of the parent's columns
    // Otherwise, find the leftmost free column
    if (columns.has(entry.hash)) {
      col = columns.get(entry.hash)!;
    } else {
      // Find a free column
      col = findFreeColumn(activeBranches, columns, entries, i);
    }

    columns.set(entry.hash, col);

    // Get color for this branch
    if (!branchColors.has(entry.hash)) {
      branchColors.set(entry.hash, nextColor++);
    }

    // Add parents as active branches
    for (const parentHash of entry.parentHashes) {
      if (!activeBranches.includes(parentHash)) {
        activeBranches.push(parentHash);
      }
      // Parent inherits the column or gets a neighboring one
      if (!columns.has(parentHash)) {
        columns.set(parentHash, col);
      }
      // Inherit color
      if (!branchColors.has(parentHash)) {
        branchColors.set(parentHash, branchColors.get(entry.hash) ?? nextColor++);
      }
    }
  }

  // Build nodes
  let maxColumn = 0;
  const nodes: GitTreeNode[] = entries.map((entry, row) => {
    const col = columns.get(entry.hash) ?? 0;
    if (col > maxColumn) maxColumn = col;

    const branches: string[] = [];
    const tags: string[] = [];
    for (const ref of entry.refs) {
      if (ref.startsWith("tag: ")) {
        tags.push(ref.replace("tag: ", ""));
      } else {
        branches.push(ref
          .replace("HEAD -> ", "")
          .replace("origin/", "")
          .trim());
      }
    }

    return {
      hash: entry.hash,
      shortHash: entry.shortHash,
      authorName: entry.authorName,
      authorDate: entry.authorDate,
      message: entry.message,
      branches: [...new Set(branches)].filter(Boolean),
      tags: [...new Set(tags)].filter(Boolean),
      x: col * (COL_WIDTH + COL_MARGIN),
      y: row * ROW_HEIGHT,
      row,
      column: col,
      isMerge: entry.isMerge,
    };
  });

  // Build edges
  const edges: GitTreeEdge[] = [];
  for (const entry of entries) {
    const fromIdx = hashToIndex.get(entry.hash);
    if (fromIdx === undefined) continue;

    for (const parentHash of entry.parentHashes) {
      const toIdx = hashToIndex.get(parentHash);
      if (toIdx === undefined) continue;

      edges.push({
        fromHash: entry.hash,
        toHash: parentHash,
        fromRow: fromIdx,
        toRow: toIdx,
        fromColumn: columns.get(entry.hash) ?? 0,
        toColumn: columns.get(parentHash) ?? 0,
      });
    }
  }

  const totalHeight = entries.length * ROW_HEIGHT;
  const totalWidth = (maxColumn + 1) * (COL_WIDTH + COL_MARGIN) + 300;

  return { nodes, edges, totalHeight, totalWidth, maxColumn };
}

function findFreeColumn(
  activeBranches: string[],
  columns: Map<string, number>,
  entries: CommitEntry[],
  currentIdx: number
): number {
  // Check upcoming entries to see which columns will be needed
  const usedCols = new Set<number>();
  for (const hash of activeBranches) {
    const col = columns.get(hash);
    if (col !== undefined) usedCols.add(col);
  }
  // Also check current entry's parents
  const entry = entries[currentIdx];
  if (entry) {
    for (const ph of entry.parentHashes) {
      const col = columns.get(ph);
      if (col !== undefined) usedCols.add(col);
    }
  }

  // If no columns used, start at 0
  if (usedCols.size === 0) return 0;

  // Find leftmost free column
  const maxUsed = Math.max(...usedCols);
  for (let c = 0; c <= maxUsed + 1; c++) {
    if (!usedCols.has(c)) return c;
  }
  return maxUsed + 1;
}

export { ROW_HEIGHT, COL_WIDTH, COL_MARGIN };
