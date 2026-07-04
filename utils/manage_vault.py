#!/usr/bin/env python3
"""
manage_vault.py — Manage an AphroArchive vault.

Offers two operations:
  1. Encrypt — take plain files already in the vault folder (videos/hidden/)
     and encrypt them in place as <uuid>.enc, registering each entry in the
     vault meta so the app can read them immediately.
  2. Decrypt — take .enc files in the vault folder and restore the plain
     originals in place, removing each entry from vault meta.

Files skipped during encrypt: .json, .enc, dot-files.
Source thumbnails are removed from the cache after both operations.

Crypto (matches vault-server.js + db-server.js exactly):
  key       = PBKDF2-HMAC-SHA512(password, salt, iterations, dkLen=32)
  .enc file = [12-byte IV][AES-256-GCM ciphertext][16-byte auth tag]
  vault meta = JSON { "<uuid>": { originalName, name, ext, size, sizeF,
                                   mtime, folder, type } }
  vault meta on disk may itself be AES-256-GCM encrypted:
               { iv, tag, ciphertext }  (all base64)

Requires:  pip install cryptography
"""

import argparse
import base64
import hashlib
import hmac as _hmac
import json
import math
import os
import secrets
import shutil
import sys
import uuid
from getpass import getpass

try:
    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
except ImportError:
    sys.exit("Missing dependency.  Run:  pip install cryptography")

LEGACY_ITERATIONS  = 100_000
CURRENT_ITERATIONS = 600_000
IV_LEN  = 12
TAG_LEN = 16
CHUNK   = 1024 * 1024  # 1 MiB streaming chunks


# ── Utility helpers ───────────────────────────────────────────────────

def derive_key(password: str, salt: str, iterations: int) -> bytes:
    return hashlib.pbkdf2_hmac(
        "sha512", password.encode("utf-8"), salt.encode("utf-8"),
        iterations, dklen=32,
    )


def make_verify_hash(password: str, salt: str, iterations: int) -> str:
    return hashlib.pbkdf2_hmac(
        "sha512", password.encode("utf-8"),
        (salt + ":verify").encode("utf-8"), iterations, dklen=32,
    ).hex()


def format_bytes(b: int) -> str:
    if b == 0:
        return "0 B"
    units = ["B", "KB", "MB", "GB", "TB"]
    i = min(int(math.floor(math.log(max(b, 1), 1024))), len(units) - 1)
    return f"{b / (1024 ** i):.1f} {units[i]}"


def to_id(rel_path: str) -> str:
    """Replicate server helpers-server.js toId: base64url of the path bytes."""
    return base64.urlsafe_b64encode(rel_path.encode("utf-8")).rstrip(b"=").decode("ascii")


def unique_path(p: str) -> str:
    if not os.path.exists(p):
        return p
    base, ext = os.path.splitext(p)
    i = 1
    while os.path.exists(f"{base} ({i}){ext}"):
        i += 1
    return f"{base} ({i}){ext}"


# ── Vault meta (read / write) ─────────────────────────────────────────

def _is_enc_wrapper(obj) -> bool:
    return (isinstance(obj, dict)
            and {"iv", "tag", "ciphertext"} <= obj.keys()
            and all(isinstance(obj[k], str) for k in ("iv", "tag", "ciphertext")))


def load_meta(meta_path: str, key: bytes) -> dict:
    try:
        raw = open(meta_path, "r", encoding="utf-8").read()
    except OSError:
        return {}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    if _is_enc_wrapper(parsed):
        if not key:
            print("  ! Vault meta is encrypted but no key — treating as empty.")
            return {}
        iv  = base64.b64decode(parsed["iv"])
        tag = base64.b64decode(parsed["tag"])
        ct  = base64.b64decode(parsed["ciphertext"])
        dec = Cipher(algorithms.AES(key), modes.GCM(iv, tag)).decryptor()
        try:
            text = dec.update(ct) + dec.finalize()
        except Exception:
            print("  ! Could not decrypt vault metadata.")
            return {}
        return json.loads(text.decode("utf-8"))
    return parsed  # cleartext / legacy


def _meta_encrypted_on_disk(meta_path: str) -> bool:
    try:
        return _is_enc_wrapper(json.loads(open(meta_path, "r", encoding="utf-8").read()))
    except Exception:
        return False


def save_meta(meta_path: str, meta: dict, key: bytes):
    json_str = json.dumps(meta)
    if key:
        iv  = os.urandom(IV_LEN)
        enc = Cipher(algorithms.AES(key), modes.GCM(iv)).encryptor()
        ct  = enc.update(json_str.encode("utf-8")) + enc.finalize()
        payload = {
            "iv":         base64.b64encode(iv).decode(),
            "tag":        base64.b64encode(enc.tag).decode(),
            "ciphertext": base64.b64encode(ct).decode(),
        }
        with open(meta_path, "w", encoding="utf-8") as f:
            json.dump(payload, f)
    else:
        with open(meta_path, "w", encoding="utf-8") as f:
            json.dump(meta, f)


# ── Thumbnails ────────────────────────────────────────────────────────

def remove_thumbs(thumbs_dir: str, file_id: str):
    d = os.path.join(thumbs_dir, file_id)
    if os.path.isdir(d):
        shutil.rmtree(d, ignore_errors=True)
        print(f"    removed thumbnails: {d}")


# ── File crypto ───────────────────────────────────────────────────────

def encrypt_file(src: str, dst: str, key: bytes):
    """AES-256-GCM encrypt src → dst.  Format: [12B IV][ciphertext][16B tag]."""
    part = dst + ".part"
    iv = os.urandom(IV_LEN)
    enc = Cipher(algorithms.AES(key), modes.GCM(iv)).encryptor()
    try:
        with open(src, "rb") as fin, open(part, "wb") as fout:
            fout.write(iv)
            while True:
                chunk = fin.read(CHUNK)
                if not chunk:
                    break
                fout.write(enc.update(chunk))
            fout.write(enc.finalize())
            fout.write(enc.tag)
        os.replace(part, dst)
    except Exception:
        try:
            os.remove(part)
        except OSError:
            pass
        raise


def decrypt_file(src: str, dst: str, key: bytes):
    """AES-256-GCM decrypt src (.enc) → dst.  Raises on wrong key / corrupt tag."""
    size = os.path.getsize(src)
    if size < IV_LEN + TAG_LEN:
        raise ValueError("file too small to be a valid vault blob")
    part = dst + ".part"
    with open(src, "rb") as f:
        iv = f.read(IV_LEN)
        f.seek(size - TAG_LEN)
        tag = f.read(TAG_LEN)
        dec = Cipher(algorithms.AES(key), modes.GCM(iv, tag)).decryptor()
        try:
            os.makedirs(os.path.dirname(dst) or ".", exist_ok=True)
            with open(part, "wb") as fout:
                remaining = size - IV_LEN - TAG_LEN
                f.seek(IV_LEN)
                while remaining > 0:
                    chunk = f.read(min(CHUNK, remaining))
                    if not chunk:
                        raise ValueError("unexpected end of file")
                    remaining -= len(chunk)
                    fout.write(dec.update(chunk))
                fout.write(dec.finalize())  # raises if auth tag is wrong
        except Exception:
            try:
                os.remove(part)
            except OSError:
                pass
            raise
    os.replace(part, dst)


# ── Encrypt mode ──────────────────────────────────────────────────────

def run_encrypt(vault_dir: str, meta_path: str, thumbs_dir: str,
                videos_dir: str, key: bytes):
    # Collect eligible files (skip .json, .enc, dot-files)
    to_encrypt = []
    for dirpath, _dirs, fnames in os.walk(vault_dir):
        for fname in fnames:
            if fname.startswith("."):
                continue
            ext = os.path.splitext(fname)[1].lower()
            if ext in (".json", ".enc"):
                continue
            to_encrypt.append(os.path.join(dirpath, fname))

    if not to_encrypt:
        print("No eligible files found to encrypt.")
        return

    print(f"\nFiles to encrypt: {len(to_encrypt)}\n")
    meta = load_meta(meta_path, key)
    ok, failed = 0, []

    for i, src_path in enumerate(to_encrypt, 1):
        fname = os.path.basename(src_path)
        print(f"[{i}/{len(to_encrypt)}] {fname} ... ", end="", flush=True)
        try:
            # Capture stats before any modifications
            stat    = os.stat(src_path)
            size    = stat.st_size
            mtime   = int(stat.st_mtime * 1000)  # ms timestamp like Node.js Date.now()
            ext     = os.path.splitext(fname)[1]
            name_ne = os.path.splitext(fname)[0]

            # Folder = path relative to vault_dir (None if directly inside vault_dir)
            rel_dir = os.path.relpath(os.path.dirname(src_path), vault_dir)
            folder  = None if rel_dir == "." else rel_dir.replace("\\", "/")

            file_uuid = str(uuid.uuid4())
            dst_path  = os.path.join(vault_dir, file_uuid + ".enc")

            encrypt_file(src_path, dst_path, key)
            os.remove(src_path)

            meta[file_uuid] = {
                "originalName": fname,
                "name":         name_ne,
                "ext":          ext,
                "size":         size,
                "sizeF":        format_bytes(size),
                "mtime":        mtime,
                "folder":       folder,
                "type":         "file",
            }

            # Remove thumbnails keyed by the source file's video-scanner ID
            # (toId of relative path from videos_dir) and by the new vault UUID.
            try:
                rel_vid = os.path.relpath(src_path, videos_dir).replace("\\", "/")
                remove_thumbs(thumbs_dir, to_id(rel_vid))
            except ValueError:
                pass  # src not under videos_dir — skip
            remove_thumbs(thumbs_dir, file_uuid)

            ok += 1
            print(f"OK  ({format_bytes(size)})")
        except Exception as e:
            failed.append((fname, str(e)))
            print(f"FAILED  ({e})")

    save_meta(meta_path, meta, key)
    print(f"\nDone. {ok} encrypted, {len(failed)} failed.")
    if failed:
        print("Failures:")
        for fname, err in failed:
            print(f"  - {fname}: {err}")


# ── Decrypt mode ──────────────────────────────────────────────────────

def run_decrypt(vault_dir: str, meta_path: str, thumbs_dir: str, key: bytes):
    meta = load_meta(meta_path, key)

    enc_files = []
    for dirpath, _dirs, fnames in os.walk(vault_dir):
        for fname in fnames:
            if fname.endswith(".enc"):
                enc_files.append((os.path.join(dirpath, fname), fname[:-4]))

    if not enc_files:
        print("No .enc files found.")
        return

    print(f"\nFiles to decrypt: {len(enc_files)}\n")
    ok, failed = 0, []

    for i, (enc_path, file_id) in enumerate(enc_files, 1):
        entry = meta.get(file_id) if isinstance(meta.get(file_id), dict) else None
        label = (entry or {}).get("originalName") or file_id
        print(f"[{i}/{len(enc_files)}] {label} ... ", end="", flush=True)
        try:
            original_name = (entry or {}).get("originalName") or (file_id + ".mp4")
            folder = (entry or {}).get("folder")

            if folder:
                out_dir = os.path.join(vault_dir,
                                       *[p for p in folder.replace("\\", "/").split("/") if p])
            else:
                out_dir = vault_dir

            dst_path = unique_path(os.path.join(out_dir, original_name))
            decrypt_file(enc_path, dst_path, key)
            os.remove(enc_path)

            # Remove vault thumbnails keyed by UUID
            remove_thumbs(thumbs_dir, file_id)

            meta.pop(file_id, None)
            ok += 1
            size = os.path.getsize(dst_path)
            print(f"OK  -> {os.path.relpath(dst_path, vault_dir)}  ({format_bytes(size)})")
        except Exception as e:
            failed.append((label, str(e)))
            print(f"FAILED  ({e})")

    save_meta(meta_path, meta, key)
    print(f"\nDone. {ok} decrypted, {len(failed)} failed.")
    if failed:
        print("Failures:")
        for label, err in failed:
            print(f"  - {label}: {err}")


# ── Entry point ───────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser(
        description="Encrypt or decrypt files in an AphroArchive vault folder in place.")
    ap.add_argument("--data-dir", default=r"E:\AphroArchive",
                    help="Install data dir (default: E:\\AphroArchive)")
    ap.add_argument("--vault-dir",
                    help="Vault folder holding files (default: <data-dir>\\videos\\hidden)")
    ap.add_argument("--cache-dir",
                    help="Cache dir with .vault-config.json (default: <data-dir>\\cache)")
    args = ap.parse_args()

    vault_dir  = args.vault_dir  or os.path.join(args.data_dir, "videos", "hidden")
    cache_dir  = args.cache_dir  or os.path.join(args.data_dir, "cache")
    videos_dir = os.path.join(args.data_dir, "videos")
    thumbs_dir = os.path.join(cache_dir, ".AphroArchive-thumbs")
    config_path = os.path.join(cache_dir, ".vault-config.json")
    meta_path   = os.path.join(cache_dir, ".vault-meta.json")

    print("=" * 50)
    print("  AphroArchive Vault Manager")
    print("=" * 50)
    print(f"  Vault : {vault_dir}")
    print(f"  Cache : {cache_dir}")
    print()

    # ── Choose operation ──────────────────────────────────────────────
    print("What would you like to do?")
    print("  1. Encrypt  (plain files → .enc)")
    print("  2. Decrypt  (.enc files → plain)")
    while True:
        choice = input("Choice [1/2]: ").strip()
        if choice in ("1", "2"):
            break
        print("  Please enter 1 or 2.")
    mode = "encrypt" if choice == "1" else "decrypt"
    print()

    if not os.path.isdir(vault_dir):
        sys.exit(f"Vault folder not found: {vault_dir}")

    # ── Load or create vault config ───────────────────────────────────
    cfg_exists = os.path.isfile(config_path)
    if cfg_exists:
        with open(config_path, "r", encoding="utf-8") as f:
            cfg = json.load(f)
        salt       = cfg["salt"]
        iterations = int(cfg.get("iterations") or LEGACY_ITERATIONS)
        print(f"Vault config: KDF PBKDF2-SHA512 × {iterations}, salt={salt!r}")
    elif mode == "encrypt":
        print("No vault config found — initialising a new vault.")
        salt       = secrets.token_hex(32)
        iterations = CURRENT_ITERATIONS
        cfg        = None
    else:
        sys.exit(f"Vault config not found: {config_path}\nCannot decrypt without it.")

    # ── Password ──────────────────────────────────────────────────────
    print()
    if sys.stdin is not None and not sys.stdin.isatty():
        password = sys.stdin.readline().rstrip("\r\n")
    else:
        password = getpass("Vault password: ")

    if cfg_exists and cfg.get("verifyHash"):
        expected = cfg["verifyHash"]
        actual   = make_verify_hash(password, salt, iterations)
        if not _hmac.compare_digest(actual, expected):
            sys.exit("Wrong password. Nothing was changed.")
        print("Password verified.\n")

    key = derive_key(password, salt, iterations)

    # Save config for a freshly initialised vault
    if not cfg_exists:
        new_cfg = {
            "salt":       salt,
            "iterations": iterations,
            "verifyHash": make_verify_hash(password, salt, iterations),
        }
        os.makedirs(cache_dir, exist_ok=True)
        with open(config_path, "w", encoding="utf-8") as f:
            json.dump(new_cfg, f)
        print(f"Vault config written: {config_path}\n")

    # ── Dispatch ──────────────────────────────────────────────────────
    if mode == "encrypt":
        run_encrypt(vault_dir, meta_path, thumbs_dir, videos_dir, key)
    else:
        run_decrypt(vault_dir, meta_path, thumbs_dir, key)


if __name__ == "__main__":
    main()
