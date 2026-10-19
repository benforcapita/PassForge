use std::time::Duration;

use crate::error::{PassForgeError, Result};
use passforge_protocol::{DeriveRequest, DeriveResponse, ErrorResponse, InfoResponse, PROTOCOL};

pub fn normalize_server_url(url: &str) -> Result<String> {
    let normalized = url.trim().trim_end_matches('/');
    if !normalized.starts_with("http://") && !normalized.starts_with("https://") {
        return Err(PassForgeError::InvalidRequest(
            "algorithm server URL must start with http:// or https://".into(),
        ));
    }
    Ok(normalized.to_owned())
}

pub fn fetch_info(url: &str) -> Result<InfoResponse> {
    let url = normalize_server_url(url)?;
    let response = ureq::get(&format!("{url}/v1/info"))
        .timeout(Duration::from_secs(10))
        .call()
        .map_err(|error| map_request_error(error, None))?;
    let info = response
        .into_json::<InfoResponse>()
        .map_err(|_| PassForgeError::Remote("invalid info response".into()))?;
    if info.protocol != PROTOCOL {
        return Err(PassForgeError::Remote(format!(
            "unsupported protocol: {}",
            info.protocol
        )));
    }
    Ok(info)
}

pub fn derive(url: &str, algorithm: Option<&str>, input_hex: &str) -> Result<DeriveResponse> {
    let url = normalize_server_url(url)?;
    let request = DeriveRequest {
        algorithm: algorithm.map(str::to_owned),
        input: input_hex.to_owned(),
    };
    let response = ureq::post(&format!("{url}/v1/derive"))
        .timeout(Duration::from_secs(30))
        .send_json(&request)
        .map_err(|error| map_request_error(error, Some(input_hex)))?;
    response
        .into_json::<DeriveResponse>()
        .map_err(|_| PassForgeError::Remote("invalid derive response".into()))
}

fn map_request_error(error: ureq::Error, sensitive: Option<&str>) -> PassForgeError {
    let message = match error {
        ureq::Error::Status(status, response) => {
            let detail = response
                .into_json::<ErrorResponse>()
                .ok()
                .map(|body| body.error)
                .filter(|message| !message.is_empty())
                .unwrap_or_else(|| "request failed".into());
            format!("HTTP {status}: {detail}")
        }
        ureq::Error::Transport(error) => error.to_string(),
    };
    PassForgeError::Remote(redact_sensitive(message, sensitive))
}

fn redact_sensitive(message: String, sensitive: Option<&str>) -> String {
    let Some(sensitive) = sensitive.filter(|value| !value.is_empty()) else {
        return message;
    };
    let lowercase_message = message.to_ascii_lowercase();
    let lowercase_sensitive = sensitive.to_ascii_lowercase();
    let mut redacted = String::with_capacity(message.len());
    let mut cursor = 0;
    while let Some(offset) = lowercase_message[cursor..].find(&lowercase_sensitive) {
        let start = cursor + offset;
        let end = start + sensitive.len();
        redacted.push_str(&message[cursor..start]);
        redacted.push_str("[redacted]");
        cursor = end;
    }
    redacted.push_str(&message[cursor..]);
    redacted
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_server_urls() {
        for (input, expected) in [
            ("https://example.com/", "https://example.com"),
            ("  http://localhost:8787///  ", "http://localhost:8787"),
            ("https://example.com/api///", "https://example.com/api"),
        ] {
            assert_eq!(normalize_server_url(input).unwrap(), expected);
        }
        for input in ["", "example.com", "ftp://example.com"] {
            assert!(matches!(
                normalize_server_url(input),
                Err(PassForgeError::InvalidRequest(_))
            ));
        }
    }

    #[test]
    fn server_errors_redact_the_blinded_input() {
        let input = "aBcD0123";
        let message = redact_sensitive("server rejected abcd0123 and ABcD0123".into(), Some(input));
        assert_eq!(message, "server rejected [redacted] and [redacted]");
        assert!(!message
            .to_ascii_lowercase()
            .contains(&input.to_ascii_lowercase()));
    }
}
