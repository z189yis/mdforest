/**
 * MCP 认证：从环境变量提取 userId 和 repoId
 *
 * 安全原则：userId 必须由用户配置，Agent 不可伪造
 * （Agent 调用的工具参数中不包含 userId，由 server 端从环境变量注入）
 */
export function getUserId(): string {
  const userId = process.env.MD_FOREST_USER_ID;
  if (!userId) {
    throw new Error(
      "MD_FOREST_USER_ID environment variable is required. " +
        "Set it in your MCP configuration 'env' section."
    );
  }
  return userId;
}

export function getRepoId(): string {
  const repoId = process.env.MD_FOREST_REPO_ID;
  if (!repoId) {
    // 如果没有设置，返回一个默认值供 Phase 1 测试使用
    console.error("[mcp] MD_FOREST_REPO_ID not set, using default 'default-repo'");
    return "default-repo";
  }
  return repoId;
}
