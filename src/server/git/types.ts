export interface CommitEntry {
  hash: string;
  shortHash: string;
  parentHashes: string[];
  authorName: string;
  authorEmail: string;
  authorDate: Date;
  message: string;
  messageBody: string;
  refs: string[];
  isMerge: boolean;
}

export interface GitTreeNode {
  hash: string;
  shortHash: string;
  authorName: string;
  authorDate: Date;
  message: string;
  branches: string[];
  tags: string[];
  x: number;
  y: number;
  row: number;
  column: number;
  isMerge: boolean;
}

export interface GitTreeEdge {
  fromHash: string;
  toHash: string;
  fromRow: number;
  toRow: number;
  fromColumn: number;
  toColumn: number;
}

export interface GitTree {
  nodes: GitTreeNode[];
  edges: GitTreeEdge[];
  totalHeight: number;
  totalWidth: number;
  maxColumn: number;
}

export interface CommitFull {
  hash: string;
  shortHash: string;
  authorName: string;
  authorEmail?: string;
  authorDate: Date;
  message: string;
  messageBody?: string;
  parentHashes: string[];
  branches: string[];
  tags: string[];
  isMerge: boolean;
}

export interface DiffResult {
  files: DiffFile[];
}

export interface DiffFile {
  path: string;
  oldPath?: string;
  status: "added" | "modified" | "deleted" | "renamed";
  hunks: DiffHunk[];
}

export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

export interface DiffLine {
  type: "addition" | "deletion" | "context";
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

export interface Branch {
  name: string;
  hash: string;
}
