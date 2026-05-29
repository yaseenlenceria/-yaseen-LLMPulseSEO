import { loadLlmsSnapshot } from "../lib/llms.server";
import { unauthenticated } from "../shopify.server";

export const loader = async ({ request }) => {
  const shop = new URL(request.url).searchParams.get("shop");
  const proxyShop = request.headers.get("x-shopify-shop-domain");
  const resolvedShop = shop || proxyShop;

  if (!resolvedShop) {
    return new Response("Missing shop parameter", { status: 400 });
  }

  const { admin } = await unauthenticated.admin(resolvedShop);
  const snapshot = await loadLlmsSnapshot(admin, 100);

  return new Response(snapshot.files.llmsFullTxt, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
};
