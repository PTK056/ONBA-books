import { generateProtectedResourceMetadata, getPublicOrigin, metadataCorsOptionsRequestHandler } from "mcp-handler";

// RFC 9728: tells MCP clients that /api/mcp is protected by Supabase Auth (Splyce's OAuth server).
// offline_access asks for a refresh token, so the assistant stays connected after the 1-hour access token.
export function GET(req: Request) {
  const metadata = generateProtectedResourceMetadata({
    authServerUrls: [`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1`],
    resourceUrl: getPublicOrigin(req),
    additionalMetadata: { scopes_supported: ["openid", "email", "offline_access"], bearer_methods_supported: ["header"] },
  });
  return Response.json(metadata, {
    headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "max-age=3600" },
  });
}

export const OPTIONS = metadataCorsOptionsRequestHandler();
