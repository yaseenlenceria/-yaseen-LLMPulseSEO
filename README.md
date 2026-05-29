# LLMPulseSEO

Embedded Shopify app for generating merchant-controlled `llms.txt` discovery files.

## What It Does

LLMPulseSEO reads a Shopify catalog and creates structured text files that AI assistants can parse more reliably than raw storefront HTML:

- `llms.txt` summary file
- `llms-full.txt` detailed catalog file
- Product and collection summaries
- Brand and business DNA context
- Content inclusion dashboard
- Content health checklist
- Citation readiness sources
- Prompt and persona ideas
- Schema-ready business facts

The app generates deterministic files from Shopify Admin API data.

## Preview Endpoints

After installation, preview generated files from the app domain:

```text
/llms.txt?shop=store.myshopify.com
/llms-full.txt?shop=store.myshopify.com
```

For production storefront URLs, configure an app proxy or theme route for:

```text
/apps/llms/llms.txt
/apps/llms/llms-full.txt
```

## Local Setup

```shell
cd llm-pulse-seo
npm install
copy .env.example .env
npm run setup
npm run dev
```

Set `SHOPIFY_API_SECRET` in `.env` from the Shopify Partner Dashboard.

## Shopify Configuration

Client ID:

```text
b190c0ce455219cacad86f3f582ab096
```

Configured scopes:

```text
read_products,write_products,read_content,write_content,read_themes,write_themes,read_analytics
```

## Production Notes

- Host the web app on a stable production URL before sharing with merchants.
- Use an app proxy or theme route for permanent `/apps/llms/llms.txt` and `/apps/llms/llms-full.txt` URLs.
- Keep Shopify app secrets in environment variables or hosting secrets only.
- Rotate any automation token or Storefront private token pasted outside Shopify.
