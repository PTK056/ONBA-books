-- The Gmail check never reads e-mails older than this: set when connecting, e.g. the day the
-- books were migrated, so stays already in the books (some without a platform code) are not read again.

alter table public.mail_connections add column read_from timestamptz;
