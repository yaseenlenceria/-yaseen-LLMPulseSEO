import { useEffect, useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { loadLlmsSnapshot } from "../lib/llms.server";
import { installRobotsPointer } from "../lib/robots.server";
import { getStoreSettings, saveStoreSettings } from "../lib/settings.server";

/* eslint-disable react/prop-types */

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const snapshot = await loadLlmsSnapshot(admin, 50);
  const settings = getStoreSettings(session.shop);
  return { snapshot, settings };
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");
  const snapshot = await loadLlmsSnapshot(admin, 50);

  if (intent === "install-robots") {
    const proxyUrl = `${snapshot.origin}/apps/llms`;
    const robots = await installRobotsPointer({ session, proxyUrl });
    const settings = getStoreSettings(session.shop);
    settings.robotsInstalled = true;
    saveStoreSettings(session.shop, settings);
    return {
      ok: true,
      message: "Discovery feeds auto-linked in store directives successfully.",
      snapshot,
      robots,
      settings,
    };
  }

  if (intent === "sync") {
    return {
      ok: true,
      message: "Discovery files regenerated from your Shopify catalog successfully.",
      snapshot,
    };
  }

  return { ok: true, message: "Done.", snapshot };
};

export default function LlmsPage() {
  const initialData = useLoaderData();
  const fetcher = useFetcher();
  const shopify = useAppBridge();

  const [activeTab, setActiveTab] = useState("llms.txt");
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [modalMessage, setModalMessage] = useState("");
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);

  const snapshot = fetcher.data?.snapshot || initialData.snapshot;
  const settings = fetcher.data?.settings || initialData.settings || {};
  const isWorking = ["loading", "submitting"].includes(fetcher.state);

  const getActiveFileContent = () => {
    switch (activeTab) {
      case "llm.txt":
        return snapshot.files.llmsTxt;
      case "llms-full.txt":
        return snapshot.files.llmsFullTxt;
      case "llms.txt":
      default:
        return snapshot.files.llmsTxt;
    }
  };

  const activeContent = getActiveFileContent();

  useEffect(() => {
    if (fetcher.data?.message) {
      if (fetcher.data.ok) {
        setModalMessage(fetcher.data.message);
        setShowSuccessModal(true);
      } else {
        shopify.toast.show(fetcher.data.message);
      }
    }
  }, [fetcher.data, shopify]);

  const syncFiles = () => fetcher.submit({ intent: "sync" }, { method: "POST" });
  const installRobots = () => fetcher.submit({ intent: "install-robots" }, { method: "POST" });
  
  const copyText = async (text, label) => {
    await navigator.clipboard.writeText(text);
    shopify.toast.show(`${label} copied to clipboard`);
  };

  const isRobotsInstalled = Boolean(
    settings.robotsInstalled || 
    fetcher.data?.robots || 
    snapshot.health.checks?.find(c => c.label === "robots.txt" && c.complete)
  );

  return (
    <s-page heading="LLM Indexing">
      <div className="llm-page llm-fade-in">
        
        {/* Status Cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "20px", marginBottom: "20px" }}>
          
          {/* Card 1: Products Indexed */}
          <div className="llm-card" style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", minHeight: "180px" }}>
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span className="llm-badge llm-badge-success" style={{ fontWeight: 600 }}>Active</span>
                <span style={{ fontSize: "24px" }}>📦</span>
              </div>
              <div style={{ marginTop: "16px" }}>
                <div style={{ fontSize: "36px", fontWeight: "800", color: "var(--llm-primary)", lineHeight: 1.1 }}>
                  {snapshot.counts.products}
                </div>
                <div style={{ fontSize: "14px", fontWeight: "700", marginTop: "4px" }}>Products Indexed</div>
                <p style={{ fontSize: "12px", color: "var(--llm-on-surface-variant)", margin: "4px 0 0" }}>
                  Your product details are structured and optimized for semantic AI search crawlers.
                </p>
              </div>
            </div>
            <div style={{ marginTop: "16px", borderTop: "1px solid var(--llm-card-border)", paddingTop: "12px", display: "flex", justifyContent: "flex-end" }}>
              <button 
                type="button" 
                className="llm-btn llm-btn-outline llm-btn-sm" 
                onClick={syncFiles} 
                disabled={isWorking}
              >
                {isWorking ? "Updating..." : "Regenerate Feeds"}
              </button>
            </div>
          </div>

          {/* Card 2: AI Search Connection */}
          <div className="llm-card" style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", minHeight: "180px" }}>
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span className={`llm-badge ${isRobotsInstalled ? "llm-badge-success" : "llm-badge-warning"}`} style={{ fontWeight: 600 }}>
                  {isRobotsInstalled ? "Connected" : "Pending Connection"}
                </span>
                <span style={{ fontSize: "24px" }}>🤖</span>
              </div>
              <div style={{ marginTop: "16px" }}>
                <div style={{ fontSize: "36px", fontWeight: "800", color: isRobotsInstalled ? "var(--llm-primary)" : "#b45309", lineHeight: 1.1 }}>
                  {isRobotsInstalled ? "Linked" : "Not Linked"}
                </div>
                <div style={{ fontSize: "14px", fontWeight: "700", marginTop: "4px" }}>AI Search Link</div>
                <p style={{ fontSize: "12px", color: "var(--llm-on-surface-variant)", margin: "4px 0 0" }}>
                  Tells ChatGPT, Gemini, and Claude where to find your optimized inventory catalog.
                </p>
              </div>
            </div>
            <div style={{ marginTop: "16px", borderTop: "1px solid var(--llm-card-border)", paddingTop: "12px", display: "flex", justifyContent: "flex-end" }}>
              {isRobotsInstalled ? (
                <button 
                  type="button" 
                  className="llm-btn llm-btn-disabled llm-btn-sm" 
                  disabled
                >
                  ✓ Linked to Search Engines
                </button>
              ) : (
                <button 
                  type="button" 
                  className="llm-btn llm-btn-primary llm-btn-sm" 
                  onClick={installRobots} 
                  disabled={isWorking}
                >
                  {isWorking ? "Linking..." : "Link to Search Engines"}
                </button>
              )}
            </div>
          </div>

        </div>

        {/* Indexing Feeds URLs */}
        <div className="llm-card">
          <div className="llm-card-head">
            <h2>Search Engine Indexing Feeds</h2>
            <p>Direct URLs generated for AI search bots to scan your store content.</p>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            
            {/* Feed Row 1: Summary Feed */}
            <div style={{ 
              display: "flex", 
              alignItems: "center", 
              justifyContent: "space-between", 
              background: "var(--llm-surface)", 
              padding: "10px 14px", 
              borderRadius: "8px", 
              border: "1px solid var(--llm-card-border)",
              gap: "12px",
              flexWrap: "wrap"
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", flex: 1, minWidth: "250px" }}>
                <span className="llm-badge" style={{ background: "rgba(0,62,199,0.08)", color: "var(--llm-primary)", fontWeight: "600", fontSize: "11px" }}>
                  Summary Feed
                </span>
                <code style={{ fontSize: "12px", color: "var(--llm-outline)", overflowWrap: "anywhere" }}>
                  {snapshot.files.storefrontSummaryUrl}
                </code>
              </div>
              <button 
                type="button"
                className="llm-btn llm-btn-outline llm-btn-sm"
                onClick={() => copyText(snapshot.files.storefrontSummaryUrl, "Summary Feed URL")}
              >
                Copy Link
              </button>
            </div>

            {/* Feed Row 2: Full Catalog Feed */}
            <div style={{ 
              display: "flex", 
              alignItems: "center", 
              justifyContent: "space-between", 
              background: "var(--llm-surface)", 
              padding: "10px 14px", 
              borderRadius: "8px", 
              border: "1px solid var(--llm-card-border)",
              gap: "12px",
              flexWrap: "wrap"
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", flex: 1, minWidth: "250px" }}>
                <span className="llm-badge" style={{ background: "rgba(0,62,199,0.08)", color: "var(--llm-primary)", fontWeight: "600", fontSize: "11px" }}>
                  Full Catalog
                </span>
                <code style={{ fontSize: "12px", color: "var(--llm-outline)", overflowWrap: "anywhere" }}>
                  {snapshot.files.storefrontFullUrl}
                </code>
              </div>
              <button 
                type="button"
                className="llm-btn llm-btn-outline llm-btn-sm"
                onClick={() => copyText(snapshot.files.storefrontFullUrl, "Full Catalog URL")}
              >
                Copy Link
              </button>
            </div>

            {/* Feed Row 3: Developer Route */}
            <div style={{ 
              display: "flex", 
              alignItems: "center", 
              justifyContent: "space-between", 
              background: "var(--llm-surface)", 
              padding: "10px 14px", 
              borderRadius: "8px", 
              border: "1px solid var(--llm-card-border)",
              gap: "12px",
              flexWrap: "wrap"
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", flex: 1, minWidth: "250px" }}>
                <span className="llm-badge" style={{ background: "rgba(0,62,199,0.08)", color: "var(--llm-primary)", fontWeight: "600", fontSize: "11px" }}>
                  Developer Route
                </span>
                <code style={{ fontSize: "12px", color: "var(--llm-outline)", overflowWrap: "anywhere" }}>
                  {snapshot.files.storefrontLegacyUrl}
                </code>
              </div>
              <button 
                type="button"
                className="llm-btn llm-btn-outline llm-btn-sm"
                onClick={() => copyText(snapshot.files.storefrontLegacyUrl, "Developer Route URL")}
              >
                Copy Link
              </button>
            </div>

          </div>
        </div>

        {/* Collapsible details section for code views and sitemap directives */}
        <div className="llm-accordion">
          <button 
            type="button"
            className="llm-accordion-trigger" 
            onClick={() => setIsAdvancedOpen(!isAdvancedOpen)}
            style={{ border: "none" }}
          >
            <span>Developer Tools</span>
            <span style={{ 
              transform: isAdvancedOpen ? "rotate(180deg)" : "rotate(0deg)", 
              transition: "transform 0.2s ease",
              fontSize: "14px"
            }}>
              ▼
            </span>
          </button>

          {isAdvancedOpen && (
            <div className="llm-accordion-content" style={{ animation: "logFadeIn 0.25s ease-out", display: "flex", flexDirection: "column", gap: "16px" }}>
              
              {/* Sitemap instructions */}
              <div className="llm-dark" style={{ background: "#0b0f19", border: "1px solid #1e293b", padding: "14px", borderRadius: "6px" }}>
                <div style={{ fontSize: "12px", fontWeight: "700", color: "#e2e8f0", marginBottom: "8px" }}>Robots Directives Pointer</div>
                <pre style={{ fontSize: "11px", color: "#94a3b8", lineHeight: "1.5", margin: 0 }}>
                  {`# LLMPulseSEO AI discovery
# llm.txt: ${snapshot.origin}/apps/llms/llm.txt
# llms.txt: ${snapshot.origin}/apps/llms/llms.txt
# llms-full.txt: ${snapshot.origin}/apps/llms/llms-full.txt`}
                </pre>
              </div>

              {/* Code Preview Terminal */}
              <div className="llm-terminal">
                <div className="llm-terminal-header">
                  <div className="llm-terminal-dots">
                    <span className="llm-terminal-dot red" />
                    <span className="llm-terminal-dot yellow" />
                    <span className="llm-terminal-dot green" />
                  </div>
                  <span className="llm-terminal-title">feeds_previewer.txt</span>
                  <button 
                    type="button"
                    className="llm-btn llm-btn-outline llm-btn-sm" 
                    onClick={() => copyText(activeContent, activeTab)}
                    style={{ background: "#1e293b", color: "#e2e8f0", border: "1px solid #334155" }}
                  >
                    Copy Raw Content
                  </button>
                </div>
                
                <div className="llm-terminal-tabs">
                  {["llms.txt", "llms-full.txt", "llm.txt"].map(tab => (
                    <button
                      key={tab}
                      type="button"
                      className={`llm-terminal-tab ${activeTab === tab ? "active" : ""}`}
                      onClick={() => setActiveTab(tab)}
                    >
                      {tab}
                    </button>
                  ))}
                </div>

                <div className="llm-terminal-body">
                  <pre>
                    {activeTab === "llms-full.txt" 
                      ? `${activeContent.slice(0, 4800)}\n\n# ... [Catalogue content truncated for preview speed. Full file has ${activeContent.split("\n").length} lines] ...`
                      : activeContent
                    }
                  </pre>
                </div>
              </div>

            </div>
          )}
        </div>

      </div>

      {/* Celebration success modal */}
      {showSuccessModal && (
        <div className="llm-modal-overlay">
          <div className="llm-modal-card">
            <div className="llm-success-badge">✔️</div>
            <h3 className="llm-modal-title">Action Completed! 🎉</h3>
            <p className="llm-modal-desc">{modalMessage}</p>
            <button
              type="button"
              className="llm-btn llm-btn-primary"
              onClick={() => setShowSuccessModal(false)}
            >
              Awesome!
            </button>
          </div>
        </div>
      )}
    </s-page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
export function ErrorBoundary() {
  return boundary.error();
}
