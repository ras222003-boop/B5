import importlib.util
from pathlib import Path
import plistlib
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("configure_storekit", HERE / "configure_storekit.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class StoreKitConfigurationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.plist = Path(self.temp.name) / "Info.plist"
        self.plist.write_bytes(plistlib.dumps({
            "CFBundleIdentifier": "sa.nasjalufuq.basira",
            "BasiraStoreKitCheckoutEnabled": True,
            "BasiraSubscriptionProductIDs": ["stale-product"],
        }))

    def read(self):
        return plistlib.loads(self.plist.read_bytes())

    def test_empty_configuration_is_safe(self):
        module.configure(self.plist, "")
        self.assertEqual(self.read()["BasiraSubscriptionProductIDs"], [])
        self.assertIs(self.read()["BasiraStoreKitCheckoutEnabled"], False)

    def test_valid_product_ids_are_discoverable_without_charging(self):
        ids = "sa.nasjalufuq.basira.plus.monthly,sa.nasjalufuq.basira.premium.monthly"
        module.configure(self.plist, ids)
        self.assertEqual(len(self.read()["BasiraSubscriptionProductIDs"]), 2)
        self.assertIs(self.read()["BasiraStoreKitCheckoutEnabled"], False)
        self.assertEqual(self.read()["CFBundleIdentifier"], "sa.nasjalufuq.basira")

    def test_bad_ids_never_change_plist(self):
        for value in (
            "https://example.org/checkout", "sa.nasjalufuq.other.basic",
            "sa.nasjalufuq.basira.abc,sa.nasjalufuq.basira.abc",
            "sa.nasjalufuq.basira.\nsecret", ",",
        ):
            with self.subTest(value=value):
                old = self.plist.read_bytes()
                with self.assertRaises(ValueError):
                    module.configure(self.plist, value)
                self.assertEqual(self.plist.read_bytes(), old)


if __name__ == "__main__":
    unittest.main()
