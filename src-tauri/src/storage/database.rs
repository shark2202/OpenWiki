use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::Mutex;

pub struct Database {
    pub conn: Mutex<Connection>,
}

impl Database {
    pub fn new() -> Result<Self, Box<dyn std::error::Error>> {
        let db_path = Self::get_db_path()?;

        // Ensure parent directory exists
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let conn = Connection::open(&db_path)?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;

        let db = Database {
            conn: Mutex::new(conn),
        };
        db.run_migrations()?;

        Ok(db)
    }

    /// Create an in-memory database for testing.
    #[cfg(test)]
    pub fn new_in_memory() -> Result<Self, Box<dyn std::error::Error>> {
        let conn = Connection::open_in_memory()?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;
        let db = Database {
            conn: Mutex::new(conn),
        };
        db.run_migrations()?;
        Ok(db)
    }

    fn get_db_path() -> Result<PathBuf, Box<dyn std::error::Error>> {
        let data_dir = dirs::data_dir()
            .ok_or("Could not find data directory")?
            .join("com.xiaoyun.app");
        Ok(data_dir.join("xiaoyun.db"))
    }

    fn run_migrations(&self) -> Result<(), Box<dyn std::error::Error>> {
        let conn = self.conn.lock().map_err(|e| format!("Lock error: {}", e))?;

        let migration_sql = include_str!("migrations/001_initial.sql");
        conn.execute_batch(migration_sql)?;

        // Migration 002: Add user_note column (idempotent check)
        let has_user_note: bool = conn
            .prepare("SELECT COUNT(*) FROM pragma_table_info('captured_content') WHERE name = 'user_note'")?
            .query_row([], |row| row.get::<_, i32>(0))
            .map(|count| count > 0)
            .unwrap_or(false);

        if !has_user_note {
            let migration_002 = include_str!("migrations/002_add_user_note.sql");
            conn.execute_batch(migration_002)?;
            log::info!("Migration 002 applied: added user_note column");
        }

        // Migration 003: Add chat_messages table
        let has_chat_messages: bool = conn
            .prepare(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='chat_messages'",
            )?
            .query_row([], |row| row.get::<_, i32>(0))
            .map(|count| count > 0)
            .unwrap_or(false);

        if !has_chat_messages {
            let migration_003 = include_str!("migrations/003_add_chat_messages.sql");
            conn.execute_batch(migration_003)?;
            log::info!("Migration 003 applied: added chat_messages table");
        }

        // Migration 004: Add digest fields (digested_at, digest_action)
        let has_digested_at: bool = conn
            .prepare("SELECT COUNT(*) FROM pragma_table_info('captured_content') WHERE name = 'digested_at'")?
            .query_row([], |row| row.get::<_, i32>(0))
            .map(|count| count > 0)
            .unwrap_or(false);

        if !has_digested_at {
            let migration_004 = include_str!("migrations/004_add_digest_fields.sql");
            conn.execute_batch(migration_004)?;
            log::info!("Migration 004 applied: added digest fields");
        }

        // Migration 005: Add attention_insights table
        let has_attention_insights: bool = conn
            .prepare("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='attention_insights'")?
            .query_row([], |row| row.get::<_, i32>(0))
            .map(|count| count > 0)
            .unwrap_or(false);

        if !has_attention_insights {
            let migration_005 = include_str!("migrations/005_add_attention_insights.sql");
            conn.execute_batch(migration_005)?;
            log::info!("Migration 005 applied: added attention_insights table");
        }

        // Migration 006: Add summary and tags columns to captured_content
        let has_summary: bool = conn
            .prepare(
                "SELECT COUNT(*) FROM pragma_table_info('captured_content') WHERE name='summary'",
            )?
            .query_row([], |row| row.get::<_, i32>(0))
            .map(|c| c > 0)
            .unwrap_or(false);
        let has_tags: bool = conn
            .prepare(
                "SELECT COUNT(*) FROM pragma_table_info('captured_content') WHERE name='tags'",
            )?
            .query_row([], |row| row.get::<_, i32>(0))
            .map(|c| c > 0)
            .unwrap_or(false);

        if !has_summary || !has_tags {
            if !has_summary {
                conn.execute_batch("ALTER TABLE captured_content ADD COLUMN summary TEXT;")?;
            }
            if !has_tags {
                conn.execute_batch("ALTER TABLE captured_content ADD COLUMN tags TEXT;")?;
            }
            log::info!("Migration 006 applied: added summary/tags columns");
        }

        // Migration 007: Add digest column to captured_content
        let has_digest: bool = conn
            .prepare(
                "SELECT COUNT(*) FROM pragma_table_info('captured_content') WHERE name='digest'",
            )?
            .query_row([], |row| row.get::<_, i32>(0))
            .map(|c| c > 0)
            .unwrap_or(false);

        if !has_digest {
            conn.execute_batch("ALTER TABLE captured_content ADD COLUMN digest TEXT;")?;
            log::info!("Migration 007 applied: added digest column");
        }

        // Migration 008: Add wiki tables
        let has_wiki_pages: bool = conn
            .prepare(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='wiki_pages'",
            )?
            .query_row([], |row| row.get::<_, i32>(0))
            .map(|count| count > 0)
            .unwrap_or(false);

        if !has_wiki_pages {
            let migration_008 = include_str!("migrations/008_add_wiki.sql");
            conn.execute_batch(migration_008)?;
            log::info!("Migration 008 applied: added wiki tables");
        }

        // Migration 009: Add wiki hash columns to captured_content
        let has_wiki_compile_hash: bool = conn
            .prepare(
                "SELECT COUNT(*) FROM pragma_table_info('captured_content') WHERE name='wiki_compile_hash'",
            )?
            .query_row([], |row| row.get::<_, i32>(0))
            .map(|c| c > 0)
            .unwrap_or(false);

        if !has_wiki_compile_hash {
            conn.execute_batch(
                "ALTER TABLE captured_content ADD COLUMN wiki_compile_hash TEXT;
                 ALTER TABLE captured_content ADD COLUMN wiki_assessed_hash TEXT;",
            )?;
            log::info!("Migration 009 applied: added wiki hash columns");
        }

        log::info!("Database migrations completed successfully");
        Ok(())
    }
}
