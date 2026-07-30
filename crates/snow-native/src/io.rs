//! File I/O with automatic encoding detection and conversion.
//!
//! All functions are designed to be called from `AsyncTask::compute()`
//! (i.e. on a libuv thread-pool thread, never on the Node main thread).
//! Every fallible operation returns `napi::Result` — no `unwrap()`/`expect()`,
//! no panic paths.

use napi::Error as NapiError;

/// 256 MiB — mirrors the Node.js `MAX_READABLE_FILE_BYTES` limit.
const MAX_READABLE_FILE_BYTES: u64 = 256 * 1024 * 1024;

/// Returns `true` if `bytes` is valid UTF-8 **or** starts with a UTF-8 BOM.
///
/// This matches the Node.js `isUtf8Buffer` behaviour exactly: a BOM-prefixed
/// buffer is accepted unconditionally (even if trailing bytes are invalid),
/// because `buffer.toString('utf-8')` would use replacement characters anyway.
fn is_utf8_buffer(bytes: &[u8]) -> bool {
  if bytes.len() >= 3 && bytes[0] == 0xEF && bytes[1] == 0xBB && bytes[2] == 0xBF {
    return true;
  }
  std::str::from_utf8(bytes).is_ok()
}

/// Detect the encoding of a non-UTF-8 byte buffer using `chardetng`.
///
/// `allow_utf8 = false` is passed to the detector because the caller has
/// already ruled out valid UTF-8. GBK / GB2312 are normalised to GB18030
/// (the superset) for round-trip compatibility.
fn detect_encoding(bytes: &[u8]) -> &'static encoding_rs::Encoding {
  let mut detector = chardetng::EncodingDetector::new();
  detector.feed(bytes, true);
  let encoding = detector.guess(None, false);

  // Normalise GBK → GB18030 (superset, matches Node.js iconv behaviour)
  if encoding == encoding_rs::GBK {
    encoding_rs::GB18030
  } else {
    encoding
  }
}

/// Read a file from disk, automatically detecting and converting its encoding
/// to a UTF-8 `String`.
///
/// Flow (mirrors `readFileWithEncoding` in `encoding.utils.ts`):
/// 1. `metadata()` — reject files larger than 256 MiB *before* reading.
/// 2. `read()` — load raw bytes.
/// 3. If valid UTF-8 (or BOM) → `String::from_utf8_lossy`.
/// 4. Otherwise → `chardetng` detect + `encoding_rs` decode.
pub(crate) fn read_file_sync(path: String) -> napi::Result<String> {
  // --- size check (avoid loading huge files into memory) ---
  let metadata = std::fs::metadata(&path)
    .map_err(|e| NapiError::from_reason(format!("Failed to stat '{path}': {e}")))?;

  if metadata.len() > MAX_READABLE_FILE_BYTES {
    return Err(NapiError::from_reason(format!(
      "File too large ({}MB, limit {}MB): {path}",
      metadata.len() / 1024 / 1024,
      MAX_READABLE_FILE_BYTES / 1024 / 1024,
    )));
  }

  // --- read raw bytes ---
  let bytes = std::fs::read(&path)
    .map_err(|e| NapiError::from_reason(format!("Failed to read '{path}': {e}")))?;

  // --- UTF-8 fast path (includes BOM-prefixed files) ---
  if is_utf8_buffer(&bytes) {
    // from_utf8_lossy replaces any invalid trailing sequences (BOM edge-case)
    return Ok(String::from_utf8_lossy(&bytes).into_owned());
  }

  // --- non-UTF-8: detect + decode ---
  let encoding = detect_encoding(&bytes);
  let (decoded, _encoding, _had_errors) = encoding.decode(&bytes);
  Ok(decoded.into_owned())
}

/// Write `content` to `path`, preserving the existing file's encoding if the
/// file already exists and is non-UTF-8. New files are written as UTF-8.
///
/// Flow (mirrors `writeFileWithEncoding` in `encoding.utils.ts`):
/// 1. Try to read the existing file to detect its encoding.
/// 2. If existing file is non-UTF-8 → encode `content` back to that encoding.
/// 3. Otherwise → write as UTF-8.
/// 4. On any encoding error → fall back to UTF-8 (never fail the write).
pub(crate) fn write_file_sync(path: String, content: String) -> napi::Result<()> {
  // Determine target encoding from the existing file (if any).
  let target_encoding: Option<&'static encoding_rs::Encoding> = match std::fs::read(&path) {
    Ok(existing) if !is_utf8_buffer(&existing) => Some(detect_encoding(&existing)),
    // File is UTF-8, empty, or doesn't exist → use UTF-8
    _ => None,
  };

  match target_encoding {
    None => {
      // UTF-8 path — `String` is already valid UTF-8, just write the bytes.
      std::fs::write(&path, content.as_bytes())
        .map_err(|e| NapiError::from_reason(format!("Failed to write '{path}': {e}")))?;
    }
    Some(encoding) => {
      // Non-UTF-8 path — encode the string back to the original encoding.
      let (encoded, _encoding, _had_errors) = encoding.encode(&content);
      std::fs::write(&path, &encoded)
        .map_err(|e| NapiError::from_reason(format!("Failed to write '{path}': {e}")))?;
    }
  }

  Ok(())
}
