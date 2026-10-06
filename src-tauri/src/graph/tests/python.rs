use super::{edges, imports_of, pair, Fixture};

fn package_fixture() -> Fixture {
    Fixture::new(&[
        (
            "main.py",
            "import os\nimport app.models\nfrom app.db import session, Base\nfrom app import api\n",
        ),
        ("app/__init__.py", ""),
        ("app/models.py", "from .db import Base\nfrom . import api\n"),
        ("app/db/__init__.py", "from .session import connect\n"),
        (
            "app/db/session.py",
            "from ..models import User\nimport requests\n",
        ),
        ("app/api/__init__.py", ""),
        (
            "app/api/routes.py",
            "from .. import models\nfrom ...outside import nothing\n",
        ),
    ])
}

#[test]
fn absolute_imports_resolve_modules_packages_and_imported_submodules() {
    let indexer = package_fixture().index();
    assert_eq!(
        imports_of(&indexer, "main.py"),
        [
            "app/__init__.py",
            "app/api/__init__.py",
            "app/db/__init__.py",
            "app/db/session.py",
            "app/models.py",
        ]
    );
}

#[test]
fn relative_imports_follow_package_levels() {
    let indexer = package_fixture().index();
    assert_eq!(
        imports_of(&indexer, "app/models.py"),
        [
            "app/__init__.py",
            "app/api/__init__.py",
            "app/db/__init__.py"
        ]
    );
    assert_eq!(
        imports_of(&indexer, "app/db/__init__.py"),
        ["app/db/session.py"]
    );
    assert_eq!(imports_of(&indexer, "app/db/session.py"), ["app/models.py"]);
}

#[test]
fn double_dot_package_imports_link_the_sibling_module() {
    let indexer = package_fixture().index();
    assert_eq!(
        imports_of(&indexer, "app/api/routes.py"),
        ["app/__init__.py", "app/models.py"]
    );
}

#[test]
fn src_layout_and_project_subdirectory_roots_are_searched() {
    let fixture = Fixture::new(&[
        ("src/pkg/__init__.py", ""),
        ("src/pkg/core.py", ""),
        ("tests/test_core.py", "from pkg.core import run\n"),
        ("backend/svc/main.py", "from svc.helpers import h\n"),
        ("backend/svc/helpers.py", ""),
    ]);
    assert_eq!(
        edges(&fixture.index()),
        vec![
            pair("backend/svc/main.py", "backend/svc/helpers.py"),
            pair("tests/test_core.py", "src/pkg/core.py"),
        ]
    );
}

#[test]
fn imports_inside_functions_are_graph_edges_too() {
    let fixture = Fixture::new(&[("a.py", "def f():\n    import b\n"), ("b.py", "")]);
    assert_eq!(edges(&fixture.index()), vec![pair("a.py", "b.py")]);
}
