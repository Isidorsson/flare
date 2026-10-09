//! Listing, creating, switching and deleting branches. Names come from the webview, so each is
//! checked with git's own rules (`check-ref-format --branch`) before it reaches a command.

use super::error::VcsError;
use super::model::VcsBranch;
use super::repo::Repo;

const LOCAL_PREFIX: &str = "refs/heads/";
const REMOTE_PREFIX: &str = "refs/remotes/";
const COMMAND: &str = "for-each-ref";

/// Local branches, then remote-tracking ones. The branch HEAD is on is listed even before it has
/// a commit, when git knows no ref for it yet.
pub fn list(repo: &Repo) -> Result<Vec<VcsBranch>, VcsError> {
    let output = repo
        .read([
            "for-each-ref",
            "--format=%(HEAD)%00%(refname)%00%(upstream)%00%(symref)%00",
            "refs/heads",
            "refs/remotes",
        ])
        .run()?;
    let mut branches = parse_refs(&output.stdout)?;
    if !repo.head_exists()? {
        if let Some(name) = repo.current_branch()? {
            branches.insert(
                0,
                VcsBranch {
                    name,
                    remote: false,
                    current: true,
                    upstream: None,
                },
            );
        }
    }
    Ok(branches)
}

/// Creates a branch at HEAD and switches to it, taking uncommitted changes along.
pub fn create(repo: &Repo, name: &str) -> Result<(), VcsError> {
    validate_name(repo, name)?;
    repo.write(["switch", "-c", name]).run()?;
    Ok(())
}

/// Switches to a local branch. A remote one (`origin/x`) switches to the local branch tracking
/// it, created first when there is none. Git itself refuses when local changes would be lost.
pub fn switch(repo: &Repo, name: &str) -> Result<(), VcsError> {
    validate_name(repo, name)?;
    let plan = plan_switch(name, &list(repo)?, &repo.remotes()?)?;
    if plan.local() != name {
        validate_name(repo, plan.local())?;
    }
    match &plan {
        SwitchPlan::Local(local) => repo.write(["switch", local]).run()?,
        SwitchPlan::Track { remote_ref, local } => repo
            .write(["switch", "-c", local, "--track", remote_ref])
            .run()?,
    };
    Ok(())
}

/// Deletes a local branch. Without `force` git refuses a branch that is not merged.
pub fn delete(repo: &Repo, name: &str, force: bool) -> Result<(), VcsError> {
    validate_name(repo, name)?;
    let flag = if force { "-D" } else { "-d" };
    repo.write(["branch", flag, "--", name]).run()?;
    Ok(())
}

#[derive(Debug, PartialEq, Eq)]
enum SwitchPlan {
    Local(String),
    Track { remote_ref: String, local: String },
}

impl SwitchPlan {
    fn local(&self) -> &str {
        match self {
            Self::Local(local) | Self::Track { local, .. } => local,
        }
    }
}

fn plan_switch(
    name: &str,
    branches: &[VcsBranch],
    remotes: &[String],
) -> Result<SwitchPlan, VcsError> {
    let exists = |remote: bool, wanted: &str| {
        branches
            .iter()
            .any(|branch| branch.remote == remote && branch.name == wanted)
    };
    if exists(false, name) {
        return Ok(SwitchPlan::Local(name.to_owned()));
    }
    if !exists(true, name) {
        return Err(VcsError::InvalidRequest(format!(
            "there is no branch named {name}"
        )));
    }
    let local = remotes
        .iter()
        .filter_map(|remote| name.strip_prefix(remote.as_str())?.strip_prefix('/'))
        .min_by_key(|rest| rest.len())
        .ok_or_else(|| VcsError::InvalidRequest(format!("{name} is not on a known remote")))?;
    if exists(false, local) {
        return Ok(SwitchPlan::Local(local.to_owned()));
    }
    Ok(SwitchPlan::Track {
        remote_ref: name.to_owned(),
        local: local.to_owned(),
    })
}

fn validate_name(repo: &Repo, name: &str) -> Result<(), VcsError> {
    let plain = !name.is_empty() && !name.starts_with('-') && !name.contains(['\0', '\n']);
    if !plain {
        return Err(VcsError::InvalidRequest(format!(
            "{name:?} is not a valid branch name"
        )));
    }
    let output = repo
        .read(["check-ref-format", "--branch", name])
        .run_unchecked()?;
    if output.code != 0 {
        return Err(VcsError::InvalidRequest(format!(
            "{name:?} is not a valid branch name: {}",
            output.stderr
        )));
    }
    if output.text()? != name {
        return Err(VcsError::InvalidRequest(format!(
            "{name:?} is a shorthand, not a branch name"
        )));
    }
    Ok(())
}

/// Records are NUL-separated fields, four per ref, and git ends each line with a newline that
/// lands at the start of the next record.
fn parse_refs(stdout: &[u8]) -> Result<Vec<VcsBranch>, VcsError> {
    let mut pieces = stdout.split(|byte| *byte == 0);
    let mut branches = Vec::new();
    while let Some(marker) = pieces.next() {
        let marker = text(marker)?.trim_start_matches('\n');
        if marker.is_empty() {
            break;
        }
        let mut next = || {
            pieces
                .next()
                .ok_or_else(|| VcsError::output(COMMAND, "a ref record ended early"))
                .and_then(text)
        };
        let (refname, upstream, symref) = (next()?, next()?, next()?);
        if !symref.is_empty() {
            continue;
        }
        if let Some(name) = refname.strip_prefix(LOCAL_PREFIX) {
            branches.push(VcsBranch {
                name: name.to_owned(),
                remote: false,
                current: marker == "*",
                upstream: short_ref(upstream),
            });
        } else if let Some(name) = refname.strip_prefix(REMOTE_PREFIX) {
            branches.push(VcsBranch {
                name: name.to_owned(),
                remote: true,
                current: false,
                upstream: None,
            });
        }
    }
    Ok(branches)
}

fn short_ref(full: &str) -> Option<String> {
    let short = full
        .strip_prefix(REMOTE_PREFIX)
        .or_else(|| full.strip_prefix(LOCAL_PREFIX))
        .unwrap_or(full);
    (!short.is_empty()).then(|| short.to_owned())
}

fn text(bytes: &[u8]) -> Result<&str, VcsError> {
    std::str::from_utf8(bytes)
        .map_err(|_| VcsError::output(COMMAND, "a ref name is not valid UTF-8"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record(marker: &str, refname: &str, upstream: &str, symref: &str) -> String {
        format!("{marker}\0{refname}\0{upstream}\0{symref}\0\n")
    }

    fn branch(name: &str, remote: bool) -> VcsBranch {
        VcsBranch {
            name: name.to_owned(),
            remote,
            current: false,
            upstream: None,
        }
    }

    #[test]
    fn parses_local_and_remote_refs() {
        let listing = [
            record("*", "refs/heads/main", "refs/remotes/origin/main", ""),
            record(" ", "refs/heads/topic/x", "", ""),
            record(
                " ",
                "refs/remotes/origin/HEAD",
                "",
                "refs/remotes/origin/main",
            ),
            record(" ", "refs/remotes/origin/main", "", ""),
        ]
        .concat();
        let branches = parse_refs(listing.as_bytes()).expect("parses");
        assert_eq!(branches.len(), 3);
        assert_eq!(branches[0].name, "main");
        assert!(branches[0].current && !branches[0].remote);
        assert_eq!(branches[0].upstream.as_deref(), Some("origin/main"));
        assert_eq!(branches[1].name, "topic/x");
        assert_eq!(branches[1].upstream, None);
        assert!(!branches[1].current);
        assert_eq!(branches[2].name, "origin/main");
        assert!(branches[2].remote);
    }

    #[test]
    fn an_empty_listing_has_no_branches() {
        assert!(parse_refs(b"").expect("parses").is_empty());
    }

    #[test]
    fn a_cut_short_listing_is_an_error() {
        assert!(parse_refs(b"*\0refs/heads/main\0").is_err());
    }

    #[test]
    fn a_local_branch_is_switched_to_directly() {
        let branches = [branch("main", false), branch("origin/main", true)];
        let plan = plan_switch("main", &branches, &["origin".to_owned()]).expect("plans");
        assert_eq!(plan, SwitchPlan::Local("main".to_owned()));
    }

    #[test]
    fn a_remote_branch_gets_a_tracking_branch() {
        let branches = [branch("main", false), branch("origin/feature/x", true)];
        let plan = plan_switch("origin/feature/x", &branches, &["origin".to_owned()]);
        assert_eq!(
            plan.expect("plans"),
            SwitchPlan::Track {
                remote_ref: "origin/feature/x".to_owned(),
                local: "feature/x".to_owned()
            }
        );
    }

    #[test]
    fn a_remote_branch_with_a_local_counterpart_switches_to_it() {
        let branches = [branch("dev", false), branch("origin/dev", true)];
        let plan = plan_switch("origin/dev", &branches, &["origin".to_owned()]);
        assert_eq!(plan.expect("plans"), SwitchPlan::Local("dev".to_owned()));
    }

    #[test]
    fn the_remote_name_may_itself_contain_a_slash() {
        let branches = [branch("team/fork/main", true)];
        let remotes = ["team".to_owned(), "team/fork".to_owned()];
        let plan = plan_switch("team/fork/main", &branches, &remotes).expect("plans");
        assert_eq!(
            plan,
            SwitchPlan::Track {
                remote_ref: "team/fork/main".to_owned(),
                local: "main".to_owned()
            }
        );
    }

    #[test]
    fn the_local_name_is_the_one_a_plan_ends_up_on() {
        let branches = [branch("origin/-x", true)];
        let plan = plan_switch("origin/-x", &branches, &["origin".to_owned()]).expect("plans");
        assert_eq!(plan.local(), "-x");
        assert_eq!(SwitchPlan::Local("main".to_owned()).local(), "main");
    }

    #[test]
    fn an_unknown_branch_is_rejected() {
        let error = plan_switch("nope", &[branch("main", false)], &[]).expect_err("unknown");
        assert_eq!(error.code(), "invalid_request");
    }
}
