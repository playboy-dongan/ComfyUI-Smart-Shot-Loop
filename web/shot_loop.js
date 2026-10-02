import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { ShotRunner, parseShots, extractVideos } from "./runner.js";
import { submitThroughApp, Cancellation } from "./bridge.js";

let activeRunner = null;
const pendingKey = "shot-loop.unfinished";
const widget = (node, name) => node.widgets?.find(w => w.name === name)?.value;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function getJSON(path) {
  const response = await api.fetchApi(path);
  if (!response.ok) throw new Error(`读取 ComfyUI 状态失败 (${response.status})，停止后续提交`);
  return response.json();
}
function connectedPromptPorts(prompt, sourceId, outputId) {
  const ports = new Set(), visited = new Set();
  function walk(id) {
    if (visited.has(id)) return;
    visited.add(id);
    for (const value of Object.values(prompt[id]?.inputs ?? {})) {
      if (!Array.isArray(value) || value.length !== 2 || !Number.isInteger(value[1])) continue;
      const parent = String(value[0]);
      if (parent === sourceId) ports.add(value[1]);
      walk(parent);
    }
  }
  walk(outputId);
  return ports.has(0) && ports.has(1);
}

app.registerExtension({
  name: "shot-loop.sequential-gallery",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (!["ShotLoopGallery", "SmartShotLoop"].includes(nodeData.name)) return;
    const unified = nodeData.name === "SmartShotLoop";
    const previous = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function() {
      previous?.apply(this, arguments);
      const node = this;
      const root = document.createElement("div");
      root.style.cssText = "padding:8px;color:#eee;background:#202329;overflow:auto;max-height:640px";
      const status = document.createElement("div");
      status.textContent = unified ? "接好两个提示词输出，选择最终视频保存节点，即可一键运行" : "选择提示词与视频保存节点，然后一键运行";
      const controls = document.createElement("div");
      const start = document.createElement("button"); start.textContent = "一键生成全部分镜";
      const updateLabel = () => {
        if (!unified) return;
        try { start.textContent = `一键生成全部 ${parseShots(widget(node, "shots_json")).length} 段`; }
        catch { start.textContent = "请检查分镜输入格式"; }
      };
      const promptWidget = node.widgets?.find(w => w.name === "shots_json");
      if (promptWidget) {
        const callback = promptWidget.callback;
        promptWidget.callback = function() { const result = callback?.apply(this, arguments); updateLabel(); return result; };
      }
      updateLabel();
      const stop = document.createElement("button"); stop.textContent = "停止后续分镜";
      const gallery = document.createElement("div");
      gallery.style.cssText = "display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px";
      const picks = document.createElement("div");
      for (const [field, label] of (unified ? [["video_output_node_id", "选择最终视频保存节点"]] : [["prompt_node_id", "选择提示词节点"], ["video_output_node_id", "选择最终视频保存节点"]])) {
        const select = document.createElement("select");
        const refresh = () => {
          let current = String(widget(node, field));
          if (!current && field === "video_output_node_id") {
            const candidates = (app.graph?._nodes ?? []).filter(n => ["SaveVideo", "SaveWEBM", "VHS_VideoCombine"].includes(n.comfyClass ?? n.type));
            if (candidates.length === 1) { current = String(candidates[0].id); const w = node.widgets.find(w => w.name === field); if (w) w.value = current; }
          }
          select.replaceChildren();
          const empty = document.createElement("option"); empty.value = ""; empty.textContent = label; select.append(empty);
          for (const candidate of app.graph?._nodes ?? []) {
            if (candidate === node || (field === "prompt_node_id" && candidate.comfyClass !== "ShotLoopPrompts" && candidate.type !== "ShotLoopPrompts")) continue;
            const option = document.createElement("option"); option.value = String(candidate.id);
            option.textContent = `${candidate.id}: ${candidate.title ?? candidate.type}`; select.append(option);
          }
          select.value = current;
        };
        select.onfocus = refresh;
        select.onchange = () => { const w = node.widgets.find(w => w.name === field); if (w) w.value = select.value; };
        refresh(); picks.append(select);
      }
      controls.append(start, stop); root.append(status, picks, controls, gallery);
      node.addDOMWidget("shot_loop_gallery", "div", root, {serialize:false});
      node.setSize([660, unified ? 1000 : 720]);
      const renderVideo = ({shot, title, file}, count) => {
        const box = document.createElement("div"), label = document.createElement("div");
        label.textContent = `分镜 ${shot} / ${count}${title ? " · " + title : ""}`;
        const video = document.createElement("video");
        video.controls = true; video.preload = "metadata"; video.style.width = "100%";
        const query = new URLSearchParams({filename:file.filename, subfolder:file.subfolder ?? "", type:file.type ?? "output"});
        video.src = api.apiURL(`/view?${query}`);
        box.append(label, video); gallery.append(box);
      };
      const configured = node.onConfigure;
      node.onConfigure = function() {
        const result = configured?.apply(this, arguments);
        updateLabel();
        gallery.replaceChildren();
        const saved = node.properties?.shot_loop_results;
        if (Array.isArray(saved) && saved.length <= 100) {
          for (const item of saved) {
            if (Number.isInteger(item?.shot) && extractVideos({videos:[item.file]}).length === 1)
              renderVideo(item, node.properties.shot_loop_count ?? saved.length);
          }
          if (saved.length) status.textContent = `已恢复 ${saved.length} 段视频记录（不会自动继续生成）`;
        }
        return result;
      };
      let runner = null;
      let cancellation = null;
      stop.onclick = () => {
        cancellation?.cancel(); runner?.cancel();
        status.textContent = "已停止后续分镜；当前任务如需中止，请使用 ComfyUI 的队列取消按钮";
      };
      const runBatch = async () => {
        if (activeRunner) { status.textContent = "本页面已有分镜批次在运行"; return; }
        if (sessionStorage.getItem(pendingKey)) {
          if (!window.confirm("上次批次未确认结束（可能已提交或已产生费用）。请先检查队列和历史，确认无运行中的任务。要开始全新批次吗？")) return;
          sessionStorage.removeItem(pendingKey);
        }
        // Claim lock synchronously before graph serialization or audio promises.
        cancellation = new Cancellation();
        activeRunner = cancellation;
        start.disabled = true;
        let audio;
        try {
          const AudioContext = window.AudioContext || window.webkitAudioContext;
          if (AudioContext && (!unified || widget(node, "sound_enabled"))) { audio = new AudioContext(); await audio.resume(); }
          cancellation.check();
          const sourceId = unified ? String(node.id) : String(widget(node, "prompt_node_id")).trim();
          const outputId = String(widget(node, "video_output_node_id")).trim();
          const snapshot = await app.graphToPrompt();
          cancellation.check();
          if (!["ShotLoopPrompts", "SmartShotLoop"].includes(snapshot.output[sourceId]?.class_type)) throw new Error("prompt_node_id 应填写分镜提示词节点的 ID");
          if (!connectedPromptPorts(snapshot.output, sourceId, outputId)) throw new Error("图像和视频两个提示词输出都必须连接到指定视频输出节点的上游");
          const shots = parseShots(snapshot.output[sourceId].inputs.shots_json);
          // Avoid enqueuing unrelated output branches from the current graph.
          const needed = new Set([outputId]);
          const visit = id => {
            for (const v of Object.values(snapshot.output[id]?.inputs ?? {})) {
              if (Array.isArray(v) && v.length === 2 && Number.isInteger(v[1]) && snapshot.output[String(v[0])]) {
                const parent = String(v[0]);
                if (!needed.has(parent)) { needed.add(parent); visit(parent); }
              }
            }
          };
          visit(outputId);
          snapshot.output = Object.fromEntries(Object.entries(snapshot.output).filter(([id]) => needed.has(id)));
          const queue = await getJSON("/queue");
          if ((queue.queue_running?.length ?? 0) + (queue.queue_pending?.length ?? 0)) throw new Error("请等现有队列清空后再运行分镜批次，并关闭自动队列");
          cancellation.check();
          gallery.replaceChildren();
          node.properties ??= {};
          node.properties.shot_loop_results = [];
          node.properties.shot_loop_count = shots.length;
          runner = new ShotRunner({
            token: () => crypto.randomUUID(), now: () => Date.now(), sleep,
            status: text => { status.textContent = text; },
            submit: async data => {
              const currentQueue = await getJSON("/queue");
              if ((currentQueue.queue_running?.length ?? 0) + (currentQueue.queue_pending?.length ?? 0))
                throw new Error("检测到其他队列任务，已停止后续分镜，请清空后重新开始");
              cancellation.check(); runner.check();
              sessionStorage.setItem(pendingKey, JSON.stringify({started:Date.now(), stage:"submitting"}));
              const r = await submitThroughApp(app, api, data, () => { cancellation.check(); runner.check(); });
              sessionStorage.setItem(pendingKey, JSON.stringify({promptId:r.prompt_id}));
              return r;
            },
            history: async id => (await getJSON(`/history/${encodeURIComponent(id)}`))[id],
            result: result => {
              const file = {filename:result.file.filename, subfolder:result.file.subfolder ?? "", type:result.file.type ?? "output"};
              const saved = {shot:result.shot, title:result.title, file};
              node.properties.shot_loop_results.push(saved);
              renderVideo(saved, shots.length);
            },
            notify: async () => {
              if (unified && !widget(node, "sound_enabled")) return;
              if (!audio || audio.state !== "running") { status.textContent += "（浏览器声音不可用）"; return; }
              const osc = audio.createOscillator(), gain = audio.createGain();
              osc.connect(gain); gain.connect(audio.destination);
              osc.frequency.value = 880; gain.gain.value = unified ? Math.max(0, Math.min(1, Number(widget(node, "sound_volume")))) : 0.12;
              osc.start(); osc.stop(audio.currentTime + 0.4);
              await sleep(500);
            },
          });
          activeRunner = {get current() { return runner.current; }, cancel(reason) { cancellation.cancel(reason); runner.cancel(reason); }};
          cancellation.check();
          await runner.run(snapshot, sourceId, outputId, Number(widget(node, "timeout_minutes")) * 60000, unified ? Number(widget(node, "delay_seconds")) * 1000 : 0);
          sessionStorage.removeItem(pendingKey);
        } catch (error) { status.textContent = String(error.message ?? error); }
        finally { activeRunner = null; start.disabled = false; await audio?.close().catch(() => {}); }
      };
      start.onclick = async () => {
        if (!navigator.locks) {
          status.textContent = "请通过 HTTPS 或 localhost 打开 ComfyUI，以启用跨标签页防重复锁";
          return;
        }
        await navigator.locks.request("comfy-shot-loop:" + api.apiURL("/prompt"), {ifAvailable:true}, async lock => {
          if (!lock) { status.textContent = "另一个标签页正在运行分镜批次"; return; }
          await runBatch();
        });
      };
      const removed = node.onRemoved;
      node.onRemoved = function() { cancellation?.cancel("画廊节点被删除，已停止后续提交"); runner?.cancel("画廊节点被删除，已停止后续提交"); return removed?.apply(this, arguments); };
    };
  },
});
api.addEventListener("reconnecting", () => activeRunner?.cancel("连接中断，停止后续分镜；请检查队列后再开始"));
api.addEventListener("graphCleared", () => activeRunner?.cancel("工作流已切换，停止后续分镜"));
window.addEventListener("beforeunload", () => activeRunner?.cancel("页面关闭"));

for (const event of ["execution_error", "execution_interrupted"]) {
  api.addEventListener(event, e => {
    if (activeRunner?.current && e.detail?.prompt_id === activeRunner.current)
      activeRunner.cancel("当前分镜失败或被中断，已停止后续提交");
  });
}
