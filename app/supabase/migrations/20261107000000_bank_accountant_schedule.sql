-- Splyce — Sply Accountant on a schedule (docs/module-sply-accountant.md): a weekly review every Monday, and the
-- closing of last month on the 10th (a reminder on the 15th). They run with the morning brief; a pass they start is
-- recorded with its own trigger.

alter table public.bank_accountant_runs drop constraint bank_accountant_runs_trigger_check;
alter table public.bank_accountant_runs add constraint bank_accountant_runs_trigger_check
  check (trigger in ('statement', 'app', 'chat', 'weekly', 'monthly'));

-- The day Sply Accountant last wrote on its own in a chat: a cron called twice the same day sends nothing twice.
alter table public.channel_links add column accountant_sent_on date;
