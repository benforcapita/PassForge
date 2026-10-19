use std::sync::Arc;

use argon2::{Algorithm, Argon2, Params, Version};
use axum::{
    Json, Router,
    extract::{Json as JsonExtractor, State, rejection::JsonRejection},
    http::{Method, StatusCode, header},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use hmac::{Hmac, Mac};
use passforge_protocol::{
    AlgorithmInfo, DeriveRequest, DeriveResponse, ErrorResponse, InfoResponse, PROTOCOL,
    decode_hex_input,
};
use pbkdf2::pbkdf2_hmac;
use sha2::{Sha256, Sha512};
use tokio::sync::Semaphore;
use tower_http::{
    cors::{Any, CorsLayer},
    limit::RequestBodyLimitLayer,
};
use zeroize::Zeroizing;

const DEFAULT_ALGORITHM: &str = "argon2id-v1";
const ARGON2ID_ALGORITHM: &str = "argon2id-v1";
const PBKDF2_ALGORITHM: &str = "pbkdf2-sha512-v1";
const PEPPER_ALGORITHM: &str = "hmac-pepper-v1";

pub struct ServerConfig {
    pub name: String,
    pub pepper: Option<Zeroizing<Vec<u8>>>,
    pub max_concurrent: usize,
}

#[derive(Clone)]
struct AppState {
    name: String,
    pepper: Option<Arc<Zeroizing<Vec<u8>>>>,
    semaphore: Arc<Semaphore>,
}

pub fn app(config: ServerConfig) -> Router {
    let state = AppState {
        name: config.name,
        pepper: config.pepper.map(Arc::new),
        semaphore: Arc::new(Semaphore::new(config.max_concurrent)),
    };

    Router::new()
        .route("/v1/info", get(info))
        .route("/v1/derive", post(derive))
        .with_state(state)
        .layer(
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods([Method::GET, Method::POST])
                .allow_headers([header::CONTENT_TYPE]),
        )
        .layer(RequestBodyLimitLayer::new(4 * 1024))
}

async fn info(State(state): State<AppState>) -> Json<InfoResponse> {
    let mut algorithms = vec![
        AlgorithmInfo {
            id: ARGON2ID_ALGORITHM.into(),
            description: "Argon2id m=64MiB t=3 p=1".into(),
            portable: true,
        },
        AlgorithmInfo {
            id: PBKDF2_ALGORITHM.into(),
            description: "PBKDF2-HMAC-SHA512 iterations=210000".into(),
            portable: true,
        },
    ];
    if state.pepper.is_some() {
        algorithms.push(AlgorithmInfo {
            id: PEPPER_ALGORITHM.into(),
            description: "HMAC-SHA256 with server pepper".into(),
            portable: false,
        });
    }
    Json(InfoResponse {
        protocol: PROTOCOL.into(),
        name: state.name,
        version: env!("CARGO_PKG_VERSION").into(),
        default_algorithm: DEFAULT_ALGORITHM.into(),
        algorithms,
    })
}

async fn derive(
    State(state): State<AppState>,
    payload: Result<JsonExtractor<DeriveRequest>, JsonRejection>,
) -> Response {
    let Json(request) = match payload {
        Ok(payload) => payload,
        Err(rejection) => {
            let status = rejection.into_response().status();
            let (status, message) = if status == StatusCode::PAYLOAD_TOO_LARGE {
                (StatusCode::PAYLOAD_TOO_LARGE, "request body too large")
            } else {
                (StatusCode::BAD_REQUEST, "malformed JSON request")
            };
            return error_response(status, message);
        }
    };

    let algorithm = request
        .algorithm
        .unwrap_or_else(|| DEFAULT_ALGORITHM.to_owned());
    if !is_supported_algorithm(&algorithm, state.pepper.is_some()) {
        return error_response(StatusCode::BAD_REQUEST, "unknown algorithm");
    }
    let input = match decode_hex_input(&request.input) {
        Ok(input) => input,
        Err(_) => return error_response(StatusCode::BAD_REQUEST, "input must be 32-byte hex"),
    };
    let pepper = state.pepper.clone();
    let response_algorithm = algorithm.clone();
    let permit = match state.semaphore.clone().try_acquire_owned() {
        Ok(permit) => permit,
        Err(_) => return error_response(StatusCode::SERVICE_UNAVAILABLE, "server overloaded"),
    };

    let result = tokio::task::spawn_blocking(move || {
        let _permit = permit;
        derive_output(
            &algorithm,
            &input,
            pepper.as_deref().map(|value| value.as_slice()),
        )
    })
    .await;

    match result {
        Ok(Ok(output)) => Json(DeriveResponse {
            algorithm: response_algorithm,
            output: hex::encode(output),
        })
        .into_response(),
        _ => error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            "algorithm derivation failed",
        ),
    }
}

fn is_supported_algorithm(algorithm: &str, has_pepper: bool) -> bool {
    matches!(algorithm, ARGON2ID_ALGORITHM | PBKDF2_ALGORITHM)
        || (algorithm == PEPPER_ALGORITHM && has_pepper)
}

fn derive_output(
    algorithm: &str,
    input: &[u8; 32],
    pepper: Option<&[u8]>,
) -> Result<[u8; 32], String> {
    let mut output = [0u8; 32];
    match algorithm {
        ARGON2ID_ALGORITHM => {
            let params = Params::new(65_536, 3, 1, Some(32)).map_err(|e| e.to_string())?;
            let argon = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
            argon
                .hash_password_into(input, b"passforge-argon2id-v1", &mut output)
                .map_err(|e| e.to_string())?;
        }
        PBKDF2_ALGORITHM => {
            pbkdf2_hmac::<Sha512>(input, b"passforge-pbkdf2-sha512-v1", 210_000, &mut output)
        }
        PEPPER_ALGORITHM => {
            let pepper = pepper.ok_or_else(|| "pepper is not configured".to_owned())?;
            let mut mac =
                Hmac::<Sha256>::new_from_slice(pepper).expect("HMAC accepts any key size");
            mac.update(b"passforge-pepper-v1");
            mac.update(input);
            output.copy_from_slice(&mac.finalize().into_bytes());
        }
        _ => return Err("unknown algorithm".into()),
    }
    Ok(output)
}

fn error_response(status: StatusCode, error: &str) -> Response {
    (
        status,
        Json(ErrorResponse {
            error: error.into(),
        }),
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::Body,
        http::{Request, header::CONTENT_TYPE},
    };
    use http_body_util::BodyExt;
    use lesspass_core::types::{CryptoConfig, PasswordOptions, PasswordProfile};
    use passforge_protocol::{DeriveResponse, blind, finish_password};
    use serde::de::DeserializeOwned;
    use tower::ServiceExt;

    fn config(pepper: Option<Vec<u8>>) -> ServerConfig {
        ServerConfig {
            name: "test server".into(),
            pepper: pepper.map(Zeroizing::new),
            max_concurrent: 4,
        }
    }

    async fn response_json<T: DeserializeOwned>(response: Response) -> (StatusCode, T) {
        let status = response.status();
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        (status, serde_json::from_slice(&bytes).unwrap())
    }

    async fn post_json(app: Router, value: serde_json::Value) -> Response {
        app.oneshot(
            Request::post("/v1/derive")
                .header(CONTENT_TYPE, "application/json")
                .body(Body::from(value.to_string()))
                .unwrap(),
        )
        .await
        .unwrap()
    }

    #[tokio::test]
    async fn info_lists_algorithms_based_on_pepper_configuration() {
        let (status, info): (StatusCode, InfoResponse) = response_json(
            app(config(None))
                .oneshot(Request::get("/v1/info").body(Body::empty()).unwrap())
                .await
                .unwrap(),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(info.algorithms.len(), 2);

        let (_, info): (StatusCode, InfoResponse) = response_json(
            app(config(Some(vec![7; 32])))
                .oneshot(Request::get("/v1/info").body(Body::empty()).unwrap())
                .await
                .unwrap(),
        )
        .await;
        assert_eq!(info.algorithms.len(), 3);
        assert_eq!(info.algorithms[2].id, PEPPER_ALGORITHM);
    }

    #[tokio::test]
    async fn default_derivation_echoes_argon2_algorithm() {
        let response = post_json(
            app(config(None)),
            serde_json::json!({ "input": hex::encode([1u8; 32]) }),
        )
        .await;
        let (status, result): (StatusCode, DeriveResponse) = response_json(response).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(result.algorithm, ARGON2ID_ALGORITHM);
        assert_eq!(hex::decode(result.output).unwrap().len(), 32);
    }

    #[tokio::test]
    async fn malformed_values_and_unknown_algorithms_are_bad_requests() {
        let server = app(config(None));
        for request in [
            serde_json::json!({ "algorithm": "unknown", "input": hex::encode([1u8; 32]) }),
            serde_json::json!({ "algorithm": "pbkdf2-sha512-v1", "input": "zz" }),
            serde_json::json!({ "algorithm": "pbkdf2-sha512-v1", "input": hex::encode([1u8; 31]) }),
            serde_json::json!({ "algorithm": PEPPER_ALGORITHM, "input": hex::encode([1u8; 32]) }),
        ] {
            let (status, error): (StatusCode, ErrorResponse) =
                response_json(post_json(server.clone(), request).await).await;
            assert_eq!(status, StatusCode::BAD_REQUEST);
            assert!(!error.error.is_empty());
        }

        let response = server
            .oneshot(
                Request::post("/v1/derive")
                    .header(CONTENT_TYPE, "application/json")
                    .body(Body::from("{"))
                    .unwrap(),
            )
            .await
            .unwrap();
        let (status, _error): (StatusCode, ErrorResponse) = response_json(response).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn pepper_algorithm_is_available_when_configured() {
        let response = post_json(
            app(config(Some(vec![7; 32]))),
            serde_json::json!({
                "algorithm": PEPPER_ALGORITHM,
                "input": hex::encode([1u8; 32]),
            }),
        )
        .await;
        let (status, result): (StatusCode, DeriveResponse) = response_json(response).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(result.algorithm, PEPPER_ALGORITHM);
        assert_eq!(
            result.output,
            "4491f672b267272b5d6646f857e902f64fa2e384358a5852526cbbb7cc3a2379"
        );
    }

    #[tokio::test]
    async fn oversized_request_returns_413_json() {
        let response = app(config(None))
            .oneshot(
                Request::post("/v1/derive")
                    .header(CONTENT_TYPE, "application/json")
                    .body(Body::from(" ".repeat(4097)))
                    .unwrap(),
            )
            .await
            .unwrap();
        let (status, error): (StatusCode, ErrorResponse) = response_json(response).await;
        assert_eq!(status, StatusCode::PAYLOAD_TOO_LARGE);
        assert_eq!(error.error, "request body too large");
    }

    #[test]
    fn algorithm_outputs_match_independent_vectors() {
        let input = [1u8; 32];
        assert_eq!(
            hex::encode(derive_output(ARGON2ID_ALGORITHM, &input, None).unwrap()),
            "43bf56971244bebe9d885ee39e364e2faecf634534b5e80e52689c2def732fa2"
        );
        assert_eq!(
            hex::encode(derive_output(PBKDF2_ALGORITHM, &input, None).unwrap()),
            "ac0e87b0ad46eb95d13591037e8598adae6e662c35c9d93e0a8be1223995a064"
        );
        assert_eq!(
            hex::encode(derive_output(PEPPER_ALGORITHM, &input, Some(&[7u8; 32])).unwrap()),
            "4491f672b267272b5d6646f857e902f64fa2e384358a5852526cbbb7cc3a2379"
        );
    }

    #[tokio::test]
    async fn end_to_end_derivation_is_deterministic_and_algorithm_specific() {
        let profile = PasswordProfile {
            site: "example.org".into(),
            login: "alice@example.org".into(),
            counter: 1,
            options: PasswordOptions::default(),
            salt_fields: vec![],
            crypto: None,
        };
        let crypto = CryptoConfig::default();
        let blinded = blind(&profile, "master password", &crypto);
        let server = app(config(None));

        async fn derive_password(
            server: Router,
            blinded: &passforge_protocol::Blinded,
            algorithm: &str,
        ) -> String {
            let request = serde_json::json!({
                "algorithm": algorithm,
                "input": blinded.input_hex(),
            });
            let (status, response): (StatusCode, DeriveResponse) =
                response_json(post_json(server, request).await).await;
            assert_eq!(status, StatusCode::OK);
            finish_password(
                blinded,
                &hex::decode(response.output).unwrap(),
                &PasswordOptions::default(),
            )
            .unwrap()
        }

        let argon_first = derive_password(server.clone(), &blinded, ARGON2ID_ALGORITHM).await;
        let argon_second = derive_password(server.clone(), &blinded, ARGON2ID_ALGORITHM).await;
        let pbkdf2 = derive_password(server, &blinded, PBKDF2_ALGORITHM).await;
        assert_eq!(argon_first.len(), 16);
        assert_eq!(argon_first, argon_second);
        assert_ne!(argon_first, pbkdf2);
    }
}
