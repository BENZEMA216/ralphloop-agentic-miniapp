import {
  AssistantRuntimeProvider,
  ThreadListPrimitive,
  ThreadPrimitive,
  useExternalStoreRuntime,
} from "@assistant-ui/react";
import React from "react";
import { renderToString } from "react-dom/server";

import { createAssistantUiRuntimeOptions } from "./assistantUiRuntimeBinding.ts";
import type { FriendRuntimeStoreSnapshot } from "./friendAgUiRuntimeStore.ts";

type RuntimeStore = {
  getSnapshot(): FriendRuntimeStoreSnapshot;
  getAssistantUiExternalStoreAdapter(): ReturnType<typeof createAssistantUiRuntimeOptions>;
};

function textFromMessage(message: FriendRuntimeStoreSnapshot["messages"][number]): string {
  return message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

function roleLabel(role: FriendRuntimeStoreSnapshot["messages"][number]["role"]): string {
  switch (role) {
    case "assistant":
      return "Agent";
    case "system":
      return "System";
    case "user":
      return "You";
  }
}

function statusLabel(status: FriendRuntimeStoreSnapshot["status"]): string {
  switch (status) {
    case "completed":
      return "已完成";
    case "failed":
      return "失败";
    case "cancelled":
      return "已取消";
    case "running":
      return "运行中";
    case "waiting":
      return "等待中";
    case "idle":
      return "空闲";
  }
}

function RalphloopAssistantUiShell(input: { store: RuntimeStore }) {
  const runtime = useExternalStoreRuntime(createAssistantUiRuntimeOptions(input.store));
  const snapshot = input.store.getSnapshot();
  const currentThread = snapshot.threads.find((thread) => thread.id === snapshot.currentThreadId)
    ?? snapshot.threads[0];

  return React.createElement(
    AssistantRuntimeProvider,
    { runtime },
    React.createElement(
      "main",
      {
        className: "assistant-ui-runtime-shell",
        "data-ralphloop-assistant-ui-shell": "true",
        "data-assistant-ui-layout": "chatbot",
        "data-current-thread-id": snapshot.currentThreadId,
        "data-message-count": String(snapshot.messages.length),
        "data-thread-count": String(snapshot.threads.length),
      },
      React.createElement(
        "aside",
        {
          className: "assistant-ui-thread-rail",
          "data-assistant-ui-thread-list": "true",
        },
        React.createElement(
          "header",
          { className: "assistant-ui-rail-header" },
          React.createElement("p", null, "Sessions"),
        ),
        React.createElement(
          ThreadListPrimitive.Root,
          null,
          React.createElement(ThreadListPrimitive.New, { className: "assistant-ui-new-thread" }, "New Thread"),
          React.createElement(ThreadListPrimitive.Items, null, () => React.createElement("div")),
        ),
        React.createElement(
          "ol",
          { className: "assistant-ui-thread-list" },
          snapshot.threads.map((thread) => React.createElement(
            "li",
            {
              key: thread.id,
              className: "assistant-ui-thread-list-item",
              "aria-current": thread.id === snapshot.currentThreadId ? "true" : undefined,
            },
            React.createElement("span", null, thread.title),
          )),
        ),
      ),
      React.createElement(
        "section",
        {
          className: "assistant-ui-thread-panel",
          "data-assistant-ui-thread": "true",
          "data-assistant-ui-thread-status": snapshot.status,
        },
        React.createElement(
          "header",
          { className: "assistant-ui-thread-header" },
          React.createElement(
            "div",
            null,
            React.createElement("p", { className: "assistant-ui-kicker" }, "Agent Chat"),
            React.createElement("h2", null, currentThread?.title ?? "Agent Chat"),
          ),
          React.createElement(
            "div",
            { className: "status-cluster" },
            React.createElement("span", { className: "status-pill" }, statusLabel(snapshot.status)),
            React.createElement(
              "button",
              {
                id: "assistant-ui-preview-toggle",
                className: "secondary-button",
                type: "button",
              },
              "桌面预览",
            ),
          ),
        ),
        React.createElement(
          ThreadPrimitive.Root,
          null,
          React.createElement(
            ThreadPrimitive.Viewport,
            null,
            React.createElement(ThreadPrimitive.Messages, null, () => React.createElement("div")),
          ),
        ),
        React.createElement(
          "ol",
          {
            className: "assistant-ui-message-list",
            "data-assistant-ui-message-list": "true",
          },
          snapshot.messages.map((message) => React.createElement(
            "li",
            {
              key: message.id,
              className: `assistant-ui-message assistant-ui-message-${message.role}`,
              "data-message-role": message.role,
              "data-message-status": message.status?.type ?? "complete",
            },
            React.createElement("strong", { className: "assistant-ui-message-role" }, roleLabel(message.role)),
            React.createElement("p", { className: "assistant-ui-message-content" }, textFromMessage(message)),
          )),
        ),
        React.createElement(
          "form",
          {
            id: "assistant-ui-composer-form",
            className: "assistant-ui-composer",
            "data-assistant-ui-composer": "true",
          },
          React.createElement(
            "label",
            { className: "sr-only", htmlFor: "assistant-ui-composer-input" },
            "给 Agent 发送消息",
          ),
          React.createElement("textarea", {
            id: "assistant-ui-composer-input",
            name: "prompt",
            placeholder: "给 Agent 发送消息",
            rows: 2,
          }),
          React.createElement(
            "div",
            { className: "assistant-ui-composer-actions" },
            React.createElement("span", { className: "muted-label" }, "Enter 发送 · Shift+Enter 换行"),
            React.createElement(
              "div",
              { className: "composer-button-row" },
              React.createElement(
                "button",
                {
                  id: "assistant-ui-stop",
                  className: "secondary-button danger-outline",
                  disabled: !snapshot.isRunning,
                  type: "button",
                },
                "停止",
              ),
              React.createElement(
                "button",
                {
                  id: "assistant-ui-send",
                  type: "submit",
                },
                "发送",
              ),
            ),
          ),
        ),
      ),
      React.createElement(
        "aside",
        {
          id: "assistant-ui-preview-drawer",
          className: "surface preview-drawer assistant-ui-preview-drawer",
          "aria-hidden": "true",
          "aria-label": "桌面预览",
        },
        React.createElement(
          "div",
          { className: "section-heading" },
          React.createElement("h2", null, "桌面预览"),
          React.createElement(
            "button",
            {
              id: "assistant-ui-preview-close",
              className: "secondary-button",
              type: "button",
            },
            "关闭",
          ),
        ),
        React.createElement(
          "div",
          {
            id: "assistant-ui-preview-frame",
            className: "preview-frame",
          },
          React.createElement("span", null, "只读预览"),
        ),
      ),
    ),
  );
}

export function renderAssistantUiReactShellToString(store: RuntimeStore): string {
  return renderToString(React.createElement(RalphloopAssistantUiShell, { store }));
}
