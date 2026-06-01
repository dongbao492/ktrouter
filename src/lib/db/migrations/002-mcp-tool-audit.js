// Migration #2 — add mcpToolAudit table for MCP server audit logging.
// Idempotent via syncSchemaFromTables, but explicit migration ensures correct
// version stamp and a transactional create on existing DBs.
import { TABLES, buildCreateTableSql } from "../schema.js";

export default {
  version: 2,
  name: "mcp-tool-audit",
  up(db) {
    const def = TABLES.mcpToolAudit;
    db.exec(buildCreateTableSql("mcpToolAudit", def));
    for (const idx of def.indexes || []) db.exec(idx);
  },
};
