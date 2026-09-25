//! Spawns and tracks one PTY session per pane (FR-08, ADR-0003, ADR-0007).
//! Sole owner of `PtySession` (architecture.md §5.3) — runtime-only, never
//! persisted. Closing a pane tears down exactly its own session; sessions
//! are fully independent of one another.
//!
//! The output callback (`on_output`) is a plain closure rather than a Tauri
//! `AppHandle` directly — that keeps this module testable without a running
//! Tauri app, and matches the pattern used in `command_runner`.

use std::collections::{HashMap, HashSet, VecDeque};
use std::io::{Read, Write};
use std::path::Path;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::thread;
use std::time::{Duration, Instant};

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

/// How much output a session may hold back while it waits for the frontend to
/// attach. Real early output is a prompt or a few lines; 1 MiB is far beyond
/// that and still cheap. Past the cap the *oldest* whole chunks are dropped,
/// so the screen the user ends up with is the most recent one. Dropping whole
/// chunks can cut an escape sequence in half, and a single chunk larger than
/// the cap is dropped too — neither can happen in practice (a chunk is at most
/// ~12 KB, one pty read) and both only matter once someone floods 1 MiB
/// before the pane has even mounted.
const MAX_HELD_OUTPUT_BYTES: usize = 1024 * 1024;

/// If the frontend never attaches (its listener registration failed, or the
/// pane was torn down mid-mount), the gate opens by itself once this much time
/// has passed since the session was created — the next chunk of output or the
/// exit notification releases it. A session can therefore never stay muted.
const ATTACH_TIMEOUT: Duration = Duration::from_secs(10);

/// Attach requests that arrive before their session exists are remembered so
/// `spawn` can honour them; bounded so a misbehaving caller can't grow it.
const MAX_PENDING_ATTACHES: usize = 256;

/// Holds a session's output — and its exit notification — until the frontend
/// has registered its listeners, then passes everything through in order.
///
/// Why: Tauri events emitted before a listener exists are not queued, and the
/// frontend registers its `listen()` calls asynchronously after the pane
/// mounts, so anything a program printed in its first moments was lost
/// (reproduced 3/3, docs/qa/test-plan.md).
///
/// One mutex guards the sink, the `attached` flag and the buffer together and
/// is held while flushing. That is the whole ordering argument: a chunk
/// arriving while `attach` flushes waits for the lock and is emitted *after*
/// the held chunks, and a chunk can be either held or emitted, never both.
/// The sink (a Tauri `emit`) is quick and non-blocking, so holding the lock
/// across it is fine.
///
/// **Constraints on the callbacks** (`on_output`/`on_exit`), because they run
/// under the gate lock: they must be quick, must never call back into
/// `PtyManager` (a `close` would take `sessions` while `attach` holds it and
/// wait on this lock), and must not wait on the main thread. Today they only
/// `emit` a Tauri event, which does not wait — but only while Tauri's
/// `tracing` feature stays off (with it, an off-main-thread `emit` waits for
/// a reply from the main thread). That is why the `attach_terminal` command
/// is `async`: it never runs on the main thread, so it can never be the
/// thing an emitting reader thread is waiting for.
struct OutputGate {
    inner: Mutex<GateInner>,
}

struct GateInner {
    sink: Box<dyn FnMut(&str) + Send>,
    on_exit: Option<Box<dyn FnOnce() + Send>>,
    /// The shell's end of the pty closed before the gate opened; `on_exit`
    /// runs when it opens, after the held output.
    exited: bool,
    attached: bool,
    held: VecDeque<String>,
    held_bytes: usize,
    created: Instant,
    max_held_bytes: usize,
    attach_timeout: Duration,
}

impl OutputGate {
    /// The gate's lock, tolerant of poisoning: if a sink ever panicked, the
    /// state it guards (a flag and a queue of strings) is still consistent,
    /// and taking the lock must not turn one panic into a chain of them on
    /// the reader thread and in the `attach_terminal` command.
    fn lock(&self) -> MutexGuard<'_, GateInner> {
        self.inner.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn new(
        sink: Box<dyn FnMut(&str) + Send>,
        on_exit: Box<dyn FnOnce() + Send>,
        max_held_bytes: usize,
        attach_timeout: Duration,
    ) -> Self {
        Self {
            inner: Mutex::new(GateInner {
                sink,
                on_exit: Some(on_exit),
                exited: false,
                attached: false,
                held: VecDeque::new(),
                held_bytes: 0,
                created: Instant::now(),
                max_held_bytes,
                attach_timeout,
            }),
        }
    }

    /// Called from the reader thread for each chunk the program writes.
    fn push(&self, chunk: &str) {
        let mut g = self.lock();
        g.release_if_timed_out();
        if g.attached {
            (g.sink)(chunk);
            return;
        }
        g.held_bytes += chunk.len();
        g.held.push_back(chunk.to_string());
        while g.held_bytes > g.max_held_bytes {
            match g.held.pop_front() {
                Some(dropped) => g.held_bytes -= dropped.len(),
                None => break,
            }
        }
    }

    /// Called from the reader thread once, when the pty's shell end closes.
    fn finish(&self) {
        let mut g = self.lock();
        g.release_if_timed_out();
        g.exited = true;
        if g.attached {
            g.run_exit();
        }
    }

    /// The frontend's listeners are registered: flush what was held, in order,
    /// then any pending exit, then stream live. Idempotent.
    fn attach(&self) {
        self.lock().open();
    }
}

impl GateInner {
    fn open(&mut self) {
        if self.attached {
            return;
        }
        while let Some(chunk) = self.held.pop_front() {
            (self.sink)(&chunk);
        }
        self.held_bytes = 0;
        self.attached = true;
        if self.exited {
            self.run_exit();
        }
    }

    fn release_if_timed_out(&mut self) {
        if !self.attached && self.created.elapsed() >= self.attach_timeout {
            self.open();
        }
    }

    fn run_exit(&mut self) {
        if let Some(on_exit) = self.on_exit.take() {
            on_exit();
        }
    }
}

struct Session {
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    child: Box<dyn Child + Send + Sync>,
    gate: Arc<OutputGate>,
}

#[derive(Default)]
pub struct PtyManager {
    sessions: Mutex<HashMap<Uuid, Session>>,
    /// `attach` calls that beat their `spawn`. Lock order everywhere:
    /// `sessions` first, then this — so `spawn`'s insert and `attach`'s
    /// lookup are atomic with respect to each other and no request is lost.
    pending_attaches: Mutex<HashSet<Uuid>>,
}

impl PtyManager {
    pub fn new() -> Self {
        Self { sessions: Mutex::new(HashMap::new()), pending_attaches: Mutex::new(HashSet::new()) }
    }

    /// Spawns a plain shell at `cwd` under `session_id`. `on_output` is called
    /// from a background thread every time the shell produces output — it
    /// must be cheap and non-blocking (e.g. forward to a channel or emit a
    /// Tauri event), never block waiting on the caller. `on_exit` is called
    /// exactly once, from that same background thread, when the shell's end
    /// of the pty closes (the user typed `exit`, the shell crashed, etc.) —
    /// this manager does not remove the session from `sessions` or kill the
    /// (already-dead) child itself; the caller is expected to react by
    /// calling `close` (mirroring a user-initiated close), same as it would
    /// for a manual "Close pane" — see architecture.md's PTY exit note.
    ///
    /// Both callbacks run under the session's output-gate lock, so they must
    /// stay quick and must not call back into this manager (see
    /// `OutputGate`).
    ///
    /// **Neither callback runs until `attach(session_id)`** (ADR-0007
    /// addendum): output produced in the meantime is held, in order, and
    /// delivered at that point, followed by `on_exit` if the shell already
    /// ended. See `OutputGate`.
    pub fn spawn(
        &self,
        session_id: Uuid,
        cwd: &Path,
        on_output: impl FnMut(&str) + Send + 'static,
        on_exit: impl FnOnce() + Send + 'static,
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

        let gate = Arc::new(OutputGate::new(
            Box::new(on_output),
            Box::new(on_exit),
            MAX_HELD_OUTPUT_BYTES,
            ATTACH_TIMEOUT,
        ));

        let reader_gate = Arc::clone(&gate);
        thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => reader_gate.push(&String::from_utf8_lossy(&buf[..n])),
                    Err(_) => break,
                }
            }
            reader_gate.finish();
        });

        let mut sessions = self.sessions.lock().unwrap();
        // An attach that arrived before this spawn finished is honoured now,
        // under the same `sessions` lock `attach` takes to look us up.
        if self.pending_attaches.lock().unwrap().remove(&session_id) {
            gate.attach();
        }
        sessions.insert(session_id, Session { writer, master: pair.master, child, gate });
        Ok(())
    }

    /// Spawns a session at `project`'s path, then feeds its configured setup
    /// commands into it (FR-03 + FR-04).
    pub fn spawn_for_project(
        &self,
        session_id: Uuid,
        project: &Project,
        on_output: impl FnMut(&str) + Send + 'static,
        on_exit: impl FnOnce() + Send + 'static,
    ) -> Result<(), PtyError> {
        self.spawn(session_id, &project.path, on_output, on_exit)?;
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

    /// The frontend has registered its output and exit listeners for
    /// `session_id`: release whatever was held, then stream live. Idempotent.
    ///
    /// Infallible on purpose. The frontend fires `open_terminal` and, from
    /// the mounted pane, `attach_terminal` concurrently, so this can arrive
    /// before the session exists; rejecting it would leave the pane muted
    /// forever. It is remembered instead (bounded) and `spawn` applies it.
    pub fn attach(&self, session_id: Uuid) {
        let sessions = self.sessions.lock().unwrap();
        match sessions.get(&session_id) {
            Some(session) => session.gate.attach(),
            None => {
                let mut pending = self.pending_attaches.lock().unwrap();
                if pending.len() >= MAX_PENDING_ATTACHES {
                    pending.clear();
                }
                pending.insert(session_id);
            }
        }
    }

    /// Tears down exactly this session — never affects any other pane's session.
    pub fn close(&self, session_id: Uuid) -> Result<(), PtyError> {
        let mut sessions = self.sessions.lock().unwrap();
        self.pending_attaches.lock().unwrap().remove(&session_id);
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
            .spawn(
                session_id,
                dir.path(),
                move |chunk| {
                    let _ = tx.send(chunk.to_string());
                },
                || {},
            )
            .unwrap();

        manager.attach(session_id);
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
            .spawn(
                session_id,
                dir.path(),
                move |chunk| {
                    let _ = tx.send(chunk.to_string());
                },
                || {},
            )
            .unwrap();

        manager.attach(session_id); // output only flows once the frontend has attached
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
            .spawn_for_project(
                session_id,
                &project,
                move |chunk| {
                    let _ = tx.send(chunk.to_string());
                },
                || {},
            )
            .unwrap();

        manager.attach(session_id);
        assert!(
            wait_for_output(&rx, "auto-run-marker", Duration::from_secs(5)),
            "expected the setup command's output to appear without the user typing anything"
        );

        manager.close(session_id).unwrap();
    }


    /// Everything `rx` has received so far, without waiting.
    fn drain(rx: &mpsc::Receiver<String>) -> String {
        let mut out = String::new();
        while let Ok(chunk) = rx.try_recv() {
            out.push_str(&chunk);
        }
        out
    }

    // Debugger session 2026-09-25 (docs/qa/test-plan.md §6): output a program
    // printed right after its PTY was spawned was dropped, because the
    // frontend registers its Tauri event listener asynchronously after the
    // pane mounts and events emitted earlier are not queued. Output is now
    // held per session until the frontend calls `attach`.

    #[test]
    fn output_produced_before_attach_is_held_then_delivered_in_order_exactly_once() {
        let manager = PtyManager::new();
        let dir = tempdir().unwrap();
        let session_id = Uuid::new_v4();
        let (tx, rx) = mpsc::channel::<String>();
        manager
            .spawn(session_id, dir.path(), move |chunk| { let _ = tx.send(chunk.to_string()); }, || {})
            .unwrap();

        // `printf` so the marker text appears only in the program's output,
        // not also in the shell's echo of the command line.
        manager.write(session_id, "printf 'early-%s\\n' one two three\n").unwrap();
        std::thread::sleep(Duration::from_millis(800));
        assert_eq!(drain(&rx), "", "nothing may reach the sink before the frontend attaches");

        manager.attach(session_id);

        assert!(wait_for_output(&rx, "early-three", Duration::from_secs(5)), "held output must arrive once attached");
        // wait_for_output consumed what it read; the whole stream is checked below.
        manager.close(session_id).unwrap();
    }

    #[test]
    fn held_output_keeps_its_order_and_is_not_duplicated() {
        let manager = PtyManager::new();
        let dir = tempdir().unwrap();
        let session_id = Uuid::new_v4();
        let (tx, rx) = mpsc::channel::<String>();
        manager
            .spawn(session_id, dir.path(), move |chunk| { let _ = tx.send(chunk.to_string()); }, || {})
            .unwrap();
        manager.write(session_id, "printf 'seq-%s\\n' one two three\n").unwrap();
        std::thread::sleep(Duration::from_millis(800));
        manager.attach(session_id);
        std::thread::sleep(Duration::from_millis(800));

        let all = drain(&rx);
        let (one, two, three) = (all.find("seq-one"), all.find("seq-two"), all.find("seq-three"));
        assert!(one.is_some() && two.is_some() && three.is_some(), "all three lines delivered: {all:?}");
        assert!(one < two && two < three, "in order: {all:?}");
        for marker in ["seq-one", "seq-two", "seq-three"] {
            assert_eq!(all.matches(marker).count(), 1, "{marker} exactly once: {all:?}");
        }
        manager.close(session_id).unwrap();
    }

    #[test]
    fn output_after_attach_streams_live() {
        let manager = PtyManager::new();
        let dir = tempdir().unwrap();
        let session_id = Uuid::new_v4();
        let (tx, rx) = mpsc::channel::<String>();
        manager
            .spawn(session_id, dir.path(), move |chunk| { let _ = tx.send(chunk.to_string()); }, || {})
            .unwrap();
        manager.attach(session_id);

        manager.write(session_id, "printf 'live-%s\\n' now\n").unwrap();

        assert!(wait_for_output(&rx, "live-now", Duration::from_secs(5)));
        manager.close(session_id).unwrap();
    }

    #[test]
    fn exit_before_attach_is_held_until_attach() {
        // The same defect for the exit event: a shell that dies before the
        // frontend's listener exists would leave the pane open forever.
        let manager = PtyManager::new();
        let dir = tempdir().unwrap();
        let session_id = Uuid::new_v4();
        let (exit_tx, exit_rx) = mpsc::channel::<()>();
        manager
            .spawn(session_id, dir.path(), |_| {}, move || { let _ = exit_tx.send(()); })
            .unwrap();
        manager.write(session_id, "exit\n").unwrap();

        assert!(exit_rx.recv_timeout(Duration::from_millis(1500)).is_err(), "on_exit must wait for attach");
        manager.attach(session_id);
        exit_rx.recv_timeout(Duration::from_secs(5)).expect("on_exit fires once attached");
    }

    #[test]
    fn attach_that_arrives_before_the_session_exists_is_remembered() {
        // The frontend fires `open_terminal` and, from the mounted pane,
        // `attach_terminal` concurrently: attach can win the race. It must
        // not be rejected (the pane would stay muted forever).
        let manager = PtyManager::new();
        let dir = tempdir().unwrap();
        let session_id = Uuid::new_v4();
        manager.attach(session_id);
        let (tx, rx) = mpsc::channel::<String>();

        manager
            .spawn(session_id, dir.path(), move |chunk| { let _ = tx.send(chunk.to_string()); }, || {})
            .unwrap();
        manager.write(session_id, "printf 'pre-%s\\n' attached\n").unwrap();

        assert!(wait_for_output(&rx, "pre-attached", Duration::from_secs(5)), "already attached: output streams at once");
        manager.close(session_id).unwrap();
    }


    // ---- OutputGate in isolation (no PTY, no timing luck) -----------------

    /// What a test gate's sink and exit callback recorded.
    type Recorded<T> = Arc<Mutex<Vec<T>>>;

    fn collecting_gate(max_held: usize, timeout: Duration) -> (Arc<OutputGate>, Recorded<String>, Recorded<&'static str>) {
        let out = Arc::new(Mutex::new(Vec::<String>::new()));
        let events = Arc::new(Mutex::new(Vec::<&'static str>::new()));
        let (o, e1, e2) = (Arc::clone(&out), Arc::clone(&events), Arc::clone(&events));
        let gate = Arc::new(OutputGate::new(
            Box::new(move |c| {
                o.lock().unwrap().push(c.to_string());
                e1.lock().unwrap().push("out");
            }),
            Box::new(move || e2.lock().unwrap().push("exit")),
            max_held,
            timeout,
        ));
        (gate, out, events)
    }

    #[test]
    fn gate_holds_chunks_until_attach_then_flushes_them_in_order() {
        let (gate, out, _) = collecting_gate(1024, Duration::from_secs(60));
        gate.push("a");
        gate.push("b");
        assert!(out.lock().unwrap().is_empty());

        gate.attach();
        gate.push("c");

        assert_eq!(*out.lock().unwrap(), vec!["a", "b", "c"]);
    }

    #[test]
    fn gate_attach_is_idempotent_and_never_replays() {
        let (gate, out, _) = collecting_gate(1024, Duration::from_secs(60));
        gate.push("a");
        gate.attach();
        gate.attach();
        gate.push("b");
        gate.attach();
        assert_eq!(*out.lock().unwrap(), vec!["a", "b"]);
    }

    #[test]
    fn gate_delivers_a_held_exit_after_the_held_output() {
        let (gate, _, events) = collecting_gate(1024, Duration::from_secs(60));
        gate.push("last words");
        gate.finish();
        assert!(events.lock().unwrap().is_empty(), "nothing before attach");

        gate.attach();

        assert_eq!(*events.lock().unwrap(), vec!["out", "exit"]);
    }

    #[test]
    fn gate_runs_exit_at_once_when_already_attached_and_only_once() {
        let (gate, _, events) = collecting_gate(1024, Duration::from_secs(60));
        gate.attach();
        gate.finish();
        gate.finish();
        gate.attach();
        assert_eq!(*events.lock().unwrap(), vec!["exit"]);
    }

    #[test]
    fn gate_drops_the_oldest_chunks_beyond_the_cap_and_keeps_the_newest() {
        let (gate, out, _) = collecting_gate(10, Duration::from_secs(60));
        for chunk in ["aaaa", "bbbb", "cccc", "dddd"] {
            gate.push(chunk); // 16 bytes offered, cap 10
        }
        gate.attach();
        assert_eq!(*out.lock().unwrap(), vec!["cccc", "dddd"]);
    }

    #[test]
    fn gate_opens_itself_when_nobody_attaches_within_the_timeout() {
        // A pane whose listener registration failed must not stay muted.
        // Generous margins: the first assertion must hold even if this thread
        // is descheduled for a while between creating the gate and pushing.
        let (gate, out, _) = collecting_gate(1024, Duration::from_millis(1500));
        gate.push("early");
        assert!(out.lock().unwrap().is_empty());

        std::thread::sleep(Duration::from_millis(1700));
        gate.push("late");

        assert_eq!(*out.lock().unwrap(), vec!["early", "late"]);
    }

    #[test]
    fn gate_releases_a_held_exit_on_timeout_too() {
        let (gate, _, events) = collecting_gate(1024, Duration::from_millis(300));
        std::thread::sleep(Duration::from_millis(500));
        gate.finish();
        assert_eq!(*events.lock().unwrap(), vec!["exit"]);
    }

    #[test]
    fn gate_never_loses_or_duplicates_or_reorders_a_chunk_that_races_attach() {
        // Many rounds: a producer thread pushes numbered chunks as fast as it
        // can while another thread calls attach at an arbitrary moment. The
        // sink must see 0..N exactly once each, in order, whichever side of
        // the flush each chunk landed on.
        for round in 0..200 {
            let (gate, out, _) = collecting_gate(usize::MAX, Duration::from_secs(60));
            const N: usize = 300;
            let producer = {
                let gate = Arc::clone(&gate);
                std::thread::spawn(move || {
                    for i in 0..N {
                        gate.push(&i.to_string());
                    }
                })
            };
            let attacher = {
                let gate = Arc::clone(&gate);
                std::thread::spawn(move || {
                    for _ in 0..(round % 50) {
                        std::thread::yield_now();
                    }
                    gate.attach();
                })
            };
            producer.join().unwrap();
            attacher.join().unwrap();

            let got = out.lock().unwrap().clone();
            let expected: Vec<String> = (0..N).map(|i| i.to_string()).collect();
            assert_eq!(got, expected, "round {round}");
        }
    }

    #[test]
    fn a_panicking_sink_does_not_turn_every_later_call_into_a_panic() {
        let out = Arc::new(Mutex::new(Vec::<String>::new()));
        let o = Arc::clone(&out);
        let gate = Arc::new(OutputGate::new(
            Box::new(move |c| {
                if c == "boom" {
                    panic!("sink failed");
                }
                o.lock().unwrap().push(c.to_string());
            }),
            Box::new(|| {}),
            1024,
            Duration::from_secs(60),
        ));
        gate.attach();
        let poisoner = {
            let gate = Arc::clone(&gate);
            std::thread::spawn(move || gate.push("boom"))
        };
        assert!(poisoner.join().is_err(), "the sink panic propagates to its own thread");

        // The gate is poisoned now; later calls must still work.
        gate.push("after");
        gate.attach();
        assert_eq!(*out.lock().unwrap(), vec!["after"]);
    }

    #[test]
    fn attach_requests_that_never_meet_a_session_stay_bounded() {
        let manager = PtyManager::new();
        for _ in 0..(MAX_PENDING_ATTACHES * 3) {
            manager.attach(Uuid::new_v4());
        }
        assert!(manager.pending_attaches.lock().unwrap().len() <= MAX_PENDING_ATTACHES);
    }

    #[test]
    fn closing_a_session_forgets_a_pending_attach_for_it() {
        let manager = PtyManager::new();
        let id = Uuid::new_v4();
        manager.attach(id);
        let _ = manager.close(id); // unknown session: error, but the entry must go
        assert!(!manager.pending_attaches.lock().unwrap().contains(&id));
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
        manager.spawn(session_id, dir.path(), |_| {}, || {}).unwrap();

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
        manager.spawn(session_a, dir.path(), |_| {}, || {}).unwrap();
        manager.spawn(session_b, dir.path(), |_| {}, || {}).unwrap();

        manager.close(session_a).unwrap();

        // Closing session_a must not affect session_b.
        assert!(manager.write(session_b, "echo still-alive\n").is_ok());
        manager.close(session_b).unwrap();
    }

    #[test]
    fn shell_exiting_on_its_own_calls_on_exit() {
        // Regression: the background reader thread used to just `break` and
        // silently vanish when the shell's end of the pty closed (user typed
        // `exit`, shell crashed, etc.) — nothing ever told the caller the
        // session had ended, so the frontend pane never closed even though
        // the shell process was long gone.
        let manager = PtyManager::new();
        let dir = tempdir().unwrap();
        let session_id = Uuid::new_v4();
        let (exit_tx, exit_rx) = mpsc::channel::<()>();

        manager
            .spawn(session_id, dir.path(), |_| {}, move || {
                let _ = exit_tx.send(());
            })
            .unwrap();

        manager.attach(session_id); // exit, like output, is delivered once attached
        manager.write(session_id, "exit\n").unwrap();

        exit_rx
            .recv_timeout(Duration::from_secs(5))
            .expect("on_exit should fire once the shell exits on its own");
    }
}
