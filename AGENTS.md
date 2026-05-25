<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Memory

You have access to mdforest-memory MCP tools for persistent knowledge across sessions.

## When to use memory tools

**Before each task** — call `search_memory` to recall past decisions, preferences, and context relevant to the current task.

**After important decisions** — call `add_memory` to store:
- Design decisions with rationale (type: decision)
- User preferences and conventions (type: preference)
- Discovered project facts (type: fact)
- Procedures that worked (type: procedure)
- Significant events or milestones (type: event)

**When context is unclear** — call `get_timeline_context` to see recent project activity.

## Go/No-Go validation

We are actively validating whether the memory system is useful. In every session you MUST:
1. Call `search_memory` at session start
2. Call `add_memory` after each non-trivial design decision
3. Mention what you searched for and whether it helped
