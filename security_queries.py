SECURITY_QUERIES = {
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
    }
}

def get_security_query(query_name):
    """Get a predefined security query"""
    return SECURITY_QUERIES.get(query_name)

def list_security_queries():
    """List all available security queries"""
    return [{"name": name, "description": data["description"]} for name, data in SECURITY_QUERIES.items()]
