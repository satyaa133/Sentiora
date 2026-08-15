import { describe, expect, it } from "vitest";
import {
  extractSemanticText,
  extractStructuredNodes,
  extractFallbackNodes,
  getExtractionRoot,
  stripNonContentNodes,
  extractPageMetadata,
} from "../content/webpageCapture";

// ──────────────────────────────────────────────
// Helper: create a DOM element from HTML string
// ──────────────────────────────────────────────
function createBody(html: string): HTMLElement {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div;
}

// ──────────────────────────────────────────────
// Extraction root detection
// ──────────────────────────────────────────────
describe("webpage extraction helpers", () => {
  it("prefers article as the extraction root", () => {
    document.body.innerHTML = `
      <nav>Home About</nav>
      <article><h1>Readable Title</h1><p>${"Meaningful sentence. ".repeat(8)}</p></article>
      <footer>Copyright</footer>
    `;
    const root = getExtractionRoot(document);
    expect(root.tagName.toLowerCase()).toBe("article");
  });

  it("falls back to main if no article present", () => {
    document.body.innerHTML = `<main><h1>Main Content</h1></main>`;
    const root = getExtractionRoot(document);
    expect(root.tagName.toLowerCase()).toBe("main");
  });

  it("strips scripts, nav, and ads before text extraction", () => {
    const root = createBody(`
      <script>window.tracker = true;</script>
      <nav>Skip this nav</nav>
      <p>Keep this paragraph for the vault.</p>
      <div class="advertisement">Buy now</div>
    `);
    stripNonContentNodes(root);
    const text = extractSemanticText(root);
    expect(text).toContain("Keep this paragraph for the vault.");
    expect(text).not.toContain("window.tracker");
    expect(text).not.toContain("Buy now");
  });
});

// ──────────────────────────────────────────────
// StructuredNode extraction — node types
// ──────────────────────────────────────────────
describe("extractStructuredNodes — headings", () => {
  it("extracts h1-h3 with correct level metadata", () => {
    const root = createBody(`
      <h1>Binary Search</h1>
      <p>Binary search is an efficient algorithm.</p>
      <h2>Algorithm</h2>
      <p>Divide and conquer the sorted array.</p>
      <h3>Complexity</h3>
    `);
    const nodes = extractStructuredNodes(root);
    const headings = nodes.filter((n) => n.type === "heading");
    expect(headings.length).toBe(3);
    expect(headings[0]!.text).toBe("Binary Search");
    expect(headings[0]!.metadata?.level).toBe(1);
    expect(headings[1]!.text).toBe("Algorithm");
    expect(headings[1]!.metadata?.level).toBe(2);
    expect(headings[2]!.text).toBe("Complexity");
    expect(headings[2]!.metadata?.level).toBe(3);
  });
});

describe("extractStructuredNodes — paragraphs", () => {
  it("extracts paragraphs with text, skips empty ones", () => {
    const root = createBody(`
      <p>Binary search divides the interval in half each step.</p>
      <p>   </p>
      <p>The algorithm runs in O(log n) time.</p>
    `);
    const nodes = extractStructuredNodes(root);
    const paras = nodes.filter((n) => n.type === "paragraph");
    expect(paras.length).toBe(2);
    expect(paras[0]!.text).toContain("divides the interval");
    expect(paras[1]!.text).toContain("O(log n)");
  });
});

describe("extractStructuredNodes — ordered lists", () => {
  it("extracts ordered list items with list_style: ordered", () => {
    const root = createBody(`
      <ol>
        <li>Find the middle element</li>
        <li>Compare with target</li>
        <li>Recurse on half</li>
      </ol>
    `);
    const nodes = extractStructuredNodes(root);
    const items = nodes.filter((n) => n.type === "list_item");
    expect(items.length).toBe(3);
    expect(items[0]!.metadata?.list_style).toBe("ordered");
    expect(items[0]!.text).toBe("Find the middle element");
  });
});

describe("extractStructuredNodes — unordered lists", () => {
  it("extracts unordered list items with list_style: unordered", () => {
    const root = createBody(`
      <ul>
        <li>Sorted input required</li>
        <li>O(log n) time complexity</li>
      </ul>
    `);
    const nodes = extractStructuredNodes(root);
    const items = nodes.filter((n) => n.type === "list_item");
    expect(items.length).toBe(2);
    expect(items[0]!.metadata?.list_style).toBe("unordered");
  });
});

describe("extractStructuredNodes — code blocks", () => {
  it("preserves code block content including indentation", () => {
    const code = `def binary_search(arr, target):\n    low, high = 0, len(arr) - 1\n    while low <= high:\n        mid = (low + high) // 2\n        if arr[mid] == target:\n            return mid`;
    const root = createBody(`<pre><code class="language-python">${code}</code></pre>`);
    const nodes = extractStructuredNodes(root);
    const codeNodes = nodes.filter((n) => n.type === "code_block");
    expect(codeNodes.length).toBe(1);
    // Code indentation must be preserved — NOT collapsed
    expect(codeNodes[0]!.text).toContain("    low, high");
    expect(codeNodes[0]!.metadata?.language).toBe("python");
  });

  it("detects language from highlight class", () => {
    const root = createBody(`<pre class="highlight-javascript"><code>const x = 1;</code></pre>`);
    const nodes = extractStructuredNodes(root);
    const code = nodes.find((n) => n.type === "code_block");
    expect(code?.metadata?.language).toBe("javascript");
  });
});

describe("extractStructuredNodes — tables", () => {
  it("extracts table cells with row and col index", () => {
    const root = createBody(`
      <table>
        <tr><th>Operation</th><th>Complexity</th></tr>
        <tr><td>Search</td><td>O(log n)</td></tr>
      </table>
    `);
    const nodes = extractStructuredNodes(root);
    const tableNodes = nodes.filter((n) => n.type === "table");
    expect(tableNodes.length).toBeGreaterThanOrEqual(4);
    expect(tableNodes[0]!.metadata?.row_index).toBe(0);
    expect(tableNodes[0]!.metadata?.col_index).toBe(0);
    expect(tableNodes[0]!.text).toBe("Operation");
    expect(tableNodes[1]!.metadata?.col_index).toBe(1);
  });
});

describe("extractStructuredNodes — blockquotes", () => {
  it("extracts blockquotes as blockquote nodes", () => {
    const root = createBody(`
      <blockquote>Binary search assumes the array is sorted.</blockquote>
    `);
    const nodes = extractStructuredNodes(root);
    const quotes = nodes.filter((n) => n.type === "blockquote");
    expect(quotes.length).toBe(1);
    expect(quotes[0]!.text).toContain("sorted");
  });
});

// ──────────────────────────────────────────────
// Node ordering and parent relationships
// ──────────────────────────────────────────────
describe("extractStructuredNodes — ordering and hierarchy", () => {
  it("assigns monotonically increasing order values", () => {
    const root = createBody(`
      <h1>Introduction</h1>
      <p>Binary search is efficient.</p>
      <h2>Details</h2>
      <p>The interval is halved each step.</p>
    `);
    const nodes = extractStructuredNodes(root);
    for (let i = 1; i < nodes.length; i++) {
      expect(nodes[i]!.order).toBeGreaterThan(nodes[i - 1]!.order);
    }
  });

  it("assigns parent_id of heading to following paragraph", () => {
    const root = createBody(`
      <h1>Binary Search</h1>
      <p>An efficient search algorithm.</p>
    `);
    const nodes = extractStructuredNodes(root);
    const heading = nodes.find((n) => n.type === "heading");
    const para = nodes.find((n) => n.type === "paragraph");
    expect(heading).toBeDefined();
    expect(para).toBeDefined();
    expect(para!.parent_id).toBe(heading!.id);
  });

  it("nested headings: sub-heading parent points to top-level heading", () => {
    const root = createBody(`
      <h1>Binary Search</h1>
      <h2>Algorithm Steps</h2>
    `);
    const nodes = extractStructuredNodes(root);
    const h1 = nodes.find((n) => n.type === "heading" && n.metadata?.level === 1);
    const h2 = nodes.find((n) => n.type === "heading" && n.metadata?.level === 2);
    expect(h2?.parent_id).toBe(h1?.id);
  });
});

// ──────────────────────────────────────────────
// Noisy content filtering
// ──────────────────────────────────────────────
describe("stripNonContentNodes — noise removal", () => {
  it("removes nav, sidebar, ads, and comments", () => {
    const root = createBody(`
      <nav>Menu</nav>
      <aside class="sidebar">Related</aside>
      <div class="ads">Ad content</div>
      <div id="comments">Comment section</div>
      <p>Actual article content about binary search.</p>
    `);
    stripNonContentNodes(root);
    const text = extractSemanticText(root);
    expect(text).toContain("Actual article content");
    expect(text).not.toContain("Menu");
    expect(text).not.toContain("Related");
  });
});

// ──────────────────────────────────────────────
// Fallback extraction
// ──────────────────────────────────────────────
describe("extractFallbackNodes", () => {
  it("produces nodes from semantic elements even without Readability", () => {
    const root = createBody(`
      <h2>Binary Search</h2>
      <p>Works on sorted arrays.</p>
      <li>Step one: find midpoint</li>
    `);
    const nodes = extractFallbackNodes(root);
    expect(nodes.length).toBeGreaterThanOrEqual(2);
    const heading = nodes.find((n) => n.type === "heading");
    expect(heading?.text).toBe("Binary Search");
  });
});

// ──────────────────────────────────────────────
// Metadata extraction
// ──────────────────────────────────────────────
describe("extractPageMetadata", () => {
  it("prefers og:title over document.title", () => {
    document.head.innerHTML = `<meta property="og:title" content="Binary Search Guide"/>`;
    document.title = "geeksforgeeks.org";
    const meta = extractPageMetadata(document);
    expect(meta.title).toBe("Binary Search Guide");
  });
});
