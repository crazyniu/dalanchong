/** Scoped read-only activity feed. A generation prevents stale account responses from rendering. */
export function createLiveLogFeed({read, render, report}) {
  let key = null, generation = 0, pending = false;
  return {
    reset(next = null) { key = next; generation++; pending = false; render([]); },
    async refresh(next) {
      if (next !== key) this.reset(next);
      if (!next || pending) return;
      const revision = generation; pending = true;
      try {
        const rows = await read();
        if (revision !== generation) return;
        if (!Array.isArray(rows)) throw Error('日志响应无效');
        // Storage returns newest first; activity reads chronologically downwards.
        render(rows.slice(0, 200).reverse());
      } catch (error) { if (revision === generation) report(error); }
      finally { if (revision === generation) pending = false; }
    }
  };
}

export function mountLiveLogs({panel, list, status, followButton, read, labels}) {
  let following = true, fingerprint = '';
  const setFollow = value => {
    following = value; followButton.hidden = value;
    if (value) list.scrollTop = list.scrollHeight;
  };
  list.addEventListener('scroll', () => setFollow(list.scrollHeight - list.clientHeight - list.scrollTop < 24));
  followButton.addEventListener('click', () => setFollow(true));
  panel.addEventListener('toggle', () => { if (panel.open && following) list.scrollTop = list.scrollHeight; });
  const feed = createLiveLogFeed({read, report(error) { status.textContent = `刷新失败：${error.message}`; }, render(rows) {
    const signature = JSON.stringify(rows);
    status.textContent = rows.length ? `最近 ${rows.length} 条 · 自动刷新` : '当前账号暂无活动';
    if (signature === fingerprint) return;
    fingerprint = signature;
    const open = new Set([...list.querySelectorAll('details[open]')].map(node => node.dataset.id));
    const top = list.scrollTop;
    list.replaceChildren();
    for (const row of rows) {
      const details = document.createElement('details'); details.dataset.id = row.id; details.open = open.has(row.id);
      const summary = document.createElement('summary');
      summary.textContent = `${row.createdAt || ''} · ${labels[row.status] || row.status || ''} · ${row.message || ''}`;
      const body = document.createElement('pre');
      // Display only persisted, sanitized event fields, never raw request/response payloads.
      body.textContent = JSON.stringify({time: row.createdAt, status: row.status, message: row.message, taskId: row.taskId, talentId: row.talentId}, null, 2);
      details.append(summary, body); list.append(details);
    }
    if (!rows.length) { setFollow(true); return; }
    list.scrollTop = following ? list.scrollHeight : top;
  }});
  return feed;
}
