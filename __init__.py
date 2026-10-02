"""Five-shot prompt source and browser-owned sequential gallery."""
import json

DEFAULT_SHOTS = json.dumps([
    {"image": f"分镜{i}的图像提示词", "video": f"分镜{i}的动作和运镜提示词"}
    for i in range(1, 6)
], ensure_ascii=False, indent=2)


def parse_shots(raw):
    shots = json.loads(raw)
    if not isinstance(shots, list) or not 1 <= len(shots) <= 100:
        raise ValueError("分镜必须是包含 1–100 项的 JSON 数组")
    for i, shot in enumerate(shots, 1):
        if not isinstance(shot, dict) or any(
            not isinstance(shot.get(key), str) or not shot[key].strip()
            for key in ("image", "video")
        ):
            raise ValueError(f"分镜 {i} 必须包含非空 image 和 video 字符串")
    return shots


class ShotLoopPrompts:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "shots_json": ("STRING", {"multiline": True, "default": DEFAULT_SHOTS}),
            "shot_index": ("INT", {"default": 0, "min": 0, "max": 99}),
            "run_token": ("STRING", {"default": "manual"}),
        }}
    RETURN_TYPES = ("STRING", "STRING", "STRING")
    RETURN_NAMES = ("image_prompt", "video_prompt", "filename_prefix")
    FUNCTION = "select"
    CATEGORY = "Shot Loop / 分镜循环"

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        # Do not reuse the prompt-source cache across runs, even for identical text.
        return float("nan")

    def select(self, shots_json, shot_index, run_token):
        shots = parse_shots(shots_json)
        if not 0 <= shot_index < len(shots):
            raise ValueError("shot_index 超出分镜范围")
        shot = shots[shot_index]
        safe_token = "".join(c for c in run_token if c.isalnum() or c in "-_")[:80]
        return shot["image"], shot["video"], f"shot_loop/{safe_token}/shot_{shot_index + 1:02d}"


class ShotLoopGallery:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "prompt_node_id": ("STRING", {"default": ""}),
            "video_output_node_id": ("STRING", {"default": ""}),
            "timeout_minutes": ("INT", {"default": 120, "min": 1, "max": 1440}),
        }}
    RETURN_TYPES = ()
    OUTPUT_NODE = True
    FUNCTION = "execute"
    CATEGORY = "Shot Loop / 分镜循环"

    def execute(self, **kwargs):
        return {"ui": {"text": ["请点击本节点的「一键生成全部分镜」按钮"]}}


NODE_CLASS_MAPPINGS = {"ShotLoopPrompts": ShotLoopPrompts, "ShotLoopGallery": ShotLoopGallery}
NODE_DISPLAY_NAME_MAPPINGS = {
    "ShotLoopPrompts": "分镜循环 · 成对提示词",
    "ShotLoopGallery": "分镜循环 · 一键生成与视频画廊",
}
WEB_DIRECTORY = "./web"


class SmartShotLoop(ShotLoopPrompts):
    """One node provides paired prompts, sequential control and all previews."""
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "shots_json": ("STRING", {"multiline": True, "default": DEFAULT_SHOTS}),
            "video_output_node_id": ("STRING", {"default": "", "advanced": True}),
            "timeout_minutes": ("INT", {"default": 120, "min": 1, "max": 1440, "advanced": True}),
            "delay_seconds": ("FLOAT", {"default": 0, "min": 0, "max": 3600, "step": 0.5, "advanced": True}),
            "sound_enabled": ("BOOLEAN", {"default": True}),
            "sound_volume": ("FLOAT", {"default": 0.12, "min": 0, "max": 1, "step": 0.01, "advanced": True}),
            "shot_index": ("INT", {"default": 0, "min": 0, "max": 99, "advanced": True}),
            "run_token": ("STRING", {"default": "manual", "advanced": True}),
        }}

    def select(self, shots_json, shot_index, run_token, **kwargs):
        return super().select(shots_json, shot_index, run_token)


NODE_CLASS_MAPPINGS["SmartShotLoop"] = SmartShotLoop
NODE_DISPLAY_NAME_MAPPINGS["SmartShotLoop"] = "智能循环 · 一键分镜视频"
