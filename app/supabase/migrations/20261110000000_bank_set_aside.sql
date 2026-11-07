-- Splyce — a bank line set aside: still not in the books, not personal, just out of the way ("Set aside" in the Bank
-- tab), with the owner's note saying why. Nothing is booked. It leaves the list to do, Sply Accountant skips it, and it
-- can be put back at any time. The automatic matching still looks at it: if its entry turns up, it is linked.

alter table public.bank_lines add column set_aside_at timestamptz;

-- Only a line still to do is set aside; once handled (linked, added, personal), the mark goes.
create function private.bank_line_set_aside_clear() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status <> 'unmatched' then new.set_aside_at := null; end if;
  return new;
end $$;
create trigger bank_line_set_aside_clear before insert or update of status, set_aside_at on public.bank_lines
  for each row execute function private.bank_line_set_aside_clear();

create index bank_lines_to_do on public.bank_lines (organization_id) where status = 'unmatched' and set_aside_at is null;
