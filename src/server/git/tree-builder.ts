import { CommitEntry, GitTree, GitTreeNode, GitTreeEdge } from "./types";

const ROW_HEIGHT = 48;
const COL_WIDTH = 28;
const COL_MARGIN = 8;

export interface TreeState {
  columns: Record<string, number>;
  branchColors: Record<string, number>;
  activeBranches: string[];
  nextColor: number;
  nextRow: number;
  maxColumn: number;
}

export function createTreeState(): TreeState {
  return { columns: {}, branchColors: {}, activeBranches: [], nextColor: 0, nextRow: 0, maxColumn: 0 };
}

export function buildGitTree(entries: CommitEntry[], prevState?: TreeState): { tree: GitTree; state: TreeState } {
  if (entries.length === 0) {
    const state = prevState ?? createTreeState();
    return {
      tree: { nodes: [], edges: [], totalHeight: 0, totalWidth: 0, maxColumn: state.maxColumn },
      state,
    };
  }

  const columns = new Map<string, number>(Object.entries(prevState?.columns ?? {}));
  const branchColors = new Map<string, number>(Object.entries(prevState?.branchColors ?? {}));
  const activeBranches: string[] = [...(prevState?.activeBranches ?? [])];
  let nextColor = prevState?.nextColor ?? 0;
  const startRow = prevState?.nextRow ?? 0;

  const hashToIndex = new Map<string, number>();
  entries.forEach((e, i) => hashToIndex.set(e.hash, startRow + i));

  // Column assignment
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;

    // Remove this commit from active branches (it's being "closed")
    const activeIdx = activeBranches.indexOf(entry.hash);
    if (activeIdx !== -1) {
      activeBranches.splice(activeIdx, 1);
    }

    // Assign column
    let col: number;
    if (columns.has(entry.hash)) {
      col = columns.get(entry.hash)!;
    } else {
      col = findFreeColumn(activeBranches, columns);
    }

    columns.set(entry.hash, col);

    // Color
    if (!branchColors.has(entry.hash)) {
      branchColors.set(entry.hash, nextColor++);
    }

    // Add parents as active branches
    for (const parentHash of entry.parentHashes) {
      if (!activeBranches.includes(parentHash)) {
        activeBranches.push(parentHash);
      }
      if (!columns.has(parentHash)) {
        columns.set(parentHash, col);
      }
      if (!branchColors.has(parentHash)) {
        branchColors.set(parentHash, branchColors.get(entry.hash) ?? nextColor++);
      }
    }
  }

  // Build nodes
  let maxColumn = prevState?.maxColumn ?? 0;
  const nodes: GitTreeNode[] = entries.map((entry, i) => {
    const col = columns.get(entry.hash) ?? 0;
    if (col > maxColumn) maxColumn = col;
    const row = startRow + i;

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

  // Build edges (only among entries in this batch)
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

  const totalHeight = (startRow + entries.length) * ROW_HEIGHT;
  const totalWidth = (maxColumn + 1) * (COL_WIDTH + COL_MARGIN) + 300;

  const state: TreeState = {
    columns: Object.fromEntries(columns),
    branchColors: Object.fromEntries(branchColors),
    activeBranches,
    nextColor,
    nextRow: startRow + entries.length,
    maxColumn,
  };

  return {
    tree: { nodes, edges, totalHeight, totalWidth, maxColumn },
    state,
  };
}

function findFreeColumn(activeBranches: string[], columns: Map<string, number>): number {
  const usedCols = new Set<number>();
  for (const hash of activeBranches) {
    const col = columns.get(hash);
    if (col !== undefined) usedCols.add(col);
  }

  if (usedCols.size === 0) return 0;

  const maxUsed = Math.max(...usedCols);
  for (let c = 0; c <= maxUsed + 1; c++) {
    if (!usedCols.has(c)) return c;
  }
  return maxUsed + 1;
}

export { ROW_HEIGHT, COL_WIDTH, COL_MARGIN };
