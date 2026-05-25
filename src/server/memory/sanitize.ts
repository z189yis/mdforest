/**
 * 记忆内容安全清理
 *
 * 原因：Agent 可能被诱导在记忆内容中嵌入恶意指令（prompt injection）。
 * 清理策略：移除所有 HTML/script 标签，移除 javascript: 协议。
 */
export function sanitizeMemoryContent(content: string): string {
  return content
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/javascript:/gi, "[removed]")
    .replace(/data:text\/html/gi, "[removed]")
    .trim();
}
