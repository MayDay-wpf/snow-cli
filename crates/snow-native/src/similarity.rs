/// Normalize whitespace: collapse consecutive whitespace into a single space,
/// strip leading/trailing whitespace, and treat BOM as whitespace.
pub(crate) fn normalize_whitespace(content: &str) -> String {
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

/// Levenshtein edit distance on UTF-16 code units (matches JS string comparison).
/// Early-exits when the distance exceeds `max_distance`.
pub(crate) fn levenshtein_distance(left: &[u16], right: &[u16], max_distance: usize) -> usize {
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

/// Normalized similarity score in [0, 1] based on Levenshtein distance.
/// If `threshold > 0` and the length ratio is below it, returns early with the
/// length ratio to skip the expensive distance computation.
pub(crate) fn similarity(normalized_left: &str, normalized_right: &str, threshold: f64) -> f64 {
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
