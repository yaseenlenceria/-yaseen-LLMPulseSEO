import { useState, useEffect } from "react";
import { useLoaderData, useFetcher } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getStoreSettings, saveStoreSettings } from "../lib/settings.server";
import { scanThemeSchemas, removeSchemaFromTheme, injectSchema } from "../lib/schema.server";
import { loadLlmsSnapshot } from "../lib/llms.server";

/* eslint-disable react/prop-types */

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const snapshot = await loadLlmsSnapshot(admin, 50);

  let schemaData = null;
  let schemaError = null;

  try {
    schemaData = await scanThemeSchemas(session);
  } catch (err) {
    schemaError = err.message;
  }

  const settings = getStoreSettings(session.shop);

  return {
    shop: session.shop,
    snapshot,
    schemas: schemaData,
    schemaError,
    settings,
  };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "save-schema") {
    const fields = [
      "storeName", "businessType", "email", "phone", "description", "imageUrl",
      "priceRangeFrom", "priceRangeTo", "workingHours", "street", "city",
      "state", "postalCode", "country", "latitude", "longitude",
      "facebookUrl", "xUrl", "instagramUrl", "linkedInUrl", "pinterestUrl"
    ];

    const schemaSettings = {};
    fields.forEach(field => {
      schemaSettings[field] = formData.get(field) || "";
    });

    saveStoreSettings(session.shop, { schemaSettings });
    return { ok: true, message: "Store profile settings saved successfully." };
  }

  if (intent === "delete-schema") {
    const file = formData.get("file");
    const schemaIndex = parseInt(formData.get("schemaIndex"), 10);

    try {
      const result = await removeSchemaFromTheme(session, file, schemaIndex);
      return { ok: true, message: `Schema removed from ${file}.`, ...result };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  }

  if (intent === "inject-schema") {
    const schemaJson = formData.get("schemaJson");
    const confirmInject = formData.get("confirmInject") === "true";

    if (!confirmInject) {
      return { ok: false, message: "Please check the confirmation box before injecting." };
    }

    try {
      const result = await injectSchema(session, schemaJson);
      saveStoreSettings(session.shop, { schemaSettings: { injected: true } });
      return {
        ok: true,
        message: result.status === "already-injected"
          ? "Store visibility profile already active in theme."
          : "Store visibility profile markup injected into live theme successfully.",
        ...result,
      };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  }

  return { ok: true };
};

// Helper schema builders
function generateLocalBusinessSchema(settings, origin) {
  const schema = {
    "@context": "https://schema.org",
    "@type": settings.businessType || "Store",
    "name": settings.storeName || "",
    "url": origin,
    "description": settings.description || "",
    "image": settings.imageUrl || "",
  };

  if (settings.phone) {
    schema.telephone = settings.phone;
  }

  if (settings.priceRangeFrom || settings.priceRangeTo) {
    schema.priceRange = `${settings.priceRangeFrom || ""}-${settings.priceRangeTo || ""}`;
  }

  if (settings.workingHours) {
    schema.openingHours = settings.workingHours;
  }

  if (settings.latitude || settings.longitude) {
    schema.geo = {
      "@type": "GeoCoordinates",
      "latitude": settings.latitude || "",
      "longitude": settings.longitude || "",
    };
  }

  if (settings.street || settings.city || settings.state || settings.postalCode || settings.country) {
    schema.address = {
      "@type": "PostalAddress",
      "streetAddress": settings.street || "",
      "addressLocality": settings.city || "",
      "addressRegion": settings.state || "",
      "postalCode": settings.postalCode || "",
      "addressCountry": settings.country || "",
    };
  }

  if (settings.email || settings.phone) {
    schema.contactPoint = {
      "@type": "ContactPoint",
      "contactType": "customer support",
      "telephone": settings.phone || "",
      "email": settings.email || "",
    };
  }

  return schema;
}

function generateWebsiteSchema(settings, origin) {
  const sameAs = [
    settings.facebookUrl,
    settings.xUrl,
    settings.instagramUrl,
    settings.linkedInUrl,
    settings.pinterestUrl,
  ].filter(Boolean);

  const cleanOrigin = origin.replace(/\/$/, "");

  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "name": settings.storeName || "",
    "url": origin,
    "sameAs": sameAs,
    "potentialAction": {
      "@type": "SearchAction",
      "target": `${cleanOrigin}/search?q={query}`,
      "query-input": "required name=query",
      "url": cleanOrigin,
    },
  };
}

export default function SchemaPage() {
  const { snapshot, schemas, schemaError, settings } = useLoaderData();
  const fetcher = useFetcher();
  const shopify = useAppBridge();

  const businessTypes = [
    { label: "Online Store", value: "OnlineStore" },
    { label: "Local Business", value: "LocalBusiness" },
    { label: "Store", value: "Store" },
    { label: "Auto Parts Store", value: "AutoPartsStore" },
    { label: "Motorcycle Parts Store", value: "MotorcyclePartsStore" },
    { label: "Automotive Business", value: "AutomotiveBusiness" },
    { label: "Organization", value: "Organization" },
  ];

  // Initialize form state
  const initialSchema = settings.schemaSettings || {};
  const [formState, setFormState] = useState({
    storeName: initialSchema.storeName || snapshot.shop.name || "",
    businessType: initialSchema.businessType || "OnlineStore",
    email: initialSchema.email || "",
    phone: initialSchema.phone || "",
    description: initialSchema.description || snapshot.shop.description || "",
    imageUrl: initialSchema.imageUrl || "",
    priceRangeFrom: initialSchema.priceRangeFrom || "",
    priceRangeTo: initialSchema.priceRangeTo || "",
    workingHours: initialSchema.workingHours || "Mo-Fr 09:00-18:00",
    street: initialSchema.street || "",
    city: initialSchema.city || "",
    state: initialSchema.state || "",
    postalCode: initialSchema.postalCode || "",
    country: initialSchema.country || "",
    latitude: initialSchema.latitude || "",
    longitude: initialSchema.longitude || "",
    facebookUrl: initialSchema.facebookUrl || "",
    xUrl: initialSchema.xUrl || "",
    instagramUrl: initialSchema.instagramUrl || "",
    linkedInUrl: initialSchema.linkedInUrl || "",
    pinterestUrl: initialSchema.pinterestUrl || "",
  });

  const [confirmInject, setConfirmInject] = useState(false);
  const [previewTab, setPreviewTab] = useState("localBusiness");
  const [selectedFoundSchema, setSelectedFoundSchema] = useState(null);
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  const [isMoreFieldsOpen, setIsMoreFieldsOpen] = useState(false);

  const isSaving = ["loading", "submitting"].includes(fetcher.state);

  // Compile live schemas
  const localBusinessSchema = generateLocalBusinessSchema(formState, snapshot.origin);
  const websiteSchema = generateWebsiteSchema(formState, snapshot.origin);

  const activePreviewJson = previewTab === "localBusiness" ? localBusinessSchema : websiteSchema;
  const activePreviewString = JSON.stringify(activePreviewJson, null, 2);

  // Feedback toast
  useEffect(() => {
    if (fetcher.data?.message) {
      shopify.toast.show(fetcher.data.message);
    }
  }, [fetcher.data?.message, shopify]);

  // Validation Warnings
  const warnings = [];
  if (!formState.storeName) warnings.push("Store name is required.");
  if (!formState.email) warnings.push("Support email is recommended.");
  if (!formState.phone) warnings.push("Business phone is recommended.");
  if (!formState.description) warnings.push("Store description is recommended for AI summaries.");
  if (!formState.street || !formState.city || !formState.postalCode) {
    warnings.push("Address (Street, City, Postal Code) is recommended for Local Business listings.");
  }
  if (!formState.latitude || !formState.longitude) {
    warnings.push("Latitude and Longitude are recommended for maps lookup.");
  }
  if (!formState.facebookUrl && !formState.xUrl && !formState.instagramUrl) {
    warnings.push("Social profiles help link your brand representation.");
  }

  // Completeness score
  const totalFields = Object.keys(formState).length;
  const filledFields = Object.values(formState).filter(v => v !== "").length;
  const completenessScore = Math.round((filledFields / totalFields) * 100);

  const submitForm = () => {
    fetcher.submit({ intent: "save-schema", ...formState }, { method: "POST" });
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(activePreviewString);
    shopify.toast.show("Profile markup copied to clipboard");
  };

  const handleInject = () => {
    if (!confirmInject) {
      shopify.toast.show("Please check the confirmation box.");
      return;
    }
    fetcher.submit({
      intent: "inject-schema",
      schemaJson: JSON.stringify(localBusinessSchema),
      confirmInject: "true"
    }, { method: "POST" });
  };

  const stats = schemas?.stats || { total: 0, llmPulseCount: 0, otherCount: 0, duplicateCount: 0, typeMap: {} };
  const schemaList = schemas?.schemas || [];

  const formatSize = (bytes) => {
    return bytes > 1024 ? `${(bytes / 1024).toFixed(1)}KB` : `${bytes}B`;
  };

  return (
    <s-page heading="Schema & Data">
      <s-button slot="primary-action" onClick={submitForm} {...(isSaving ? { loading: true } : {})}>
        Save Profile
      </s-button>

      <div className="llm-page llm-fade-in">

        {schemaError && (
          <div className="llm-card" style={{ borderColor: "var(--llm-error)", background: "rgba(239, 68, 68, 0.04)" }}>
            <div className="llm-card-head">
              <h2 style={{ color: "var(--llm-error)" }}>Theme scan warning</h2>
              <p>{schemaError}</p>
            </div>
          </div>
        )}

        <div className="llm-split" style={{ gridTemplateColumns: "1.2fr 0.8fr" }}>
          {/* Left Panel: Schema Form */}
          <div className="llm-stack">
            <div className="llm-card">
              <div className="llm-card-head">
                <h2>Business Profile</h2>
                <p>Provide details about your business to establish your AI-friendly storefront entity profile.</p>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                {/* Core priority fields */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                  <div>
                    <label htmlFor="storeName" style={{ display: "block", fontSize: "11px", fontWeight: "700", marginBottom: "4px" }}>Store Name</label>
                    <input
                      id="storeName"
                      className="llm-input"
                      value={formState.storeName}
                      onChange={(e) => setFormState({ ...formState, storeName: e.target.value })}
                      placeholder="e.g. Sunrise Apparel"
                    />
                  </div>
                  <div>
                    <label htmlFor="businessType" style={{ display: "block", fontSize: "11px", fontWeight: "700", marginBottom: "4px" }}>Store Business Type</label>
                    <select
                      id="businessType"
                      className="llm-input"
                      value={formState.businessType}
                      style={{ height: "34px" }}
                      onChange={(e) => setFormState({ ...formState, businessType: e.target.value })}
                    >
                      {businessTypes.map(t => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label htmlFor="description" style={{ display: "block", fontSize: "11px", fontWeight: "700", marginBottom: "4px" }}>Store Description</label>
                  <textarea
                    id="description"
                    className="llm-input"
                    value={formState.description}
                    onChange={(e) => setFormState({ ...formState, description: e.target.value })}
                    placeholder="Briefly describe what your store sells..."
                  />
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                  <div>
                    <label htmlFor="phone" style={{ display: "block", fontSize: "11px", fontWeight: "700", marginBottom: "4px" }}>Store Phone Number</label>
                    <input
                      id="phone"
                      className="llm-input"
                      value={formState.phone}
                      onChange={(e) => setFormState({ ...formState, phone: e.target.value })}
                      placeholder="+1 (555) 019-2834"
                    />
                  </div>
                  <div>
                    <label htmlFor="email" style={{ display: "block", fontSize: "11px", fontWeight: "700", marginBottom: "4px" }}>Support Email Address</label>
                    <input
                      id="email"
                      className="llm-input"
                      value={formState.email}
                      onChange={(e) => setFormState({ ...formState, email: e.target.value })}
                      placeholder="support@yourstore.com"
                    />
                  </div>
                </div>

                {/* Collapsible secondary settings */}
                <div style={{ borderTop: "1px solid var(--llm-card-border)", paddingTop: "14px", marginTop: "4px" }}>
                  <button
                    type="button"
                    onClick={() => setIsMoreFieldsOpen(!isMoreFieldsOpen)}
                    style={{
                      background: "none",
                      border: "none",
                      color: "var(--llm-primary)",
                      fontWeight: "700",
                      fontSize: "13px",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                      padding: 0,
                    }}
                  >
                    <span>{isMoreFieldsOpen ? "▼ Hide" : "▶ Show"} additional location & social links (optional)</span>
                  </button>

                  {isMoreFieldsOpen && (
                    <div style={{ display: "flex", flexDirection: "column", gap: "14px", marginTop: "14px", animation: "logFadeIn 0.2s ease-out" }}>
                      
                      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "12px" }}>
                        <div>
                          <label htmlFor="imageUrl" style={{ display: "block", fontSize: "11px", fontWeight: "700", marginBottom: "4px" }}>Brand Logo Image URL</label>
                          <input
                            id="imageUrl"
                            className="llm-input"
                            value={formState.imageUrl}
                            onChange={(e) => setFormState({ ...formState, imageUrl: e.target.value })}
                            placeholder="https://cdn.shopify.com/..."
                          />
                        </div>
                        <div>
                          <label htmlFor="workingHours" style={{ display: "block", fontSize: "11px", fontWeight: "700", marginBottom: "4px" }}>Hours</label>
                          <input
                            id="workingHours"
                            className="llm-input"
                            value={formState.workingHours}
                            onChange={(e) => setFormState({ ...formState, workingHours: e.target.value })}
                            placeholder="Mo-Fr 09:00-18:00"
                          />
                        </div>
                      </div>

                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                        <div>
                          <label htmlFor="priceRangeFrom" style={{ display: "block", fontSize: "11px", fontWeight: "700", marginBottom: "4px" }}>Catalog Price Min</label>
                          <input
                            id="priceRangeFrom"
                            className="llm-input"
                            value={formState.priceRangeFrom}
                            onChange={(e) => setFormState({ ...formState, priceRangeFrom: e.target.value })}
                            placeholder="$ e.g. 10"
                          />
                        </div>
                        <div>
                          <label htmlFor="priceRangeTo" style={{ display: "block", fontSize: "11px", fontWeight: "700", marginBottom: "4px" }}>Catalog Price Max</label>
                          <input
                            id="priceRangeTo"
                            className="llm-input"
                            value={formState.priceRangeTo}
                            onChange={(e) => setFormState({ ...formState, priceRangeTo: e.target.value })}
                            placeholder="$$$ e.g. 100"
                          />
                        </div>
                      </div>

                      <div style={{ borderTop: "1px dashed var(--llm-card-border)", paddingTop: "12px" }}>
                        <strong style={{ fontSize: "12px", display: "block", marginBottom: "8px" }}>Store Location Address</strong>
                        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                          <div>
                            <label htmlFor="street" style={{ display: "block", fontSize: "11px", fontWeight: "700", marginBottom: "4px" }}>Street Address</label>
                            <input
                              id="street"
                              className="llm-input"
                              value={formState.street}
                              onChange={(e) => setFormState({ ...formState, street: e.target.value })}
                              placeholder="Street Address"
                            />
                          </div>
                          
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                            <div>
                              <label htmlFor="city" style={{ display: "block", fontSize: "11px", fontWeight: "700", marginBottom: "4px" }}>City</label>
                              <input
                                id="city"
                                className="llm-input"
                                value={formState.city}
                                onChange={(e) => setFormState({ ...formState, city: e.target.value })}
                                placeholder="City"
                              />
                            </div>
                            <div>
                              <label htmlFor="state" style={{ display: "block", fontSize: "11px", fontWeight: "700", marginBottom: "4px" }}>State / Province</label>
                              <input
                                id="state"
                                className="llm-input"
                                value={formState.state}
                                onChange={(e) => setFormState({ ...formState, state: e.target.value })}
                                placeholder="State / Province"
                              />
                            </div>
                          </div>

                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                            <div>
                              <label htmlFor="postalCode" style={{ display: "block", fontSize: "11px", fontWeight: "700", marginBottom: "4px" }}>Postal Code</label>
                              <input
                                id="postalCode"
                                className="llm-input"
                                value={formState.postalCode}
                                onChange={(e) => setFormState({ ...formState, postalCode: e.target.value })}
                                placeholder="Postal Code"
                              />
                            </div>
                            <div>
                              <label htmlFor="country" style={{ display: "block", fontSize: "11px", fontWeight: "700", marginBottom: "4px" }}>Country</label>
                              <input
                                id="country"
                                className="llm-input"
                                value={formState.country}
                                onChange={(e) => setFormState({ ...formState, country: e.target.value })}
                                placeholder="Country (e.g. US)"
                              />
                            </div>
                          </div>

                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                            <div>
                              <label htmlFor="latitude" style={{ display: "block", fontSize: "11px", fontWeight: "700", marginBottom: "4px" }}>Latitude</label>
                              <input
                                id="latitude"
                                className="llm-input"
                                value={formState.latitude}
                                onChange={(e) => setFormState({ ...formState, latitude: e.target.value })}
                                placeholder="Latitude (e.g. 37.7749)"
                              />
                            </div>
                            <div>
                              <label htmlFor="longitude" style={{ display: "block", fontSize: "11px", fontWeight: "700", marginBottom: "4px" }}>Longitude</label>
                              <input
                                id="longitude"
                                className="llm-input"
                                value={formState.longitude}
                                onChange={(e) => setFormState({ ...formState, longitude: e.target.value })}
                                placeholder="Longitude (e.g. -122.4194)"
                              />
                            </div>
                          </div>
                        </div>
                      </div>

                      <div style={{ borderTop: "1px dashed var(--llm-card-border)", paddingTop: "12px" }}>
                        <strong style={{ fontSize: "12px", display: "block", marginBottom: "8px" }}>Social Media Citations</strong>
                        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                          <div>
                            <label htmlFor="facebookUrl" style={{ display: "block", fontSize: "11px", fontWeight: "700", marginBottom: "4px" }}>Facebook URL</label>
                            <input
                              id="facebookUrl"
                              className="llm-input"
                              value={formState.facebookUrl}
                              onChange={(e) => setFormState({ ...formState, facebookUrl: e.target.value })}
                              placeholder="Facebook Profile URL"
                            />
                          </div>
                          <div>
                            <label htmlFor="xUrl" style={{ display: "block", fontSize: "11px", fontWeight: "700", marginBottom: "4px" }}>X / Twitter URL</label>
                            <input
                              id="xUrl"
                              className="llm-input"
                              value={formState.xUrl}
                              onChange={(e) => setFormState({ ...formState, xUrl: e.target.value })}
                              placeholder="X / Twitter Profile URL"
                            />
                          </div>
                          <div>
                            <label htmlFor="instagramUrl" style={{ display: "block", fontSize: "11px", fontWeight: "700", marginBottom: "4px" }}>Instagram URL</label>
                            <input
                              id="instagramUrl"
                              className="llm-input"
                              value={formState.instagramUrl}
                              onChange={(e) => setFormState({ ...formState, instagramUrl: e.target.value })}
                              placeholder="Instagram Profile URL"
                            />
                          </div>
                          
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                            <div>
                              <label htmlFor="linkedInUrl" style={{ display: "block", fontSize: "11px", fontWeight: "700", marginBottom: "4px" }}>LinkedIn URL</label>
                              <input
                                id="linkedInUrl"
                                className="llm-input"
                                value={formState.linkedInUrl}
                                onChange={(e) => setFormState({ ...formState, linkedInUrl: e.target.value })}
                                placeholder="LinkedIn URL"
                              />
                            </div>
                            <div>
                              <label htmlFor="pinterestUrl" style={{ display: "block", fontSize: "11px", fontWeight: "700", marginBottom: "4px" }}>Pinterest URL</label>
                              <input
                                id="pinterestUrl"
                                className="llm-input"
                                value={formState.pinterestUrl}
                                onChange={(e) => setFormState({ ...formState, pinterestUrl: e.target.value })}
                                placeholder="Pinterest URL"
                              />
                            </div>
                          </div>
                        </div>
                      </div>

                    </div>
                  )}
                </div>

              </div>
            </div>
          </div>

          {/* Right Panel: Completeness & Score */}
          <div className="llm-stack">
            {/* Completeness Card */}
            <div className="llm-card">
              <div className="llm-card-head">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <h2>Search Health Score</h2>
                  <span className={`llm-badge ${completenessScore >= 80 ? "llm-badge-success" : completenessScore >= 50 ? "llm-badge-warning" : "llm-badge-error"}`}>
                    {completenessScore}% Complete
                  </span>
                </div>
                <p>Completing details increases citations and validation for brand representation in AI indexes.</p>
              </div>

              <div className="llm-progress" style={{ margin: "10px 0 16px 0" }}>
                <div
                  className={`llm-progress-fill ${completenessScore >= 80 ? "success" : "warning"}`}
                  style={{ width: `${completenessScore}%` }}
                />
              </div>

              {warnings.length > 0 ? (
                <div className="llm-check-list" style={{ maxHeight: "280px", overflowY: "auto" }}>
                  {warnings.map((w, index) => (
                    <div key={index} className="llm-check-row" style={{ padding: "8px 10px", fontSize: "12px" }}>
                      <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                        <span style={{ color: "var(--llm-warning)" }}>⚠️</span>
                        <span>{w}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="llm-badge llm-badge-success" style={{ width: "100%", justifyContent: "center", padding: "10px" }}>
                  🎉 Excellent! Your store visibility profile is fully complete.
                </div>
              )}
            </div>

            {/* Theme Integration */}
            <div className="llm-card">
              <div className="llm-card-head">
                <h2>Publish to Store</h2>
                <p>Publish your visibility profile to your storefront theme so AI crawlers can fetch your business details.</p>
              </div>

              <div style={{ background: "rgba(0, 62, 199, 0.04)", border: "1px solid rgba(0, 62, 199, 0.15)", borderRadius: "6px", padding: "12px", marginBottom: "14px" }}>
                <label style={{ display: "flex", gap: "10px", alignItems: "flex-start", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    style={{ marginTop: "3px" }}
                    checked={confirmInject}
                    onChange={(e) => setConfirmInject(e.target.checked)}
                  />
                  <span style={{ fontSize: "12px", lineHeight: "1.4", color: "var(--llm-on-surface)" }}>
                    I confirm that I want to publish this visibility profile to my active store theme.
                  </span>
                </label>
              </div>

              <button
                className={`llm-btn ${confirmInject ? "llm-btn-primary" : "llm-btn-disabled"}`}
                disabled={!confirmInject || isSaving}
                onClick={handleInject}
                style={{ width: "100%" }}
              >
                {isSaving ? "Publishing..." : "Publish to Store"}
              </button>
            </div>
          </div>
        </div>

        {/* Collapsible advanced technical view containing templates configurations and code markup */}
        <div className="llm-accordion">
          <button 
            type="button"
            className="llm-accordion-trigger" 
            onClick={() => setIsAdvancedOpen(!isAdvancedOpen)}
            style={{ border: "none" }}
          >
            <span>Developer View</span>
            <span style={{ 
              transform: isAdvancedOpen ? "rotate(180deg)" : "rotate(0deg)", 
              transition: "transform 0.2s ease",
              fontSize: "14px"
            }}>
              ▼
            </span>
          </button>

          {isAdvancedOpen && (
            <div className="llm-accordion-content" style={{ animation: "logFadeIn 0.25s ease-out", display: "flex", flexDirection: "column", gap: "20px" }}>
              
              {/* Live Preview Card */}
              <div className="llm-card" style={{ margin: 0 }}>
                <div className="llm-card-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "6px" }}>
                  <div>
                    <h2>Live JSON-LD Preview</h2>
                    <p>Check the structured data format as you fill out the profile.</p>
                  </div>
                  <div className="llm-segmented" style={{ display: "flex", background: "var(--llm-surface)", padding: "2px", borderRadius: "6px", marginLeft: "auto" }}>
                    <button
                      type="button"
                      style={{
                        border: "none",
                        padding: "4px 8px",
                        fontSize: "11px",
                        borderRadius: "4px",
                        cursor: "pointer",
                        background: previewTab === "localBusiness" ? "white" : "transparent",
                        boxShadow: previewTab === "localBusiness" ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
                        fontWeight: previewTab === "localBusiness" ? "700" : "500",
                      }}
                      onClick={() => setPreviewTab("localBusiness")}
                    >
                      Business Profile
                    </button>
                    <button
                      type="button"
                      style={{
                        border: "none",
                        padding: "4px 8px",
                        fontSize: "11px",
                        borderRadius: "4px",
                        cursor: "pointer",
                        background: previewTab === "website" ? "white" : "transparent",
                        boxShadow: previewTab === "website" ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
                        fontWeight: previewTab === "website" ? "700" : "500",
                      }}
                      onClick={() => setPreviewTab("website")}
                    >
                      Website Search Meta
                    </button>
                  </div>
                </div>

                <div className="llm-dark" style={{ maxHeight: "250px", minHeight: "180px", marginBottom: "12px" }}>
                  <pre>{activePreviewString}</pre>
                </div>

                <button className="llm-btn llm-btn-outline llm-btn-sm" onClick={handleCopy}>
                  Copy JSON-LD
                </button>
              </div>

              {/* Detected themes lists */}
              <div className="llm-card" style={{ margin: 0 }}>
                <div className="llm-card-head">
                  <h2>Schemas Detected in Theme</h2>
                  <p>Existing JSON-LD blocks found in theme files. Ensure no duplicated profiles exist.</p>
                </div>

                <div className="llm-metric-grid" style={{ marginBottom: "16px" }}>
                  <div className="llm-metric" style={{ padding: "10px" }}>
                    <div className="llm-metric-label">Total in Theme</div>
                    <div className="llm-metric-value" style={{ fontSize: "18px" }}>{stats.total}</div>
                  </div>
                  <div className="llm-metric" style={{ padding: "10px" }}>
                    <div className="llm-metric-label">LLMPulseSEO Schema</div>
                    <div className="llm-metric-value success" style={{ fontSize: "18px" }}>{stats.llmPulseCount}</div>
                  </div>
                  <div className="llm-metric" style={{ padding: "10px" }}>
                    <div className="llm-metric-label">Duplicate Schema Types</div>
                    <div className={`llm-metric-value ${stats.duplicateCount > 0 ? "error" : "success"}`} style={{ fontSize: "18px" }}>
                      {stats.duplicateCount}
                    </div>
                  </div>
                </div>

                {schemaList.length === 0 ? (
                  <div className="llm-check-row">
                    <div>
                      <strong>No schemas found</strong>
                      <p>No JSON-LD schemas were detected in theme files.</p>
                    </div>
                  </div>
                ) : (
                  <div className="llm-table-wrap">
                    <table className="llm-table">
                      <thead>
                        <tr>
                          <th>File</th>
                          <th>Schema Type</th>
                          <th>Size</th>
                          <th>Source</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {schemaList.map((schema, index) => (
                          <tr key={`${schema.file}-${index}`}>
                            <td>
                              <code className="llm-link" style={{ fontSize: 12 }}>
                                {schema.file}
                              </code>
                            </td>
                            <td>
                              <strong>{schema.schemaType}</strong>
                            </td>
                            <td>
                              <span style={{ color: "var(--llm-outline)" }}>
                                {formatSize(schema.size)}
                              </span>
                            </td>
                            <td>
                              <span className={`llm-badge ${schema.isLLMPulseSEO ? "llm-badge-success" : "llm-badge-primary"}`}>
                                {schema.isLLMPulseSEO ? "LLMPulseSEO" : "Other App"}
                              </span>
                            </td>
                            <td>
                              <div style={{ display: "flex", gap: 6 }}>
                                <button
                                  type="button"
                                  className="llm-btn llm-btn-outline llm-btn-sm"
                                  onClick={() => setSelectedFoundSchema(selectedFoundSchema === index ? null : index)}
                                >
                                  {selectedFoundSchema === index ? "Hide" : "View"}
                                </button>
                                <fetcher.Form method="POST" style={{ display: "inline" }}>
                                  <input type="hidden" name="intent" value="delete-schema" />
                                  <input type="hidden" name="file" value={schema.file} />
                                  <input type="hidden" name="schemaIndex" value={String(index)} />
                                  <button
                                    type="submit"
                                    className="llm-btn llm-btn-danger llm-btn-sm"
                                    disabled={isSaving}
                                  >
                                    Delete
                                  </button>
                                </fetcher.Form>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {selectedFoundSchema !== null && schemaList[selectedFoundSchema] && (
                <div className="llm-card" style={{ margin: 0 }}>
                  <div className="llm-card-head">
                    <h2>Detected Schema Content</h2>
                    <p>Viewing raw content of: <code>{schemaList[selectedFoundSchema].file}</code> ({schemaList[selectedFoundSchema].schemaType})</p>
                  </div>
                  <div className="llm-dark">
                    <pre>{schemaList[selectedFoundSchema].schemaContent}</pre>
                  </div>
                </div>
              )}

            </div>
          )}
        </div>

      </div>
    </s-page>
  );
}

export const headers = (headersArgs) => headersArgs;
export function ErrorBoundary() {
  return boundary.error();
}
