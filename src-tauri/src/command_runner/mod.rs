//! Feeds a project's configured setup command(s) into a freshly spawned PTY
//! session before handing control to the user (FR-04).
//!
//! Takes a `write` callback rather than importing `pty_manager` directly, so
//! the dependency arrow stays one-way (architecture.md §5: pty_manager depends
//! on command_runner, command_runner depends on project_store — never the
//! reverse). `pty_manager` calls this, passing a closure over its own writer.

use crate::project_store::Project;

#[derive(Debug, thiserror::Error)]
pub enum CommandRunnerError {
    #[error("failed to write a setup command to the terminal")]
    WriteFailed,
}

/// Writes each of `project`'s setup commands to the terminal, one per line,
/// via the supplied `write` callback. No-op if the project has none — FR-04
/// acceptance criteria: with no configured command, the terminal opens
/// directly to an idle shell prompt.
pub fn run_setup_commands(
    project: &Project,
    mut write: impl FnMut(&str) -> Result<(), CommandRunnerError>,
) -> Result<(), CommandRunnerError> {
    for command in &project.setup_commands {
        if command.trim().is_empty() {
            continue;
        }
        write(command)?;
        write("\n")?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use uuid::Uuid;

    fn project_with_commands(commands: Vec<&str>) -> Project {
        let now = chrono::Utc::now();
        Project {
            id: Uuid::new_v4(),
            name: "test".into(),
            path: PathBuf::from("."),
            setup_commands: commands.into_iter().map(String::from).collect(),
            notes: String::new(),
            created_at: now,
            updated_at: now,
        }
    }

    #[test]
    fn writes_each_command_followed_by_a_newline() {
        let project = project_with_commands(vec!["nvm use", "docker-compose up"]);
        let mut written = Vec::new();
        run_setup_commands(&project, |s| {
            written.push(s.to_string());
            Ok(())
        })
        .unwrap();
        assert_eq!(written, vec!["nvm use", "\n", "docker-compose up", "\n"]);
    }

    #[test]
    fn no_commands_writes_nothing() {
        let project = project_with_commands(vec![]);
        let mut written = Vec::new();
        run_setup_commands(&project, |s| {
            written.push(s.to_string());
            Ok(())
        })
        .unwrap();
        assert!(written.is_empty());
    }

    #[test]
    fn blank_commands_are_skipped() {
        let project = project_with_commands(vec!["", "  ", "echo real"]);
        let mut written = Vec::new();
        run_setup_commands(&project, |s| {
            written.push(s.to_string());
            Ok(())
        })
        .unwrap();
        assert_eq!(written, vec!["echo real", "\n"]);
    }

    #[test]
    fn propagates_write_failure() {
        let project = project_with_commands(vec!["echo hi"]);
        let result = run_setup_commands(&project, |_| Err(CommandRunnerError::WriteFailed));
        assert!(result.is_err());
    }
}
