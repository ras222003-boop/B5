import importlib.util
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import sys
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("configure_web_origin", HERE / "configure_web_origin.py")
config = importlib.util.module_from_spec(spec)
spec.loader.exec_module(config)


class WebOriginConfigurationTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.plist = Path(self.folder.name) / "Info.plist"
        self.initial = {"CFBundleIdentifier": "sa.nasjalufuq.basira", "CFBundleVersion": "7", "BasiraWebBaseURL": "https://previous.example.org"}
        self.plist.write_bytes(plistlib.dumps(self.initial))

    def read(self):
        return plistlib.loads(self.plist.read_bytes())

    def test_injects_canonical_origin_and_retains_identity(self):
        config.configure(self.plist, "https://BASIRA.example.org/", "true")
        result = self.read()
        self.assertEqual(result["BasiraWebBaseURL"], "https://basira.example.org")
        self.assertEqual(result["BasiraVisionURL"], "https://basira.example.org/navigation/vision")
        self.assertEqual(result["BasiraLabURL"], "https://basira.example.org/navigation/native-vision")
        self.assertEqual(result["CFBundleIdentifier"], self.initial["CFBundleIdentifier"])
        self.assertEqual(result["CFBundleVersion"], "7")

    def test_missing_optional_origin_clears_cached_build_values(self):
        config.configure(self.plist, "", "false")
        for key in ("BasiraWebBaseURL", "BasiraVisionURL", "BasiraLabURL"):
            self.assertEqual(self.read()[key], "")

    def test_missing_required_origin_and_bad_flag_never_modify_plist(self):
        for origin, required in (("", "true"), ("", "TRUE"), ("https://basira.example.org", "maybe")):
            with self.subTest(origin=origin, required=required):
                before = self.plist.read_bytes()
                with self.assertRaises(ValueError):
                    config.configure(self.plist, origin, required)
                self.assertEqual(self.plist.read_bytes(), before)

    def test_invalid_urls_fail_closed_without_partial_writes(self):
        invalid = ["http://basira.example.org", " https://basira.example.org", "https://basira.example.org\n",
                   "https://user:password@basira.example.org", "https://basira.example.org:443", "https://basira.example.org:",
                   "https://basira.example.org/path", "https://basira.example.org?", "https://basira.example.org#",
                   "https://localhost", "https://sub.localhost", "https://127.0.0.1", "https://10.1.2.3",
                   "https://[::1]", "https://host.local", "https://YOUR-BASIRA-DOMAIN.example", "https://a.invalid",
                   "https://a.test", "https://bad..host.org", "https://-bad.host.org", "https://host.org.",
                   "https://%62asira.example.org", "https://host.org\\path", "$(BASIRA_IOS_WEB_ORIGIN)"]
        for origin in invalid:
            with self.subTest(origin=origin):
                before = self.plist.read_bytes()
                with self.assertRaises(ValueError):
                    config.configure(self.plist, origin, "false")
                self.assertEqual(self.plist.read_bytes(), before)

    def test_real_shell_entry_point_and_error_redaction(self):
        bash = os.environ.get("BASIRA_TEST_BASH") or shutil.which("bash")
        if not bash:
            self.skipTest("bash is unavailable")
        env = dict(os.environ, BASIRA_PYTHON_BIN=Path(sys.executable).as_posix(), BASIRA_REQUIRE_WEB_ORIGIN="true",
                   BASIRA_IOS_WEB_ORIGIN="https://basira.example.org")
        command = [bash, (HERE / "configure-web-origin.sh").as_posix(), "--plist", self.plist.as_posix()]
        run = subprocess.run(command, env=env, capture_output=True, text=True)
        self.assertEqual(run.returncode, 0, run.stderr)
        self.assertEqual(self.read()["BasiraWebBaseURL"], "https://basira.example.org")
        env["BASIRA_IOS_WEB_ORIGIN"] = "https://sensitive-password@host.org"
        run = subprocess.run(command, env=env, capture_output=True, text=True)
        self.assertNotEqual(run.returncode, 0)
        self.assertNotIn("sensitive-password", run.stderr + run.stdout)


if __name__ == "__main__":
    unittest.main()
