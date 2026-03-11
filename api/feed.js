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

function getTagContent(xml, tag) {
  const pattern = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const match = xml.match(pattern);
  if (!match) return "";
  let content = match[1].trim();
  const cdata = content.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  if (cdata) content = cdata[1].trim();
  return content;
}

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

function getAttr(xml, tag, attr) {
  const pattern = new RegExp(`<${tag}[^>]*?${attr}=["']([^"']*)["']`, "i");
  const match = xml.match(pattern);
  return match ? match[1] : "";
}

function splitItems(xml) {
  const rssItems = xml.match(/<item[\s>][\s\S]*?<\/item>/gi);
  if (rssItems && rssItems.length) return { items: rssItems, format: "rss" };
  const atomEntries = xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi);
  if (atomEntries && atomEntries.length)
    return { items: atomEntries, format: "atom" };
  return { items: [], format: "unknown" };
}

function stripHtml(html) {
  if (!html) return "";
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#8217;/g, "\u2019")
    .replace(/&#8216;/g, "\u2018")
    .replace(/&#8220;/g, "\u201C")
    .replace(/&#8221;/g, "\u201D")
    .replace(/&#8211;/g, "\u2013")
    .replace(/&#8212;/g, "\u2014")
    .replace(/&nbsp;/g, " ")
    .replace(/&#\d+;/g, "")
    .replace(/&\w+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractExcerpt(html, maxLength = 200) {
  if (!html) return "";
  const excerptMatch = html.match(/article-excerpt[^>]*>([\s\S]*?)<\//i);
  if (excerptMatch) {
    const clean = stripHtml(excerptMatch[1]);
    if (clean.length > 0) {
      return clean.length > maxLength
        ? clean.substring(0, maxLength - 3) + "..."
        : clean;
    }
  }
  const clean = stripHtml(html);
  return clean.length > maxLength
    ? clean.substring(0, maxLength - 3) + "..."
    : clean;
}

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

  item.excerpt = extractExcerpt(item.content || item.description, 200);

  const enclosureUrl = getAttr(block, "enclosure", "url");
  if (enclosureUrl) {
    item.enclosure = {
      url: enclosureUrl,
      type: getAttr(block, "enclosure", "type"),
      length: getAttr(block, "enclosure", "length"),
    };
  }

  const imgMatch = (item.content || item.description || "").match(
    /<img[^>]+src=["']([^"']+)["']/i
  );
  if (imgMatch) {
    item.image = imgMatch[1];
  }

  return item;
}

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
    author: getTagContent(block, "name"),
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

function parseXmlFeed(xml) {
  const { items, format } = splitItems(xml);

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
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  // Cache: 1 hour on Vercel edge, 30 min in browser, stale-while-revalidate 10 min
  res.setHeader(
    "Cache-Control",
    "public, max-age=1800, s-maxage=3600, stale-while-revalidate=600"
  );

  try {
    const response = await fetch(RSS_URL, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
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
      cause: err.cause?.message || null,
      code: err.cause?.code || null,
    });
  }
}
