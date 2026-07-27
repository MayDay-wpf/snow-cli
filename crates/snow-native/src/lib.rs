use napi::bindgen_prelude::{AsyncTask, Task};
use napi::{Env, Result};
use napi_derive::napi;

#[napi(object)]
pub struct NativeMatch {
  pub start_line: u32,
  pub end_line: u32,
  pub similarity: f64,
}

#[derive(Clone)]
#[napi(object)]
pub struct NativeTextEdit {
  pub kind: String,
  pub start_line: u32,
  pub end_line: u32,
  pub content: Option<String>,
}

fn normalize_whitespace(content: &str) -> String {
  let mut normalized = String::with_capacity(content.len());
  let mut previous_was_whitespace = true;

  for character in content.chars() {
    let is_whitespace = character.is_whitespace() || character == '\u{feff}';
    if is_whitespace {
      if !previous_was_whitespace {
        normalized.push(' ');
      }
    } else {
      normalized.push(character);
    }
    previous_was_whitespace = is_whitespace;
  }

  normalized.trim_end().to_owned()
}

fn levenshtein_distance(left: &[u16], right: &[u16], max_distance: usize) -> usize {
  if left == right {
    return 0;
  }

  if left.len().abs_diff(right.len()) > max_distance {
    return max_distance + 1;
  }

  let mut previous: Vec<usize> = (0..=right.len()).collect();
  for (left_index, left_unit) in left.iter().enumerate() {
    let mut current = Vec::with_capacity(right.len() + 1);
    current.push(left_index + 1);
    let mut minimum = left_index + 1;

    for (right_index, right_unit) in right.iter().enumerate() {
      let value = (previous[right_index + 1] + 1)
        .min(current[right_index] + 1)
        .min(previous[right_index] + usize::from(left_unit != right_unit));
      current.push(value);
      minimum = minimum.min(value);
    }

    if minimum > max_distance {
      return max_distance + 1;
    }
    previous = current;
  }

  previous[right.len()]
}

fn similarity(normalized_left: &str, normalized_right: &str, threshold: f64) -> f64 {
  let left: Vec<u16> = normalized_left.encode_utf16().collect();
  let right: Vec<u16> = normalized_right.encode_utf16().collect();
  if left.is_empty() {
    return if right.is_empty() { 1.0 } else { 0.0 };
  }
  if right.is_empty() {
    return 0.0;
  }

  let max_length = left.len().max(right.len());
  let length_ratio = left.len().min(right.len()) as f64 / max_length as f64;
  if threshold > 0.0 && length_ratio < threshold {
    return length_ratio;
  }

  let max_distance = (max_length as f64 * (1.0 - threshold)).ceil() as usize;
  let distance = levenshtein_distance(&left, &right, max_distance);
  1.0 - distance as f64 / max_length as f64
}

fn scan_fuzzy_matches_sync(
  content: String,
  search: String,
  threshold: f64,
  max_matches: u32,
  use_pre_filter: bool,
  pre_filter_threshold: f64,
) -> Vec<NativeMatch> {
  let lines: Vec<&str> = content.split('\n').collect();
  let search_lines: Vec<&str> = search.split('\n').collect();
  if search_lines.len() > lines.len() {
    return Vec::new();
  }

  let base_window = search_lines.len();
  let normalized_search = normalize_whitespace(&search);
  let normalized_first_line = normalize_whitespace(search_lines.first().copied().unwrap_or_default());
  let mut matches = Vec::new();

  // Variable window size for large code blocks to improve boundary alignment.
  // When the AI provides a large search block, the actual code may differ by a
  // few lines (added/removed/merged). Trying multiple window sizes at each
  // candidate position helps find the correct boundaries and prevents
  // duplicate boundary lines after replacement.
  let window_delta = if base_window >= 10 {
    (base_window / 5).clamp(3, 15)
  } else {
    0
  };

  for start_index in 0..=lines.len() - base_window {
    if use_pre_filter {
      let normalized_candidate = normalize_whitespace(lines[start_index]);
      if similarity(
        &normalized_first_line,
        &normalized_candidate,
        pre_filter_threshold,
      ) < pre_filter_threshold
      {
        continue;
      }
    }

    // Try exact window size first
    let exact_candidate = lines[start_index..start_index + base_window].join("\n");
    let exact_score = if exact_candidate == search {
      1.0
    } else {
      similarity(&normalized_search, &normalize_whitespace(&exact_candidate), threshold)
    };

    // High-confidence match: accept immediately without trying other sizes
    if exact_score >= 0.9 {
      matches.push(NativeMatch {
        start_line: (start_index + 1) as u32,
        end_line: (start_index + base_window) as u32,
        similarity: exact_score,
      });
      if exact_score >= 0.95 || matches.len() >= max_matches as usize {
        break;
      }
      continue;
    }

    // For large blocks, try variable window sizes for better boundary alignment
    if window_delta > 0 {
      let mut best_score = exact_score;
      let mut best_end = start_index + base_window;

      for delta in 1..=window_delta {
        // Try smaller window
        if base_window > delta {
          let smaller = base_window - delta;
          let candidate = lines[start_index..start_index + smaller].join("\n");
          let score = if candidate == search {
            1.0
          } else {
            similarity(&normalized_search, &normalize_whitespace(&candidate), threshold)
          };
          if score > best_score {
            best_score = score;
            best_end = start_index + smaller;
          }
        }

        // Try larger window
        let larger = base_window + delta;
        if start_index + larger <= lines.len() {
          let candidate = lines[start_index..start_index + larger].join("\n");
          let score = if candidate == search {
            1.0
          } else {
            similarity(&normalized_search, &normalize_whitespace(&candidate), threshold)
          };
          if score > best_score {
            best_score = score;
            best_end = start_index + larger;
          }
        }

        // Early exit on near-perfect match
        if best_score >= 0.95 {
          break;
        }
      }

      if best_score >= threshold {
        matches.push(NativeMatch {
          start_line: (start_index + 1) as u32,
          end_line: best_end as u32,
          similarity: best_score,
        });
        if best_score >= 0.95 || matches.len() >= max_matches as usize {
          break;
        }
      }
    } else if exact_score >= threshold {
      // Small block: use exact window only
      matches.push(NativeMatch {
        start_line: (start_index + 1) as u32,
        end_line: (start_index + base_window) as u32,
        similarity: exact_score,
      });
      if exact_score >= 0.95 || matches.len() >= max_matches as usize {
        break;
      }
    }
  }

  matches.sort_by(|left, right| right.similarity.total_cmp(&left.similarity));
  matches
}

fn apply_text_edits_sync(content: String, edits: Vec<NativeTextEdit>) -> String {
  let mut lines: Vec<String> = content.split('\n').map(str::to_owned).collect();

  for edit in edits {
    let start_index = edit.start_line.saturating_sub(1) as usize;
    let end_index = edit.end_line as usize;
    match edit.kind.as_str() {
      "replace" => {
        let replacement: Vec<String> = edit
          .content
          .unwrap_or_default()
          .split('\n')
          .map(str::to_owned)
          .collect();
        lines.splice(start_index..end_index, replacement);
      }
      "insert_after" => {
        let insertion: Vec<String> = edit
          .content
          .unwrap_or_default()
          .split('\n')
          .map(str::to_owned)
          .collect();
        lines.splice(edit.start_line as usize..edit.start_line as usize, insertion);
      }
      "delete" => {
        lines.drain(start_index..end_index);
      }
      _ => {}
    }
  }
lines.join("\n")
}

pub struct ScanFuzzyMatchesTask {
  content: String,
  search: String,
  threshold: f64,
  max_matches: u32,
  use_pre_filter: bool,
  pre_filter_threshold: f64,
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

pub struct ApplyTextEditsTask {
  content: String,
  edits: Vec<NativeTextEdit>,
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
#[napi]
pub fn apply_text_edits(
    content: String,
    edits: Vec<NativeTextEdit>,
) -> AsyncTask<ApplyTextEditsTask> {
    AsyncTask::new(ApplyTextEditsTask { content, edits })
}

