import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { verifyToken } from "@/lib/mcp/session";
import { registerTools } from "@/lib/mcp/tools";

// MCP server for assistants (WhatsApp agent, Claude…). Every call carries the user's OAuth token
// and runs with that user's rights; see docs/agent-whatsapp.md.
export const maxDuration = 60; // reading a receipt with Claude takes a few seconds

const handler = createMcpHandler(registerTools, {
  serverInfo: { name: "ONBA Books", version: "1.0.0" },
  instructions:
    "ONBA Books keeps the books of short-term-rental villas. Call get_context first. Receipts sent as photos or PDFs go to "
    + "submit_receipt (they wait for review in the app); expenses or income stated in words go to record_transaction (booked at once). "
    + "Stays not from Airbnb go to record_stay, reminders to add_task, and get_todo lists what is pending. "
    + "Never guess a villa, an amount or a date: ask. After each write, repeat to the user exactly what was saved.",
});

const authed = withMcpAuth(handler, verifyToken, { required: true });

export { authed as GET, authed as POST, authed as DELETE };
