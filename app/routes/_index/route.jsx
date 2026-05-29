import { redirect, Form, useLoaderData } from "react-router";
import { login } from "../../shopify.server";
import styles from "./styles.module.css";

export const loader = async ({ request }) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export default function App() {
  const { showForm } = useLoaderData();

  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <div style={{ marginBottom: "16px" }}>
          <span style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "8px",
            padding: "6px 16px",
            borderRadius: "9999px",
            background: "linear-gradient(135deg, #003ec7, #3737c5)",
            color: "white",
            fontSize: "13px",
            fontWeight: 700,
            letterSpacing: "0.02em",
          }}>
            &#x26A1; LLMPulseSEO
          </span>
        </div>
        <h1 className={styles.heading}>
          Make Your Store Discoverable by AI
        </h1>
        <p className={styles.text}>
          Generate llms.txt files, optimize product metadata, and boost your store&apos;s
          visibility across ChatGPT, Gemini, Perplexity, and other AI search engines.
        </p>
        {showForm && (
          <Form className={styles.form} method="post" action="/auth/login">
            <label className={styles.label}>
              <span>Shop domain</span>
              <input className={styles.input} type="text" name="shop" placeholder="your-store.myshopify.com" />
              <span>e.g: my-shop-domain.myshopify.com</span>
            </label>
            <button className={styles.button} type="submit">
              Install LLMPulseSEO
            </button>
          </Form>
        )}
        <ul className={styles.list}>
          <li>
            <strong>AI Discovery Files</strong>. Automatically generate llms.txt and llms-full.txt
            files that tell AI assistants about your products and collections.
          </li>
          <li>
            <strong>Content Health Scanner</strong>. Scan your entire catalog for missing
            descriptions, types, vendors, and tags that hurt AI visibility.
          </li>
          <li>
            <strong>Automatic robots.txt</strong>. LLMPulseSEO adds discovery file links
            to your robots.txt so AI crawlers find your store automatically.
          </li>
        </ul>
      </div>
    </div>
  );
}
