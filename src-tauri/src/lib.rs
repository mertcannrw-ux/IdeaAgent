use std::collections::HashSet;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};

use keyring::Entry;
use tauri::ipc::CapabilityBuilder;
use tauri::{AppHandle, Manager};
use url::{Host, Url};

const SERVICE: &str = "app.radar.desktop";
const KEY_IDS: [&str; 5] = [
    "github_token",
    "anthropic_key",
    "openai_key",
    "exa_key",
    "brave_key",
];
static ORIGIN_COUNTER: AtomicU64 = AtomicU64::new(1);
static ALLOWED_ORIGINS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();

fn validate_key_id(id: &str) -> Result<(), String> {
    if KEY_IDS.contains(&id) {
        Ok(())
    } else {
        Err("Radar does not recognise that key slot; restart the app and try again.".to_string())
    }
}

fn keyring_error(action: &str) -> String {
    format!(
        "Radar could not {action} the key in the system keychain; unlock it and try again."
    )
}

#[tauri::command]
fn secret_get(id: String) -> Result<Option<String>, String> {
    validate_key_id(&id)?;
    let entry = Entry::new(SERVICE, &id).map_err(|_| keyring_error("read"))?;
    match entry.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => Err(keyring_error("read")),
    }
}

#[tauri::command]
fn secret_has(id: String) -> Result<bool, String> {
    validate_key_id(&id)?;
    let entry = Entry::new(SERVICE, &id).map_err(|_| keyring_error("read"))?;
    match entry.get_password() {
        Ok(_) => Ok(true),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(_) => Err(keyring_error("read")),
    }
}

#[tauri::command]
fn secret_set(id: String, value: String) -> Result<(), String> {
    validate_key_id(&id)?;
    if value.trim().is_empty() {
        return Err("Paste a key before saving.".to_string());
    }
    let entry = Entry::new(SERVICE, &id).map_err(|_| keyring_error("save"))?;
    entry
        .set_password(&value)
        .map_err(|_| keyring_error("save"))
}

#[tauri::command]
fn secret_delete(id: String) -> Result<(), String> {
    validate_key_id(&id)?;
    let entry = Entry::new(SERVICE, &id).map_err(|_| keyring_error("remove"))?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err(keyring_error("remove")),
    }
}

#[tauri::command]
fn allow_http_origin(app: AppHandle, origin: String) -> Result<(), String> {
    let parsed = Url::parse(&origin)
        .map_err(|_| "Enter a valid base URL for the OpenAI-compatible provider.".to_string())?;
    let local = match parsed.host() {
        Some(Host::Domain(domain)) => domain == "localhost",
        Some(Host::Ipv4(address)) => address.is_loopback(),
        Some(Host::Ipv6(address)) => address.is_loopback(),
        None => false,
    };
    if parsed.scheme() != "https" && !(parsed.scheme() == "http" && local) {
        return Err("Use an HTTPS base URL, or localhost for a local model server.".to_string());
    }
    if !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
        || !(parsed.path().is_empty() || parsed.path() == "/")
    {
        return Err("Use only the origin of the OpenAI-compatible endpoint, without a path.".to_string());
    }
    let allowed = parsed.origin().ascii_serialization();
    let origins = ALLOWED_ORIGINS.get_or_init(|| Mutex::new(HashSet::new()));
    {
        let guard = origins
            .lock()
            .map_err(|_| "Radar could not allow that endpoint; restart the app and try again.".to_string())?;
        if guard.contains(&allowed) {
            return Ok(());
        }
        if guard.len() >= 8 {
            return Err(
                "Radar allowed too many custom endpoints this session; restart the app and try again."
                    .to_string(),
            );
        }
    }
    let index = ORIGIN_COUNTER.fetch_add(1, Ordering::SeqCst);
    let capability = CapabilityBuilder::new(format!("runtime-http-{index}"))
        .window("main")
        .permission_scoped(
            "http:allow-fetch",
            vec![serde_json::json!({ "url": allowed.clone() })],
            vec![],
        )
        .permission_scoped(
            "http:allow-fetch-send",
            vec![serde_json::json!({ "url": allowed.clone() })],
            vec![],
        );
    if let Err(error) = app.add_capability(capability) {
        let _ = error;
        return Err(
            "Radar could not allow that endpoint; restart the app and try again.".to_string(),
        );
    }
    if let Ok(mut guard) = origins.lock() {
        guard.insert(allowed);
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_persisted_scope::init())
        .invoke_handler(tauri::generate_handler![
            secret_get,
            secret_has,
            secret_set,
            secret_delete,
            allow_http_origin
        ])
        .run(tauri::generate_context!())
        .expect("error while running Radar");
}
