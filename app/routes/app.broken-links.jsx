import { useEffect } from "react";
import { useLoaderData, useFetcher } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getBrokenLinkScan, saveBrokenLinkScan } from "../lib/settings.server";
import { simulateScan } from "../lib/broken-links.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const scanData = getBrokenLinkScan(session.shop);
  return {
    shop: session.shop,
    scanData,
  };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "scan") {
    // Run scanner simulation
    const results = await simulateScan(session.shop);
    saveBrokenLinkScan(session.shop, results);
    return { ok: true, message: "Store links check complete.", scanData: results };
  }

  return { ok: true };
};

export default function BrokenLinkChecker() {
  const { shop, scanData: initialScanData } = useLoaderData();
  const fetcher = useFetcher();
  const shopify = useAppBridge();

  const scanData = fetcher.data?.scanData || initialScanData;
  const isScanning = ["loading", "submitting"].includes(fetcher.state) && fetcher.formData?.get("intent") === "scan";

  // Toast feedback
  useEffect(() => {
    if (fetcher.data?.message) {
      shopify.toast.show(fetcher.data.message);
    }
  }, [fetcher.data?.message, shopify]);

  const triggerScan = () => {
    fetcher.submit({ intent: "scan" }, { method: "POST" });
  };

  const handleExport = () => {
    if (!scanData.links || scanData.links.length === 0) {
      shopify.toast.show("No links to export.");
      return;
    }

    // Generate CSV
    const headers = ["Source Page", "Broken URL", "HTTP Status", "Anchor Text", "Issue Type", "Suggested Action"];
    const rows = scanData.links.map(link => [
      link.sourcePage,
      link.brokenUrl,
      link.statusCode,
      link.anchorText,
      link.issueType,
      link.suggestedAction
    ]);

    const csvContent = "data:text/csv;charset=utf-8,"
      + [headers.join(","), ...rows.map(e => e.map(val => `"${String(val).replace(/"/g, '""')}"`).join(","))].join("\n");

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    const dateStr = scanData.lastScanDate ? new Date(scanData.lastScanDate).toISOString().slice(0,10) : "scan";
    link.setAttribute("download", `llm-pulse-seo-broken-links-${dateStr}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    shopify.toast.show("Report exported successfully.");
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return "Never Scanned";
    const date = new Date(dateStr);
    return date.toLocaleDateString() + " at " + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <s-page heading="Broken Links">
      <s-button slot="primary-action" onClick={triggerScan} {...(isScanning ? { loading: true } : {})}>
        {isScanning ? "Scanning..." : "Scan Links"}
      </s-button>
      {scanData.links && scanData.links.length > 0 && (
        <s-button slot="secondary-actions" onClick={handleExport} disabled={isScanning}>
          Export CSV
        </s-button>
      )}

      <div className="llm-page llm-fade-in">
        {/* Metrics Grid */}
        <div className="llm-metric-grid" style={{ marginBottom: "20px" }}>
          <div className="llm-metric">
            <div className="llm-metric-label">Pages Checked</div>
            <div className="llm-metric-value">{scanData.pagesChecked || 0}</div>
          </div>
          <div className="llm-metric">
            <div className="llm-metric-label">Broken Links</div>
            <div className={`llm-metric-value ${scanData.brokenLinksFound > 0 ? "error" : "success"}`}>
              {scanData.brokenLinksFound || 0}
            </div>
          </div>
          <div className="llm-metric">
            <div className="llm-metric-label">Last Scan</div>
            <div className="llm-metric-value" style={{ fontSize: "14px", marginTop: "8px", color: "var(--llm-on-surface-variant)" }}>
              {formatDate(scanData.lastScanDate)}
            </div>
          </div>
        </div>

        {/* Scan states */}
        {isScanning && (
          <div className="llm-card" style={{ padding: "60px 0", textAlign: "center" }}>
            <div style={{
              width: "40px",
              height: "40px",
              border: "4px solid var(--llm-surface)",
              borderTop: "4px solid var(--llm-primary)",
              borderRadius: "50%",
              animation: "spin 1s linear infinite",
              margin: "0 auto 16px auto"
            }} />
            <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
            <strong>Analyzing store links...</strong>
            <p style={{ fontSize: "12px", color: "var(--llm-on-surface-variant)", marginTop: "4px" }}>
              This takes around 30 seconds for larger storefront catalogs.
            </p>
          </div>
        )}

        {!isScanning && !scanData.lastScanDate && (
          <div className="llm-card" style={{ padding: "40px 0", textAlign: "center", color: "var(--llm-on-surface-variant)" }}>
            <span style={{ fontSize: "36px", display: "block", marginBottom: "8px" }}>🔍</span>
            <strong>No scan records found</strong>
            <p style={{ fontSize: "13px", marginTop: "4px" }}>Click &quot;Scan Links&quot; above to scan your storefront.</p>
          </div>
        )}

        {!isScanning && scanData.lastScanDate && (!scanData.links || scanData.links.length === 0) && (
          <div className="llm-card" style={{ padding: "40px 0", textAlign: "center", color: "var(--llm-success)" }}>
            <span style={{ fontSize: "36px", display: "block", marginBottom: "8px" }}>✅</span>
            <strong style={{ color: "#16a34a" }}>Zero broken links found!</strong>
            <p style={{ fontSize: "13px", color: "var(--llm-on-surface-variant)", marginTop: "4px" }}>
              AI search engines and visitors can navigate your pages without hitting dead ends.
            </p>
          </div>
        )}

        {!isScanning && scanData.lastScanDate && scanData.links && scanData.links.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {scanData.links.map((link, index) => (
              <div key={index} className="llm-card" style={{ padding: "16px 18px", border: "1px solid var(--llm-card-border)", borderRadius: "10px", background: "#fff" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px", flexWrap: "wrap" }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                      <span className={`llm-badge ${link.statusCode === 404 ? "llm-badge-error" : "llm-badge-warning"}`}>
                        {link.statusCode === 404 ? "Dead Link (404)" : "Broken Link"}
                      </span>
                      <span style={{ fontSize: "12px", color: "var(--llm-outline)" }}>
                        Found on page: <strong>{link.sourcePage}</strong>
                      </span>
                    </div>
                    <div style={{ marginTop: "8px" }}>
                      <span style={{ fontSize: "13.5px", fontWeight: "700" }}>Link Text: </span>
                      <span style={{ fontSize: "13px", background: "var(--llm-surface)", padding: "2px 6px", borderRadius: "4px", border: "1px solid var(--llm-card-border)" }}>
                        &quot;{link.anchorText}&quot;
                      </span>
                    </div>
                    <div style={{ marginTop: "4px" }}>
                      <span style={{ fontSize: "13.5px", fontWeight: "700" }}>Broken URL: </span>
                      <code style={{ fontSize: "12px", color: "var(--llm-error)", wordBreak: "break-all" }}>{link.brokenUrl}</code>
                    </div>
                  </div>
                  
                  <a
                    href={`https://${shop}/admin/pages`}
                    target="_blank"
                    rel="noreferrer"
                    className="llm-btn llm-btn-outline llm-btn-sm"
                    style={{ textDecoration: "none" }}
                  >
                    Fix in Shopify
                  </a>
                </div>
                
                {/* Inline AI recommendation */}
                <div style={{ 
                  marginTop: "12px", 
                  background: "rgba(0,62,199,0.02)",
                  borderRadius: "6px",
                  padding: "8px 12px",
                  border: "1px dashed rgba(0,62,199,0.1)"
                }}>
                  <strong style={{ fontSize: "12px", color: "var(--llm-primary)", display: "block", marginBottom: "2px" }}>
                    Recommended Action:
                  </strong>
                  <div style={{ fontSize: "12px", lineHeight: "1.4", color: "var(--llm-on-surface)" }}>
                    {link.suggestedAction}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

      </div>
    </s-page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
export function ErrorBoundary() {
  return boundary.error();
}
