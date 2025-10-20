#!/usr/bin/env python3
import asyncio
import json
import csv
import io
import re
from typing import Any, Dict, List
from mcp.server import Server
from mcp.server.models import InitializationOptions
import mcp.server.stdio
import mcp.types as types
from azure.monitor.query import LogsQueryClient
from azure.identity import DefaultAzureCredential
import os

server = Server("azure-logs-mcp")

# Global client instance and saved queries
logs_client = None
saved_queries = {}

def format_results(results, format_type="json", limit=1000):
    if not results:
        return "No results found"
    
    limited_results = results[:limit] if len(results) > limit else results
    
    if format_type == "csv":
        if not limited_results:
            return ""
        output = io.StringIO()
        writer = csv.DictWriter(output, fieldnames=limited_results[0].keys())
        writer.writeheader()
        writer.writerows(limited_results)
        return output.getvalue()
    elif format_type == "table":
        if not limited_results:
            return ""
        headers = list(limited_results[0].keys())
        rows = [[str(row.get(h, "")) for h in headers] for row in limited_results]
        col_widths = [max(len(h), max(len(r[i]) for r in rows)) for i, h in enumerate(headers)]
        
        header_row = " | ".join(h.ljust(w) for h, w in zip(headers, col_widths))
        separator = "-+-".join("-" * w for w in col_widths)
        data_rows = [" | ".join(r[i].ljust(col_widths[i]) for i in range(len(headers))) for r in rows]
        
        return "\n".join([header_row, separator] + data_rows)
    else:
        return json.dumps(limited_results, indent=2, default=str)

def validate_kql_syntax(query):
    # Basic KQL validation
    if not query.strip():
        return False, "Empty query"
    
    # Check for basic KQL structure
    kql_keywords = ['where', 'project', 'summarize', 'order', 'limit', 'join', 'union', 'extend', 'parse']
    has_table = bool(re.search(r'^[A-Za-z_][A-Za-z0-9_]*', query.strip()))
    
    if not has_table:
        return False, "Query must start with a table name"
    
    return True, "Valid syntax"

@server.list_tools()
async def handle_list_tools() -> List[types.Tool]:
    return [
        types.Tool(
            name="query_logs",
            description="Execute KQL query against Azure Log Analytics workspace",
            inputSchema={
                "type": "object",
                "properties": {
                    "workspace_id": {"type": "string", "description": "Azure Log Analytics workspace ID"},
                    "query": {"type": "string", "description": "KQL query to execute"},
                    "timespan": {"type": "string", "description": "Time range", "default": "PT1H"},
                    "format": {"type": "string", "enum": ["json", "csv", "table"], "default": "json"},
                    "limit": {"type": "integer", "description": "Max rows to return", "default": 1000}
                },
                "required": ["workspace_id", "query"]
            }
        ),
        types.Tool(
            name="save_query",
            description="Save a KQL query for reuse",
            inputSchema={
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Query name"},
                    "query": {"type": "string", "description": "KQL query"},
                    "description": {"type": "string", "description": "Query description"}
                },
                "required": ["name", "query"]
            }
        ),
        types.Tool(
            name="list_saved_queries",
            description="List all saved queries",
            inputSchema={"type": "object", "properties": {}}
        ),
        types.Tool(
            name="run_saved_query",
            description="Execute a saved query",
            inputSchema={
                "type": "object",
                "properties": {
                    "workspace_id": {"type": "string", "description": "Workspace ID"},
                    "name": {"type": "string", "description": "Saved query name"},
                    "timespan": {"type": "string", "default": "PT1H"}
                },
                "required": ["workspace_id", "name"]
            }
        ),
        types.Tool(
            name="validate_query",
            description="Validate KQL query syntax",
            inputSchema={
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "KQL query to validate"}
                },
                "required": ["query"]
            }
        ),
        types.Tool(
            name="list_tables",
            description="List available tables in workspace",
            inputSchema={
                "type": "object",
                "properties": {
                    "workspace_id": {"type": "string", "description": "Workspace ID"}
                },
                "required": ["workspace_id"]
            }
        ),
        types.Tool(
            name="get_table_schema",
            description="Get schema for a specific table",
            inputSchema={
                "type": "object",
                "properties": {
                    "workspace_id": {"type": "string", "description": "Workspace ID"},
                    "table_name": {"type": "string", "description": "Table name"}
                },
                "required": ["workspace_id", "table_name"]
            }
        ),
        types.Tool(
            name="export_results",
            description="Export query results to file",
            inputSchema={
                "type": "object",
                "properties": {
                    "workspace_id": {"type": "string", "description": "Workspace ID"},
                    "query": {"type": "string", "description": "KQL query"},
                    "filename": {"type": "string", "description": "Output filename"},
                    "format": {"type": "string", "enum": ["csv", "json"], "default": "csv"}
                },
                "required": ["workspace_id", "query", "filename"]
            }
        )
    ]

@server.call_tool()
async def handle_call_tool(name: str, arguments: Dict[str, Any]) -> List[types.TextContent]:
    global logs_client, saved_queries
    
    if not logs_client:
        try:
            credential = DefaultAzureCredential()
            logs_client = LogsQueryClient(credential)
        except Exception as e:
            return [types.TextContent(type="text", text=f"Failed to initialize Azure client: {str(e)}")]
    
    if name == "query_logs":
        workspace_id = arguments["workspace_id"]
        query = arguments["query"]
        timespan = arguments.get("timespan", "PT1H")
        format_type = arguments.get("format", "json")
        limit = arguments.get("limit", 1000)
        
        try:
            response = logs_client.query_workspace(workspace_id=workspace_id, query=query, timespan=timespan)
            
            if response.tables:
                results = []
                for table in response.tables:
                    rows = [dict(zip(table.columns, row)) for row in table.rows]
                    results.extend(rows)
                
                formatted = format_results(results, format_type, limit)
                return [types.TextContent(type="text", text=formatted)]
            else:
                return [types.TextContent(type="text", text="No results found")]
                
        except Exception as e:
            return [types.TextContent(type="text", text=f"Query failed: {str(e)}")]
    
    elif name == "save_query":
        name_key = arguments["name"]
        query = arguments["query"]
        description = arguments.get("description", "")
        
        saved_queries[name_key] = {"query": query, "description": description}
        return [types.TextContent(type="text", text=f"Query '{name_key}' saved successfully")]
    
    elif name == "list_saved_queries":
        if not saved_queries:
            return [types.TextContent(type="text", text="No saved queries")]
        
        query_list = []
        for name, data in saved_queries.items():
            query_list.append({"name": name, "description": data["description"], "query": data["query"]})
        
        return [types.TextContent(type="text", text=json.dumps(query_list, indent=2))]
    
    elif name == "run_saved_query":
        workspace_id = arguments["workspace_id"]
        query_name = arguments["name"]
        timespan = arguments.get("timespan", "PT1H")
        
        if query_name not in saved_queries:
            return [types.TextContent(type="text", text=f"Query '{query_name}' not found")]
        
        query = saved_queries[query_name]["query"]
        
        try:
            response = logs_client.query_workspace(workspace_id=workspace_id, query=query, timespan=timespan)
            
            if response.tables:
                results = []
                for table in response.tables:
                    rows = [dict(zip(table.columns, row)) for row in table.rows]
                    results.extend(rows)
                
                return [types.TextContent(type="text", text=json.dumps(results, indent=2, default=str))]
            else:
                return [types.TextContent(type="text", text="No results found")]
                
        except Exception as e:
            return [types.TextContent(type="text", text=f"Query failed: {str(e)}")]
    
    elif name == "validate_query":
        query = arguments["query"]
        is_valid, message = validate_kql_syntax(query)
        
        result = {"valid": is_valid, "message": message}
        return [types.TextContent(type="text", text=json.dumps(result, indent=2))]
    
    elif name == "list_tables":
        workspace_id = arguments["workspace_id"]
        
        try:
            query = "search * | distinct $table | sort by $table asc"
            response = logs_client.query_workspace(workspace_id=workspace_id, query=query, timespan="P30D")
            
            tables = []
            if response.tables and response.tables[0].rows:
                tables = [row[0] for row in response.tables[0].rows]
            
            return [types.TextContent(type="text", text=json.dumps({"tables": tables}, indent=2))]
            
        except Exception as e:
            return [types.TextContent(type="text", text=f"Failed to list tables: {str(e)}")]
    
    elif name == "get_table_schema":
        workspace_id = arguments["workspace_id"]
        table_name = arguments["table_name"]
        
        try:
            query = f"{table_name} | getschema | project ColumnName, DataType, ColumnType"
            response = logs_client.query_workspace(workspace_id=workspace_id, query=query, timespan="P1D")
            
            if response.tables and response.tables[0].rows:
                schema = [dict(zip(response.tables[0].columns, row)) for row in response.tables[0].rows]
                return [types.TextContent(type="text", text=json.dumps({"table": table_name, "schema": schema}, indent=2))]
            else:
                return [types.TextContent(type="text", text=f"No schema found for table {table_name}")]
                
        except Exception as e:
            return [types.TextContent(type="text", text=f"Failed to get schema: {str(e)}")]
    
    elif name == "export_results":
        workspace_id = arguments["workspace_id"]
        query = arguments["query"]
        filename = arguments["filename"]
        format_type = arguments.get("format", "csv")
        
        try:
            response = logs_client.query_workspace(workspace_id=workspace_id, query=query, timespan="PT24H")
            
            if response.tables:
                results = []
                for table in response.tables:
                    rows = [dict(zip(table.columns, row)) for row in table.rows]
                    results.extend(rows)
                
                if format_type == "csv":
                    with open(filename, 'w', newline='') as f:
                        if results:
                            writer = csv.DictWriter(f, fieldnames=results[0].keys())
                            writer.writeheader()
                            writer.writerows(results)
                else:
                    with open(filename, 'w') as f:
                        json.dump(results, f, indent=2, default=str)
                
                return [types.TextContent(type="text", text=f"Results exported to {filename} ({len(results)} rows)")]
            else:
                return [types.TextContent(type="text", text="No results to export")]
                
        except Exception as e:
            return [types.TextContent(type="text", text=f"Export failed: {str(e)}")]
    
    return [types.TextContent(type="text", text=f"Unknown tool: {name}")]

async def main():
    async with mcp.server.stdio.stdio_server() as (read_stream, write_stream):
        await server.run(
            read_stream,
            write_stream,
            InitializationOptions(
                server_name="azure-logs-mcp",
                server_version="0.1.0",
                capabilities=server.get_capabilities(
                    notification_options=None,
                    experimental_capabilities=None,
                ),
            ),
        )

if __name__ == "__main__":
    asyncio.run(main())
