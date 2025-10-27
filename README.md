# Azure Log Analytics MCP Server (Node.js)

Node.js MCP server for Azure Log Analytics with Docker support and Service Principal authentication. Uses the official `@azure/monitor-query-logs` library from the Azure SDK for JavaScript.

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

## Security Queries

**Available Templates:**
- `failed_logins` - Failed login attempts by user
- `privileged_operations` - Role management operations  
- `suspicious_locations` - High-risk sign-ins
- `data_access_audit` - Blob storage access patterns
- `admin_activities` - Administrative activities
- `network_security` - External network connections
- `compliance_changes` - Policy and compliance changes
- `security_alerts` - Security Center alerts
- `security_incidents` - Security incidents from Sentinel
- `malware_detections` - Windows Defender malware detections

**Usage:**
```bash
# List all security queries
list_security_queries

# Run a specific security query
run_security_query --query_name failed_logins --timespan PT1H

# Query security logs directly
query_security_logs --query "SecurityAlert | take 10"

# Batch query multiple security tables
query_logs_batch --queries '[
  {"id": "alerts", "query": "SecurityAlert | take 5"},
  {"id": "incidents", "query": "SecurityIncident | take 5"}
]'
```

## New Features

**Security Logs Querying:**
- Dedicated `query_security_logs` tool for security-focused queries
- Optimized for SecurityEvent, SecurityAlert, SecurityIncident, SigninLogs, AuditLogs tables
- Enhanced security query templates

**Batch Query Processing:**
- `query_logs_batch` tool for executing multiple queries simultaneously
- Parallel execution with individual error handling
- Structured results with query identifiers
