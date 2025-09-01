// Conversation Visualizer JavaScript

let conversationData = null;
let currentTimezone = 'Asia/Shanghai';

// DOM elements
const urlInput = document.getElementById('url-input');
const jsonInput = document.getElementById('json-input');
const fetchBtn = document.getElementById('fetch-btn');
const parseBtn = document.getElementById('parse-btn');
const timezoneSelect = document.getElementById('timezone-select');
const statusDiv = document.getElementById('status');
const conversationView = document.getElementById('conversation-view');
const timeline = document.getElementById('timeline');

// Filter elements
const showUser = document.getElementById('show-user');
const showAssistant = document.getElementById('show-assistant');
const showTool = document.getElementById('show-tool');

// Stat elements
const totalMessages = document.getElementById('total-messages');
const userMessages = document.getElementById('user-messages');
const assistantMessages = document.getElementById('assistant-messages');
const toolMessages = document.getElementById('tool-messages');
const timeSpan = document.getElementById('time-span');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  fetchBtn.addEventListener('click', handleFetchFromUrl);
  parseBtn.addEventListener('click', handleParseJson);
  timezoneSelect.addEventListener('change', handleTimezoneChange);
  
  // Filter event listeners
  showUser.addEventListener('change', applyFilters);
  showAssistant.addEventListener('change', applyFilters);
  showTool.addEventListener('change', applyFilters);
  
  // Enter key support
  urlInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') fetchBtn.click();
  });
  
  // Check for URL parameters
  const urlParams = new URLSearchParams(window.location.search);
  const threadId = urlParams.get('thread_id');
  if (threadId) {
    // Auto-load conversation from thread_id
    autoLoadConversation(threadId);
  }
});

function showStatus(message, type) {
  statusDiv.textContent = message;
  statusDiv.className = `status ${type}`;
  statusDiv.classList.remove('hidden');
}

function hideStatus() {
  statusDiv.classList.add('hidden');
}

function autoLoadConversation(threadId) {
  // Construct Societas URL and auto-fetch
  const shareUrl = `https://staging.societas.ms/share/${threadId}`;
  urlInput.value = shareUrl;
  
  showStatus(`自动加载对话: ${threadId.substring(0, 8)}...`, 'loading');
  handleFetchFromUrl();
}

function parseIso(ts) {
  // Same parsing logic as in the main app
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

function formatDate(date, timezone) {
  if (!date) return '-';
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(date);
  } catch (e) {
    return date.toISOString();
  }
}

function formatRelativeTime(date) {
  const now = new Date();
  const diff = now - date;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) return `${days}天前`;
  if (hours > 0) return `${hours}小时前`;
  if (minutes > 0) return `${minutes}分钟前`;
  return '刚刚';
}

async function handleFetchFromUrl() {
  const url = urlInput.value.trim();
  if (!url) {
    showStatus('请输入URL', 'error');
    return;
  }

  if (!url.includes('staging.societas.ms/share/')) {
    showStatus('请输入有效的Societas分享链接', 'error');
    return;
  }

  const threadId = url.split('/share/')[1];
  if (!threadId) {
    showStatus('无法提取thread ID', 'error');
    return;
  }

  fetchBtn.disabled = true;
  showStatus('正在获取对话数据...', 'loading');

  try {
    const postData = JSON.stringify({ thread_id: threadId });
    const proxyUrl = `https://corsproxy.io/?https://staging.societas.ms/api/message/list`;
    
    const response = await fetch(proxyUrl, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      },
      body: postData
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    
    if (!data || !Array.isArray(data.data)) {
      throw new Error('无效的数据格式');
    }

    showStatus(`成功获取 ${data.data.length} 条消息`, 'success');
    processConversationData(data);
    
  } catch (error) {
    console.error('获取数据失败:', error);
    showStatus(`获取数据失败: ${error.message}`, 'error');
  } finally {
    fetchBtn.disabled = false;
  }
}

function handleParseJson() {
  const jsonText = jsonInput.value.trim();
  if (!jsonText) {
    showStatus('请输入JSON数据', 'error');
    return;
  }

  try {
    const data = JSON.parse(jsonText);
    
    if (!data || !Array.isArray(data.data)) {
      throw new Error('无效的数据格式，期望 { data: [...] }');
    }

    showStatus(`成功解析 ${data.data.length} 条消息`, 'success');
    processConversationData(data);
    
  } catch (error) {
    console.error('解析JSON失败:', error);
    showStatus(`解析JSON失败: ${error.message}`, 'error');
  }
}

function processConversationData(data) {
  conversationData = data.data.map(msg => ({
    ...msg,
    parsedDate: parseIso(msg.created_at),
    metadata: typeof msg.metadata === 'string' ? 
      (() => { try { return JSON.parse(msg.metadata); } catch { return {}; } })() : 
      (msg.metadata || {})
  })).sort((a, b) => a.parsedDate - b.parsedDate);

  // Identify the initial user prompt
  identifyInitialPrompt();
  
  updateStats();
  renderConversation();
  conversationView.classList.remove('hidden');
  
  // Hide status after a delay
  setTimeout(hideStatus, 3000);
}

function identifyInitialPrompt() {
  if (!conversationData || conversationData.length === 0) return;
  
  // Find the first user message
  const firstUserMessage = conversationData.find(msg => msg.role === 'user' || msg.type === 'user');
  
  if (firstUserMessage) {
    firstUserMessage.isInitialPrompt = true;
    console.log('Initial prompt identified:', firstUserMessage.content);
  }
}

function updateStats() {
  if (!conversationData) return;

  const stats = conversationData.reduce((acc, msg) => {
    acc.total++;
    acc[msg.type] = (acc[msg.type] || 0) + 1;
    return acc;
  }, { total: 0 });

  totalMessages.textContent = stats.total;
  userMessages.textContent = stats.user || 0;
  assistantMessages.textContent = stats.assistant || 0;
  toolMessages.textContent = stats.tool || 0;

  // Calculate time span
  if (conversationData.length > 0) {
    const firstMsg = conversationData[0];
    const lastMsg = conversationData[conversationData.length - 1];
    const span = lastMsg.parsedDate - firstMsg.parsedDate;
    const hours = Math.floor(span / 3600000);
    const minutes = Math.floor((span % 3600000) / 60000);
    
    if (hours > 0) {
      timeSpan.textContent = `${hours}小时${minutes}分钟`;
    } else {
      timeSpan.textContent = `${minutes}分钟`;
    }
  }
}

function renderConversation() {
  if (!conversationData) return;

  // Render the initial prompt section
  renderPromptSection();
  
  timeline.innerHTML = '';
  
  conversationData.forEach((msg, index) => {
    const messageEl = createMessageElement(msg, index);
    timeline.appendChild(messageEl);
  });
}

function renderPromptSection() {
  const promptSection = document.getElementById('prompt-section');
  const promptText = document.getElementById('prompt-text');
  const promptTime = document.getElementById('prompt-time');
  
  // Find the initial user message
  const initialPrompt = conversationData.find(msg => msg.isInitialPrompt);
  
  if (initialPrompt && initialPrompt.content) {
    // Extract pure text content from the user's message
    const pureContent = extractPureTextContent(initialPrompt.content);
    promptText.innerHTML = formatTextContent(pureContent);
    promptTime.textContent = formatDate(initialPrompt.parsedDate, currentTimezone);
    promptSection.classList.remove('hidden');
  } else {
    promptSection.classList.add('hidden');
  }
}

function extractPureTextContent(content) {
  if (!content) return '';
  
  // If content is a string, clean it and return
  if (typeof content === 'string') {
    return cleanContentText(content);
  }
  
  // If content is an array (multi-modal), extract text parts
  if (Array.isArray(content)) {
    const textParts = content
      .filter(item => item.type === 'text' || typeof item === 'string')
      .map(item => typeof item === 'string' ? item : item.text || item.content || '')
      .join(' ');
    return cleanContentText(textParts);
  }
  
  // If content is an object with text property
  if (typeof content === 'object' && content.text) {
    return cleanContentText(content.text);
  }
  
  // Fallback: convert to string and clean
  return cleanContentText(String(content));
}

function createMessageElement(msg, index) {
  const messageDiv = document.createElement('div');
  let className = `message ${msg.type || msg.role}`;
  
  // Add special class for initial prompt
  if (msg.isInitialPrompt) {
    className += ' initial-prompt';
  }
  
  messageDiv.className = className;
  messageDiv.dataset.type = msg.type || msg.role;

  const content = getMessageContent(msg);
  const formattedTime = formatDate(msg.parsedDate, currentTimezone);
  const relativeTime = formatRelativeTime(msg.parsedDate);

  // Special header for initial prompt
  let headerContent = '';
  if (msg.isInitialPrompt) {
    headerContent = `
      <div class="message-header">
        <span class="message-type ${msg.type || msg.role}">💬 ${getTypeLabel(msg.type || msg.role)} - 初始提示</span>
        <span class="message-time">${formattedTime} (${relativeTime})</span>
      </div>
    `;
  } else {
    headerContent = `
      <div class="message-header">
        <span class="message-type ${msg.type || msg.role}">${getTypeLabel(msg.type || msg.role)}</span>
        <span class="message-time">${formattedTime} (${relativeTime})</span>
      </div>
    `;
  }

  messageDiv.innerHTML = `
    ${headerContent}
    <div class="message-content">
      ${content}
    </div>
    ${createMetadataSection(msg)}
  `;

  return messageDiv;
}

function getTypeLabel(type) {
  const labels = {
    'user': '用户',
    'assistant': '助手',
    'tool': '工具'
  };
  return labels[type] || type;
}

function getMessageContent(msg) {
  let contentHtml = '';
  
  // Role information
  if (msg.role) {
    contentHtml += `<div class="message-role">
      <span class="role-label">角色:</span> 
      <span class="role-value">${msg.role}</span>
    </div>`;
  }

  // Main content
  if (msg.content) {
    contentHtml += '<div class="message-main-content">';
    contentHtml += renderContent(msg.content);
    contentHtml += '</div>';
  } else {
    contentHtml += '<div class="message-main-content"><em>无内容</em></div>';
  }

  // Tool calls
  if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
    contentHtml += '<div class="tool-calls-section">';
    contentHtml += '<h4 class="section-title">🔧 工具调用</h4>';
    msg.tool_calls.forEach((toolCall, index) => {
      contentHtml += renderToolCall(toolCall, index);
    });
    contentHtml += '</div>';
  }

  // Function call (legacy format)
  if (msg.function_call) {
    contentHtml += '<div class="function-call-section">';
    contentHtml += '<h4 class="section-title">⚙️ 函数调用</h4>';
    contentHtml += renderFunctionCall(msg.function_call);
    contentHtml += '</div>';
  }

  return contentHtml;
}

function renderContent(content) {
  if (!content) return '<em>无内容</em>';

  // Handle string content
  if (typeof content === 'string') {
    return renderStringContent(content);
  }

  // Handle array content (multi-modal)
  if (Array.isArray(content)) {
    return content.map((item, index) => {
      if (typeof item === 'string') {
        return formatTextContent(item);
      }
      
      if (typeof item === 'object' && item.type) {
        return renderContentItem(item, index);
      }
      
      return createCollapsibleJson(`Content Item ${index + 1}`, item);
    }).join('');
  }

  // Handle object content
  return createCollapsibleJson('Content', content);
}

function renderStringContent(content) {
  // Try to detect if content has structured parts
  const parts = analyzeContentStructure(content);
  
  if (parts.hasStructuredContent) {
    let html = '';
    
    // Render main content
    if (parts.mainContent) {
      html += `<div class="main-content">${formatTextContent(parts.mainContent)}</div>`;
    }
    
    // Render structured parts as collapsible sections
    if (parts.structuredParts.length > 0) {
      parts.structuredParts.forEach((part, index) => {
        html += createCollapsibleJson(
          part.title || `Structured Data ${index + 1}`, 
          part.data, 
          false
        );
      });
    }
    
    return html;
  }
  
  // Simple text content
  return formatTextContent(content);
}

function analyzeContentStructure(content) {
  const result = {
    hasStructuredContent: false,
    mainContent: content,
    structuredParts: []
  };
  
  // Look for JSON-like structures at the end
  const jsonArrayPattern = /\n\n(\[\"[^"]+\"(?:,\s*\"[^"]+\")*\])\s*$/;
  const jsonObjectPattern = /\n\n(\{[^}]+\})\s*$/;
  
  let match = content.match(jsonArrayPattern);
  if (match) {
    try {
      const parsed = JSON.parse(match[1]);
      result.hasStructuredContent = true;
      result.mainContent = content.replace(jsonArrayPattern, '').trim();
      result.structuredParts.push({
        title: 'Search Terms',
        data: parsed
      });
    } catch (e) {
      // If parsing fails, treat as regular content
    }
  }
  
  match = content.match(jsonObjectPattern);
  if (match) {
    try {
      const parsed = JSON.parse(match[1]);
      result.hasStructuredContent = true;
      result.mainContent = content.replace(jsonObjectPattern, '').trim();
      result.structuredParts.push({
        title: 'Structured Data',
        data: parsed
      });
    } catch (e) {
      // If parsing fails, treat as regular content
    }
  }
  
  return result;
}

function renderContentItem(item, index) {
  const itemId = `content-item-${Date.now()}-${index}`;
  
  switch (item.type) {
    case 'text':
      return `<div class="content-item text-content">
        ${formatTextContent(item.text || '')}
      </div>`;
      
    case 'image':
    case 'image_url':
      const imageUrl = item.image_url?.url || item.url || '';
      return `<div class="content-item image-content">
        <div class="content-type-label">🖼️ 图片</div>
        ${imageUrl ? `<img src="${imageUrl}" alt="Content Image" class="content-image" />` : '<em>无图片URL</em>'}
        ${item.detail ? `<div class="image-detail">详细程度: ${item.detail}</div>` : ''}
      </div>`;
      
    case 'audio':
      return `<div class="content-item audio-content">
        <div class="content-type-label">🎵 音频</div>
        ${item.input ? `<audio controls><source src="${item.input}" /></audio>` : '<em>无音频数据</em>'}
      </div>`;
      
    default:
      return `<div class="content-item unknown-content">
        <div class="content-type-label">❓ ${item.type || 'Unknown'}</div>
        ${createCollapsibleJson(`${item.type || 'Unknown'} Content`, item)}
      </div>`;
  }
}

function renderToolCall(toolCall, index) {
  const toolId = `tool-call-${Date.now()}-${index}`;
  
  return `<div class="tool-call-item">
    <div class="tool-call-header">
      <span class="tool-call-name">${toolCall.function?.name || toolCall.name || 'Unknown Tool'}</span>
      <span class="tool-call-id">${toolCall.id || ''}</span>
    </div>
    
    ${toolCall.function?.arguments ? `
      <div class="tool-arguments">
        <div class="section-subtitle">参数:</div>
        ${renderToolArguments(toolCall.function.arguments)}
      </div>
    ` : ''}
    
    ${toolCall.type ? `<div class="tool-type">类型: ${toolCall.type}</div>` : ''}
  </div>`;
}

function renderToolArguments(args) {
  if (typeof args === 'string') {
    try {
      const parsed = JSON.parse(args);
      return createCollapsibleJson('Arguments', parsed, true);
    } catch {
      return `<div class="tool-args-text">${formatTextContent(args)}</div>`;
    }
  }
  
  return createCollapsibleJson('Arguments', args, true);
}

function renderFunctionCall(functionCall) {
  return `<div class="function-call-item">
    <div class="function-name">${functionCall.name || 'Unknown Function'}</div>
    ${functionCall.arguments ? `
      <div class="function-arguments">
        <div class="section-subtitle">参数:</div>
        ${renderToolArguments(functionCall.arguments)}
      </div>
    ` : ''}
  </div>`;
}

function createCollapsibleJson(title, data, defaultOpen = false) {
  const id = `json-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const jsonString = JSON.stringify(data, null, 2);
  
  return `<div class="collapsible-json">
    <div class="json-header" onclick="toggleJsonCollapse('${id}')">
      <span class="json-toggle ${defaultOpen ? 'open' : ''}" id="toggle-${id}">▶</span>
      <span class="json-title">${title}</span>
      <span class="json-size">(${jsonString.length} chars)</span>
    </div>
    <div class="json-content ${defaultOpen ? 'open' : ''}" id="content-${id}">
      <pre class="json-data">${escapeHtml(jsonString)}</pre>
    </div>
  </div>`;
}

function toggleJsonCollapse(id) {
  const toggle = document.getElementById(`toggle-${id}`);
  const content = document.getElementById(`content-${id}`);
  
  if (content.classList.contains('open')) {
    content.classList.remove('open');
    toggle.classList.remove('open');
    toggle.textContent = '▶';
  } else {
    content.classList.add('open');
    toggle.classList.add('open');
    toggle.textContent = '▼';
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatTextContent(text) {
  if (!text) return '';
  
  // Clean up the content first
  text = cleanContentText(text);
  
  // Basic formatting
  text = text
    .replace(/\n/g, '<br>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/```([^```]+)```/g, '<pre>$1</pre>');
  
  return text;
}

function cleanContentText(text) {
  if (!text || typeof text !== 'string') return text;
  
  // Remove standalone JSON arrays that look like search terms or identifiers
  // Pattern: ["term1", "term2", "term3"] at the end of content
  text = text.replace(/\n\n\[\"[^"]+\"(?:,\s*\"[^"]+\")*\]\s*$/g, '');
  
  // Remove similar patterns at the beginning
  text = text.replace(/^\[\"[^"]+\"(?:,\s*\"[^"]+\")*\]\s*\n\n/g, '');
  
  // Remove standalone bracketed content that looks like identifiers
  text = text.replace(/\n\n\[[^\]]+\]\s*$/g, '');
  
  // Remove multiple consecutive newlines (more than 2)
  text = text.replace(/\n{3,}/g, '\n\n');
  
  // Trim whitespace
  text = text.trim();
  
  return text;
}

function createMetadataSection(msg) {
  const metadataItems = [];
  
  // Basic message info
  const basicInfo = {
    '消息ID': msg.message_id,
    '线程ID': msg.thread_id,
    '消息类型': msg.type
  };

  // Add custom metadata
  if (msg.metadata && Object.keys(msg.metadata).length > 0) {
    const metaKeys = Object.keys(msg.metadata).filter(key => 
      !['message_id', 'thread_id', 'type'].includes(key)
    );
    
    metaKeys.forEach(key => {
      basicInfo[key] = typeof msg.metadata[key] === 'object' ? 
        JSON.stringify(msg.metadata[key]) : 
        msg.metadata[key];
    });
  }

  return createCollapsibleJson('元数据', basicInfo, false);
}

function handleTimezoneChange() {
  currentTimezone = timezoneSelect.value;
  if (conversationData) {
    renderPromptSection(); // Update prompt section time
    renderConversation();
  }
}

function applyFilters() {
  const showUserChecked = showUser.checked;
  const showAssistantChecked = showAssistant.checked;
  const showToolChecked = showTool.checked;

  const messages = timeline.querySelectorAll('.message');
  
  messages.forEach(msg => {
    const type = msg.dataset.type;
    let show = false;
    
    if (type === 'user' && showUserChecked) show = true;
    if (type === 'assistant' && showAssistantChecked) show = true;
    if (type === 'tool' && showToolChecked) show = true;
    
    msg.style.display = show ? 'block' : 'none';
  });
}
