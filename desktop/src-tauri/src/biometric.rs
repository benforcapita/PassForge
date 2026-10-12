//! Touch ID / biometric gating, macOS only.
//!
//! There is no authentication in PassForge by design — the master password
//! is a pure generation input. Biometrics here are a pure convenience:
//! LAContext gates reading the master password back out of the Keychain
//! after the user opted in to storing it there.
//!
//! On every other platform `available()` is false and `authenticate()`
//! errors, so the frontend can feature-detect cleanly.

#[cfg(target_os = "macos")]
mod imp {
    use crate::error::{PassForgeError, Result};
    use block2::RcBlock;
    use objc2_foundation::{Bool, NSError, NSString};
    use objc2_local_authentication::{LAContext, LAPolicy};
    use std::sync::mpsc::channel;

    /// Whether biometric evaluation is possible right now (Touch ID
    /// hardware + enrolled fingerprints).
    pub fn available() -> bool {
        let context = unsafe { LAContext::new() };
        unsafe {
            context.canEvaluatePolicy_error(LAPolicy::DeviceOwnerAuthenticationWithBiometrics)
        }
        .is_ok()
    }

    /// Prompts for Touch ID; resolves on success, errors otherwise.
    /// The LAContext reply block runs on a private framework queue, so a
    /// plain mpsc channel is enough to turn it synchronous.
    pub fn authenticate(reason: &str) -> Result<()> {
        let context = unsafe { LAContext::new() };
        let (tx, rx) = channel::<Result<()>>();
        let reason = NSString::from_str(reason);
        let block = RcBlock::new(move |success: Bool, error: *mut NSError| {
            let result = if success.as_bool() {
                Ok(())
            } else {
                let detail = unsafe { error.as_ref() }
                    .map(|e| e.localizedDescription().to_string())
                    .unwrap_or_else(|| "authentication failed".to_string());
                Err(PassForgeError::Keychain(detail))
            };
            let _ = tx.send(result);
        });
        unsafe {
            context.evaluatePolicy_localizedReason_reply(
                LAPolicy::DeviceOwnerAuthenticationWithBiometrics,
                &reason,
                &block,
            )
        };
        rx.recv()
            .map_err(|_| PassForgeError::Keychain("biometric evaluation dropped".into()))?
    }
}

#[cfg(not(target_os = "macos"))]
mod imp {
    use crate::error::{PassForgeError, Result};

    pub fn available() -> bool {
        false
    }

    pub fn authenticate(_reason: &str) -> Result<()> {
        Err(PassForgeError::InvalidRequest(
            "biometrics unsupported on this platform".into(),
        ))
    }
}

pub use imp::{authenticate, available};
