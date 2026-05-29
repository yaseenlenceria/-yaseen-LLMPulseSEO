const API_VERSION = "2026-04";
const LLMPULSESEO_MARKER = "<!-- LLMPulseSEO Schema -->";

export async function scanThemeSchemas(session) {
  const shop = session.shop;
  const headers = {
    "X-Shopify-Access-Token": session.accessToken,
    "Content-Type": "application/json",
  };

  // Get main theme
  const themesResponse = await fetch(
    `https://${shop}/admin/api/${API_VERSION}/themes.json`,
    { headers },
  );
  const themesPayload = await safeJson(themesResponse);

  if (!themesResponse.ok) {
    throw new Error(themesPayload.errors || "Unable to load themes");
  }

  const mainTheme = themesPayload.themes.find((t) => t.role === "main");
  if (!mainTheme) {
    throw new Error("No published theme found");
  }

  const assetUrl = `https://${shop}/admin/api/${API_VERSION}/themes/${mainTheme.id}/assets.json`;

  // List all liquid files from key directories
  const directories = ["layout/", "templates/", "sections/", "snippets/"];
  const allFiles = [];

  for (const dir of directories) {
    const listResponse = await fetch(`${assetUrl}?asset[key]=${dir}`, {
      headers,
    });
    const listPayload = await safeJson(listResponse);

    if (listResponse.ok && Array.isArray(listPayload.assets)) {
      for (const asset of listPayload.assets) {
        if (asset.key && asset.key.endsWith(".liquid")) {
          allFiles.push(asset.key);
        }
      }
    }
  }

  // Read each file and scan for JSON-LD
  const schemas = [];

  for (const fileKey of allFiles) {
    const fileResponse = await fetch(
      `${assetUrl}?asset[key]=${encodeURIComponent(fileKey)}`,
      { headers },
    );
    const filePayload = await safeJson(fileResponse);

    if (!fileResponse.ok || !filePayload.asset?.value) {
      continue;
    }

    const content = filePayload.asset.value;
    const found = extractJsonLdBlocks(content, fileKey);
    schemas.push(...found);
  }

  // Compute stats
  const total = schemas.length;
  const llmPulseCount = schemas.filter((s) => s.isLLMPulseSEO).length;
  const otherCount = total - llmPulseCount;
  const typeMap = {};
  for (const s of schemas) {
    const key = s.schemaType || "Unknown";
    typeMap[key] = (typeMap[key] || 0) + 1;
  }
  const duplicateCount = Object.values(typeMap).filter((c) => c > 1).length;

  return {
    theme: mainTheme,
    schemas,
    stats: { total, llmPulseCount, otherCount, duplicateCount, typeMap },
  };
}

function extractJsonLdBlocks(content, file) {
  const results = [];
  // Match <script type="application/ld+json">...</script> blocks
  const regex =
    /<script\s+type=["']application\/ld\+json["']\s*>([\s\S]*?)<\/script>/gi;
  let match;

  while ((match = regex.exec(content)) !== null) {
    const raw = match[1].trim();
    const isLLMPulseSEO = content.indexOf(LLMPULSESEO_MARKER) !== -1;
    let schemaType = "Unknown";

    try {
      const parsed = JSON.parse(raw);
      schemaType = extractType(parsed);
    } catch {
      // invalid JSON, keep "Unknown"
    }

    results.push({
      file,
      schemaType,
      schemaContent: raw,
      size: raw.length,
      isLLMPulseSEO,
    });
  }

  return results;
}

function extractType(obj) {
  if (!obj || typeof obj !== "object") return "Unknown";
  if (obj["@type"]) {
    return Array.isArray(obj["@type"]) ? obj["@type"].join(", ") : obj["@type"];
  }
  if (obj["@graph"] && Array.isArray(obj["@graph"])) {
    return obj["@graph"]
      .map((item) => item["@type"] || "Unknown")
      .join(", ");
  }
  return "Unknown";
}

export async function removeSchemaFromTheme(session, file, schemaIndex) {
  const shop = session.shop;
  const headers = {
    "X-Shopify-Access-Token": session.accessToken,
    "Content-Type": "application/json",
  };

  const themesResponse = await fetch(
    `https://${shop}/admin/api/${API_VERSION}/themes.json`,
    { headers },
  );
  const themesPayload = await safeJson(themesResponse);
  const mainTheme = themesPayload.themes.find((t) => t.role === "main");
  if (!mainTheme) throw new Error("No published theme found");

  const assetUrl = `https://${shop}/admin/api/${API_VERSION}/themes/${mainTheme.id}/assets.json`;

  // Read current file content
  const fileResponse = await fetch(
    `${assetUrl}?asset[key]=${encodeURIComponent(file)}`,
    { headers },
  );
  const filePayload = await safeJson(fileResponse);
  if (!fileResponse.ok || !filePayload.asset?.value) {
    throw new Error(`Unable to read ${file}`);
  }

  const content = filePayload.asset.value;
  const regex =
    /<script\s+type=["']application\/ld\+json["']\s*>[\s\S]*?<\/script>/gi;
  const blocks = [...content.matchAll(regex)];

  if (schemaIndex < 0 || schemaIndex >= blocks.length) {
    throw new Error("Schema index out of range");
  }

  const blockToRemove = blocks[schemaIndex][0];
  const updatedContent = content.replace(blockToRemove, "").trim();

  const updateResponse = await fetch(assetUrl, {
    method: "PUT",
    headers,
    body: JSON.stringify({
      asset: { key: file, value: updatedContent },
    }),
  });

  const updatePayload = await safeJson(updateResponse);
  if (!updateResponse.ok) {
    throw new Error(updatePayload.errors || `Unable to update ${file}`);
  }

  return { ok: true, removed: true, file, schemaIndex };
}

export async function injectSchema(session, schemaJson) {
  const shop = session.shop;
  const headers = {
    "X-Shopify-Access-Token": session.accessToken,
    "Content-Type": "application/json",
  };

  const themesResponse = await fetch(
    `https://${shop}/admin/api/${API_VERSION}/themes.json`,
    { headers },
  );
  const themesPayload = await safeJson(themesResponse);
  const mainTheme = themesPayload.themes.find((t) => t.role === "main");
  if (!mainTheme) throw new Error("No published theme found");

  const assetUrl = `https://${shop}/admin/api/${API_VERSION}/themes/${mainTheme.id}/assets.json`;

  // Read theme.liquid
  const key = "layout/theme.liquid";
  const fileResponse = await fetch(
    `${assetUrl}?asset[key]=${encodeURIComponent(key)}`,
    { headers },
  );
  const filePayload = await safeJson(fileResponse);
  if (!fileResponse.ok || !filePayload.asset?.value) {
    throw new Error("Unable to read theme.liquid");
  }

  const content = filePayload.asset.value;
  const schemaBlock = [
    "",
    `  ${LLMPULSESEO_MARKER}`,
    '  <script type="application/ld+json">',
    `    ${schemaJson}`,
    "  </script>",
    `  <!-- End LLMPulseSEO Schema -->`,
    "",
  ].join("\n");

  // Check if already injected
  if (content.includes(LLMPULSESEO_MARKER)) {
    return { ok: true, status: "already-injected", theme: mainTheme.name };
  }

  // Insert before </head>
  const updatedContent = content.replace("</head>", `${schemaBlock}\n</head>`);

  const updateResponse = await fetch(assetUrl, {
    method: "PUT",
    headers,
    body: JSON.stringify({
      asset: { key, value: updatedContent },
    }),
  });

  const updatePayload = await safeJson(updateResponse);
  if (!updateResponse.ok) {
    throw new Error(updatePayload.errors || "Unable to update theme.liquid");
  }

  return { ok: true, status: "injected", theme: mainTheme.name };
}

async function safeJson(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}
