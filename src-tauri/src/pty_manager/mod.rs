//! Spawns and tracks one PTY session per pane (FR-08, ADR-0003, ADR-0007).
//! Sole owner of `PtySession` (architecture.md §5.3) — runtime-only, never
//! persisted. Closing a pane tears down exactly its own session; sessions
//! are fully independent of one another.
//!
//! The output callback (`on_output`) is a plain closure rather than a Tauri
//! `AppHandle` directly — that keeps this module testable without a running
//! Tauri app, and matches the pattern used in `command_runner`.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::Mutex;
use std::thread;

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use thiserror::Error;
use uuid::Uuid;

use crate::command_runner::{self, CommandRunnerError};
use crate::project_store::Project;

#[derive(Debug, Error)]
pub enum PtyError {
    #[error("failed to open a pseudo-terminal")]
    OpenFailed,
    #[error("failed to spawn the shell")]
    SpawnFailed,
    #[error("terminal session not found")]
    SessionNotFound,
    #[error("failed to write to the terminal")]
    WriteFailed,
    #[error("failed to resize the terminal")]
    ResizeFailed,
}

impl From<CommandRunnerError> for PtyError {
    fn from(_: CommandRunnerError) -> Self {
        PtyError::WriteFailed
    }
}

struct Session {
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    child: Box<dyn Child + Send + Sync>,
}

#[derive(Default)]
pub struct PtyManager {
    sessions: Mutex<HashMap<Uuid, Session>>,
}

impl PtyManager {
    pub fn new() -> Self {
        Self { sessions: Mutex::new(HashMap::new()) }
    }

    /// Spawns a plain shell at `cwd` under `session_id`. `on_output` is called
    /// from a background thread every time the shell produces output — it
    /// must be cheap and non-blocking (e.g. forward to a channel or emit a
    /// Tauri event), never block waiting on the caller.
    pub fn spawn(
        &self,
        session_id: Uuid,
        cwd: &Path,
        mut on_output: impl FnMut(&str) + Send + 'static,
    ) -> Result<(), PtyError> {
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize { rows: 24, cols: 80, pixel_width: 0, pixel_height: 0 })
            .map_err(|_| PtyError::OpenFailed)?;

        let mut cmd = CommandBuilder::new(default_shell());
        cmd.cwd(cwd);
        // Root cause of the "garbled input after Backspace" report: this
        // process's own environment doesn't always carry TERM (e.g. when
        // launched from a desktop/.desktop-file launcher rather than a
        // terminal — there's no parent terminal to have ever set it), and
        // without it the spawned shell's line editor (zsh's ZLE, driving
        // autosuggestions/syntax-highlighting) falls back to a limited/
        // wrong terminfo capability profile and emits cursor-movement
        // sequences that don't match what xterm.js (an xterm-256color-
        // compatible terminal) expects. Set it explicitly so the child
        // shell's terminal capability detection is correct regardless of
        // how this app itself was launched.
        cmd.env("TERM", "xterm-256color");

        let child = pair.slave.spawn_command(cmd).map_err(|_| PtyError::SpawnFailed)?;
        drop(pair.slave);

        let mut reader = pair.master.try_clone_reader().map_err(|_| PtyError::OpenFailed)?;
        let writer = pair.master.take_writer().map_err(|_| PtyError::OpenFailed)?;

        thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => on_output(&String::from_utf8_lossy(&buf[..n])),
                    Err(_) => break,
                }
            }
        });

        let mut sessions = self.sessions.lock().unwrap();
        sessions.insert(session_id, Session { writer, master: pair.master, child });
        Ok(())
    }

    /// Spawns a session at `project`'s path, then feeds its configured setup
    /// commands into it (FR-03 + FR-04).
    pub fn spawn_for_project(
        &self,
        session_id: Uuid,
        project: &Project,
        on_output: impl FnMut(&str) + Send + 'static,
    ) -> Result<(), PtyError> {
        self.spawn(session_id, &project.path, on_output)?;
        command_runner::run_setup_commands(project, |s| {
            self.write(session_id, s).map_err(|_| CommandRunnerError::WriteFailed)
        })?;
        Ok(())
    }

    pub fn write(&self, session_id: Uuid, data: &str) -> Result<(), PtyError> {
        let mut sessions = self.sessions.lock().unwrap();
        let session = sessions.get_mut(&session_id).ok_or(PtyError::SessionNotFound)?;
        session.writer.write_all(data.as_bytes()).map_err(|_| PtyError::WriteFailed)?;
        session.writer.flush().map_err(|_| PtyError::WriteFailed)
    }

    pub fn resize(&self, session_id: Uuid, rows: u16, cols: u16) -> Result<(), PtyError> {
        let sessions = self.sessions.lock().unwrap();
        let session = sessions.get(&session_id).ok_or(PtyError::SessionNotFound)?;
        session
            .master
            .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
            .map_err(|_| PtyError::ResizeFailed)
    }

    /// Tears down exactly this session — never affects any other pane's session.
    pub fn close(&self, session_id: Uuid) -> Result<(), PtyError> {
        let mut sessions = self.sessions.lock().unwrap();
        let mut session = sessions.remove(&session_id).ok_or(PtyError::SessionNotFound)?;
        let _ = session.child.kill();
        Ok(())
    }
}

fn default_shell() -> String {
    std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::time::Duration;
    use tempfile::tempdir;

    /// Reads accumulated PTY output off `rx` until `needle` appears or the
    /// timeout elapses — PTY output arrives in arbitrary-sized chunks on a
    /// background thread, so tests must accumulate rather than expect one shot.
    fn wait_for_output(rx: &mpsc::Receiver<String>, needle: &str, timeout: Duration) -> bool {
        let deadline = std::time::Instant::now() + timeout;
        let mut acc = String::new();
        while std::time::Instant::now() < deadline {
            if let Ok(chunk) = rx.recv_timeout(Duration::from_millis(200)) {
                acc.push_str(&chunk);
                if acc.contains(needle) {
                    return true;
                }
            }
        }
        false
    }

    #[test]
    fn spawned_shell_always_sees_term_xterm_256color_regardless_of_this_processs_own_env() {
        // Regression test: this app is not always launched from a terminal
        // (e.g. a desktop launcher's .desktop file has no parent terminal at
        // all, so nothing has ever set TERM) — the spawned shell must not
        // silently inherit whatever (possibly absent/wrong) TERM this
        // process happens to have, or its line editor falls back to a
        // wrong/limited terminfo capability profile and misrenders cursor
        // movement (the "garbled input after Backspace" report's real
        // cause). Deliberately set this test process's own TERM to
        // something else first, proving the child gets an explicit
        // override rather than an inherited value that happens to match.
        // SAFETY: this test binary doesn't run other tests that read TERM
        // concurrently, so this process-wide mutation doesn't race. If a
        // future test also needs to read/assert on $TERM, serialize it
        // against this one (e.g. the `serial_test` crate's #[serial]) —
        // cargo test runs this file's tests in parallel by default, and
        // this mutation is process-wide, not thread-local.
        unsafe {
            std::env::set_var("TERM", "not-the-right-value");
        }

        let manager = PtyManager::new();
        let dir = tempdir().unwrap();
        let session_id = Uuid::new_v4();
        let (tx, rx) = mpsc::channel::<String>();

        manager
            .spawn(session_id, dir.path(), move |chunk| {
                let _ = tx.send(chunk.to_string());
            })
            .unwrap();

        manager.write(session_id, "echo TERM-IS-[$TERM]\n").unwrap();

        assert!(
            wait_for_output(&rx, "TERM-IS-[xterm-256color]", Duration::from_secs(5)),
            "expected the spawned shell to see TERM=xterm-256color regardless of this process's own TERM"
        );

        manager.close(session_id).unwrap();
    }

    #[test]
    fn spawned_shell_echoes_a_written_command() {
        let manager = PtyManager::new();
        let dir = tempdir().unwrap();
        let session_id = Uuid::new_v4();
        let (tx, rx) = mpsc::channel::<String>();

        manager
            .spawn(session_id, dir.path(), move |chunk| {
                let _ = tx.send(chunk.to_string());
            })
            .unwrap();

        manager.write(session_id, "echo pty-manager-test-marker\n").unwrap();

        assert!(
            wait_for_output(&rx, "pty-manager-test-marker", Duration::from_secs(5)),
            "expected the echoed marker to appear in PTY output"
        );

        manager.close(session_id).unwrap();
    }

    #[test]
    fn spawn_for_project_runs_setup_commands_automatically() {
        let manager = PtyManager::new();
        let dir = tempdir().unwrap();
        let session_id = Uuid::new_v4();
        let (tx, rx) = mpsc::channel::<String>();

        let now = chrono::Utc::now();
        let project = Project {
            id: Uuid::new_v4(),
            name: "test".into(),
            path: dir.path().to_path_buf(),
            setup_commands: vec!["echo auto-run-marker".into()],
            notes: String::new(),
            created_at: now,
            updated_at: now,
        };

        manager
            .spawn_for_project(session_id, &project, move |chunk| {
                let _ = tx.send(chunk.to_string());
            })
            .unwrap();

        assert!(
            wait_for_output(&rx, "auto-run-marker", Duration::from_secs(5)),
            "expected the setup command's output to appear without the user typing anything"
        );

        manager.close(session_id).unwrap();
    }

    #[test]
    fn write_to_unknown_session_fails() {
        let manager = PtyManager::new();
        let result = manager.write(Uuid::new_v4(), "echo hi\n");
        assert!(matches!(result, Err(PtyError::SessionNotFound)));
    }

    #[test]
    fn close_unknown_session_fails() {
        let manager = PtyManager::new();
        let result = manager.close(Uuid::new_v4());
        assert!(matches!(result, Err(PtyError::SessionNotFound)));
    }

    #[test]
    fn closing_a_session_removes_it() {
        let manager = PtyManager::new();
        let dir = tempdir().unwrap();
        let session_id = Uuid::new_v4();
        manager.spawn(session_id, dir.path(), |_| {}).unwrap();

        manager.close(session_id).unwrap();

        let result = manager.write(session_id, "echo hi\n");
        assert!(matches!(result, Err(PtyError::SessionNotFound)));
    }

    #[test]
    fn two_sessions_are_independent() {
        let manager = PtyManager::new();
        let dir = tempdir().unwrap();
        let session_a = Uuid::new_v4();
        let session_b = Uuid::new_v4();
        manager.spawn(session_a, dir.path(), |_| {}).unwrap();
        manager.spawn(session_b, dir.path(), |_| {}).unwrap();

        manager.close(session_a).unwrap();

        // Closing session_a must not affect session_b.
        assert!(manager.write(session_b, "echo still-alive\n").is_ok());
        manager.close(session_b).unwrap();
    }
}
