const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const Sentiment = require('sentiment');
const { franc } = require('franc');

const app = express();
app.use(cors());

const sentiment = new Sentiment();
const FETCH_INTERVAL = 8000;

let cachedPosts = [];
let seenIds = new Set();
let activeTags = [];
let fetchGeneration = 0;
let isFetching = false;

async function fetchPostsForTag(tag, generation) {
  const allPosts = [];
  let url = `https://mastodon.social/api/v1/timelines/tag/${tag}?limit=40`;
  
  for (let page = 0; page < 5; page++) {
    if (generation !== fetchGeneration) {

        return [];

    }
    try {
      const r = await fetch(url);
      const d = await r.json();
      if (!Array.isArray(d) || d.length === 0) break;
      
      const oldest = new Date(d[d.length - 1].created_at).getTime();
      allPosts.push(...d);
      
      if (Date.now() - oldest > 3000000) break;
      
      const linkHeader = r.headers.get('link');
      if (!linkHeader) break;
      const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
      if (!match) break;
      url = match[1];
      
      await new Promise(res => setTimeout(res, 500));
    } catch(e) {
      console.warn(`Tag ${tag} pagina fallita`);
      break;
    }
  }
  return allPosts;
}

async function fetchPosts( generation = fetchGeneration) {
  try {
    if (isFetching) return;
isFetching = true;
    const dataArrays = [];
    for (const tag of activeTags) {
      const posts = await fetchPostsForTag(tag, generation);
      if (posts.length > 0) dataArrays.push(posts);
      await new Promise(res => setTimeout(res, 300));
    }
    const posts = dataArrays.flat();
    const newPosts = [];
    for (const post of posts) {
      if (generation !== fetchGeneration) {

        return;

    }
      const postAge = Date.now() - new Date(post.created_at).getTime();
      if (!seenIds.has(post.id) && post.content && postAge < 3600000) {
        seenIds.add(post.id);
        const text = post.content
          .replace(/<[^>]+>/g, '')
          .replace(/https?:\/\/\S+/g, '')
          .replace(/\s+/g, ' ')
          .trim();
        
        if (text.length > 0) {
          const sentimentScore = Math.max(-1, Math.min(1, sentiment.analyze(text).comparative * 5));
          
          const detectedLanguage = 
            post.language || 
            (franc(text) !== "und" ? franc(text) : "unknown");
          console.log({
    mastodon: post.language,
    franc: franc(text),
    detected: detectedLanguage,
    text: text.slice(0, 80)
});
          
          newPosts.push({
          id: post.id,
          user: post.account.acct,
          text: text,
          sentiment: sentimentScore,
          language: detectedLanguage,
          timestamp: new Date(post.created_at).getTime(),
          time: new Date(post.created_at).toLocaleTimeString('it-IT', { timeZone: 'Europe/Rome' }),
          date: new Date(post.created_at).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' })
          });
        }
      }
    }
    if (generation !== fetchGeneration) {
  isFetching = false;
  return;
}

if (newPosts.length > 0) {
  cachedPosts = [...newPosts, ...cachedPosts].slice(0, 500);

  console.log(
    `${new Date().toLocaleTimeString()} → ${newPosts.length} nuovi post`
  );
}
  } catch (err) {

  console.error('Errore fetch Mastodon:', err.message);

} finally {

  isFetching = false;
  }
}

app.get('/api/posts', (req, res) => {
  const since = parseInt(req.query.since || '0');
  const newPosts = cachedPosts.slice(0, cachedPosts.length - since);
  const limit = since === 0 ? 50 : 10;
  res.json(newPosts.slice(0, limit));
});

app.post('/api/tags', express.json(), async (req, res) => {

  const { tags } = req.body;

  if (!Array.isArray(tags) || tags.length === 0) {
    return res.status(400).json({
      error: 'tags non validi'
    });
  }

fetchGeneration++;
isFetching = false;
activeTags = tags;
cachedPosts = [];
seenIds = new Set();
  
  console.log('Tag aggiornati:', activeTags);

  try {

    await fetchPosts(fetchGeneration);

    res.json({ ok: true });

  } catch (err) {

    console.error(err);

    res.status(500).json({
      error: 'errore interno'
    });

  }

});

fetchPosts(fetchGeneration);
setInterval(() => {
    fetchPosts(fetchGeneration);
}, FETCH_INTERVAL);
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server avviato su porta ${PORT}`));