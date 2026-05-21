# 多用户实时编辑 — 最终施工计划

> 基于 `docs/multi-user-realtime-analysis.md` 架构决策
> 已整合 `docs/multi-user-realtime-security-feasibility-review.md` 全部修复
> 目标：轻量、响应迅速、自托管、安全

---

## 0. 总体概览

### 工期估算（修正后）

| Phase | 内容 | 工期 | 依赖 |
|---|---|---|---|
| Phase 0 | 基础设施准备 | 3 天 | — |
| Phase 1 | 实时编辑核心 | 6 天 | Phase 0 |
| Phase 2 | 权限与安全 | 3 天 | Phase 1 |
| Phase 3 | 协作增强 | 4 天 | Phase 2 |
| Phase 4 | Canvas 协作 | 3 天 | Phase 2 |
| Phase 5 | 部署与离线 | 4 天 | Phase 3, 4 |
| Phase 6 | 测试与打磨 | 3 天 | Phase 5 |
| **总计** | | **~5 周** | |

### 关键路径（修正后）

```
Phase 0 → Phase 1 → Phase 2 → Phase 3 → Phase 5 → Phase 6
                              ↘ Phase 4 ↗
```

Phase 3 和 Phase 4 可在 Phase 2 完成后并行。

### 核心原则

1. **每个 Phase 可独立测试、独立发布**
2. **向后兼容** — 单用户模式不因多用户改造而退化
3. **`COLLAB_ENABLED` feature flag** — 协作功能默认关闭，按 Repo 粒度开启
4. **无重型依赖** — 不引入 Redis、Kafka、K8s
5. **安全先行** — token 不通过 URL 传递，权限在协作增强之前上线
6. **数据不丢失** — Write-Ahead Log 确保崩溃恢复

---

## Phase 0: 基础设施准备（3 天）

> 目标：搭建安全 WebSocket 运行时，建立开发→测试闭环

### Task 0.1: 项目依赖安装

**文件**: `package.json`

```bash
npm install yjs y-websocket y-codemirror y-protocols y-indexeddb lib0 ws
npm install -D @types/ws concurrently
```

**验收**: `npm run dev` 无报错

### Task 0.2: WebSocket 服务骨架

**新建文件**:
- `src/server/ws/index.ts` — WebSocket 服务入口
- `src/server/ws/room-manager.ts` — Room 管理（Y.Doc 缓存 + LRU 淘汰）
- `src/server/ws/persistence.ts` — Snapshot/UpdateLog 持久化（含 WAL）
- `src/server/ws/auth.ts` — ticket 认证

**接口定义**:

```typescript
// src/server/ws/room-manager.ts
interface RoomManager {
  getDoc(docId: string): Promise<Y.Doc>;  // 从内存/DB 加载
  closeRoom(docId: string): void;          // 持久化并释放内存
  evictUser(docId: string, userId: string): void;  // 强制踢出用户
  getStats(): { rooms: number; docs: number; memoryMB: number };
}

// src/server/ws/persistence.ts
interface Persistence {
  loadSnapshot(docId: string): Promise<Uint8Array | null>;
  saveSnapshot(docId: string, snapshot: Uint8Array, version: number): Promise<void>;
  saveUpdate(docId: string, update: Uint8Array, version: number): Promise<void>;
  getUpdatesSince(docId: string, version: number): Promise<Uint8Array[]>;
  deleteUpdatesBefore(docId: string, version: number): Promise<void>;
  getNextVersion(docId: string): Promise<number>;
}
```

**验收**:
- `npx tsx src/server/ws/index.ts` 启动，无崩溃
- 两个浏览器 tab 连接同一 room，Y.Doc 状态同步
- 重启服务后从 snapshot + update log 恢复，内容正确

### Task 0.3: 安全基础设施

**新建文件**: `src/server/ws/ticket.ts`

```typescript
// 短期 ticket（30s 有效）替代 URL 传 token
interface TicketManager {
  issue(userId: string, userName: string): string;   // 生成 ticket
  validate(ticket: string): { userId: string; userName: string } | null;
}

// 实现: crypto.randomBytes(32) → base64url → 内存 Map 30s TTL
```

**tRPC 端点**（新增到 `git.router.ts` 或独立的 `ws.router.ts`）：

```typescript
wsTicket: protectedProcedure.query(async ({ ctx }) => {
  return ticketManager.issue(ctx.user.id, ctx.user.name ?? 'Unknown');
});
```

**消息大小限制**（在 `ws/index.ts` 的 message handler 中）：

```typescript
const MAX_UPDATE_SIZE = 5 * 1024 * 1024; // 5MB
ws.on('message', (data) => {
  if (Buffer.byteLength(data as ArrayBuffer) > MAX_UPDATE_SIZE) {
    ws.close(4009, 'Update too large');
    return;
  }
  // ...
});
```

**客户端连接流程**：
```
1. GET /api/trpc/wsTicket → { ticket: "abc...", expiresIn: 30 }
2. new WebSocket("ws://host:3001?ticket=abc...")
3. 服务端验证 ticket（内存查找，< 1ms）
4. ticket 用后即焚（防止重放）
```

**验收**:
- 无效 ticket 连接被拒绝（4001）
- 过期 ticket（>30s）被拒绝
- 同一 ticket 重放被拒绝
- 消息 >5MB 被断开（4009）

### Task 0.4: 本地开发环境

**修改文件**: `package.json`

```json
{
  "scripts": {
    "dev": "concurrently \"next dev\" \"tsx src/server/ws/index.ts\"",
    "dev:next": "next dev",
    "dev:ws": "tsx src/server/ws/index.ts"
  }
}
```

**验收**: `npm run dev` 同时启动 Next.js (3000) + WebSocket (3001)

### Task 0.5: 测试工具链

**新建文件**:
- `src/server/ws/__tests__/room-manager.test.ts`
- `src/server/ws/__tests__/persistence.test.ts`
- `src/server/ws/__tests__/ticket.test.ts`

**测试场景**:
```
1. 单用户：连接 → 编辑 → 断开 → 重连 → 内容恢复
2. 双用户：同时编辑 → CRDT 自动合并 → 内容一致
3. LRU 淘汰：不活跃文档 → 持久化释放 → 重新加载
4. Snapshot 恢复：重启 → snapshot + update log → 数据完整
5. Ticket: 无效/过期/重放 → 拒绝
6. 消息限制：>5MB → 4009 断开
```

**验收**: `npm test` 通过全部 6 个场景

---

## Phase 1: 实时编辑核心（6 天）

> 目标：文档编辑从"手动保存"变为"实时同步"，不丢数据

### Task 1.1: 数据库迁移

**文件**: `prisma/schema.prisma`

新增模型：

```prisma
model RepoCollaborator {
  id     String @id @default(cuid())
  repoId String
  userId String
  role   String @default("editor")  // admin | editor | viewer
  joinedAt DateTime @default(now())

  repo Repo @relation(fields: [repoId], references: [id], onDelete: Cascade)
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([repoId, userId])
}

model DocumentCollaborator {
  id         String   @id @default(cuid())
  documentId String
  userId     String
  role       String   @default("editor")  // editor | viewer
  joinedAt   DateTime @default(now())

  document Document @relation(fields: [documentId], references: [id], onDelete: Cascade)
  user     User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([documentId, userId])
  @@index([userId])
}

model InviteToken {
  id        String    @id @default(cuid())
  repoId    String
  token     String    @unique
  role      String    @default("editor")
  usedBy    String?
  expiresAt DateTime
  createdAt DateTime  @default(now())
}

model DocumentUpdate {
  id         String   @id @default(cuid())
  documentId String
  version    Int
  data       Bytes                       // Yjs binary update (WAL)
  createdAt  DateTime  @default(now())

  @@index([documentId, version])
}
```

Document 表增加字段：

```diff
model Document {
+  isPublic        Boolean   @default(false)
+  lastSnapshot    Bytes?                  // Yjs 二进制 snapshot（非 base64）
+  snapshotVersion Int       @default(0)
}
```

**操作**: `npx prisma migrate dev --name add_collaboration`

**验收**: 迁移成功，`npx prisma generate` 通过

### Task 1.2: WS 认证 + 持久化实现

**修改文件**: `src/server/ws/auth.ts`

```typescript
// 验证 ticket（内存 Map 查找，< 1ms）
async function authenticateWs(req: http.IncomingMessage): Promise<{ userId: string; userName: string } | null> {
  const url = new URL(req.url!, `http://${req.headers.host}`);
  const ticket = url.searchParams.get('ticket');
  if (!ticket) return null;
  return ticketManager.validate(ticket);  // 验证 + 销毁
}
```

**修改文件**: `src/server/ws/persistence.ts` — 实现 WAL 持久化

```typescript
// Write-Ahead Log: update 先持久化，再更新内存
async function applyUpdate(docId: string, ydoc: Y.Doc, update: Uint8Array) {
  const version = await getNextVersion(docId);
  // 1. 先写 WAL（持久化）
  await prisma.documentUpdate.create({
    data: { documentId: docId, version, data: Buffer.from(update) }
  });
  // 2. 再更新内存 Y.Doc
  Y.applyUpdate(ydoc, update);
}

// Snapshot 后清理旧 update log
async function takeSnapshot(docId: string, ydoc: Y.Doc) {
  const snapshot = Y.encodeStateAsUpdate(ydoc);
  const version = await incrementSnapshotVersion(docId);
  await prisma.document.update({
    where: { id: docId },
    data: { lastSnapshot: Buffer.from(snapshot), snapshotVersion: version }
  });
  await prisma.documentUpdate.deleteMany({
    where: { documentId: docId, version: { lt: version } }
  });
}
```

**验收**:
- 编辑 → update log 写入 → 崩溃重启 → 从 snapshot + update log 成功恢复
- Snapshot 触发后旧 update 被清理
- WAL 顺序正确（先持久化后更新内存）

### Task 1.3: y-codemirror 集成

**修改文件**: `src/components/editor/MarkdownEditor.tsx`

```typescript
// 移除: 本地 EditorState、onChange prop、外部 value 同步
// 新增: Yjs 驱动 + IndexedDB 离线支持
import { yCollab } from 'y-codemirror';

const yText = ydoc.getText('content');
const state = EditorState.create({
  doc: yText.toString(),
  extensions: [
    yCollab(yText, awareness),   // 实时同步 + 远程光标
    markdown(),
    basicSetup,
  ],
});
```

**验收**:
- 两个 tab 打开同一文档，实时可见编辑
- 远程光标（彩色 + 用户名）可见

### Task 1.4: Yjs Provider Hook

**新建文件**: `src/lib/hooks/useYjsProvider.ts`

```typescript
export function useYjsProvider(docId: string | null) {
  // 1. 创建 Y.Doc 实例
  // 2. 建立 WebsocketProvider 连接（使用 ticket）
  // 3. 建立 IndexeddbPersistence（离线支持）
  // 4. 监听 synced → isSynced = true
  // 5. 监听 connection status
  // 6. docId 变化 → 切换 room
  // 7. 卸载 → 断开所有 provider + 销毁 Y.Doc

  return { ydoc, awareness, isConnected, isSynced };
}
```

**关键**：每个 docId 一个 Y.Doc + IndexedDB + WebSocket provider 三元组。

**验收**:
- 打开文档 → `isSynced` = true → 编辑器可用
- 离线编辑 → 刷新页面 → 内容保留（IndexedDB）
- 恢复在线 → 自动 merge
- 切换文档 → 自动切换 room

### Task 1.5: 文档页面改造

**修改文件**: `src/app/(dashboard)/repos/[repoId]/page.tsx`

变更点：
1. 打开文档 → `useYjsProvider(docId)` → 包装编辑器
2. 移除 `saveDoc` mutation + Save 按钮
3. 添加连接状态指示器（绿 = connected, 黄 = syncing, 红 = disconnected）
4. 添加在线协作者头像列表（从 awareness 读取）

**新增组件**: `src/components/editor/CollaborativeEditor.tsx`

**验收**:
- 无 Save 按钮，编辑自动同步
- 连接状态指示器状态正确
- 关闭文档 → 断开连接

### Task 1.6: WAL 自动持久化

**修改文件**: `src/server/ws/persistence.ts`

```typescript
// 每 30s 或 100 次 update 触发 snapshot
class AutoSnapshotPersistence {
  private updateCount = 0;
  private lastSnapshot = Date.now();

  async onUpdate(docId: string, ydoc: Y.Doc, update: Uint8Array) {
    await this.applyUpdateWithWAL(docId, ydoc, update);  // Task 1.2 实现
    this.updateCount++;
    if (this.updateCount > 100 || Date.now() - this.lastSnapshot > 30_000) {
      await this.takeSnapshot(docId, ydoc);
      this.updateCount = 0;
      this.lastSnapshot = Date.now();
    }
  }

  // 定期清理（每天凌晨）
  async dailyCleanup() {
    const cutoff = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    await prisma.documentUpdate.deleteMany({
      where: { createdAt: { lt: cutoff } }
    });
  }
}
```

**验收**:
- 100 次编辑 → snapshot 触发 → 旧 update 清理
- 30s 无编辑 → snapshot 触发
- 崩溃 → 冷启动 → 从 snapshot + 少量残留 update 恢复
- 7 天前 update 被定期清理

---

## Phase 2: 权限与安全（3 天）

> 目标：所有实时操作有权限管控，无授权用户无法连接

**为何 Phase 2 就做权限**：Phase 1 交付的实时编辑没有权限控制 = 任何登录用户可编辑任何文档。权限绝不能在协作增强之后才上线。

### Task 2.1: 权限模型

**新建文件**: `src/server/auth/permissions.ts`

```typescript
type Permission = 'read' | 'write' | 'admin';

// 权限优先级（从高到低）:
// 1. Repo owner → admin
// 2. RepoCollaborator → 按 role
// 3. DocumentCollaborator → 按 role
// 4. Document.isPublic → read（仅已登录用户）
// 5. 拒绝

async function canAccessRepo(userId: string, repoId: string): Promise<Permission>
async function canAccessDocument(userId: string, docId: string): Promise<Permission>
async function canJoinRoom(userId: string, docId: string): Promise<boolean>
```

**验收**: 权限优先级正确，覆盖所有访问路径

### Task 2.2: tRPC 权限中间件

**修改文件**: `src/server/api/trpc.ts`

```typescript
// 现有
const protectedProcedure = t.procedure.use(isAuthenticated);

// 新增
const repoReadProcedure = protectedProcedure.use(requireRepoRead);    // 至少 read
const repoWriteProcedure = protectedProcedure.use(requireRepoWrite);  // 至少 write
const docReadProcedure = protectedProcedure.use(requireDocRead);
const docWriteProcedure = protectedProcedure.use(requireDocWrite);
```

**修改文件**: 所有 router — 路由到对应 procedure

| Router | 端点 | 所需权限 |
|---|---|---|
| repo.router | get, list | repoReadProcedure |
| repo.router | create, update, delete | repoWriteProcedure |
| document.router | get, list | docReadProcedure |
| document.router | create, update, delete | docWriteProcedure |
| git.router | tree, branches, commitDetail | repoReadProcedure |
| git.router | docLeaves | repoReadProcedure |

**验收**:
- 非协作者调用 `document.update` → 403
- 非协作者查询 `document.get`（isPublic=true）→ 200
- 现有单用户功能不受影响（owner 自动拥有所有权限）

### Task 2.3: WebSocket 鉴权 + 实时踢出

**修改文件**: `src/server/ws/auth.ts` + `src/server/ws/index.ts`

连接时检查权限 + 监听数据库变更：

```typescript
// 连接时
async function onConnection(ws: WebSocket, docId: string, userId: string) {
  if (!await canJoinRoom(userId, docId)) {
    ws.close(4003, 'Forbidden');
    return;
  }
  // 加入 room
  roomManager.join(docId, ws, userId);
}

// 监听权限变更（PostgreSQL NOTIFY）
// 在 collaboration.router 的 removeCollaborator 中:
await db.$executeRaw`NOTIFY perm_change, '${docId}:${userId}'`;

// 在 WS 服务启动时:
pgClient.on('notification', (msg) => {
  const [docId, userId] = msg.payload!.split(':');
  roomManager.evictUser(docId, userId);  // 关闭该用户的 WebSocket
});
```

**验收**:
- 无权限用户连接 → 4003 断开
- Owner 移除协作者 → 被移除用户 WebSocket 断开（< 50ms 延迟）
- 协作者降级为 viewer → WS 保持但写入被拒绝

### Task 2.4: 邀请与协作者管理

**新建文件**: `src/server/api/routers/collaboration.router.ts`

```typescript
export const collaborationRouter = router({
  listRepoCollaborators: repoReadProcedure.query(...),
  addRepoCollaborator:    repoWriteProcedure.mutation(...),
  removeRepoCollaborator: repoWriteProcedure.mutation(...),
  listDocCollaborators:   docReadProcedure.query(...),
  addDocCollaborator:     docWriteProcedure.mutation(...),
  removeDocCollaborator:  docWriteProcedure.mutation(...),
  generateInviteLink:     repoWriteProcedure
    .input(z.object({ repoId: z.string(), role: z.enum(['editor','viewer']).default('editor'), expiresInHours: z.number().min(1).max(168).default(48) }))
    .mutation(async ({ ctx, input }) => {
      const token = crypto.randomBytes(32).toString('base64url');
      await db.inviteToken.create({ data: { token, repoId: input.repoId, role: input.role, expiresAt: new Date(Date.now() + input.expiresInHours * 3600_000) } });
      return { link: `${process.env.NEXTAUTH_URL}/invite/${token}` };
    }),
  joinByInviteLink: protectedProcedure
    .input(z.object({ token: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // 验证 token + 原子标记使用 + 添加协作者
    }),
});
```

**安全约束**:
- Token: `crypto.randomBytes(32).toString('base64url')` (256 bit 熵)
- 默认 48h 过期
- 一次性使用（`usedBy` 原子的 CAS 更新）
- 加入端点速率限制：每 IP 每分钟 5 次

**新增组件**: `src/components/collaboration/CollaboratorManager.tsx`

**验收**:
- 生成邀请链接 → 复制 → 另一用户打开 → 自动加入为 editor
- 移除协作者 → WebSocket 实时断开
- 过期/已用链接 → 提示无法加入

### Task 2.5: Awareness 数据安全

**修改文件**: `src/lib/hooks/useYjsProvider.ts`

```typescript
// awareness 只暴露最小必要信息
awareness.setLocalState({
  user: {
    name: ctx.user.name,          // ✓
    color: USER_COLORS[i % n],    // ✓
    avatar: ctx.user.image,       // ✓ (URL only)
  },
  // ✗ 不包括: userId, email, sessionToken, role
});
```

**验收**: 检查 awareness 广播数据 → 无敏感字段

---

## Phase 3: 协作增强（4 天）

> 目标：用户可感知协作状态（谁在线、在看哪、做了什么）

### Task 3.1: Awareness 用户列表

**新建文件**: `src/components/collaboration/AvatarList.tsx`

**验收**: 第二个用户打开文档 → 头像列表新增一个；关闭页面 → 5s 后移除

### Task 3.2: 远程光标渲染

**修改文件**: `src/components/editor/MarkdownEditor.tsx`

y-codemirror 自带，只需配置颜色。Phase 2.5 已配置 awareness。

**验收**: 两个用户同时编辑 → 看到对方的彩色光标 + 用户名 tooltip

### Task 3.3: 在线状态指示器

**修改文件**: `src/components/editor/CollaborativeEditor.tsx`

状态机：`disconnected → connecting → syncing → connected`

**验收**: 断开 WebSocket → 红色指示 → 延迟 + 自动重连 → 绿色

### Task 3.4: 文档列表协作标识

**修改文件**: `src/server/api/routers/document.router.ts`

`list` 查询增加字段：在线人数、最后编辑者。

**验收**: 列表显示"N 人在线"

### Task 3.5: 冲突提示

**新建文件**: `src/components/collaboration/ConflictToast.tsx`

**验收**: 用户 B 打开用户 A 正在编辑的文档 → toast "xxx 正在编辑"

---

## Phase 4: Canvas 协作（3 天）

> 目标：画布叶子拖动、创建、绑定实时广播

### Task 4.1: 叶子状态迁移到 Y.Map

**新建 hook**: `src/lib/hooks/useCollaborativeLeaves.ts`

```typescript
// Y.Doc 中的数据: Y.Map<{ x: number; y: number; connectedHashes: string[] }>
const yLeafs = ydoc.getMap('leafs');

// 使用 dirty flag + rAF 批量消费（避免 observe 直接触发渲染）
let leafsDirty = false;
const pendingUpdates = new Map<string, any>();

yLeafs.observe((event) => {
  for (const [key] of event.changes.keys) {
    pendingUpdates.set(key, yLeafs.get(key));
  }
  leafsDirty = true;
});

// 在 requestAnimationFrame 中批量应用
// → 不破坏现有 Canvas 渲染管线
```

**验收**: 用户 A 拖动叶子 → 用户 B 画布上叶子实时移动（rAF 内批量更新）

### Task 4.2: 叶子拖动广播

**修改文件**: `src/components/git-tree/GitTreeCanvas.tsx`

```typescript
// 拖拽中: 本地 dirtyLeafPositionsRef（不广播，保证流畅 60fps）
// 松手时: yLeafs.set(leafId, { x: newX, y: newY, connectedHashes })
```

**验收**: 拖拽中流畅；松手后广播；多人同时拖拽不同叶子不冲突

### Task 4.3: 孤立叶子创建广播

**验收**: 用户 A 拖入 .md → 用户 B 画布自动出现新叶子

### Task 4.4: Viewport Awareness

**修改文件**: `src/components/git-tree/GitTreeCanvas.tsx`

```typescript
// 200ms 节流写入 awareness
awareness.setLocalStateField('viewport', {
  x: transform.offsetX, y: transform.offsetY, zoom: transform.zoom,
});
```

**新增组件**: `src/components/collaboration/ViewportIndicator.tsx`

**验收**: 画布边缘显示其他用户的 viewport 色块；点击跳转视角

---

## Phase 5: 部署与离线（4 天）

> 目标：生产环境可部署，安全配置到位

### Task 5.1: Docker Compose + Nginx

**新建文件**:
- `docker-compose.prod.yml`
- `Dockerfile.ws`
- `nginx.conf`

```nginx
# TLS 强制
server { listen 80; return 301 https://$host$request_uri; }

server {
    listen 443 ssl;
    # ...

    # API
    location /api/trpc { proxy_pass http://app:3000; }

    # WebSocket
    location /ws {
        proxy_pass http://ws:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}

# 多实例: sticky room routing（按 room 参数 hash）
upstream ws_backend {
    hash $arg_room consistent;
    server ws1:3001;
    server ws2:3001;  # 可选
}
```

**验收**: `docker compose -f docker-compose.prod.yml up` → 全栈运行

### Task 5.2: 环境变量文档化

**修改文件**: `.env.example`

```bash
# WebSocket
WS_PORT=3001
WS_HOST=0.0.0.0

# Collaboration
COLLAB_ENABLED=false           # feature flag
SNAPSHOT_INTERVAL_MS=30000
DOC_LRU_MAX=100                # 内存最多缓存的文档数
UPDATE_MAX_SIZE=5242880        # 5MB
TICKET_TTL_MS=30000            # 30s

# TLS（生产环境）
TLS_CERT_PATH=/etc/ssl/cert.pem
TLS_KEY_PATH=/etc/ssl/key.pem
```

### Task 5.3: PWA 基础

**新建文件**: `public/manifest.json`, `public/sw.js`

**修改文件**: `src/app/layout.tsx` — manifest link + meta tags

**验收**: Chrome → Application → Manifest；可安装为桌面快捷方式

### Task 5.4: 健康检查

```typescript
// ws/index.ts
server.on('request', (req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(roomManager.getStats()));
  }
});
```

**新建文件**: `scripts/healthcheck.sh`

**验收**: `curl localhost:3001/health` → `{"rooms":3,"docs":5,"memoryMB":42}`

---

## Phase 6: 测试与打磨（3 天）

### Task 6.1: E2E 测试（Playwright，双 browser context）

```
1. 用户 A 创建文档，用户 B 打开 → 内容同步
2. 用户 A 编辑，用户 B 实时看到
3. 用户 A 拖动叶子，用户 B 看到移动
4. 用户 B 断开网络 → 编辑 → 重连 → 合并（IndexedDB 保留）
5. 用户 A 关闭文档，用户 B 继续编辑 → 无影响
6. 100 次快速编辑 → 最终状态一致（CRDT 无冲突）
7. 无权限用户连接 WS → 4003
8. 移除协作者 → WebSocket 断开
```

### Task 6.2: 性能基准

| 指标 | 目标 |
|---|---|
| 单次 edit 延迟 | < 50ms (loopback) |
| 100 并发连接内存 | < 500MB |
| LRU 淘汰 + 重加载 | < 200ms |
| Canvas + 协作渲染 | 60fps |
| ticket 验证 | < 1ms（内存 Map） |
| snapshot 写入 | < 200ms（PostgreSQL BYTEA） |

### Task 6.3: UX 打磨

| 项目 | 说明 |
|---|---|
| 连接状态动画 | 脉冲指示器 |
| 远程光标过渡 | fade in/out |
| 快捷键 | `Ctrl+Shift+C` 复制邀请链接 |
| 空状态引导 | 无协作者时引导分享 |

---

## 附录 A: 文件变更总览

### 新建文件（~22 个）

```
src/server/ws/index.ts                          # WS 服务入口
src/server/ws/room-manager.ts                   # Room + Y.Doc + LRU
src/server/ws/persistence.ts                    # WAL Snapshot/UpdateLog
src/server/ws/auth.ts                           # ticket 认证
src/server/ws/ticket.ts                         # 短期 ticket 管理
src/server/api/routers/collaboration.router.ts  # 协作者管理
src/server/api/routers/ws.router.ts             # wsTicket 端点
src/server/auth/permissions.ts                  # 权限检查
src/lib/hooks/useYjsProvider.ts                 # Yjs + WS + IndexedDB
src/lib/hooks/useCollaborativeLeaves.ts         # 协作叶子
src/components/editor/CollaborativeEditor.tsx   # 协作编辑器包装
src/components/collaboration/AvatarList.tsx
src/components/collaboration/ConflictToast.tsx
src/components/collaboration/ViewportIndicator.tsx
src/components/collaboration/CollaboratorManager.tsx
src/server/ws/__tests__/room-manager.test.ts
src/server/ws/__tests__/persistence.test.ts
src/server/ws/__tests__/ticket.test.ts
public/manifest.json | public/sw.js             # PWA
Dockerfile.ws | nginx.conf | docker-compose.prod.yml
tests/e2e/collaboration.spec.ts
tests/perf/ws-latency.test.ts
scripts/healthcheck.sh
```

### 修改文件（~14 个）

```
prisma/schema.prisma                            # +5 模型, Document +3 字段
src/server/api/trpc.ts                          # 权限中间件
src/server/api/routers/document.router.ts       # 权限 + list 在线人数
src/server/api/routers/repo.router.ts           # 权限
src/server/api/routers/git.router.ts            # docLeaves 适配协作 + wsTicket
src/server/api/routers/root.ts                  # 注册新 router
src/components/editor/MarkdownEditor.tsx        # y-codemirror + 移除手动同步
src/components/git-tree/GitTreeCanvas.tsx       # 协作叶子 + viewport awareness
src/app/(dashboard)/repos/[repoId]/page.tsx     # 协作编辑器 + 移除 Save
src/app/layout.tsx                              # PWA meta
package.json                                    # 依赖 + dev 脚本
.env.example                                    # 新环境变量
```

---

## 附录 B: 安全清单

| # | 措施 | 位置 | Phase |
|---|---|---|---|
| S1 | WS token 走 ticket（非 URL query string） | `ws/ticket.ts` | 0.3 |
| S2 | ticket 30s TTL + 一次性使用 | `ws/ticket.ts` | 0.3 |
| S3 | WS 消息大小限制 5MB | `ws/index.ts` | 0.3 |
| S4 | WAL 持久化（先写后更新） | `ws/persistence.ts` | 1.2 |
| S5 | awareness 只暴露公开字段 | `useYjsProvider.ts` | 2.5 |
| S6 | 邀请 token 256bit + CAS 一次性 | `collaboration.router.ts` | 2.4 |
| S7 | PostgreSQL NOTIFY 实时权限撤销 | `collaboration.router.ts` + `ws/index.ts` | 2.3 |
| S8 | tRPC 权限中间件逐端点控制 | `api/trpc.ts` | 2.2 |
| S9 | TLS 强制（Nginx redirect 80→443） | `nginx.conf` | 5.1 |
| S10 | update log 7 天定期清理 | `ws/persistence.ts` | 1.6 |
| S11 | 邀请加入速率限制（5/min/IP） | `collaboration.router.ts` | 2.4 |

---

## 附录 C: 回滚策略

每个 Phase 独立发布，`COLLAB_ENABLED=false` 可一键回退到单用户模式。

| Phase | 回滚方式 | 影响 |
|---|---|---|
| Phase 0 | Revert package.json + 删除 ws 目录 | 无 |
| Phase 1 | COLLAB_ENABLED=false + revert MarkdownEditor | 回到手动保存 |
| Phase 2 | COLLAB_ENABLED=false | 回到单用户 |
| Phase 3-4 | COLLAB_ENABLED=false | 回到单用户 |
| Phase 5 | 回退 Docker 镜像 tag | 前端回退 |
| Phase 6 | N/A | — |

---

## 附录 D: 依赖关系图

```
package.json (yjs, ws, y-codemirror, y-protocols, y-indexeddb, concurrently)
    │
    ├── Phase 0 ─────────────────────────────────────
    │   ├── 0.1 依赖安装 ──┬── 0.2 WS 骨架 ── 0.4 开发环境
    │   │                  ├── 0.3 安全基础设施
    │   │                  └── 0.5 测试工具链
    │   ▼
    ├── Phase 1 ─────────────────────────────────────
    │   ├── 1.1 DB 迁移 ──── 无依赖
    │   ├── 1.2 WS 认证+持久化 ── 依赖 0.2, 0.3
    │   ├── 1.3 y-cm 集成  ── 依赖 0.1
    │   ├── 1.4 Provider Hook ── 依赖 1.3
    │   ├── 1.5 页面改造   ── 依赖 1.4
    │   └── 1.6 WAL 持久化 ── 依赖 1.1, 1.2
    │   ▼
    ├── Phase 2 ─────────────────────────────────────
    │   ├── 2.1 权限模型   ── 依赖 1.1
    │   ├── 2.2 tRPC 中间件 ── 依赖 2.1
    │   ├── 2.3 WS 鉴权    ── 依赖 2.1, 1.2
    │   ├── 2.4 邀请管理   ── 依赖 2.2
    │   └── 2.5 Awareness  ── 依赖 1.4
    │   ├──────────────┐
    │   ▼              ▼
    ├── Phase 3 ─── Phase 4 ─────────────────────────
    │   (协作增强)     (Canvas 协作)
    │   │              │
    │   ├──────────────┘
    │   ▼
    ├── Phase 5 ─────────────────────────────────────
    │   ├── 5.1 Docker + Nginx
    │   ├── 5.2 环境变量
    │   ├── 5.3 PWA
    │   └── 5.4 健康检查
    │   ▼
    └── Phase 6 ─────────────────────────────────────
        ├── 6.1 E2E 测试 (8 场景)
        ├── 6.2 性能基准
        └── 6.3 UX 打磨
```
