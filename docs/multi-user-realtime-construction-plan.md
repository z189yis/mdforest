# 多用户实时编辑 — 详细施工计划

> 基于 `docs/multi-user-realtime-analysis.md` 的架构决策
> 目标：轻量、响应迅速、自托管

---

## 0. 总体概览

### 工期估算

| Phase | 内容 | 工期 | 依赖 |
|---|---|---|---|
| Phase 0 | 基础设施准备 | 2 天 | — |
| Phase 1 | 实时编辑核心 | 5 天 | Phase 0 |
| Phase 2 | 协作增强 | 5 天 | Phase 1 |
| Phase 3 | Canvas 协作 | 3 天 | Phase 2 |
| Phase 4 | 权限与安全 | 3 天 | Phase 1 |
| Phase 5 | 部署与离线 | 4 天 | Phase 2-4 |
| Phase 6 | 测试与打磨 | 3 天 | Phase 5 |
| **总计** | | **~5 周** | |

### 关键路径

```
Phase 0 → Phase 1 → Phase 2 → Phase 3
                  ↘ Phase 4 ↗    ↘ Phase 5 → Phase 6
```

Phase 1 和 Phase 4 可部分并行（权限模型独立于编辑同步）。

### 核心原则

1. **每个 Phase 可独立测试、独立发布** — 不积累未验证代码
2. **向后兼容** — 单用户模式不因多用户改造而退化
3. **feature flag 控制** — 协作功能默认关闭，按 Repo 粒度开启
4. **无重型依赖** — 不引入 Redis、Kafka、K8s

---

## Phase 0: 基础设施准备（2 天）

> 目标：搭建 WebSocket 运行时，建立开发→测试闭环

### Task 0.1: 项目依赖安装

**文件**: `package.json`

```bash
npm install yjs y-websocket y-codemirror y-protocols lib0 ws
npm install -D @types/ws
```

**验收**: `npm run dev` 无报错

### Task 0.2: WebSocket 服务骨架

**新建文件**:
- `src/server/ws/index.ts` — WebSocket 服务入口
- `src/server/ws/room-manager.ts` — Room 管理（Y.Doc 缓存 + LRU）
- `src/server/ws/persistence.ts` — Snapshot 读写

**接口定义**:

```typescript
// src/server/ws/room-manager.ts
interface RoomManager {
  getDoc(docId: string): Promise<Y.Doc>;  // 从内存或 DB 获取
  closeRoom(docId: string): void;          // 持久化并释放
  getStats(): { rooms: number; docs: number; memoryMB: number };
}

// src/server/ws/persistence.ts
interface Persistence {
  loadSnapshot(docId: string): Promise<Uint8Array | null>;
  saveSnapshot(docId: string, update: Uint8Array, version: number): Promise<void>;
  saveUpdate(docId: string, update: Uint8Array): Promise<void>;
  getUpdatesSince(docId: string, version: number): Promise<Uint8Array[]>;
}
```

**验收**:
- `npx tsx src/server/ws/index.ts` 启动 WebSocket 服务，无崩溃
- 两个浏览器 tab 连接同一 room，Y.Doc 状态同步
- 重启服务后 Y.Doc 从 snapshot 恢复

### Task 0.3: 本地开发环境

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

```bash
npm install -D concurrently
```

**验收**: `npm run dev` 同时启动 Next.js + WebSocket

### Task 0.4: 测试工具链

**新建文件**:
- `src/server/ws/__tests__/room-manager.test.ts`
- `src/server/ws/__tests__/integration.test.ts`

**测试场景**:
```
1. 单用户连接 → 编辑 → 断开 → 重连 → 内容恢复
2. 双用户同时编辑 → 内容一致
3. LRU 淘汰 → 重新加载 → 数据完整
4. Snapshot 增量恢复 → 内容正确
```

**验收**: `npm test` 通过全部 4 个场景

---

## Phase 1: 实时编辑核心（5 天）

> 目标：文档编辑从"手动保存"变为"实时同步"，多用户可同时编辑同一文档

### Task 1.1: 数据库迁移

**文件**: `prisma/schema.prisma`

新增模型：

```prisma
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

model RepoCollaborator {
  id     String @id @default(cuid())
  repoId String
  userId String
  role   String @default("editor")

  repo Repo @relation(fields: [repoId], references: [id], onDelete: Cascade)
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([repoId, userId])
}
```

Document 表增加字段：

```diff
model Document {
+  isPublic        Boolean   @default(false)
+  lastSnapshot    String?
+  snapshotVersion Int       @default(0)
}
```

**操作**: `npx prisma migrate dev --name add_collaboration`

**验收**: `prisma/schema.prisma` + 迁移文件就绪，`npx prisma generate` 成功

### Task 1.2: WebSocket 认证中间件

**新建文件**: `src/server/ws/auth.ts`

WebSocket 连接时验证 token：

```typescript
// 客户端连接 URL: ws://localhost:3001?token=<nextauth-session-token>
// 服务端验证 session token → 提取 userId
async function authenticateWs(
  req: http.IncomingMessage
): Promise<{ userId: string; userName: string } | null>
```

**修改文件**: `src/server/ws/index.ts` — 在 upgrade 时调用认证

**验收**:
- 无效 token 连接被拒绝（4001）
- 有效 token 连接成功，userId 关联到 Yjs awareness

### Task 1.3: y-codemirror 集成

**修改文件**: `src/components/editor/MarkdownEditor.tsx`

核心变更：

```typescript
// 旧：本地 EditorState
const state = EditorState.create({ doc: value, extensions: [...] });

// 新：Yjs 驱动的 EditorState
import { yCollab } from 'y-codemirror';
const yText = ydoc.getText('content');
const state = EditorState.create({
  doc: yText.toString(),
  extensions: [yCollab(yText, awareness), markdown(), ...],
});
```

**新增逻辑**:
- `ydoc` 和 `awareness` 从 context/hook 传入（不在此组件内创建）
- 去掉 `onChange` prop（自动同步）
- 去掉外部 `value` → EditorView 的手动同步（第 43-56 行）

**验收**:
- 两个 tab 打开同一文档，在 tab A 输入，tab B 实时可见
- 远程光标在 tab B 中可见（彩色标记 + 用户名）

### Task 1.4: Yjs Provider Hook

**新建文件**: `src/lib/hooks/useYjsProvider.ts`

```typescript
// 管理 Y.Doc + WebSocket 连接的生命周期
export function useYjsProvider(docId: string | null) {
  // 返回 { ydoc, awareness, isConnected, isSynced }
}
```

**职责**:
1. 创建 `Y.Doc` 实例
2. 建立 `WebsocketProvider` 连接到 ws server
3. 监听 `synced` 事件（首次同步完成）
4. 监听连接状态变化
5. docId 变化时切换 room
6. 组件卸载时断开连接

**验收**:
- 打开文档 → `isSynced` 变 true → 编辑器可用
- 切换文档 → 自动切换 room
- 关闭页面 → WebSocket 断开

### Task 1.5: 文档页面改造

**修改文件**: `src/app/(dashboard)/repos/[repoId]/page.tsx`

变更点：
1. 打开文档时创建 `YjsProvider`（包裹 `MarkdownEditor`）
2. 移除 `saveDoc` mutation（不再需要手动保存）
3. 移除 Save 按钮 UI
4. 添加连接状态指示器（绿色圆点 = 已连接）
5. 添加在线协作者头像列表

**新增组件**: `src/components/editor/CollaborativeEditor.tsx`
- 包装 MarkdownEditor + YjsProvider
- 显示连接状态、协作者光标颜色

**验收**:
- 打开文档 → 自动连接 WebSocket → 显示已连接
- 编辑内容 → 自动同步，无 Save 按钮
- 关闭文档 → 断开连接

### Task 1.6: Snapshot 自动持久化

**修改文件**: `src/server/ws/persistence.ts`

```typescript
// 每 30 秒或每 100 次 update 后存一次 snapshot
class AutoSnapshotPersistence implements Persistence {
  private updateCount = 0;
  private lastSnapshot = Date.now();

  async onUpdate(docId: string, update: Uint8Array) {
    await this.saveUpdate(docId, update);
    this.updateCount++;
    if (this.updateCount > 100 || Date.now() - this.lastSnapshot > 30_000) {
      await this.takeSnapshot(docId);
      this.updateCount = 0;
      this.lastSnapshot = Date.now();
    }
  }
}
```

**验收**:
- 编辑 100 次后触发 snapshot
- 30 秒无编辑后触发 snapshot
- 重启服务 → 从 snapshot 恢复 → 内容正确

---

## Phase 2: 协作增强（5 天）

> 目标：用户可感知协作状态（谁在线、在看哪、做了什么）

### Task 2.1: Awareness 用户列表

**新建文件**: `src/components/collaboration/AvatarList.tsx`

显示当前文档的在线用户：
- 头像（GitHub avatar 或首字母）
- 每种光标颜色分配给一个用户
- 自己显示在最前

**修改文件**: `src/components/editor/CollaborativeEditor.tsx` — 集成 AvatarList

**验收**:
- 第二个用户打开文档 → AvataList 新增一个头像
- 用户关闭页面 → 头像消失（5 秒超时清理）

### Task 2.2: 远程光标渲染

**修改文件**: `src/components/editor/MarkdownEditor.tsx`

y-codemirror 自带光标功能，只需配置 awareness 颜色：

```typescript
// 为用户分配固定颜色
const USER_COLORS = ['#f97316', '#6366f1', '#22c55e', '#ec4899', ...];
awareness.setLocalStateField('user', {
  name: userName,
  color: USER_COLORS[hash(userId) % USER_COLORS.length],
  colorLight: USER_COLORS_LIGHT[...],
});
```

**验收**:
- 两个用户同时编辑 → 看到对方的彩色光标
- 光标旁显示用户名 tooltip

### Task 2.3: 在线状态指示器

**修改文件**: `src/components/editor/CollaborativeEditor.tsx`

状态机：

```
disconnected → connecting → syncing → connected
     ↑            ↑                       |
     └────────────┴───────(重连)──────────┘
```

UI 表现：
- 🟢 绿色脉冲 = connected
- 🟡 黄色 = connecting/syncing
- 🔴 红色 = disconnected
- tooltip 显示延迟 ms 和在线人数

**验收**: 断开 WebSocket → 红色指示 → 自动重连 → 绿色

### Task 2.4: 文档列表协作标识

**修改文件**:
- `src/components/repo/RepoCard.tsx` 或新建列表组件
- `src/server/api/routers/document.router.ts` — `list` 查询返回在线人数

在文档列表中每条显示：
- 在线人数角标
- 最后编辑者 + 时间

**验收**: 有用户编辑时，文档列表实时显示"N 人在线"

### Task 2.5: 冲突提示 toast

**新建文件**: `src/components/collaboration/ConflictToast.tsx`

场景处理：

| 场景 | 行为 |
|---|---|
| 他人正在编辑你打开的文档 | toast "xxx 正在编辑" |
| 他人保存了你正在编辑的文档 | 自动合并（Yjs CRDT 无冲突） |
| 你离线期间的编辑 | 重连后自动合并 |

**验收**:
- 用户 B 打开用户 A 正在编辑的文档 → toast 提示
- 并发编辑 → 无冲突、内容一致

---

## Phase 3: Canvas 协作（3 天）

> 目标：画布上的叶子拖动、创建、绑定实时广播

### Task 3.1: 叶子状态迁移到 Y.Map

**修改文件**: `src/components/git-tree/GitTreeCanvas.tsx`

当前叶子位置存储在：
- `docLeaves` prop → React state
- `dirtyLeafPositionsRef` → 拖拽临时状态

改造为 Yjs 驱动：

```typescript
// 在 Y.Doc 中
const yLeafs = ydoc.getMap<{ x: number; y: number; connectedHashes: string[] }>('leafs');

// 读取
const positions = new Map();
yLeafs.forEach((val, key) => positions.set(key, val));

// 写入（拖拽松手时）
yLeafs.set(leafId, { x: newX, y: newY, connectedHashes: currentHashes });

// 监听远程变更
yLeafs.observe((event) => {
  // 更新 Canvas 渲染
});
```

**新增 hook**: `src/lib/hooks/useCollaborativeLeaves.ts`

```typescript
export function useCollaborativeLeaves(ydoc: Y.Doc | null) {
  // 返回 { positions, updateLeaf, remoteLeafs }
  // 本地拖拽直接写入 Y.Map，远程变更自动反映
}
```

**验收**:
- 用户 A 拖动叶子 → 用户 B 画布上叶子实时移动
- 不破坏现有的叶子选中、展开、hover 逻辑

### Task 3.2: 叶子拖动广播

**修改文件**: `src/components/git-tree/GitTreeCanvas.tsx`

拖拽逻辑调整：
- 拖拽过程中：本地实时更新（不广播，保证流畅）
- 松手时：写入 `Y.Map`（广播给其他用户）

```typescript
// handleCanvasMouseUp 中
if (draggingLeafRef.current) {
  yLeafs.set(leafId, { x: newX, y: newY, ... });
}
```

**验收**:
- 拖拽过程中自己看到实时移动
- 松手后其他用户看到最终位置
- 多人同时拖拽不同叶子 → 不冲突

### Task 3.3: 孤立叶子创建广播

**修改文件**: `src/app/(dashboard)/repos/[repoId]/page.tsx`

当前：`createIsolated` mutation → 更新 React state → 刷新 docLeaves
改造：创建文档后 → 写入 Y.Map → 自动广播

**验收**:
- 用户 A 拖入 .md 文件创建孤立叶子
- 用户 B 画布上自动出现新叶子

### Task 3.4: Viewport Awareness

**修改文件**: `src/components/git-tree/GitTreeCanvas.tsx`

通过 Yjs awareness 共享 viewport 状态：

```typescript
awareness.setLocalStateField('viewport', {
  x: transform.offsetX,
  y: transform.offsetY,
  zoom: transform.zoom,
});
```

**新增组件**: `src/components/collaboration/ViewportIndicator.tsx`

在画布边缘显示小色块，表示其他用户正在看哪里。

**验收**:
- 用户 B 在画布边缘看到用户 A 的 viewport 指示器
- 点击指示器 → 跳转到对应用户的视角

---

## Phase 4: 权限与安全（3 天）

> 目标：细粒度权限控制，协作 ≠ 全开放

### Task 4.1: Repo/Document 权限模型

**新建文件**: `src/server/auth/permissions.ts`

```typescript
type Permission = 'read' | 'write' | 'admin';

// Repo 级权限
async function canAccessRepo(userId: string, repoId: string): Promise<Permission>

// Document 级权限
async function canAccessDocument(userId: string, docId: string): Promise<Permission>

// WebSocket room 准入
async function canJoinRoom(userId: string, docId: string): Promise<boolean>
```

权限优先级：
1. 用户是 Repo owner → admin
2. 用户在 RepoCollaborator 中 → 按 role
3. 用户在 DocumentCollaborator 中 → 按 role
4. Document.isPublic → read（仅已登录用户）
5. 其他 → 拒绝

**验收**:
- Owner 可编辑所有文档
- Collaborator(editor) 可编辑文档
- Collaborator(viewer) 只读
- 非协作者无法通过 WebSocket 连接

### Task 4.2: tRPC 权限中间件

**修改文件**: `src/server/api/trpc.ts`

新增 protected procedure 变体：

```typescript
// 现有：只验证登录
const protectedProcedure = t.procedure.use(isAuthenticated);

// 新增：验证 repo 访问权限
const repoProcedure = protectedProcedure.use(requireRepoAccess);

// 新增：验证 document 写权限
const docWriteProcedure = protectedProcedure.use(requireDocWrite);
```

**修改文件**: 所有 router — 使用对应的 procedure

**验收**:
- 非协作者调用 `document.update` → 403
- 非协作者查询 `document.get`（isPublic=true）→ 200
- 现有单用户功能不受影响

### Task 4.3: WebSocket 鉴权增强

**修改文件**: `src/server/ws/auth.ts` + `src/server/ws/index.ts`

连接时检查 room 准入：

```typescript
// WebSocket 连接到 room/doc-{docId} 时
// 1. 验证 token → userId
// 2. 查询 DocumentCollaborator / RepoCollaborator
// 3. 检查权限
// 4. 通过 → 加入 room；拒绝 → 断开
```

**验收**:
- 有权限的用户可连接
- 无权限的用户被拒绝（4003）
- 被移除协作者的用户连接断开

### Task 4.4: 邀请与协作者管理

**新建文件**: `src/server/api/routers/collaboration.router.ts`

```typescript
export const collaborationRouter = router({
  listRepoCollaborators: repoProcedure.query(...),
  addRepoCollaborator: repoProcedure.mutation(...),
  removeRepoCollaborator: repoProcedure.mutation(...),

  listDocCollaborators: docWriteProcedure.query(...),
  addDocCollaborator: docWriteProcedure.mutation(...),
  removeDocCollaborator: docWriteProcedure.mutation(...),

  generateInviteLink: repoProcedure.mutation(...),  // 生成一次性邀请链接
  joinByInviteLink: protectedProcedure.mutation(...),
});
```

**新增组件**: `src/components/collaboration/CollaboratorManager.tsx`
- 协作者列表（头像 + 角色 + 移除按钮）
- 邀请按钮（复制链接）

**验收**:
- 生成邀请链接 → 另一个用户点击 → 自动加入为 editor
- 移除协作者 → 该用户实时失去编辑权限
- 链接过期/已使用 → 无法重复加入

---

## Phase 5: 部署与离线（4 天）

> 目标：可部署到生产环境，支持离线基础能力

### Task 5.1: Docker Compose 生产配置

**新建文件**: `docker-compose.prod.yml`

```yaml
services:
  app:        # Next.js (tRPC API)
  ws:         # WebSocket 服务
  db:         # PostgreSQL
  nginx:      # 反向代理（/api/trpc → app, /ws → ws）
```

**新建文件**: `Dockerfile.ws` — WebSocket 服务独立镜像

**验收**: `docker compose -f docker-compose.prod.yml up` → 完整服务栈运行

### Task 5.2: Nginx 反向代理

**新建文件**: `nginx.conf`

```
# API 请求
location /api/trpc {
    proxy_pass http://app:3000;
}

# WebSocket 升级
location /ws {
    proxy_pass http://ws:3001;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}
```

**验收**:
- `https://domain.com/api/trpc/...` → tRPC 正常
- `wss://domain.com/ws` → WebSocket 连接成功

### Task 5.3: PWA 基础

**新建文件**:
- `public/manifest.json`
- `public/sw.js`（Service Worker）

**修改文件**: `src/app/layout.tsx` — 添加 manifest link + meta tags

```html
<link rel="manifest" href="/manifest.json" />
<meta name="theme-color" content="#09090b" />
```

**验收**:
- Chrome DevTools → Application → Manifest 可查看
- "安装" 按钮可用 → 桌面快捷方式
- Service Worker 注册成功

### Task 5.4: 健康检查与监控

**修改文件**: `src/server/ws/index.ts`

```typescript
// HTTP 健康检查端点（同端口）
server.on('request', (req, res) => {
  if (req.url === '/health') {
    const stats = roomManager.getStats();
    res.writeHead(200).end(JSON.stringify(stats));
  }
});
```

**新增脚本**: `scripts/healthcheck.sh`

**验收**: `curl http://localhost:3001/health` → `{"rooms":3,"docs":5,"memoryMB":42}`

### Task 5.5: 环境变量文档化

**修改文件**: `.env.example`

添加：

```bash
# WebSocket
WS_PORT=3001
WS_HOST=0.0.0.0

# Collaboration
COLLAB_ENABLED=false           # feature flag
SNAPSHOT_INTERVAL_MS=30000     # snapshot 间隔
DOC_LRU_MAX=100                # 内存中最多缓存的文档数
```

**验收**: 新开发者 `cp .env.example .env` + `npm run dev` 即可启动完整服务

---

## Phase 6: 测试与打磨（3 天）

> 目标：覆盖边界情况、性能达标、UX 打磨

### Task 6.1: 端到端测试

**新建文件**: `tests/e2e/collaboration.spec.ts`

使用 Playwright（两个 browser context 模拟两个用户）：

```
1. 用户 A 创建文档，用户 B 打开 → 内容同步
2. 用户 A 编辑，用户 B 实时看到
3. 用户 A 拖动叶子，用户 B 看到移动
4. 用户 B 断开网络 → 编辑 → 重连 → 合并
5. 用户 A 关闭文档，用户 B 继续编辑 → 无影响
6. 100 次快速编辑 → 最终状态一致
```

**验收**: 全部 6 个场景通过

### Task 6.2: 性能基准测试

**新建文件**: `tests/perf/ws-latency.test.ts`

测试：
- 单次 edit update 延迟 < 50ms（本地 loopback）
- 100 并发连接内存 < 500MB
- LRU 淘汰 + 重加载延迟 < 200ms
- 1000 节点 Canvas + 协作渲染 60fps

**验收**: 全部指标达标

### Task 6.3: 离线→在线恢复

场景测试：
1. 断开 WebSocket → 继续编辑（本地 CRDT）
2. 重新连接 → update log 增量合并
3. 验证内容与服务器一致

**验收**: Chrome DevTools → Network → Offline → 编辑 → Online → 内容一致

### Task 6.4: UX 打磨

| 项目 | 说明 | 文件 |
|---|---|---|
| 连接状态动画 | 脉冲指示器 | `CollaborativeEditor.tsx` |
| 过渡动画 | 远程光标出现/消失 fade | `MarkdownEditor.tsx` |
| 声音提示 | 新用户加入可选提示音 | `useYjsProvider.ts` |
| 快捷键 | `Ctrl+Shift+C` 复制邀请链接 | `page.tsx` |
| 空状态 | 无协作者时的引导 UI | `CollaboratorManager.tsx` |

**验收**: 整体体验流畅，无明显 UI 跳动

---

## 附录 A: 文件变更总览

### 新建文件（~15 个）

```
src/server/ws/index.ts                    # WebSocket 服务入口
src/server/ws/room-manager.ts             # Room + Y.Doc 管理
src/server/ws/persistence.ts              # Snapshot/UpdateLog 持久化
src/server/ws/auth.ts                     # WS 连接认证
src/server/ws/__tests__/room-manager.test.ts
src/server/ws/__tests__/integration.test.ts
src/server/api/routers/collaboration.router.ts  # 协作者管理 API
src/server/auth/permissions.ts            # 权限检查
src/lib/hooks/useYjsProvider.ts           # Yjs + WebSocket hook
src/lib/hooks/useCollaborativeLeaves.ts   # 协作叶子 hook
src/components/editor/CollaborativeEditor.tsx  # 协作编辑器包装
src/components/collaboration/AvatarList.tsx
src/components/collaboration/ConflictToast.tsx
src/components/collaboration/ViewportIndicator.tsx
src/components/collaboration/CollaboratorManager.tsx
public/manifest.json                      # PWA
public/sw.js                              # Service Worker
Dockerfile.ws                             # WS 服务镜像
nginx.conf                                # 反向代理
docker-compose.prod.yml                   # 生产部署
tests/e2e/collaboration.spec.ts
tests/perf/ws-latency.test.ts
docs/multi-user-realtime-analysis.md      # 已有
docs/multi-user-realtime-construction-plan.md  # 本文档
```

### 修改文件（~15 个）

```
prisma/schema.prisma                      # +DocumentCollaborator, +RepoCollaborator, Document 字段
src/server/api/trpc.ts                    # 权限中间件
src/server/api/routers/document.router.ts # 权限检查
src/server/api/routers/repo.router.ts     # 权限检查
src/server/api/routers/git.router.ts      # docLeaves 适配协作
src/server/api/routers/root.ts            # 注册 collaborationRouter
src/components/editor/MarkdownEditor.tsx  # y-codemirror 集成
src/components/git-tree/GitTreeCanvas.tsx # 协作叶子、viewport awareness
src/app/(dashboard)/repos/[repoId]/page.tsx # 协作编辑器、移除保存按钮
src/app/layout.tsx                        # PWA meta
src/lib/trpc/client.ts                    # 可能无需改动
package.json                              # 新依赖、scripts
.env.example                              # 新环境变量
```

---

## 附录 B: API 契约

### WebSocket 协议

```
连接:      ws://host/ws?token={sessionToken}&room=doc-{docId}
协议:      y-websocket 协议 (Yjs binary encoding)
心跳:      30s ping/pong
重连:      指数退避 1s → 2s → 4s → 8s → max 30s
```

### tRPC 新增端点

```
collaboration.listRepoCollaborators   { repoId }
  → { id, userId, userName, avatar, role, joinedAt }[]

collaboration.addRepoCollaborator     { repoId, email, role }
  → { collaborator }

collaboration.removeRepoCollaborator  { repoId, userId }
  → { success }

collaboration.listDocCollaborators    { docId }
  → { id, userId, userName, avatar, role, joinedAt }[]

collaboration.generateInviteLink      { repoId, role?, expiresInHours? }
  → { link }

collaboration.joinByInviteLink        { token }
  → { repoId, role }
```

### Snapshot 表（直接用 Document 表扩展）

```
Document.lastSnapshot     → base64 编码的 Y.Doc snapshot (Uint8Array)
Document.snapshotVersion  → 递增整数，用于增量恢复
```

Update log 表（新建）：

```prisma
model DocumentUpdate {
  id         String   @id @default(cuid())
  documentId String
  version    Int
  data       Bytes                     // Yjs binary update
  createdAt  DateTime  @default(now())

  @@index([documentId, version])
}
```

---

## 附录 C: 回滚策略

每个 Phase 独立发布，支持快速回滚：

| Phase | 回滚方式 | 影响 |
|---|---|---|
| Phase 0 | 删除 ws 相关文件，还原 package.json | 无用户影响 |
| Phase 1 | 关闭 WebSocket，还原 MarkdownEditor | 文档回到手动保存模式 |
| Phase 2-3 | 关闭 COLLAB_ENABLED flag | 回到单用户模式 |
| Phase 4 | 权限回退到 ownerId 检查 | 协作者暂时无法访问 |
| Phase 5 | 回退 Docker 镜像 tag | — |
| Phase 6 | N/A（只涉及测试） | — |

关键原则：**Phase 1 之后的每个 Phase 都可以通过 `COLLAB_ENABLED=false` 环境变量完全禁用协作功能，回到单用户模式。**

---

## 附录 D: 依赖关系图

```
package.json (yjs, ws, y-codemirror, y-protocols, concurrently)
    │
    ├── Phase 0 ────────────────────────────────────────
    │   ├── 0.1 依赖安装 ──┬── 0.2 WS 骨架 ── 0.3 开发环境
    │   │                  └── 0.4 测试工具链
    │   │
    │   ▼
    ├── Phase 1 ────────────────────────────────────────
    │   ├── 1.1 DB 迁移 ────── 无依赖
    │   ├── 1.2 WS 认证 ────── 依赖 0.2
    │   ├── 1.3 y-cm 集成 ──── 依赖 0.1, 1.2
    │   ├── 1.4 Provider Hook ─ 依赖 1.3
    │   ├── 1.5 页面改造 ───── 依赖 1.4
    │   └── 1.6 Snapshot ───── 依赖 1.1, 0.2
    │   │
    │   ├──────────────┐
    │   ▼              ▼
    ├── Phase 2 ────── Phase 4 ─────────────────────────
    │   ├── 2.1 Avatar   │  4.1 权限模型
    │   ├── 2.2 光标     │  4.2 tRPC 中间件
    │   ├── 2.3 状态     │  4.3 WS 鉴权
    │   ├── 2.4 列表     │  4.4 邀请管理
    │   └── 2.5 冲突     │
    │   │              │
    │   ▼              │
    ├── Phase 3 ────────┤
    │   ├── 3.1 Y.Map   │
    │   ├── 3.2 拖动    │
    │   ├── 3.3 创建    │
    │   └── 3.4 Viewport│
    │   │              │
    │   ├──────────────┘
    │   ▼
    ├── Phase 5 ────────────────────────────────────────
    │   ├── 5.1 Docker Compose
    │   ├── 5.2 Nginx
    │   ├── 5.3 PWA
    │   ├── 5.4 健康检查
    │   └── 5.5 环境变量
    │   │
    │   ▼
    └── Phase 6 ────────────────────────────────────────
        ├── 6.1 E2E 测试
        ├── 6.2 性能测试
        ├── 6.3 离线恢复
        └── 6.4 UX 打磨
```
