const API = '/admin-api';
const state = { token: sessionStorage.getItem('zz-admin-token') || '', view: 'dashboard', data: {}, filters: {}, page: 1 };
const titles = {
  dashboard: ['OVERVIEW', '运行总览'], settings: ['SYSTEM CONFIG', '功能配置'], versions: ['RELEASE NOTES', '更新日志'],
  users: ['USER DATA', '用户管理'], issues: ['ROADMAP & FIXES', 'Issue 待办'],
  samples: ['NOTIFICATION SAMPLES', '通知样本'],
  moderation: ['PRIVATE REVIEW MODERATION', '举报审核'],
};
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
const formatDate = (value) => value ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—';
const compact = (value) => new Intl.NumberFormat('zh-CN', { notation: value > 9999 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(value || 0);
const labels = { todo: '待处理', planned: '已规划', in_progress: '处理中', fixed: '已修复', closed: '已关闭', low: '低', medium: '中', high: '高', urgent: '紧急', bug: '缺陷', feature: '功能', improvement: '优化', maintenance: '维护' };

async function request(path, options = {}) {
  const headers = { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}), ...options.headers };
  const response = await fetch(`${API}${path}`, { ...options, headers });
  let payload = null;
  try { payload = await response.json(); } catch { payload = {}; }
  if (response.status === 401 && path !== '/auth/login') { logout(); throw new Error('会话已失效，请重新登录'); }
  if (!response.ok || payload?.success === false) throw new Error(payload?.message || payload?.error?.message || '请求失败');
  return payload.data;
}

function toast(message, isError = false) {
  const el = $('#toast'); el.textContent = message; el.className = `toast show${isError ? ' error' : ''}`;
  clearTimeout(toast.timer); toast.timer = setTimeout(() => { el.className = 'toast'; }, 2600);
}

function logout() {
  closeDrawer(); $('#editor-form').replaceChildren();
  state.token = ''; sessionStorage.removeItem('zz-admin-token'); $('#app-view').hidden = true; $('#login-view').hidden = false;
}

async function login(event) {
  event.preventDefault(); const form = new FormData(event.currentTarget); const error = $('#login-error'); error.textContent = '';
  try {
    const data = await request('/auth/login', { method: 'POST', body: JSON.stringify(Object.fromEntries(form)) });
    state.token = data.token; sessionStorage.setItem('zz-admin-token', data.token); await boot();
  } catch (err) { error.textContent = err.message; }
}

async function boot() {
  try {
    const session = await request('/session'); $('#admin-name').textContent = session.username; $('#login-view').hidden = true; $('#app-view').hidden = false; await switchView(state.view);
  } catch (error) { logout(); if (state.token) toast(error.message, true); }
}

async function switchView(view) {
  state.view = view; state.page = 1; state.filters = {};
  $$('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.view === view));
  $('#page-kicker').textContent = titles[view][0]; $('#page-title').textContent = titles[view][1];
  $('.sidebar').classList.remove('open'); await loadCurrent();
}

async function loadCurrent() {
  const content = $('#workspace-content'); content.innerHTML = '<div class="loading">正在同步数据…</div>';
  try {
    if (state.view === 'dashboard') return renderDashboard(await request('/dashboard'));
    if (state.view === 'settings') return renderSettings(await request('/settings'));
    if (state.view === 'versions') return renderVersions(await request('/versions'));
    if (state.view === 'users') return loadUsers();
    if (state.view === 'issues') return loadIssues();
    if (state.view === 'moderation') return await loadModeration();
    if (state.view === 'samples') return await loadSamples();
  } catch (error) { content.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`; toast(error.message, true); }
}

function metric(label, value, note, accent = false) { return `<article class="metric${accent ? ' accent' : ''}"><span>${label}</span><strong>${compact(value)}</strong><small>${note}</small></article>`; }

const sampleStatus = { queued: '进入队列', deduplicated: '重复通知', ignored: '未识别', error: '处理异常' };
function sampleParams() { return Object.fromEntries(Object.entries(state.filters).filter(([key, value]) => ['userId', 'packageName', 'ruleVersion', 'status'].includes(key) && value)); }
async function loadSamples() {
  const params = new URLSearchParams({ ...sampleParams(), page: state.page, pageSize: 20 });
  const data = await request(`/notification-samples?${params}`); state.data.samples = data;
  $('#workspace-content').innerHTML = `<div class="section-header"><div><h2>支付通知原文与提取结果</h2><p>保留支付相关样本，排队状态不代表已入账。同一通知原文的重复扫描合并保存。</p></div><div class="toolbar"><button class="create-button" data-action="export-samples">导出筛选结果 JSON</button></div></div>
    <div class="toolbar sample-filters"><input aria-label="用户 ID" data-sample-filter="userId" placeholder="用户 ID" value="${escapeHtml(state.filters.userId || '')}"/><input aria-label="来源包名" data-sample-filter="packageName" placeholder="来源包名" value="${escapeHtml(state.filters.packageName || '')}"/><input aria-label="规则版本" data-sample-filter="ruleVersion" placeholder="规则版本" value="${escapeHtml(state.filters.ruleVersion || '')}"/><select aria-label="处理状态" data-sample-filter="status"><option value="">全部状态</option>${Object.entries(sampleStatus).map(([key, value]) => `<option value="${key}" ${state.filters.status === key ? 'selected' : ''}>${value}</option>`).join('')}</select><button data-action="filter-samples">查询</button></div>
    <div class="table-scroll"><table class="data-table"><thead><tr><th>捕获时间 / 用户</th><th>来源 / 规则</th><th>处理结果</th><th>通知原文</th><th></th></tr></thead><tbody>${data.items.map((item) => `<tr><td>${formatDate(item.capturedAt)}<small>${escapeHtml(item.user?.nickname || item.user?.username || item.userId)}</small></td><td>${escapeHtml(item.packageName)}<small>${escapeHtml(item.ruleVersion)} · v${escapeHtml(item.appVersion)}</small></td><td><span class="badge">${sampleStatus[item.status] || escapeHtml(item.status)}</span><small>${item.parsed ? `${item.parsed.type === 'income' ? '收入' : '支出'} ¥${escapeHtml(item.parsed.amount)} · ${escapeHtml(item.parsed.description || '')}` : '未提取到账单'}</small></td><td class="sample-preview">${escapeHtml(item.raw.title || '')}<small>${escapeHtml(item.raw.bigText || item.raw.text || (item.raw.textLines || []).join('\n') || '无正文')}</small></td><td><div class="row-actions"><button data-action="sample-detail" data-id="${item.id}">查看完整样本</button></div></td></tr>`).join('')}</tbody></table>${data.items.length ? '' : '<div class="empty-state">暂无符合条件的通知样本。安装新版并开启自动记账后开始采集。</div>'}</div>${pagination(data)}`;
}

function showSample(id) {
  const item = state.data.samples.items.find((row) => row.id === Number(id));
  if (!item) return;
  $('#drawer-kicker').textContent = 'SAMPLE DETAIL'; $('#drawer-title').textContent = '通知原文与提取结果';
  $('#editor-form').innerHTML = `<p>${escapeHtml(item.reason)}</p><h3>原始通知字段</h3><pre class="sample-json">${escapeHtml(JSON.stringify(item.raw, null, 2))}</pre><h3>提取结果</h3><pre class="sample-json">${escapeHtml(JSON.stringify(item.parsed, null, 2))}</pre><h3>样本信息</h3><pre class="sample-json">${escapeHtml(JSON.stringify({ userId: item.userId, sampleId: item.sampleId, postedAt: item.postedAt, capturedAt: item.capturedAt, ruleVersion: item.ruleVersion, appVersion: item.appVersion }, null, 2))}</pre><button type="button" data-action="close-drawer">关闭</button>`;
  $('#drawer-backdrop').hidden = false; $('#editor-drawer').classList.add('open'); $('#editor-drawer').setAttribute('aria-hidden', 'false');
}

async function exportSamples(button) {
  button.disabled = true;
  const filters = sampleParams();
  try {
    const items = []; let afterId = 0;
    do {
      const data = await request(`/notification-samples/export?${new URLSearchParams({ ...filters, afterId })}`);
      items.push(...data.items); afterId = data.nextAfterId;
    } while (afterId !== null);
    const url = URL.createObjectURL(new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), filters, samples: items }, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `zhizhang-notification-samples-${Date.now()}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000); toast(`已导出 ${items.length} 条样本`);
  } catch (error) { toast(error.message, true); } finally { button.disabled = false; }
}
function renderDashboard(data) {
  state.data.dashboard = data; const max = Math.max(1, ...data.registrations.map((item) => item.count));
  $('#workspace-content').innerHTML = `
    <section class="metric-grid">
      ${metric('注册用户', data.metrics.users, `近 30 天 +${data.metrics.newUsers30d}`, true)}
      ${metric('活跃账户', data.metrics.activeUsers, `${data.metrics.disabledUsers} 个已停用`)}
      ${metric('账单记录', data.metrics.bills, `近 7 天新增用户 ${data.metrics.newUsers7d}`)}
      ${metric('待处理 Issue', data.metrics.openIssues, `${data.metrics.versions} 个发布版本`)}
    </section>
    <section class="dashboard-grid">
      <article class="panel"><div class="panel-head"><div><h2>近 14 天注册趋势</h2><p>按用户创建日期统计</p></div></div><div class="bars">${data.registrations.map((item) => `<div class="bar-item"><i style="height:${Math.max(3, item.count / max * 100)}%" title="${item.count}"></i><span>${item.date.slice(5).replace('-', '/')}</span></div>`).join('')}</div></article>
      <article class="panel"><div class="panel-head"><div><h2>记账来源</h2><p>当前累计数据分布</p></div></div><div class="source-list">${data.billSources.length ? data.billSources.map((item) => `<div class="source-row"><span>${escapeHtml(item.source || 'unknown')}</span><strong>${item.count}</strong></div>`).join('') : '<div class="empty-state">暂无账单数据</div>'}</div></article>
      <article class="panel"><div class="panel-head"><div><h2>最近注册</h2><p>最新进入产品的用户</p></div></div><div class="activity-list">${data.recentUsers.map((user) => `<div class="activity-row"><div><strong>${escapeHtml(user.nickname || user.username)}</strong><small>${escapeHtml(user.email || user.username)}</small></div><small>${formatDate(user.createdAt)}</small></div>`).join('')}</div></article>
      <article class="panel"><div class="panel-head"><div><h2>财务数据概况</h2><p>全体用户累计，仅展示汇总</p></div></div><div class="source-list"><div class="source-row"><span>累计收入</span><strong>¥ ${compact(data.finance.income)}</strong></div><div class="source-row"><span>累计支出</span><strong>¥ ${compact(data.finance.expense)}</strong></div><div class="source-row"><span>收支差额</span><strong>¥ ${compact((data.finance.income || 0) - (data.finance.expense || 0))}</strong></div></div></article>
    </section>`;
}

function renderSettings(items) {
  state.data.settings = items; const grouped = Object.groupBy ? Object.groupBy(items, (item) => item.category) : items.reduce((all, item) => ((all[item.category] ||= []).push(item), all), {});
  $('#workspace-content').innerHTML = `<div class="section-header"><div><h2>功能与系统配置</h2><p>集中维护产品能力开关、更新策略和支持信息。</p></div><div class="toolbar"><button class="create-button" data-action="new-setting">新增配置</button></div></div>
    <div class="settings-list">${Object.entries(grouped).map(([category, rows]) => `<div class="setting-category">${escapeHtml(category.toUpperCase())}</div>${rows.map((item) => `<div class="setting-row"><div><h3>${escapeHtml(item.key)}</h3><p>${escapeHtml(item.description || '暂无说明')}</p></div><div class="setting-value">${item.isSecret ? '••••••••' : escapeHtml(typeof item.value === 'string' ? item.value : JSON.stringify(item.value))}</div><div class="row-actions"><button data-action="edit-setting" data-id="${item.id}">编辑</button><button class="danger" data-action="delete-setting" data-id="${item.id}">删除</button></div></div>`).join('')}`).join('')}</div>`;
}

function renderVersions(items) {
  state.data.versions = items;
  $('#workspace-content').innerHTML = `<div class="section-header"><div><h2>版本与更新日志</h2><p>维护客户端读取的版本记录、下载地址和强制更新策略。</p></div><div class="toolbar"><button class="create-button" data-action="new-version">新增版本</button></div></div>
    <div class="table-scroll"><table class="data-table"><thead><tr><th>版本</th><th>更新内容</th><th>平台</th><th>策略</th><th>发布时间</th><th></th></tr></thead><tbody>${items.map((item) => `<tr><td><strong>v${escapeHtml(item.version)}</strong><small>code ${item.versionCode}</small></td><td class="issue-title"><p>${escapeHtml(item.updateLog)}</p><small>${escapeHtml(item.downloadUrl)}</small></td><td>${escapeHtml(item.platform)}</td><td><span class="badge ${item.forceUpdate ? 'urgent' : 'active'}">${item.forceUpdate ? '强制更新' : '普通更新'}</span></td><td>${formatDate(item.createdAt)}</td><td><div class="row-actions"><button data-action="edit-version" data-id="${item.id}">编辑</button><button class="danger" data-action="delete-version" data-id="${item.id}">删除</button></div></td></tr>`).join('')}</tbody></table></div>`;
}

async function loadUsers() {
  const params = new URLSearchParams({ page: state.page, pageSize: 20, status: state.filters.status || 'all', ...(state.filters.search ? { search: state.filters.search } : {}) });
  const data = await request(`/users?${params}`); state.data.users = data;
  $('#workspace-content').innerHTML = `<div class="section-header"><div><h2>用户数据</h2><p>查看使用规模、账户状态及每位用户的数据量。</p></div><div class="toolbar"><input data-filter="user-search" placeholder="搜索用户名、昵称或邮箱" value="${escapeHtml(state.filters.search || '')}"/><select data-filter="user-status"><option value="all">全部状态</option><option value="active" ${state.filters.status === 'active' ? 'selected' : ''}>正常</option><option value="disabled" ${state.filters.status === 'disabled' ? 'selected' : ''}>已停用</option></select><button class="create-button" data-action="new-user">新增用户</button></div></div>
    <div class="table-scroll"><table class="data-table"><thead><tr><th>用户</th><th>状态</th><th>账单 / 对话 / 发票</th><th>最后登录</th><th>注册时间</th><th></th></tr></thead><tbody>${data.items.map((user) => `<tr><td><strong>${escapeHtml(user.nickname || user.username)}</strong><small>${escapeHtml(user.username)} · ${escapeHtml(user.email || '未绑定邮箱')}</small></td><td><span class="badge ${user.isActive ? 'active' : 'disabled'}">${user.isActive ? '正常' : '已停用'}</span></td><td>${user._count.bills} / ${user._count.chatSessions} / ${user._count.invoices}</td><td>${formatDate(user.lastLoginAt)}</td><td>${formatDate(user.createdAt)}</td><td><div class="row-actions"><button data-action="edit-user" data-id="${user.id}">编辑</button><button class="danger" data-action="delete-user" data-id="${user.id}">删除</button></div></td></tr>`).join('')}</tbody></table></div>${pagination(data)}`;
}

async function loadIssues() {
  const params = new URLSearchParams({ page: state.page, pageSize: 20, ...(state.filters.search ? { search: state.filters.search } : {}), ...(state.filters.status ? { status: state.filters.status } : {}), ...(state.filters.priority ? { priority: state.filters.priority } : {}) });
  const data = await request(`/issues?${params}`); state.data.issues = data;
  $('#workspace-content').innerHTML = `<div class="section-header"><div><h2>准备更新与修复</h2><p>记录缺陷、功能和优化项，按目标版本推进。</p></div><div class="toolbar"><input data-filter="issue-search" placeholder="搜索 Issue" value="${escapeHtml(state.filters.search || '')}"/><select data-filter="issue-status"><option value="">全部状态</option>${['todo','planned','in_progress','fixed','closed'].map((value) => `<option value="${value}" ${state.filters.status === value ? 'selected' : ''}>${labels[value]}</option>`).join('')}</select><button class="create-button" data-action="new-issue">新增 Issue</button></div></div>
    <div class="table-scroll"><table class="data-table"><thead><tr><th>Issue</th><th>类型</th><th>状态</th><th>优先级</th><th>目标版本</th><th>更新时间</th><th></th></tr></thead><tbody>${data.items.map((item) => `<tr><td class="issue-title"><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.description || '暂无详细说明')}</p></td><td>${labels[item.type] || item.type}</td><td><span class="badge ${item.status}">${labels[item.status] || item.status}</span></td><td><span class="badge ${item.priority}">${labels[item.priority] || item.priority}</span></td><td>${escapeHtml(item.targetVersion ? `v${item.targetVersion}` : '待定')}</td><td>${formatDate(item.updatedAt)}</td><td><div class="row-actions"><button data-action="edit-issue" data-id="${item.id}">编辑</button><button class="danger" data-action="delete-issue" data-id="${item.id}">删除</button></div></td></tr>`).join('')}</tbody></table></div>${pagination(data)}`;
}

function pagination(data) { return `<div class="pagination"><span>共 ${data.total} 条，第 ${data.page} / ${Math.max(1, data.pages)} 页</span><div><button data-action="prev-page" ${data.page <= 1 ? 'disabled' : ''}>上一页</button><button data-action="next-page" ${data.page >= data.pages ? 'disabled' : ''}>下一页</button></div></div>`; }
function field(label, name, value = '', type = 'text', required = false) { return `<label><span>${label}</span><input name="${name}" type="${type}" value="${escapeHtml(value ?? '')}" ${required ? 'required' : ''}/></label>`; }
function selectField(label, name, value, options) { return `<label><span>${label}</span><select name="${name}">${options.map(([key, text]) => `<option value="${key}" ${key === value ? 'selected' : ''}>${text}</option>`).join('')}</select></label>`; }
function textarea(label, name, value = '', required = false) { return `<label><span>${label}</span><textarea name="${name}" ${required ? 'required' : ''}>${escapeHtml(value || '')}</textarea></label>`; }

const moderationLabels = { pending: '待审核', upheld: '已隐藏', dismissed: '未违规' };
let evidenceRequest = 0;
async function loadModeration() {
  const params = new URLSearchParams({ page: state.page, pageSize: 20, ...(state.filters.status ? { status: state.filters.status } : {}) });
  const data = await request(`/moderation?${params}`);
  $('#workspace-content').innerHTML = `<div class="section-header"><div><h2>私密评账举报</h2><p>按举报查看限定线程的证据。查看及处理均留有审核记录。</p></div><div class="toolbar"><select id="moderation-status" aria-label="举报状态"><option value="">全部状态</option>${Object.entries(moderationLabels).map(([value, label]) => `<option value="${value}" ${state.filters.status === value ? 'selected' : ''}>${label}</option>`).join('')}</select><button data-action="filter-moderation">筛选</button></div></div>
    <div class="table-scroll"><table class="data-table moderation-table"><thead><tr><th>举报</th><th>举报原因</th><th>状态</th><th>提交时间</th><th></th></tr></thead><tbody>${data.items.map(item => `<tr><td><strong>#${item.id}</strong><small>文字 #${item.originalMessageId} · 版本 ${item.reportedRevision}</small></td><td class="issue-title"><p>${escapeHtml(item.reason)}</p></td><td><span class="badge">${moderationLabels[item.status] || '未知'}</span></td><td>${formatDate(item.createdAt)}</td><td><div class="row-actions"><button data-action="moderation-detail" data-id="${item.id}">查看证据</button></div></td></tr>`).join('') || '<tr><td colspan="5"><div class="empty-state">没有符合条件的举报</div></td></tr>'}</tbody></table></div>${pagination(data)}`;
}

async function showEvidence(id, page = 1) {
  const requestId = ++evidenceRequest;
  const form = $('#editor-form');
  // Preserve an unfinished decision while paging through its evidence.
  const draft = form.dataset.type === 'moderation' && form.dataset.id === String(id) ? Object.fromEntries(new FormData(form)) : {};
  form.dataset.type = 'moderation'; form.dataset.id = id;
  form.innerHTML = '<div class="loading">正在读取证据…</div>';
  $('#drawer-title').textContent = `举报 #${id}`; $('#drawer-kicker').textContent = 'REVIEW EVIDENCE';
  $('#drawer-backdrop').hidden = false; $('#editor-drawer').classList.add('open'); $('#editor-drawer').setAttribute('aria-hidden', 'false');
  try {
    const data = await request(`/moderation/${id}/evidence?page=${page}&pageSize=10`);
    if (requestId !== evidenceRequest) return;
    const report = data.report;
    form.innerHTML = `<p class="moderation-notice">仅披露举报时该账单主人与该评价者之间的文字及历史版本。此处为留档证据，之后的编辑不会覆盖它。</p>
      <div class="moderation-meta"><strong>${moderationLabels[report.status]}</strong><p>举报原因：${escapeHtml(report.reason)}</p><small>提交于 ${formatDate(report.createdAt)} · 已确认披露范围 ${escapeHtml(report.disclosureVersion)}</small></div>
      ${data.items.map(item => `<article class="moderation-evidence ${item.originalMessageId === report.originalMessageId ? 'reported' : ''}"><h3>${item.originalMessageId === report.originalMessageId ? '举报目标 · ' : ''}${item.isMain ? '主评' : '回复'} #${item.originalMessageId}</h3><small>${item.authorId === report.ownerId ? '账单主人' : '评价者'} · 版本 ${item.revision} · ${formatDate(item.messageCreatedAt)}${item.withdrawn ? ' · 已撤回' : ''}${item.hidden ? ' · 已隐藏' : ''}</small><p class="moderation-body">${escapeHtml(item.body)}</p><details><summary>历史版本（${item.versions.length}）</summary>${item.versions.map(v => `<div class="moderation-version"><small>版本 ${v.revision} · ${escapeHtml(v.action)} · ${formatDate(v.createdAt)}</small><p class="moderation-body">${escapeHtml(v.body)}</p></div>`).join('')}</details></article>`).join('')}
      <div class="pagination"><span>证据 ${data.total} 条 · ${data.page}/${data.pages} 页</span><div><button type="button" data-action="evidence-page" data-id="${id}" data-page="${data.page - 1}" ${data.page <= 1 ? 'disabled' : ''}>上一页</button><button type="button" data-action="evidence-page" data-id="${id}" data-page="${data.page + 1}" ${data.page >= data.pages ? 'disabled' : ''}>下一页</button></div></div>
      ${report.status === 'pending' ? `${selectField('审核结论', 'status', draft.status || '', [['', '请选择审核结论'], ['upheld', '违规：隐藏该文字及全部历史版本'], ['dismissed', '未违规：保留文字']])}${textarea('处理说明（发送给举报人；违规时也通知作者）', 'reason', draft.reason || '', true)}<p class="moderation-notice">隐藏会作用于该文字的当前版本及历史版本，不改变投票，也不关闭其他回复。</p><div class="editor-actions"><button type="button" data-action="close-drawer">稍后处理</button><button class="save" type="submit">提交审核结果</button></div>` : `<div class="moderation-meta"><p>处理说明：${escapeHtml(report.decisionReason)}</p><small>${escapeHtml(report.decidedBy)} · ${formatDate(report.decidedAt)}</small></div>`}`;
    if (form.elements.status) form.elements.status.required = true;
    if (form.elements.reason) form.elements.reason.maxLength = 1000;
  } catch (error) {
    if (requestId === evidenceRequest) form.innerHTML = `<p role="alert">${escapeHtml(error.message)}</p><button type="button" data-action="moderation-detail" data-id="${id}">重试</button>`;
  }
}

function openDrawer(type, item = null) {
  const form = $('#editor-form'); form.dataset.type = type; form.dataset.id = item?.id || '';
  const configs = {
    user: ['USER', item ? '编辑用户' : '新增用户', `${field('用户名','username',item?.username,'text',true)}${field('昵称','nickname',item?.nickname)}${field('邮箱','email',item?.email,'email')}${field(item ? '重置密码（留空不修改）' : '初始密码','password','', 'password', !item)}<label class="checkbox"><input name="isActive" type="checkbox" ${item?.isActive !== false ? 'checked' : ''}/><span>账户正常可用</span></label>`],
    version: ['RELEASE', item ? '编辑版本' : '新增版本', `${field('版本号','version',item?.version,'text',true)}${selectField('平台','platform',item?.platform || 'android',[['android','Android'],['ios','iOS']])}${field('下载地址','downloadUrl',item?.downloadUrl,'url',true)}${textarea('更新日志','updateLog',item?.updateLog,true)}<label class="checkbox"><input name="forceUpdate" type="checkbox" ${item?.forceUpdate ? 'checked' : ''}/><span>设为强制更新</span></label>`],
    setting: ['CONFIG', item ? '编辑配置' : '新增配置', `${field('配置键','key',item?.key,'text',true)}${field('分组','category',item?.category || 'general','text',true)}${field('配置值（支持 true / false / 数字 / JSON）','value',item ? (typeof item.value === 'string' ? item.value : JSON.stringify(item.value)) : '','text',true)}${textarea('用途说明','description',item?.description)}<label class="checkbox"><input name="isSecret" type="checkbox" ${item?.isSecret ? 'checked' : ''}/><span>敏感配置，列表中隐藏内容</span></label>`],
    issue: ['ISSUE', item ? '编辑 Issue' : '新增 Issue', `${field('标题','title',item?.title,'text',true)}${textarea('详细说明','description',item?.description)}<div class="form-grid">${selectField('类型','type',item?.type || 'bug',[['bug','缺陷'],['feature','功能'],['improvement','优化'],['maintenance','维护']])}${selectField('优先级','priority',item?.priority || 'medium',[['low','低'],['medium','中'],['high','高'],['urgent','紧急']])}${selectField('状态','status',item?.status || 'todo',[['todo','待处理'],['planned','已规划'],['in_progress','处理中'],['fixed','已修复'],['closed','已关闭']])}${field('目标版本','targetVersion',item?.targetVersion)}</div>${field('负责人','assignee',item?.assignee)}${field('标签（逗号分隔）','labels',(item?.labels || []).join(', '))}`],
  };
  const [kicker, title, fields] = configs[type]; $('#drawer-kicker').textContent = kicker; $('#drawer-title').textContent = title;
  form.innerHTML = `${fields}<div class="editor-actions"><button type="button" data-action="close-drawer">取消</button><button class="save" type="submit">保存</button></div>`;
  if (item && type === 'setting') form.elements.key.disabled = true;
  $('#drawer-backdrop').hidden = false; $('#editor-drawer').classList.add('open'); $('#editor-drawer').setAttribute('aria-hidden','false');
}

function closeDrawer() { evidenceRequest += 1; $('#editor-drawer').classList.remove('open'); $('#editor-drawer').setAttribute('aria-hidden','true'); $('#drawer-backdrop').hidden = true; }
function parseValue(value) { const trimmed = value.trim(); if (trimmed === 'true') return true; if (trimmed === 'false') return false; if (trimmed !== '' && !Number.isNaN(Number(trimmed))) return Number(trimmed); try { return JSON.parse(trimmed); } catch { return value; } }

async function submitEditor(event) {
  event.preventDefault(); const form = event.currentTarget; const values = Object.fromEntries(new FormData(form)); const id = form.dataset.id; const type = form.dataset.type;
  try {
    if (type === 'moderation') {
      const submit = form.querySelector('[type="submit"]');
      if (!submit || submit.disabled) return;
      if (!values.reason?.trim()) throw new Error('请填写处理说明');
      submit.disabled = true;
      try {
        await request(`/moderation/${id}/decision`, { method: 'POST', body: JSON.stringify({ status: values.status, reason: values.reason.trim() }) });
        closeDrawer(); toast('审核结果已保存'); await loadCurrent();
      } finally { submit.disabled = false; }
      return;
    }
    let path; let body; const method = id ? 'PATCH' : 'POST';
    if (type === 'user') { path = id ? `/users/${id}` : '/users'; body = { ...values, isActive: form.elements.isActive.checked }; if (!body.password) delete body.password; }
    if (type === 'version') { path = id ? `/versions/${id}` : '/versions'; body = { ...values, forceUpdate: form.elements.forceUpdate.checked }; }
    if (type === 'setting') { path = id ? `/settings/${id}` : '/settings'; body = { ...values, value: parseValue(values.value), isSecret: form.elements.isSecret.checked }; if (id) delete body.key; }
    if (type === 'issue') { path = id ? `/issues/${id}` : '/issues'; body = { ...values, labels: values.labels ? values.labels.split(',').map((item) => item.trim()).filter(Boolean) : [] }; if (!body.targetVersion) delete body.targetVersion; }
    await request(path, { method, body: JSON.stringify(body) }); closeDrawer(); toast('保存成功'); await loadCurrent();
  } catch (error) { toast(error.message, true); }
}

async function remove(type, id, label) {
  if (!confirm(`确定删除“${label}”吗？此操作无法撤销。`)) return;
  try { await request(`/${type}/${id}`, { method: 'DELETE' }); toast('已删除'); await loadCurrent(); } catch (error) { toast(error.message, true); }
}

document.addEventListener('click', async (event) => {
  const button = event.target.closest('button'); if (!button) return; const action = button.dataset.action; const id = button.dataset.id;
  if (button.classList.contains('nav-item')) return switchView(button.dataset.view);
  if (action === 'sample-detail') return showSample(id);
  if (action === 'moderation-detail' || action === 'evidence-page') return showEvidence(id, Number(button.dataset.page || 1));
  if (action === 'filter-moderation') { state.filters.status = $('#moderation-status').value; state.page = 1; return loadCurrent(); }
  if (action === 'export-samples') return exportSamples(button);
  if (action === 'filter-samples') { state.filters = Object.fromEntries($$('[data-sample-filter]').map((el) => [el.dataset.sampleFilter, el.value.trim()])); state.page = 1; return loadCurrent(); }
  if (action === 'new-user') return openDrawer('user'); if (action === 'new-version') return openDrawer('version'); if (action === 'new-setting') return openDrawer('setting'); if (action === 'new-issue') return openDrawer('issue');
  if (action === 'edit-user') return openDrawer('user', state.data.users.items.find((item) => item.id === id));
  if (action === 'edit-version') return openDrawer('version', state.data.versions.find((item) => item.id === Number(id)));
  if (action === 'edit-setting') return openDrawer('setting', state.data.settings.find((item) => item.id === Number(id)));
  if (action === 'edit-issue') return openDrawer('issue', state.data.issues.items.find((item) => item.id === Number(id)));
  if (action === 'delete-user') { const item = state.data.users.items.find((row) => row.id === id); return remove('users', id, item.username); }
  if (action === 'delete-version') { const item = state.data.versions.find((row) => row.id === Number(id)); return remove('versions', id, `v${item.version}`); }
  if (action === 'delete-setting') { const item = state.data.settings.find((row) => row.id === Number(id)); return remove('settings', id, item.key); }
  if (action === 'delete-issue') { const item = state.data.issues.items.find((row) => row.id === Number(id)); return remove('issues', id, item.title); }
  if (action === 'prev-page') { state.page -= 1; return loadCurrent(); } if (action === 'next-page') { state.page += 1; return loadCurrent(); }
  if (action === 'close-drawer') return closeDrawer();
});

let filterTimer;
document.addEventListener('input', (event) => {
  if (!event.target.dataset.filter) return; clearTimeout(filterTimer); filterTimer = setTimeout(() => { state.filters.search = event.target.value.trim(); state.page = 1; loadCurrent(); }, 280);
});
document.addEventListener('change', (event) => {
  const filter = event.target.dataset.filter; if (filter === 'user-status') state.filters.status = event.target.value; if (filter === 'issue-status') state.filters.status = event.target.value; if (filter) { state.page = 1; loadCurrent(); }
});

$('#login-form').addEventListener('submit', login); $('#editor-form').addEventListener('submit', submitEditor);
$('#drawer-close').addEventListener('click', closeDrawer); $('#drawer-backdrop').addEventListener('click', closeDrawer);
$('#logout-button').addEventListener('click', logout); $('#refresh-button').addEventListener('click', loadCurrent);
$('#menu-button').addEventListener('click', () => $('.sidebar').classList.toggle('open'));
if (state.token) boot();
