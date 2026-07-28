use crate::types::NativeTextEdit;

/// Apply a sequence of text edits (replace / insert_after / delete) to `content`.
/// Line numbers are 1-indexed. Returns the modified content.
pub(crate) fn apply_text_edits_sync(content: String, edits: Vec<NativeTextEdit>) -> String {
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
