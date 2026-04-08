-- Migration 008: Wiki knowledge base tables

-- 知识页面
CREATE TABLE IF NOT EXISTS wiki_pages (
    id              TEXT PRIMARY KEY,
    title           TEXT NOT NULL,
    slug            TEXT NOT NULL UNIQUE,
    page_type       TEXT NOT NULL DEFAULT 'concept',
    body_markdown   TEXT NOT NULL DEFAULT '',
    summary         TEXT,
    tags            TEXT,
    status          TEXT NOT NULL DEFAULT 'active',
    confidence      REAL NOT NULL DEFAULT 1.0,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    last_compiled_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_wiki_pages_slug ON wiki_pages(slug);
CREATE INDEX IF NOT EXISTS idx_wiki_pages_type ON wiki_pages(page_type);
CREATE INDEX IF NOT EXISTS idx_wiki_pages_updated ON wiki_pages(updated_at);
CREATE INDEX IF NOT EXISTS idx_wiki_pages_status ON wiki_pages(status);

-- 页面-来源关系
CREATE TABLE IF NOT EXISTS wiki_page_sources (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    page_id         TEXT NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
    content_id      TEXT NOT NULL,
    compile_hash    TEXT NOT NULL,
    source_status   TEXT NOT NULL DEFAULT 'active',
    contributed_at  TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(page_id, content_id)
);
CREATE INDEX IF NOT EXISTS idx_wps_page ON wiki_page_sources(page_id);
CREATE INDEX IF NOT EXISTS idx_wps_content ON wiki_page_sources(content_id);
CREATE INDEX IF NOT EXISTS idx_wps_status ON wiki_page_sources(source_status);

-- 页面间关系（图谱）
CREATE TABLE IF NOT EXISTS wiki_edges (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    source_page_id  TEXT NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
    target_page_id  TEXT NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
    relation        TEXT NOT NULL DEFAULT 'related',
    weight          REAL NOT NULL DEFAULT 1.0,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(source_page_id, target_page_id, relation)
);
CREATE INDEX IF NOT EXISTS idx_wiki_edges_source ON wiki_edges(source_page_id);
CREATE INDEX IF NOT EXISTS idx_wiki_edges_target ON wiki_edges(target_page_id);

-- 编译日志（含并发锁索引）
CREATE TABLE IF NOT EXISTS wiki_compile_log (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    content_id      TEXT NOT NULL,
    content_hash    TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending',
    knowledge_score REAL,
    pages_touched   TEXT,
    model_used      TEXT,
    error_message   TEXT,
    compiled_at     TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_wiki_compile_content ON wiki_compile_log(content_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_wiki_compile_inflight
    ON wiki_compile_log(content_id) WHERE status = 'compiling';

-- Q&A 对话
CREATE TABLE IF NOT EXISTS wiki_conversations (
    id              TEXT PRIMARY KEY,
    question        TEXT NOT NULL,
    answer          TEXT NOT NULL,
    pages_used      TEXT NOT NULL DEFAULT '[]',
    saved_as_page   TEXT,
    model_used      TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 健康检查结果
CREATE TABLE IF NOT EXISTS wiki_lint_results (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    lint_type       TEXT NOT NULL,
    severity        TEXT NOT NULL DEFAULT 'info',
    title           TEXT NOT NULL,
    description     TEXT NOT NULL,
    page_ids        TEXT NOT NULL DEFAULT '[]',
    status          TEXT NOT NULL DEFAULT 'open',
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
