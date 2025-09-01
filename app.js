/* global Intl */

function parseIso(ts) {
  // Normalize Z to +00:00, pad/truncate fractional seconds to 6
  ts = ts.replace('Z', '+00:00');
  const tIndex = ts.indexOf('T');
  const posPlus = ts.lastIndexOf('+');
  const posMinus = ts.lastIndexOf('-');
  const tzPos = Math.max(posPlus, posMinus);
  const hasTz = tzPos !== -1 && tzPos > tIndex;
  const main = hasTz ? ts.slice(0, tzPos) : ts;
  const tz = hasTz ? ts.slice(tzPos) : '';
  const dot = main.indexOf('.');
  let norm;
  if (dot !== -1) {
    const secs = main.slice(0, dot);
    let frac = main.slice(dot + 1);
    frac = (frac + '000000').slice(0, 6);
    norm = `${secs}.${frac}${tz}`;
  } else {
    norm = `${main}${tz}`;
  }
  return new Date(norm);
}

function computeRuns(messages) {
  const runs = [];
  for (let i = 0; i < messages.length; i += 1) {
    const m = messages[i];
    if (m.type === 'assistant') {
      const start = parseIso(m.created_at);
      let end = start;
      let j = i + 1;
      while (j < messages.length) {
        const n = messages[j];
        if (n.type === 'assistant' || n.type === 'user') break;
        if (n.type === 'tool') {
          // Only count tool results that map back to this assistant message
          const meta = typeof n.metadata === 'string' ? safeJson(n.metadata) : (n.metadata || {});
          if (meta && meta.assistant_message_id === m.message_id) {
            end = parseIso(n.created_at);
          }
        }
        j += 1;
      }
      runs.push({
        run_id: (typeof m.metadata === 'string' ? safeJson(m.metadata)?.thread_run_id : m.metadata?.thread_run_id) || null,
        assistant_message_id: m.message_id,
        start: start,
        end: end,
        duration_seconds: Math.max(0, (end - start) / 1000),
      });
      i = j - 1;
    }
  }
  return runs;
}

function computeCycles(messages) {
  const cycles = [];
  let currentUser = null;
  let lastNonUser = null;
  for (const m of messages) {
    if (m.type === 'user') {
      if (currentUser && lastNonUser && lastNonUser >= parseIso(currentUser.created_at)) {
        const start = parseIso(currentUser.created_at);
        cycles.push({
          trigger_user_message_id: currentUser.message_id,
          start,
          end: lastNonUser,
          duration_seconds: (lastNonUser - start) / 1000,
        });
      }
      currentUser = m;
      lastNonUser = null;
    } else if (currentUser) {
      lastNonUser = parseIso(m.created_at);
    }
  }
  if (currentUser && lastNonUser && lastNonUser >= parseIso(currentUser.created_at)) {
    const start = parseIso(currentUser.created_at);
    cycles.push({
      trigger_user_message_id: currentUser.message_id,
      start,
      end: lastNonUser,
      duration_seconds: (lastNonUser - start) / 1000,
    });
  }
  return cycles;
}

function safeJson(x) {
  try { return JSON.parse(x); } catch (e) { return null; }
}

function parseMessages(raw) {
  const meta = typeof raw.metadata === 'string' ? safeJson(raw.metadata) : raw.metadata;
  return {
    message_id: raw.message_id,
    thread_id: raw.thread_id,
    type: raw.type,
    created_at: raw.created_at,
    metadata: meta || {},
  };
}

function summarizeWindows(windows) {
  if (!windows.length) return { total: 0, start: null, end: null };
  const total = windows.reduce((s, w) => s + w.duration_seconds, 0);
  const start = new Date(Math.min(...windows.map(w => w.start.getTime())));
  const end = new Date(Math.max(...windows.map(w => w.end.getTime())));
  return { total, start, end };
}

function formatDate(d, tz) {
  if (!d) return '-';
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    }).format(d).replace(',', '');
  } catch (e) {
    return d.toISOString();
  }
}

function toCsv(rows, headers) {
  const esc = v => {
    const s = String(v ?? '');
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  };
  const head = headers.map(h => esc(h.label)).join(',');
  const body = rows.map(r => headers.map(h => esc(h.get(r))).join(',')).join('\n');
  return head + '\n' + body + '\n';
}

function render(results, tz) {
  const summaryEl = document.getElementById('summary');
  const runsEl = document.getElementById('runs');
  const cyclesEl = document.getElementById('cycles');
  summaryEl.classList.remove('hidden');
  runsEl.classList.remove('hidden');
  cyclesEl.classList.remove('hidden');

  document.getElementById('first-msg').textContent = formatDate(results.first, tz);
  document.getElementById('last-msg').textContent = formatDate(results.last, tz);
  document.getElementById('run-total').textContent = results.runSum.total.toFixed(3) + ' s';
  document.getElementById('cycle-total').textContent = results.cycleSum.total.toFixed(3) + ' s';

  const runsBody = document.getElementById('runs-tbody');
  runsBody.innerHTML = '';
  results.runs.forEach((r, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${i + 1}</td>
      <td>${r.run_id ?? ''}</td>
      <td>${r.assistant_message_id}</td>
      <td>${formatDate(r.start, tz)}</td>
      <td>${formatDate(r.end, tz)}</td>
      <td>${r.duration_seconds.toFixed(3)}</td>
    `;
    runsBody.appendChild(tr);
  });

  const cycBody = document.getElementById('cycles-tbody');
  cycBody.innerHTML = '';
  results.cycles.forEach((c, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${i + 1}</td>
      <td>${c.trigger_user_message_id}</td>
      <td>${formatDate(c.start, tz)}</td>
      <td>${formatDate(c.end, tz)}</td>
      <td>${c.duration_seconds.toFixed(3)}</td>
    `;
    cycBody.appendChild(tr);
  });

  document.getElementById('export-runs').onclick = () => {
    const csv = toCsv(results.runs, [
      { label: '#', get: (_r, i) => i + 1 },
      { label: 'run_id', get: r => r.run_id ?? '' },
      { label: 'assistant_message_id', get: r => r.assistant_message_id },
      { label: 'start', get: r => r.start.toISOString() },
      { label: 'end', get: r => r.end.toISOString() },
      { label: 'duration_seconds', get: r => r.duration_seconds.toFixed(3) },
    ]);
    download('runs.csv', csv);
  };

  document.getElementById('export-cycles').onclick = () => {
    const csv = toCsv(results.cycles, [
      { label: '#', get: (_r, i) => i + 1 },
      { label: 'trigger_user_message_id', get: r => r.trigger_user_message_id },
      { label: 'start', get: r => r.start.toISOString() },
      { label: 'end', get: r => r.end.toISOString() },
      { label: 'duration_seconds', get: r => r.duration_seconds.toFixed(3) },
    ]);
    download('cycles.csv', csv);
  };
}

function download(filename, text) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function handleRawJson(data) {
  if (!data || !Array.isArray(data.data)) throw new Error('Invalid JSON: expected { data: [...] }');
  const messages = data.data.map(parseMessages).sort((a, b) => parseIso(a.created_at) - parseIso(b.created_at));
  const runs = computeRuns(messages);
  const cycles = computeCycles(messages);
  const first = parseIso(messages[0].created_at);
  const last = parseIso(messages[messages.length - 1].created_at);
  const runSum = summarizeWindows(runs);
  const cycleSum = summarizeWindows(cycles);
  return { messages, runs, cycles, first, last, runSum, cycleSum };
}

function init() {
  const tzSelect = document.getElementById('tz-select');
  const fileInput = document.getElementById('file-input');
  const jsonText = document.getElementById('json-text');
  const btnParseText = document.getElementById('btn-parse-text');
  const btnClear = document.getElementById('btn-clear');
  const urlInput = document.getElementById('url-input');
  const btnFetchUrl = document.getElementById('btn-fetch-url');
  const urlStatus = document.getElementById('url-status');

  const process = (data) => {
    const results = handleRawJson(data);
    render(results, tzSelect.value);
  };

  fileInput.addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const text = await f.text();
    process(JSON.parse(text));
  });

  btnParseText.addEventListener('click', () => {
    if (!jsonText.value.trim()) return;
    process(JSON.parse(jsonText.value));
  });

  tzSelect.addEventListener('change', () => {
    // re-render using last results if available
    // simplest: trigger a parse again if text present
    // or keep last results in memory
    // For simplicity, re-parse textarea if present
    if (jsonText.value.trim()) {
      try {
        const data = JSON.parse(jsonText.value);
        const results = handleRawJson(data);
        render(results, tzSelect.value);
      } catch (_) {}
    }
  });

  btnClear.addEventListener('click', () => {
    document.getElementById('summary').classList.add('hidden');
    document.getElementById('runs').classList.add('hidden');
    document.getElementById('cycles').classList.add('hidden');
    document.getElementById('runs-tbody').innerHTML = '';
    document.getElementById('cycles-tbody').innerHTML = '';
  });

  // drag & drop support
  window.addEventListener('dragover', (e) => { e.preventDefault(); });
  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (!f) return;
    const text = await f.text();
    process(JSON.parse(text));
  });

  // URL fetch support
  btnFetchUrl.addEventListener('click', async () => {
    const url = urlInput.value.trim();
    if (!url) {
      showUrlStatus('Please enter a URL', 'error');
      return;
    }

    try {
      showUrlStatus('Fetching data...', 'loading');
      
      // Extract thread ID from the share URL and construct API URL
      let apiUrl = url;
      let requestOptions = {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        },
        mode: 'cors'
      };

      if (url.includes('staging.societas.ms/share/')) {
        const threadId = url.split('/share/')[1];
        if (threadId) {
          showUrlStatus(`Extracted thread ID: ${threadId}, trying different API endpoints...`, 'loading');
          
          // Try different possible API endpoints
          const possibleEndpoints = [
            `https://staging.societas.ms/api/messages/${threadId}`,
            `https://staging.societas.ms/api/thread/${threadId}/messages`,
            `https://staging.societas.ms/api/conversation/${threadId}`,
            `https://staging.societas.ms/api/chat/${threadId}`,
            `https://staging.societas.ms/share/${threadId}.json`,
            `https://staging.societas.ms/api/share/${threadId}`
          ];
          
          // Start with the first endpoint
          apiUrl = possibleEndpoints[0];
          requestOptions = {
            method: 'GET',
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json',
              'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            },
            mode: 'cors'
          };
        }
      }
      
      // Try multiple endpoints if we have a Societas URL
      let response;
      let lastError;
      
      if (url.includes('staging.societas.ms/share/')) {
        const threadId = url.split('/share/')[1];
        
        showUrlStatus(`Extracted thread ID: ${threadId}, using corsproxy.io...`, 'loading');
        
        const postData = JSON.stringify({ thread_id: threadId });
        
        // Use corsproxy.io directly since we know it works
        const proxyUrl = `https://corsproxy.io/?https://staging.societas.ms/api/message/list`;
        
        try {
          response = await fetch(proxyUrl, {
            method: 'POST',
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json',
              'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            },
            body: postData
          });
          
          if (response.ok) {
            console.log(`Success with corsproxy.io`);
          } else {
            console.log(`Corsproxy.io failed: ${response.status} ${response.statusText}`);
            throw new Error(`Corsproxy.io failed: ${response.status} ${response.statusText}`);
          }
        } catch (corsproxyError) {
          console.log('Corsproxy.io failed, trying fallback methods...', corsproxyError);
          
          // Try fallback methods
          const fallbacks = [
            // Try allorigins with GET method as fallback
            {
              name: 'allorigins GET',
              url: `https://api.allorigins.win/raw?url=${encodeURIComponent(`https://staging.societas.ms/api/message/list?thread_id=${threadId}`)}`,
              method: 'GET',
              body: null
            },
            // Try cors-anywhere if available
            {
              name: 'cors-anywhere',
              url: `https://cors-anywhere.herokuapp.com/https://staging.societas.ms/api/message/list`,
              method: 'POST',
              body: postData
            }
          ];
          
          for (let i = 0; i < fallbacks.length; i++) {
            const fallback = fallbacks[i];
            showUrlStatus(`Trying fallback ${i + 1}/${fallbacks.length}: ${fallback.name}...`, 'loading');
            
            try {
              response = await fetch(fallback.url, {
                method: fallback.method,
                headers: {
                  'Accept': 'application/json',
                  'Content-Type': 'application/json',
                  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                },
                body: fallback.body
              });
              
              if (response.ok) {
                console.log(`Success with fallback ${fallback.name}: ${fallback.url}`);
                break;
              } else {
                console.log(`Fallback ${fallback.name} failed: ${response.status}`);
                lastError = new Error(`Fallback ${fallback.name} failed: ${response.status}`);
              }
            } catch (fallbackError) {
              console.log(`Fallback ${fallback.name} error:`, fallbackError);
              lastError = fallbackError;
            }
          }
        }
      } else {
        // For non-Societas URLs, use the original logic
        response = await fetch(apiUrl, requestOptions);
      }
      
      if (!response || !response.ok) {
        throw lastError || new Error(`All endpoints failed`);
      }
      
      const data = await response.json();
      console.log('Fetched data structure:', data);
      console.log('Data keys:', Object.keys(data));
      
      // Check if data structure matches expected format
      if (!data || !Array.isArray(data.data)) {
        console.error('Unexpected data structure:', data);
        throw new Error(`Invalid data structure: expected { data: [...] }, got ${JSON.stringify(data).substring(0, 100)}...`);
      }
      
      showUrlStatus('Data fetched successfully!', 'success');
      process(data);
      
    } catch (error) {
      console.error('Error fetching URL:', error);
      
      // If direct fetch fails, try using a CORS proxy
      if (error.message.includes('CORS') || error.message.includes('Failed to fetch')) {
        try {
          showUrlStatus('Trying CORS proxy...', 'loading');
          
          // Use proxy for the API URL if we extracted a thread ID
          let proxyUrl;
          let proxyOptions = {
            method: 'GET',
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json',
              'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
          };

          if (url.includes('staging.societas.ms/share/')) {
            const threadId = url.split('/share/')[1];
            // For POST requests through proxy, we need to use a different approach
            // Let's try the allorigins proxy with POST method
            proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent('https://staging.societas.ms/api/message/list')}`;
            
            // Unfortunately, allorigins doesn't support POST with body through URL params
            // Let's try a different proxy approach or fallback to GET with query params
            const getApiUrl = `https://staging.societas.ms/api/message/list?thread_id=${threadId}`;
            proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(getApiUrl)}`;
          } else {
            proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
          }
          
          const proxyResponse = await fetch(proxyUrl, proxyOptions);
          if (!proxyResponse.ok) {
            throw new Error(`Proxy HTTP ${proxyResponse.status}`);
          }
          
          const data = await proxyResponse.json();
          console.log('Proxy fetched data structure:', data);
          console.log('Proxy data keys:', Object.keys(data));
          
          // Check if data structure matches expected format
          if (!data || !Array.isArray(data.data)) {
            console.error('Unexpected proxy data structure:', data);
            throw new Error(`Invalid proxy data structure: expected { data: [...] }, got ${JSON.stringify(data).substring(0, 100)}...`);
          }
          
          showUrlStatus('Data fetched via proxy!', 'success');
          process(data);
          
        } catch (proxyError) {
          console.error('Proxy fetch failed:', proxyError);
          showUrlStatus(`Failed to fetch data: ${proxyError.message}`, 'error');
        }
      } else {
        showUrlStatus(`Failed to fetch data: ${error.message}`, 'error');
      }
    }
  });

  // Handle Enter key in URL input
  urlInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      btnFetchUrl.click();
    }
  });
}

function showUrlStatus(message, type) {
  const urlStatus = document.getElementById('url-status');
  urlStatus.textContent = message;
  urlStatus.className = `status-message ${type}`;
}

window.addEventListener('DOMContentLoaded', init); 