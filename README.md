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

## VS Code + Copilot Setup

1. **Install Extensions:**
   - GitHub Copilot
   - GitHub Copilot Chat

2. **Set Environment Variables:**
```bash
export AZURE_CLIENT_ID="your-client-id"
export AZURE_CLIENT_SECRET="your-client-secret"
export AZURE_TENANT_ID="your-tenant-id"
```

3. **Open Project in VS Code:**
```bash
code .
```

4. **Use with Copilot:**
   - Open Copilot Chat (Ctrl+Shift+I)
   - MCP server will be available for Azure Log Analytics queries
   - Example: "Query the Heartbeat table for the last hour"

## Configuration Files

- `.vscode/settings.json` - MCP server configuration
- `.vscode/launch.json` - Debug configuration  
- `mcp-config.json` - Standalone MCP configuration

## Debugging & Troubleshooting

**Enable Debug Mode:**
```bash
export DEBUG=true
npm start
```

**Test Connectivity:**
Use the `test_connectivity` tool to diagnose Azure connection issues:
- Tests authentication
- Validates workspace access
- Reports detailed error information

**Common Issues:**
- **Authentication errors**: Check SPN credentials
- **Workspace not found**: Verify workspace ID
- **Network issues**: Check firewall/proxy settings
- **Permission errors**: Ensure SPN has Log Analytics Reader role

**Debug Output:**
- Credential configuration details
- Connection test results
- Query execution timing
- Detailed error messages with codes
