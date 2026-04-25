#!/usr/bin/env python3
# Voice-print enrollment + verification for Call Claude.
#
# Modes:
#   enroll <wav>   - generate Jason's reference voice embedding from <wav>
#                    and save it to ~/.call-claude/voice-id/reference.npy
#   verify <wav>   - print {isJason, similarity} as JSON. If no reference
#                    exists yet, returns isJason=true so we never block
#                    pre-enrollment.
#
# Embeddings are 256-dim from Resemblyzer (encoder pretrained on VoxCeleb).
import sys
import json
import os
import contextlib
from pathlib import Path

REF_PATH = Path.home() / ".call-claude" / "voice-id" / "reference.npy"
DEFAULT_THRESHOLD = float(os.environ.get("CALL_CLAUDE_VOICE_THRESHOLD", "0.62"))

def _encoder():
    # Lazy import so a missing dep gives a clean error message.
    # Resemblyzer prints "Loaded the voice encoder model on cpu in Xs" to
    # stdout on construction; we redirect that to stderr so the JSON we emit
    # at the end of enroll/verify is the only thing on stdout.
    from resemblyzer import VoiceEncoder
    with contextlib.redirect_stdout(sys.stderr):
        return VoiceEncoder()

def enroll(wav_path):
    import numpy as np
    from resemblyzer import preprocess_wav
    enc = _encoder()
    wav = preprocess_wav(wav_path)
    if len(wav) < 16000:  # need at least 1s of usable audio
        print(json.dumps({"ok": False, "error": "audio too short"}))
        return
    embed = enc.embed_utterance(wav)
    REF_PATH.parent.mkdir(parents=True, exist_ok=True)
    np.save(REF_PATH, embed)
    print(json.dumps({"ok": True, "embedding_dim": int(embed.shape[0])}))

def verify(wav_path, threshold=DEFAULT_THRESHOLD):
    import numpy as np
    from resemblyzer import preprocess_wav
    if not REF_PATH.exists():
        print(json.dumps({"isJason": True, "reason": "no_reference", "similarity": None}))
        return
    try:
        wav = preprocess_wav(wav_path)
    except Exception as e:
        print(json.dumps({"isJason": True, "reason": f"preprocess_failed:{e}", "similarity": None}))
        return
    if len(wav) < 8000:  # < 0.5s — too short to reliably ID
        print(json.dumps({"isJason": True, "reason": "too_short", "similarity": None}))
        return
    enc = _encoder()
    embed = enc.embed_utterance(wav)
    ref = np.load(REF_PATH)
    similarity = float(np.dot(embed, ref) / (np.linalg.norm(embed) * np.linalg.norm(ref)))
    is_jason = similarity >= threshold
    print(json.dumps({"isJason": bool(is_jason), "similarity": similarity, "threshold": threshold}))

if __name__ == "__main__":
    if len(sys.argv) < 3:
        sys.exit("usage: voice_id.py [enroll|verify] <wav>")
    mode, wav = sys.argv[1], sys.argv[2]
    if mode == "enroll": enroll(wav)
    elif mode == "verify": verify(wav)
    else: sys.exit(f"unknown mode: {mode}")
