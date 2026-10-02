// Pure controller: no Comfy internals, DOM, or paid requests in tests.
export function parseShots(raw) {
  const shots = JSON.parse(raw);
  if (!Array.isArray(shots) || shots.length < 1 || shots.length > 100)
    throw new Error("分镜必须是包含 1–100 项的 JSON 数组");
  shots.forEach((s, i) => {
    if (!s || ["image", "video"].some(k => typeof s[k] !== "string" || !s[k].trim()))
      throw new Error(`分镜 ${i + 1} 的 image / video 不能为空`);
  });
  return shots;
}

export function extractVideos(output) {
  // Only Comfy file descriptors, never arbitrary HTML or external URLs.
  const candidates = ["videos", "gifs", "images"].flatMap(k => Array.isArray(output?.[k]) ? output[k] : []);
  return candidates.filter(f => f && typeof f.filename === "string" && /\.(mp4|webm|mov|m4v|ogv)$/i.test(f.filename)
    && (!f.type || ["output", "temp", "input"].includes(f.type)));
}

export class ShotRunner {
  constructor(io) { this.io = io; this.active = false; this.current = null; this.results = []; }
  cancel(reason = "已停止后续分镜；当前已提交任务可能仍在运行") {
    this.cancelled = true; this.reason = reason;
  }
  check() { if (this.cancelled) throw new Error(this.reason); }
  async run(snapshot, sourceId, outputId, timeoutMs, delayMs = 0) {
    if (this.active) throw new Error("已有分镜任务在运行，不能重复提交");
    this.active = true; this.cancelled = false; this.results = []; this.current = null;
    try {
      const source = snapshot.output[sourceId];
      if (!["ShotLoopPrompts", "SmartShotLoop"].includes(source?.class_type)) throw new Error("提示词节点 ID 不正确");
      if (!snapshot.output[outputId] || outputId === sourceId) throw new Error("视频输出节点 ID 不正确");
      const shots = parseShots(source.inputs.shots_json);
      const token = this.io.token();
      for (let i = 0; i < shots.length; i++) {
        this.check();
        if (i > 0 && delayMs > 0) {
          this.io.status(`等待下一段（${delayMs / 1000} 秒）`);
          // Short increments make stop responsive even for long custom delays.
          let remaining = delayMs;
          while (remaining > 0) {
            const step = Math.min(remaining, 250);
            await this.io.sleep(step); this.check(); remaining -= step;
          }
        }
        const data = structuredClone(snapshot);
        Object.assign(data.output[sourceId].inputs, {shot_index: i, run_token: token});
        this.io.status(`生成 ${i + 1}/${shots.length}`);
        // Never retry a POST: a lost response may already have queued a paid job.
        const response = await this.io.submit(data);
        if (!response?.prompt_id) throw new Error("提交结果不确定，请先检查 ComfyUI 队列，勿直接重试");
        this.current = response.prompt_id;
        this.check();
        const started = this.io.now();
        let finished = false;
        while (!finished) {
          this.check();
          if (this.io.now() - started > timeoutMs) throw new Error("等待超时，停止后续分镜；当前任务可能仍在运行");
          const record = await this.io.history(this.current);
          this.check();
          if (record?.status?.status_str === "error") throw new Error(`第 ${i + 1} 段执行失败，已停止`);
          if (record?.status?.completed === true) {
            if (record.status.status_str !== "success") throw new Error(`第 ${i + 1} 段未成功完成`);
            const videos = extractVideos(record.outputs?.[outputId]);
            if (videos.length !== 1) throw new Error(`第 ${i + 1} 段应输出一个视频，实际识别到 ${videos.length} 个；需适配输出节点`);
            const file = videos[0];
            const key = JSON.stringify([file.type ?? "output", file.subfolder ?? "", file.filename]);
            if (this.results.some(r => r.key === key)) throw new Error("输出视频路径重复，可能覆盖旧片段；请连接 filename_prefix 或启用自动编号");
            this.results.push({shot: i + 1, title: typeof shots[i].title === "string" ? shots[i].title : "", promptId: this.current, file, key});
            this.io.result(this.results.at(-1));
            this.current = null; finished = true;
          } else {
            await this.io.sleep(1000);
          }
        }
      }
      this.check();
      this.io.status(`全部 ${this.results.length} 段已完成`);
      await this.io.notify();
      return this.results;
    } finally { this.active = false; }
  }
}
