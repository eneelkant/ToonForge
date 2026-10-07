/**
 * MCP server entry (foundation stub).
 * Full tool wiring (discover_trends, generate_video, publish, ...) lands in later phases.
 * Business tools must stay high-level — see docs/architecture.md.
 */
export const MCP_TOOL_NAMES = [
  "toonforge.discover_trends",
  "toonforge.analyze_reference",
  "toonforge.generate_story",
  "toonforge.list_characters",
  "toonforge.select_characters",
  "toonforge.create_storyboard",
  "toonforge.generate_video",
  "toonforge.run_qa",
  "toonforge.generate_thumbnail",
  "toonforge.prepare_publish",
  "toonforge.publish",
  "toonforge.schedule",
  "toonforge.get_video_status",
  "toonforge.get_analytics",
  "toonforge.get_system_status",
  "toonforge.pause",
  "toonforge.resume",
  "toonforge.run_daily_workflow",
] as const;

export type McpToolName = (typeof MCP_TOOL_NAMES)[number];
