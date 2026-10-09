//! The two sides of a file diff: committed and staged versions come out of git's object store,
//! the working copy comes from disk.

use std::fs;
use std::io;
use std::path::Path;

use super::error::VcsError;
use super::repo::Repo;

/// Larger files are not sent to the webview as text.
pub const TEXT_LIMIT: usize = 5 * 1024 * 1024;
const BINARY_SNIFF_BYTES: usize = 8 * 1024;
const COMMAND: &str = "cat-file";

#[derive(Debug, PartialEq, Eq)]
pub enum Blob {
    Missing,
    Bytes(Vec<u8>),
    TooLarge,
}

impl Blob {
    pub fn is_present(&self) -> bool {
        !matches!(self, Self::Missing)
    }

    /// git's own rule for calling a file binary: a NUL byte near the start.
    pub fn is_binary(&self) -> bool {
        match self {
            Self::Missing => false,
            Self::TooLarge => true,
            Self::Bytes(bytes) => bytes.iter().take(BINARY_SNIFF_BYTES).any(|byte| *byte == 0),
        }
    }

    pub fn into_text(self) -> Option<String> {
        match self {
            Self::Bytes(bytes) => Some(String::from_utf8_lossy(&bytes).into_owned()),
            Self::Missing | Self::TooLarge => None,
        }
    }
}

/// Reads the objects `specs` name (`HEAD:path`, `:0:path`, ...) with one process. A name that
/// resolves to nothing, to a folder, or to a submodule commit comes back as `Missing`.
pub fn read_objects<const N: usize>(
    repo: &Repo,
    specs: [String; N],
) -> Result<[Blob; N], VcsError> {
    let mut input = Vec::new();
    for spec in &specs {
        input.extend_from_slice(spec.as_bytes());
        input.push(b'\n');
    }
    let output = repo.read(["cat-file", "--batch"]).stdin(input).run()?;
    <[Blob; N]>::try_from(parse_batch(&output.stdout, N)?)
        .map_err(|_| VcsError::output(COMMAND, "the reply held the wrong number of objects"))
}

fn parse_batch(mut rest: &[u8], count: usize) -> Result<Vec<Blob>, VcsError> {
    let mut blobs = Vec::with_capacity(count);
    for _ in 0..count {
        let end = rest
            .iter()
            .position(|byte| *byte == b'\n')
            .ok_or_else(|| VcsError::output(COMMAND, "the reply ended early"))?;
        let header = std::str::from_utf8(&rest[..end])
            .map_err(|_| VcsError::output(COMMAND, "a reply header is not text"))?;
        rest = &rest[end + 1..];
        if header.ends_with(" missing") {
            blobs.push(Blob::Missing);
            continue;
        }
        let (kind, size) = object_header(header)?;
        let body_end = size + 1;
        if rest.len() < body_end {
            return Err(VcsError::output(COMMAND, "an object was cut short"));
        }
        blobs.push(blob_from(kind, &rest[..size]));
        rest = &rest[body_end..];
    }
    Ok(blobs)
}

fn blob_from(kind: &str, body: &[u8]) -> Blob {
    match kind {
        "blob" if body.len() > TEXT_LIMIT => Blob::TooLarge,
        "blob" => Blob::Bytes(body.to_vec()),
        _ => Blob::Missing,
    }
}

fn object_header(header: &str) -> Result<(&str, usize), VcsError> {
    let mut parts = header.split(' ');
    match (parts.next(), parts.next(), parts.next(), parts.next()) {
        (Some(_sha), Some(kind), Some(size), None) => {
            let size = size
                .parse::<usize>()
                .map_err(|_| VcsError::output(COMMAND, format!("bad object size: {header}")))?;
            Ok((kind, size))
        }
        _ => Err(VcsError::output(
            COMMAND,
            format!("unexpected reply: {header}"),
        )),
    }
}

/// The file as it is on disk, which for a symbolic link is the link's target (what git stores).
/// A folder in the way (a nested repository) counts as missing, and so does a path whose parent
/// folders lead outside the repository through a link.
pub fn read_working_file(top: &Path, path: &str) -> Result<Blob, VcsError> {
    let file = top.join(path.trim_end_matches(['/', '\\']));
    if !parent_is_inside(top, &file)? {
        return Ok(Blob::Missing);
    }
    let metadata = match fs::symlink_metadata(&file) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Blob::Missing),
        Err(error) => return Err(VcsError::io(&file, error)),
    };
    if metadata.file_type().is_symlink() {
        let target = fs::read_link(&file).map_err(|error| VcsError::io(&file, error))?;
        return Ok(Blob::Bytes(
            target.to_string_lossy().into_owned().into_bytes(),
        ));
    }
    if !metadata.is_file() {
        return Ok(Blob::Missing);
    }
    if metadata.len() > TEXT_LIMIT as u64 {
        return Ok(Blob::TooLarge);
    }
    fs::read(&file)
        .map(Blob::Bytes)
        .map_err(|error| VcsError::io(&file, error))
}

fn parent_is_inside(top: &Path, file: &Path) -> Result<bool, VcsError> {
    let Some(parent) = file.parent() else {
        return Ok(false);
    };
    match dunce::canonicalize(parent) {
        Ok(real) => Ok(real.starts_with(top)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(true),
        Err(error) => Err(VcsError::io(parent, error)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn framed(kind: &str, body: &[u8]) -> Vec<u8> {
        let mut bytes = format!("{} {kind} {}\n", "a".repeat(40), body.len()).into_bytes();
        bytes.extend_from_slice(body);
        bytes.push(b'\n');
        bytes
    }

    #[test]
    fn parses_present_and_missing_objects_in_order() {
        let mut reply = framed("blob", b"hello\n");
        reply.extend_from_slice(b"HEAD:gone.txt missing\n");
        reply.extend(framed("blob", b""));
        let blobs = parse_batch(&reply, 3).expect("parses");
        assert_eq!(blobs[0], Blob::Bytes(b"hello\n".to_vec()));
        assert_eq!(blobs[1], Blob::Missing);
        assert_eq!(blobs[2], Blob::Bytes(Vec::new()));
    }

    #[test]
    fn content_that_looks_like_a_header_is_not_misread() {
        let body = b"deadbeef blob 3\nxyz\nHEAD:x missing\n";
        let mut reply = framed("blob", body);
        reply.extend_from_slice(b":0:y missing\n");
        let blobs = parse_batch(&reply, 2).expect("parses");
        assert_eq!(blobs[0], Blob::Bytes(body.to_vec()));
        assert_eq!(blobs[1], Blob::Missing);
    }

    #[test]
    fn folders_and_commits_count_as_missing() {
        let mut reply = framed("tree", b"entries");
        reply.extend(framed("commit", b"tree x"));
        let blobs = parse_batch(&reply, 2).expect("parses");
        assert_eq!(blobs, [Blob::Missing, Blob::Missing]);
    }

    #[test]
    fn a_truncated_reply_is_an_error() {
        let reply = framed("blob", b"hello world");
        assert!(parse_batch(&reply[..reply.len() - 5], 1).is_err());
        assert!(parse_batch(b"", 1).is_err());
        assert!(parse_batch(b"not a header\n", 1).is_err());
    }

    #[test]
    fn a_nul_byte_near_the_start_marks_a_file_binary() {
        assert!(Blob::Bytes(b"abc\0def".to_vec()).is_binary());
        assert!(!Blob::Bytes(b"plain text".to_vec()).is_binary());
        assert!(!Blob::Missing.is_binary());
        assert!(Blob::TooLarge.is_binary());
    }

    #[test]
    fn a_nul_byte_past_the_sniffed_prefix_is_not_noticed() {
        let mut bytes = vec![b'a'; BINARY_SNIFF_BYTES];
        bytes.push(0);
        assert!(!Blob::Bytes(bytes).is_binary());
    }

    #[test]
    fn invalid_utf8_is_shown_with_replacement_characters() {
        let text = Blob::Bytes(vec![b'a', 0xff, b'b'])
            .into_text()
            .expect("text");
        assert_eq!(text, "a\u{fffd}b");
        assert_eq!(Blob::Missing.into_text(), None);
    }

    #[test]
    fn working_files_are_read_from_disk() {
        let dir = tempfile::tempdir().expect("dir");
        let top = dunce::canonicalize(dir.path()).expect("canonical");
        fs::create_dir_all(top.join("sub")).expect("mkdir");
        fs::write(top.join("sub/a.txt"), "hi").expect("write");
        let read = read_working_file(&top, "sub/a.txt").expect("read");
        assert_eq!(read, Blob::Bytes(b"hi".to_vec()));
        assert_eq!(
            read_working_file(&top, "sub/none.txt").expect("read"),
            Blob::Missing
        );
        assert_eq!(
            read_working_file(&top, "nodir/x").expect("read"),
            Blob::Missing
        );
        assert_eq!(
            read_working_file(&top, "sub/").expect("read"),
            Blob::Missing
        );
    }

    #[test]
    fn a_working_file_over_the_limit_is_not_read() {
        let dir = tempfile::tempdir().expect("dir");
        let top = dunce::canonicalize(dir.path()).expect("canonical");
        fs::write(top.join("big.bin"), vec![b'x'; TEXT_LIMIT + 1]).expect("write");
        assert_eq!(
            read_working_file(&top, "big.bin").expect("read"),
            Blob::TooLarge
        );
    }
}
