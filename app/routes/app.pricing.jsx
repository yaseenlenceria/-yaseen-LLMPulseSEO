import { boundary } from "@shopify/shopify-app-react-router/server";

export const loader = async () => {
  return {};
};

const PLANS = [
  {
    name: "Starter",
    price: "$9",
    period: "/month",
    description: "Perfect for small stores getting started with AI discovery.",
    features: [
      "Up to 50 products scanned",
      "Basic llms.txt generation",
      "robots.txt auto-update",
      "Content health check",
      "Email support",
    ],
    cta: "Start Free Trial",
    featured: false,
    color: "#003ec7",
  },
  {
    name: "Growth",
    price: "$29",
    period: "/month",
    description: "For growing stores that want full AI visibility control.",
    features: [
      "Up to 500 products scanned",
      "Advanced llms.txt + llms-full.txt",
      "robots.txt auto-update",
      "JSON-LD schema checker",
      "Bulk fix queue",
      "AI recommendations",
      "Priority support",
    ],
    cta: "Start Free Trial",
    featured: true,
    color: "#3737c5",
  },
  {
    name: "Agency",
    price: "$79",
    period: "/month",
    description: "For agencies managing multiple Shopify stores.",
    features: [
      "Unlimited products scanned",
      "All file generation features",
      "Multi-store management",
      "JSON-LD schema checker",
      "Bulk fix queue",
      "AI recommendations",
      "White-label reports",
      "API access",
      "Dedicated support",
    ],
    cta: "Contact Sales",
    featured: false,
    color: "#006970",
  },
];

export default function PricingPage() {
  return (
    <s-page heading="Pricing Plans">
      <s-section>
        <div style={{ textAlign: "center", marginBottom: "40px" }}>
          <h2 style={{ fontSize: "32px", fontWeight: 600, color: "#131b2e", margin: "0 0 12px 0" }}>
            Choose Your Plan
          </h2>
          <p style={{ fontSize: "18px", color: "#434656", margin: 0, maxWidth: "600px", marginLeft: "auto", marginRight: "auto", lineHeight: 1.6 }}>
            Start with a free trial. Upgrade when you&apos;re ready to unlock the full power of LLMPulseSEO for your store.
          </p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "24px" }}>
          {PLANS.map((plan) => (
            <div key={plan.name} style={{
              background: plan.featured ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.7)",
              backdropFilter: "blur(12px)",
              border: plan.featured ? `2px solid ${plan.color}` : "1px solid #E2E8F0",
              borderRadius: "16px",
              padding: "32px 24px",
              display: "flex",
              flexDirection: "column",
              position: "relative",
              boxShadow: plan.featured ? `0 0 30px rgba(0,62,199,0.12)` : "none",
            }}>
              {plan.featured && (
                <div style={{
                  position: "absolute",
                  top: "-12px",
                  left: "50%",
                  transform: "translateX(-50%)",
                  background: `linear-gradient(135deg, #003ec7, #3737c5)`,
                  color: "white",
                  fontSize: "11px",
                  fontWeight: 700,
                  letterSpacing: "0.1em",
                  padding: "4px 16px",
                  borderRadius: "9999px",
                }}>
                  POPULAR
                </div>
              )}

              <div style={{ marginBottom: "8px" }}>
                <span style={{ fontSize: "18px", fontWeight: 700, color: "#131b2e" }}>{plan.name}</span>
              </div>

              <div style={{ display: "flex", alignItems: "baseline", gap: "4px", marginBottom: "4px" }}>
                <span style={{ fontSize: "48px", fontWeight: 800, color: plan.color, lineHeight: 1 }}>{plan.price}</span>
                <span style={{ fontSize: "14px", color: "#434656" }}>{plan.period}</span>
              </div>

              <p style={{ fontSize: "14px", color: "#434656", lineHeight: 1.5, margin: "0 0 24px 0" }}>
                {plan.description}
              </p>

              <div style={{ flex: 1, marginBottom: "24px" }}>
                {plan.features.map((feature) => (
                  <div key={feature} style={{ display: "flex", alignItems: "flex-start", gap: "8px", padding: "8px 0", fontSize: "14px", color: "#434656" }}>
                    <span style={{ color: "#10b981", fontWeight: 700, flexShrink: 0 }}>&#x2713;</span>
                    {feature}
                  </div>
                ))}
              </div>

              <button
                style={{
                  width: "100%",
                  padding: "14px",
                  borderRadius: "12px",
                  border: "none",
                  fontWeight: 700,
                  fontSize: "14px",
                  cursor: "pointer",
                  transition: "all 0.2s ease",
                  ...(plan.featured
                    ? { background: `linear-gradient(135deg, #003ec7, #3737c5)`, color: "white", boxShadow: "0 4px 14px rgba(0,62,199,0.39)" }
                    : { background: "white", color: plan.color, border: `2px solid ${plan.color}` }),
                }}
              >
                {plan.cta}
              </button>
            </div>
          ))}
        </div>
      </s-section>

      {/* FAQ Section */}
      <s-section heading="Frequently Asked Questions">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "24px" }}>
          {[
            {
              q: "Is there a free trial?",
              a: "Yes, every plan comes with a 7-day free trial. No credit card required to start.",
            },
            {
              q: "Can I change plans later?",
              a: "You can upgrade or downgrade your plan at any time from the Settings page.",
            },
            {
              q: "How does llms.txt help my store?",
              a: "LLMs.txt is a discovery file that tells AI assistants like ChatGPT, Gemini, and Perplexity about your products and collections. It helps AI systems cite your store in their answers.",
            },
            {
              q: "Do I need technical knowledge?",
              a: "No. LLMPulseSEO handles everything automatically. Just install, scan, and your store is AI-discoverable.",
            },
          ].map((faq) => (
            <div key={faq.q} style={{
              background: "rgba(255,255,255,0.7)",
              backdropFilter: "blur(12px)",
              border: "1px solid #E2E8F0",
              borderRadius: "12px",
              padding: "20px",
            }}>
              <h4 style={{ fontWeight: 600, fontSize: "16px", color: "#131b2e", margin: "0 0 8px 0" }}>{faq.q}</h4>
              <p style={{ fontSize: "14px", color: "#434656", lineHeight: 1.5, margin: 0 }}>{faq.a}</p>
            </div>
          ))}
        </div>
      </s-section>

      {/* Billing Note */}
      <s-section>
        <div style={{
          background: "rgba(0,62,199,0.05)",
          border: "1px solid rgba(0,62,199,0.15)",
          borderRadius: "12px",
          padding: "20px",
          textAlign: "center",
        }}>
          <div style={{ fontSize: "14px", color: "#434656", lineHeight: 1.6 }}>
            <strong>Note:</strong> Billing is not active yet. These plans show the pricing structure that will be available when LLMPulseSEO launches on the Shopify App Store. You can use all features for free during development.
          </div>
        </div>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
