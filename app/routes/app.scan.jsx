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

        {/* Summary strip */}
        <div className="llm-metric-grid" style={{ marginBottom: 0 }}>
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
    </s-page>
  );
}
export const headers = (headersArgs) => boundary.headers(headersArgs);
export function ErrorBoundary() {
  return boundary.error();
}
