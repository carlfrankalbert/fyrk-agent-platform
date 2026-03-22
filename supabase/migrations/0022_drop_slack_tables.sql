-- Drop Slack-specific and web-chat tables no longer needed after iPad-first migration

DROP TABLE IF EXISTS husmor_event_dedup;
DROP TABLE IF EXISTS husmor_proactive_log;
DROP TABLE IF EXISTS husmor_web_messages;
DROP TABLE IF EXISTS husmor_web_conversations;
DROP TABLE IF EXISTS hub_login_codes;

-- hub_allowed_emails has a FK from hub_reminders — drop the constraint first
ALTER TABLE hub_reminders DROP CONSTRAINT IF EXISTS hub_reminders_created_by_fkey;
DROP TABLE IF EXISTS hub_allowed_emails;
