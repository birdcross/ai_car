"""Multilingual sentence embeddings for vehicle manuals and Korean questions."""
from functools import lru_cache
import os
from pathlib import Path
from tempfile import gettempdir
from threading import Lock

REPOSITORY = "Xenova/multilingual-e5-small"
REVISION = "761b726dd34fb83930e26aab4e9ac3899aa1fa78"
MODEL_LOCK = Lock()


@lru_cache(maxsize=1)
def load_model():
    from huggingface_hub import hf_hub_download
    import onnxruntime as ort
    from tokenizers import Tokenizer

    def model_file(filename):
        cache = Path(gettempdir()) / "evlog-manual-model" if os.getenv("VERCEL") else None
        return hf_hub_download(REPOSITORY, filename, revision=REVISION, cache_dir=cache)

    tokenizer = Tokenizer.from_file(model_file("tokenizer.json"))
    tokenizer.enable_truncation(max_length=512)
    tokenizer.enable_padding()
    options = ort.SessionOptions()
    options.intra_op_num_threads = 2
    session = ort.InferenceSession(model_file("onnx/model_quantized.onnx"), options,
                                   providers=["CPUExecutionProvider"])
    return tokenizer, session


def embed(texts, *, query=False):
    import numpy as np

    with MODEL_LOCK:
        tokenizer, session = load_model()
    prefix = "query: " if query else "passage: "
    encoded = tokenizer.encode_batch([prefix + text for text in texts])
    inputs = {
        "input_ids": np.asarray([row.ids for row in encoded], dtype=np.int64),
        "attention_mask": np.asarray([row.attention_mask for row in encoded], dtype=np.int64),
        "token_type_ids": np.asarray([row.type_ids for row in encoded], dtype=np.int64),
    }
    mask = inputs["attention_mask"][..., None]
    states = session.run(None, {item.name: inputs[item.name] for item in session.get_inputs()})[0]
    vectors = (states * mask).sum(axis=1) / mask.sum(axis=1)
    vectors /= np.linalg.norm(vectors, axis=1, keepdims=True)
    return vectors.tolist()
