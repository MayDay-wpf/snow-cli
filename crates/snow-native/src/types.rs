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
