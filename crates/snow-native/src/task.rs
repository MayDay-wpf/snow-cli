//! NAPI `AsyncTask` wrappers.
//!
//! Every struct implements `napi::Task`, whose `compute()` runs on a **libuv
//! thread-pool thread** — never on the Node main thread.  This is critical:
//! all file I/O and CPU-heavy work happens off-thread, so the Node event loop
//! is never blocked.  `resolve()` runs back on the main thread and only does
//! cheap value conversions.

use napi::bindgen_prelude::{Env, Result, Task};

use crate::fuzzy_match::scan_fuzzy_matches_sync;
use crate::io::{read_file_sync, write_file_sync};
use crate::text_edit::apply_text_edits_sync;
use crate::types::{NativeMatch, NativeTextEdit};

// ── fuzzy match ───────────────────────────────────────────────────────────

pub struct ScanFuzzyMatchesTask {
  pub content: String,
  pub search: String,
  pub threshold: f64,
  pub max_matches: u32,
  pub use_pre_filter: bool,
  pub pre_filter_threshold: f64,
}

impl Task for ScanFuzzyMatchesTask {
  type Output = Vec<NativeMatch>;
  type JsValue = Vec<NativeMatch>;

  fn compute(&mut self) -> Result<Self::Output> {
    Ok(scan_fuzzy_matches_sync(
      std::mem::take(&mut self.content),
      std::mem::take(&mut self.search),
      self.threshold,
      self.max_matches,
      self.use_pre_filter,
      self.pre_filter_threshold,
    ))
  }

  fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
    Ok(output)
  }
}

// ── text edit ─────────────────────────────────────────────────────────────

pub struct ApplyTextEditsTask {
  pub content: String,
  pub edits: Vec<NativeTextEdit>,
}

impl Task for ApplyTextEditsTask {
  type Output = String;
  type JsValue = String;

  fn compute(&mut self) -> Result<Self::Output> {
    Ok(apply_text_edits_sync(
      std::mem::take(&mut self.content),
      std::mem::take(&mut self.edits),
    ))
  }

  fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
    Ok(output)
  }
}

// ── file read ─────────────────────────────────────────────────────────────

pub struct ReadFileTask {
  pub path: String,
}

impl Task for ReadFileTask {
  type Output = String;
  type JsValue = String;

  /// Runs on a libuv thread — blocking `std::fs` is safe here.
  fn compute(&mut self) -> Result<Self::Output> {
    read_file_sync(std::mem::take(&mut self.path))
  }

  fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
    Ok(output)
  }
}

// ── file write ────────────────────────────────────────────────────────────

pub struct WriteFileTask {
  pub path: String,
  pub content: String,
}

impl Task for WriteFileTask {
  type Output = ();
  type JsValue = ();

  /// Runs on a libuv thread — blocking `std::fs` is safe here.
  fn compute(&mut self) -> Result<Self::Output> {
    write_file_sync(std::mem::take(&mut self.path), std::mem::take(&mut self.content))
  }

  fn resolve(&mut self, _env: Env, _output: Self::Output) -> Result<Self::JsValue> {
    Ok(())
  }
}

// ── phantom-window sweep ──────────────────────────────────────────────────
// Windows-only: destroys orphaned Chromium/Edge windows (owner process
// exited) that linger as blank Alt+Tab entries. Returns the number of
// windows actually destroyed.

pub struct SweepPhantomWindowsTask;

impl Task for SweepPhantomWindowsTask {
  type Output = u32;
  type JsValue = u32;

  /// Runs on a libuv thread — EnumWindows + a short sleep are safe here.
  fn compute(&mut self) -> Result<Self::Output> {
    Ok(crate::phantom::sweep_orphan_chromium_windows_sync())
  }

  fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
    Ok(output)
  }
}
