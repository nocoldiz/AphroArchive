#!/usr/bin/env python3
"""
AphroArchive Local Image Generation Engine
Communicates with Node.js via stdin/stdout JSON protocol.

Stdin (one JSON per line):
  {"action":"generate", "model":"...", ...}
  {"action":"cancel"}
  {"action":"quit"}
  {"action":"ping"}

Stdout (one JSON per line):
  {"type":"ready","device":"cuda"}
  {"type":"loading","model":"..."}
  {"type":"model_loaded","model":"...","device":"..."}
  {"type":"progress","step":5,"total":20,"pct":25,"combo_idx":0,"combo_total":1}
  {"type":"done","paths":[...],"prompts":[...],"seed":12345,"elapsed":8.5}
  {"type":"cancelled"}
  {"type":"error","message":"..."}
  {"type":"warning","message":"..."}
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
import threading
import traceback
import random as _random
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except AttributeError:
    pass


def send(obj: dict) -> None:
    print(json.dumps(obj, ensure_ascii=False), flush=True)


# ── Dependency check ──────────────────────────────────────────────────

_missing: list[str] = []
try:
    import torch
except ImportError:
    _missing.append('torch')

try:
    from diffusers import (
        StableDiffusionPipeline, StableDiffusionXLPipeline,
        AutoencoderKL,
        EulerDiscreteScheduler, EulerAncestralDiscreteScheduler,
        DPMSolverMultistepScheduler, DPMSolverSDEScheduler,
        DDIMScheduler, LCMScheduler, UniPCMultistepScheduler,
    )
except ImportError:
    _missing.append('diffusers')

try:
    from PIL import Image, PngImagePlugin
except ImportError:
    _missing.append('Pillow')

HAS_DEPS = not _missing

SCHEDULERS: dict = {}
if HAS_DEPS:
    SCHEDULERS = {
        'euler':    EulerDiscreteScheduler,
        'euler_a':  EulerAncestralDiscreteScheduler,
        'dpm++_2m': DPMSolverMultistepScheduler,
        'dpm++_sde':DPMSolverSDEScheduler,
        'ddim':     DDIMScheduler,
        'lcm':      LCMScheduler,
        'unipc':    UniPCMultistepScheduler,
    }

# ── Global state ──────────────────────────────────────────────────────

pipeline    = None
loaded_key  = None   # (model_path, model_type, vae_path)
cancel_event = threading.Event()


def get_device() -> str:
    if not HAS_DEPS:
        return 'cpu'
    if torch.cuda.is_available():
        return 'cuda'
    if hasattr(torch.backends, 'mps') and torch.backends.mps.is_available():
        return 'mps'
    return 'cpu'


def get_dtype():
    device = get_device()
    return torch.float16 if device in ('cuda', 'mps') else torch.float32


# ── Wildcard resolution ───────────────────────────────────────────────

def _load_wildcard_lines(wildcards_dir: str, name: str) -> list[str]:
    """Load non-empty, non-comment lines from a wildcard file."""
    candidates = [
        os.path.join(wildcards_dir, name + '.txt'),
        os.path.join(wildcards_dir, name.lower() + '.txt'),
    ]
    # Also search subdirectories
    base = name.split('/')[-1].split('\\')[-1]
    for root, _, files in os.walk(wildcards_dir):
        for f in files:
            if f.lower() == base.lower() + '.txt':
                candidates.append(os.path.join(root, f))

    for path in candidates:
        if os.path.exists(path):
            try:
                with open(path, encoding='utf-8') as fh:
                    lines = [l.strip() for l in fh if l.strip() and not l.startswith('#')]
                if lines:
                    return lines
            except OSError:
                pass
    return [f'__{name}__']   # return unchanged if not found


def resolve_wildcards(prompt: str, wildcards_dir: str, rng: _random.Random) -> tuple[str, list[str]]:
    """
    Replace __name__ tokens with a random line from wildcards/name.txt.
    Returns (resolved_prompt, list_of_chosen_values).
    Supports nested wildcards (up to 10 levels deep).
    """
    chosen: list[str] = []
    if not wildcards_dir or '__' not in prompt:
        return prompt, chosen

    pattern = re.compile(r'__([a-zA-Z0-9_/\\\-]+)__')

    for _ in range(10):   # max nesting depth
        def _replace(m: re.Match) -> str:
            name = m.group(1)
            options = _load_wildcard_lines(wildcards_dir, name)
            pick = rng.choice(options)
            chosen.append(f'{name}={pick}')
            return pick

        new_prompt = pattern.sub(_replace, prompt)
        if new_prompt == prompt:
            break
        prompt = new_prompt

    return prompt, chosen


# ── Combinatorial expansion ───────────────────────────────────────────

def expand_combinatorial(prompt: str) -> list[str]:
    """
    Expand {a|b|c} groups into all combinations.
    {red|blue} cat → ['red cat', 'blue cat']
    Nested groups are NOT supported for simplicity.
    """
    m = re.search(r'\{([^{}]+)\}', prompt)
    if not m:
        return [prompt]
    options = [o.strip() for o in m.group(1).split('|')]
    results = []
    for opt in options:
        expanded = prompt[: m.start()] + opt + prompt[m.end() :]
        results.extend(expand_combinatorial(expanded))
    return results


def count_combinations(prompt: str) -> int:
    """Count how many images a combinatorial prompt would produce."""
    total = 1
    for m in re.finditer(r'\{([^{}]+)\}', prompt):
        total *= len(m.group(1).split('|'))
    return total


# ── Model loading ─────────────────────────────────────────────────────

def _load_pipeline(model_path: str, model_type: str, vae_path: str | None) -> None:
    global pipeline, loaded_key

    key = (model_path, model_type, vae_path)
    if loaded_key == key and pipeline is not None:
        return

    send({'type': 'loading', 'model': os.path.basename(model_path)})

    device = get_device()
    dtype  = get_dtype()
    kwargs: dict = {'torch_dtype': dtype}

    if model_type != 'sdxl':
        kwargs['safety_checker'] = None

    if vae_path and os.path.exists(vae_path):
        try:
            vae = AutoencoderKL.from_single_file(vae_path, torch_dtype=dtype)
            kwargs['vae'] = vae
        except Exception as e:
            send({'type': 'warning', 'message': f'VAE load failed: {e}'})

    if model_type == 'sdxl':
        pipe = StableDiffusionXLPipeline.from_single_file(model_path, **kwargs)
    else:
        pipe = StableDiffusionPipeline.from_single_file(model_path, **kwargs)

    pipe = pipe.to(device)
    pipe.enable_attention_slicing()
    try:
        pipe.enable_xformers_memory_efficient_attention()
    except Exception:
        pass

    pipeline  = pipe
    loaded_key = key
    send({'type': 'model_loaded', 'model': os.path.basename(model_path), 'device': device})


def _apply_loras(lora_paths: list[str], strengths: list[float]) -> None:
    if not pipeline or not lora_paths:
        return
    for lp, strength in zip(lora_paths, strengths):
        if not os.path.exists(lp):
            send({'type': 'warning', 'message': f'LoRA not found: {lp}'})
            continue
        try:
            name = Path(lp).stem
            pipeline.load_lora_weights(lp, adapter_name=name)
            pipeline.fuse_lora(lora_scale=strength)
        except Exception as e:
            send({'type': 'warning', 'message': f'LoRA failed ({Path(lp).stem}): {e}'})


# ── Generation ────────────────────────────────────────────────────────

def _generate_one(
    prompt_text: str,
    negative: str | None,
    width: int,
    height: int,
    steps: int,
    cfg: float,
    sampler: str,
    seed: int,
    batch: int,
    output_dir: str,
    model_path: str,
    combo_idx: int,
    combo_total: int,
) -> list[str]:
    """Generate images for one resolved prompt. Returns list of saved paths."""
    import torch

    sched_cls = SCHEDULERS.get(sampler, EulerDiscreteScheduler)
    pipeline.scheduler = sched_cls.from_config(pipeline.scheduler.config)

    generator = torch.Generator(device=get_device()).manual_seed(seed)

    def on_step(pipe, i, t, cb):
        if cancel_event.is_set():
            pipe._interrupt = True
        pct = round((i + 1) / steps * 100)
        send({'type': 'progress', 'step': i + 1, 'total': steps, 'pct': pct,
              'combo_idx': combo_idx, 'combo_total': combo_total})
        return cb

    result = pipeline(
        prompt=prompt_text,
        negative_prompt=negative,
        width=width, height=height,
        num_inference_steps=steps,
        guidance_scale=cfg,
        num_images_per_prompt=batch,
        generator=generator,
        callback_on_step_end=on_step,
    )

    if cancel_event.is_set():
        return []

    paths: list[str] = []
    for i, img in enumerate(result.images):
        ts    = int(time.time() * 1000)
        fname = f'aphro_{ts}_{combo_idx}_{i}.png'
        fpath = os.path.join(output_dir, fname)
        meta  = PngImagePlugin.PngInfo()
        meta.add_text('parameters',
            f'{prompt_text}\n'
            f'Negative prompt: {negative or ""}\n'
            f'Steps: {steps}, Sampler: {sampler}, CFG scale: {cfg}, '
            f'Seed: {seed + i}, Size: {width}x{height}, '
            f'Model: {os.path.basename(model_path)}'
        )
        img.save(fpath, pnginfo=meta)
        paths.append(fpath)
    return paths


def _generate(job: dict) -> None:
    global pipeline
    cancel_event.clear()

    model_path    = job['model']
    model_type    = job.get('model_type', 'sd15')
    vae_path      = job.get('vae') or None
    raw_prompt    = job.get('prompt', '')
    negative      = job.get('negative', '') or None
    width         = int(job.get('width', 512))
    height        = int(job.get('height', 768))
    steps         = int(job.get('steps', 20))
    cfg           = float(job.get('cfg', 7.5))
    sampler       = job.get('sampler', 'euler')
    seed          = int(job.get('seed', -1))
    batch         = max(1, min(int(job.get('batch', 1)), 8))
    output_dir    = job['output_dir']
    loras         = job.get('loras', [])
    lora_str      = job.get('lora_strengths', [1.0] * len(loras))
    wildcards_dir = job.get('wildcards_dir', '')
    combinatorial = bool(job.get('combinatorial', False))

    if seed < 0:
        seed = _random.randint(0, 2**32 - 1)

    _load_pipeline(model_path, model_type, vae_path)
    if cancel_event.is_set():
        send({'type': 'cancelled'})
        return

    if loras:
        _apply_loras(loras, lora_str)

    # Expand combinatorial first, then resolve wildcards per combination
    if combinatorial:
        combo_prompts = expand_combinatorial(raw_prompt)
    else:
        combo_prompts = [raw_prompt]

    combo_total = len(combo_prompts)
    all_paths:   list[str] = []
    all_prompts: list[str] = []
    start = time.time()

    os.makedirs(output_dir, exist_ok=True)

    for idx, combo in enumerate(combo_prompts):
        if cancel_event.is_set():
            send({'type': 'cancelled'})
            return

        rng = _random.Random(seed + idx)
        resolved, _ = resolve_wildcards(combo, wildcards_dir, rng)
        all_prompts.append(resolved)

        combo_seed = seed + idx * batch
        try:
            paths = _generate_one(
                prompt_text=resolved,
                negative=negative,
                width=width, height=height,
                steps=steps, cfg=cfg,
                sampler=sampler, seed=combo_seed,
                batch=batch, output_dir=output_dir,
                model_path=model_path,
                combo_idx=idx, combo_total=combo_total,
            )
            all_paths.extend(paths)
        except RuntimeError as e:
            if cancel_event.is_set():
                send({'type': 'cancelled'})
                return
            raise

    elapsed = round(time.time() - start, 1)
    send({'type': 'done', 'paths': all_paths, 'prompts': all_prompts,
          'seed': seed, 'elapsed': elapsed, 'count': len(all_paths)})


# ── Main loop ─────────────────────────────────────────────────────────

def main() -> None:
    if _missing:
        send({'type': 'error', 'message': (
            f'Missing: {", ".join(_missing)}. '
            'Run: pip install torch diffusers transformers accelerate '
            'safetensors Pillow   (add xformers for less VRAM)'
        )})
        sys.exit(1)

    send({'type': 'ready', 'device': get_device()})

    for raw in sys.stdin:
        raw = raw.strip()
        if not raw:
            continue
        try:
            job = json.loads(raw)
        except json.JSONDecodeError:
            continue

        action = job.get('action', '')

        if action == 'generate':
            try:
                _generate(job)
            except Exception as e:
                send({'type': 'error', 'message': str(e), 'traceback': traceback.format_exc()})

        elif action == 'cancel':
            cancel_event.set()
            send({'type': 'cancelled'})

        elif action == 'quit':
            break

        elif action == 'ping':
            send({'type': 'pong', 'device': get_device()})


if __name__ == '__main__':
    main()
