# Koeppel Auto Group — RSS to JSON

A zero-dependency Vercel serverless function that fetches the Koeppel Auto Group blog RSS feed and returns it as clean JSON.

## Endpoints

| URL | Description |
|---|---|
| `/api/feed` | Full feed as JSON |
| `/api/feed?limit=5` | First 5 items only |
| `/api/feed?pretty=1` | Pretty-printed JSON |
| `/` | Redirects to `/api/feed?pretty=1` |

## Response shape

```json
{
  "title": "Koeppel Auto Group Blog",
  "link": "https://koeppelautogroup.com/blog/",
  "description": "...",
  "language": "en",
  "lastBuildDate": "...",
  "format": "rss",
  "itemCount": 25,
  "items": [
    {
      "title": "Article title",
      "link": "https://koeppelautogroup.com/blog/...",
      "description": "Short summary…",
      "content": "Full HTML content…",
      "pubDate": "Mon, 10 Mar 2026 12:00:00 GMT",
      "guid": "...",
      "author": "...",
      "categories": ["Service", "Tips"],
      "image": "https://..."
    }
  ]
}
```

## Deploy to Vercel from GitHub

1. **Push this repo to GitHub**
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin git@github.com:YOUR_USER/koeppel-rss-to-json.git
   git push -u origin main
   ```

2. **Import in Vercel**
   - Go to [vercel.com/new](https://vercel.com/new)
   - Select the GitHub repo
   - Click **Deploy** — no build settings needed

3. **Done!** Your API is live at `https://your-project.vercel.app/api/feed`

## Local development

```bash
npm i -g vercel
vercel dev
# → http://localhost:3000/api/feed
```

## Notes

- **No dependencies** — uses native `fetch` and lightweight regex-based XML parsing.
- **CORS enabled** — the endpoint can be called from any frontend.
- **Edge-cached** — responses are cached for 10 minutes on Vercel's CDN (`s-maxage=600`).
- Supports both RSS 2.0 and Atom feed formats automatically.
