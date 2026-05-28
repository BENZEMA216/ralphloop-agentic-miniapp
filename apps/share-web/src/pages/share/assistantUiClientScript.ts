export function createAssistantUiShareClientScript(): string {
  return `
    (() => {
      const stateElement = document.getElementById("assistant-ui-state");
      const state = stateElement ? JSON.parse(stateElement.textContent || "{}") : {};
      const token = String(state.token || "");
      let currentThreadId = String(state.currentThreadId || "");
      let activeTaskId = String(state.taskId || "");
      const shell = document.querySelector("[data-ralphloop-assistant-ui-shell='true']");
      const panel = document.querySelector("[data-assistant-ui-thread='true']");
      const messageList = document.querySelector("[data-assistant-ui-message-list='true']");
      const form = document.getElementById("assistant-ui-composer-form");
      const input = document.getElementById("assistant-ui-composer-input");
      const sendButton = document.getElementById("assistant-ui-send");
      const stopButton = document.getElementById("assistant-ui-stop");
      const railList = document.querySelector(".assistant-ui-thread-list");
      const newThreadButton = document.querySelector(".assistant-ui-new-thread");
      const statusPill = document.querySelector(".assistant-ui-thread-header .status-pill");
      const previewToggle = document.getElementById("assistant-ui-preview-toggle");
      const previewDrawer = document.getElementById("assistant-ui-preview-drawer");
      const previewClose = document.getElementById("assistant-ui-preview-close");
      const previewFrame = document.getElementById("assistant-ui-preview-frame");
      const statusLabels = {
        idle: "空闲",
        waiting: "等待中",
        running: "运行中",
        completed: "已完成",
        failed: "失败",
        cancelled: "已取消",
      };
      const staleEventsMessage = "当前会话已失效，请新建会话后重试。";
      const threads = new Map();
      const storageKey = "ralphloop:assistant-ui:threads:" + token;
      const storage = (() => {
        try {
          return window.localStorage;
        } catch {
          return null;
        }
      })();

      function endpoint(path) {
        return "/v1/share/" + encodeURIComponent(token) + path;
      }

      function escapeText(value) {
        return String(value)
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll('"', "&quot;")
          .replaceAll("'", "&#39;");
      }

      function roleLabel(role) {
        if (role === "assistant") return "Agent";
        if (role === "system") return "System";
        return "You";
      }

      function normalizeStatus(status) {
        return Object.prototype.hasOwnProperty.call(statusLabels, status) ? status : "idle";
      }

      function readStoredThreads() {
        if (!storage || !token) return [];
        try {
          const parsed = JSON.parse(storage.getItem(storageKey) || "[]");
          if (!Array.isArray(parsed)) return [];
          return parsed.map((thread) => ({
            id: String(thread?.id || ""),
            title: String(thread?.title || "Agent Chat").slice(0, 80),
            status: normalizeStatus(String(thread?.status || "idle")),
            activeTaskId: String(thread?.activeTaskId || ""),
            messageCount: Number.isFinite(Number(thread?.messageCount)) ? Number(thread.messageCount) : 0,
          })).filter((thread) => thread.id && thread.id !== "assistant-ui-preview");
        } catch {
          return [];
        }
      }

      function persistThreads() {
        if (!storage || !token) return;
        const records = Array.from(threads.values()).map((thread) => ({
          id: thread.id,
          title: String(thread.title || "Agent Chat").slice(0, 80),
          status: normalizeStatus(String(thread.status || "idle")),
          activeTaskId: String(thread.activeTaskId || ""),
          messageCount: Number.isFinite(Number(thread.messageCount)) ? Number(thread.messageCount) : 0,
        }));
        try {
          storage.setItem(storageKey, JSON.stringify(records));
        } catch {
          // Browsers can deny storage in private or restricted contexts; the live chat still works.
        }
      }

      function applyStoredThread(thread) {
        if (!thread.id) return;
        const existing = threads.get(thread.id);
        threads.set(thread.id, {
          id: thread.id,
          title: thread.title || existing?.title || "Agent Chat",
          status: normalizeStatus(thread.status || existing?.status || "idle"),
          activeTaskId: thread.activeTaskId || existing?.activeTaskId || "",
          messagesHtml: existing?.messagesHtml || "",
          messageCount: existing?.messageCount ?? thread.messageCount ?? 0,
        });
      }

      function setStatus(status) {
        if (panel) panel.setAttribute("data-assistant-ui-thread-status", status);
        if (statusPill) statusPill.textContent = statusLabels[status] || status;
        if (stopButton) stopButton.disabled = status !== "running";
        const thread = currentThread();
        if (thread) thread.status = status;
        persistThreads();
      }

      function setSending(isSending) {
        if (sendButton) sendButton.disabled = isSending;
        if (input) input.disabled = isSending;
      }

      function messageHtml(message) {
        const role = message.role === "assistant" || message.role === "system" ? message.role : "user";
        const status = message.status || "complete";
        const loadingClass = status === "running" ? " assistant-ui-message-loading" : "";
        return '<li class="assistant-ui-message assistant-ui-message-' + role + loadingClass + '" data-message-role="' + role + '" data-message-status="' + escapeText(status) + '"><strong class="assistant-ui-message-role">' + roleLabel(role) + '</strong><p class="assistant-ui-message-content">' + escapeText(message.text) + "</p></li>";
      }

      function updateMessageCount(count) {
        if (shell) shell.setAttribute("data-message-count", String(count));
        const thread = currentThread();
        if (thread) thread.messageCount = count;
      }

      function appendLocalMessage(role, text, status) {
        if (!messageList) return;
        messageList.insertAdjacentHTML("beforeend", messageHtml({ role, text, status }));
        updateMessageCount(messageList.querySelectorAll(".assistant-ui-message").length);
        messageList.scrollTop = messageList.scrollHeight;
        saveCurrentThreadSnapshot();
      }

      function removeRunningPlaceholders() {
        if (!messageList) return;
        const placeholders = Array.from(messageList.querySelectorAll(".assistant-ui-message-loading"));
        if (placeholders.length === 0) return;
        for (const placeholder of placeholders) {
          placeholder.remove();
        }
        updateMessageCount(messageList.querySelectorAll(".assistant-ui-message").length);
        saveCurrentThreadSnapshot();
      }

      function failCurrentThread(message) {
        removeRunningPlaceholders();
        setStatus("failed");
        if (!messageList?.textContent?.includes(message)) {
          appendLocalMessage("assistant", message, "incomplete");
        }
        activeTaskId = "";
        const thread = currentThread();
        if (thread) thread.activeTaskId = "";
        updateLocationForThread(currentThreadId, "");
        saveCurrentThreadSnapshot();
      }

      function markThreadEventsUnavailable(thread) {
        if (!thread) return false;
        if (thread.id === currentThreadId) {
          failCurrentThread(staleEventsMessage);
          return true;
        }
        thread.status = "failed";
        thread.activeTaskId = "";
        if (!String(thread.messagesHtml || "").includes(staleEventsMessage)) {
          thread.messagesHtml = String(thread.messagesHtml || "") + messageHtml({
            role: "assistant",
            text: staleEventsMessage,
            status: "incomplete",
          });
          thread.messageCount = Number(thread.messageCount || 0) + 1;
        }
        persistThreads();
        renderThreadList();
        return true;
      }

      function currentThread() {
        return threads.get(currentThreadId);
      }

      function isPreviewThread(threadId) {
        return threadId === "assistant-ui-preview";
      }

      function discardPreviewThread() {
        if (!threads.has("assistant-ui-preview")) return;
        threads.delete("assistant-ui-preview");
        persistThreads();
      }

      function saveCurrentThreadSnapshot() {
        const thread = currentThread();
        if (!thread || !messageList || !panel || !shell) return;
        thread.messagesHtml = messageList.innerHTML;
        thread.messageCount = Number(shell.getAttribute("data-message-count") || "0");
        thread.status = panel.getAttribute("data-assistant-ui-thread-status") || "idle";
        thread.activeTaskId = activeTaskId;
        persistThreads();
      }

      function updateLocationForThread(threadId, taskId) {
        if (!window.history?.replaceState) return;
        const nextUrl = new URL(window.location.href);
        nextUrl.searchParams.set("sessionId", threadId);
        if (taskId) {
          nextUrl.searchParams.set("taskId", taskId);
        } else {
          nextUrl.searchParams.delete("taskId");
        }
        window.history.replaceState(null, "", nextUrl);
      }

      function renderThreadList() {
        if (shell) shell.setAttribute("data-thread-count", String(threads.size));
        if (!railList) return;
        railList.innerHTML = Array.from(threads.values()).map((thread) => {
          const current = thread.id === currentThreadId ? "true" : "false";
          return '<li class="assistant-ui-thread-list-item" aria-current="' + current + '"><button class="assistant-ui-thread-switch" type="button" data-assistant-ui-thread-id="' + escapeText(thread.id) + '" aria-current="' + current + '">' + escapeText(thread.title || "Agent Chat") + '</button></li>';
        }).join("");
        persistThreads();
      }

      function renderCurrentThread() {
        const thread = currentThread();
        if (!thread) return;
        activeTaskId = thread.activeTaskId || "";
        if (shell) shell.setAttribute("data-current-thread-id", currentThreadId);
        if (messageList) {
          messageList.innerHTML = thread.messagesHtml || "";
          messageList.scrollTop = messageList.scrollHeight;
        }
        updateMessageCount(thread.messageCount || 0);
        setStatus(thread.status || "idle");
        renderThreadList();
        updateLocationForThread(currentThreadId, activeTaskId);
        if (previewDrawer?.classList?.contains("is-open")) {
          void refreshPreview();
        }
      }

      function initializeThreads() {
        if (!currentThreadId) return;
        for (const storedThread of readStoredThreads()) {
          applyStoredThread(storedThread);
        }
        const existing = threads.get(currentThreadId);
        threads.set(currentThreadId, {
          id: currentThreadId,
          title: existing?.title || "Agent Chat",
          status: panel?.getAttribute("data-assistant-ui-thread-status") || "idle",
          activeTaskId: activeTaskId || existing?.activeTaskId || "",
          messagesHtml: messageList?.innerHTML || "",
          messageCount: Number(shell?.getAttribute("data-message-count") || "0"),
        });
        activeTaskId = threads.get(currentThreadId)?.activeTaskId || activeTaskId;
        renderThreadList();
        for (const thread of threads.values()) {
          if (thread.activeTaskId && (thread.id !== currentThreadId || !thread.messagesHtml)) {
            void loadThreadEvents(thread);
          }
        }
      }

      function switchThread(threadId) {
        if (!threads.has(threadId) || threadId === currentThreadId) return;
        saveCurrentThreadSnapshot();
        currentThreadId = threadId;
        renderCurrentThread();
        const thread = currentThread();
        if (thread?.activeTaskId && !thread.messagesHtml) {
          void loadThreadEvents(thread);
        }
      }

      async function createNewThread() {
        saveCurrentThreadSnapshot();
        const response = await fetch(endpoint("/sessions"), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        });
        const body = await readJson(response);
        if (!response.ok || !body.session?.id) {
          setStatus("failed");
          appendLocalMessage("assistant", "新会话创建失败，请稍后再试。", "incomplete");
          return;
        }
          const wasPreviewThread = isPreviewThread(currentThreadId);
          currentThreadId = body.session.id;
          activeTaskId = "";
          if (wasPreviewThread) {
            discardPreviewThread();
          }
          threads.set(currentThreadId, {
            id: currentThreadId,
            title: "新会话",
          status: "idle",
          activeTaskId: "",
          messagesHtml: "",
          messageCount: 0,
        });
        renderCurrentThread();
        input?.focus();
      }

      function messagesFromEvents(events, watchRunId) {
        const messages = [];
        let latestStatus = "idle";
        let watchedStatus = watchRunId ? "running" : "";
        let watchedSeen = false;
        let currentAssistantId = "";
        let currentAssistantText = "";
        const cancelMessageRunIds = new Set();
        const flushAssistant = () => {
          if (!currentAssistantId || !currentAssistantText) return;
          messages.push({ role: "assistant", text: currentAssistantText, status: "complete" });
          currentAssistantId = "";
          currentAssistantText = "";
        };
        const applyStatus = (runId, nextStatus) => {
          latestStatus = nextStatus;
          if (watchRunId && runId === watchRunId) {
            watchedSeen = true;
            watchedStatus = nextStatus;
          }
        };
        const appendCancelMessage = (runId) => {
          const key = runId || "cancelled";
          if (cancelMessageRunIds.has(key)) return;
          flushAssistant();
          const lastMessage = messages[messages.length - 1];
          if (lastMessage?.role === "assistant" && lastMessage?.text === "任务已取消。") return;
          messages.push({ role: "assistant", text: "任务已取消。", status: "incomplete" });
          cancelMessageRunIds.add(key);
        };

        for (const event of events || []) {
          if (event.type === "RUN_STARTED") {
            flushAssistant();
            applyStatus(event.runId || "", "running");
            for (const message of event.input?.messages || []) {
              if (message.role === "user" || message.role === "assistant" || message.role === "system") {
                messages.push({ role: message.role, text: message.content || "", status: "complete" });
              }
            }
          } else if (event.type === "TEXT_MESSAGE_START") {
            flushAssistant();
            currentAssistantId = event.messageId || "assistant";
            currentAssistantText = "";
          } else if (event.type === "TEXT_MESSAGE_CONTENT") {
            currentAssistantText += event.delta || "";
          } else if (event.type === "TEXT_MESSAGE_END") {
            flushAssistant();
          } else if (event.type === "RUN_FINISHED") {
            flushAssistant();
            if (event.result?.status === "cancelled") {
              appendCancelMessage(event.runId || "");
              applyStatus(event.runId || "", "cancelled");
            } else {
              applyStatus(event.runId || "", "completed");
            }
          } else if (event.type === "RUN_ERROR") {
            flushAssistant();
            latestStatus = "failed";
            if (watchRunId && !event.runId) {
              watchedSeen = true;
              watchedStatus = "failed";
            } else if (watchRunId && event.runId === watchRunId) {
              watchedSeen = true;
              watchedStatus = "failed";
            }
            messages.push({ role: "assistant", text: event.message || "任务失败", status: "incomplete" });
          } else if (event.type === "CUSTOM" && event.name === "ralphloop.run.cancelled") {
            const runId = event.value?.runId || event.runId || "";
            appendCancelMessage(runId);
            applyStatus(runId, "cancelled");
          }
        }
        flushAssistant();
        return {
          messages,
          status: watchRunId ? (watchedSeen ? watchedStatus : "running") : latestStatus,
          watchedSeen,
        };
      }

      async function readJson(response) {
        try {
          return await response.json();
        } catch {
          return {};
        }
      }

      function renderPreviewFrame(frames) {
        if (!previewFrame) return;
        const latest = (frames || []).at(-1);
        if (!latest) {
          previewFrame.innerHTML = "<span>只读预览</span>";
          return;
        }
        if (latest.contentType === "text/plain") {
          try {
            previewFrame.textContent = atob(String(latest.data || ""));
          } catch {
            previewFrame.textContent = "只读预览";
          }
          return;
        }
        if (String(latest.contentType || "").startsWith("image/")) {
          previewFrame.innerHTML = '<img alt="预览" src="data:' + escapeText(latest.contentType) + ';base64,' + escapeText(latest.data || "") + '">';
          return;
        }
        previewFrame.textContent = "只读预览";
      }

      async function refreshPreview(sessionId = currentThreadId, taskId = activeTaskId) {
        if (!sessionId || sessionId === "assistant-ui-preview" || !taskId) {
          renderPreviewFrame([]);
          return;
        }
        try {
          const response = await fetch(endpoint("/preview?sessionId=" + encodeURIComponent(sessionId) + "&taskId=" + encodeURIComponent(taskId)));
          const body = await readJson(response);
          if (!response.ok || body.available === false) {
            renderPreviewFrame([]);
            return;
          }
          renderPreviewFrame(body.frames || []);
        } catch {
          renderPreviewFrame([]);
        }
      }

      async function loadThreadEvents(thread) {
        if (!thread?.id || thread.id === "assistant-ui-preview" || thread.loadingEvents) return false;
        thread.loadingEvents = true;
        try {
          const response = await fetch(endpoint("/events?sessionId=" + encodeURIComponent(thread.id) + "&format=ag-ui"));
          const body = await readJson(response);
          if (!response.ok || !Array.isArray(body.events)) {
            if (body.error === "events_unavailable") {
              return markThreadEventsUnavailable(thread);
            }
            return false;
          }
          const next = messagesFromEvents(body.events, thread.activeTaskId || "");
          if (next.messages.length > 0 || thread.activeTaskId) {
            thread.messagesHtml = next.messages.map(messageHtml).join("");
            thread.messageCount = next.messages.length;
            thread.status = next.status;
          }
          if (thread.id === currentThreadId) {
            renderCurrentThread();
          } else {
            renderThreadList();
          }
          persistThreads();
          return true;
        } finally {
          thread.loadingEvents = false;
        }
      }

      async function ensureThread() {
        if (currentThreadId && !isPreviewThread(currentThreadId)) return currentThreadId;
        const response = await fetch(endpoint("/sessions"), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        });
        const body = await readJson(response);
        if (!response.ok || !body.session?.id) {
          throw new Error("session_create_failed");
        }
        const wasPreviewThread = isPreviewThread(currentThreadId);
        currentThreadId = body.session.id;
        if (wasPreviewThread) {
          discardPreviewThread();
        }
        if (shell) {
          shell.setAttribute("data-current-thread-id", currentThreadId);
        }
        if (!threads.has(currentThreadId)) {
          threads.set(currentThreadId, {
            id: currentThreadId,
            title: "Agent Chat",
            status: "idle",
            activeTaskId: "",
            messagesHtml: "",
            messageCount: 0,
          });
        }
        renderThreadList();
        return currentThreadId;
      }

      async function refreshEvents() {
        if (!currentThreadId || currentThreadId === "assistant-ui-preview") return false;
        const response = await fetch(endpoint("/events?sessionId=" + encodeURIComponent(currentThreadId) + "&format=ag-ui"));
        const body = await readJson(response);
        if (!response.ok || !Array.isArray(body.events)) {
          if (body.error === "events_unavailable" && panel?.getAttribute("data-assistant-ui-thread-status") !== "cancelled") {
            failCurrentThread(staleEventsMessage);
            return true;
          }
          return false;
        }
        const next = messagesFromEvents(body.events, activeTaskId);
        const shouldReplaceMessages = !activeTaskId || next.watchedSeen;
        if (messageList && next.messages.length > 0 && shouldReplaceMessages) {
          messageList.innerHTML = next.messages.map(messageHtml).join("");
          messageList.scrollTop = messageList.scrollHeight;
        }
        if (shouldReplaceMessages) {
          updateMessageCount(next.messages.length);
        }
        setStatus(next.status);
        saveCurrentThreadSnapshot();
        return next.status === "completed" || next.status === "failed" || next.status === "cancelled";
      }

      async function pollUntilDone() {
        const startedAt = Date.now();
        while (Date.now() - startedAt < 30000) {
          if (await refreshEvents()) return;
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        setStatus("waiting");
      }

      async function submitPrompt(prompt) {
        const sessionId = await ensureThread();
        appendLocalMessage("user", prompt, "complete");
        setStatus("running");
        setSending(true);
        let response;
        try {
          response = await fetch(endpoint("/tasks"), {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ sessionId, prompt }),
          });
        } catch {
          failCurrentThread("任务提交失败，请稍后重试。");
          return;
        }
        const body = await readJson(response);
        if (!response.ok || !body.task?.id) {
          failCurrentThread("任务提交失败，请稍后重试。");
          return;
        }
        activeTaskId = body.task.id;
        const thread = currentThread();
        if (thread) {
          thread.activeTaskId = activeTaskId;
          if (!thread.title || thread.title === "新会话" || thread.title === "Agent Chat") {
            thread.title = prompt.slice(0, 32);
            renderThreadList();
          }
        }
        updateLocationForThread(sessionId, activeTaskId);
        appendLocalMessage("assistant", "Agent 正在处理...", "running");
        persistThreads();
        await pollUntilDone();
        if (previewDrawer?.classList?.contains("is-open")) {
          await refreshPreview(sessionId, activeTaskId);
        }
      }

      form?.addEventListener("submit", (event) => {
        event.preventDefault();
        const prompt = String(input?.value || "").trim();
        if (!prompt) return;
        if (input) input.value = "";
        void submitPrompt(prompt).finally(() => {
          setSending(false);
        });
      });

      input?.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          form?.requestSubmit();
        }
      });

      function cancelCurrentThread() {
        if (!currentThreadId || currentThreadId === "assistant-ui-preview") return;
        if (stopButton?.disabled === true) return;
        stopButton.disabled = true;
        void fetch(endpoint("/sessions/" + encodeURIComponent(currentThreadId) + "/cancel"), {
          method: "POST",
        }).then(() => {
          removeRunningPlaceholders();
          setStatus("cancelled");
          appendLocalMessage("assistant", "任务已取消。", "incomplete");
          if (activeTaskId) {
            void refreshEvents();
          }
        }).catch(() => {
          removeRunningPlaceholders();
          setStatus("failed");
        });
      }

      stopButton?.addEventListener("click", () => {
        cancelCurrentThread();
      });

      document.addEventListener("keydown", (event) => {
        const thread = currentThread();
        if (event.key === "Escape" && thread?.status === "running") {
          event.preventDefault();
          cancelCurrentThread();
        }
      });

      newThreadButton?.addEventListener("click", () => {
        void createNewThread();
      });

      railList?.addEventListener("click", (event) => {
        const target = event.target?.closest?.("[data-assistant-ui-thread-id]");
        const threadId = target?.getAttribute?.("data-assistant-ui-thread-id") || "";
        if (threadId) switchThread(threadId);
      });

      function setPreviewDrawerOpen(open) {
        if (!previewDrawer) return;
        previewDrawer.setAttribute("aria-hidden", open ? "false" : "true");
        if (open) {
          previewDrawer.classList.add("is-open");
          void refreshPreview();
          return;
        }
        previewDrawer.classList.remove("is-open");
      }

      previewToggle?.addEventListener("click", () => {
        setPreviewDrawerOpen(true);
      });

      previewClose?.addEventListener("click", () => {
        setPreviewDrawerOpen(false);
      });

      initializeThreads();
    })();
  `;
}
