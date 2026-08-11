import { EventEmitter } from "node:events";

const TERMINAL_STATES = new Set(["ready", "failed", "canceled"]);

export function renderLaneForStyle(styleId) {
  return String(styleId || "").toLowerCase() === "kanit-hf" ? "hyperframes" : "ass";
}

function parseMaybeJson(value, fallback = {}) {
  if (value == null) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeLane(render) {
  if (render.lane === "hyperframes" || render.lane === "premium") return "hyperframes";
  if (render.lane === "ass" || render.lane === "fast") return "ass";
  const config = parseMaybeJson(render.config ?? render.config_json, {});
  const styleId = String(config.styleId ?? render.styleId ?? render.style_id ?? "");
  return renderLaneForStyle(styleId);
}

function normalizePatch(patch = {}) {
  const normalized = { ...patch };
  if (!Object.hasOwn(normalized, "queuePosition") && Object.hasOwn(normalized, "queue_position")) {
    normalized.queuePosition = normalized.queue_position;
  }
  if (!Object.hasOwn(normalized, "styleId") && Object.hasOwn(normalized, "style_id")) {
    normalized.styleId = normalized.style_id;
  }
  delete normalized.queue_position;
  delete normalized.style_id;
  return normalized;
}

function eventValue(patch, camelName, snakeName, fallback) {
  if (Object.hasOwn(patch, camelName)) return patch[camelName];
  if (snakeName && Object.hasOwn(patch, snakeName)) return patch[snakeName];
  return fallback;
}

function normalizeEvent(render, inputPatch = {}) {
  const patch = normalizePatch(inputPatch);
  const projectId = render.projectId ?? render.project_id ?? null;
  const queuePosition = eventValue(
    patch,
    "queuePosition",
    "queue_position",
    render.queuePosition ?? render.queue_position ?? null,
  );
  return {
    renderId: render.id,
    projectId,
    project_id: projectId,
    kind: render.kind,
    state: eventValue(patch, "state", null, render.state),
    progress: Number(eventValue(patch, "progress", null, render.progress ?? 0)),
    stage: eventValue(patch, "stage", null, render.stage ?? null),
    message: eventValue(patch, "message", null, render.message ?? null),
    queuePosition,
    queue_position: queuePosition,
    current: eventValue(patch, "current", null, null),
    total: eventValue(patch, "total", null, null),
    outputs: eventValue(patch, "outputs", "outputs_json", render.outputs ?? render.outputs_json ?? null),
    error: eventValue(patch, "error", "error_json", render.error ?? render.error_json ?? null),
    updatedAt: new Date().toISOString(),
  };
}

function concurrencyLimit(value, fallback) {
  const number = Number(value ?? fallback);
  return Number.isInteger(number) && number >= 0 ? number : fallback;
}

/**
 * Persistent in-process render queue. SQLite owns durable state; this class
 * owns only live concurrency, cancellation, and SSE fan-out.
 */
export class RenderQueue {
  constructor({ store, processor, limits = {} }) {
    if (!store) throw new TypeError("RenderQueue requires a store");
    if (typeof processor !== "function") throw new TypeError("RenderQueue requires a processor");
    this.store = store;
    this.processor = processor;
    this.limits = {
      ass: concurrencyLimit(limits.ass ?? limits.fast, 2),
      hyperframes: concurrencyLimit(limits.hyperframes ?? limits.premium, 1),
    };
    this.waiting = [];
    this.running = new Map();
    this.activeByLane = { ass: 0, hyperframes: 0 };
    this.events = new EventEmitter();
    this.events.setMaxListeners(200);
    this.sequence = 0;
    this.closed = false;
  }

  async recover() {
    const pending = await Promise.resolve(
      this.store.recoverPendingRenders?.()
        ?? this.store.listPendingRenders?.()
        ?? [],
    );
    for (const render of pending) this.enqueue(render, { recovered: true });
    return pending.length;
  }

  enqueue(inputRender, { recovered = false } = {}) {
    if (this.closed) throw new Error("คิวงานปิดอยู่ กรุณาเปิด ClipPang ใหม่อีกครั้ง");
    if (!inputRender?.id) throw new TypeError("Render must have an id");
    if (
      this.waiting.some((job) => job.render.id === inputRender.id)
      || this.running.has(inputRender.id)
    ) {
      return inputRender.id;
    }

    let render = this.get(inputRender.id) ?? inputRender;
    if (TERMINAL_STATES.has(render.state)) return render.id;
    const lane = normalizeLane(render);
    if (render.lane !== lane && this.store.updateRender) {
      render = this.store.updateRender(render.id, { lane }) ?? { ...render, lane };
    } else {
      render = { ...render, lane };
    }
    const priority = render.kind === "draft" ? 0 : 10;

    this.waiting.push({
      render,
      priority,
      order: this.sequence += 1,
      recovered,
    });
    this.waiting.sort((a, b) => a.priority - b.priority || a.order - b.order);
    this.#refreshQueuePositions();
    queueMicrotask(() => this.#drain());
    return render.id;
  }

  get(renderId) {
    return this.store.getRender?.(renderId) ?? null;
  }

  subscribe(renderId, listener) {
    const eventName = `render:${renderId}`;
    this.events.on(eventName, listener);
    const current = this.get(renderId);
    if (current) listener(normalizeEvent(current));
    return () => {
      this.events.off(eventName, listener);
    };
  }

  cancel(renderId) {
    const waitingIndex = this.waiting.findIndex((job) => job.render.id === renderId);
    if (waitingIndex >= 0) {
      const [{ render }] = this.waiting.splice(waitingIndex, 1);
      this.#update(render.id, {
        state: "canceled",
        progress: Number(render.progress ?? 0),
        stage: "canceled",
        message: "ยกเลิกงานแล้ว",
        queuePosition: null,
      }, "cancel");
      this.#refreshQueuePositions();
      return true;
    }

    const active = this.running.get(renderId);
    if (active) {
      if (active.cancelRequested) return true;
      active.cancelRequested = true;
      this.#update(renderId, {
        state: "canceled",
        stage: "canceled",
        message: "ยกเลิกงานแล้ว",
        queuePosition: null,
      }, "cancel");
      const reason = Object.assign(new Error("ผู้ใช้ยกเลิกงาน"), {
        name: "AbortError",
        code: "USER_CANCELED",
      });
      active.controller.abort(reason);
      return true;
    }

    const render = this.get(renderId);
    if (!render) return false;
    if (TERMINAL_STATES.has(render.state)) return true;
    this.#update(renderId, {
      state: "canceled",
      stage: "canceled",
      message: "ยกเลิกงานแล้ว",
      queuePosition: null,
    }, "cancel");
    return true;
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    for (const [renderId, active] of this.running) {
      active.shuttingDown = true;
      this.#update(renderId, {
        state: "queued",
        progress: 0,
        stage: null,
        message: "หยุดชั่วคราว รอทำต่อเมื่อเปิด ClipPang",
        queuePosition: null,
        startedAt: null,
        finishedAt: null,
      });
      const reason = Object.assign(new Error("ClipPang กำลังปิดโปรแกรม"), {
        name: "AbortError",
        code: "QUEUE_SHUTDOWN",
      });
      active.controller.abort(reason);
    }
    await Promise.allSettled(
      [...this.running.values()].map((active) => active.promise).filter(Boolean),
    );
    this.waiting.length = 0;
    this.events.removeAllListeners();
  }

  #emit(renderId, event) {
    this.events.emit(`render:${renderId}`, event);
  }

  #update(renderId, inputPatch, specializedMethod) {
    const patch = normalizePatch(inputPatch);
    const current = this.get(renderId);
    let updated;

    if (specializedMethod === "start" && this.store.startRender) {
      updated = this.store.startRender(renderId, {
        state: patch.state,
        stage: patch.stage,
        message: patch.message,
      });
      const followUp = {};
      if (Object.hasOwn(patch, "progress")) followUp.progress = patch.progress;
      if (Object.hasOwn(patch, "queuePosition")) followUp.queuePosition = patch.queuePosition;
      if (Object.keys(followUp).length && this.store.updateRender) {
        updated = this.store.updateRender(renderId, followUp);
      }
    } else if (specializedMethod === "progress" && this.store.updateRenderProgress) {
      const progress = Object.hasOwn(patch, "progress")
        ? patch.progress
        : Number(current?.progress ?? 0);
      updated = this.store.updateRenderProgress(renderId, progress, patch);
    } else if (specializedMethod === "complete" && this.store.completeRender) {
      updated = this.store.completeRender(renderId, {
        outputs: patch.outputs ?? null,
        timeline: patch.timeline,
        message: patch.message,
      });
    } else if (specializedMethod === "fail" && this.store.failRender) {
      const failure = patch.error instanceof Error
        ? patch.error
        : Object.assign(new Error(patch.error?.message ?? patch.message ?? "สร้างคลิปไม่สำเร็จ"), {
            code: patch.error?.code,
          });
      updated = this.store.failRender(renderId, failure, {
        message: patch.message,
        stage: patch.stage,
      });
    } else if (specializedMethod === "cancel" && this.store.cancelRender) {
      updated = this.store.cancelRender(renderId, { message: patch.message });
      const followUp = {};
      if (Object.hasOwn(patch, "progress")) followUp.progress = patch.progress;
      if (Object.hasOwn(patch, "queuePosition")) followUp.queuePosition = patch.queuePosition;
      if (Object.keys(followUp).length && this.store.updateRender) {
        updated = this.store.updateRender(renderId, followUp);
      }
    } else {
      updated = this.store.updateRender?.(renderId, patch);
    }

    const render = updated ?? this.get(renderId) ?? { id: renderId };
    this.#emit(renderId, normalizeEvent(render, patch));
    return render;
  }

  #refreshQueuePositions() {
    this.waiting.forEach((job, index) => {
      const patch = {
        state: "queued",
        queuePosition: index + 1,
        stage: "queued",
        message: `อยู่ในคิวลำดับที่ ${index + 1}`,
      };
      job.render = this.#update(job.render.id, patch, "progress");
    });
  }

  #canStart(job) {
    return this.activeByLane[job.render.lane] < this.limits[job.render.lane];
  }

  #drain() {
    if (this.closed) return;
    let started = false;
    for (let index = 0; index < this.waiting.length; index += 1) {
      const job = this.waiting[index];
      if (!this.#canStart(job)) continue;
      this.waiting.splice(index, 1);
      index -= 1;
      try {
        this.#start(job);
      } catch (error) {
        this.#update(job.render.id, {
          state: "failed",
          stage: "failed",
          message: "เริ่มงานเรนเดอร์ไม่สำเร็จ",
          error: { message: error?.message || String(error), code: error?.code ?? null },
          queuePosition: null,
        }, "fail");
      }
      started = true;
    }
    if (started) this.#refreshQueuePositions();
  }

  #start(job) {
    const lane = job.render.lane;
    const controller = new AbortController();
    const started = this.#update(job.render.id, {
      state: "processing",
      progress: Math.max(1, Number(job.render.progress ?? 0)),
      queuePosition: null,
      stage: "starting",
      message: "กำลังเตรียมงานเรนเดอร์",
    }, "start");
    const render = { ...job.render, ...started, lane };
    const active = {
      controller,
      promise: null,
      lane,
      cancelRequested: false,
      shuttingDown: false,
    };
    this.activeByLane[lane] += 1;
    this.running.set(render.id, active);

    const onProgress = (event = {}) => {
      if (controller.signal.aborted) return;
      this.#update(render.id, {
        state: "processing",
        progress: Math.max(0, Math.min(99, Math.round(Number(event.progress ?? 0)))),
        stage: event.stage ?? "processing",
        message: event.message ?? "กำลังประมวลผล",
        current: event.current ?? null,
        total: event.total ?? null,
      }, "progress");
    };

    active.promise = Promise.resolve()
      .then(() => this.processor({ ...render, signal: controller.signal, onProgress }))
      .then((result = {}) => {
        if (controller.signal.aborted) return;
        this.#update(render.id, {
          state: "ready",
          progress: 100,
          stage: "ready",
          message: render.kind === "draft"
            ? "ร่างพร้อมให้เลือกแล้ว"
            : "คลิปตัวจริงพร้อมดาวน์โหลดแล้ว",
          timeline: result.timeline ?? null,
          outputs: result.outputs ?? null,
          queuePosition: null,
        }, "complete");
      })
      .catch((error) => {
        if (active.shuttingDown) return;
        const canceled = active.cancelRequested
          || controller.signal.aborted
          || error?.name === "AbortError";
        if (canceled && this.get(render.id)?.state === "canceled") return;
        this.#update(render.id, {
          state: canceled ? "canceled" : "failed",
          stage: canceled ? "canceled" : "failed",
          message: canceled ? "ยกเลิกงานแล้ว" : "สร้างคลิปไม่สำเร็จ ดูวิธีแก้ด้านล่าง",
          error: canceled
            ? null
            : { message: error?.message || String(error), code: error?.code ?? null },
          queuePosition: null,
        }, canceled ? "cancel" : "fail");
      })
      .finally(() => {
        this.running.delete(render.id);
        this.activeByLane[lane] -= 1;
        this.#drain();
      });
  }
}

export function isTerminalRenderState(state) {
  return TERMINAL_STATES.has(state);
}
