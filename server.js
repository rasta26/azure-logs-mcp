#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
//import { LogsQueryClient } from "@azure/monitor-query";
import { ClientSecretCredential, DefaultAzureCredential } from "@azure/identity";

class AzureLogsMCPServer {
  constructor() {
    this.server = new Server(
      { 
        name: "azure-logs-mcp", 
        version: "1.0.0" 
      },
      {
        capabilities: {
          tools: {}
        }
      }
    );
    this.logsClient = null;
    this.savedQueries = new Map();
    this.setupHandlers();
  }

  getCredential() {
    const { AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, AZURE_TENANT_ID } = process.env;
    
    if (AZURE_CLIENT_ID && AZURE_CLIENT_SECRET && AZURE_TENANT_ID) {
      return new ClientSecretCredential(AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET);
    }
    
    return new DefaultAzureCredential();
  }

  async initializeClient() {
    if (!this.logsClient) {
      const credential = this.getCredential();
      this.logsClient = new LogsQueryClient(credential);
    }
  }

  formatResults(results, format = "json", limit = 1000) {
    if (!results?.length) return "No results found";
    
    const limited = results.slice(0, limit);
    
    if (format === "csv") {
      const headers = Object.keys(limited[0]);
      const csvRows = [headers.join(",")];
      limited.forEach(row => {
        csvRows.push(headers.map(h => `"${row[h] || ""}"`).join(","));
      });
      return csvRows.join("\n");
    }
    
    if (format === "table") {
      const headers = Object.keys(limited[0]);
      const rows = limited.map(row => headers.map(h => String(row[h] || "")));
      const widths = headers.map((h, i) => Math.max(h.length, ...rows.map(r => r[i].length)));
      
      const headerRow = headers.map((h, i) => h.padEnd(widths[i])).join(" | ");
      const separator = widths.map(w => "-".repeat(w)).join("-+-");
      const dataRows = rows.map(row => row.map((cell, i) => cell.padEnd(widths[i])).join(" | "));
      
      return [headerRow, separator, ...dataRows].join("\n");
    }
    
    return JSON.stringify(limited, null, 2);
  }

  setupHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: "query_logs",
          description: "Execute KQL query against Azure Log Analytics",
          inputSchema: {
            type: "object",
            properties: {
              workspace_id: { type: "string", description: "Workspace ID" },
              query: { type: "string", description: "KQL query" },
              timespan: { type: "string", description: "Time range", default: "PT1H" },
              format: { type: "string", enum: ["json", "csv", "table"], default: "json" },
              limit: { type: "integer", description: "Max rows", default: 1000 }
            },
            required: ["workspace_id", "query"]
          }
        },
        {
          name: "save_query",
          description: "Save KQL query for reuse",
          inputSchema: {
            type: "object",
            properties: {
              name: { type: "string", description: "Query name" },
              query: { type: "string", description: "KQL query" },
              description: { type: "string", description: "Description" }
            },
            required: ["name", "query"]
          }
        },
        {
          name: "list_saved_queries",
          description: "List saved queries",
          inputSchema: { type: "object", properties: {} }
        },
        {
          name: "run_saved_query",
          description: "Execute saved query",
          inputSchema: {
            type: "object",
            properties: {
              workspace_id: { type: "string", description: "Workspace ID" },
              name: { type: "string", description: "Query name" },
              timespan: { type: "string", default: "PT1H" }
            },
            required: ["workspace_id", "name"]
          }
        },
        {
          name: "list_tables",
          description: "List workspace tables",
          inputSchema: {
            type: "object",
            properties: {
              workspace_id: { type: "string", description: "Workspace ID" }
            },
            required: ["workspace_id"]
          }
        },
        {
          name: "get_table_schema",
          description: "Get table schema",
          inputSchema: {
            type: "object",
            properties: {
              workspace_id: { type: "string", description: "Workspace ID" },
              table_name: { type: "string", description: "Table name" }
            },
            required: ["workspace_id", "table_name"]
          }
        }
      ]
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      await this.initializeClient();
      
      const { name, arguments: args } = request.params;
      
      try {
        switch (name) {
          case "query_logs":
            return await this.queryLogs(args);
          case "save_query":
            return this.saveQuery(args);
          case "list_saved_queries":
            return this.listSavedQueries();
          case "run_saved_query":
            return await this.runSavedQuery(args);
          case "list_tables":
            return await this.listTables(args);
          case "get_table_schema":
            return await this.getTableSchema(args);
          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error: ${error.message}` }]
        };
      }
    });
  }

  async queryLogs({ workspace_id, query, timespan = "PT1H", format = "json", limit = 1000 }) {
    const response = await this.logsClient.queryWorkspace(workspace_id, query, { duration: timespan });
    
    if (!response.tables?.length) {
      return { content: [{ type: "text", text: "No results found" }] };
    }
    
    const results = [];
    for (const table of response.tables) {
      const rows = table.rows.map(row => 
        Object.fromEntries(table.columns.map((col, i) => [col.name, row[i]]))
      );
      results.push(...rows);
    }
    
    const formatted = this.formatResults(results, format, limit);
    return { content: [{ type: "text", text: formatted }] };
  }

  saveQuery({ name, query, description = "" }) {
    this.savedQueries.set(name, { query, description });
    return { content: [{ type: "text", text: `Query '${name}' saved` }] };
  }

  listSavedQueries() {
    const queries = Array.from(this.savedQueries.entries()).map(([name, data]) => ({
      name, ...data
    }));
    return { content: [{ type: "text", text: JSON.stringify(queries, null, 2) }] };
  }

  async runSavedQuery({ workspace_id, name, timespan = "PT1H" }) {
    const saved = this.savedQueries.get(name);
    if (!saved) {
      throw new Error(`Query '${name}' not found`);
    }
    
    return await this.queryLogs({ workspace_id, query: saved.query, timespan });
  }

  async listTables({ workspace_id }) {
    const query = "search * | distinct $table | sort by $table asc";
    const response = await this.logsClient.queryWorkspace(workspace_id, query, { duration: "P30D" });
    
    const tables = response.tables?.[0]?.rows?.map(row => row[0]) || [];
    return { content: [{ type: "text", text: JSON.stringify({ tables }, null, 2) }] };
  }

  async getTableSchema({ workspace_id, table_name }) {
    const query = `${table_name} | getschema | project ColumnName, DataType, ColumnType`;
    const response = await this.logsClient.queryWorkspace(workspace_id, query, { duration: "P1D" });
    
    if (!response.tables?.[0]?.rows?.length) {
      return { content: [{ type: "text", text: `No schema found for ${table_name}` }] };
    }
    
    const schema = response.tables[0].rows.map(row => 
      Object.fromEntries(response.tables[0].columns.map((col, i) => [col.name, row[i]]))
    );
    
    return { content: [{ type: "text", text: JSON.stringify({ table: table_name, schema }, null, 2) }] };
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }
}

const server = new AzureLogsMCPServer();
server.run().catch(console.error);
