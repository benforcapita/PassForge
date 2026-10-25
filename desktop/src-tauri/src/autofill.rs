//! Site matching for the extension autofill route (`GET /api/autofill`).
//! Pure string logic — no network, no vault access — so it is unit-tested
//! without a database. A wrong match would offer a password on the wrong
//! page, so the rules are deliberately narrow: equal hosts or strict
//! subdomains, https only except loopback http.

/// Hostname of a URL, lowercased, without port, userinfo, or trailing dot.
/// `None` when the input has no `scheme://` or an empty host.
pub fn host_of(url: &str) -> Option<String> {
    let rest = url.split_once("://")?.1;
    let authority = rest.split(['/', '?', '#']).next()?;
    let authority = authority.rsplit('@').next()?; // strip userinfo
    let host = if let Some(v6) = authority.strip_prefix('[') {
        let end = v6.find(']')?;
        &authority[1..end + 1]
    } else {
        authority.split(':').next()?
    };
    let host = host.trim_end_matches('.').to_lowercase();
    if host.is_empty() {
        None
    } else {
        Some(host)
    }
}

/// Host stored on a vault entry: either a bare host (possibly `host:port`)
/// or a full URL — both normalize to the bare host.
fn entry_host(site: &str) -> Option<String> {
    let bare = if site.contains("://") {
        host_of(site)?
    } else {
        let host = site.split('/').next()?.split(':').next()?;
        host.trim_end_matches('.').to_lowercase()
    };
    let bare = bare.strip_prefix("www.").unwrap_or(&bare).to_string();
    if bare.is_empty() {
        None
    } else {
        Some(bare)
    }
}

/// Page schemes autofill is allowed on: https everywhere, http on loopback.
fn page_scheme_ok(url: &str, host: &str) -> bool {
    match url.split("://").next() {
        Some("https") => true,
        Some("http") => {
            host == "localhost" || host == "::1" || host.starts_with("127.")
        }
        _ => false,
    }
}

/// Whether a vault entry for `entry_site` may be offered on `page_url`.
/// Matches on exact host or strict subdomain (`login.github.com` matches a
/// `github.com` entry; `github.com.evil.io` does not).
pub fn site_matches(entry_site: &str, page_url: &str) -> bool {
    let Some(page) = host_of(page_url).map(|h| h.strip_prefix("www.").map(str::to_string).unwrap_or(h)) else {
        return false;
    };
    if !page_scheme_ok(page_url, &page) {
        return false;
    }
    let Some(entry) = entry_host(entry_site) else {
        return false;
    };
    page == entry || page.ends_with(&format!(".{entry}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn host_of_extracts_and_normalizes() {
        assert_eq!(host_of("https://GitHub.com:443/path?q#f").as_deref(), Some("github.com"));
        assert_eq!(host_of("http://user:pw@Example.COM/a").as_deref(), Some("example.com"));
        assert_eq!(host_of("http://[::1]:8787/x").as_deref(), Some("::1"));
        assert_eq!(host_of("https://github.com./x").as_deref(), Some("github.com"));
        assert_eq!(host_of("not-a-url"), None);
        assert_eq!(host_of("https:///x"), None);
        assert_eq!(host_of(""), None);
    }

    #[test]
    fn matches_exact_and_subdomain() {
        assert!(site_matches("github.com", "https://github.com/login"));
        assert!(site_matches("github.com", "https://login.github.com/"));
        assert!(site_matches("GitHub.com", "https://github.com/"));
        assert!(site_matches("www.github.com", "https://github.com/"));
        assert!(site_matches("github.com", "https://www.github.com/"));
        assert!(site_matches("https://github.com/settings", "https://github.com/"));
        assert!(site_matches("github.com:8443", "https://github.com/"));
    }

    #[test]
    fn rejects_lookalike_hosts() {
        assert!(!site_matches("github.com", "https://github.com.evil.io/"));
        assert!(!site_matches("github.com", "https://notgithub.com/"));
        assert!(!site_matches("github.com", "https://github.com@evil.io/"));
        assert!(!site_matches("", "https://github.com/"));
        assert!(!site_matches("github.com", ""));
        assert!(!site_matches("github.com", "not-a-url"));
    }

    #[test]
    fn scheme_rules() {
        assert!(!site_matches("github.com", "http://github.com/"));
        assert!(site_matches("localhost", "http://localhost:3000/login"));
        assert!(site_matches("127.0.0.1", "http://127.0.0.1:8080/x"));
        assert!(!site_matches("github.com", "ftp://github.com/"));
        assert!(!site_matches("github.com", "file:///etc/passwd"));
    }

    #[test]
    fn ip_and_punycode_and_edge_cases() {
        assert!(site_matches("127.0.0.1", "http://127.0.0.1:3000/"));
        assert!(!site_matches("127.0.0.1", "http://127.0.0.2:3000/"));
        assert!(site_matches("192.168.1.5", "https://192.168.1.5/"));
        assert!(site_matches("xn--nxasmq6b.example", "https://xn--nxasmq6b.example/"));
        // trailing-dot FQDNs still match
        assert!(site_matches("github.com.", "https://github.com./"));
        // parent domain is not a subdomain of the entry
        assert!(!site_matches("login.github.com", "https://github.com/"));
    }
}
