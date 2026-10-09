//! Fetch, pull and push. The runner switches terminal credential prompts off
//! (`GIT_TERMINAL_PROMPT=0`), so a remote that wants a password fails with git's message instead
//! of waiting for input that can never come. A credential manager with its own window still works.

use std::time::Duration;

use super::error::VcsError;
use super::repo::Repo;

/// A first push of a big repository over a slow link is legitimately slow; the default of two
/// minutes is not enough.
pub const NETWORK_TIMEOUT: Duration = Duration::from_secs(600);
const PREFERRED_REMOTE: &str = "origin";

/// Updates the remote-tracking branches, dropping those deleted on the remote.
pub fn fetch(repo: &Repo) -> Result<(), VcsError> {
    require_remote(&repo.remotes()?)?;
    repo.write(["fetch", "--prune"])
        .timeout(NETWORK_TIMEOUT)
        .run()?;
    Ok(())
}

/// Fast-forwards the current branch to its upstream. It never creates a merge commit or rebases:
/// when the branches have diverged, git says so and nothing changes.
pub fn pull(repo: &Repo) -> Result<(), VcsError> {
    let branch = repo.require_branch()?;
    if !repo.has_upstream(&branch)? {
        return Err(VcsError::NoUpstream(branch));
    }
    repo.write(["pull", "--ff-only"])
        .timeout(NETWORK_TIMEOUT)
        .run()?;
    Ok(())
}

/// Pushes the current branch. A branch with no upstream is pushed to the default remote under
/// its own name, and starts tracking it.
pub fn push(repo: &Repo) -> Result<(), VcsError> {
    let branch = repo.require_branch()?;
    if repo.has_upstream(&branch)? {
        repo.write(["push"]).timeout(NETWORK_TIMEOUT).run()?;
        return Ok(());
    }
    let remote = default_remote(&repo.remotes()?)?;
    repo.write(["push", "-u", "--", &remote, &branch])
        .timeout(NETWORK_TIMEOUT)
        .run()?;
    Ok(())
}

fn require_remote(remotes: &[String]) -> Result<(), VcsError> {
    if remotes.is_empty() {
        return Err(no_remote());
    }
    Ok(())
}

fn default_remote(remotes: &[String]) -> Result<String, VcsError> {
    if let Some(preferred) = remotes.iter().find(|remote| *remote == PREFERRED_REMOTE) {
        return Ok(preferred.clone());
    }
    match remotes {
        [] => Err(no_remote()),
        [only] => Ok(only.clone()),
        _ => Err(VcsError::NoRemote(format!(
            "this repository has several remotes ({}) and none is called {PREFERRED_REMOTE}: \
             push once from a terminal with `git push -u <remote> <branch>`",
            remotes.join(", ")
        ))),
    }
}

fn no_remote() -> VcsError {
    VcsError::NoRemote(
        "this repository has no remote: add one with `git remote add origin <url>`".to_owned(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(names: &[&str]) -> Vec<String> {
        names.iter().map(|name| (*name).to_owned()).collect()
    }

    #[test]
    fn origin_is_preferred_among_several_remotes() {
        let remote = default_remote(&names(&["fork", "origin"])).expect("chosen");
        assert_eq!(remote, "origin");
    }

    #[test]
    fn a_single_remote_is_used_whatever_it_is_called() {
        assert_eq!(
            default_remote(&names(&["upstream"])).expect("chosen"),
            "upstream"
        );
    }

    #[test]
    fn no_remote_and_an_ambiguous_choice_are_errors() {
        let none = default_remote(&[]).expect_err("none");
        assert_eq!(none.code(), "no_remote");
        let several = default_remote(&names(&["a", "b"])).expect_err("ambiguous");
        assert!(several.to_string().contains("a, b"));
        assert!(require_remote(&[]).is_err());
        assert!(require_remote(&names(&["origin"])).is_ok());
    }
}
