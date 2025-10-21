#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { LogsQueryClient } from "@azure/monitor-query";
import { ClientSecretCredential, DefaultAzureCredential } from "@azure/identity";

const DEBUG = process.env.DEBUG === 'true';

function debugLog(message, data = null) {
  if (DEBUG) {
    console.error(`[DEBUG] ${new Date().toISOString()} - ${message}`);
    if (data) console.error(JSON.stringify(data, null, 2));
  }
}

function errorLog(message, error = null) {
  console.error(`[ERROR] ${new Date().toISOString()} - ${message}`);
  if (error) {
    console.error(`Error details: ${error.message}`);
    if (error.code) console.error(`Error code: ${error.code}`);
    if (error.statusCode) console.error(`Status code: ${error.statusCode}`);
    if (DEBUG && error.stack) console.error(error.stack);
  }
}

class AzureLogsMCPServer {
  constructor() {
    debugLog("Initializing Azure Logs MCP Server");
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
    debugLog("Server initialized, setting up handlers");
    this.setupHandlers();
  }

  getCredential() {
    const { AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, AZURE_TENANT_ID, DEFAULT_WORKSPACE_ID } = process.env;
    
    this.defaultWorkspaceId = DEFAULT_WORKSPACE_ID;
    debugLog("Credential configuration", {
      hasClientId: !!AZURE_CLIENT_ID,
      hasClientSecret: !!AZURE_CLIENT_SECRET,
      hasTenantId: !!AZURE_TENANT_ID,
      hasDefaultWorkspace: !!DEFAULT_WORKSPACE_ID
    });
    
    if (AZURE_CLIENT_ID && AZURE_CLIENT_SECRET && AZURE_TENANT_ID) {
      debugLog("Using Service Principal authentication");
      return new ClientSecretCredential(AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET);
    }
    
    debugLog("Using DefaultAzureCredential");
    return new DefaultAzureCredential();
  }

  async initializeClient() {
    if (!this.logsClient) {
      try {
        debugLog("Initializing Azure Logs client");
        const credential = this.getCredential();
        this.logsClient = new LogsQueryClient(credential);
        
        // Test connectivity with a simple query if default workspace is available
        if (this.defaultWorkspaceId) {
          debugLog("Testing connectivity to default workspace", { workspaceId: this.defaultWorkspaceId });
          try {
            await this.logsClient.queryWorkspace(this.defaultWorkspaceId, "print 'connectivity test'", { duration: "PT1M" });
            debugLog("Connectivity test successful");
          } catch (testError) {
            errorLog("Connectivity test failed", testError);
          }
        }
        
      } catch (error) {
        errorLog("Failed to initialize Azure client", error);
        throw error;
      }
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
              workspace_id: { type: "string", description: "Workspace ID (optional if DEFAULT_WORKSPACE_ID set)" },
              query: { type: "string", description: "KQL query" },
              timespan: { type: "string", description: "Time range", default: "PT1H" },
              format: { type: "string", enum: ["json", "csv", "table"], default: "json" },
              limit: { type: "integer", description: "Max rows", default: 1000 }
            },
            required: ["query"]
          }
        },
        {
          name: "test_connectivity",
          description: "Test Azure connectivity and authentication",
          inputSchema: {
            type: "object",
            properties: {
              workspace_id: { type: "string", description: "Workspace ID to test (optional)" }
            }
          }
        },
        {
          name: "list_workspaces",
          description: "List available Log Analytics workspaces",
          inputSchema: { type: "object", properties: {} }
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
        debugLog("Handling tool call", { name, args });
        switch (name) {
          case "test_connectivity":
            return await this.testConnectivity(args);
          case "query_logs":
            return await this.queryLogs(args);
          case "list_workspaces":
            return await this.listWorkspaces();
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
        errorLog(`Tool execution failed for ${name}`, error);
        return {
          content: [{ type: "text", text: `Error: ${error.message}` }]
        };
      }
    });
  }

  async testConnectivity({ workspace_id }) {
    const testWorkspaceId = workspace_id || this.defaultWorkspaceId;
    
    if (!testWorkspaceId) {
      return { 
        content: [{ 
          type: "text", 
          text: "No workspace ID provided. Set DEFAULT_WORKSPACE_ID or provide workspace_id parameter." 
        }] 
      };
    }

    try {
      debugLog("Testing connectivity", { workspaceId: testWorkspaceId });
      const response = await this.logsClient.queryWorkspace(testWorkspaceId, "print 'Connection successful'", { duration: "PT1M" });
      
      const result = {
        status: "success",
        workspace_id: testWorkspaceId,
        message: "Successfully connected to Azure Log Analytics",
        timestamp: new Date().toISOString()
      };
      
      debugLog("Connectivity test passed", result);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      
    } catch (error) {
      errorLog("Connectivity test failed", error);
      
      const result = {
        status: "failed",
        workspace_id: testWorkspaceId,
        error: error.message,
        error_code: error.code || "UNKNOWN",
        timestamp: new Date().toISOString()
      };
      
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  }

  async queryLogs({ workspace_id, query, timespan = "PT1H", format = "json", limit = 1000 }) {
    const workspaceId = workspace_id || this.defaultWorkspaceId;
    
    if (!workspaceId) {
      throw new Error("No workspace_id provided and DEFAULT_WORKSPACE_ID not set");
    }
    
    debugLog("Executing query", { workspaceId, query, timespan, format, limit });
    
    try {
      const response = await this.logsClient.queryWorkspace(workspaceId, query, { duration: timespan });
      
      if (!response.tables?.length) {
        debugLog("Query returned no results");
        return { content: [{ type: "text", text: "No results found" }] };
      }
      
      const results = [];
      for (const table of response.tables) {
        const rows = table.rows.map(row => 
          Object.fromEntries(table.columns.map((col, i) => [col.name, row[i]]))
        );
        results.push(...rows);
      }
      
      debugLog("Query executed successfully", { resultCount: results.length });
      const formatted = this.formatResults(results, format, limit);
      return { content: [{ type: "text", text: formatted }] };
      
    } catch (error) {
      errorLog("Query execution failed", error);
      throw error;
    }
  }

  async listWorkspaces() {
    // This requires Azure Resource Management API - simplified version
    return { 
      content: [{ 
        type: "text", 
        text: "Set DEFAULT_WORKSPACE_ID environment variable or provide workspace_id in queries.\nFind workspace ID in Azure Portal > Log Analytics workspaces > Properties" 
      }] 
    };
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
