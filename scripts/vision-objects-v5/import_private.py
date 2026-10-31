"""Import the owner's own phone photos into a PRIVATE local review cohort. Nothing leaves this machine.
- re-encodes every photo as JPEG without any metadata (EXIF/GPS/device/time are dropped) after applying the orientation
- names photos by a hash prefix (no original filenames), caps the long side at 1600 px
- writes manifest.json in the same shape the review tools read; split is "private"
Usage: import_private.py <input-folder> <output-cohort-dir> [--max 30]
Supports JPEG/PNG/WebP; HEIC needs pillow-heif (if absent the file is skipped and reported: export as JPEG instead).
The output folder must not exist yet and must live OUTSIDE the Git repository.
"""
import hashlib
import json
import sys
from pathlib import Path

from PIL import Image, ImageOps

try:
    import pillow_heif  # type: ignore

    pillow_heif.register_heif_opener()
    HEIC = True
except Exception:
    HEIC = False


def main():
    src, dst = Path(sys.argv[1]), Path(sys.argv[2])
    limit = int(sys.argv[sys.argv.index("--max") + 1]) if "--max" in sys.argv else 30
    repo = Path(__file__).resolve().parents[2]
    if repo in dst.resolve().parents or dst.resolve() == repo:
        raise SystemExit("refusing: the private cohort must live outside the Git repository")
    if dst.exists():
        raise SystemExit("refusing to overwrite an existing folder: " + str(dst))
    (dst / "images").mkdir(parents=True)
    samples, skipped = [], []
    for f in sorted(p for p in src.iterdir() if p.is_file()):
        if len(samples) >= limit:
            break
        ext = f.suffix.lower()
        if ext in (".heic", ".heif") and not HEIC:
            skipped.append((f.name, "HEIC needs pillow-heif; export the photo as JPEG"))
            continue
        if ext not in (".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif"):
            continue
        try:
            image = ImageOps.exif_transpose(Image.open(f)).convert("RGB")
        except Exception as e:  # unreadable file
            skipped.append((f.name, type(e).__name__))
            continue
        image.thumbnail((1600, 1600))
        digest = hashlib.sha256(image.tobytes()).hexdigest()[:10]
        sample_id = "priv-" + digest
        out = dst / "images" / (sample_id + ".jpg")
        image.save(out, "JPEG", quality=92, optimize=True)  # no exif= argument: metadata is not written
        samples.append({"id": sample_id, "path": "images/" + sample_id + ".jpg", "split": "private", "width": image.width, "height": image.height, "objects": [], "referenceDocument": None})
    (dst / "manifest.json").write_text(json.dumps({"schemaVersion": 1, "scope": "PRIVATE_OWNER_PHOTOS_LOCAL_ONLY", "samples": samples}, indent=1), encoding="utf-8")
    print(json.dumps({"imported": len(samples), "skipped": skipped, "out": str(dst)}, ensure_ascii=False))


main()
