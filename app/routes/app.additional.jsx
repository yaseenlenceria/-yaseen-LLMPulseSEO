import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  return {
    shop: session.shop,
    plan: "Development Plan",
  };
};

export default function SettingsPage() {
  const { shop, plan } = useLoaderData();

  const settings = [
    {
      id: "auto-llms",
      title: "Automatic AI Discovery File Sync",
      description: "Automatically keep your AI Discovery index updated when products, pages, or collections change.",
      icon: "⚡",
      color: "#003ec7",
    },
    {
      id: "robots-update",
      title: "Auto-Link Discovery Feeds",
      description: "Add AI discovery pathways to your storefront directory so search engines like ChatGPT and Gemini automatically find it.",
      icon: "🔗",
      color: "#006970",
    },
    {
      id: "schema-monitor",
      title: "Store Profile Health Monitor",
      description: "Actively monitor your business profile and search tags to ensure AI crawlers fetch error-free product catalog details.",
      icon: "🛡️",
      color: "#3737c5",
    },
    {
      id: "bulk-optimize",
      title: "AI-Friendly Content Audits",
      description: "Automatically flag product pages with short descriptions or missing category tags to optimize search assistant visibility.",
      icon: "✨",
      color: "#003ec7",
    },
  ];

  const launchChecklist = [
    { text: "Verify AI Discovery catalog feed is active and accessible", done: true },
    { text: "Confirm AI crawler directives are linked in store path", done: true },
    { text: "Run store-wide Product Scan to check search engine compatibility", done: true },
    { text: "Audit image description templates for alternative text quality", done: false },
    { text: "Connect and publish your business profile", done: true },
    { text: "Verify that no dead navigation paths block AI agents", done: false },
  ];

  return (
    <s-page heading="Settings">
      <div className="llm-page llm-fade-in">

        {/* Store Information */}
        <s-section heading="Store Information">
          <div className="llm-card">
            <div className="llm-card-head">
              <h2>Store Info & Plan</h2>
              <p>Your connected storefront details and active subscription level.</p>
            </div>
            <div className="llm-metric-grid">
              <div className="llm-metric">
                <div className="llm-metric-label">Store Domain</div>
                <div className="llm-metric-value" style={{ fontSize: "15px", color: "var(--llm-on-surface)" }}>{shop}</div>
              </div>
              <div className="llm-metric">
                <div className="llm-metric-label">Current Plan</div>
                <div style={{ marginTop: "6px" }}>
                  <span className="llm-badge llm-badge-primary">{plan}</span>
                </div>
              </div>
              <div className="llm-metric">
                <div className="llm-metric-label">App Version</div>
                <div className="llm-metric-value" style={{ fontSize: "15px", color: "var(--llm-on-surface)" }}>1.0.0</div>
              </div>
            </div>
          </div>
        </s-section>

        {/* Automation Settings */}
        <s-section heading="Automation Settings">
          <div className="llm-card">
            <div className="llm-card-head">
              <h2>AI Visibility Automations</h2>
              <p>Toggle automatic optimization features to keep your store aligned with AI crawlers.</p>
            </div>
            <div className="llm-check-list">
              {settings.map((setting) => (
                <div 
                  key={setting.id} 
                  className="llm-check-row" 
                  style={{ opacity: 0.8 }}
                >
                  <div style={{ display: "flex", gap: "14px", alignItems: "flex-start", flex: 1 }}>
                    <div style={{
                      width: "48px",
                      height: "48px",
                      borderRadius: "12px",
                      background: `${setting.color}15`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "22px",
                      flexShrink: 0,
                    }}>
                      {setting.icon}
                    </div>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <strong style={{ fontSize: "13.5px" }}>{setting.title}</strong>
                        <span className="llm-badge llm-badge-warning" style={{ fontSize: "10px", padding: "1px 6px" }}>Coming Soon</span>
                      </div>
                      <p style={{ marginTop: "3px", fontSize: "12px", color: "var(--llm-on-surface-variant)" }}>{setting.description}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </s-section>

        {/* Current configuration */}
        <s-section heading="Current Configuration">
          <div className="llm-card" style={{ padding: 0, overflow: "hidden" }}>
            <div className="llm-card-head" style={{ padding: "20px 20px 0 20px" }}>
              <h2>Active Storefront Directives</h2>
              <p>Preview template representing search engine instructions for your store.</p>
            </div>
            <div style={{ padding: "20px" }}>
              <div className="llm-dark" style={{ position: "relative" }}>
                <span className="llm-badge" style={{
                  position: "absolute",
                  top: "16px",
                  right: "16px",
                  background: "rgba(100, 116, 139, 0.15)",
                  color: "#94a3b8",
                  border: "none",
                }}>
                  TEMPLATE PREVIEW
                </span>
                <pre>{`User-agent: *
Disallow: /admin/
Disallow: /cart/
Disallow: /checkout/

# AI Training Specifics
User-agent: GPTBot
Allow: /products/
Allow: /collections/
Disallow: /search/

# LLMPulseSEO Autonomous Directives
Sitemap: https://${shop}/apps/llms/llms.txt`}</pre>
                <div className="llm-card-footer" style={{ borderColor: "rgba(255,255,255,0.1)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span style={{
                      width: "8px",
                      height: "8px",
                      borderRadius: "50%",
                      background: "#94a3b8",
                      boxShadow: "0 0 8px rgba(148, 163, 184, 0.5)",
                    }} />
                    <span style={{
                      fontFamily: "var(--llm-font-mono)",
                      fontSize: "13px",
                      color: "#94a3b8",
                    }}>
                      AI Indexing Pathway Directives
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </s-section>

        {/* Launch Checklist */}
        <s-section heading="Launch Checklist">
          <div className="llm-card">
            <div className="llm-card-head">
              <h2>AI Search Readiness Checklist</h2>
              <p>Step-by-step checklist to ensure your store is completely optimized for visual and text AI assistants.</p>
            </div>
            <div className="llm-check-list">
              {launchChecklist.map((item, idx) => (
                <div
                  key={idx}
                  className={`llm-check-row ${item.done ? "llm-pill-done" : ""}`}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "12px", flex: 1 }}>
                    <span style={{
                      color: item.done ? "#10b981" : "#c3c5d9",
                      fontSize: "16px",
                      fontWeight: 700,
                      flexShrink: 0,
                    }}>
                      {item.done ? "✓" : "○"}
                    </span>
                    <strong style={{ fontSize: "13px", color: item.done ? "var(--llm-on-surface)" : "var(--llm-on-surface-variant)" }}>{item.text}</strong>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </s-section>

      </div>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};

