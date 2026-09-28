// Huangguo XPTV compatibility build
// Preserve signed image URLs; tolerant list/detail parsing; play URL fallbacks.

const SITE = 'https://huangguoai.com'

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
}

function absUrl(u) {
  if (!u) return ''
  u = String(u).replace(/&amp;/g, '&').trim()
  if (u.startsWith('//')) return 'https:' + u
  if (/^https?:\/\//i.test(u)) return u
  try { return new URL(u, SITE).href } catch (e) { return u }
}

function imgSrc(u) { return absUrl(u) }

async function fetchHtml(url, referer) {
  const headers = Object.assign({}, HEADERS)
  if (referer) headers.Referer = referer
  const resp = await $fetch.get(absUrl(url), { headers })
  const data = resp && resp.data
  const html = typeof data === 'string' ? data : (data == null ? '' : JSON.stringify(data))
  if (!html) console.error('[huangguo] empty response:', url)
  return html
}

function stripTags(s) {
  return String(s || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
}

function uniqBy(arr, keyFn) {
  const out = [], seen = new Set()
  for (const x of arr) {
    const k = keyFn(x)
    if (!k || seen.has(k)) continue
    seen.add(k)
    out.push(x)
  }
  return out
}

function parseCards(html) {
  const out = []
  const re = /<a\b[^>]*href=["']([^"']*\/detail\/\d+\/?[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi
  let m
  while ((m = re.exec(html))) {
    const href = absUrl(m[1])
    const body = m[2]
    const im = body.match(/<img\b[^>]*(?:src|data-src|data-original)=["']([^"']+)["'][^>]*>/i)
    const tm = body.match(/class=["'][^"']*(?:title|name)[^"']*["'][^>]*>([\s\S]*?)<\//i)
    let title = tm ? stripTags(tm[1]) : ''
    if (!title) {
      const alt = body.match(/<img\b[^>]*alt=["']([^"']+)["']/i)
      if (alt) title = stripTags(alt[1])
    }
    if (!title) title = stripTags(body).slice(0, 80)
    if (title) out.push({ name: title, pic: im ? imgSrc(im[1]) : '', url: href })
  }
  return uniqBy(out, x => x.url)
}

function parseEpisodes(html) {
  const eps = []
  const re = /<a\b[^>]*href=["']([^"']*\/video\/\d+(?:\/\d+)?\/?[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi
  let m
  while ((m = re.exec(html))) {
    const url = absUrl(m[1])
    let name = stripTags(m[2])
    if (!name) {
      const n = url.match(/\/video\/\d+\/(\d+)/)
      name = n ? '第' + n[1] + '集' : '播放'
    }
    eps.push({ name, url })
  }
  return uniqBy(eps, x => x.url)
}

function decodeEscaped(s) {
  return String(s || '').replace(/\\u0026/g, '&').replace(/\\\//g, '/').replace(/&amp;/g, '&')
}

function collectMediaUrls(html) {
  const urls = []
  const add = u => {
    u = decodeEscaped(u).trim()
    if (/^https?:\/\//i.test(u) && /(?:\.m3u8|\.mp4)(?:[?#]|$)/i.test(u)) urls.push(u)
  }
  let m
  const fieldRe = /["'](?:videoSrc|playUrl|play_url|url|src)["']\s*:\s*["']([^"']+)["']/gi
  while ((m = fieldRe.exec(html))) add(m[1])
  const mediaRe = /https?:\\?\/\\?\/[^"'<>\s]+?(?:\.m3u8|\.mp4)(?:\?[^"'<>\s]*)?/gi
  while ((m = mediaRe.exec(html))) add(m[0])
  return uniqBy(urls, x => x)
}

async function getHome() {
  try {
    const html = await fetchHtml(SITE + '/')
    const cards = parseCards(html)
    console.log('[huangguo] home cards:', cards.length)
    return jsonify({ list: cards })
  } catch (e) {
    console.error('[huangguo] getHome:', e)
    return jsonify({ list: [] })
  }
}

async function getCategory(tid, pg) {
  try {
    pg = Number(pg || 1)
    const candidates = [
      SITE + '/type/' + tid + (pg > 1 ? '/page/' + pg + '/' : '/'),
      SITE + '/category/' + tid + (pg > 1 ? '/page/' + pg + '/' : '/')
    ]
    for (const u of candidates) {
      try {
        const html = await fetchHtml(u, SITE + '/')
        const cards = parseCards(html)
        if (cards.length) return jsonify({ list: cards })
      } catch (e) {}
    }
    return jsonify({ list: [] })
  } catch (e) {
    console.error('[huangguo] getCategory:', e)
    return jsonify({ list: [] })
  }
}

async function search(keyword, pg) {
  try {
    pg = Number(pg || 1)
    const urls = [
      SITE + '/search/' + encodeURIComponent(keyword) + '/',
      SITE + '/?s=' + encodeURIComponent(keyword),
      SITE + '/search?keyword=' + encodeURIComponent(keyword) + '&page=' + pg
    ]
    for (const u of urls) {
      try {
        const html = await fetchHtml(u, SITE + '/')
        const cards = parseCards(html)
        if (cards.length) return jsonify({ list: cards })
      } catch (e) {}
    }
    return jsonify({ list: [] })
  } catch (e) {
    console.error('[huangguo] search:', e)
    return jsonify({ list: [] })
  }
}

async function getDetail(url) {
  try {
    url = absUrl(url)
    const html = await fetchHtml(url, SITE + '/')
    const titleMatch = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i) || html.match(/<title>([\s\S]*?)<\/title>/i)
    const imageMatch = html.match(/<img\b[^>]*(?:src|data-src|data-original)=["']([^"']+)["'][^>]*>/i)
    const episodes = parseEpisodes(html)
    console.log('[huangguo] detail episodes:', episodes.length)
    return jsonify({
      name: titleMatch ? stripTags(titleMatch[1]) : '',
      pic: imageMatch ? imgSrc(imageMatch[1]) : '',
      desc: '',
      playlist: episodes
    })
  } catch (e) {
    console.error('[huangguo] getDetail:', e)
    return jsonify({ playlist: [] })
  }
}

async function getPlayinfo(url) {
  try {
    url = absUrl(url)
    const html = await fetchHtml(url, url)
    let urls = []
    const sm = html.match(/<script\b[^>]*id=["']videoInitialData["'][^>]*>([\s\S]*?)<\/script>/i)
    if (sm) {
      try {
        const data = JSON.parse(sm[1].trim())
        const ep = (url.match(/\/video\/\d+\/(\d+)/) || [])[1]
        if (data && data.epPlaySrcs) {
          if (ep && data.epPlaySrcs[ep]) urls.push(data.epPlaySrcs[ep])
          else if (Array.isArray(data.epPlaySrcs)) urls.push(...data.epPlaySrcs)
          else if (typeof data.epPlaySrcs === 'object') urls.push(...Object.values(data.epPlaySrcs))
        }
        if (data && data.videoSrc) urls.push(data.videoSrc)
      } catch (e) {
        console.error('[huangguo] videoInitialData parse failed:', e)
      }
    }
    urls = urls.map(decodeEscaped).filter(Boolean)
    urls.push(...collectMediaUrls(html))
    urls = uniqBy(urls, x => x)
    console.log('[huangguo] play urls:', urls.length)
    return jsonify({ urls })
  } catch (e) {
    console.error('[huangguo] getPlayinfo:', e)
    return jsonify({ urls: [] })
  }
}

async function home() { return getHome() }
async function category(tid, pg) { return getCategory(tid, pg) }
async function detail(url) { return getDetail(url) }
async function play(url) { return getPlayinfo(url) }
async function getSearch(keyword, pg) { return search(keyword, pg) }
