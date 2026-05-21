<div align="center">

# 🌲 mdforest / 文档森林

**Git repository as an interactive knowledge tree — 将 Git 仓库可视化为交互式知识树**

[![Next.js](https://img.shields.io/badge/Next.js-16.2-black?logo=next.js)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19.2-blue?logo=react)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6?logo=typescript)](https://www.typescriptlang.org/)
[![Prisma](https://img.shields.io/badge/Prisma-6.x-2d3748?logo=prisma)](https://www.prisma.io/)
[![tRPC](https://img.shields.io/badge/tRPC-11.x-2596be)](https://trpc.io/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-4.x-06b6d4?logo=tailwindcss)](https://tailwindcss.com/)
[![License](https://img.shields.io/badge/license-MIT-green)](./LICENSE)

</div>

---

<p align="center">
  <strong>English</strong> | <a href="#中文">中文</a>
</p>

---

## English

### What is mdforest?

**mdforest** turns your Git repository into a visual, interactive tree. Each commit becomes a node, each markdown document becomes a leaf. You can browse git history graphically, attach documents to commits, and navigate the connections between code and knowledge — all in one view.

### Features

- **Interactive Git Tree** — Visualize branch topology with a zoomable, pannable canvas rendered with HTML5 Canvas 2D.
- **Document Leaves** — Attach markdown documents to any commit. Leaf icons connect to their commits via bezier curves.
- **Free-form Canvas** — Drag leaves anywhere. Connection lines adapt automatically. Isolated leaves supported.
- **Adaptive Rendering** — Interface adjusts detail level based on available screen space.
- **Built-in Markdown Editor** — Edit documents with syntax highlighting (CodeMirror 6) and live preview.
- **Commit Detail Panel** — View full commit info, diff, and linked documents in a resizable side panel.
- **Search** — Full-text search across commits and documents (Ctrl+K).
- **OAuth Authentication** — Login via GitHub OAuth or dev credentials.
- **Multi-repo Support** — Clone and manage multiple Git repositories.

### Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router) |
| UI | React 19, Tailwind CSS 4, Radix UI |
| Language | TypeScript 5 |
| Database | SQLite (dev) / PostgreSQL (prod) via Prisma |
| API | tRPC v11 with React Query |
| Auth | NextAuth.js v4 (GitHub OAuth) |
| Editor | CodeMirror 6 |
| Canvas | Custom HTML5 Canvas 2D (no D3, no third-party graph lib) |

### Getting Started

#### Prerequisites
- Node.js 20+
- Git installed and in PATH

#### Installation

```bash
# Clone the repository
git clone https://github.com/z189yis/mdforest.git
cd mdforest

# Install dependencies
npm install

# Set up environment
cp .env.example .env
# Edit .env with your GitHub OAuth credentials (optional for dev)

# Initialize database
npx prisma migrate dev

# Start development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and log in with the dev credentials provider (enter any username).

#### Docker (PostgreSQL)

```bash
docker compose up -d   # Start PostgreSQL
# Then update DATABASE_URL in .env to the PostgreSQL connection string
```

### Project Structure

```
src/
├── app/                    # Next.js App Router pages
│   ├── (auth)/             # Login page
│   └── (dashboard)/        # Main app (repos, tree view)
├── components/
│   ├── git-tree/           # Canvas-based git tree visualization
│   ├── commit-detail/      # Commit info, diff, bound documents
│   ├── editor/             # Markdown editor & preview
│   ├── layout/             # App shell, sidebar, resizable panels
│   ├── search/             # Search modal & results
│   └── ui/                 # Reusable UI primitives
├── lib/                    # Client hooks (useGitTree, useViewportController)
├── server/
│   ├── api/routers/        # tRPC routers (git, document, binding, repo, search)
│   ├── git/                # Git CLI wrapper, tree layout algorithm
│   └── auth.ts             # NextAuth configuration
└── prisma/                 # Database schema & migrations
```

### Environment Variables

See `.env.example` for the complete list. Key variables:

| Variable | Description |
|---|---|
| `DATABASE_URL` | Database connection string |
| `NEXTAUTH_URL` | Auth callback URL (`http://localhost:3000`) |
| `NEXTAUTH_SECRET` | Session encryption secret |
| `GITHUB_CLIENT_ID` | GitHub OAuth App client ID |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth App client secret |
| `DATA_DIR` | Directory for cloned repositories |

### License

MIT

---

<h2 id="中文">中文</h2>

### mdforest 是什么？

**mdforest** 将你的 Git 仓库变成一棵可视化的交互式树。每个 commit 是一个节点，每个 markdown 文档是一片叶子。你可以图形化地浏览 Git 历史，将文档挂载到 commit 上，在一个视图内浏览代码与知识之间的连接。

### 功能特性

- **交互式 Git 树** — 基于 HTML5 Canvas 2D 的手绘风格可视化，支持缩放、拖拽平移。
- **文档叶子** — 将 Markdown 文档挂载到任意 commit 节点，叶子通过贝塞尔曲线与节点相连。
- **自由画布** — 叶子可随意拖动到任意位置，连线自适应调整。支持孤立叶子（不挂载于任何 commit）。
- **自适应渲染** — 根据可用屏幕空间自动调整显示细节级别。
- **内置 Markdown 编辑器** — 语法高亮编辑（CodeMirror 6）+ 实时预览。
- **Commit 详情面板** — 可调节大小的侧面板，展示完整 commit 信息、diff 及关联文档。
- **全局搜索** — 全文搜索 commit 和文档（Ctrl+K）。
- **OAuth 登录** — GitHub OAuth 或开发模式登录。
- **多仓库支持** — 克隆和管理多个 Git 仓库。

### 技术栈

| 层级 | 技术 |
|---|---|
| 框架 | Next.js 16 (App Router) |
| UI | React 19, Tailwind CSS 4, Radix UI |
| 语言 | TypeScript 5 |
| 数据库 | SQLite (开发) / PostgreSQL (生产) via Prisma |
| API | tRPC v11 + React Query |
| 认证 | NextAuth.js v4 (GitHub OAuth) |
| 编辑器 | CodeMirror 6 |
| 画布 | 纯手写 HTML5 Canvas 2D（无 D3，无第三方图库） |

### 快速开始

#### 环境要求
- Node.js 20+
- 系统中已安装 Git

#### 安装步骤

```bash
# 克隆仓库
git clone https://github.com/z189yis/mdforest.git
cd mdforest

# 安装依赖
npm install

# 配置环境变量
cp .env.example .env
# 编辑 .env 文件，填入你的 GitHub OAuth 凭据（开发模式可选）

# 初始化数据库
npx prisma migrate dev

# 启动开发服务器
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000)，使用开发凭据登录（输入任意用户名即可）。

#### Docker（PostgreSQL）

```bash
docker compose up -d   # 启动 PostgreSQL
# 然后将 .env 中的 DATABASE_URL 更新为 PostgreSQL 连接字符串
```

### 项目结构

```
src/
├── app/                    # Next.js App Router 页面
│   ├── (auth)/             # 登录页
│   └── (dashboard)/        # 主应用（仓库列表、树视图）
├── components/
│   ├── git-tree/           # 基于 Canvas 的 Git 树可视化
│   ├── commit-detail/      # Commit 详情、diff、关联文档
│   ├── editor/             # Markdown 编辑器与预览
│   ├── layout/             # 应用外壳、侧边栏、可调面板
│   ├── search/             # 搜索弹窗与结果
│   └── ui/                 # 可复用 UI 基础组件
├── lib/                    # 客户端 Hooks
├── server/
│   ├── api/routers/        # tRPC 路由
│   ├── git/                # Git CLI 封装、树布局算法
│   └── auth.ts             # NextAuth 配置
└── prisma/                 # 数据库 Schema 与迁移
```

### 环境变量

完整列表见 `.env.example`。关键变量：

| 变量 | 说明 |
|---|---|
| `DATABASE_URL` | 数据库连接字符串 |
| `NEXTAUTH_URL` | 认证回调地址 |
| `NEXTAUTH_SECRET` | 会话加密密钥 |
| `GITHUB_CLIENT_ID` | GitHub OAuth App 客户端 ID |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth App 客户端密钥 |
| `DATA_DIR` | 克隆仓库的存储目录 |

### 许可证

MIT
