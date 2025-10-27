#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { LogsQueryClient } from "@azure/monitor-query-logs";
import { ClientSecretCredential, DefaultAzureCredential } from "@azure/identity";

const DEBUG = process.env.DEBUG === 'true';

const SECURITY_QUERIES = {
  "failed_logins": {
    "query": "SigninLogs | where ResultType != 0 | summarize count() by UserPrincipalName, ResultType | order by count_ desc",
    "description": "Failed login attempts by user"
  },
  "privileged_operations": {
    "query": "AuditLogs | where Category == 'RoleManagement' | project TimeGenerated, OperationName, InitiatedBy, TargetResources",
    "description": "Privileged role management operations"
  },
  "suspicious_locations": {
    "query": "SigninLogs | where RiskLevelDuringSignIn == 'high' | project TimeGenerated, UserPrincipalName, Location, IPAddress",
    "description": "High-risk sign-ins from suspicious locations"
  },
  "data_access_audit": {
    "query": "StorageBlobLogs | where OperationName == 'GetBlob' | summarize count() by AccountName, CallerIpAddress | order by count_ desc",
    "description": "Data access patterns for blob storage"
  },
  "admin_activities": {
    "query": "AzureActivity | where CategoryValue == 'Administrative' and ActivityStatusValue == 'Success' | project TimeGenerated, Caller, OperationNameValue, ResourceGroup",
    "description": "Administrative activities in Azure"
  },
  "network_security": {
    "query": "AzureNetworkAnalytics_CL | where FlowType_s == 'ExternalPublic' | summarize count() by SrcIP_s, DestPort_d | order by count_ desc",
    "description": "External network connections"
  },
  "compliance_changes": {
    "query": "AzureActivity | where OperationNameValue contains 'policy' | project TimeGenerated, Caller, OperationNameValue, Properties",
    "description": "Policy and compliance related changes"
  },
  "security_alerts": {
    "query": "SecurityAlert | project TimeGenerated, AlertName, AlertSeverity, Description, Entities",
    "description": "Security Center alerts"
  },
  "security_incidents": {
    "query": "SecurityIncident | project TimeGenerated, Title, Severity, Status, Owner",
    "description": "Security incidents from Sentinel"
  },
  "malware_detections": {
    "query": "SecurityEvent | where EventID == 1116 | project TimeGenerated, Computer, ThreatName = extract('Threat name: ([^\\r\\n]+)', 1, EventData)",
    "description": "Windows Defender malware detections"
  }
};

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
            await this.logsClient.queryLogs(this.defaultWorkspaceId, "print 'connectivity test'", { duration: "PT1M" });
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
        },
        {
          name: "list_security_queries",
          description: "List available security query templates",
          inputSchema: { type: "object", properties: {} }
        },
        {
          name: "run_security_query",
          description: "Execute a predefined security query",
          inputSchema: {
            type: "object",
            properties: {
              workspace_id: { type: "string", description: "Workspace ID (optional if DEFAULT_WORKSPACE_ID set)" },
              query_name: { type: "string", description: "Security query name" },
              timespan: { type: "string", description: "Time range", default: "PT24H" },
              format: { type: "string", enum: ["json", "csv", "table"], default: "json" }
            },
            required: ["query_name"]
          }
        },
        {
          name: "get_security_query",
          description: "Get details of a specific security query",
          inputSchema: {
            type: "object",
            properties: {
              query_name: { type: "string", description: "Security query name" }
            },
            required: ["query_name"]
          }
        },
        {
          name: "query_security_logs",
          description: "Query Azure Security Center and security-related logs",
          inputSchema: {
            type: "object",
            properties: {
              workspace_id: { type: "string", description: "Workspace ID (optional if DEFAULT_WORKSPACE_ID set)" },
              query: { type: "string", description: "KQL query for security logs" },
              timespan: { type: "string", description: "Time range", default: "PT24H" },
              format: { type: "string", enum: ["json", "csv", "table"], default: "json" }
            },
            required: ["query"]
          }
        },
        {
          name: "query_logs_batch",
          description: "Execute multiple KQL queries in batch",
          inputSchema: {
            type: "object",
            properties: {
              workspace_id: { type: "string", description: "Workspace ID (optional if DEFAULT_WORKSPACE_ID set)" },
              queries: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string", description: "Query identifier" },
                    query: { type: "string", description: "KQL query" },
                    timespan: { type: "string", description: "Time range", default: "PT1H" }
                  },
                  required: ["id", "query"]
                },
                description: "Array of queries to execute"
              },
              format: { type: "string", enum: ["json", "csv", "table"], default: "json" }
            },
            required: ["queries"]
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
          case "list_security_queries":
            return this.listSecurityQueries();
          case "run_security_query":
            return await this.runSecurityQuery(args);
          case "get_security_query":
            return this.getSecurityQuery(args);
          case "query_security_logs":
            return await this.querySecurityLogs(args);
          case "query_logs_batch":
            return await this.queryLogsBatch(args);
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
      const response = await this.logsClient.queryLogs(testWorkspaceId, "print 'Connection successful'", { duration: "PT1M" });
      
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
      const response = await this.logsClient.queryLogs(workspaceId, query, { duration: timespan });
      
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
    const response = await this.logsClient.queryLogs(workspace_id, query, { duration: "P30D" });
    
    const tables = response.tables?.[0]?.rows?.map(row => row[0]) || [];
    return { content: [{ type: "text", text: JSON.stringify({ tables }, null, 2) }] };
  }

  async getTableSchema({ workspace_id, table_name }) {
    const query = `${table_name} | getschema | project ColumnName, DataType, ColumnType`;
    const response = await this.logsClient.queryLogs(workspace_id, query, { duration: "P1D" });
    
    if (!response.tables?.[0]?.rows?.length) {
      return { content: [{ type: "text", text: `No schema found for ${table_name}` }] };
    }
    
    const schema = response.tables[0].rows.map(row => 
      Object.fromEntries(response.tables[0].columns.map((col, i) => [col.name, row[i]]))
    );
    
    return { content: [{ type: "text", text: JSON.stringify({ table: table_name, schema }, null, 2) }] };
  }

  listSecurityQueries() {
    const queries = Object.entries(SECURITY_QUERIES).map(([name, data]) => ({
      name,
      description: data.description
    }));
    
    return { content: [{ type: "text", text: JSON.stringify(queries, null, 2) }] };
  }

  getSecurityQuery({ query_name }) {
    const query = SECURITY_QUERIES[query_name];
    
    if (!query) {
      return { content: [{ type: "text", text: `Security query '${query_name}' not found` }] };
    }
    
    return { content: [{ type: "text", text: JSON.stringify({ name: query_name, ...query }, null, 2) }] };
  }

  async runSecurityQuery({ workspace_id, query_name, timespan = "PT24H", format = "json" }) {
    const securityQuery = SECURITY_QUERIES[query_name];
    
    if (!securityQuery) {
      throw new Error(`Security query '${query_name}' not found`);
    }
    
    debugLog("Running security query", { query_name, timespan, format });
    
    return await this.queryLogs({
      workspace_id,
      query: securityQuery.query,
      timespan,
      format,
      limit: 1000
    });
  }

  async querySecurityLogs({ workspace_id, query, timespan = "PT24H", format = "json" }) {
    const workspaceId = workspace_id || this.defaultWorkspaceId;
    
    if (!workspaceId) {
      throw new Error("No workspace_id provided and DEFAULT_WORKSPACE_ID not set");
    }
    
    debugLog("Executing security logs query", { workspaceId, query, timespan, format });
    
    // Add security-focused context to the query if not already present
    const securityTables = ['SecurityEvent', 'SecurityAlert', 'SecurityIncident', 'SigninLogs', 'AuditLogs', 'AADNonInteractiveUserSignInLogs'];
    const hasSecurityTable = securityTables.some(table => query.includes(table));
    
    if (!hasSecurityTable) {
      debugLog("Query doesn't reference security tables, executing as-is");
    }
    
    return await this.queryLogs({ workspace_id: workspaceId, query, timespan, format });
  }

  async queryLogsBatch({ workspace_id, queries, format = "json" }) {
    const workspaceId = workspace_id || this.defaultWorkspaceId;
    
    if (!workspaceId) {
      throw new Error("No workspace_id provided and DEFAULT_WORKSPACE_ID not set");
    }
    
    debugLog("Executing batch queries", { workspaceId, queryCount: queries.length, format });
    
    const results = {};
    
    for (const queryItem of queries) {
      try {
        debugLog(`Executing batch query: ${queryItem.id}`);
        const response = await this.logsClient.queryLogs(workspaceId, queryItem.query, { 
          duration: queryItem.timespan || "PT1H" 
        });
        
        if (response.tables?.length) {
          const queryResults = [];
          for (const table of response.tables) {
            const rows = table.rows.map(row => 
              Object.fromEntries(table.columns.map((col, i) => [col.name, row[i]]))
            );
            queryResults.push(...rows);
          }
          results[queryItem.id] = this.formatResults(queryResults, format, 1000);
        } else {
          results[queryItem.id] = "No results found";
        }
      } catch (error) {
        errorLog(`Batch query ${queryItem.id} failed`, error);
        results[queryItem.id] = `Error: ${error.message}`;
      }
    }
    
    debugLog("Batch queries completed", { resultCount: Object.keys(results).length });
    return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }
}

const server = new AzureLogsMCPServer();
server.run().catch(console.error);
