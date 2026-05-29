const API_VERSION = "2026-04";

export async function installRobotsPointer({ session, proxyUrl }) {
  const shop = session.shop;
  const headers = {
    "X-Shopify-Access-Token": session.accessToken,
    "Content-Type": "application/json",
  };

  const themesResponse = await fetch(`https://${shop}/admin/api/${API_VERSION}/themes.json`, {
    headers,
  });
  const themesPayload = await themesResponse.json();

  if (!themesResponse.ok) {
    throw new Error(themesPayload.errors || "Unable to load themes");
  }

  const mainTheme = themesPayload.themes.find((theme) => theme.role === "main");

  if (!mainTheme) {
    throw new Error("No published theme found");
  }

  const assetUrl = `https://${shop}/admin/api/${API_VERSION}/themes/${mainTheme.id}/assets.json`;
  const key = "templates/robots.txt.liquid";
  const currentResponse = await fetch(`${assetUrl}?asset[key]=${encodeURIComponent(key)}`, {
    headers,
  });
  const currentPayload = await readJson(currentResponse);
  const currentValue = currentPayload.asset?.value || defaultRobotsTemplate();
  const marker = "# LLMPulseSEO AI discovery";
  const addition = [
    marker,
    `# llm.txt: ${proxyUrl}/llm.txt`,
    `# llms.txt: ${proxyUrl}/llms.txt`,
    `# llms-full.txt: ${proxyUrl}/llms-full.txt`,
  ].join("\n");

  if (currentValue.includes(marker)) {
    return { status: "already-installed", theme: mainTheme.name };
  }

  const updatedValue = `${currentValue.trim()}\n\n${addition}\n`;
  const updateResponse = await fetch(assetUrl, {
    method: "PUT",
    headers,
    body: JSON.stringify({
      asset: {
        key,
        value: updatedValue,
      },
    }),
  });
  const updatePayload = await readJson(updateResponse);

  if (!updateResponse.ok) {
    throw new Error(updatePayload.errors || "Unable to update robots.txt");
  }

  return { status: "installed", theme: mainTheme.name };
}

async function readJson(response) {
  const text = await response.text();

  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function defaultRobotsTemplate() {
  return [
    "{% for group in robots.default_groups %}",
    "  {{- group.user_agent -}}",
    "",
    "  {% for rule in group.rules %}",
    "    {{- rule -}}",
    "  {% endfor %}",
    "",
    "  {%- if group.sitemap != blank -%}",
    "    {{ group.sitemap }}",
    "  {%- endif -%}",
    "{% endfor %}",
  ].join("\n");
}
