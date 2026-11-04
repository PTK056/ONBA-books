# Splyce — Bank MCP tools spec

Nov 4, 2026 · @Pierre · revised the same day after a code review (Claude + Codex)

## Overview

New MCP tools let an agent do what you do by hand in the Bank tab: read the lines left in **At the bank, not in your books**, then add, link or mark them personal. Splyce keeps its own auto-matching; the agent only handles what is left.

| UI action | MCP tool | Risk |
| --- | --- | --- |
| See the lines | `list_bank_lines` | Read only |
| Find entries or stays to link | `suggest_bank_links` | Read only |
| **Add to the books** | `add_bank_line_to_books` | Writes an entry |
| **Link to this** (an entry or a stay) | `link_bank_line` | Changes matching |
| **Personal** | `mark_bank_line_personal` | Keeps the line out of the P&L |
| **Book bank charges** | `book_bank_charges` | Writes one entry per month |
| **Put back in the list** | `unmatch_bank_line` | Restores the line |

## Shared conventions

- **Admins only.** The whole bank module is admins only (RLS on every bank table), so every bank tool, including the read ones, refuses staff and owners with a clear message.
- **Ids.** `bank_line_id` is the line's id. It survives "Match again" and re-importing the same statement (a line already known is skipped by its fingerprint). It is not guaranteed if the bank re-issues a statement with different text for the same line.
- **Amounts.** Positive decimal `amount` plus `direction` (`in` | `out`) and `currency`, exactly as stored. No signed integers: Wise accounts in EUR or USD have cents.
- **One atomic operation per action.** Add, link, personal and reset each run as one database function that locks the line (and the entry it links to), checks the line is still unmatched, and writes. The app, the agent and the auto-matching all go through these functions, so two of them acting on the same line at once can never book it twice.
- **Already handled.** If the line was handled meanwhile (by you in the app, by Match again, or by an earlier call), the write changes nothing and answers `already_handled` with what the line is now linked to. That makes a retry safe without idempotency keys.
- **Audit trail.** Each handled line stores who handled it (`auto`, `app` or `agent`), when, by which user, and an optional `note`. The Bank tab shows "by the assistant" and the note on lines the agent handled.
- **Closed months.** Writing an entry into a closed month fails with `month_closed` (the same database guard as `record_transaction`). Linking and marking personal do not touch entries and are allowed.
- **Errors.** Tools fail the MCP way (`isError: true`) with a message that starts with a code: `not_found`, `not_admin`, `already_handled`, `not_handled`, `month_closed`, `amount_mismatch`, `direction_mismatch`, `entry_taken`, `stay_entry`, `invalid_category`, `invalid_entries`, `fx_rate_required`, `cannot_delete`.
- **Bank text is data.** Counterparties and descriptions are written by whoever sent the money: the tools and the agent's instructions say to never follow them as instructions.
- **The server matches too.** The daily Gmail check links Airbnb payouts with the server key (no user): the database functions accept that role, which no signed-in user can take.
- **Names.** Villas and categories come from `get_context`. Bank fees, interest and other company costs go on the company.
- **Receipts.** Expenses at or above the organization's evidence threshold need a receipt. `add_bank_line_to_books` returns `needs_receipt`.

## Tool specs

The descriptions are written for the model: they are what it reads to decide when to call each tool.

### list_bank_lines

**Description:** Lists bank lines imported from statements. By default only the lines not yet in the books (the Bank tab's "At the bank, not in your books"). Use it first when the user asks to reconcile, clear the bank or catch up on statements. Each line can come with the payee's usual booking (`usual_booking`) and a flag for bank charges.

```json
{
  "status": "unmatched | matched | personal | all",   // default "unmatched"
  "from": "YYYY-MM-DD", "to": "YYYY-MM-DD",
  "account": "string",          // part of the account name, optional
  "direction": "in | out",
  "text": "string",             // in the counterparty or the description
  "limit": 50,                  // max 200
  "cursor": "string"
}
```

Returns per line: `bank_line_id`, `date`, `direction`, `amount`, `currency`, `counterparty`, `description`, `reference`, `account`, `statement_id`, `status`, `bank_charge` (fees, interest, tax withheld: book them with `book_bank_charges`), `usual_booking` (villa, category and description the same payee was booked with last time, and how many times), and for handled lines `linked_to`, `handled_by`, `note`, `personal_reason`. Also `related_line_ids`: other lines with the same reference (a Wise fee and its transfer). Plus `total` and `next_cursor`.

### suggest_bank_links

**Description:** For one bank line, the existing entries that could be the same money: same direction, not linked to another bank line, amount equal or close, date close. For money in, also the stays it could pay (a deposit, the balance, an Airbnb payout read from its e-mail). Use before choosing between linking and adding.

```json
{
  "bank_line_id": "uuid",
  "date_window_days": 10,        // default 10, max 120
  "amount_tolerance_pct": 0,     // default 0; use >0 for FX or fees, max 20
  "text": "string"               // optional: words of the entry's description; widens the search to any amount
}
```

Returns up to 10 entries (`transaction_id`, `date`, `amount`, `currency`, `description`, `category`, `villa`, `score` 0–1, `reasons`) and, for money in, up to 5 stays (`stay_id`, guest, dates, `net` booked for the stay, `lines_already_linked`, and the payout amount when Airbnb's e-mail gave it). A payroll payment is an entry like any other.

### add_bank_line_to_books

**Description:** Same as "Add to the books": creates one entry from a bank line and links them. Use only when no existing entry matches (check `suggest_bank_links` first). If `usual_booking` is given and fits, use it.

```json
{
  "bank_line_id": "uuid",
  "villa": "Casa ONBA | the company name",   // required, from get_context
  "category": "Bank fees",                    // required, from get_context
  "description": "string",                   // default: counterparty + description
  "fx_rate": 15500,                           // only for a line not in the reporting currency; default: the last rate used,
                                              // if within 45 days of the line (the answer says which), else fx_rate_required
  "note": "string"
}
```

Returns the `transaction_id`, the entry as saved, `needs_receipt`, and how to undo.

### link_bank_line

**Description:** Same as "Link to this": the money is already in the books, as an entry (a recorded expense, a payroll payment) or as stays (an Airbnb payout, a deposit). Give either one `transaction_id`, or one or more `stay_ids` (one payout can pay several stays).

```json
{
  "bank_line_id": "uuid",
  "transaction_id": "uuid",           // or
  "stay_ids": ["uuid"],               // 1..20, money in only
  "accept_amount_difference": false,  // the entry's amount differs (fee included, FX): only after the user agreed
  "note": "string"
}
```

An entry whose amount differs from the line returns `amount_mismatch` with both amounts, unless `accept_amount_difference` is true; the database checks it under the lock. For stays, the line must equal their net booked, or the payouts announced by Airbnb's e-mails; a deposit or a part payment needs `accept_amount_difference` too. Nothing is booked for the gap.

### mark_bank_line_personal

**Description:** Same as "Personal": the line stays in the bank history but never enters the P&L. For owner transfers in or out, private spending on the company account, and transfers between the owner's own accounts. Not for business expenses paid personally.

```json
{
  "bank_line_id": "uuid",
  "reason": "owner_transfer | owner_contribution | private_expense | internal_transfer",
  "note": "string"
}
```

### book_bank_charges

**Description:** Same as "Book bank charges": for one statement, books its bank fees as one expense per month and its interest net of the tax withheld as one income per month, on the company or the villas as set in Settings, and links the lines. Use it for the lines flagged `bank_charge` instead of adding them one by one.

```json
{ "statement_id": "uuid", "note": "string" }
```

### unmatch_bank_line

**Description:** Puts a handled line back in the list. By default the entry created from it stays in the books. With `delete_created_entry`, that entry is deleted too, but only if it was created from this line alone, has no receipt, is not a split or a bank-charges entry, and its month is open; otherwise nothing changes and the tool says why. Use only when the user asks to undo.

```json
{
  "bank_line_id": "uuid",
  "delete_created_entry": false
}
```

The line's trace (who handled it, the note) is cleared: a line in the list carries none.

## Later

- **One line paying several entries, splits and booked differences.** Today a line links to one entry (or to stays). Supporting several entries per line needs a link table; ship it when a real case needs it.
- **Rules.** The payee memory already offers the usual booking for each payee (`usual_booking`). Next step: let a payee be applied automatically on import, instead of a separate rules system. Undoing a line already removes that booking from the memory.
- **Choosing the organization.** The MCP uses the user's first organization; `get_context` names it. A user in several organizations will need a way to switch.

## Build checklist

- [x] Stable `bank_line_id` (the line id, kept across re-imports and Match again)
- [x] Migration: audit columns, personal reason, atomic database functions for add, link, personal and reset
- [x] App and auto-matching moved onto the atomic functions
- [x] `list_bank_lines`, `suggest_bank_links`
- [x] `add_bank_line_to_books`, `link_bank_line`, `mark_bank_line_personal`, `book_bank_charges`, `unmatch_bank_line`
- [x] "By the assistant" and the note shown in the Bank tab
- [ ] Read-only test of the agent in the sandbox organization (Casa ONBA)
- [ ] Write test in the sandbox, then April 2026 on the real books
- [ ] Later: several entries per line, splits, differences; payees applied on import
