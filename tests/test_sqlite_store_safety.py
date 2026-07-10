import copy
import importlib.util
import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"


def load_script(name):
    path = SCRIPTS / name
    spec = importlib.util.spec_from_file_location(path.stem, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[path.stem] = module
    spec.loader.exec_module(module)
    return module


DOCTOR = load_script("sqlite_store_doctor.py")
SETUP = load_script("sqlite_store_setup.py")
RELEASE_SAFETY = load_script("release_safety_check.py")


class SQLiteRegistryDoctorTests(unittest.TestCase):
    def test_registry_blueprints_are_valid_and_runtime_databases_are_not_tracked(self):
        registry = DOCTOR.load_registry(ROOT)
        self.assertEqual(registry["distributionPolicy"]["shipRuntimeDatabases"], False)
        self.assertEqual(registry["distributionPolicy"]["shipEmptySeedDatabases"], False)
        self.assertEqual(len(registry["stores"]), 4)
        for store in registry["stores"]:
            blueprint = DOCTOR.schema_blueprint(ROOT, store)
            self.assertTrue(blueprint["columns"], store["id"])
            self.assertFalse((ROOT / store["dbPath"]).is_relative_to(ROOT / "config"))

        git_result = DOCTOR.inspect_git_protection(ROOT, registry["stores"])
        self.assertTrue(git_result["ok"], git_result)
        self.assertEqual(git_result["trackedRuntimeDatabases"], [])

    def test_doctor_accepts_each_schema_blueprint_without_writing_to_missing_paths(self):
        registry = DOCTOR.load_registry(ROOT)
        with tempfile.TemporaryDirectory() as tmpdir:
            for original in registry["stores"]:
                store = copy.deepcopy(original)
                db_path = Path(tmpdir) / f"{store['id']}.sqlite3"
                store["dbPath"] = str(db_path)
                missing = DOCTOR.inspect_store(ROOT, store)
                self.assertEqual(missing["status"], "missing", store["id"])
                self.assertFalse(db_path.exists(), store["id"])

                schema_sql = (ROOT / store["schemaPath"]).read_text(encoding="utf-8")
                conn = sqlite3.connect(db_path)
                try:
                    conn.executescript(schema_sql)
                finally:
                    conn.close()
                ready = DOCTOR.inspect_store(ROOT, store, require_initialized=True)
                self.assertTrue(ready["ok"], ready)
                self.assertEqual(ready["status"], "ready", ready)


class SQLiteOwnerInitTests(unittest.TestCase):
    def run_python(self, args, *, env=None):
        return subprocess.run(
            [sys.executable, *args],
            cwd=ROOT,
            env=env,
            capture_output=True,
            text=True,
            check=False,
        )

    def test_all_owner_init_commands_are_idempotent_in_temporary_stores(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp = Path(tmpdir)
            toss_db = tmp / "toss.sqlite3"
            simulator_db = tmp / "simulator.sqlite3"
            magazine_db = tmp / "magazine.sqlite3"
            env = os.environ.copy()

            commands = [
                (
                    "world-memory",
                    tmp / "world" / "world_issue_log.sqlite3",
                    ["scripts/world_memory_cli.py", "--base-dir", str(tmp / "world"), "init"],
                    env,
                ),
                (
                    "tossinvest-ledger",
                    toss_db,
                    ["scripts/tossinvest_ledger_store.py", "init"],
                    {**env, "FINANCE_AGENT_GUI_TOSSINVEST_DB_PATH": str(toss_db)},
                ),
                (
                    "invest-simulator",
                    simulator_db,
                    ["scripts/invest_simulator_store.py", "init"],
                    {**env, "FINANCE_AGENT_GUI_INVEST_SIMULATOR_DB_PATH": str(simulator_db)},
                ),
                (
                    "magazine-event-signatures",
                    magazine_db,
                    [
                        "scripts/magazine_event_signature_index.py",
                        "init",
                        "--index-path",
                        str(magazine_db),
                        "--json",
                    ],
                    env,
                ),
            ]
            registry = {
                store["id"]: store for store in DOCTOR.load_registry(ROOT)["stores"]
            }
            for store_id, db_path, args, command_env in commands:
                first = self.run_python(args, env=command_env)
                second = self.run_python(args, env=command_env)
                self.assertEqual(first.returncode, 0, first.stderr or first.stdout)
                self.assertEqual(second.returncode, 0, second.stderr or second.stdout)
                store = copy.deepcopy(registry[store_id])
                store["dbPath"] = str(db_path)
                inspection = DOCTOR.inspect_store(ROOT, store, require_initialized=True)
                self.assertTrue(inspection["ok"], inspection)
                self.assertEqual(inspection["status"], "ready", inspection)

    def test_versioned_stores_refuse_newer_schema_without_downgrading(self):
        cases = (
            (
                "toss.sqlite3",
                ["scripts/tossinvest_ledger_store.py", "init"],
                "FINANCE_AGENT_GUI_TOSSINVEST_DB_PATH",
            ),
            (
                "simulator.sqlite3",
                ["scripts/invest_simulator_store.py", "init"],
                "FINANCE_AGENT_GUI_INVEST_SIMULATOR_DB_PATH",
            ),
            (
                "magazine.sqlite3",
                ["scripts/magazine_event_signature_index.py", "init", "--index-path", "{db}"],
                "",
            ),
        )
        with tempfile.TemporaryDirectory() as tmpdir:
            for filename, command_template, env_name in cases:
                db_path = Path(tmpdir) / filename
                conn = sqlite3.connect(db_path)
                conn.execute("CREATE TABLE sentinel (value TEXT NOT NULL)")
                conn.execute("INSERT INTO sentinel VALUES ('preserve-me')")
                conn.execute("PRAGMA user_version = 99")
                conn.commit()
                conn.close()

                command = [str(db_path) if item == "{db}" else item for item in command_template]
                env = os.environ.copy()
                if env_name:
                    env[env_name] = str(db_path)
                completed = self.run_python(command, env=env)
                self.assertNotEqual(completed.returncode, 0, filename)
                check = sqlite3.connect(db_path)
                try:
                    self.assertEqual(check.execute("PRAGMA user_version").fetchone()[0], 99)
                    self.assertEqual(check.execute("SELECT value FROM sentinel").fetchone()[0], "preserve-me")
                finally:
                    check.close()

    def test_world_memory_connections_enable_foreign_keys(self):
        world_memory = load_script("world_memory_cli.py")
        with tempfile.TemporaryDirectory() as tmpdir:
            conn = world_memory._connect_db(Path(tmpdir) / "world.sqlite3")
            try:
                self.assertEqual(conn.execute("PRAGMA foreign_keys").fetchone()[0], 1)
            finally:
                conn.close()


class SQLiteSetupWorkflowTests(unittest.TestCase):
    def test_apply_backs_up_then_migrates_without_losing_rows(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            (root / "config").mkdir()
            (root / "scripts").mkdir()
            (root / "data" / "example").mkdir(parents=True)
            (root / "config" / "example.schema.sql").write_text(
                """
                CREATE TABLE IF NOT EXISTS sentinel (value TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS added_by_v2 (id INTEGER PRIMARY KEY);
                PRAGMA user_version = 2;
                """,
                encoding="utf-8",
            )
            (root / "scripts" / "owner.py").write_text(
                """
import sqlite3
from pathlib import Path
db = Path(__file__).resolve().parents[1] / 'data' / 'example' / 'store.sqlite3'
conn = sqlite3.connect(db)
conn.execute('CREATE TABLE IF NOT EXISTS sentinel (value TEXT NOT NULL)')
conn.execute('CREATE TABLE IF NOT EXISTS added_by_v2 (id INTEGER PRIMARY KEY)')
conn.execute('PRAGMA user_version = 2')
conn.commit()
conn.close()
                """.strip()
                + "\n",
                encoding="utf-8",
            )
            db_path = root / "data" / "example" / "store.sqlite3"
            conn = sqlite3.connect(db_path)
            conn.execute("CREATE TABLE sentinel (value TEXT NOT NULL)")
            conn.execute("INSERT INTO sentinel VALUES ('keep')")
            conn.execute("PRAGMA user_version = 1")
            conn.commit()
            conn.close()

            store = {
                "id": "example",
                "label": "Example",
                "dbPath": "data/example/store.sqlite3",
                "schemaPath": "config/example.schema.sql",
                "ownerScript": "scripts/owner.py",
                "initCommand": ["python", "scripts/owner.py", "init"],
                "schemaVersion": 2,
                "lazy": True,
                "rebuildable": False,
                "dataClass": "authoritative-user-state",
            }
            backup_root = root / "data" / "backups" / "sqlite" / "test"
            result = SETUP.apply_plan(
                root,
                [store],
                initialize_missing=False,
                backup_root=backup_root,
            )
            self.assertTrue(result["ok"], result)
            self.assertTrue((backup_root / "example--store.sqlite3").is_file())
            self.assertTrue((backup_root / "backup-manifest.json").is_file())

            migrated = sqlite3.connect(db_path)
            backup = sqlite3.connect(backup_root / "example--store.sqlite3")
            try:
                self.assertEqual(migrated.execute("SELECT value FROM sentinel").fetchone()[0], "keep")
                self.assertEqual(migrated.execute("PRAGMA user_version").fetchone()[0], 2)
                self.assertEqual(backup.execute("SELECT value FROM sentinel").fetchone()[0], "keep")
                self.assertEqual(backup.execute("PRAGMA user_version").fetchone()[0], 1)
            finally:
                migrated.close()
                backup.close()


class ReleaseSafetyTests(unittest.TestCase):
    def test_scanner_suppresses_secret_values_and_allows_examples(self):
        secret = "sk-" + "A1b2C3d4E5f6G7h8I9j0K1l2"
        issues = RELEASE_SAFETY.scan_text(
            f'OPENAI_API_KEY="{secret}"\n', path="config/runtime.js", source="test"
        )
        self.assertTrue(any(issue["code"] == "openai-api-key" for issue in issues))
        self.assertNotIn(secret, json.dumps(issues))

        placeholder_issues = RELEASE_SAFETY.scan_text(
            'client_secret="your-client-secret"\nemail="person@example.com"\n',
            path=".env.example",
            source="test",
        )
        self.assertEqual(placeholder_issues, [])

    def test_current_publish_set_has_no_private_runtime_paths(self):
        report = RELEASE_SAFETY.scan_current(ROOT)
        path_issues = [issue for issue in report["issues"] if issue["source"] == "tracked-path"]
        self.assertEqual(path_issues, [])

    def test_news_feed_cache_is_only_allowlisted_in_history(self):
        path = "data/news-feed.json"
        self.assertEqual(RELEASE_SAFETY.is_forbidden_tracked_path(path), "runtime-data-tracked")
        self.assertIn(path, RELEASE_SAFETY.ALLOWED_HISTORICAL_RUNTIME_PATHS)


if __name__ == "__main__":
    unittest.main()
