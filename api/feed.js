/**
 * Vercel Serverless Function
 * Fetches the Koeppel Auto Group blog RSS feed and returns it as JSON.
 *
 * Endpoints:
 *   GET /api/feed          → full JSON feed
 *   GET /api/feed?limit=5  → return only the first N items
 *   GET /api/feed?pretty=1 → pretty-printed JSON
 */

const RSS_URL = "https://www.koeppelautogroup.com/blog/rss/index.xml";

// ---------------------------------------------------------------------------
// Lightweight XML helpers – no external dependencies needed
// ---------------------------------------------------------------------------

/**
 * Extract the text content of the first occurrence of <tag>…</tag>.
 * Handles both regular text and CDATA sections.
 */
function getTagContent(xml, tag) {
  const pattern = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const match = xml.match(pattern);
  if (!match) return "";

  let content = match[1].trim();

  // Unwrap CDATA if present
  const cdata = content.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  if (cdata) content = cdata[1].trim();

  return content;
}

/**
 * Extract ALL occurrences of <tag>…</tag> and return an array of strings.
 */
function getAllTagContents(xml, tag) {
  const results = [];
  const pattern = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi");
  let m;
  while ((m = pattern.exec(xml)) !== null) {
    let content = m[1].trim();
    const cdata = content.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
    if (cdata) content = cdata[1].trim();
    results.push(content);
  }
  return results;
}

/**
 * Get an attribute value from a self-closing or opening tag.
 * e.g. getAttr('<enclosure url="…" />', 'enclosure', 'url')
 */
function getAttr(xml, tag, attr) {
  const pattern = new RegExp(`<${tag}[^>]*?${attr}=["']([^"']*)["']`, "i");
  const match = xml.match(pattern);
  return match ? match[1] : "";
}

/**
 * Split the XML into individual <item> (RSS 2.0) or <entry> (Atom) blocks.
 */
function splitItems(xml) {
  // RSS 2.0 uses <item>, Atom uses <entry>
  const rssItems = xml.match(/<item[\s>][\s\S]*?<\/item>/gi);
  if (rssItems && rssItems.length) return { items: rssItems, format: "rss" };

  const atomEntries = xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi);
  if (atomEntries && atomEntries.length)
    return { items: atomEntries, format: "atom" };

  return { items: [], format: "unknown" };
}

/**
 * Parse a single RSS <item> block into a plain object.
 */
function parseRssItem(block) {
  const item = {
    title: getTagContent(block, "title"),
    link: getTagContent(block, "link"),
    description: getTagContent(block, "description"),
    content: getTagContent(block, "content:encoded") || getTagContent(block, "content"),
    pubDate: getTagContent(block, "pubDate"),
    guid: getTagContent(block, "guid"),
    author: getTagContent(block, "author") || getTagContent(block, "dc:creator"),
    categories: getAllTagContents(block, "category"),
  };

  // Enclosure (podcast / image attachments)
  const enclosureUrl = getAttr(block, "enclosure", "url");
  if (enclosureUrl) {
    item.enclosure = {
      url: enclosureUrl,
      type: getAttr(block, "enclosure", "type"),
      length: getAttr(block, "enclosure", "length"),
    };
  }

  // Try to extract a featured image from content or description
  const imgMatch = (item.content || item.description || "").match(
    /<img[^>]+src=["']([^"']+)["']/i
  );
  if (imgMatch) {
    item.image = imgMatch[1];
  }

  return item;
}

/**
 * Parse a single Atom <entry> block into a plain object.
 */
function parseAtomEntry(block) {
  const linkHref =
    getAttr(block, 'link[^>]*rel=["\']*alternate', "href") ||
    getAttr(block, "link", "href");

  const entry = {
    title: getTagContent(block, "title"),
    link: linkHref,
    description: getTagContent(block, "summary"),
    content: getTagContent(block, "content"),
    pubDate: getTagContent(block, "published") || getTagContent(block, "updated"),
    guid: getTagContent(block, "id"),
    author: getTagContent(block, "name"), // inside <author><name>
    categories: getAllTagContents(block, "category"),
  };

  const imgMatch = (entry.content || entry.description || "").match(
    /<img[^>]+src=["']([^"']+)["']/i
  );
  if (imgMatch) {
    entry.image = imgMatch[1];
  }

  return entry;
}

/**
 * Parse the full RSS/Atom XML string into a JSON-friendly structure.
 */
function parseXmlFeed(xml) {
  const { items, format } = splitItems(xml);

  // Channel / feed-level metadata
  const feed = {
    title: getTagContent(xml, "title"),
    link: getTagContent(xml, "link"),
    description:
      getTagContent(xml, "description") || getTagContent(xml, "subtitle"),
    language: getTagContent(xml, "language"),
    lastBuildDate:
      getTagContent(xml, "lastBuildDate") || getTagContent(xml, "updated"),
    format,
    itemCount: items.length,
    items:
      format === "atom"
        ? items.map(parseAtomEntry)
        : items.map(parseRssItem),
  };

  return feed;
}

// ---------------------------------------------------------------------------
// Vercel handler
// ---------------------------------------------------------------------------

export default async function handler(req, res) {
  // CORS – allow any origin so the JSON can be consumed from any frontend
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  // Cache the response for 10 minutes on Vercel's edge + browser
  res.setHeader(
    "Cache-Control",
    "s-maxage=600, stale-while-revalidate=300"
  );

  try {
    const response = await fetch(RSS_URL, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "application/rss+xml, application/xml, text/xml, */*",
      },
    });

    if (!response.ok) {
      return res.status(502).json({
        error: "Failed to fetch RSS feed",
        status: response.status,
        statusText: response.statusText,
      });
    }

    const xml = await response.text();
    const feed = parseXmlFeed(xml);

    // Optional ?limit=N
    const limit = parseInt(req.query?.limit, 10);
    if (limit > 0) {
      feed.items = feed.items.slice(0, limit);
      feed.itemCount = feed.items.length;
    }

    // Optional ?pretty=1
    const pretty = req.query?.pretty === "1";
    const body = JSON.stringify(feed, null, pretty ? 2 : undefined);

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.status(200).send(body);
  } catch (err) {
    return res.status(500).json({
      error: "Internal error while processing the RSS feed",
      message: err.message,
    });
  }
}
