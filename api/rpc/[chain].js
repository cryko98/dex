/**
 * Same-origin JSON-RPC proxy.
 *
 * Robinhood Chain's public endpoint occasionally answers with a duplicated
 * Access-Control-Allow-Origin header, which browsers reject outright. Routing the
 * app's reads through this function sidesteps CORS entirely, and lets a dedicated
 * provider key live server-side (RPC_MAINNET_URL / RPC_TESTNET_URL) instead of in
 * the bundle.
 */
export const config = { runtime: "edge" };

const UPSTREAMS = {
  mainnet: process.env.RPC_MAINNET_URL || "https://rpc.mainnet.chain.robinhood.com",
  testnet: process.env.RPC_TESTNET_URL || "https://rpc.testnet.chain.robinhood.com",
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default async function handler(request) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (request.method !== "POST") return new Response("POST only", { status: 405, headers: CORS });

  const chain = new URL(request.url).pathname.split("/").filter(Boolean).pop() || "mainnet";
  const upstream = UPSTREAMS[chain] || UPSTREAMS.mainnet;

  try {
    const body = await request.text();
    const response = await fetch(upstream, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    const text = await response.text();
    return new Response(text, {
      status: response.status,
      headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "upstream failed";
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32000, message } }), {
      status: 502,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
}
