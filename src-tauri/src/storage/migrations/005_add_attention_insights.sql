CREATE TABLE IF NOT EXISTS attention_insights (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    analysis_json TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    error_message TEXT,
    analyzed_at TEXT NOT NULL,
    window_start TEXT NOT NULL,
    window_end TEXT NOT NULL,
    content_count INTEGER NOT NULL,
    model_used TEXT NOT NULL,
    is_current INTEGER DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_insights_current ON attention_insights(is_current, analyzed_at);
