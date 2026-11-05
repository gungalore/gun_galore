"""Local PaddleOCR-VL-1.6 service.

Run this beside the Nest backend. It loads the model once and exposes one
batched OCR endpoint, so an upload can send every Jev-located crop together.

    python -m pip install -r ocr/requirements.txt
    python ocr/paddleocr_vl_server.py

Environment:
    PADDLEOCR_VL_MODEL             default PaddlePaddle/PaddleOCR-VL-1.6
    PADDLEOCR_VL_MAX_NEW_TOKENS    default 128
    PADDLEOCR_VL_HOST              default 127.0.0.1
    PADDLEOCR_VL_PORT              default 8090
"""

from __future__ import annotations

import base64
import io
import os

import torch
import uvicorn
from fastapi import FastAPI
from PIL import Image
from pydantic import BaseModel, Field
from transformers import AutoModelForImageTextToText, AutoProcessor

MODEL_PATH = os.environ.get("PADDLEOCR_VL_MODEL", "PaddlePaddle/PaddleOCR-VL-1.6")
MAX_NEW_TOKENS = int(os.environ.get("PADDLEOCR_VL_MAX_NEW_TOKENS", "128"))
HOST = os.environ.get("PADDLEOCR_VL_HOST", "127.0.0.1")
PORT = int(os.environ.get("PADDLEOCR_VL_PORT", "8090"))

DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
DTYPE = torch.bfloat16 if DEVICE == "cuda" else torch.float32

app = FastAPI(title="PaddleOCR-VL-1.6 local OCR")

print(f"Loading {MODEL_PATH} on {DEVICE}...", flush=True)
model = (
    AutoModelForImageTextToText.from_pretrained(MODEL_PATH, torch_dtype=DTYPE)
    .to(DEVICE)
    .eval()
)
processor = AutoProcessor.from_pretrained(MODEL_PATH)
print("PaddleOCR-VL ready.", flush=True)


class OcrRequest(BaseModel):
    images: list[str] = Field(min_length=1)
    task: str = "ocr"


class OcrResponse(BaseModel):
    texts: list[str]


def _decode_image(data: str) -> Image.Image:
    raw = base64.b64decode(data)
    return Image.open(io.BytesIO(raw)).convert("RGB")


def _read(image: Image.Image) -> str:
    messages = [
        {
            "role": "user",
            "content": [
                {"type": "image", "image": image},
                {"type": "text", "text": "OCR:"},
            ],
        }
    ]
    inputs = processor.apply_chat_template(
        messages,
        add_generation_prompt=True,
        tokenize=True,
        return_dict=True,
        return_tensors="pt",
    ).to(model.device)
    if os.environ.get("PADDLEOCR_VL_DEBUG") == "1":
        print(
            "inputs="
            + str({key: tuple(value.shape) for key, value in inputs.items()}),
            flush=True,
        )
    with torch.inference_mode():
        outputs = model.generate(**inputs, max_new_tokens=MAX_NEW_TOKENS)
    generated = outputs[0][inputs["input_ids"].shape[-1] :]
    if os.environ.get("PADDLEOCR_VL_DEBUG") == "1":
        print(
            f"generated_tokens={len(generated)} eos={int(model.generation_config.eos_token_id or -1)}",
            flush=True,
        )
    return processor.decode(generated, skip_special_tokens=True).strip()


@app.get("/health")
def health() -> dict[str, object]:
    return {"ok": True, "model": MODEL_PATH, "device": DEVICE}


@app.post("/ocr", response_model=OcrResponse)
def ocr(request: OcrRequest) -> OcrResponse:
    texts: list[str] = []
    for encoded in request.images:
        try:
            texts.append(_read(_decode_image(encoded)))
        except Exception as exc:  # noqa: BLE001 - one bad crop must not fail the batch
            print(f"OCR crop failed: {exc!r}", flush=True)
            texts.append("")
    return OcrResponse(texts=texts)


if __name__ == "__main__":
    uvicorn.run(app, host=HOST, port=PORT)
