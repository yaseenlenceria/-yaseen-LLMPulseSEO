export const STORE_CONTENT_QUERY = `#graphql
  query LLMPulseSEOContent($first: Int!) {
    shop {
      name
      description
      myshopifyDomain
      primaryDomain {
        url
      }
    }
    products(first: $first, sortKey: UPDATED_AT, reverse: true) {
      nodes {
        id
        title
        handle
        description
        productType
        vendor
        tags
        onlineStoreUrl
        variants(first: 5) {
          nodes {
            title
            sku
            price
            selectedOptions {
              name
              value
            }
          }
        }
      }
    }
    collections(first: $first, sortKey: UPDATED_AT, reverse: true) {
      nodes {
        id
        title
        handle
        description
      }
    }
  }`;

export async function loadLlmsSnapshot(admin, first = 50) {
  const response = await admin.graphql(STORE_CONTENT_QUERY, { variables: { first } });
  const payload = await response.json();

  if (payload.errors?.length) {
    throw new Error(payload.errors.map((error) => error.message).join("; "));
  }

  return buildLlmsModel(payload.data);
}

export function buildLlmsModel(data) {
  const origin = data.shop.primaryDomain?.url || "https://example-store.com";
  const shopDomain = data.shop.myshopifyDomain || origin.replace(/^https?:\/\//, "");
  const products = data.products.nodes;
  const collections = data.collections.nodes;
  const llmsTxt = buildSummaryFile({ shop: data.shop, origin, products, collections });
  const llmsFullTxt = buildFullFile({ shop: data.shop, origin, products, collections });
  const health = buildContentHealth({ shop: data.shop, products, collections });
  const included = products.length + collections.length;

  return {
    shop: data.shop,
    origin,
    files: {
      legacyUrl: `/llm.txt?shop=${encodeURIComponent(shopDomain)}`,
      summaryUrl: `/llms.txt?shop=${encodeURIComponent(shopDomain)}`,
      fullUrl: `/llms-full.txt?shop=${encodeURIComponent(shopDomain)}`,
      storefrontLegacyUrl: `${origin}/apps/llms/llm.txt`,
      storefrontSummaryUrl: `${origin}/apps/llms/llms.txt`,
      storefrontFullUrl: `${origin}/apps/llms/llms-full.txt`,
      llmsTxt,
      llmsFullTxt,
    },
    counts: {
      products: products.length,
      collections: collections.length,
      pages: 0,
      blogPosts: 0,
      included,
      limit: Math.max(included, 1),
    },
    health,
    launchSteps: buildLaunchSteps({ included, health }),
    analytics: buildAnalytics({ products, collections, llmsTxt, llmsFullTxt, health }),
    discovery: buildDiscoveryReadiness({ products, collections, health, origin, generatedAt: new Date() }),
    citations: buildCitationReadiness({ origin, products, collections }),
    prompts: buildPromptIdeas({ shop: data.shop, products, collections }),
    products: products.map((product) => ({
      id: product.id,
      title: product.title,
      url: product.onlineStoreUrl || `${origin}/products/${product.handle}`,
      type: product.productType || "Product",
      vendor: product.vendor || data.shop.name,
      description: product.description || "",
      tags: product.tags || [],
    })),
    collections: collections.map((collection) => ({
      id: collection.id,
      title: collection.title,
      url: `${origin}/collections/${collection.handle}`,
      description: collection.description || "",
    })),
    businessDna: {
      brand: data.shop.name,
      canonicalUrl: origin,
      positioning:
        data.shop.description ||
        "Describe your brand, catalog, customer, and buying guidance so assistants can represent the store accurately.",
      policies: ["Shipping", "Returns", "Contact", "Privacy"],
      schema: {
        businessName: data.shop.name,
        businessType: "OnlineStore",
        url: origin,
        catalogSize: products.length,
        collectionCount: collections.length,
      },
    },
  };
}

function buildDiscoveryReadiness({ products, collections, health, origin, generatedAt }) {
  const fileCount = products.length + collections.length;
  const productsAccessible = products.length;
  const collectionsAccessible = collections.length;
  const ready = productsAccessible > 0 && collectionsAccessible > 0;
  const partial = fileCount > 0 && health.score < 70;
  const checkedAt = generatedAt.toISOString();
  const platforms = [
    {
      name: "ChatGPT-4o",
      shortName: "GPT",
      family: "OpenAI",
      color: "#111827",
      discoverySource: "llms.txt, robots.txt, product URLs",
    },
    {
      name: "Google Gemini",
      shortName: "GEM",
      family: "Google",
      color: "#1a73e8",
      discoverySource: "llms.txt, robots.txt, merchant URLs",
    },
    {
      name: "Claude",
      shortName: "CLD",
      family: "Anthropic",
      color: "#b45309",
      discoverySource: "llms.txt, llms-full.txt, cited URLs",
    },
    {
      name: "Perplexity",
      shortName: "PRX",
      family: "Answer search",
      color: "#0f766e",
      discoverySource: "robots.txt, llms.txt, citation URLs",
    },
    {
      name: "Grok",
      shortName: "GRK",
      family: "Social search",
      color: "#4b5563",
      discoverySource: "public catalog URLs and llms.txt",
    },
    {
      name: "Meta AI",
      shortName: "MTA",
      family: "Meta",
      color: "#1877f2",
      discoverySource: "public catalog URLs and structured files",
    },
  ].map((platform) => ({
    ...platform,
    status: ready ? (partial ? "Review content" : "Ready") : "Needs catalog",
    statusTone: ready ? (partial ? "warning" : "success") : "critical",
    productsAccessible,
    collectionsAccessible,
    files: [`${origin}/apps/llms/llm.txt`, `${origin}/apps/llms/llms.txt`, `${origin}/apps/llms/llms-full.txt`],
    checkedAt,
    reason: ready
      ? `${productsAccessible} products and ${collectionsAccessible} collections are exposed through public discovery files.`
      : "Add products and collections before AI assistants can discover the catalog.",
  }));

  return {
    checkedAt,
    platforms,
    logs: [
      {
        level: "success",
        title: "Catalog loaded",
        detail: `${productsAccessible} products and ${collectionsAccessible} collections read from Shopify Admin API.`,
        timestamp: checkedAt,
      },
      {
        level: "success",
        title: "Discovery files generated",
        detail: "llm.txt, llms.txt, and llms-full.txt are generated from live catalog data.",
        timestamp: checkedAt,
      },
      {
        level: health.score >= 70 ? "success" : "warning",
        title: "Content readiness checked",
        detail: `${health.score}% readiness based on descriptions, product types, vendors, and collection context.`,
        timestamp: checkedAt,
      },
      {
        level: "info",
        title: "Robots discovery path",
        detail: `${origin}/robots.txt should reference the LLMPulseSEO discovery URLs for crawlers.`,
        timestamp: checkedAt,
      },
    ],
  };
}

function buildContentHealth({ shop, products, collections }) {
  const productsWithDescriptions = products.filter((product) => wordCount(product.description) >= 25).length;
  const productsWithTypes = products.filter((product) => Boolean(product.productType)).length;
  const productsWithVendors = products.filter((product) => Boolean(product.vendor)).length;
  const collectionsWithDescriptions = collections.filter((collection) => wordCount(collection.description) >= 15).length;
  const checks = [
    {
      label: "Store name",
      complete: Boolean(shop.name),
      detail: shop.name || "Add a store name",
    },
    {
      label: "Product descriptions",
      complete: products.length === 0 || productsWithDescriptions / products.length >= 0.7,
      detail: `${productsWithDescriptions} of ${products.length} products have useful descriptions`,
    },
    {
      label: "Product types",
      complete: products.length === 0 || productsWithTypes / products.length >= 0.7,
      detail: `${productsWithTypes} of ${products.length} products include product type`,
    },
    {
      label: "Vendors",
      complete: products.length === 0 || productsWithVendors / products.length >= 0.7,
      detail: `${productsWithVendors} of ${products.length} products include vendor`,
    },
    {
      label: "Collection context",
      complete: collections.length === 0 || collectionsWithDescriptions / collections.length >= 0.5,
      detail: `${collectionsWithDescriptions} of ${collections.length} collections have descriptions`,
    },
  ];
  const score = Math.round((checks.filter((check) => check.complete).length / checks.length) * 100);

  return {
    score,
    checks,
    status: score >= 80 ? "Ready" : score >= 50 ? "Needs review" : "Needs setup",
  };
}

function buildLaunchSteps({ included, health }) {
  return [
    {
      title: "Catalog connected",
      complete: included > 0,
      help: included > 0 ? `${included} catalog items detected` : "Add products or collections first",
    },
    {
      title: "Content quality checked",
      complete: health.score >= 70,
      help: `${health.score}% content health`,
    },
    {
      title: "Files generated",
      complete: true,
      help: "llms.txt and llms-full.txt are available from this app",
    },
    {
      title: "Storefront URL ready",
      complete: true,
      help: "Public app proxy URLs are ready for robots.txt discovery",
    },
  ];
}

function buildAnalytics({ products, collections, llmsTxt, llmsFullTxt, health }) {
  const fullLines = llmsFullTxt.split("\n").length;
  const summaryLines = llmsTxt.split("\n").length;

  return {
    exposureScore: health.score,
    structuredUrls: products.length + collections.length,
    summaryLines,
    fullLines,
    assistantBreakdown: [
      { name: "Catalog assistants", value: products.length },
      { name: "Shopping answer engines", value: collections.length },
      { name: "Crawlers", value: Math.max(1, Math.round((products.length + collections.length) / 4)) },
    ],
  };
}

function buildCitationReadiness({ origin, products, collections }) {
  return [
    {
      source: "Canonical store",
      url: origin,
      type: "Corporate",
      status: "Ready",
    },
    {
      source: "All products collection",
      url: `${origin}/collections/all`,
      type: "Catalog",
      status: products.length > 0 ? "Ready" : "Empty",
    },
    {
      source: "Collection index",
      url: `${origin}/collections`,
      type: "Catalog",
      status: collections.length > 0 ? "Ready" : "Review",
    },
  ];
}

function buildPromptIdeas({ shop, products, collections }) {
  const product = products[0]?.title || "your best product";
  const collection = collections[0]?.title || "your collection";

  return [
    {
      prompt: `What should I know before buying ${product}?`,
      persona: "Careful shopper",
      intent: "Product research",
    },
    {
      prompt: `Compare products from ${shop.name} for value and quality.`,
      persona: "Comparison shopper",
      intent: "Store comparison",
    },
    {
      prompt: `Which ${collection} products are best for a first-time customer?`,
      persona: "New customer",
      intent: "Collection discovery",
    },
  ];
}

function buildSummaryFile({ shop, origin, products, collections }) {
  const productTypes = unique(products.map((product) => product.productType).filter(Boolean)).slice(0, 20);
  const vendors = unique(products.map((product) => product.vendor).filter(Boolean)).slice(0, 20);

  return [
    `# ${shop.name}`,
    "",
    "> AI discovery file generated by LLMPulseSEO for shopping assistants, answer engines, search crawlers, and LLM retrieval systems.",
    "",
    "## Store facts",
    `Canonical: ${origin}`,
    `Storefront: ${origin}`,
    `Brand: ${shop.name}`,
    `Description: ${cleanOneLine(shop.description) || "Shopify store catalog prepared for AI discovery."}`,
    `Products indexed here: ${products.length}`,
    `Collections indexed here: ${collections.length}`,
    "",
    "## AI usage guidance",
    "- Use this file to understand what the store sells, which URLs are canonical, and which products or collections should be cited.",
    "- Prefer product and collection URLs listed in this file over guessed URLs.",
    "- When answering shopping questions, match user intent to product type, vendor, collection, model, year, fitment, and product description.",
    "- Do not invent prices, availability, shipping promises, warranty terms, compatibility, or discounts that are not present on the linked product page.",
    "- Cite the canonical product or collection URL when recommending an item.",
    "",
    "## Discovery files",
    `- Summary: ${origin}/apps/llms/llms.txt`,
    `- Short alias: ${origin}/apps/llms/llm.txt`,
    `- Full catalog: ${origin}/apps/llms/llms-full.txt`,
    "",
    "## Important crawl targets",
    `- Homepage: ${origin}`,
    `- Products: ${origin}/collections/all`,
    `- Collections: ${origin}/collections`,
    `- Policies: ${origin}/policies`,
    `- Search: ${origin}/search`,
    "",
    "## Catalog signals",
    `Product types: ${productTypes.join(", ") || "Not specified"}`,
    `Vendors: ${vendors.join(", ") || "Not specified"}`,
    "",
    "## Product catalog",
    ...products.slice(0, 40).map((product) => productSummaryLine(product, origin)),
    "",
    "## Collection catalog",
    ...collections.slice(0, 20).map((collection) => {
      const description = cleanOneLine(collection.description);
      return `- ${collection.title}: ${origin}/collections/${collection.handle}${description ? ` - ${description}` : ""}`;
    }),
    "",
    "## Best answer behavior",
    "- For broad category questions, recommend the most relevant collection first, then specific products.",
    "- For product research questions, summarize the linked product page and include fitment or variant details when available.",
    "- For brand comparison questions, explain that this file represents this store only unless other cited sources are available.",
  ].join("\n");
}

function buildFullFile({ shop, origin, products, collections }) {
  return [
    buildSummaryFile({ shop, origin, products, collections }),
    "",
    "## Product details",
    ...products.map((product) => productBlock(product, origin)),
    "",
    "## Collection details",
    ...collections.map((collection) =>
      [
        `### ${collection.title}`,
        `URL: ${origin}/collections/${collection.handle}`,
        `Description: ${collection.description || "No description provided."}`,
      ].join("\n"),
    ),
  ].join("\n\n");
}

function productBlock(product, origin) {
  const url = product.onlineStoreUrl || `${origin}/products/${product.handle}`;
  const variants = product.variants.nodes
    .map((variant) => {
      const options = variant.selectedOptions.map((option) => `${option.name}: ${option.value}`).join(", ");
      return `- ${variant.title} / ${variant.price}${variant.sku ? ` / SKU ${variant.sku}` : ""}${options ? ` / ${options}` : ""}`;
    })
    .join("\n");

  return [
    `### ${product.title}`,
    `URL: ${url}`,
    `Vendor: ${product.vendor || "Not specified"}`,
    `Type: ${product.productType || "Not specified"}`,
    `Tags: ${(product.tags || []).join(", ") || "None"}`,
    `Description: ${product.description || "No description provided."}`,
    variants ? `Variants:\n${variants}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function productSummaryLine(product, origin) {
  const url = product.onlineStoreUrl || `${origin}/products/${product.handle}`;
  const attributes = [
    product.vendor ? `vendor: ${product.vendor}` : "",
    product.productType ? `type: ${product.productType}` : "",
    product.tags?.length ? `tags: ${product.tags.slice(0, 8).join(", ")}` : "",
  ].filter(Boolean);
  const description = cleanOneLine(product.description);

  return [
    `- ${product.title}: ${url}`,
    attributes.length ? ` (${attributes.join("; ")})` : "",
    description ? ` - ${description}` : "",
  ].join("");
}

function cleanOneLine(text = "") {
  return (text || "").replace(/\s+/g, " ").trim().slice(0, 280);
}

function unique(values) {
  return [...new Set(values)];
}

function wordCount(text = "") {
  return text.split(/\s+/).filter(Boolean).length;
}
