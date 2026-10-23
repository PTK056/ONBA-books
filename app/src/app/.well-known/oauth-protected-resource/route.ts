import { metadataCorsOptionsRequestHandler, protectedResourceHandler } from "mcp-handler";

// RFC 9728: tells MCP clients that /api/mcp is protected by Supabase Auth (ONBA Books' OAuth server).
const handler = protectedResourceHandler({
  authServerUrls: [`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1`],
});

const options = metadataCorsOptionsRequestHandler();

export { handler as GET, options as OPTIONS };
