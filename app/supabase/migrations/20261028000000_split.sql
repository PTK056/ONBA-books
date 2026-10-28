-- An expense shared by several villas (a cleaner who works in all of them, fuel, a bulk purchase) is booked as
-- one entry per villa, in shares; split_group ties the shares together so they can be shown and deleted as one.
-- Each share gets its own copy of the receipt, so every owner sees the proof of their share.

alter table public.transactions add column split_group uuid;
create index on public.transactions (split_group) where split_group is not null;
