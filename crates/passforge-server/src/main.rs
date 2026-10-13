use std::{env, error::Error, net::SocketAddr};

use passforge_server::{ServerConfig, app};
use zeroize::Zeroizing;

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    let bind = env::var("PASSFORGE_BIND").unwrap_or_else(|_| "127.0.0.1:8787".into());
    let address: SocketAddr = bind.parse()?;
    let name =
        env::var("PASSFORGE_SERVER_NAME").unwrap_or_else(|_| "PassForge reference server".into());
    let pepper = load_pepper()?;
    let max_concurrent = match env::var("PASSFORGE_MAX_CONCURRENT") {
        Ok(value) => value.parse::<usize>()?,
        Err(env::VarError::NotPresent) => 4,
        Err(error) => return Err(error.into()),
    };
    let mut algorithms = vec!["argon2id-v1", "pbkdf2-sha512-v1"];
    if pepper.is_some() {
        algorithms.push("hmac-pepper-v1");
    }
    println!(
        "passforge-server listening on {address}; algorithms: {}",
        algorithms.join(", ")
    );

    let listener = tokio::net::TcpListener::bind(address).await?;
    axum::serve(
        listener,
        app(ServerConfig {
            name,
            pepper,
            max_concurrent,
        }),
    )
    .await?;
    Ok(())
}

fn load_pepper() -> Result<Option<Zeroizing<Vec<u8>>>, Box<dyn Error>> {
    let value = match env::var("PASSFORGE_PEPPER_FILE") {
        Ok(path) => Some(std::fs::read_to_string(path)?),
        Err(_) => env::var("PASSFORGE_PEPPER").ok(),
    };
    value
        .map(|value| {
            let decoded = hex::decode(value.trim())?;
            if decoded.len() < 32 {
                return Err("pepper must decode to at least 32 bytes".into());
            }
            Ok(Zeroizing::new(decoded))
        })
        .transpose()
}
