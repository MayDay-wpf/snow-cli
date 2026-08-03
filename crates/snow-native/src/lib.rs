//! snow-native — native acceleration for file I/O, fuzzy matching and text editing.
//!
//! All `#[napi]` exports return `AsyncTask<T>` so that heavy work runs on the
//! libuv thread-pool, never blocking the Node.js main thread.

mod fuzzy_match;
mod io;
mod phantom;
mod similarity;
mod task;
mod text_edit;
mod types;

use napi::bindgen_prelude::AsyncTask;
use napi_derive::napi;

use crate::task::{
	ApplyTextEditsTask, ReadFileTask, ScanFuzzyMatchesTask, SweepPhantomWindowsTask,
	WriteFileTask,
};
use crate::types::NativeTextEdit;

// ── fuzzy match ───────────────────────────────────────────────────────────

#[napi]
pub fn scan_fuzzy_matches(
  content: String,
  search: String,
  threshold: f64,
  max_matches: u32,
  use_pre_filter: bool,
  pre_filter_threshold: f64,
) -> AsyncTask<ScanFuzzyMatchesTask> {
  AsyncTask::new(ScanFuzzyMatchesTask {
    content,
    search,
    threshold,
    max_matches,
    use_pre_filter,
    pre_filter_threshold,
  })
}

// ── text edit ─────────────────────────────────────────────────────────────

#[napi]
pub fn apply_text_edits(
  content: String,
  edits: Vec<NativeTextEdit>,
) -> AsyncTask<ApplyTextEditsTask> {
  AsyncTask::new(ApplyTextEditsTask { content, edits })
}

// ── file I/O ──────────────────────────────────────────────────────────────

/// Read a file with automatic encoding detection.
/// Runs on a libuv thread — never blocks the Node main thread.
#[napi]
pub fn read_file(path: String) -> AsyncTask<ReadFileTask> {
  AsyncTask::new(ReadFileTask { path })
}

/// Write a file, preserving the original encoding if the file already exists.
/// Runs on a libuv thread — never blocks the Node main thread.
#[napi]
pub fn write_file(path: String, content: String) -> AsyncTask<WriteFileTask> {
  AsyncTask::new(WriteFileTask { path, content })
}

// ── phantom-window sweep ──────────────────────────────────────────────────

/// Destroy orphaned Chromium/Edge top-level windows whose owning process has
/// already exited (the source of blank "phantom" Alt+Tab entries after
/// Edge/Chrome closes). Windows of running browsers are never touched.
///
/// Returns the number of windows actually destroyed. On non-Windows this is
/// a no-op returning 0.
#[napi]
pub fn sweep_phantom_windows() -> AsyncTask<SweepPhantomWindowsTask> {
  AsyncTask::new(SweepPhantomWindowsTask)
}
