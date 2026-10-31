// node --test src/lib/stays/   (anonymised copies of real Airbnb e-mails, fixtures/airbnb-email/)

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { readAirbnbEmail, templateOf } from "./airbnb-email.ts";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/airbnb-email/${name}.eml`, import.meta.url));
const read = (name: string) => readAirbnbEmail(fixture(name));

test("booking confirmed: every figure, year taken from the e-mail's date", () => {
  const e = read("confirmed");
  assert.equal(e.template, "booking/host/ReservationHostConfirmationTemplate");
  assert.deepEqual({ ...e, messageId: undefined, subject: undefined, sentAt: undefined, template: undefined }, {
    kind: "confirmed", code: "HMAAAA0001", guest: "Jane Walker",
    listingId: "1000000000000000001", listing: "VILLA EXAMPLE - 2 BDR NEAR THE BEACH",
    checkIn: "2026-10-30", checkOut: "2026-11-06", nights: 7, currency: "EUR",
    gross: 512.55, fees: 87.4, net: 425.15,
    messageId: undefined, subject: undefined, sentAt: undefined, template: undefined,
  });
});

test("booking confirmed with the guest's message: the free text is never read", () => {
  const e = read("confirmed-message");
  assert.equal(e.kind, "confirmed");
  if (e.kind !== "confirmed") return;
  assert.equal(e.code, "HMAAAA0002");
  assert.deepEqual([e.checkIn, e.checkOut, e.nights], ["2026-11-09", "2026-11-24", 15]);
  assert.deepEqual([e.gross, e.fees, e.net], [1147.5, 195.65, 951.85]);
});

test("the same booking as an inquiry and as a request is not a booking", () => {
  assert.deepEqual([read("inquiry").kind, read("inquiry-same-day").kind, read("request").kind], ["ignored", "ignored", "ignored"]);
  const request = read("request");
  assert.equal(request.template, "booking/reservation_host_pending");
  // The request already carries the code and a potential payout: the template is what tells it apart.
  assert.match(fixture("request").toString(), /HMAAAA0001/);
});

test("payout: lines, total in the bank's currency, payout ID and arrival date", () => {
  const e = read("payout");
  assert.equal(e.kind, "payout");
  if (e.kind !== "payout") return;
  assert.deepEqual({ payoutId: e.payoutId, sentOn: e.sentOn, arrivesBy: e.arrivesBy, currency: e.currency, total: e.total }, {
    payoutId: "PAYOUTIDPAYOUT", sentOn: "2026-10-16", arrivesBy: "2026-10-23", currency: "IDR", total: 1938587,
  });
  assert.deepEqual(e.lines, [{
    guest: "Sam Lee", amount: 95.88, currency: "EUR", checkIn: "2026-10-15", checkOut: "2026-10-17",
    listing: "Villa Example - 2 BDR near the beach", listingId: "1000000000000000001", code: "HMAAAA0003",
  }]);
});

test("payout for an extra night carries the new dates", () => {
  const e = read("payout-extension");
  assert.equal(e.kind, "payout");
  if (e.kind !== "payout") return;
  assert.deepEqual([e.total, e.lines[0].amount, e.lines[0].code, e.lines[0].checkOut], [1491758, 74.26, "HMAAAA0004", "2026-10-12"]);
  const first = read("payout-long");
  assert.ok(first.kind === "payout" && first.lines[0].code === "HMAAAA0004" && first.lines[0].checkOut === "2026-10-11");
});

test("payout from before Airbnb printed a Payout ID: date and total stand in for it", () => {
  const old = fixture("payout").toString().replace(/Payout ID\s+PAYOUTIDPAYOUT\s+/, "");
  const e = readAirbnbEmail(old);
  assert.equal(e.kind, "payout");
  assert.equal(e.kind === "payout" && e.payoutId, "2026-10-16:IDR1938587");
});

test("canceled by the guest: code and what the host keeps", () => {
  const e = read("canceled");
  assert.deepEqual([e.kind, e.kind === "canceled" && e.code, e.kind === "canceled" && e.kept, e.kind === "canceled" && e.currency],
    ["canceled", "HMAAAA0005", 191.78, "EUR"]);
});

test("change accepted: code from the link; change requested: ignored", () => {
  const accepted = read("alteration-accepted");
  assert.deepEqual([accepted.kind, accepted.kind === "altered" && accepted.code], ["altered", "HMAAAA0004"]);
  assert.equal(read("alteration-request").kind, "ignored");
  // Airbnb's other template for the same e-mail.
  const other = btoa("reservation/alteration/AlterationAcceptedTemplate").replace(/=/g, "%3D");
  const twin = readAirbnbEmail(fixture("alteration-accepted").toString().replace(/c=\.pi80\.pk[A-Za-z0-9%]+/g, `c=.pi80.pk${other}`));
  assert.deepEqual([twin.template, twin.kind], ["reservation/alteration/AlterationAcceptedTemplate", "altered"]);
});

test("Airbnb Support message: codes surfaced, never booked", () => {
  const e = read("support-message");
  assert.equal(e.kind, "support_message");
  if (e.kind !== "support_message") return;
  assert.deepEqual(e.codes, ["HMAAAA0006"]);
  assert.match(e.excerpt, /cancelled the reservation HMAAAA0006/);
});

test("guest messages and review reminders are ignored", () => {
  assert.equal(read("guest-message").kind, "ignored");
  assert.equal(read("review").kind, "ignored");
});

test("a forged sender or a missing signature is refused", () => {
  const real = fixture("confirmed").toString();
  const forged = real.replace("From: Airbnb <automated@airbnb.com>", "From: Airbnb <automated@airbnb-payouts.com>");
  assert.deepEqual([readAirbnbEmail(forged).kind, (readAirbnbEmail(forged) as { reason: string }).reason], ["unrecognised", "Not sent by airbnb.com"]);
  const unsigned = real.replace("dkim=pass header.i=@automated.airbnb.com", "dkim=fail header.i=@automated.airbnb.com");
  assert.equal(readAirbnbEmail(unsigned).kind, "unrecognised");
  // A forged result added below Gmail's own does not count: only the topmost one is read.
  const spoof = `Authentication-Results: mx.google.com; dkim=fail\n${real.replace(/^Authentication-Results: .*\n/, "")}`
    .replace("From:", "Authentication-Results: mx.google.com; dkim=pass header.i=@automated.airbnb.com\nFrom:");
  assert.equal(readAirbnbEmail(spoof).kind, "unrecognised");
});

test("figures that don't add up are not booked", () => {
  const tampered = fixture("confirmed").toString().replace("YOU EARN   €425.15", "YOU EARN   €452.15");
  const e = readAirbnbEmail(tampered);
  assert.equal(e.kind, "unrecognised");
  assert.match((e as { reason: string }).reason, /doesn't add up/);
});

test("quoted-printable multipart, as Gmail returns it", () => {
  const real = fixture("payout").toString();
  const [head, body] = real.split("\n\n", 2).length === 2 ? [real.slice(0, real.indexOf("\n\n")), real.slice(real.indexOf("\n\n") + 2)] : [real, ""];
  const qp = body.replace(/=/g, "=3D").replace(/€/g, "=E2=82=AC").replace(/(.{70})/g, "$1=\n");
  const raw = head.replace(/Content-Type: .*\nContent-Transfer-Encoding: .*/, "Content-Type: multipart/alternative; boundary=\"b1\"")
    + `\n\n--b1\r\nContent-Transfer-Encoding: quoted-printable\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${qp}\r\n--b1\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<p>x</p>\r\n--b1--\r\n`;
  const e = readAirbnbEmail(raw);
  assert.equal(e.kind, "payout");
  assert.equal(e.kind === "payout" && e.lines[0].amount, 95.88);
});

test("template name decoded from the links", () => {
  assert.equal(templateOf("x https://a.b/?c=.pi80.pkUEFZTUVOVFNfSE9TVF9QQVlPVVRfU0VOVF9CQVNFXzIwMjU%3D y"), "PAYMENTS_HOST_PAYOUT_SENT_BASE_2025");
  assert.equal(templateOf("no links"), null);
});
