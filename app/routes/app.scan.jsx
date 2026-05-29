import { useState, useEffect } from "react";
import { useLoaderData, useFetcher } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { loadLlmsSnapshot } from "../lib/llms.server";

/* eslint-disable react/prop-types */

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  return loadLlmsSnapshot(admin, 50);
};

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "update-product") {
    const id = formData.get("id");
    const title = formData.get("title");
    const description = formData.get("description");
    const productType = formData.get("productType");
    const tags = formData.get("tags");

    const PRODUCT_UPDATE_MUTATION = `#graphql
      mutation productUpdate($input: ProductInput!) {
        productUpdate(input: $input) {
          product { id title description productType tags }
          userErrors { field message }
        }
      }
    `;

    const response = await admin.graphql(PRODUCT_UPDATE_MUTATION, {
      variables: {
        input: {
          id, title,
          descriptionHtml: description ? `<p>${description}</p>` : "",
          productType,
          tags: tags ? tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
        },
      },
    });

    const payload = await response.json();
    if (payload.errors?.length) return { ok: false, message: payload.errors.map((e) => e.message).join("; ") };
    const userErrors = payload.data?.productUpdate?.userErrors;
    if (userErrors?.length) return { ok: false, message: userErrors.map((e) => e.message).join("; ") };
    return { ok: true, message: `Product "${payload.data.productUpdate.product.title}" updated successfully.` };
  }

  return { ok: true, message: "Action completed." };
};

export default function ScanPage() {
  const snapshot = useLoaderData();
  const fetcher = useFetcher();
  const shopify = useAppBridge();
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});
  const isSaving = ["loading", "submitting"].includes(fetcher.state);

  // Active tab state
  const [activeTab, setActiveTab] = useState('scan'); // 'scan' | 'descriptions' | 'headings' | 'metas'

  useEffect(() => {
    if (fetcher.data?.message) {
      shopify.toast.show(fetcher.data.message);
      if (fetcher.data.ok) { setEditingId(null); setEditForm({}); }
    }
  }, [fetcher.data?.message, fetcher.data?.ok, shopify]);

  const startEdit = (product) => {
    setEditingId(product.id);
    setEditForm({ id: product.id, title: product.title, description: product.description, productType: product.type, tags: (product.tags || []).join(", ") });
  };

  const saveEdit = () => {
    fetcher.submit({ intent: "update-product", id: editForm.id, title: editForm.title, description: editForm.description, productType: editForm.productType, tags: editForm.tags }, { method: "POST" });
  };

  const needsAttention = snapshot.products.filter(p => {
    const shortDesc = !p.description || p.description.length < 100;
    const noType = !p.type || p.type === "Product";
    const noTags = !p.tags || p.tags.length === 0;
    return shortDesc || noType || noTags;
  });

  const aiReadyCount = snapshot.products.length - needsAttention.length;
  const score = snapshot.health.score;

  return (
    <s-page heading="Product Scan">
      <div className="llm-page llm-fade-in">

        {/* Modern Tab Menu */}
        <div style={{
          display: "flex",
          borderBottom: "1px solid var(--llm-card-border)",
          marginBottom: "24px",
          gap: "8px",
          overflowX: "auto",
          paddingBottom: "1px"
        }}>
          {[
            { id: "scan", label: "Product Scan", badge: null },
            { id: "descriptions", label: "Descriptions", badge: "AI Coming Soon" },
            { id: "headings", label: "Headings (H1-H3)", badge: "AI Coming Soon" },
            { id: "metas", label: "Titles & Metas", badge: "AI Coming Soon" }
          ].map(tab => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                style={{
                  padding: "12px 16px",
                  background: "none",
                  border: "none",
                  borderBottom: isActive ? "3px solid var(--llm-primary)" : "3px solid transparent",
                  color: isActive ? "var(--llm-primary)" : "var(--llm-on-surface-variant)",
                  fontWeight: isActive ? "700" : "500",
                  fontSize: "14px",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  transition: "all 0.2s"
                }}
              >
                {tab.label}
                {tab.badge && (
                  <span style={{
                    fontSize: "10px",
                    fontWeight: "700",
                    background: "rgba(92, 106, 196, 0.1)",
                    color: "var(--llm-primary)",
                    padding: "2px 6px",
                    borderRadius: "4px",
                    letterSpacing: "0.02em"
                  }}>
                    {tab.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Tab Content: Scan */}
        {activeTab === 'scan' && (
          <div className="llm-fade-in">
            {/* Summary strip */}
            <div className="llm-metric-grid" style={{ marginBottom: "20px" }}>
              <div className="llm-metric">
                <div className="llm-metric-label">Total Products</div>
                <div className="llm-metric-value">{snapshot.counts.products}</div>
              </div>
              <div className="llm-metric">
                <div className="llm-metric-label">Need Attention</div>
                <div className={`llm-metric-value ${needsAttention.length > 0 ? "warning" : "success"}`}>{needsAttention.length}</div>
              </div>
              <div className="llm-metric">
                <div className="llm-metric-label">AI Ready</div>
                <div className="llm-metric-value success">{aiReadyCount}</div>
              </div>
              <div className="llm-metric">
                <div className="llm-metric-label">Readiness Score</div>
                <div className={`llm-metric-value ${score >= 80 ? "success" : "warning"}`}>{score}%</div>
              </div>
            </div>

            {/* All good state */}
            {needsAttention.length === 0 && (
              <div className="llm-card" style={{ textAlign: "center", padding: "48px 24px" }}>
                <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
                <h2 style={{ margin: "0 0 8px", color: "#16a34a" }}>All products are AI-ready!</h2>
                <p style={{ color: "var(--llm-on-surface-variant)", margin: 0 }}>
                  Every product has a description, category, and search tags. AI assistants can find and recommend your products.
                </p>
              </div>
            )}

            {/* Products needing attention */}
            {needsAttention.length > 0 && (
              <div className="llm-card">
                <div className="llm-card-head">
                  <h2>Products that need attention</h2>
                  <p>Fix these to help AI assistants find and recommend your products.</p>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {snapshot.products.map((product) => {
                    const issues = [];
                    if (!product.description || product.description.length < 100) issues.push("Description too short");
                    if (!product.type || product.type === "Product") issues.push("No category set");
                    if (!product.tags || product.tags.length === 0) issues.push("No search tags");
                    if (issues.length === 0) return null;

                    const isEditing = editingId === product.id;

                    return (
                      <div key={product.id} style={{
                        border: isEditing ? "2px solid var(--llm-primary)" : "1px solid var(--llm-card-border)",
                        borderRadius: 10,
                        padding: "16px 18px",
                        background: isEditing ? "#f8f9ff" : "#fff",
                        transition: "all 0.2s",
                      }}>
                        {!isEditing ? (
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>{product.title}</div>
                              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                                {issues.map(issue => (
                                  <span key={issue} style={{ fontSize: 11, fontWeight: 600, background: "#fff7ed", color: "#b45309", border: "1px solid #fed7aa", padding: "2px 8px", borderRadius: 20 }}>
                                    ⚠ {issue}
                                  </span>
                                ))}
                              </div>
                            </div>
                            <button className="llm-btn llm-btn-outline llm-btn-sm" onClick={() => startEdit(product)}>
                              Fix
                            </button>
                          </div>
                        ) : (
                          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                            <div style={{ fontWeight: 700, fontSize: 14, color: "var(--llm-primary)" }}>Editing: {product.title}</div>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                              <div>
                                <label htmlFor={`title-${product.id}`} style={{ fontSize: 11, fontWeight: 700, display: "block", marginBottom: 4 }}>Product Title</label>
                                <input id={`title-${product.id}`} className="llm-input" value={editForm.title} onChange={e => setEditForm({ ...editForm, title: e.target.value })} placeholder="Product title" />
                              </div>
                              <div>
                                <label htmlFor={`type-${product.id}`} style={{ fontSize: 11, fontWeight: 700, display: "block", marginBottom: 4 }}>Category Type</label>
                                <input id={`type-${product.id}`} className="llm-input" value={editForm.productType} onChange={e => setEditForm({ ...editForm, productType: e.target.value })} placeholder="e.g. Shoes, T-Shirt, Bag" />
                              </div>
                            </div>
                            <div>
                              <label htmlFor={`desc-${product.id}`} style={{ fontSize: 11, fontWeight: 700, display: "block", marginBottom: 4 }}>Description <span style={{ color: "#9ca3af", fontWeight: 400 }}>(aim for 100+ characters)</span></label>
                              <textarea id={`desc-${product.id}`} className="llm-input" rows={3} value={editForm.description} onChange={e => setEditForm({ ...editForm, description: e.target.value })} placeholder="Describe this product clearly for AI search engines..." style={{ resize: "vertical" }} />
                              <div style={{ fontSize: 11, color: (editForm.description || "").length >= 100 ? "#16a34a" : "#9ca3af", marginTop: 2 }}>
                                {(editForm.description || "").length} / 100+ characters
                              </div>
                            </div>
                            <div>
                              <label htmlFor={`tags-${product.id}`} style={{ fontSize: 11, fontWeight: 700, display: "block", marginBottom: 4 }}>Search Tags <span style={{ color: "#9ca3af", fontWeight: 400 }}>(comma-separated)</span></label>
                              <input id={`tags-${product.id}`} className="llm-input" value={editForm.tags} onChange={e => setEditForm({ ...editForm, tags: e.target.value })} placeholder="summer, casual, cotton, blue" />
                            </div>
                            <div style={{ display: "flex", gap: 8 }}>
                              <button className="llm-btn llm-btn-primary llm-btn-sm" onClick={saveEdit} disabled={isSaving}>
                                {isSaving ? "Saving…" : "Save Changes"}
                              </button>
                              <button className="llm-btn llm-btn-outline llm-btn-sm" onClick={() => { setEditingId(null); setEditForm({}); }} disabled={isSaving}>
                                Cancel
                              </button>
                              <a href={product.url} target="_blank" rel="noreferrer" className="llm-link" style={{ fontSize: 12, alignSelf: "center", marginLeft: "auto" }}>View in Shopify →</a>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Tab Content: Descriptions */}
        {activeTab === 'descriptions' && (
          <div className="llm-fade-in">
            <div className="llm-card" style={{ marginBottom: "24px" }}>
              <div className="llm-card-head">
                <h2>Product Descriptions Auditor</h2>
                <p>Verify that your store descriptions have sufficient semantic detail for search engine listings.</p>
              </div>
              <p style={{ fontSize: "13px", color: "var(--llm-on-surface-variant)", margin: "0 0 16px 0", lineHeight: "1.5" }}>
                {"AI semantic search crawlers read product descriptions to extract product features, fabrics, sizing, and details. Descriptions that are too brief (under 100 characters) limit the AI's ability to recommend your store."}
              </p>
              <div style={{ display: "flex", gap: "12px" }}>
                <button className="llm-btn llm-btn-primary" disabled style={{ opacity: 0.7, cursor: "not-allowed" }}>
                  Bulk Update Descriptions (Coming Soon)
                </button>
              </div>
            </div>

            <div className="llm-card">
              <div className="llm-card-head" style={{ borderBottom: "1px solid var(--llm-card-border)", paddingBottom: "12px" }}>
                <h2>Mock Catalog Analysis</h2>
                <p>Simulated analysis of how description length checks will look when the AI layer is activated.</p>
              </div>
              <div className="llm-table-wrap">
                <table className="llm-table">
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>Current Length</th>
                      <th>Status Check</th>
                      <th>AI Suggestion Preview</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { name: "Yaseen Silk Kimono", len: 45, status: "Short Description (aim for 100+ characters)", suggestion: "Crafted from fine mulberry silk, this luxury kimono features detailed embroidery, adjustable belt..." },
                      { name: "Lace Babydoll Set", len: 120, status: "Healthy (120 chars)", suggestion: "Already optimized" },
                      { name: "Satin Sleep Shorts", len: 32, status: "Short Description (aim for 100+ characters)", suggestion: "Relaxed-fit satin lounge shorts designed with an elastic waist, lightweight breathable satin fabric..." }
                    ].map((item, idx) => (
                      <tr key={idx}>
                        <td style={{ fontWeight: "700" }}>{item.name}</td>
                        <td>{item.len} characters</td>
                        <td>
                          <span className={`llm-badge ${item.len < 100 ? "llm-badge-warning" : "llm-badge-success"}`}>
                            {item.len < 100 ? "⚠️ Too Brief" : "✓ AI Optimal"}
                          </span>
                        </td>
                        <td style={{ color: "var(--llm-outline)", fontStyle: "italic" }}>
                          {item.len < 100 ? (
                            <span style={{ filter: "blur(2.5px)", userSelect: "none" }}>{item.suggestion}</span>
                          ) : (
                            item.suggestion
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Tab Content: Headings */}
        {activeTab === 'headings' && (
          <div className="llm-fade-in">
            <div className="llm-card" style={{ marginBottom: "24px" }}>
              <div className="llm-card-head">
                <h2>HTML Headings Hierarchy (H1, H2, H3)</h2>
                <p>Organize product details under structured titles to help AI agents parse descriptions.</p>
              </div>
              <p style={{ fontSize: "13px", color: "var(--llm-on-surface-variant)", margin: "0 0 16px 0", lineHeight: "1.5" }}>
                Adding clear <code>&lt;h1&gt;</code>, <code>&lt;h2&gt;</code>, and <code>&lt;h3&gt;</code> headings to your product specifications organizes your product pages into distinct sections, making it trivial for LLM systems to index.
              </p>
              <div style={{ display: "flex", gap: "12px" }}>
                <button className="llm-btn llm-btn-primary" disabled style={{ opacity: 0.7, cursor: "not-allowed" }}>
                  Structure Specifications (Coming Soon)
                </button>
              </div>
            </div>

            <div className="llm-card">
              <div className="llm-card-head" style={{ borderBottom: "1px solid var(--llm-card-border)", paddingBottom: "12px" }}>
                <h2>Heading Structure Schema Check</h2>
                <p>Visual schema representation of clean product specification nesting.</p>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "16px", padding: "12px 0" }}>
                <div style={{ borderLeft: "4px solid #5c6ac4", paddingLeft: "16px" }}>
                  <div style={{ fontSize: "11px", fontWeight: "700", color: "#5c6ac4" }}>H1 Heading (Product Title)</div>
                  <div style={{ fontSize: "16px", fontWeight: "700", marginTop: "2px" }}>Luxury Satin Dressing Gown</div>
                </div>
                <div style={{ borderLeft: "4px solid #a855f7", paddingLeft: "16px", marginLeft: "20px" }}>
                  <div style={{ fontSize: "11px", fontWeight: "700", color: "#a855f7" }}>H2 Subheading (Section Title)</div>
                  <div style={{ fontSize: "14px", fontWeight: "700", marginTop: "2px" }}>Product Specifications</div>
                  
                  <div style={{ borderLeft: "4px solid #ca8a04", paddingLeft: "16px", marginLeft: "20px", marginTop: "12px" }}>
                    <div style={{ fontSize: "11px", fontWeight: "700", color: "#ca8a04" }}>H3 Title (Item Highlights)</div>
                    <div style={{ fontSize: "12.5px", fontWeight: "700", marginTop: "2px" }}>Material & Fabric Care</div>
                    <p style={{ margin: "4px 0 0 0", fontSize: "12px", color: "var(--llm-on-surface-variant)" }}>
                      95% polyester satin, 5% elastane. Hand wash cold, lay flat to dry.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tab Content: Metas */}
        {activeTab === 'metas' && (
          <div className="llm-fade-in">
            <div className="llm-card" style={{ marginBottom: "24px" }}>
              <div className="llm-card-head">
                <h2>Title Tags &amp; Meta Descriptions</h2>
                <p>Fine-tune storefront metadata elements for search engine citation cards.</p>
              </div>
              <p style={{ fontSize: "13px", color: "var(--llm-on-surface-variant)", margin: "0 0 16px 0", lineHeight: "1.5" }}>
                Meta Title tags and Meta descriptions are displayed directly in search result citations. 
                Optimizing these ensures that search widgets and chat agents quote your products with clean, concise summaries.
              </p>
              <div style={{ display: "flex", gap: "12px" }}>
                <button className="llm-btn llm-btn-primary" disabled style={{ opacity: 0.7, cursor: "not-allowed" }}>
                  Bulk Optimize Meta Tags (Coming Soon)
                </button>
              </div>
            </div>

            <div className="llm-card">
              <div className="llm-card-head" style={{ borderBottom: "1px solid var(--llm-card-border)", paddingBottom: "12px" }}>
                <h2>AI Search Citation Preview</h2>
                <p>Simulated rendering of a product card citation snippet in search results.</p>
              </div>
              <div style={{ background: "#f8f9fa", border: "1px solid #e9ecef", borderRadius: "8px", padding: "16px", marginTop: "16px", maxWidth: "520px" }}>
                <div style={{ fontSize: "12.5px", color: "#1a0dab", fontWeight: "500", marginBottom: "2px" }}>
                  Yaseen Lingerie | Luxury Embroidered Corset Top
                </div>
                <div style={{ fontSize: "12px", color: "#006621", marginBottom: "4px" }}>
                  https://yaseenlenceria.com/products/embroidered-corset
                </div>
                <div style={{ fontSize: "13px", color: "#545454", lineHeight: "1.4" }}>
                  Discover our premium lace corset top with adjustable hooks, steel bones, and delicate mesh styling. Perfect for layering under jackets or loungewear.
                </div>
              </div>
            </div>
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
