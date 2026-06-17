/**
 * m3u-worker.js — Web Worker for M3U parsing
 *
 * FIX: Channel IDs are source-prefixed in worker (matching main thread)
 *      so favorites never bleed across playlists.
 * FIX: PONG sent immediately on PING so main-thread gate opens before
 *      any PARSE messages arrive.
 */

self.onmessage = function(e) {
  const { type, content, sourceId, reqId } = e.data || {};

  if (type === 'PING') {
    self.postMessage({ type: 'PONG' });
    return;
  }

  if (type === 'PARSE') {
    try {
      const channels = parseM3U(content, sourceId);
      self.postMessage({ type: 'RESULT', channels, sourceId, reqId });
    } catch (err) {
      self.postMessage({
        type: 'ERROR',
        message: String(err && err.message ? err.message : err),
        sourceId,
        reqId,
      });
    }
  }
};

function parseM3U(content, sourceId) {
  if (!content || typeof content !== 'string') return [];
  const prefix   = sourceId ? `${sourceId}:` : '';
  const channels = [];
  let current    = null;
  const lines    = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (line.startsWith('#EXTINF:')) {
      current = parseExtInf(line);
    } else if (line.startsWith('#')) {
      continue;
    } else if (current &&
      (line.startsWith('http') || line.startsWith('rtmp') || line.startsWith('rtp'))) {
      current.url = line;
      current.id  = `${prefix}ch_${channels.length}`;
      channels.push(current);
      current = null;
    }
  }
  return channels;
}

function parseExtInf(line) {
  function safe(re) { try { return (line.match(re) || [])[1] || ''; } catch { return ''; } }
  const lc          = line.lastIndexOf(',');
  const displayName = lc >= 0 ? line.slice(lc + 1).trim() : '';
  return {
    id:       '',
    url:      '',
    name:     (safe(/tvg-name="([^"]*)"/)    || displayName || 'Unknown').trim(),
    logo:      safe(/tvg-logo="([^"]*)"/),
    group:    (safe(/group-title="([^"]*)"/) || 'General').trim(),
    language:  safe(/tvg-language="([^"]*)"/),
    country:   safe(/tvg-country="([^"]*)"/),
  };
}
