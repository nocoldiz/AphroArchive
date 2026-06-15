#!/usr/bin/env python3
"""
decrypt_vault.py — Manually decrypt an AphroArchive vault.

Prompts for the vault password, derives the key exactly the way the app does,
and decrypts every `.enc` file in the vault folder into `<videos>/decrypted/`.

This is a recovery / export tool. It is read-only with respect to the vault:
it never deletes or rewrites the encrypted files or the metadata.

Crypto (matches server/vault-server.js + server/db-server.js):
  key       = PBKDF2-HMAC-SHA512(password, salt, iterations, dkLen=32)
  verifyKey = PBKDF2-HMAC-SHA512(password, salt + ":verify", iterations, 32)
  .enc file = [12-byte IV][AES-256-GCM ciphertext][16-byte auth tag]
  vault meta string (if encrypted) = JSON {iv, tag, ciphertext} (base64), AES-256-GCM

The vault config (`.vault-config.json`) supplies the salt and (optionally) the
iteration count. Configs written before the 600k-iteration upgrade have no
`iterations` field and use the legacy 100000.

Requires: pip install cryptography
"""

import argparse
import hashlib
import hmac
import json
import os
import sys
from getpass import getpass

try:
    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
except ImportError:
    sys.exit("Missing dependency. Run:  pip install cryptography")

LEGACY_ITERATIONS = 100000        # PBKDF2_ITERATIONS_LEGACY
IV_LEN = 12
TAG_LEN = 16
CHUNK = 1024 * 1024               # 1 MiB streaming chunks


# ── Key derivation ────────────────────────────────────────────────────
def derive_key(password: str, salt: str, iterations: int) -> bytes:
    return hashlib.pbkdf2_hmac("sha512", password.encode("utf-8"),
                               salt.encode("utf-8"), iterations, dklen=32)


def verify_hash(password: str, salt: str, iterations: int) -> str:
    h = hashlib.pbkdf2_hmac("sha512", password.encode("utf-8"),
                            (salt + ":verify").encode("utf-8"), iterations, dklen=32)
    return h.hex()


# ── Metadata ──────────────────────────────────────────────────────────
def load_meta(meta_path: str, key: bytes) -> dict:
    """Return the vault meta map, decrypting it if stored as {iv,tag,ciphertext}."""
    try:
        with open(meta_path, "r", encoding="utf-8") as f:
            raw = f.read()
    except OSError:
        return {}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    if isinstance(parsed, dict) and {"iv", "tag", "ciphertext"} <= parsed.keys() \
            and all(isinstance(parsed[k], str) for k in ("iv", "tag", "ciphertext")):
        # Encrypted wrapper — decrypt it.
        import base64
        iv = base64.b64decode(parsed["iv"])
        tag = base64.b64decode(parsed["tag"])
        ct = base64.b64decode(parsed["ciphertext"])
        dec = Cipher(algorithms.AES(key), modes.GCM(iv, tag)).decryptor()
        try:
            text = dec.update(ct) + dec.finalize()
        except Exception:
            print("  ! Could not decrypt vault metadata (names will be unavailable).")
            return {}
        return json.loads(text.decode("utf-8"))
    return parsed  # legacy / corrupted cleartext


# ── Extension sniffing for files whose metadata was lost ──────────────
def sniff_ext(head: bytes) -> str:
    if len(head) >= 12 and head[4:8] == b"ftyp":
        return ".mp4"
    if head[:4] == b"\x1a\x45\xdf\xa3":
        return ".webm" if b"webm" in head[:64] else ".mkv"
    if head[:4] == b"RIFF" and head[8:12] == b"AVI ":
        return ".avi"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return ".webp"
    if head[:3] == b"\xff\xd8\xff":
        return ".jpg"
    if head[:8] == b"\x89PNG\r\n\x1a\n":
        return ".png"
    if head[:4] == b"%PDF":
        return ".pdf"
    if head[:3] == b"ID3" or (len(head) > 1 and head[0] == 0xFF and (head[1] & 0xE0) == 0xE0):
        return ".mp3"
    return ".mp4"  # vault is overwhelmingly video; safest default


def unique_path(path: str) -> str:
    if not os.path.exists(path):
        return path
    base, ext = os.path.splitext(path)
    i = 1
    while os.path.exists(f"{base} ({i}){ext}"):
        i += 1
    return f"{base} ({i}){ext}"


# ── Streaming decrypt of one .enc file ────────────────────────────────
def decrypt_file(enc_path: str, key: bytes, out_dir: str, entry: dict, file_id: str):
    size = os.path.getsize(enc_path)
    if size < IV_LEN + TAG_LEN:
        raise ValueError("file too small to be a valid vault blob")
    ct_len = size - IV_LEN - TAG_LEN

    with open(enc_path, "rb") as f:
        iv = f.read(IV_LEN)
        f.seek(size - TAG_LEN)
        tag = f.read(TAG_LEN)

        dec = Cipher(algorithms.AES(key), modes.GCM(iv, tag)).decryptor()

        # Resolve destination. If metadata survived, honour the original name
        # and category folder; otherwise fall back to the vault id + sniffed ext.
        category = (entry or {}).get("category") or ""
        target_dir = out_dir
        if category:
            safe_cat = category.replace("\\", "/").strip("/")
            target_dir = os.path.join(out_dir, *[p for p in safe_cat.split("/") if p])
        os.makedirs(target_dir, exist_ok=True)

        tmp_path = os.path.join(target_dir, file_id + ".part")
        head = b""
        remaining = ct_len
        f.seek(IV_LEN)
        with open(tmp_path, "wb") as out:
            while remaining > 0:
                chunk = f.read(min(CHUNK, remaining))
                if not chunk:
                    raise ValueError("unexpected end of file")
                remaining -= len(chunk)
                plain = dec.update(chunk)
                if len(head) < 64:
                    head += plain[:64 - len(head)]
                out.write(plain)
            out.write(dec.finalize())  # raises if the auth tag / password is wrong

    # Decide final name now that decryption verified.
    if entry and entry.get("originalName"):
        name = entry["originalName"]
    elif entry and entry.get("name"):
        name = entry["name"] + (entry.get("ext") or sniff_ext(head))
    else:
        name = file_id + sniff_ext(head)

    final_path = unique_path(os.path.join(target_dir, name))
    os.replace(tmp_path, final_path)
    return final_path


# ── Main ──────────────────────────────────────────────────────────────
def main():
    ap = argparse.ArgumentParser(description="Decrypt an AphroArchive vault to a plain folder.")
    ap.add_argument("--data-dir", default=r"E:\AphroArchive",
                    help="Install data dir; vault/cache/output are derived from it (default: E:\\AphroArchive)")
    ap.add_argument("--vault-dir", help="Folder holding the .enc files (default: <data-dir>\\videos\\hidden)")
    ap.add_argument("--cache-dir", help="Folder with .vault-config.json / .vault-meta.json (default: <data-dir>\\cache)")
    ap.add_argument("--out-dir", help="Where to write decrypted files (default: <data-dir>\\videos\\decrypted)")
    args = ap.parse_args()

    vault_dir = args.vault_dir or os.path.join(args.data_dir, "videos", "hidden")
    cache_dir = args.cache_dir or os.path.join(args.data_dir, "cache")
    out_dir = args.out_dir or os.path.join(args.data_dir, "videos", "decrypted")
    config_path = os.path.join(cache_dir, ".vault-config.json")
    meta_path = os.path.join(cache_dir, ".vault-meta.json")

    if not os.path.isdir(vault_dir):
        sys.exit(f"Vault folder not found: {vault_dir}")
    if not os.path.isfile(config_path):
        sys.exit(f"Vault config not found: {config_path}")

    with open(config_path, "r", encoding="utf-8") as f:
        cfg = json.load(f)
    salt = cfg["salt"]
    iterations = int(cfg.get("iterations") or LEGACY_ITERATIONS)

    enc_files = sorted(p for p in os.listdir(vault_dir) if p.endswith(".enc"))
    if not enc_files:
        sys.exit(f"No .enc files in {vault_dir}")

    print(f"Vault:   {vault_dir}")
    print(f"Output:  {out_dir}")
    print(f"Files:   {len(enc_files)} encrypted blob(s)")
    print(f"KDF:     PBKDF2-SHA512, {iterations} iterations, salt={salt!r}\n")

    # Read interactively from the console, but accept a piped password when
    # stdin isn't a terminal (scripting / automation; also works on Windows
    # where getpass would otherwise ignore a pipe and block).
    if sys.stdin is not None and not sys.stdin.isatty():
        password = sys.stdin.readline().rstrip("\r\n")
    else:
        password = getpass("Vault password: ")
    if cfg.get("verifyHash"):
        if not hmac.compare_digest(verify_hash(password, salt, iterations), cfg["verifyHash"]):
            sys.exit("Wrong password (verification hash mismatch). Nothing decrypted.")
        print("Password verified.\n")
    key = derive_key(password, salt, iterations)

    meta = load_meta(meta_path, key)
    named = sum(1 for v in meta.values() if isinstance(v, dict) and v.get("originalName"))
    print(f"Metadata recovered for {named} file(s); the rest keep their vault id as name.\n")

    os.makedirs(out_dir, exist_ok=True)
    ok = 0
    failed = []
    for i, fname in enumerate(enc_files, 1):
        file_id = fname[:-4]  # strip .enc
        entry = meta.get(file_id) if isinstance(meta.get(file_id), dict) else None
        label = (entry or {}).get("originalName") or file_id
        print(f"[{i}/{len(enc_files)}] {label} ... ", end="", flush=True)
        try:
            dest = decrypt_file(os.path.join(vault_dir, fname), key, out_dir, entry, file_id)
            ok += 1
            print(f"OK -> {os.path.relpath(dest, out_dir)}")
        except Exception as e:
            failed.append((fname, str(e)))
            print(f"FAILED ({e})")

    print(f"\nDone. {ok} decrypted, {len(failed)} failed.")
    if failed:
        print("Failures (likely truncated/corrupted during the interrupted encrypt):")
        for fname, err in failed:
            print(f"  - {fname}: {err}")


if __name__ == "__main__":
    main()
