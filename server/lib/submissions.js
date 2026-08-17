/**
 * 选品台后台 - 提交记录持久化存储
 * 达人每次提交选款后，记录存盘到 data/submissions.json，供后台汇总查看。
 * 重启服务不丢失。
 */
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./loader');

const FILE = path.join(DATA_DIR, 'submissions.json');

function loadAll() {
  try {
    if (fs.existsSync(FILE)) {
      const arr = JSON.parse(fs.readFileSync(FILE, 'utf8'));
      return Array.isArray(arr) ? arr : [];
    }
  } catch (e) { /* 损坏则重建 */ }
  return [];
}

let records = loadAll();

function persist() {
  fs.writeFileSync(FILE, JSON.stringify(records, null, 2), 'utf8');
}

function genId() {
  return 'S' + Date.now().toString(36).toUpperCase() + Math.floor(Math.random() * 900 + 100);
}

const submissions = {
  // 新增一条提交记录
  add({ submitter, remark, items }) {
    const now = new Date();
    const rec = {
      id: genId(),
      time: now.toLocaleString('zh-CN', { hour12: false }),
      createdAt: now.toISOString(),
      submitter: submitter || '选品员',
      remark: remark || '',
      count: Array.isArray(items) ? items.length : 0,
      items: Array.isArray(items) ? items : []
    };
    records.unshift(rec); // 最新在前
    if (records.length > 500) records = records.slice(0, 500); // 控制体积
    persist();
    return rec;
  },
  list() {
    // 列表只返回汇总字段，避免传输过大
    return records.map(r => ({
      id: r.id, time: r.time, submitter: r.submitter,
      remark: r.remark, count: r.count
    }));
  },
  get(id) {
    return records.find(r => r.id === id) || null;
  },
  remove(id) {
    const before = records.length;
    records = records.filter(r => r.id !== id);
    if (records.length !== before) { persist(); return true; }
    return false;
  },
  total() { return records.length; }
};

module.exports = submissions;
