/**
 * 选款清单存储（内存态）。支持多会话隔离（移动端多人选品互不干扰）。
 * 重启服务后清空；如需持久化可改为文件/数据库存储。
 */
const sessions = new Map(); // sessionId -> Map(styleNo -> { note, addedAt })

function getSession(id) {
  if (!sessions.has(id)) sessions.set(id, new Map());
  return sessions.get(id);
}

const store = {
  add(sessionId, styleNo, note) {
    getSession(sessionId).set(styleNo, { note: note || '', addedAt: Date.now() });
  },
  remove(sessionId, styleNo) {
    getSession(sessionId).delete(styleNo);
  },
  setNote(sessionId, styleNo, note) {
    const s = getSession(sessionId);
    if (s.has(styleNo)) s.get(styleNo).note = note;
  },
  list(sessionId) {
    const s = getSession(sessionId);
    return [...s.entries()].map(([styleNo, v]) => ({ styleNo, ...v }));
  },
  clear(sessionId) {
    getSession(sessionId).clear();
  },
  count(sessionId) {
    return getSession(sessionId).size;
  }
};

module.exports = store;
