# Azure Log Analytics MCP Server (Node.js)

Node.js MCP server for Azure Log Analytics with Docker support and Service Principal authentication.

## Quick Start

### Docker (Recommended)

1. Create `.env` file:
```bash
cp .env.example .env
# Edit .env with your Service Principal credentials
```

2. Run with Docker Compose:
```bash
docker-compose up --build
```

### Local Development

1. Install dependencies:
```bash
npm install
```

2. Set environment variables:
```bash
export AZURE_CLIENT_ID="your-client-id"
export AZURE_CLIENT_SECRET="your-client-secret"  
export AZURE_TENANT_ID="your-tenant-id"
```

3. Run server:
```bash
npm start
```

## Authentication

**Service Principal (SPN):**
- Set `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_TENANT_ID`
- Fallback to DefaultAzureCredential if SPN not configured

## MCP Configuration

Add to Q CLI config:
```json
{
  "mcpServers": {
    "azure-logs": {
      "command": "docker",
      "args": ["run", "-i", "--env-file", ".env", "azure-logs-mcp"]
    }
  }
}
```

## Tools

- `query_logs` - Execute KQL with formatting
- `save_query` / `list_saved_queries` / `run_saved_query` - Query management  
- `list_tables` - List workspace tables
- `get_table_schema` - Get table schema
