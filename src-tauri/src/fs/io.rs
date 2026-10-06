use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::Path;

use serde::Serialize;

use super::error::FsError;

pub const MAX_TEXT_BYTES: u64 = 2 * 1024 * 1024;
pub const TEMP_PREFIX: &str = ".flare-";
const TEMP_SUFFIX: &str = ".tmp";
const BINARY_SNIFF_BYTES: usize = 8_000;

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum FileRead {
    Text { content: String, size: u64 },
    Binary { size: u64 },
    TooLarge { size: u64, limit: u64 },
}

pub fn read_file(path: &Path) -> Result<FileRead, FsError> {
    let metadata = fs::metadata(path).map_err(|e| FsError::io(path, e))?;
    if metadata.is_dir() {
        return Err(FsError::IsADirectory(path.display().to_string()));
    }
    let size = metadata.len();
    let file = File::open(path).map_err(|e| FsError::io(path, e))?;
    let mut bytes = Vec::new();
    file.take(MAX_TEXT_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| FsError::io(path, e))?;
    if bytes.len() as u64 > MAX_TEXT_BYTES {
        return Ok(FileRead::TooLarge {
            size,
            limit: MAX_TEXT_BYTES,
        });
    }
    Ok(decode_text(bytes, size))
}

fn decode_text(bytes: Vec<u8>, size: u64) -> FileRead {
    let sniffed = &bytes[..bytes.len().min(BINARY_SNIFF_BYTES)];
    if sniffed.contains(&0) {
        return FileRead::Binary { size };
    }
    match String::from_utf8(bytes) {
        Ok(content) => FileRead::Text { content, size },
        Err(_) => FileRead::Binary { size },
    }
}

pub fn is_temp_file_name(name: &str) -> bool {
    name.starts_with(TEMP_PREFIX) && name.ends_with(TEMP_SUFFIX)
}

pub fn write_atomic(path: &Path, content: &str) -> Result<(), FsError> {
    let existing = match fs::metadata(path) {
        Ok(metadata) if metadata.is_dir() => {
            return Err(FsError::IsADirectory(path.display().to_string()));
        }
        Ok(metadata) => Some(metadata),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(FsError::io(path, e)),
    };
    let dir = path
        .parent()
        .ok_or_else(|| FsError::NotFound(path.display().to_string()))?;
    let mut temp = tempfile::Builder::new()
        .prefix(TEMP_PREFIX)
        .suffix(TEMP_SUFFIX)
        .tempfile_in(dir)
        .map_err(|e| FsError::io(dir, e))?;
    temp.write_all(content.as_bytes())
        .map_err(|e| FsError::io(path, e))?;
    temp.as_file()
        .sync_all()
        .map_err(|e| FsError::io(path, e))?;
    if let Some(metadata) = existing {
        temp.as_file()
            .set_permissions(metadata.permissions())
            .map_err(|e| FsError::io(path, e))?;
    }
    temp.persist(path).map_err(|e| FsError::io(path, e.error))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp() -> tempfile::TempDir {
        tempfile::tempdir().expect("tempdir")
    }

    fn entries(dir: &Path) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(dir)
            .expect("read_dir")
            .map(|e| e.expect("entry").file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        names
    }

    #[test]
    fn reads_utf8_text_with_crlf_and_bom_intact() {
        let dir = temp();
        let path = dir.path().join("a.txt");
        let text = "\u{feff}line1\r\nline2\r\n";
        fs::write(&path, text).expect("write");
        let read = read_file(&path).expect("read");
        assert_eq!(
            read,
            FileRead::Text {
                content: text.to_owned(),
                size: text.len() as u64
            }
        );
    }

    #[test]
    fn reads_an_empty_file_as_empty_text() {
        let dir = temp();
        let path = dir.path().join("empty");
        fs::write(&path, "").expect("write");
        assert_eq!(
            read_file(&path).expect("read"),
            FileRead::Text {
                content: String::new(),
                size: 0
            }
        );
    }

    #[test]
    fn detects_binary_by_nul_byte() {
        let dir = temp();
        let path = dir.path().join("a.bin");
        fs::write(&path, [b'M', b'Z', 0, 1, 2]).expect("write");
        assert_eq!(
            read_file(&path).expect("read"),
            FileRead::Binary { size: 5 }
        );
    }

    #[test]
    fn treats_invalid_utf8_as_binary() {
        let dir = temp();
        let path = dir.path().join("latin1.txt");
        fs::write(&path, [b'c', b'a', b'f', 0xE9]).expect("write");
        assert_eq!(
            read_file(&path).expect("read"),
            FileRead::Binary { size: 4 }
        );
    }

    #[test]
    fn refuses_files_over_the_size_cap_without_loading_them() {
        let dir = temp();
        let path = dir.path().join("big.txt");
        fs::write(&path, vec![b'a'; MAX_TEXT_BYTES as usize + 1]).expect("write");
        assert_eq!(
            read_file(&path).expect("read"),
            FileRead::TooLarge {
                size: MAX_TEXT_BYTES + 1,
                limit: MAX_TEXT_BYTES
            }
        );
    }

    #[test]
    fn accepts_a_file_exactly_at_the_cap() {
        let dir = temp();
        let path = dir.path().join("edge.txt");
        fs::write(&path, vec![b'a'; MAX_TEXT_BYTES as usize]).expect("write");
        assert!(matches!(
            read_file(&path).expect("read"),
            FileRead::Text { .. }
        ));
    }

    #[test]
    fn read_reports_missing_files_and_directories() {
        let dir = temp();
        assert_eq!(
            read_file(&dir.path().join("nope"))
                .expect_err("missing")
                .code(),
            "not_found"
        );
        assert_eq!(
            read_file(dir.path()).expect_err("dir").code(),
            "is_a_directory"
        );
    }

    #[test]
    fn write_creates_and_replaces_files_without_leaving_temp_files() {
        let dir = temp();
        let path = dir.path().join("out.txt");
        write_atomic(&path, "first").expect("create");
        assert_eq!(fs::read_to_string(&path).expect("read"), "first");
        write_atomic(&path, "second\r\nline").expect("replace");
        assert_eq!(fs::read_to_string(&path).expect("read"), "second\r\nline");
        assert_eq!(entries(dir.path()), ["out.txt"]);
    }

    #[test]
    fn write_fails_when_the_parent_is_missing() {
        let dir = temp();
        let error = write_atomic(&dir.path().join("missing/out.txt"), "x").expect_err("no parent");
        assert_eq!(error.code(), "not_found");
    }

    #[test]
    fn write_refuses_to_replace_a_directory() {
        let dir = temp();
        let target = dir.path().join("folder");
        fs::create_dir(&target).expect("mkdir");
        let error = write_atomic(&target, "x").expect_err("dir");
        assert_eq!(error.code(), "is_a_directory");
        assert_eq!(entries(dir.path()), ["folder"]);
    }

    #[test]
    fn temp_names_are_recognised() {
        assert!(is_temp_file_name(".flare-abc123.tmp"));
        assert!(!is_temp_file_name("flare.tmp"));
        assert!(!is_temp_file_name(".flare-notes.txt"));
    }
}
