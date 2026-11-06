"""OnMe's try-on model: FASHN VTON v1.5 on a rented GPU on Modal.

One web endpoint. JSON with the two photos as base64 in, the generated PNG out:

    POST {"person": {"data": "<base64>", "mimeType": "image/png"},
          "outfit": {"data": "<base64>", "mimeType": "image/jpeg"}}
    -> 200 image/png

It sits behind Modal proxy auth (`requires_proxy_auth=True`), so it answers only a
caller that sends the workspace's `Modal-Key` and `Modal-Secret` headers — the
OnMe backend. The photos live in memory for one request; nothing is written.

FASHN needs a garment category and a garment photo type. The app asks for
neither: both are read from the human parser's segmentation of the outfit photo
(see `garment.py`).

License: FASHN VTON is Apache-2.0, but the human parser it runs on every request
inherits the NVIDIA Source Code License for SegFormer, which allows
non-commercial use only.

Deploy:  uvx --from modal modal deploy modal/onme_tryon.py
"""

import modal

FASHN_REPO = "https://github.com/fashn-AI/fashn-vton-1.5.git"
FASHN_COMMIT = "7c0f10af3f91ad4048fe9729c470a13ef905d25a"
WEIGHTS_DIR = "/weights"
HF_HOME = "/hf"


def download_weights():
    import subprocess

    subprocess.run(
        ["python", "/fashn/scripts/download_weights.py", "--weights-dir", WEIGHTS_DIR],
        check=True,
    )


image = (
    modal.Image.from_registry("nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04", add_python="3.11")
    .apt_install("git", "libgl1", "libglib2.0-0")
    .run_commands(
        f"git clone {FASHN_REPO} /fashn",
        f"cd /fashn && git checkout {FASHN_COMMIT}",
        "pip install -e /fashn 'fastapi[standard]'",
    )
    .env({"HF_HOME": HF_HOME})
    .run_function(download_weights)
    .add_local_python_source("garment")
)

app = modal.App("onme-tryon")


# A list is a fallback order: Modal takes the first GPU it has free, so a
# shortage of one type does not leave a try-on waiting minutes to start.
@app.cls(image=image, gpu=["L4", "A10G", "L40S"], scaledown_window=300, timeout=600)
class TryOn:
    @modal.enter()
    def load(self):
        from fashn_vton import TryOnPipeline

        self.pipeline = TryOnPipeline(weights_dir=WEIGHTS_DIR)

    def _decode(self, photo, name):
        import base64
        import io

        from fastapi import HTTPException
        from PIL import Image, ImageOps

        if not isinstance(photo, dict) or not isinstance(photo.get("data"), str):
            raise HTTPException(status_code=400, detail=f"{name} photo is missing")
        try:
            raw = base64.b64decode(photo["data"], validate=False)
            return ImageOps.exif_transpose(Image.open(io.BytesIO(raw))).convert("RGB")
        except Exception:
            raise HTTPException(status_code=400, detail=f"{name} photo is not an image")

    def _read_outfit(self, outfit):
        import numpy as np
        from fashn_human_parser import IDS_TO_LABELS

        from garment import choose_category, choose_photo_type

        labels = self.pipeline.hp_model.predict(np.array(outfit))
        ids, counts = np.unique(labels, return_counts=True)
        by_label = {IDS_TO_LABELS.get(int(i), "unknown"): int(c) for i, c in zip(ids, counts)}
        return choose_category(by_label), choose_photo_type(by_label, int(labels.size))

    @modal.fastapi_endpoint(method="POST", requires_proxy_auth=True)
    def tryon(self, body: dict):
        import io
        import time

        from fastapi import Response

        started = time.time()
        person = self._decode(body.get("person"), "person")
        outfit = self._decode(body.get("outfit"), "outfit")
        category, photo_type = self._read_outfit(outfit)

        result = self.pipeline(
            person_image=person,
            garment_image=outfit,
            category=category,
            garment_photo_type=photo_type,
        )

        out = io.BytesIO()
        result.images[0].save(out, format="PNG")
        # Sizes, choices and timings only: never a photo.
        print(f"[onme-tryon] {category}/{photo_type} {result.images[0].size} in {time.time() - started:.1f}s")
        return Response(content=out.getvalue(), media_type="image/png")
