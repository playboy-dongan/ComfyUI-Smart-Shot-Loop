// Preserve Comfy's authenticated app submission flow. Overrides live only for
// one awaited submit and are restored on success, rejection, or cancellation.
export async function submitThroughApp(app, api, data, check) {
  if (app.processingQueue || app.queueItems?.length) throw new Error("ComfyUI 正在准备其他提交，请稍后再试");
  const originalAppQueue = app.queuePrompt;
  const originalSerialize = app.graphToPrompt;
  const originalApiQueue = api.queuePrompt;
  let response, failure, sent = false;
  const serialize = async () => { check(); return data; };
  const blockedQueue = async () => { throw new Error("分镜批次提交中，请勿重复点击普通 Run"); };
  const submit = async function(number, prompt, ...options) {
    check();
    if (prompt !== data || sent) throw new Error("拒绝批次外或重复提交");
    sent = true;
    try { response = await originalApiQueue.call(this, number, prompt, ...options); return response; }
    catch (error) { failure = error; throw error; }
  };
  app.graphToPrompt = serialize;
  app.queuePrompt = blockedQueue;
  api.queuePrompt = submit;
  try {
    check();
    await originalAppQueue.call(app, 0, 1);
    if (failure) throw failure;
    if (!response?.prompt_id) throw new Error("ComfyUI 未确认提交成功，请检查提示、账户状态和队列；不要直接重复提交");
    return response;
  } finally {
    if (app.graphToPrompt === serialize) app.graphToPrompt = originalSerialize;
    if (app.queuePrompt === blockedQueue) app.queuePrompt = originalAppQueue;
    if (api.queuePrompt === submit) api.queuePrompt = originalApiQueue;
  }
}

export class Cancellation {
  constructor() { this.cancelled = false; }
  cancel(reason = "已停止后续分镜") { this.cancelled = true; this.reason = reason; }
  check() { if (this.cancelled) throw new Error(this.reason); }
}
