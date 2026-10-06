use super::declared::Declarations;

/// A `using` names a namespace, so it links to every file that declares it. A
/// `using static` or alias names a type instead; its namespace is the longest
/// declared prefix.
pub(super) fn resolve(namespace: &str, may_be_type: bool, declared: &Declarations) -> Vec<String> {
    let mut name = namespace;
    loop {
        let files = declared.dotnet_namespace(name);
        if !files.is_empty() || !may_be_type {
            return files.to_vec();
        }
        match name.rsplit_once('.') {
            Some((outer, _)) => name = outer,
            None => return Vec::new(),
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::graph::extract::Declared;
    use crate::graph::lang::SourceKind;
    use crate::graph::resolve::declared::DeclaredFile;

    use super::*;

    fn index() -> Declarations {
        let models = vec![Declared::Namespace("App.Models".into())];
        let files = [("m/User.cs", &models), ("m/Order.cs", &models)];
        Declarations::build(files.iter().map(|(path, declared)| DeclaredFile {
            path,
            kind: SourceKind::CSharp,
            declared,
        }))
    }

    #[test]
    fn a_namespace_links_every_declaring_file() {
        assert_eq!(
            resolve("App.Models", false, &index()),
            ["m/User.cs", "m/Order.cs"]
        );
    }

    #[test]
    fn plain_usings_never_fall_back_to_a_parent_namespace() {
        assert!(resolve("App.Models.Dto", false, &index()).is_empty());
        assert!(resolve("System.Linq", false, &index()).is_empty());
    }

    #[test]
    fn type_usings_find_the_enclosing_namespace() {
        assert_eq!(
            resolve("App.Models.User", true, &index()),
            ["m/User.cs", "m/Order.cs"]
        );
        assert_eq!(
            resolve("App.Models.User.Nested", true, &index()),
            ["m/User.cs", "m/Order.cs"]
        );
        assert!(resolve("System.Math", true, &index()).is_empty());
    }
}
