//! Detects a directory's current git branch for display in a terminal pane's
//! title (FR-17). Deliberately reads `.git/HEAD` directly instead of
//! shelling out to `git` or linking `libgit2` — the same pure-Rust,
//! no-C-library preference ADR-0004/0005 already made for storage/crypto,
//! and cheaper than spawning a process per pane.

use std::fs::{self, File};
use std::io::Read;
use std::path::{Path, PathBuf};

/// Upper bound on how much of `.git` (the worktree pointer file) or `HEAD` is
/// ever read. Both hold one short line in a real repo; 4096 is git's own
/// `PATH_MAX`-scale ceiling for a ref path, so a legitimate value always fits
/// while a crafted endless/huge file can't exhaust memory (security audit
/// 2026-09-24, L8).
const MAX_GIT_FILE_BYTES: u64 = 4096;

/// Reads `path` as text only if it is a *regular file* (following symlinks,
/// so a link to a FIFO or `/dev/zero` is rejected too) and no larger than
/// `MAX_GIT_FILE_BYTES`. `None` for anything else — the caller treats that
/// as "no branch to show", never an error. Opening a FIFO for reading blocks
/// until a writer appears, which is exactly what the type check prevents.
fn read_small_regular_file(path: &Path) -> Option<String> {
    if !fs::metadata(path).ok()?.is_file() {
        return None;
    }
    let mut bytes = Vec::new();
    File::open(path).ok()?.take(MAX_GIT_FILE_BYTES + 1).read_to_end(&mut bytes).ok()?;
    if bytes.len() as u64 > MAX_GIT_FILE_BYTES {
        return None;
    }
    String::from_utf8(bytes).ok()
}

/// Terminal-escape/control characters, zero-width characters and bidi controls
/// (RTL override etc.) have no business in a branch name shown in a pane title, and the name
/// comes from untrusted file content — drop them.
fn is_unsafe_display_char(c: char) -> bool {
    c.is_control()
        || matches!(
            c,
            '\u{200B}'..='\u{200F}' // zero-width space/joiners, LRM/RLM
                | '\u{2028}'..='\u{202E}' // line/paragraph separators, bidi embeddings/overrides
                | '\u{2060}'..='\u{2069}' // word joiner, invisible operators, bidi isolates
                | '\u{FEFF}' // zero-width no-break space / BOM
        )
}

fn sanitize_branch(name: &str) -> Option<String> {
    let cleaned: String = name.chars().filter(|c| !is_unsafe_display_char(*c)).collect();
    if cleaned.is_empty() { None } else { Some(cleaned) }
}

/// Walks `start` and its ancestors looking for a `.git` entry. A worktree
/// checkout or submodule has a `.git` *file* (`gitdir: <path>`) instead of a
/// directory, pointing at the real git dir elsewhere — both forms resolve to
/// the directory that actually contains `HEAD`.
fn find_git_dir(start: &Path) -> Option<PathBuf> {
    let mut dir = start;
    loop {
        let candidate = dir.join(".git");
        if candidate.is_dir() {
            return Some(candidate);
        }
        if candidate.is_file() {
            let contents = read_small_regular_file(&candidate)?;
            let gitdir = contents.trim().strip_prefix("gitdir:")?.trim();
            let resolved = PathBuf::from(gitdir);
            return Some(if resolved.is_absolute() { resolved } else { dir.join(resolved) });
        }
        dir = dir.parent()?;
    }
}

/// `path`'s current branch name, or a short commit hash when `HEAD` is
/// detached. `None` if `path` isn't inside a git repository, or `HEAD`
/// can't be read/parsed — never an error, since "no branch to show" is a
/// normal outcome for a plain (non-git) project.
pub fn current_branch(path: &Path) -> Option<String> {
    let git_dir = find_git_dir(path)?;
    let head = read_small_regular_file(&git_dir.join("HEAD"))?;
    let head = head.trim();

    if let Some(branch) = head.strip_prefix("ref: refs/heads/") {
        // A `ref:` line with nothing after it isn't a state real git ever
        // produces, but treat it as "no branch to show" rather than
        // rendering a dangling separator with an empty name after it.
        return sanitize_branch(branch);
    }
    // Detached HEAD: HEAD holds a raw commit hash directly. Anything else is
    // a HEAD format this parser doesn't recognize.
    if head.len() >= 7 && head.chars().all(|c| c.is_ascii_hexdigit()) {
        return Some(head[..7].to_string());
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn init_repo(dir: &Path) {
        fs::create_dir_all(dir.join(".git")).unwrap();
    }

    #[test]
    fn returns_none_outside_a_git_repo() {
        let tmp = tempdir().unwrap();
        assert_eq!(current_branch(tmp.path()), None);
    }

    #[test]
    fn reads_the_branch_name_from_head() {
        let tmp = tempdir().unwrap();
        init_repo(tmp.path());
        fs::write(tmp.path().join(".git/HEAD"), "ref: refs/heads/main\n").unwrap();
        assert_eq!(current_branch(tmp.path()), Some("main".to_string()));
    }

    #[test]
    fn returns_none_for_a_ref_line_with_an_empty_branch_name() {
        let tmp = tempdir().unwrap();
        init_repo(tmp.path());
        fs::write(tmp.path().join(".git/HEAD"), "ref: refs/heads/\n").unwrap();
        assert_eq!(current_branch(tmp.path()), None);
    }

    #[test]
    fn reads_a_branch_name_containing_slashes() {
        let tmp = tempdir().unwrap();
        init_repo(tmp.path());
        fs::write(tmp.path().join(".git/HEAD"), "ref: refs/heads/feature/foo\n").unwrap();
        assert_eq!(current_branch(tmp.path()), Some("feature/foo".to_string()));
    }

    #[test]
    fn falls_back_to_a_short_hash_on_detached_head() {
        let tmp = tempdir().unwrap();
        init_repo(tmp.path());
        fs::write(tmp.path().join(".git/HEAD"), "3f786850e387550fdab836ed7e6dc881de23001b\n").unwrap();
        assert_eq!(current_branch(tmp.path()), Some("3f78685".to_string()));
    }

    #[test]
    fn finds_the_repo_root_from_a_nested_subdirectory() {
        let tmp = tempdir().unwrap();
        init_repo(tmp.path());
        fs::write(tmp.path().join(".git/HEAD"), "ref: refs/heads/main\n").unwrap();
        let nested = tmp.path().join("src/lib");
        fs::create_dir_all(&nested).unwrap();
        assert_eq!(current_branch(&nested), Some("main".to_string()));
    }

    #[test]
    fn follows_a_worktree_style_dotgit_file() {
        let tmp = tempdir().unwrap();
        let real_git_dir = tmp.path().join("actual-gitdir");
        fs::create_dir_all(&real_git_dir).unwrap();
        fs::write(real_git_dir.join("HEAD"), "ref: refs/heads/wt-branch\n").unwrap();
        let worktree = tmp.path().join("worktree");
        fs::create_dir_all(&worktree).unwrap();
        fs::write(worktree.join(".git"), format!("gitdir: {}\n", real_git_dir.display())).unwrap();
        assert_eq!(current_branch(&worktree), Some("wt-branch".to_string()));
    }

    #[cfg(unix)]
    /// Runs `current_branch(path)` on a worker thread and fails (rather than
    /// hangs the whole test run) if it doesn't finish promptly — the exact
    /// failure mode these tests guard against is a call that blocks forever.
    fn current_branch_within_timeout(path: &Path) -> Option<String> {
        let (tx, rx) = std::sync::mpsc::channel();
        let path = path.to_path_buf();
        std::thread::spawn(move || {
            let _ = tx.send(current_branch(&path));
        });
        rx.recv_timeout(std::time::Duration::from_secs(3))
            .expect("current_branch blocked on a special file instead of rejecting it")
    }

    #[cfg(unix)]
    fn mkfifo(path: &Path) {
        let status = std::process::Command::new("mkfifo").arg(path).status().unwrap();
        assert!(status.success(), "mkfifo failed");
    }

    // Security audit 2026-09-24, L8: `get_git_branch` used to
    // `read_to_string` whatever `.git/HEAD` was — a FIFO (or a symlink to
    // an endless device) in a directory that didn't come from `git clone`
    // would block or exhaust memory in a command that ran on the UI thread.

    #[cfg(unix)]
    #[test]
    fn does_not_block_when_head_is_a_fifo() {
        let tmp = tempdir().unwrap();
        init_repo(tmp.path());
        mkfifo(&tmp.path().join(".git/HEAD"));
        assert_eq!(current_branch_within_timeout(tmp.path()), None);
    }

    #[cfg(unix)]
    #[test]
    fn does_not_read_through_a_head_symlink_to_a_fifo() {
        // A symlink must be judged by what it points at (`fs::metadata`, not
        // `symlink_metadata`). A FIFO target proves that without the memory
        // hazard a link to `/dev/zero` would have if this ever regressed.
        let tmp = tempdir().unwrap();
        init_repo(tmp.path());
        let fifo = tmp.path().join("real-fifo");
        mkfifo(&fifo);
        std::os::unix::fs::symlink(&fifo, tmp.path().join(".git/HEAD")).unwrap();
        assert_eq!(current_branch_within_timeout(tmp.path()), None);
    }

    #[cfg(unix)]
    #[test]
    fn does_not_block_when_the_dotgit_file_is_a_fifo() {
        // `.git` as a FIFO is neither a directory nor a regular file, so the
        // walk must skip it and carry on to the parent (which has no repo).
        let tmp = tempdir().unwrap();
        mkfifo(&tmp.path().join(".git"));
        assert_eq!(current_branch_within_timeout(tmp.path()), None);
    }

    #[cfg(unix)]
    #[test]
    fn does_not_block_when_a_gitdir_redirect_points_at_a_fifo_head() {
        let tmp = tempdir().unwrap();
        let real_git_dir = tmp.path().join("actual-gitdir");
        fs::create_dir_all(&real_git_dir).unwrap();
        mkfifo(&real_git_dir.join("HEAD"));
        let worktree = tmp.path().join("worktree");
        fs::create_dir_all(&worktree).unwrap();
        fs::write(worktree.join(".git"), format!("gitdir: {}\n", real_git_dir.display())).unwrap();
        assert_eq!(current_branch_within_timeout(&worktree), None);
    }

    #[test]
    fn rejects_an_oversized_head_instead_of_reading_it_all() {
        let tmp = tempdir().unwrap();
        init_repo(tmp.path());
        let huge = format!("ref: refs/heads/{}\n", "a".repeat(1_000_000));
        fs::write(tmp.path().join(".git/HEAD"), huge).unwrap();
        assert_eq!(current_branch(tmp.path()), None);
    }

    #[test]
    fn rejects_an_oversized_dotgit_file() {
        let tmp = tempdir().unwrap();
        fs::write(tmp.path().join(".git"), format!("gitdir: {}", "a".repeat(1_000_000))).unwrap();
        assert_eq!(current_branch(tmp.path()), None);
    }

    #[test]
    fn still_reads_a_long_but_legitimate_branch_name() {
        let tmp = tempdir().unwrap();
        init_repo(tmp.path());
        let long = "x".repeat(300);
        fs::write(tmp.path().join(".git/HEAD"), format!("ref: refs/heads/{long}\n")).unwrap();
        assert_eq!(current_branch(tmp.path()), Some(long));
    }

    #[test]
    fn strips_control_and_bidi_characters_from_the_branch_name() {
        // The name comes from untrusted file content and is shown in a pane
        // title — an RTL override or terminal escape must not survive.
        let tmp = tempdir().unwrap();
        init_repo(tmp.path());
        fs::write(tmp.path().join(".git/HEAD"), "ref: refs/heads/ma\u{202E}in\x1b[31m\u{200B}\u{FEFF}\u{2028}\n").unwrap();
        assert_eq!(current_branch(tmp.path()), Some("main[31m".to_string()));
    }

    #[test]
    fn returns_none_when_nothing_printable_is_left_of_the_branch_name() {
        let tmp = tempdir().unwrap();
        init_repo(tmp.path());
        fs::write(tmp.path().join(".git/HEAD"), "ref: refs/heads/\u{202E}\u{200F}\n").unwrap();
        assert_eq!(current_branch(tmp.path()), None);
    }

    #[test]
    fn returns_none_for_a_nonexistent_path() {
        assert_eq!(current_branch(Path::new("/nonexistent/path/for/sure")), None);
    }
}
