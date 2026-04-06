use once_cell::sync::Lazy;
use regex::Regex;

/// Patterns for detecting sensitive data in clipboard text.
/// Mirrors the frontend patterns in settingsStore.ts.
static SENSITIVE_PATTERNS: Lazy<Vec<Regex>> = Lazy::new(|| {
    vec![
        // API Keys & tokens (generic)
        Regex::new(r#"(?i)(?:api[_\-]?key|apikey|access[_\-]?token|auth[_\-]?token|bearer)\s*[:=]\s*['"]?[A-Za-z0-9_\-./+]{16,}"#).unwrap(),
        // AWS keys
        Regex::new(r"AKIA[0-9A-Z]{16}").unwrap(),
        // GitHub tokens
        Regex::new(r"gh[ps]_[A-Za-z0-9_]{36,}").unwrap(),
        // Slack tokens
        Regex::new(r"xox[bpras]\-[A-Za-z0-9\-]{10,}").unwrap(),
        // Private keys (PEM)
        Regex::new(r"-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----").unwrap(),
        // SSH private keys
        Regex::new(r"-----BEGIN\s+OPENSSH\s+PRIVATE\s+KEY-----").unwrap(),
        // Password patterns
        Regex::new(r#"(?i)(?:password|passwd|pwd)\s*[:=]\s*['"]?.{4,}"#).unwrap(),
        // Secret patterns
        Regex::new(r#"(?i)(?:secret|client[_\-]?secret)\s*[:=]\s*['"]?[A-Za-z0-9_\-./+]{8,}"#).unwrap(),
        // JWT tokens
        Regex::new(r"eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}").unwrap(),
        // OpenAI keys
        Regex::new(r"sk\-[A-Za-z0-9]{20,}").unwrap(),
        // Anthropic keys
        Regex::new(r"sk\-ant\-[A-Za-z0-9_\-]{20,}").unwrap(),
    ]
});

/// Returns true if the text contains sensitive data (passwords, API keys, tokens, etc.).
pub fn contains_sensitive_data(text: &str) -> bool {
    SENSITIVE_PATTERNS.iter().any(|p| p.is_match(text))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_detects_api_key() {
        assert!(contains_sensitive_data("api_key=abc1234567890abcdef"));
        assert!(contains_sensitive_data("API_KEY: sk-1234567890abcdefghij"));
    }

    #[test]
    fn test_detects_openai_key() {
        assert!(contains_sensitive_data("sk-abcdefghijklmnopqrstuvwx"));
    }

    #[test]
    fn test_detects_anthropic_key() {
        assert!(contains_sensitive_data("sk-ant-abcdefghijklmnopqrstuvwx"));
    }

    #[test]
    fn test_detects_private_key() {
        assert!(contains_sensitive_data("-----BEGIN RSA PRIVATE KEY-----"));
        assert!(contains_sensitive_data(
            "-----BEGIN OPENSSH PRIVATE KEY-----"
        ));
    }

    #[test]
    fn test_detects_password() {
        assert!(contains_sensitive_data("password=mysecretpass"));
        assert!(contains_sensitive_data("pwd: 12345678"));
    }

    #[test]
    fn test_normal_text_passes() {
        assert!(!contains_sensitive_data("Hello world, this is normal text"));
        assert!(!contains_sensitive_data("会议记录：讨论产品设计方案"));
        assert!(!contains_sensitive_data("https://example.com/article"));
    }
}
