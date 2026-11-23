-- Notifications are delivered through Dispatch now, addressed by the
-- workspace's `to`. The old per-workspace Teams webhook and email settings
-- are dropped so stored settings still parse.
update workspaces
   set settings = jsonb_set(settings, '{notifications}', (settings->'notifications') - 'teamsWebhook' - 'email')
 where jsonb_typeof(settings->'notifications') = 'object';
