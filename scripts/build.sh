#!/bin/bash
set -e

echo "Building Azure Logs MCP Docker image..."
docker build -t azure-logs-mcp .

echo "Build complete!"
echo "Run with: docker-compose up"
