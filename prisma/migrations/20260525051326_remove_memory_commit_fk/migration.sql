-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_MemoryEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "summary" TEXT,
    "confidence" REAL NOT NULL DEFAULT 1.0,
    "source" TEXT NOT NULL DEFAULT 'agent',
    "provenance" TEXT,
    "embedding" TEXT,
    "repoId" TEXT NOT NULL,
    "commitHash" TEXT,
    "documentId" TEXT,
    "userId" TEXT NOT NULL,
    "accessCount" INTEGER NOT NULL DEFAULT 0,
    "lastAccessedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MemoryEntry_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "Repo" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MemoryEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MemoryEntry_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_MemoryEntry" ("accessCount", "commitHash", "confidence", "content", "createdAt", "documentId", "embedding", "id", "lastAccessedAt", "provenance", "repoId", "source", "summary", "type", "updatedAt", "userId") SELECT "accessCount", "commitHash", "confidence", "content", "createdAt", "documentId", "embedding", "id", "lastAccessedAt", "provenance", "repoId", "source", "summary", "type", "updatedAt", "userId" FROM "MemoryEntry";
DROP TABLE "MemoryEntry";
ALTER TABLE "new_MemoryEntry" RENAME TO "MemoryEntry";
CREATE INDEX "MemoryEntry_repoId_commitHash_idx" ON "MemoryEntry"("repoId", "commitHash");
CREATE INDEX "MemoryEntry_userId_type_idx" ON "MemoryEntry"("userId", "type");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
