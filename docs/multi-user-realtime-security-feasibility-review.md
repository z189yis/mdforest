# 多用户实时编辑施工方案 — 安全性与可行性审查

> 审查对象: `docs/multi-user-realtime-construction-plan.md`
> 审查日期: 2026-05-21
> 审查结论: **基本可行，存在 7 个必须修复的安全问题 + 6 个需补救的可行性缺陷**

---

## 一、安全问题（按严重程度排序）

### 🔴 S1. WebSocket token 通过 URL 查询参数传递（Task 1.2）

**问题**: 方案使用 `ws://localhost:3001?token=<session-token>` 传递认证 token。

```
风险:
- URL 被浏览器历史记录明文存储
- 代理/网关日志会记录完整 URL（含 token）
- Referrer 头可能泄露 token
- WebSocket 协议本身无 Same-Origin 限制，任何页面都可发起连接
```

**修复方案**:

```typescript
// 方案 A: 先通过 HTTP 获取短期 ticket
// GET /api/ws-ticket → { ticket: "xxx", expires: 30s }
// 然后: ws://host:3001?ticket=xxx
// ticket 仅 30 秒有效，用完即焚

// 方案 B: 利用 cookie（同源自动携带）
// 客户端连接: ws://host:3001 （cookie 自动通过 Upgrade 请求发送）
// 服务端从 cookie 提取 session token
```

**推荐方案 A**。Cookie 方案要求 WS 和 Web 同域且 SameSite 不阻止。

### 🔴 S2. Session token 验证可能未命中数据库（Task 1.2）

**问题**: NextAuth session token 默认存储在数据库中。WebSocket 服务独立进程需要直接查数据库或调用 tRPC 验证。

```
风险:
- 如果只验证 JWT 签名而不查数据库，已撤销的 session（logout）仍可连接 WS
- 如果通过 tRPC 查数据库验证，每次都产生 HTTP 往返延迟
```

**修复方案**:

```typescript
// WS 服务启动时建立 Prisma 连接（或通过 tRPC client 调用）
async function authenticateWs(req: IncomingMessage): Promise<User | null> {
  const ticket = new URL(req.url!, `http://${req.headers.host}`).searchParams.get('ticket');
  if (!ticket) return null;
  // 通过 tRPC 调用验证 ticket（同进程调用，无网络开销）
  const session = await trpcServer.auth.validateTicket({ ticket });
  return session?.user ?? null;
}
```

**推荐**: WS 服务内嵌 tRPC caller（同进程内存调用），避免网络往返。

### 🟡 S3. 邀请链接缺少安全设计（Task 4.4）

**问题**: 方案只提了"一次性邀请链接"，缺少具体的安全约束。

```
缺失:
- Token 生成算法（crypto.randomUUID？JWT？）
- 过期策略（任务设了 expiresInHours 但没有强制默认值）
- 速率限制（防止暴力枚举邀请链接）
- Token 长度（推荐 ≥ 128 bit 熵）
```

**修复**:

```typescript
// Token 格式: base64url(crypto.randomBytes(32))
// 默认过期: 48 小时
// 速率限制: /api/collaboration/join 每 IP 每分钟 5 次
// 验证逻辑:
async function joinByInviteLink(token: string, userId: string) {
  const invite = await db.inviteToken.findUnique({ where: { token } });
  if (!invite) throw new Error('无效邀请链接');
  if (invite.usedBy) throw new Error('邀请已使用');
  if (invite.expiresAt < new Date()) throw new Error('邀请已过期');
  // 原子标记使用
  await db.inviteToken.update({
    where: { token, usedBy: null },
    data: { usedBy: userId }
  });
}
```

### 🟡 S4. WebSocket 消息无大小限制

**问题**: 方案没有限制 Yjs update 消息大小。恶意客户端可发送超大 update 导致内存耗尽。

**修复**:

```typescript
// 在 ws/index.ts 的 message handler 中
const MAX_UPDATE_SIZE = 5 * 1024 * 1024; // 5MB

ws.on('message', (data) => {
  if (Buffer.byteLength(data) > MAX_UPDATE_SIZE) {
    ws.close(4009, 'Update too large');
    return;
  }
  // ... 正常处理
});
```

### 🟡 S5. awareness 状态可能泄露用户信息

**问题**: Yjs awareness 向 room 内所有用户广播本地状态。如果不加过滤，可能泄露内部信息。

**修复**: awareness 只包含必要的公开字段：

```typescript
awareness.setLocalState({
  user: {
    name: userName,        // ✓ 公开
    color: userColor,      // ✓ 公开
    avatar: avatarUrl,     // ✓ 公开（仅 URL）
  },
  cursor: { ... },          // ✓ 编辑位置
  viewport: { ... },        // ✓ 浏览位置
  // ✗ 不要放: userId, email, sessionToken, internalRole
});
```

### 🟢 S6. DocumentUpdate 表无限制增长（附录 B）

**问题**: 每次 Yjs edit 都写入一条 `DocumentUpdate`。100 用户 × 每天 1000 次编辑 = 100,000 条/天。无清理策略。

**修复**:

```typescript
// Snapshot 之后清理旧 update
async function takeSnapshot(docId: string) {
  const snapshot = Y.encodeStateAsUpdate(ydoc);
  const version = await incrementVersion(docId);
  await db.documentUpdate.deleteMany({
    where: { documentId: docId, version: { lt: version } }
  });
  await db.document.update({
    where: { id: docId },
    data: { lastSnapshot: Buffer.from(snapshot).toString('base64'), snapshotVersion: version }
  });
}

// 定期清理（每天凌晨）
// DELETE FROM DocumentUpdate WHERE createdAt < now() - INTERVAL '7 days'
```

### 🟢 S7. 缺少 TLS 强制策略

**问题**: 生产环境 WebSocket 必须走 `wss://`，否则连接可被中间人拦截。

**修复**: Nginx 配置增加 redirect：

```nginx
server {
    listen 80;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    # ... /ws location 配置
}
```

---

## 二、可行性缺陷（按影响程度排序）

### 🔴 F1. WebSocket 服务被移除协作者后无法实时断开（Task 4.3）

**问题**: 方案要求"被移除协作者的用户连接断开"。但 WebSocket 服务如何知道数据库中的权限变更？当前设计没有任何通知机制。

```
场景:
1. Owner 通过 tRPC API 移除协作者（写入 PostgreSQL）
2. WS 服务不知道这个变更
3. 被移除的用户继续编辑文档
```

**修复方案**:

```typescript
// 方案 A: PostgreSQL NOTIFY（推荐，最轻量）
// 在 removeCollaborator 中:
await db.$executeRaw`NOTIFY perm_change, '${docId}:${userId}'`;

// 在 WS 服务中:
const pgClient = new Client(...);
pgClient.on('notification', (msg) => {
  const [docId, userId] = msg.payload!.split(':');
  roomManager.evictUser(docId, userId);  // 断开指定用户的 WS
});

// 方案 B: WS 服务暴露内部 HTTP 端点
// tRPC mutation 调用 POST http://ws:3001/internal/evict
// 仅接受 localhost 请求（或共享 secret）
```

**推荐方案 A**。PostgreSQL NOTIFY 零额外依赖，延迟 < 50ms。

### 🔴 F2. WS 服务崩溃时内存数据丢失（Task 1.6）

**问题**: Y.Doc 存于 WS 进程内存。崩溃意味着从上次 snapshot 到崩溃之间的所有编辑丢失。

```
场景:
1. Snapshot 在 T=0 写入
2. 用户编辑产生 50 次 update（存于 update log）
3. WS 服务在 T=15s 崩溃
4. 重启后从 snapshot(T=0) 恢复到 Y.Doc
5. 50 次 update 可重放 → 数据恢复（前提是 update log 持久化成功）

问题: 第 2 步的 update 是否在崩溃前写入 PostgreSQL？
```

**修复**: Snapshot + update log 都用同步写入：

```typescript
// 方案: Write-Ahead Log (WAL) 模式
async function onUpdate(docId: string, update: Uint8Array) {
  // 1. 先持久化 update（在内存更新之前）
  await db.documentUpdate.create({
    data: { documentId: docId, version: getNextVersion(), data: Buffer.from(update) }
  });
  // 2. 再更新内存 Y.Doc
  Y.applyUpdate(ydoc, update);
}
```

**关键**：update 必须在 Y.Doc 更新前持久化，确保崩溃后可从 update log 恢复。这会增加延迟，但对数据安全性至关重要。

### 🟡 F3. Phase 4 放在 Phase 2 之后（执行顺序问题）

**问题**: 权限系统（Phase 4）在实时编辑（Phase 1）和协作增强（Phase 2）之后实现。这意味着：
- Phase 1-2 上线时没有权限控制
- 任何有 token 的用户可以连接任意 room

**建议**: 将权限检查前置。

```
调整后顺序:
Phase 0 → Phase 1(核心编辑) → Phase 4(权限) → Phase 2(增强) → Phase 3(Canvas)
```

至少把 Task 4.1（权限模型）+ Task 4.3（WS 鉴权）提升到 Phase 1 之后。否则 Phase 1 交付的是一个"任何登录用户都能编辑任何文档"的系统。

### 🟡 F4. Canvas 渲染与 Y.Map observe 的性能耦合（Task 3.1）

**问题**: `yLeafs.observe` 回调在 Yjs update 到达时触发，但 Canvas 渲染需要在 `requestAnimationFrame` 中执行。如果 update 频率高于 60fps，可能导致积压或丢帧。

**修复**:

```typescript
// 使用 throttle + dirty flag 模式
let leafsDirty = false;
const pendingLeafUpdates: Map<string, any> = new Map();

yLeafs.observe((event) => {
  for (const [key, change] of event.changes.keys) {
    pendingLeafUpdates.set(key, yLeafs.get(key));
  }
  leafsDirty = true;  // 标志，不直接触发渲染
});

// 在 requestAnimationFrame 中消费
function renderLoop() {
  if (leafsDirty) {
    // 批量应用所有待处理的更新
    applyUpdatesToLocalState(pendingLeafUpdates);
    pendingLeafUpdates.clear();
    leafsDirty = false;
  }
  drawFrame(...);
  requestAnimationFrame(renderLoop);
}
```

### 🟡 F5. 多 WS 实例下 room 路由不明确（附录）

**问题**: 方案提到"单体 WebSocket 进程可横向扩展（room 路由）"，但未解释机制。

```
场景: 两个 WS 实例(ws-a, ws-b)
- 用户 A 连接到 ws-a，编辑文档 X
- 用户 B 连接到 ws-b，编辑文档 X
- ws-a 和 ws-b 各自拥有文档 X 的不同 Y.Doc 副本
- 编辑冲突，数据不一致
```

**修复**:

```typescript
// 方案 A: Sticky room routing（推荐）
// Nginx 按 room 参数做 sticky
upstream ws_backend {
    hash $arg_room consistent;
    server ws1:3001;
    server ws2:3001;
}

// 方案 B: Redis pubsub 跨实例同步（引入新依赖，不推荐）
// 方案 C: PostgreSQL NOTIFY 跨实例同步（可用但延迟高）
```

**推荐方案 A**。Sticky routing 确保同一 room 的所有用户连接到同一 WS 实例。配合健康检查（实例挂掉后 room 迁移到其他实例重新加载 snapshot）。

### 🟢 F6. 离线编辑缺少 y-indexeddb provider（Phase 6.3）

**问题**: 方案提到离线编辑但方案中没有 `y-indexeddb` provider。没有本地持久化，离线时 CRDT 数据在内存中，刷新页面即丢失。

**修复**:

```typescript
// useYjsProvider.ts
import { IndexeddbPersistence } from 'y-indexeddb';

const indexeddbProvider = new IndexeddbPersistence(docId, ydoc);

// 离线时: Yjs 写入 IndexedDB
// 在线时: y-websocket 连接服务器
// 重连时: 自动 merge 离线期间的修改
```

在 Task 1.4 中加入 IndexedDB。

---

## 三、架构级缺陷

### A. 缺少 Git 操作与实时编辑的冲突处理

**问题**: mdforest 的核心是 "文档绑定到 Git commit"。多个用户实时编辑文档期间，如果有人触发 git pull/commit，文档状态可能不一致。

```
场景:
1. 用户 A 和 B 在实时编辑文档 X（绑定于 commit abc123）
2. 管理员触发 git pull → repo 更新
3. commit abc123 被 rebase/移除
4. 文档 X 的绑定失效

这个场景方案未涉及。
```

**建议**: 在 Phase 1 中添加约束：
- Git 操作（clone/pull）期间，相关文档进入只读模式
- 或：Git 操作不锁定编辑，但如果 commit 被移除，文档自动变为孤立状态（已有孤立叶子机制）

### B. 缺少数据库连接池管理

**问题**: WS 服务需要直连 PostgreSQL。与 Next.js 的 Prisma 实例共享连接池还是独立连接池？方案未说明。

**建议**: WS 服务使用独立的 Prisma 实例（或更轻量的 `pg` 客户端），连接池大小 ≤ 5（因为主要是短查询：验证 token、加载 snapshot）。

### C. 缺少服务发现

**问题**: `docker-compose.prod.yml` 中 WS 服务地址硬编码为 `ws:3001`。如果 WS 服务独立扩缩容，需要服务发现。

**建议**: 单实例部署时硬编码即可（docker-compose 的 DNS 自动解析服务名）。多实例时用 `hash $arg_room consistent` 的 Nginx upstream。

---

## 四、修复优先级汇总

| 优先级 | 编号 | 问题 | 修复所在 Phase | 修复工作量 |
|---|---|---|---|---|
| P0 | S1 | WS token 通过 URL 传递 | Phase 0 | 2h |
| P0 | S2 | Session 验证可能不查库 | Phase 1 | 1h |
| P0 | F1 | 移除协作者无法实时断开 | Phase 4 | 3h |
| P0 | F2 | WS 崩溃数据丢失 | Phase 1 | 2h |
| P1 | S3 | 邀请链接缺少安全设计 | Phase 4 | 2h |
| P1 | S4 | WS 消息无大小限制 | Phase 0 | 0.5h |
| P1 | F3 | 权限应在编辑后立即实现 | 调度调整 | 0h（仅排序） |
| P1 | F4 | Canvas + Y.Map 性能耦合 | Phase 3 | 1h |
| P2 | S5 | awareness 信息泄露 | Phase 2 | 0.5h |
| P2 | S6 | DocumentUpdate 无限增长 | Phase 1 | 1h |
| P2 | S7 | 缺少 TLS 强制 | Phase 5 | 0.5h |
| P2 | F5 | 多实例 room 路由 | Phase 5 | 2h |
| P2 | F6 | 缺少 y-indexeddb | Phase 1 | 0.5h |

---

## 五、调整后的 Phase 顺序

```
Phase 0: 基础设施 (不变，增加 S1 修复)
    ├── S1 修复: WS ticket 模式
    └── S4 修复: update 大小限制

Phase 1: 实时编辑核心 (不变，增加 F2 + F6 修复)
    ├── F2 修复: Write-Ahead Log 持久化
    └── F6 修复: y-indexeddb 集成

Phase 1.5: 权限与安全 (原 Phase 4，前置)
    ├── Task 4.1: 权限模型
    ├── Task 4.3: WS 鉴权增强 (+ F1 修复: PostgreSQL NOTIFY)
    └── Task 4.2: tRPC 权限中间件

Phase 2: 协作增强 (不变，增加 S5 修复)
    ├── S5 修复: awareness 字段最小化
    └── Task 4.4: 邀请管理 (+ S3 修复)

Phase 3: Canvas 协作 (不变，增加 F4 修复)
    └── F4 修复: dirty flag + rAF 批量应用

Phase 5: 部署与离线 (不变，增加 S7 + F5 修复)
    ├── S7 修复: TLS 强制
    ├── F5 修复: Nginx sticky routing
    └── S6 修复: update log 定期清理

Phase 6: 测试与打磨 (不变)
```

---

## 六、总体评估

### 可行性: ✅ 可行

方案选型正确（Yjs + WebSocket 是最轻量的实时编辑方案）。核心技术路线无致命缺陷。

### 安全性: ⚠️ 需修复后可行

7 个安全问题中 4 个为 P0/P1，必须在对应 Phase 上线前修复。修复工作量总计约 12 小时，不显著影响工期。

### 工期影响: +2 天

安全修复 + DB 调度调整，总工期从 ~5 周变为 ~5.5 周。

### 建议

1. **立即修复**: S1 (WS token)、S4 (消息大小限制) — 这两项必须在上线前完成
2. **Phase 顺序调整**: 将权限（原 Phase 4）提升到编辑增强（原 Phase 2）之前
3. **Phase 1 必须包含**: F2 (WAL 持久化)、F6 (y-indexeddb) — 数据安全不能等
4. **生产部署前必须**: S7 (TLS)、F5 (sticky routing)、S6 (update log 清理)
