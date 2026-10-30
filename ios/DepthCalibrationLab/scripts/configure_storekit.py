"""Inject exact Apple StoreKit product IDs; never enable checkout implicitly.

This only configures discoverable product references for StoreKit 2. Apple
App Store Connect setup, backend entitlement verification and explicit
merchant release approval are separate actions.
"""
import argparse
import os
from pathlib import Path
import plistlib
import re
import sys
import tempfile

PRODUCT_ID_PATTERN = re.compile(r"^sa\.nasjalufuq\.basira\.[a-zA-Z0-9._-]{1,90}$")

def configured_product_ids(raw: str) -> list[str]:
    if not raw:
        return []
    values = [value.strip() for value in raw.split(",")]
    if len(values) > 6 or any(not PRODUCT_ID_PATTERN.fullmatch(value) for value in values):
        raise ValueError("Invalid StoreKit product ID format or too many products")
    if len(set(values)) != len(values):
        raise ValueError("Duplicate StoreKit product ID")
    return values

def configure(plist: Path, raw_ids: str) -> list[str]:
    ids = configured_product_ids(raw_ids)
    with plist.open("rb") as file:
        existing = plistlib.load(file)
    existing["BasiraSubscriptionProductIDs"] = ids
    # Deliberately never enable paid checkout on build configuration alone.
    # It requires audited, authenticated Apple transaction verification.
    existing["BasiraStoreKitCheckoutEnabled"] = False
    with tempfile.NamedTemporaryFile(dir=plist.parent, delete=False) as temp:
        temporary = Path(temp.name)
        plistlib.dump(existing, temp, sort_keys=False)
    try:
        temporary.chmod(plist.stat().st_mode)
        temporary.replace(plist)
    finally:
        if temporary.exists():
            temporary.unlink()
    return ids

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--plist", type=Path,
                        default=Path("ios/DepthCalibrationLab/DepthCalibrationLab/Info.plist"))
    args = parser.parse_args()
    try:
        ids = configure(args.plist, os.getenv("BASIRA_IOS_APPLE_PRODUCT_IDS", ""))
    except (ValueError, OSError, plistlib.InvalidFileException):
        print("ERROR: Invalid Apple product ID configuration", file=sys.stderr)
        return 1
    print(f"StoreKit product discovery configured for {len(ids)} products; paid checkout remains disabled.")
    return 0

if __name__ == "__main__":
    sys.exit(main())
