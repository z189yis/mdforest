-- CreateTable
CREATE TABLE "MemoryEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "summary" TEXT,
    "confidence" REAL NOT NULL DEFAULT 1.0,
    "source" TEXT NOT NULL DEFAULT 'agent',
    "provenance" TEXT,
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
    CONSTRAINT "MemoryEntry_commitHash_repoId_fkey" FOREIGN KEY ("commitHash", "repoId") REFERENCES "CommitCache" ("commitHash", "repoId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MemoryEntry_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "MemoryEntry_repoId_commitHash_idx" ON "MemoryEntry"("repoId", "commitHash");

-- CreateIndex
CREATE INDEX "MemoryEntry_userId_type_idx" ON "MemoryEntry"("userId", "type");
