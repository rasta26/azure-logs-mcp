from azure.mgmt.monitor import MonitorManagementClient
from azure.mgmt.monitor.models import *
import json

class AlertManager:
    def __init__(self, credential, subscription_id):
        self.client = MonitorManagementClient(credential, subscription_id)
        self.subscription_id = subscription_id
    
    def create_log_alert(self, resource_group, alert_name, workspace_id, query, threshold=1):
        """Create a log analytics alert rule"""
        try:
            criteria = LogSearchRuleResource(
                location="global",
                description=f"Alert for {alert_name}",
                enabled=True,
                source=Source(
                    query=query,
                    data_source_id=f"/subscriptions/{self.subscription_id}/resourceGroups/{resource_group}/providers/Microsoft.OperationalInsights/workspaces/{workspace_id}"
                ),
                schedule=Schedule(
                    frequency_in_minutes=5,
                    time_window_in_minutes=5
                ),
                action=AlertingAction(
                    severity="3",
                    trigger=TriggerCondition(
                        threshold_operator="GreaterThan",
                        threshold=threshold
                    )
                )
            )
            
            result = self.client.scheduled_query_rules.create_or_update(
                resource_group_name=resource_group,
                rule_name=alert_name,
                parameters=criteria
            )
            
            return {"status": "success", "alert_id": result.id}
            
        except Exception as e:
            return {"status": "error", "message": str(e)}
    
    def list_alerts(self, resource_group=None):
        """List all alert rules"""
        try:
            if resource_group:
                alerts = self.client.scheduled_query_rules.list_by_resource_group(resource_group)
            else:
                alerts = self.client.scheduled_query_rules.list_by_subscription()
            
            alert_list = []
            for alert in alerts:
                alert_list.append({
                    "name": alert.name,
                    "id": alert.id,
                    "enabled": alert.enabled,
                    "description": alert.description
                })
            
            return {"status": "success", "alerts": alert_list}
            
        except Exception as e:
            return {"status": "error", "message": str(e)}
    
    def get_alert_history(self, resource_group, alert_name, days=7):
        """Get alert firing history"""
        try:
            # Query activity log for alert events
            filter_str = f"eventTimestamp ge '{days}' and resourceGroupName eq '{resource_group}' and operationName.value eq 'Microsoft.Insights/scheduledQueryRules/write'"
            
            events = self.client.activity_logs.list(filter=filter_str)
            
            history = []
            for event in events:
                if alert_name in event.resource_id:
                    history.append({
                        "timestamp": event.event_timestamp.isoformat(),
                        "status": event.status.value,
                        "description": event.description
                    })
            
            return {"status": "success", "history": history}
            
        except Exception as e:
            return {"status": "error", "message": str(e)}
