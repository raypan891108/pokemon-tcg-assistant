import { api } from '../api.js';
import { escHtml, showToast, openModal } from '../utils.js';

// 相關網站: your Pokémon TCG websites in groups. Opening a card opens the site; 編輯 turns
// the cards into editable ones. Every change saves the whole list (see backend/services/links.js).

let data = { groups: [] };
let editing = false;

export async function renderLinks(container) {
  editing = false;
  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">🔗 相關網站</h1>
        <p class="page-subtitle">常用的 PTCG 網站，依分組整理</p>
      </div>
      <div class="links-header-actions" id="links-actions"></div>
    </div>
    <div class="page-body">
      <div id="links-content">
        <div class="loading-spinner"><div class="spinner"></div><span>載入中...</span></div>
      </div>
    </div>`;

  container.querySelector('#links-actions').addEventListener('click', onAction);
  container.querySelector('#links-content').addEventListener('click', onAction);

  try {
    data = await api.links();
    render();
  } catch (e) {
    document.getElementById('links-content').innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-title">無法載入網站清單</div><div class="empty-desc">${escHtml(e.message)}</div></div>`;
  }
}

const hostOf = url => {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
};

// The site's own favicon; its first letter until the icon has loaded, or when it has none
function iconHtml(link) {
  const letter = escHtml((link.name.match(/[\p{L}\p{N}]/u) || ['?'])[0].toUpperCase());
  let origin = '';
  try { origin = new URL(link.url).origin; } catch {}
  return `<span class="link-icon" data-letter="${letter}">${origin ? `<img src="${escHtml(origin)}/favicon.ico" alt="" referrerpolicy="no-referrer" onload="if (this.naturalWidth > 1) this.classList.add('loaded'); else this.remove()" onerror="this.remove()" />` : ''}</span>`;
}

function linkCard(link, group, index) {
  const body = `
    ${iconHtml(link)}
    <span class="link-text">
      <span class="link-name">${escHtml(link.name)}</span>
      <span class="link-host">${escHtml(hostOf(link.url))}</span>
      ${link.note ? `<span class="link-note">${escHtml(link.note)}</span>` : ''}
    </span>`;
  if (!editing) {
    return `<a class="link-card" href="${escHtml(link.url)}" target="_blank" rel="noopener noreferrer">${body}</a>`;
  }
  const last = index === group.links.length - 1;
  return `
    <div class="link-card editing">
      ${body}
      <span class="link-edit-actions">
        <button type="button" class="icon-btn" data-action="link-up" data-group="${group.id}" data-link="${link.id}" ${index === 0 ? 'disabled' : ''} aria-label="往前移">↑</button>
        <button type="button" class="icon-btn" data-action="link-down" data-group="${group.id}" data-link="${link.id}" ${last ? 'disabled' : ''} aria-label="往後移">↓</button>
        <button type="button" class="icon-btn" data-action="link-edit" data-group="${group.id}" data-link="${link.id}" aria-label="編輯">✏️</button>
        <button type="button" class="icon-btn" data-action="link-delete" data-group="${group.id}" data-link="${link.id}" aria-label="刪除">🗑️</button>
      </span>
    </div>`;
}

function render() {
  document.getElementById('links-actions').innerHTML = editing
    ? `<button class="btn-secondary" data-action="group-add">＋ 新增分組</button>
       <button class="btn-secondary" data-action="link-add">＋ 新增網站</button>
       <button class="btn-primary" data-action="toggle-edit">✓ 完成</button>`
    : `<button class="btn-secondary" data-action="toggle-edit">✏️ 編輯</button>`;

  // Empty groups only matter while editing
  const groups = editing ? data.groups : data.groups.filter(g => g.links.length);
  const el = document.getElementById('links-content');
  if (!groups.length) {
    el.innerHTML = `<div class="empty-state"><div class="empty-icon">🔗</div><div class="empty-title">還沒有網站</div><div class="empty-desc">按右上角「✏️ 編輯」新增常用的網站</div></div>`;
    return;
  }

  el.innerHTML = groups.map(g => {
    const i = data.groups.indexOf(g);
    return `
      <section class="links-group">
        <div class="links-group-header">
          <h2 class="links-group-title">${escHtml(g.name)} <span class="links-group-count">${g.links.length}</span></h2>
          ${editing ? `
            <span class="link-edit-actions">
              <button type="button" class="icon-btn" data-action="group-up" data-group="${g.id}" ${i === 0 ? 'disabled' : ''} aria-label="分組往上移">↑</button>
              <button type="button" class="icon-btn" data-action="group-down" data-group="${g.id}" ${i === data.groups.length - 1 ? 'disabled' : ''} aria-label="分組往下移">↓</button>
              <button type="button" class="icon-btn" data-action="group-rename" data-group="${g.id}" aria-label="重新命名分組">✏️</button>
              <button type="button" class="icon-btn" data-action="group-delete" data-group="${g.id}" aria-label="刪除分組">🗑️</button>
            </span>` : ''}
        </div>
        <div class="links-grid">
          ${g.links.map((l, idx) => linkCard(l, g, idx)).join('')}
          ${editing ? `<button type="button" class="link-card link-add" data-action="link-add" data-group="${g.id}">＋ 新增網站到這組</button>` : ''}
        </div>
      </section>`;
  }).join('');
}

// Save the whole list; the server's copy (cleaned up, with ids) replaces ours
async function save(next, message) {
  try {
    data = await api.saveLinks(next);
    render();
    if (message) showToast(message, 'success');
    return true;
  } catch (e) {
    showToast(`儲存失敗：${e.message}`, 'error');
    return false;
  }
}

const clone = () => structuredClone(data);
const findGroup = (d, id) => d.groups.find(g => g.id === id);

function move(list, index, delta) {
  const to = index + delta;
  if (to < 0 || to >= list.length) return;
  [list[index], list[to]] = [list[to], list[index]];
}

function onAction(e) {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const { action, group: groupId, link: linkId } = btn.dataset;
  const next = clone();
  const group = groupId && findGroup(next, groupId);
  const linkIndex = group && linkId ? group.links.findIndex(l => l.id === linkId) : -1;

  switch (action) {
    case 'toggle-edit':
      editing = !editing;
      render();
      break;
    case 'link-add':
      openLinkForm(null, groupId);
      break;
    case 'link-edit':
      openLinkForm(group.links[linkIndex], groupId);
      break;
    case 'link-up':
    case 'link-down':
      move(group.links, linkIndex, action === 'link-up' ? -1 : 1);
      save(next);
      break;
    case 'link-delete': {
      const [removed] = group.links.splice(linkIndex, 1);
      if (confirm(`要刪除「${removed.name}」嗎？`)) save(next, '已刪除');
      break;
    }
    case 'group-add':
      openGroupForm();
      break;
    case 'group-rename':
      openGroupForm(group);
      break;
    case 'group-up':
    case 'group-down':
      move(next.groups, next.groups.indexOf(group), action === 'group-up' ? -1 : 1);
      save(next);
      break;
    case 'group-delete': {
      const warning = group.links.length ? `，裡面的 ${group.links.length} 個網站也會一起刪除` : '';
      if (!confirm(`要刪除分組「${group.name}」嗎${warning}？`)) break;
      next.groups = next.groups.filter(g => g.id !== groupId);
      save(next, '已刪除分組');
      break;
    }
  }
}

function openLinkForm(link, groupId) {
  if (!data.groups.length) {
    showToast('請先新增一個分組', 'error');
    return;
  }
  const selected = groupId || data.groups[0].id;
  const { el, close } = openModal(`
    <div class="modal-title">${link ? '編輯網站' : '新增網站'}</div>
    <form id="link-form">
      <div class="form-group">
        <label class="form-label" for="link-url">網址</label>
        <input id="link-url" name="url" type="url" class="form-input" required placeholder="https://..." value="${escHtml(link?.url || '')}" />
      </div>
      <div class="form-group">
        <label class="form-label" for="link-name">名稱</label>
        <input id="link-name" name="name" class="form-input" required maxlength="80" value="${escHtml(link?.name || '')}" />
      </div>
      <div class="form-group">
        <label class="form-label" for="link-group">分組</label>
        <select id="link-group" name="group" class="form-input">
          ${data.groups.map(g => `<option value="${g.id}" ${g.id === selected ? 'selected' : ''}>${escHtml(g.name)}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label" for="link-note">說明（選填）</label>
        <input id="link-note" name="note" class="form-input" maxlength="120" placeholder="例如：日本牌組與環境整理" value="${escHtml(link?.note || '')}" />
      </div>
    </form>
    <div class="form-error" id="link-error"></div>
    <div class="modal-actions">
      <button class="btn-secondary" type="button" data-close>取消</button>
      <button class="btn-primary" type="submit" form="link-form">💾 儲存</button>
    </div>`);

  el.querySelector('#link-form').addEventListener('submit', async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const entry = { id: link?.id, name: f.get('name'), url: f.get('url'), note: f.get('note') };
    const next = clone();
    // Take it out of wherever it was; it goes to the end of the chosen group unless it stays put
    let kept = false;
    for (const g of next.groups) {
      const i = g.links.findIndex(l => l.id === link?.id);
      if (i < 0) continue;
      if (g.id === f.get('group')) {
        g.links[i] = entry;
        kept = true;
      } else {
        g.links.splice(i, 1);
      }
    }
    if (!kept) findGroup(next, f.get('group')).links.push(entry);
    if (await save(next, link ? '已更新' : '已新增')) close();
    else el.querySelector('#link-error').textContent = '儲存失敗，請檢查網址是否正確';
  });
}

function openGroupForm(group = null) {
  const { el, close } = openModal(`
    <div class="modal-title">${group ? '重新命名分組' : '新增分組'}</div>
    <form id="group-form">
      <div class="form-group">
        <label class="form-label" for="group-name">分組名稱</label>
        <input id="group-name" name="name" class="form-input" required maxlength="40" placeholder="例如：🎮 工具與遊戲" value="${escHtml(group?.name || '')}" />
      </div>
    </form>
    <div class="modal-actions">
      <button class="btn-secondary" type="button" data-close>取消</button>
      <button class="btn-primary" type="submit" form="group-form">💾 儲存</button>
    </div>`);

  el.querySelector('#group-form').addEventListener('submit', async e => {
    e.preventDefault();
    const name = new FormData(e.target).get('name');
    const next = clone();
    if (group) findGroup(next, group.id).name = name;
    else next.groups.push({ name, links: [] });
    if (await save(next, group ? '已更新分組' : '已新增分組')) close();
  });
}
