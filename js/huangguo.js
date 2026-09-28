// 黄果短剧 huangguoai.com
// HTML 刮削源：首頁/分類/搜尋皆為 .hg-card-grid > .hg-drama-card 卡片；
// 排行榜為 .hg-rank-list > .hg-rank-item；詳情頁 .hg-web-detail__ep-grid 給集數；
// 播放頁 <script id="videoInitialData"> 內嵌 JSON，epPlaySrcs[集數] / videoSrc 直接給 m3u8。
// 保留封面 URL 的 auth_key；删除签名会使 CDN 直接拒绝请求。
// 若 CDN 返回加密图片字节，XPTV 的图片加载器仍需解密代理才能显示封面。
const UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
const SITE = 'https://huangguoai.com'

const HEADERS = {
    'User-Agent': UA,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    Referer: SITE + '/',
}
const TABS = [
    { name: '首页', id: 'home' },
    { name: 'AI成人短剧', id: 'ai-duanju' },
    { name: 'AI成人漫剧', id: 'ai-manju' },
    { name: 'AI换脸', id: 'ai-huanlian' },
    { name: 'AI魔改', id: 'ai-mogai' },
    { name: '排行榜', id: 'ranks/hot' },
]

// ---------- 工具 ----------
function fix(u) {
    u = decodeHtml(String(u || '').trim())
    if (!u) return ''
    if (u.indexOf('//') === 0) return 'https:' + u
    if (u.indexOf('/') === 0) return SITE + u
    return u
}
function imgSrc(u) {
    return fix(u)
}
function decodeHtml(s) {
    return String(s || '').replace(/&(#(?:x[0-9a-f]+|\d+)|amp|quot|apos|lt|gt|nbsp);/gi, function (_, entity) {
        const e = entity.toLowerCase()
        if (e === 'amp') return '&'
        if (e === 'quot') return '"'
        if (e === 'apos') return "'"
        if (e === 'lt') return '<'
        if (e === 'gt') return '>'
        if (e === 'nbsp') return ' '
        const n = e.charAt(1) === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
        return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : _
    })
}

function stripTags(s) {
    return decodeHtml(String(s || '').replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim()
}
async function fetchHtml(url, referer) {
    const headers = referer ? Object.assign({}, HEADERS, { Referer: referer }) : HEADERS
    const resp = await $fetch.get(url, { headers })
    const data = resp && typeof resp === 'object' && 'data' in resp ? resp.data : resp
    return typeof data === 'string' ? data : data == null ? '' : JSON.stringify(data)
}
function elementBody(html, openingTag) {
    if (!openingTag) return ''
    const start = openingTag.index + openingTag[0].length
    const tags = /<\/?div\b[^>]*>/gi
    tags.lastIndex = start
    let depth = 1
    let tag
    while ((tag = tags.exec(html)) !== null) {
        depth += /^<\/div/i.test(tag[0]) ? -1 : 1
        if (depth === 0) return html.slice(start, tag.index)
    }
    return html.slice(start)
}
// ---------- 卡片解析 ----------
function gridSlices(html, allGrids) {
    // .hg-card-grid 區塊；allGrids=true 取全部，否則只取第一個（主列表）
    const re = /<div\b[^>]*class="[^"]*\bhg-card-grid\b[^"]*"[^>]*>/g
    const starts = []
    let m
    while ((m = re.exec(html)) !== null) starts.push(m.index + m[0].length)
    if (!starts.length) return []
    const slices = []
    const n = allGrids ? starts.length : Math.min(1, starts.length)
    for (let i = 0; i < n; i++) {
        const to = i + 1 < starts.length ? starts[i + 1] : html.length
        slices.push(html.slice(starts[i], to))
    }
    return slices
}
function cardBlocks(slice) {
    const re = /<div\b[^>]*class="[^"]*\bhg-drama-card\b[^"]*"[^>]*>/g
    const starts = []
    let m
    while ((m = re.exec(slice)) !== null) starts.push(m.index + m[0].length)
    const blocks = []
    for (let i = 0; i < starts.length; i++) {
        const to = i + 1 < starts.length ? starts[i + 1] : slice.length
        blocks.push(slice.slice(starts[i], to))
    }
    return blocks
}
function parseCardBlock(block) {
    const a = block.match(/href="[^"]*\/detail\/(\d+)\/[^"]*"/)
    if (!a) return null
    const vid = a[1]
    const imgM = block.match(/data-src="([^"]+)"/) || block.match(/src="([^"]+)"/)
    let title = ''
    const t = block.match(/<([a-z][\w-]*)\b[^>]*class="[^"]*\bhg-drama-card__title\b[^"]*"[^>]*>([\s\S]*?)<\/\1>/i)
    if (t) title = stripTags(t[2])
    if (!title) {
        const tt = block.match(/<a[^>]+href="[^"]*\/detail\/\d+\/"[^>]*>([\s\S]*?)<\/a>/)
        if (tt) title = stripTags(tt[1])
    }
    if (!title) return null
    const ep = block.match(/hg-drama-card__episode[^>]*>([\s\S]*?)<\/span>/)
    const score = block.match(/hg-drama-card__score[^>]*>([\s\S]*?)<\/span>/)
    const rem = ep ? ep[1].trim() : ''
    const sc = score ? score[1].trim() : ''
    let remarks = ''
    if (rem && sc) remarks = rem + ' · ' + sc
    else remarks = rem || sc
    return {
        vod_id: vid,
        vod_name: title,
        vod_pic: imgSrc(imgM ? imgM[1] : ''),
        vod_remarks: remarks,
        ext: { id: vid },
    }
}
function parseGridCards(html, allGrids) {
    if (!html) return []
    const list = []
    const seen = {}
    const slices = gridSlices(html, allGrids)
    for (const slice of slices) {
        for (const block of cardBlocks(slice)) {
            try {
                const item = parseCardBlock(block)
                if (!item || seen[item.vod_id]) continue
                seen[item.vod_id] = true
                list.push(item)
            } catch (e) {}
        }
    }
    return list
}
function parseLinkCards(html) {
    const list = []
    const seen = {}
    const re = /<a\b[^>]*href=["'][^"']*\/detail\/(\d+)\/[^"']*["'][^>]*>[\s\S]*?<\/a>/gi
    let m
    while ((m = re.exec(html)) !== null) {
        const id = m[1]
        if (seen[id]) continue
        const tag = m[0]
        let title = stripTags(tag)
        if (!title) {
            const attr = tag.match(/\b(?:title|alt)=["']([^"']+)["']/i)
            title = attr ? decodeHtml(attr[1]).trim() : ''
        }
        if (!title || title.length > 80) continue
        const img = tag.match(/\b(?:data-src|src)=["']([^"']+)["']/i)
        list.push({ vod_id: id, vod_name: title, vod_pic: imgSrc(img ? img[1] : ''), vod_remarks: '', ext: { id: id } })
        seen[id] = true
    }
    return list
}
function diagnosticCard(message) {
    return { vod_id: 'diagnostic', vod_name: '黄果抓取诊断：' + String(message).slice(0, 100), vod_pic: '', vod_remarks: '请把这条文字发给我', ext: { id: 'diagnostic' } }
}
function cardsOrDiagnostic(html, primary) {
    const list = primary.length ? primary : parseLinkCards(html)
    if (list.length) return list
    const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [,''])[1]
    const detailCount = (html.match(/\/detail\/\d+\//g) || []).length
    return [diagnosticCard('页面长度=' + html.length + '；详情链接=' + detailCount + '；标题=' + stripTags(title).slice(0, 30))]
}
// ---------- 排行榜解析 ----------
function parseRanks(html) {
    if (!html) return []
    const listM = html.match(/<div\b[^>]*class="[^"]*\bhg-rank-list\b[^"]*"[^>]*>/)
    const from = listM ? listM.index + listM[0].length : 0
    const slice = html.slice(from)
    const re = /<div\b[^>]*class="[^"]*\bhg-rank-item\b[^"]*"[^>]*>/g
    const starts = []
    let m
    while ((m = re.exec(slice)) !== null) starts.push(m.index + m[0].length)
    const list = []
    const seen = {}
    for (let i = 0; i < starts.length; i++) {
        const to = i + 1 < starts.length ? starts[i + 1] : slice.length
        const block = slice.slice(starts[i], to)
        try {
            const a = block.match(/href="[^"]*\/detail\/(\d+)\/[^"]*"/)
            if (!a || seen[a[1]]) continue
            seen[a[1]] = true
            const imgM = block.match(/data-src="([^"]+)"/) || block.match(/src="([^"]+)"/)
            let title = ''
            const t = block.match(/<([a-z][\w-]*)\b[^>]*class="[^"]*\bhg-rank-item__title\b[^"]*"[^>]*>([\s\S]*?)<\/\1>/i)
            if (t) title = stripTags(t[2])
            if (!title) {
                const tt = block.match(/<a[^>]+href="[^"]*\/detail\/\d+\/"[^>]*>([\s\S]*?)<\/a>/)
                if (tt) title = stripTags(tt[1])
            }
            if (!title) continue
            const tags = block.match(/hg-rank-item__tags[^>]*>([\s\S]*?)<\/div>/)
            list.push({
                vod_id: a[1],
                vod_name: title,
                vod_pic: imgSrc(imgM ? imgM[1] : ''),
                vod_remarks: tags ? stripTags(tags[1]) : '',
                ext: { id: a[1] },
            })
        } catch (e) {}
    }
    return list
}
// ---------- 介面 ----------
async function getLocalInfo() {
    return jsonify({ ver: 2, name: '黄果短剧', api: 'csp_huangguo', type: 3 })
}

async function getConfig() {
    return jsonify({
        ver: 2,
        title: '黄果短剧',
        site: SITE,
        tabs: TABS.map((t) => ({ name: t.name, ext: { id: t.id } })),
    })
}
async function getCards(ext) {
    ext = argsify(ext)
    const id = String(ext.id || 'home').replace(/^\//, '')
    const page = Math.max(1, parseInt(ext.page) || 1)
    try {
        if (id === 'home') {
            const html = await fetchHtml(SITE + '/')
            return jsonify({ list: cardsOrDiagnostic(html, parseGridCards(html, true)), page: page })
        }
        const url = SITE + '/' + id + '/' + (page > 1 ? page + '/' : '')
        const html = await fetchHtml(url)
        if (id.indexOf('rank') !== -1) {
            return jsonify({ list: cardsOrDiagnostic(html, parseRanks(html)), page: page })
        }
        return jsonify({ list: cardsOrDiagnostic(html, parseGridCards(html, false)), page: page })
    } catch (e) {
        console.error('getCards error:', e)
        return jsonify({ list: [diagnosticCard('请求失败：' + (e && e.message || e))], page: page })
    }
}
async function getTracks(ext) {
    ext = argsify(ext)
    const id = String(ext.id || '')
    if (!/^\d+$/.test(id)) return jsonify({ list: [] })
    try {
        const html = await fetchHtml(SITE + '/detail/' + id + '/')
        const tracks = []
        const gridM = /<div\b[^>]*class="[^"]*\bhg-web-detail__ep-grid\b[^"]*"[^>]*>/i.exec(html)
        if (gridM) {
            const grid = elementBody(html, gridM)
            const are = /<a\b[^>]*>[\s\S]*?<\/a>/g
            let m
            while ((m = are.exec(grid)) !== null) {
                const tag = m[0]
                const hrefM = tag.match(/href="([^"]+)"/)
                if (!hrefM) continue
                const href = hrefM[1]
                const eidM = tag.match(/data-ep-id="([^"]*)"/)
                const eid = eidM ? eidM[1] : ''
                const name = eid ? '第' + eid + '集' : stripTags(tag)
                tracks.push({ name: name, ext: { url: fix(href), ep: eid } })
            }
        }
        if (!tracks.length) {
            const playM = html.match(/<a\b[^>]*class="[^"]*\bhg-web-detail__play\b[^"]*"[^>]*href="([^"]+)"/)
            if (playM) {
                tracks.push({ name: '第1集', ext: { url: fix(playM[1]), ep: '' } })
            }
        }
        if (!tracks.length) return jsonify({ list: [] })
        return jsonify({ list: [{ title: '黄果短剧', tracks: tracks }] })
    } catch (e) {
        console.error('getTracks error:', e)
        return jsonify({ list: [] })
    }
}
async function getPlayinfo(ext) {
    ext = argsify(ext)
    const url = fix(ext.url || '')
    const ep = String(ext.ep || '1')
    if (!/^https?:\/\//i.test(url)) return jsonify({ urls: [] })
    try {
        const html = await fetchHtml(url, SITE)
        let play = ''
        const m = html.match(/<script\b[^>]*id=["']videoInitialData["'][^>]*>([\s\S]*?)<\/script>/i)
        if (m) {
            try {
                const data = JSON.parse(m[1])
                const srcs = (data && data.epPlaySrcs) || {}
                const source = srcs[ep] || (data && data.videoSrc) || ''
                play = typeof source === 'string' ? source : source && (source.url || source.src) || ''
            } catch (e) {}
        }
        if (play) {
            play = fix(play.replace(/\\u0026/g, '&').replace(/\\\//g, '/'))
            if (!/^https?:\/\//i.test(play)) {
                const mm = play.match(/(https?:\/\/[^\s"']+)/)
                play = mm ? mm[1] : ''
            }
        }
        if (!play) return jsonify({ urls: [] })
        return jsonify({
            urls: [play],
            headers: [{ 'User-Agent': UA, Referer: SITE + '/' }],
        })
    } catch (e) {
        console.error('getPlayinfo error:', e)
        return jsonify({ urls: [] })
    }
}
async function search(ext) {
    ext = argsify(ext)
    const kw = String(ext.text || ext.wd || '').trim()
    if (!kw) return jsonify({ list: [], page: 1 })
    try {
        const html = await fetchHtml(SITE + '/search/video/' + encodeURIComponent(kw) + '/')
        return jsonify({ list: cardsOrDiagnostic(html, parseGridCards(html, false)), page: 1 })
    } catch (e) {
        console.error('search error:', e)
        return jsonify({ list: [diagnosticCard('搜索失败：' + (e && e.message || e))], page: 1 })
    }
}
