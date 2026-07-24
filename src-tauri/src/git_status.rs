//! Detects a directory's current git branch for display in a terminal pane's
//! title (FR-17). Deliberately reads `.git/HEAD` directly instead of
//! shelling out to `git` or linking `libgit2` — the same pure-Rust,
//! no-C-library preference ADR-0004/0005 already made for storage/crypto,
//! and cheaper than spawning a process per pane.

use std::fs;
use std::path::{Path, PathBuf};

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
            let contents = fs::read_to_string(&candidate).ok()?;
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
    let head = fs::read_to_string(git_dir.join("HEAD")).ok()?;
    let head = head.trim();

    if let Some(branch) = head.strip_prefix("ref: refs/heads/") {
        // A `ref:` line with nothing after it isn't a state real git ever
        // produces, but treat it as "no branch to show" rather than
        // rendering a dangling separator with an empty name after it.
        return if branch.is_empty() { None } else { Some(branch.to_string()) };
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

    #[test]
    fn returns_none_for_a_nonexistent_path() {
        assert_eq!(current_branch(Path::new("/nonexistent/path/for/sure")), None);
    }
}
