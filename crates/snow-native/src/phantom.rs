//! Sweep orphaned Chromium/Edge top-level windows.
//!
//! When Edge/Chrome closes (or is force-killed), hidden top-level windows
//! such as Edge's `EdgeUiInputTopWndClass` input windows can linger in the
//! Windows shell window list even though their owning process has exited —
//! the well-known source of "phantom" / blank entries in Alt+Tab.
//!
//! This module enumerates top-level windows and destroys the ones that are
//! (a) Chromium-family window classes and (b) owned by a **dead** process.
//! Windows owned by running browsers/apps are never touched, so live Edge
//! or Chrome instances are completely safe.

/// Windows implementation via the `windows` crate.
#[cfg(windows)]
mod imp {
	use std::thread::sleep;
	use std::time::Duration;

	use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM, WPARAM, BOOL};
	use windows::Win32::System::Threading::{
		GetExitCodeProcess, GetExitCodeThread, OpenProcess, OpenThread,
		PROCESS_QUERY_LIMITED_INFORMATION, THREAD_QUERY_LIMITED_INFORMATION,
	};
	use windows::Win32::UI::WindowsAndMessaging::{
		DestroyWindow, EnumWindows, GetClassNameW, GetWindowThreadProcessId, IsWindow,
		PostMessageW, WM_CLOSE,
	};

	/// Process exit code meaning "still running" (winbase.h `STILL_ACTIVE`).
	const STILL_ACTIVE: u32 = 259;

	/// Chromium-family window class prefixes (Chrome / Edge / WebView2 all use
	/// the `Chrome_` namespace, e.g. `Chrome_WidgetWin_0`).
	const CHROMIUM_CLASS_PREFIX: &str = "Chrome_";

	/// Edge-specific input-forwarding window classes known to linger as
	/// Alt+Tab ghosts after Edge exits.
	const EDGE_INPUT_CLASSES: &[&str] = &[
		"EdgeUiInputTopWndClass",
		"EdgeUiInputWindowClass",
		"EdgeUiInputWndClass",
	];

	fn is_chromium_window_class(class_name: &str) -> bool {
		class_name.starts_with(CHROMIUM_CLASS_PREFIX)
			|| EDGE_INPUT_CLASSES.iter().any(|c| *c == class_name)
	}

	/// Returns `true` when `pid` does not refer to a running process.
	///
	/// Access-denied is treated as *alive*: we must never destroy a window we
	/// cannot positively verify is orphaned.
	fn process_is_dead(pid: u32) -> bool {
		if pid == 0 {
			return true;
		}
		let Ok(handle) =
			(unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) })
		else {
			return false;
		};
		let mut exit_code = 0u32;
		let query_ok = unsafe { GetExitCodeProcess(handle, &mut exit_code) }.is_ok();
		let _ = unsafe { CloseHandle(handle) };
		query_ok && exit_code != STILL_ACTIVE
	}

	/// Returns `true` when thread `tid` has terminated.
	///
	/// A window can outlive its creating thread (e.g. the Chromium UI thread
	/// crashed but the process still runs) — such windows are unowned zombies
	/// that surface as Alt+Tab ghosts. OpenThread failure is treated as alive
	/// (conservative: cannot verify → don't touch).
	fn thread_is_dead(tid: u32) -> bool {
		if tid == 0 {
			return true;
		}
		let Ok(handle) =
			(unsafe { OpenThread(THREAD_QUERY_LIMITED_INFORMATION, false, tid) })
		else {
			return false;
		};
		let mut exit_code = 0u32;
		let query_ok = unsafe { GetExitCodeThread(handle, &mut exit_code) }.is_ok();
		let _ = unsafe { CloseHandle(handle) };
		query_ok && exit_code != STILL_ACTIVE
	}

	/// A window is orphaned when its owning process exited **or** its creating
	/// thread terminated while the process is still alive.
	fn window_is_orphaned(thread_id: u32, process_id: u32) -> bool {
		process_is_dead(process_id) || thread_is_dead(thread_id)
	}

	unsafe extern "system" fn collect_window(hwnd: HWND, lparam: LPARAM) -> BOOL {
		// SAFETY: `lparam` carries a `*mut Vec<HWND>` that lives for the whole
		// EnumWindows call (the caller keeps it on its own stack).
		let windows = unsafe { &mut *(lparam.0 as *mut Vec<HWND>) };
		windows.push(hwnd);
		BOOL(1)
	}

	/// Enumerate all top-level windows and destroy the orphaned Chromium/Edge
	/// ones (owner process already exited). Returns how many windows were
	/// actually destroyed.
	pub fn sweep_orphan_chromium_windows_sync() -> u32 {
		let mut all_windows: Vec<HWND> = Vec::new();
		unsafe {
			let _ = EnumWindows(
				Some(collect_window),
				LPARAM(&mut all_windows as *mut Vec<HWND> as isize),
			);
		}

		// Pass 1 — find candidates: Chromium-class windows owned by dead PIDs.
		let mut targets: Vec<HWND> = Vec::new();
		for hwnd in all_windows {
			let mut class_buf = [0u16; 96];
			let len = unsafe { GetClassNameW(hwnd, &mut class_buf) };
			if len <= 0 {
				continue;
			}
			let class_name = String::from_utf16_lossy(&class_buf[..len as usize]);
			if !is_chromium_window_class(&class_name) {
				continue;
			}
			let mut pid = 0u32;
			let thread_id = unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
			if !window_is_orphaned(thread_id, pid) {
				continue;
			}
			targets.push(hwnd);
		}

		if targets.is_empty() {
			return 0;
		}

		// Pass 2 — polite WM_CLOSE first (the window may still have a message
		// pump that can shut itself down cleanly).
		for hwnd in &targets {
			unsafe {
				let _ = PostMessageW(*hwnd, WM_CLOSE, WPARAM(0), LPARAM(0));
			}
		}

		// Pass 3 — give the window manager a moment, then force-destroy any
		// window that is still alive.
		sleep(Duration::from_millis(150));
		let mut destroyed = 0u32;
		for hwnd in targets {
			if unsafe { IsWindow(hwnd).as_bool() } {
				unsafe {
					let _ = DestroyWindow(hwnd);
				}
				destroyed += 1;
			}
		}
		destroyed
	}
}

/// Non-Windows fallback: nothing to sweep.
#[cfg(not(windows))]
mod imp {
	pub fn sweep_orphan_chromium_windows_sync() -> u32 {
		0
	}
}

pub use imp::sweep_orphan_chromium_windows_sync;
