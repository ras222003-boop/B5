"""Validate and inject the owner's approved public origin; never contact a host."""
import argparse
import os
from pathlib import Path
import plistlib
import re
import sys
import tempfile
from urllib.parse import urlsplit


def validate_origin(value):
    try:
        parts = urlsplit(value)
        host = (parts.hostname or "").lower()
        labels = host.split(".")
        if (
            value != value.strip() or any(c.isspace() for c in value)
            or any(c in value for c in "?#%\\")
            or parts.scheme.lower() != "https"
            or parts.netloc.lower() != host
            or parts.path not in ("", "/")
            or len(host) > 253 or len(labels) < 2
            or not any(c.isalpha() for c in host)
            or host.endswith((".localhost", ".local", ".example", ".invalid", ".test"))
            or any(not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", label) for label in labels)
        ):
            return None
        return "https://" + host
    except ValueError:
        return None


def configure(plist, origin, required):
    if required not in ("true", "false"):
        raise ValueError("BASIRA_REQUIRE_WEB_ORIGIN must be true or false.")
    canonical = validate_origin(origin) if origin else None
    if (origin and canonical is None) or (required == "true" and canonical is None):
        raise ValueError("An owner-verified public HTTPS origin is required.")
    with plist.open("rb") as source:
        data = plistlib.load(source)
    # Clear cached values when an offline build supplies no origin.
    data["BasiraWebBaseURL"] = canonical or ""
    # The signed-build workflow injects the exact checkout SHA afterward.
    # Never inherit a release identity from a previous local build.
    data["BasiraWebReleaseSHA"] = ""
    data["BasiraVisionURL"] = canonical + "/navigation/vision" if canonical else ""
    data["BasiraLabURL"] = canonical + "/navigation/native-vision" if canonical else ""
    temp = None
    try:
        with tempfile.NamedTemporaryFile(dir=plist.parent, delete=False) as target:
            temp = Path(target.name)
            plistlib.dump(data, target, sort_keys=False)
        os.chmod(temp, plist.stat().st_mode)
        temp.replace(plist)
    finally:
        if temp is not None and temp.exists():
            temp.unlink()
    return canonical


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--plist", type=Path, default=Path("ios/DepthCalibrationLab/DepthCalibrationLab/Info.plist"))
    args = parser.parse_args()
    try:
        configured = configure(args.plist, os.environ.get("BASIRA_IOS_WEB_ORIGIN", ""), os.environ.get("BASIRA_REQUIRE_WEB_ORIGIN", "false"))
    except (ValueError, OSError, plistlib.InvalidFileException):
        # Do not echo a mistyped URL that may contain credentials.
        print("ERROR: Basira web-origin configuration rejected; check the approved HTTPS origin, requirement flag and Info.plist.", file=sys.stderr)
        return 1
    print("Configured approved Basira web origin." if configured else "Basira web modules disabled; no verified HTTPS origin supplied.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
