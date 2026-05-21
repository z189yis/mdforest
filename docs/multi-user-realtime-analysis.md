# 多用户实时编辑 — 架构分析与方案

> 2026-05-21 | 基于当前 `mdforest` 代码库现状

---

## 1. 当前架构 vs 实时多用户需求

### 现状

| 层面 | 现状 | 多用户需求 |
|---|---|---|
| 数据模型 | `Document.ownerId` 单所有者 | 共享文档、多人协作权限 |
| API 范式 | tRPC request/response | 实时双向推送 |
| 编辑器 | CodeMirror 6 本地状态 | 多人光标同步、无冲突合并 |
| 画布 | 本地 Canvas 渲染 | 多人拖拽叶子、位置同步 |
| 传输层 | HTTP | WebSocket（必需） |
| 数据库 | SQLite/PostgreSQL | 可保留，但需增加临时状态层 |

### 核心矛盾

**tRPC 是 request/response 范式，无法做实时推送。** 当前所有操作（保存文档、移动叶子、打开详情）都是 HTTP 请求。换成多用户后，每个操作的延迟变成 RTT + 数据库写入，对实时编辑来说不可接受（打字延迟 > 100ms 即可感知）。

---

## 2. 推荐技术方案：Yjs + WebSocket

### 为什么是 Yjs

- **CRDT 基础**：自动解决并发编辑冲突，无需 OT 变换的复杂逻辑
- **CodeMirror 6 原生集成**：[y-codemirror](https://github.com/yjs/y-codemirror) 直接绑定 CM6，几行代码接入
- **Awareness 协议**：内置用户光标位置、在线状态同步
- **轻量**：核心 ~15KB gzip，无重型依赖
- **传输无关**：可以用 WebSocket、WebRTC、甚至 HTTP 轮询，按需切换
- **支持富数据结构**：`Y.Map`、`Y.Array`、`Y.Text`，适合叶子位置、节点绑定等场景

### 为什么不是 OT (Operational Transformation)

- OT 需要中心服务器做变换，单点瓶颈
- Google Docs 的 OT 实现极其复杂（~10 年打磨）
- CRDT 天然去中心化，Peer-to-Peer 可行

### 为什么不是 Liveblocks / PartyKit / Replicache

- 托管服务有 vendor lock-in、成本不可控、网络延迟依赖
- mdforest 需要保持自托管（self-hosted）能力
- Yjs 可以跑在任何 WebSocket 服务器上

---

## 3. 分层架构设计

```
┌─────────────────────────────────────────────────┐
│  客户端 (Browser / PWA / Tauri)                  │
│                                                  │
│  ┌──────────┐  ┌────────────┐  ┌─────────────┐ │
│  │ CodeMirror│  │Canvas 画布  │  │  Presence   │ │
│  │ + y-cm   │  │+ Y.Map 同步 │  │  Awareness   │ │
│  └────┬─────┘  └─────┬──────┘  └──────┬──────┘ │
│       │              │               │         │
│       └──────────────┼───────────────┘         │
│                      │                         │
│               ┌──────▼──────┐                  │
│               │   Y.Doc     │  (CRDT 文档)      │
│               └──────┬──────┘                  │
│                      │                         │
└──────────────────────┼─────────────────────────┘
                       │
              WebSocket (y-websocket)
                       │
┌──────────────────────┼─────────────────────────┐
│  服务端                                          │
│                      │                         │
│               ┌──────▼──────┐                  │
│               │  WebSocket  │  (轻量 ws server) │
│               │  Server     │                  │
│               └──────┬──────┘                  │
│                      │                         │
│         ┌────────────┼────────────┐            │
│         │            │            │            │
│    ┌────▼───┐  ┌─────▼────┐  ┌───▼──────┐    │
│    │ 内存    │  │ PostgreSQL│  │ tRPC API │    │
│    │ Y.Doc   │  │ (持久化)  │  │ (不变)   │    │
│    │ 缓存    │  │          │  │          │    │
│    └────────┘  └──────────┘  └──────────┘    │
│                                                  │
└─────────────────────────────────────────────────┘
```

### 各层职责

**客户端 Y.Doc**：每个文档一个 Y.Doc 实例，包含：
- `doc.content` → `Y.Text`（编辑器内容）
- `doc.leafs` → `Y.Map<{x: number, y: number}>`（叶子位置）
- `doc.bindings` → `Y.Map<Set<string>>`（叶子→commit 绑定）
- awareness（用户光标、选中状态、当前浏览的 commit）

**WebSocket Server**：
- 独立于 Next.js 的轻量进程（~200 行代码）
- 用 `y-websocket` 协议，或直接用 `ws` 库实现
- 内存中缓存活跃 Y.Doc（LRU 淘汰）
- 定期 snapshot 到 PostgreSQL
- 支持 room 模式（每个文档一个 room）

**tRPC API（保留）**：
- 仍然负责认证、仓库管理、Git 操作
- 不再处理文档内容更新（由 WebSocket 接管）
- 新增：文档协作权限管理、邀请链接

---

## 4. 数据库模型变更

### Document 表增加字段

```prisma
model Document {
  // ... 现有字段 ...

  // 协作
  collaborators  DocumentCollaborator[]
  isPublic        Boolean   @default(false)   // 是否公开可编辑
  lastSnapshot    String?                      // 最后一次内容快照（冗余）
  snapshotVersion Int       @default(0)        // 快照版本号
}

model DocumentCollaborator {
  id         String   @id @default(cuid())
  documentId String
  userId     String
  role       String   @default("editor")  // "editor" | "viewer"
  joinedAt   DateTime @default(now())

  document Document @relation(fields: [documentId], references: [id], onDelete: Cascade)
  user     User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([documentId, userId])
}

model Repo {
  // ... 现有字段 ...
  collaborators RepoCollaborator[]  // 仓库级协作
}
```

### 为什么不在 CRDT 中做所有持久化

Yjs 的 Y.Doc 是内存结构。持久化需要 snapshot + update log。用 PostgreSQL 做 cold storage：
- 每 30 秒（或 N 次编辑后）存一次 snapshot
- 重启时从 snapshot 恢复 + 重放 update log
- 比把 Yjs 的二进制 update 直接存 SQLite 更可维护

---

## 5. 编辑器接入方案

### 当前：CodeMirror 6 + 本地状态

```typescript
// 现在 — 本地编辑，手动保存
const view = new EditorView({ state: EditorState.create({ doc: value }) });
view.addUpdateListener((update) => {
  if (update.docChanged) onChange(update.state.doc.toString());
});
```

### 目标：y-codemirror 绑定

```typescript
import { yCollab } from 'y-codemirror';
import { Awareness } from 'y-protocols/awareness';

// Yjs 接管 CodeMirror 的状态
const yText = ydoc.getText('content');
const awareness = new Awareness(ydoc);

const view = new EditorView({
  state: EditorState.create({
    doc: yText.toString(),
    extensions: [
      yCollab(yText, awareness),  // 实时同步 + 远程光标
      markdown(),
    ],
  }),
});
```

**效果**：
- 所有编辑自动通过 WebSocket 广播
- 远程用户的光标实时显示
- 无需 "Save" 按钮（自动保存）
- 离线编辑自动重连后合并

---

## 6. 画布协作方案

Canvas 是本地渲染引擎，协作不意味着共享 pixel buffer，而是共享 **数据状态**。

```
当前: 叶子位置 → 本地 state → Canvas 渲染
协作: 叶子位置 → Y.Map → WebSocket → 其他客户端 Y.Map → Canvas 渲染
```

### 同步的数据

| 数据 | 同步方式 | 频率 |
|---|---|---|
| 叶子位置 (leafX, leafY) | Y.Map | 拖拽松手时 |
| 叶子-commit 绑定 | Y.Map | 创建/修改绑定时 |
| 用户浏览位置 (viewport) | awareness | 连续（节流 200ms） |
| 用户选中状态 | awareness | 即时 |
| 孤立叶子创建 | Y.Map | 创建时 |

### Canvas 不需要共享

- 渲染管线保持纯客户端
- 每个客户端独立计算布局、绘制
- 只同步数据模型，不同步绘制结果

---

## 7. 性能与轻量目标

### 内存估算

| 组件 | 内存 | 备注 |
|---|---|---|
| 单个 Y.Doc (10KB 文档) | ~2MB | 含 undo history |
| WebSocket 连接 × 100 | ~10MB | Node.js ws |
| CodeMirror + y-cm | ~5MB | 正常范围 |
| Canvas + tree 数据 | ~10MB | 1000 节点 |
| **总计（单用户）** | **~30MB** | 可接受 |
| **服务器（100 并发）** | **~200MB** | 需要 LRU 淘汰 |

### 延迟目标

| 操作 | 目标延迟 | 实现方式 |
|---|---|---|
| 按键→远程可见 | < 100ms | WebSocket 直发 |
| 光标移动 | < 50ms | awareness 独立通道 |
| 叶子拖动 | < 200ms | debounce + 松手时提交 |
| 文档打开→就绪 | < 500ms | snapshot 预热 |
| 重连恢复 | < 1s | update log 增量同步 |

### 轻量原则

1. **不引入 Redis**：用内存 Map + PostgreSQL snapshot 替代
2. **不引入消息队列**：WebSocket server 直接处理，无中间层
3. **不引入 Kubernetes**：单体 WebSocket 进程可横向扩展（room 路由）
4. **Yjs 二进制 update 直接传输**：不序列化 JSON，delta 极小

---

## 8. 网页端 vs 桌面端

### 网页端（当前方向，推荐保持）

| 优势 | 劣势 |
|---|---|
| 零安装，URL 即分享 | 无法直接读写本地文件系统 |
| 自动更新 | Git 操作需通过服务端 |
| 移动端可用 | 离线能力弱（需 Service Worker） |
| 开发效率高（HMR 热更新） | 浏览器 Tab 管理碎片化 |
| 部署简单（Vercel/Docker） | 无系统级快捷键、通知 |
| PWA 可渐近增强离线 | 大文件性能受限 |

### 桌面端（Electron / Tauri）

| 优势 | 劣势 |
|---|---|
| 本地 Git 直连（零延迟） | 安装包 100MB+（Electron） |
| 完整文件系统访问 | 自动更新需要额外基建 |
| 原生菜单、快捷键、托盘 | 跨平台测试负担 × 3 |
| 离线优先天然支持 | 开发反馈周期长 |
| 多窗口管理 | 安全补丁跟随 Electron 版本 |
| Tauri 可做到 < 10MB | Tauri Rust 学习曲线 |

### 推荐：PWA 渐进增强

```
Phase 1 (现在):    纯 Web  →  无离线，无桌面
Phase 2 (3 个月):   + PWA   →  Service Worker 离线缓存、本地存储
Phase 3 (6 个月):   + Tauri  →  桌面壳（复用 100% 前端代码）
```

**理由**：
- 当前已是 Next.js Web 应用，PWA 只需加 manifest + service worker
- PWA 提供离线访问、桌面快捷方式、文件系统 API（有限）
- 如果用户真的需要本地 Git 性能，Tabula 壳可以用 Tauri 包裹现有 Web 前端，代码零改动
- 不要在需求不明确时过早投入桌面端维护成本

---

## 9. 实施路线图

### Phase 1: 实时编辑核心（~2 周）

```
□ 搭建独立 WebSocket 服务（ws + y-websocket 协议）
□ 集成 y-codemirror 替换现有编辑器
□ 实现 Y.Doc 内存缓存 + PostgreSQL snapshot
□ 添加 DocumentCollaborator 模型 + 权限检查
□ 移除手动 Save 按钮，改为自动保存
```

### Phase 2: 协作增强（~2 周）

```
□ Awareness 光标同步
□ 叶子位置 → Y.Map 实时同步
□ 在线用户列表 + 浏览位置指示
□ 冲突提示（他人正在编辑同一文档）
□ 操作历史 / 版本回退（基于 Yjs undo）
```

### Phase 3: Canvas 协作（~1 周）

```
□ 叶子拖动广播
□ 孤立叶子创建广播
□ Viewport awareness（其他用户在看哪里）
□ 画布锁定 / 跟随模式
```

### Phase 4: 部署与离线（~2 周）

```
□ PWA manifest + Service Worker
□ Docker Compose 一键部署（含 WebSocket）
□ 负载测试（100 并发编辑）
□ 文档导出 / 快照恢复工具
```

---

## 10. 风险与对策

| 风险 | 概率 | 对策 |
|---|---|---|
| WebSocket 连接不稳定 | 中 | 自动重连 + update log 增量恢复 |
| CRDT 文档膨胀（长期编辑） | 中 | 定期 snapshot 清理历史 |
| 多人同时编辑同一行 | 高 | Yjs 自动解决，UI 提示冲突 |
| 恶意用户破坏文档 | 低 | 保留 Git 版本历史，可回退 |
| 服务器内存溢出 | 低 | LRU 淘汰不活跃文档 + 硬上限 |
| CodeMirror 插件与 y-cm 冲突 | 中 | 轻量扩展集，避免复杂插件 |

---

## 11. 结论

**保持 Web 优先 + Yjs 轻量实时 + PWA 渐进增强。**

不做桌面端的原因：当前阶段核心价值是「知识的可视化导航」+「实时协作」，Web 平台完全满足。桌面端的文件系统优势（本地 Git）是锦上添花，不是核心需求。等协作功能打磨成熟后，用 Tauri 套壳是最低成本路径。

**关键决策**：
- ✅ CRDT (Yjs) 而非 OT
- ✅ 独立 WebSocket 进程 而非 serverless
- ✅ 内存 + PostgreSQL 而非 Redis
- ✅ Web (PWA) 而非 Electron/Tauri（当前阶段）
- ✅ CodeMirror 6 保留 + y-codemirror 接入
